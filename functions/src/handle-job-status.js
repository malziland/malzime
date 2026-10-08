"use strict";

/**
 * handle-job-status.js — GET /job-status?jobId=… (Queue-Architektur v2.0).
 *
 * Leichtgewichtiger Polling-Endpoint. Der Client fragt hier im Sekundentakt
 * den Stand seines Jobs ab und erhält: Status, Warteschlangen-Position,
 * grobe ETA und — sobald fertig — das Ergebnis.
 *
 * DELETE /job-status?jobId=…&token=… meldet einen noch WARTENDEN Job ab, den
 * der Browser nicht mehr abholt (siehe verwerfeAufWunsch).
 *
 * Kein IP-Rate-Limit: Der Endpoint wird konstruktionsbedingt im 2-Sekunden-
 * Takt gepollt; der Upload-Rate-Limiter (für /enqueue) würde legitime
 * Workshop-Klassen hinter einer geteilten Schul-IP sofort aussperren. Schutz
 * stattdessen: Die jobId ist eine zufällige, praktisch nicht erratbare
 * Firestore-ID, und der teure Einstieg (/enqueue) ist sehr wohl limitiert.
 * Ein Poll löst nur einen günstigen Firestore-Read aus.
 */

const { randomUUID } = require("crypto");
const { geltendeWerte } = require("./betriebsprofil");
const { dauerJeAnalyse } = require("./durchsatz");
const { wartezeitSekunden } = require("./warteschlangen-rechnung");
const { getFeatureFlags } = require("./feature-flags");
const { getJob, getQueuePosition, markFailedIfStale, touchJob, markDelivered, abandonJob } = require("./jobs");
const { safeCompare, sha256Hex } = require("./auth");
const { belegtesFreigeben } = require("./ruecknahme");

/* Firestore-Auto-IDs: genau 20 Zeichen aus [A-Za-z0-9] (jobs.js:58 nutzt
   `jobsRef().doc()` ohne eigenen Namen). Bewusst eng gefasst — alles, was nicht
   so aussieht, ist keine Job-Nummer dieses Systems. */
const JOB_ID_MUSTER = /^[A-Za-z0-9]{20}$/;

/* SEC-2026-08-13-C: Mindestabstand zwischen zwei Herzschlag-Schreibvorgängen.
   Der Client pollt im Sekundentakt; die Karenz für "Client noch da" liegt bei
   Minuten. 30 s nimmt den Großteil der Schreibvorgänge weg, ohne dass ein Job
   fälschlich als verlassen gilt. */
const TOUCH_MINDESTABSTAND_MS = 30_000;

/* Wartezeit-Schätzung aus der Warteschlangen-Position.

   FEATURE-2026-08-29-02: Rechnet mit der GEMESSENEN Dauer der letzten Läufe
   statt mit `QUEUE_AVG_JOB_SECONDS`. Die feste Zahl stammte vom 23.05. und war
   am 28.08. um mehr als die Hälfte zu optimistisch — eine Ansage, die nicht
   stimmt, ist schlechter als keine.

   `null` heißt ausdrücklich „keine belastbare Zeitangabe" (zu wenige oder zu
   alte Messwerte). Der Client zeigt dann die Position, die immer stimmt. */
async function etaForPosition(position) {
  const { sekunden, frisch, gemessen } = await dauerJeAnalyse(await isGemesseneDauerAn());
  if (gemessen && !frisch) return null;
  /* Die Parallelitaet kommt aus dem Einstellungssatz. Frueher stand hier der
     Code-Wert: Wer die Warteschlange umstellte, bekam eine Wartezeit-Ansage,
     die zur alten Zahl passte — der Fehler war fuer den Wartenden unsichtbar.
     BUG-2026-10-03-35: Gerechnet wird mit der engeren von zwei Bremsen
     (Parallelitaet und Rate), an derselben Stelle wie die Einlassgrenze. */
  const { werte } = await geltendeWerte();
  if (!werte || !sekunden) return null;
  return wartezeitSekunden(werte, position, sekunden);
}

/* Flag-Abfrage, die niemals wirft: Ist Firestore nicht erreichbar, gilt der
   Code-Wert — dieselbe Rückfallebene wie im Rest des Moduls. */
async function isGemesseneDauerAn() {
  try {
    const flags = await getFeatureFlags();
    return flags.useGemesseneDauer === true;
  } catch (_) {
    return false;
  }
}

