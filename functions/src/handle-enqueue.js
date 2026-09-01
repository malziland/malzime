"use strict";

/**
 * handle-enqueue.js — POST /enqueue (Queue-Architektur v2.0).
 *
 * Annahme-Endpoint der Queue — seit v2.10 der einzige Upload-Weg. Validiert
 * die Anfrage (Method, Maintenance, Rate-Limit, Body-Größe, Honeypot, MIME,
 * Magic-Bytes, Warteschlangen-Tiefe, Stundenlimit), legt das Bild kurz ab,
 * erzeugt ein Job-Dokument und reiht es in Cloud Tasks ein. Antwortet SOFORT
 * mit der `jobId` — die eigentliche Mistral-Pipeline läuft asynchron im
 * Worker `processJob`.
 *
 * Public erreichbar. Honeypot und Zeitmessung sind Browser-Heuristiken und
 * halten einen Aufruf per curl nicht auf — die tragenden Bremsen sind das
 * IP-Rate-Limit, die Body-Größe, die Warteschlangen-Tiefe und das Stundenlimit.
 */

const crypto = require("crypto");
const { ALLOWED_MIME, MAX_UPLOAD_BYTES } = require("./config");
const { dauerJeAnalyse } = require("./durchsatz");
const { geltendeWerte } = require("./betriebsprofil");
const { getFeatureFlags } = require("./feature-flags");

/* Wie viele Wartende sind in einer halben Stunde zu schaffen?

   Die Rechnung braucht ZWEI Groessen, und beide kommen aus der Datenbank:
   die gemessene Dauer einer Analyse (`stats/durchsatz`, laufend aus echten
   Laeufen fortgeschrieben) und die Parallelitaet aus dem Einstellungssatz.

   BEFUND ARCH-2026-08-30-01 (Kurz-Audit): Die Parallelitaet stammte hier
   weiterhin aus dem Code. Wer den Einstellungssatz auf einen groesseren Tarif
   umstellte, sah im Zahlen-Endpunkt "quelle: firestore" und hielt alles fuer
   umgestellt — die Einlassgrenze rechnete aber weiter mit dem alten Wert. Das
   waere erst im Workshop unter Last aufgefallen, ohne Signal.

   Faellt eine der beiden Groessen aus, bleibt es bei der Konstante aus
   config.js: Die Einlassgrenze ist eine Schutzgrenze, keine Einstellung — sie
   darf nie fehlen, sonst liesse die Seite unbegrenzt Leute herein. */
async function aktuelleEinlassgrenze() {
  const { werte } = await geltendeWerte();
  /* Ohne Einstellungssatz laeuft ohnehin keine Analyse — dann ist die
     ehrliche Einlassgrenze null, nicht eine Ersatzzahl aus dem Code. */
  if (!werte) return 0;
  try {
    const flags = await getFeatureFlags();
    const { sekunden, gemessen } = await dauerJeAnalyse(flags.useGemesseneDauer === true);
    /* Gemessene Dauer verfuegbar: Grenze daraus rechnen, sonst die Zahl aus
       dem Einstellungssatz nehmen. */
    if (!gemessen || !sekunden) return werte.warteschlangeTiefe;
    return Math.max(1, Math.floor(((30 * 60) / sekunden) * werte.parallelitaet * 0.8));
  } catch (_) {
    return werte.warteschlangeTiefe;
  }
}
const { getClientIp, checkRateLimit } = require("./middleware");
const { parseMultipart, parseJsonBody } = require("./upload");
const { resolveLanguage } = require("./i18n");
const { checkAndIncrement, getMaintenanceStatus, releaseHourlySlot } = require("./counter");
const { notifyLimitReached } = require("./notify");
const { ALLOWED_ORIGINS } = require("./domains");
const { createJob, failJob, platzBestaetigen, getJob, abandonJob, countQueuedJobs } = require("./jobs");
const { storeImage, deleteImage } = require("./queue-storage");
const { enqueueJob } = require("./cloud-tasks");

/**
 * Magic-Byte-Erkennung — prüft den echten Datei-Inhalt gegen den vom Client
 * behaupteten MIME-Typ. Gibt den erkannten MIME-Typ zurück oder null.
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hex = buffer.slice(0, 4).toString("hex");
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/* Whitelist-Sanitisierung der Kamera-Metadaten — nur make/model, je 100 Zeichen.
   GPS und dateTimeOriginal bleiben client-seitig (unverändert zur Architektur). */