/* PRIV-2026-10-03-57: Der Browser meldet einen Job ab, den er nicht mehr
   abholt — jemand hat ein anderes Foto gewählt. Ohne Abmeldung liefe die
   Analyse des verworfenen Fotos trotzdem (ein KI-Aufruf, ein Platz im
   Stundenkontingent), bis die Karenz des Aufräumdienstes greift.

   Zwei Grenzen, beide Pflicht:
   - Nur mit dem Abhol-Ticket des Jobs (PRIV-003). Die Job-Nummer allein
     genügt nicht — sonst könnte, wer eine Nummer kennt, fremde Aufträge
     abräumen.
   - Nur ein noch WARTENDER Job. Was schon in Arbeit oder fertig ist, bleibt
     unberührt (`abandonJob` prüft das in einer Transaktion).

   Danach dieselbe Rücknahme wie im Aufräumdienst (ruecknahme.js): Bild
   löschen und Platz im Stundenkontingent zurückgeben. Der Aufrufer wertet die
   Antwort nicht aus; scheitert etwas, räumt der Aufräumdienst wie bisher. */
async function verwerfeAufWunsch(job, token, res) {
  if (!job.resultToken || !safeCompare(token, job.resultToken)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  let verworfen = false;
  try {
    if (job.status === "queued" && (await abandonJob(job.id))) {
      verworfen = true;
      await belegtesFreigeben(job);
    }
  } catch (err) {
    /* Ohne jobId und ohne Fehlertext (wie in handle-reap.js): Ein
       Firestore-Fehlertext kann den Dokumentpfad samt jobId enthalten. */
    console.log(
      JSON.stringify({
        severity: "WARNING",
        warning: "job-abmelden-fehlgeschlagen",
        code: (err && err.code) || null,
        art: (err && err.name) || null,
      })
    );
  }
  res.status(200).json({ verworfen });
}

/* Ohne Einstellungssatz (07.10.2026): Fristen und Wartezeit kommen aus dem
   Satz; fehlt er, werfen die Stellen, die ihn brauchen. Bisher blieb das
   ungefangen — der Browser bekam einen Serverfehler, und jede Abfrage (alle
   zwei Sekunden je wartendem Geraet) schrieb eine Fehlerzeile in den Alarm.
   Jetzt: 503, eine Warnung ohne Auftragsnummer. Der Browser fragt weiter wie
   bei jeder kurzen Stoerung; den Alarm zum fehlenden Satz loesen der Einlass
   und die Satz-Wache aus, nicht jede einzelne Abfrage. */
async function handleJobStatus(req, res) {
  try {
    await beantworte(req, res);
  } catch (err) {
    if (!err || err.code !== "config_missing") throw err;
    console.log(JSON.stringify({ severity: "WARNING", warning: "job-status-ohne-einstellungssatz" }));
    res.status(503).json({ error: "config_missing" });
  }
}

async function beantworte(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const jobId = req.query && typeof req.query.jobId === "string" ? req.query.jobId : "";
  if (!jobId) {
    res.status(400).json({ error: "Missing jobId" });
    return;
  }
  /* AUDIT-BEFUND SEC-2026-08-12-08: Ohne Formatprüfung reicht ein Aufruf mit
     einer Job-Nummer wie "a/b" bis in `.doc()`, wo die Firestore-Bibliothek
     wirft ("path does not contain an even number of components"). Der Handler
     fing nichts ab, firebase-functions protokollierte "Unhandled error" mit
     severity ERROR, und die Alarmrichtlinie feuert auf genau diesen Dienst —
     ein beliebiger Dritter konnte so ohne Anmeldung den Fehleralarm (E-Mail
     und Push) auslösen, alle 5 Minuten, kostenlos.
     Firestore-Auto-IDs sind 20 Zeichen aus [A-Za-z0-9]; alles andere kann kein
     echter Job sein und wird als Eingabefehler beantwortet, nicht als
     Serverabsturz. Im Zweifel verweigern (KERN: fail-closed). */
  if (!JOB_ID_MUSTER.test(jobId)) {
    res.status(400).json({ error: "Invalid jobId" });
    return;
  }
  /* PRIV-003: Abhol-Ticket fürs Ergebnis (vom enqueue an genau diesen Browser
     ausgegeben). Status/Position bleiben ohne Ticket abrufbar; nur das fertige
     `result` ist an das Ticket gebunden. */
  const token = req.query && typeof req.query.token === "string" ? req.query.token : "";

  let job = await getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (req.method === "DELETE") {
    await verwerfeAufWunsch(job, token, res);
    return;
  }

  /* Hängt der Job zu lange in `processing` (Worker abgestürzt o.ä.), hier
     auf `failed` kippen — damit der pollende Client nicht ewig wartet. */
  if (job.status === "processing") {
    job = await markFailedIfStale(job);
  }

  if (job.status === "queued") {
    /* Liveness-Herzschlag: Dieser Poll belegt, dass der Client noch da ist.
       SEC-2026-08-13-C: NICHT bei jedem Poll schreiben. Vorher war /api/job-status
       ein unauthentifizierter Schreib-Verstärker (ein `update()` je Poll, während
       der Kommentar "nur ein günstiger Read" behauptete). Der Herzschlag wird nur
       aufgefrischt, wenn der letzte älter als TOUCH_MINDESTABSTAND_MS ist — das
       kostet nichts an Liveness (die Karenz ist Minuten, nicht Sekunden) und nimmt
       den Großteil der Schreibvorgänge weg. */
    const zuletzt = Number(job.lastSeenAt || 0);
    if (Date.now() - zuletzt >= TOUCH_MINDESTABSTAND_MS) {
      await touchJob(jobId);
    }
    const position = await getQueuePosition(job);
    res.status(200).json({
      status: "queued",
      position,
      etaSeconds: await etaForPosition(position),
    });
    return;
  }

  if (job.status === "processing") {
    /* Der Job läuft bereits — die Restzeit ist die Dauer einer Analyse. */
    const laufend = await dauerJeAnalyse(await isGemesseneDauerAn());
    const antwort = {
      status: "processing",
      position: 0,
      etaSeconds: laufend.gemessen && !laufend.frisch ? null : laufend.sekunden,
    };
    /* v3.0 Phase 1: Der bereits angekommene Live-Profiltext, sobald der
       Worker ihn ins Job-Dokument gelegt hat (fest eingebaut seit 10.09.2026,
       vorher Flag `useLiveText`). Er ist ein Vorgriff auf das `result` und
       unterliegt deshalb DEMSELBEN PRIV-003-Abhol-Ticket wie das fertige
       Ergebnis — der Client schickt das Ticket ohnehin bei jedem Poll mit.
       Vor der ersten Welle fehlen die Felder einfach. */
    if (typeof job.liveText === "string" && job.resultToken && safeCompare(token, job.resultToken)) {
      antwort.liveText = job.liveText;
      /* DOC-2026-08-13-FE-08: Zeitstempel des Live-Text-Stands. Der Client wertet
         ihn derzeit nicht aus (Teil des Live-Text-Protokolls, für Reihenfolge/
         Debugging reserviert) — bewusst mitgegeben und getestet, kein toter Rest. */
      antwort.liveTextStand = typeof job.liveTextStand === "number" ? job.liveTextStand : null;
      /* Neuversuch nach Verbindungsabriss (01.10.2026, jobs.setLiveText): Steigt
         die Zahl, faengt die Live-Anzeige von vorn an; eine kleinere ist eine
         verspaetete Welle der verworfenen Antwort. */
      if (Number.isInteger(job.liveTextVersuch)) antwort.liveTextVersuch = job.liveTextVersuch;
      /* v3.0 Phase 3: Der Beast-Text, sobald das Modell ihn schreibt —
         BEWUSST im selben Ticket-Block: dieselbe PRIV-003-Bindung, kein
         zweiter Pruefpfad. Solange Beast fehlt, fehlt auch das Feld. */
      if (typeof job.liveTextBeast === "string") {
        antwort.liveTextBeast = job.liveTextBeast;
      }
      /* FEATURE-2026-08-29-01: Fertige Kategorie-Karten — BEWUSST im selben
         Ticket-Block wie die Texte. Sie sind derselbe Vorgriff auf `result`
         und unterliegen damit derselben PRIV-003-Bindung; ein zweiter
         Pruefpfad waere eine zweite Stelle, an der man ihn vergessen kann. */
      for (const feld of ["liveKartenStandard", "liveKartenBeast"]) {
        if (Array.isArray(job[feld])) antwort[feld] = job[feld];
      }
    }
    res.status(200).json(antwort);
    return;
  }

  if (job.status === "done") {
    /* PRIV-003: das fertige Profil nur an den Browser herausgeben, der das
       Abhol-Ticket besitzt. Jeder Job trägt ein Ticket (createJob setzt es
       unkonditional) — fehlt es wider Erwarten, wird nie ausgeliefert statt
       offen zu bleiben. */
    if (!job.resultToken || !safeCompare(token, job.resultToken)) {
      res.status(200).json({ status: "done", result: null, tokenRequired: true });
      return;
    }
    /* Auslieferungs-Messung (Diagnose): Beim ERSTEN Ausliefern eines fertigen
       Jobs den Zeitpunkt festhalten und die Auslieferungs-Lücke loggen —
       `deliveryGapMs` = fertig gerechnet → tatsächlich beim Client angekommen,
       `totalMs` = erstellt → ausgeliefert (die volle serverseitige Kette).
       Erlaubt „done vs. wirklich abgeholt" sauber zu trennen, unabhängig von
       der best-effort Client-Telemetrie. Wiederholte Polls (Reload, zweiter
       Tab) loggen nicht erneut. Der Schreibvorgang wird ABGEWARTET, bevor die
       Antwort hinausgeht (BUG-2026-10-03-29, siehe unten). */
    const antwort = {
      status: "done",
      result: job.result || null,
    };
    /* Neuversuch (01.10.2026): Sah die Anzeige den letzten Versuch nicht, wirft
       sie den Text der verworfenen Antwort weg statt ihn zu Ende zu tippen. */
    if (Number.isInteger(job.liveTextVersuch)) antwort.liveTextVersuch = job.liveTextVersuch;
    if (!job.deliveredAt) {
      const now = Date.now();
      /* KA-02 (Kurzaudit 2026-08-12): Einmal-Ticket für den Realitäts-Check.
         Es wird GENAU EINMAL ausgegeben — bei der ersten Auslieferung, hinter
         derselben Ticket-Prüfung wie das Ergebnis selbst. Der Browser merkt
         es sich (sessionStorage); in der Datenbank liegt nur der Hash. Der
         Telemetrie-Endpunkt zählt eine Realitäts-Check-Stimme nur noch gegen
         ein gültiges, unverbrauchtes Ticket — eine echte Analyse, eine
         Stimme. Der Hash wird mit dem Zeitpunkt der Abholung in EINEM
         Schreibvorgang abgelegt (markDelivered). */
      const rcTicket = randomUUID();
      antwort.rcTicket = rcTicket;
      /* BUG-2026-10-03-29: ABWARTEN, dann antworten. Am Zeitpunkt der
         Abholung haengt die Loeschung des Ergebnisses 15 Minuten spaeter, und
         nach der Antwort fragt dieser Browser nicht noch einmal. Was erst nach
         der Antwort zu Ende laeuft, kommt vielleicht nie an (SECURITY-MODEL,
         "Jeder eingelassene Auftrag zaehlt genau einmal") — das Ergebnis laege
         dann 2 Stunden statt 15 Minuten. Ein Schreibvorgang, Millisekunden.
         Scheitert er auch im zweiten Versuch (jobs.js), bekommt das Kind sein
         Ergebnis trotzdem; dann steht eine Warnung im Protokoll.
         Ohne jobId und ohne Fehlertext (27.09.2026): Diese Zeile steht im
         selben Aufruf wie `job-delivered` (gemeinsames Label execution_id),
         und ein Firestore-Fehlertext kann den Dokumentpfad samt jobId
         enthalten. Nur der Fehlercode. */
      await markDelivered(job.id, sha256Hex(rcTicket)).catch((err) =>
        console.warn(
          JSON.stringify({
            severity: "WARNING",
            warning: "markDelivered-error",
            code: (err && err.code) || null,
            art: (err && err.name) || null,
          })
        )
      );
      /* OHNE jobId UND traceId (27.09.2026): Zeitstempel minus deliveryGapMs
         ergibt den Fertigzeitpunkt, und der liegt Millisekunden neben der
         Kinderschutz-Zeile. Mit Kennung waere die Altersschaetzung darueber
         dem Vorgang zuzuordnen. Wie man "nie abgeholt" ohne Kennung
         naehert: docs/SECURITY-MODEL.md, Abschnitt "Erfolgsweg eines
         Auftrags ohne Kennung im Log". */
      console.log(
        JSON.stringify({
          step: "job-delivered",
          deliveryGapMs: typeof job.finishedAt === "number" ? now - job.finishedAt : null,
          totalMs: typeof job.createdAt === "number" ? now - job.createdAt : null,
        })
      );
    }
    res.status(200).json(antwort);
    return;
  }

  if (job.status === "abandoned") {
    /* Der Client hatte die Seite verlassen; der Job wurde nicht verarbeitet.
       Beim Wiederkehren erfährt er das hier und kann neu hochladen. */
    res.status(200).json({ status: "abandoned" });
    return;
  }

  /* status === "failed" */
  res.status(200).json({
    status: "failed",
    errorReason: job.errorReason || "unknown",
  });
}

/* _etaForPosition ist fuer die Pruefung exportiert: Ohne Einstellungssatz
   muss die Wartezeit-Ansage "weiss nicht" liefern statt einer Zahl. Der Test
   dafuer lief zuvor gruen, OHNE die Funktion je aufzurufen — sie war nicht
   exportiert und die Pruefung uebersprang sich selbst (gefunden 30.08.2026). */
module.exports = { handleJobStatus, _etaForPosition: etaForPosition };