function sanitizeExif(raw) {
  const safe = {};
  if (raw && typeof raw === "object") {
    if (typeof raw.make === "string") safe.make = raw.make.slice(0, 100);
    if (typeof raw.model === "string") safe.model = raw.model.slice(0, 100);
  }
  return safe;
}

async function handleEnqueue(req, res, secrets) {
  /* Haelt dieser Aufruf einen reservierten Platz? Wird an JEDEM Rueckgabeweg
     geprueft — ein nicht zurueckgegebener Platz blockiert sonst einen
     Wartenden, bis der Reaper abgleicht. Bewusst GANZ AUSSEN deklariert,
     damit auch der aeussere Fehlerweg ihn sieht. */
  let einlassgrenze = null;
  const requestId = Math.random().toString(36).slice(2, 10);
  let traceId = null;
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    /* Kill-Switch: Maintenance-Modus (30s Cache, fail-open) */
    const maintenance = await getMaintenanceStatus();
    if (maintenance.enabled) {
      res.status(503).json({ maintenance: true, message: maintenance.message });
      return;
    }

    const ip = getClientIp(req);
    const { werte: grenzwerte } = await geltendeWerte().catch(() => ({ werte: null }));

    /* BEFUND 01.09.2026 (Simulation im Emulator): Ohne Einstellungssatz warf
       `checkRateLimit` eine Zeile weiter unten ("adressLimit fehlt") — und der
       Einlass antwortete mit HTTP 500 "unknown_error". Das Kind sah damit
       wieder die falsche Meldung, obwohl der freundliche 503-Riegel weiter
       unten seit heute genau dafuer da ist: Er kam nie dran.
       Gefunden hat es kein Test, sondern ein Durchgang durch die laufende
       Anwendung — die Tests rufen handle-enqueue direkt auf und ueberspringen
       die Middleware davor.
       Der Riegel steht jetzt VOR jeder Pruefung, die Satzwerte braucht. */
    if (!grenzwerte) {
      console.log(JSON.stringify({ requestId, warning: "kein-einstellungssatz", stelle: "vor-ratenbegrenzung" }));
      res.status(503).json({
        blocked: "configMissing",
        retryAfterSeconds: 300,
      });
      return;
    }

    if (!checkRateLimit(ip, grenzwerte?.adressLimit, grenzwerte?.adressfensterMs)) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    /* SEC-2026-08-13-B — EHRLICHE FASSUNG (korrigiert SEC-002 vom 2026-08-10):
       Diese Kopfzeilen-Prüfung kann NICHT verhindern, dass der Rumpf im Speicher
       landet. Die Cloud-Functions-Laufzeit liest ihn VORAB vollständig als
       req.rawBody ein (siehe upload.js) — bevor dieser Handler läuft. Der frühere
       Kommentar behauptete "ablehnen, BEVOR irgendetwas mit dem Rumpf passiert";
       das war nachweislich falsch (24-MB-POST wird live gepuffert, dann erst 400).
       Was hier wirklich schützt, ist gestaffelt:
         1. Cloud Run selbst deckelt den Request-Body (~32 MiB) — ein größerer
            Rumpf erreicht die Function gar nicht erst.
         2. Diese Kopfzeilen-Prüfung spart den JSON-Parse bei ehrlich deklarierter
            Übergröße (Angreifer lügt evtl. — dann greift 3).
         3. Die Base64-Längenprüfung unten (vor Buffer.from) verhindert die ZWEITE
            große Allokation (den dekodierten Bild-Buffer).
       Das verbleibende Restrisiko (der rawBody selbst) ist infrastrukturseitig
       gedeckelt und in docs/SECURITY-MODEL.md als bewusste Abwägung festgehalten. */
    const gemeldeteLaenge = Number(req.headers["content-length"] || 0);
    const MAX_BODY_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 64 * 1024;
    if (gemeldeteLaenge > MAX_BODY_BYTES) {
      console.log(JSON.stringify({ requestId, warning: "body-too-large", bytes: gemeldeteLaenge }));
      res.status(413).json({ error: "File too large" });
      return;
    }

    /* Bot-Heuristik: Requests ohne Browser-Origin nur observieren, nicht blocken. */
    const origin = req.headers["origin"] || "";
    const referer = req.headers["referer"] || "";
    if (!ALLOWED_ORIGINS.some((o) => origin.startsWith(o) || referer.startsWith(o))) {
      console.log(JSON.stringify({ requestId, warning: "no-browser-origin" }));
    }

    /* ── Body parsen (JSON mit imageBase64 oder Multipart) ── */
    let file = null;
    let exif = {};
    let fields = null;
    const jsonBody = parseJsonBody(req);
    if (jsonBody && jsonBody.imageBase64) {
      const b64 = String(jsonBody.imageBase64);
      if (/[^A-Za-z0-9+/=\s]/.test(b64.slice(0, 256))) {
        res.status(400).json({ error: "Invalid image data" });
        return;
      }
      if (Math.ceil((b64.length * 3) / 4) > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "File too large" });
        return;
      }
      const buffer = Buffer.from(b64, "base64");
      file = { buffer, mimeType: jsonBody.mimeType || "image/jpeg", size: buffer.length };
      exif = sanitizeExif(jsonBody.exif);
    } else if (!jsonBody) {
      const parsed = await parseMultipart(req);
      file = parsed.file;
      fields = parsed.fields;
    }

    /* i18n + Trace-ID */
    const requestedLang = (jsonBody && jsonBody.lang) || (fields && fields.lang) || "";
    const lang = resolveLanguage(requestedLang);

    const rawTraceId = (jsonBody && jsonBody.traceId) || (fields && fields.traceId) || "";
    if (typeof rawTraceId === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(rawTraceId)) {
      traceId = rawTraceId;
    }
    if (traceId) res.setHeader("X-Trace-Id", traceId);

    /* Honeypot */
    const honeypot = (jsonBody && jsonBody.website) || (fields && fields.website) || "";
    if (honeypot) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    /* ── Validierung ── */
    if (!file || !file.buffer) {
      res.status(400).json({ error: "Missing image" });
      return;
    }
    if (!file.mimeType || !ALLOWED_MIME.includes(file.mimeType)) {
      res.status(400).json({ error: "Invalid file type. Allowed: JPEG, PNG, WEBP, GIF" });
      return;
    }
    /* SEC-2026-08-12-19: Der erkannte Typ wurde bisher nur auf "ueberhaupt ein
       Bild" geprueft und dann weggeworfen. Ein GIF mit der Behauptung
       `image/jpeg` kam durch — die Behauptung des Aufrufers reiste danach
       ungeprueft weiter, bis in die Daten-URL an die KI. Jetzt entscheidet der
       Inhalt, nicht die Behauptung. Fuer das eigene Frontend aendert sich
       nichts: Es erzeugt jedes Bild ueber den Canvas neu und schickt darum immer
       echtes JPEG (public/js/exif.js, toDataURL("image/jpeg")). */
    const erkannterTyp = detectImageType(file.buffer);
    if (!erkannterTyp) {
      res.status(400).json({ error: "Invalid image data" });
      return;
    }
    if (erkannterTyp !== file.mimeType) {
      console.log(
        JSON.stringify({
          requestId,
          warning: "mime-mismatch",
          behauptet: file.mimeType,
          erkannt: erkannterTyp,
        })
      );
      res.status(400).json({ error: "Invalid file type. Allowed: JPEG, PNG, WEBP, GIF" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }

    /* ── Einlassgrenze, erster Blick ──
       Nur die Grenze holen. Die eigentliche Entscheidung faellt weiter unten,
       NACH dem Anlegen — dort ist sie exakt und kostet keine Sperre.

       WARUM NICHT HIER (BUG-2026-08-30-14, zweiter Anlauf):
       Zwischenzeitlich stand hier eine atomare Reservierung ueber ein
       Zaehler-Dokument in einer Transaktion. Sie loeste den Wettlauf sauber —
       und erzeugte ein schlimmeres Problem: Ein einzelnes Firestore-Dokument
       vertraegt etwa einen Schreibvorgang pro Sekunde. Bei 170 gleichzeitigen
       Anfragen entstanden 373 Sperr-Konflikte, einzelne Anfragen hingen
       SECHZIG SEKUNDEN, und 94 von 170 Verbindungen rissen ab.

       Die Positionspruefung unten hat das Problem nicht: Sie zaehlt nur und
       schreibt nichts Gemeinsames. Damit ist sie exakt UND schnell. */
    try {
      einlassgrenze = await aktuelleEinlassgrenze();

      /* VORPRUEFUNG — grob, aber billig und OHNE Sperre.
         Sie faengt den Normalfall ab, BEVOR ein Bild gespeichert oder ein
         Stunden-Platz gezogen wird. Das ist nicht nur schneller, sondern auch
         eine Datenschutzfrage: Ein Foto, das nie analysiert wird, soll auch
         nie auf unserem Speicher liegen.

         Sie ist NICHT exakt — zwischen Zaehlen und Anlegen koennen andere
         dazukommen. Genau dafuer gibt es die Nachpruefung weiter unten, die
         die Grenze exakt haelt. Zusammen: schnell im Normalfall, exakt an der
         Grenze. */
      /* BEFUND 01.09.2026 (Runde 7, K-6): Der 503-Block fuer "kein
         Einstellungssatz" stand UNTER diesem Aufruf und im selben try. Wirft
         countQueuedJobs (Zeitgrenze, Firestore-Stoerung), wird er
         uebersprungen — der Auftrag laeuft weiter, das Bild wird gespeichert
         und eingereiht, obwohl ohne Satz keine Analyse laufen kann. Gemessen:
         HTTP 200, Job angelegt, Bild im Speicher.
         Er braucht die Zaehlung nicht und steht deshalb jetzt davor. */
      if (einlassgrenze === 0) {
        console.log(JSON.stringify({ requestId, warning: "kein-einstellungssatz" }));
        res.status(503).json({
          blocked: "configMissing",
          retryAfterSeconds: 300,
          message: "Bei uns stimmt gerade eine Einstellung nicht — bitte in ein paar Minuten nochmal.",
        });
        return;
      }

      const schonWartend = await countQueuedJobs();
      if (einlassgrenze > 0 && schonWartend >= einlassgrenze) {
        console.log(
          JSON.stringify({ requestId, warning: "queue-too-deep", wartende: schonWartend, grenze: einlassgrenze })
        );
        res.status(429).json({
          blocked: "queueFull",
          retryAfterSeconds: 300,
          message: "Gerade warten sehr viele Analysen — bitte in ein paar Minuten nochmal.",
        });
        return;
      }
    } catch (err) {
      console.log(JSON.stringify({ requestId, warning: "einlassgrenze-nicht-ermittelbar", error: err.message }));
    }

    /* ── Globales Stundenlimit (Firestore-Zähler) ──
       Erst NACH Honeypot/Validierung zählen, damit ungültige Requests
       das Budget nicht aufbrauchen. */
    const counter = await checkAndIncrement();
    if (counter.justReached) {
      notifyLimitReached({
        ntfyUrl: secrets.ntfyUrl.value(),
        ntfyTopic: secrets.ntfyTopic.value(),
        adminSecret: secrets.adminSecret.value(),
        count: counter.count,
        limit: counter.limit,
      }).catch((err) => {
        console.log(JSON.stringify({ warning: "ntfy-error", error: err.message }));
      });
    }
    if (!counter.allowed) {
      /* Der Auftrag kommt nicht zustande — der reservierte Platz gehoert
         wieder dem Naechsten. */
      res.status(429).json({
        blocked: "limit",
        retryAfterSeconds: counter.retryAfterSeconds,
        message: "Stundenlimit erreicht",
      });
      return;
    }

    /* ── Bild ablegen → Job anlegen → in Cloud Tasks einreihen ── */
    /* PRIV-003: Abhol-Ticket fürs Ergebnis — nur dieser Browser bekommt es von
       job-status zurück (zweites Schloss zusätzlich zur unerratbaren jobId). */
    const resultToken = crypto.randomUUID();
    let imagePath;
    let jobId;
    try {
      imagePath = await storeImage(file.buffer, file.mimeType);
      jobId = await createJob({ lang, traceId, imagePath, exif, resultToken });
    } catch (err) {
      /* Der Stunden-Slot ist hier schon gezogen, aber es entsteht nie eine
         Analyse — Slot zurückgeben und ein evtl. schon abgelegtes Bild nicht
         bis zur Lifecycle-Regel liegen lassen. */
      console.log(JSON.stringify({ requestId, traceId, warning: "store-or-create-failed", error: err.message }));
      releaseHourlySlot().catch(() => {});
      if (imagePath) await deleteImage(imagePath);
      res.status(503).json({ error: "Queue unavailable", code: "store_failed" });
      return;
    }

    /* ── ZWEITE STUFE der Einlassgrenze (BUG-2026-08-30-14) ──
       NUR IM GRENZBEREICH. Die Stufe kostet zwei zusaetzliche
       Datenbankzugriffe pro Upload. Bei 170 gleichzeitigen Anfragen wurde der
       Einlass dadurch so langsam, dass Verbindungen abrissen — im Simulator
       95 von 170, vorher hoechstens 23. Das ist der falsche Preis fuer eine
       Bremse, die erst kurz vor der Grenze etwas bewirkt.

       Ab 80 % der Grenze wird geprueft, darunter nicht. Im Workshop-Alltag
       (30 Wartende von 155) laeuft der Einlass damit genauso schnell wie
       vorher; erst wenn es eng wird, kostet er mehr. 
       Die atomare Reservierung oben faengt den Normalbetrieb ab. Unter echtem
       Andrang scheitert sie an einer Firestore-Eigenschaft: Ein einzelnes
       Dokument vertraegt nur etwa einen Schreibvorgang pro Sekunde, und bei
       170 gleichzeitigen Anfragen wirft die Datenbank ABORTED — die Notbremse
       liess dann alle durch (gemessen 177 bei Grenze 155).

       Hier wird nur GEZAEHLT, ohne Sperre: Wie viele warten vor mir? Die
       Antwort ist stabil, jeder entscheidet fuer sich, und es gibt keinen
       Wettlauf. Wer zu spaet kommt, nimmt sich selbst zurueck — bevor der
       Auftrag Kosten verursacht. */
    try {
      if (einlassgrenze === null) throw { _uebersprungen: true };
      const angelegt = await getJob(jobId);
      if (!(await platzBestaetigen(angelegt, einlassgrenze))) {
        await abandonJob(jobId);
        if (imagePath) await deleteImage(imagePath);
        releaseHourlySlot().catch(() => {});
        console.log(JSON.stringify({ requestId, traceId, warning: "queue-too-deep-nachtraeglich" }));
        res.status(429).json({
          blocked: "queueFull",
          retryAfterSeconds: 300,
          message: "Gerade warten sehr viele Analysen — bitte in ein paar Minuten nochmal.",
        });
        return;
      }
    } catch (err) {
      /* Uebersprungen ist kein Fehler — nur der Normalfall weit unter der
         Grenze. Er darf nicht ins Fehlerprotokoll, sonst geht der echte
         Fehler im Rauschen unter. */
      if (!err || !err._uebersprungen) {
        /* Fail-open wie die erste Stufe: Eine Kapazitaetsbremse darf nie zum
           Ausfall eskalieren. Der Fehler geht laut ins Protokoll. */
        console.error(
          JSON.stringify({
            severity: "ERROR",
            error: "platz-bestaetigung-fehlgeschlagen",
            message: err && err.message,
          })
        );
      }
    }

    try {
      await enqueueJob(jobId);
    } catch (err) {
      /* Job ist angelegt, aber Cloud Tasks hat ihn nicht angenommen — sonst
         bliebe er für immer `queued` und der Client pollt ewig. Sauber als
         `failed` markieren und das Bild gleich wieder löschen. */
      console.log(JSON.stringify({ requestId, traceId, jobId, warning: "enqueue-failed", error: err.message }));
      await failJob(jobId, "enqueue_failed");
      /* BIZ-001: Slot zurückgeben — dieser Job löst nie eine echte Analyse aus. */
      releaseHourlySlot().catch(() => {});
      await deleteImage(imagePath);
      res.status(503).json({ error: "Queue unavailable", code: "enqueue_failed" });
      return;
    }

    console.log(JSON.stringify({ requestId, traceId, jobId, step: "enqueue", status: "ok" }));
    res.status(200).json({ jobId, resultToken });
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "unknown_error";
    /* Auch der unerwartete Fehlerweg gibt den Platz zurueck. Ohne das haette
       jeder Absturz nach der Reservierung einen Platz dauerhaft belegt — bis
       der Reaper abgleicht, und bei genug Abstuerzen waere die Warteschlange
       dauerhaft "voll", obwohl niemand wartet. */
    console.log(JSON.stringify({ requestId, traceId, status: "error", code, error: err.message }));
    res.status(status).json({ error: "Enqueue failed", code });
  }
}

module.exports = { handleEnqueue, detectImageType, _aktuelleEinlassgrenze: aktuelleEinlassgrenze };
