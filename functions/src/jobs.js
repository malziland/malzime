"use strict";

/**
 * jobs.js — Job-Verwaltung für die Queue-Architektur (v2.0).
 *
 * Jede Analyse-Anfrage wird im Queue-Modus als Job-Dokument in der Firestore-
 * Collection `jobs` abgelegt. Lebenszyklus:
 *
 *   queued ──(Worker übernimmt)──► processing ──► done | failed
 *   queued ──(Client verlässt die Seite)──────────────────► abandoned
 *
 * - `enqueue`-Handler legt den Job an (Status `queued`) und reiht ihn in
 *   Cloud Tasks ein.
 * - Cloud Tasks dispatcht ihn dosiert an `process-job`, der `claimJob` ruft,
 *   die Mistral-Pipeline ausführt und `completeJob`/`failJob` ruft.
 * - `job-status`-Handler liest den Job für den pollenden Client und
 *   aktualisiert dabei den Liveness-Herzschlag `lastSeenAt`.
 * - Pollt der Client länger nicht mehr (Browser zu), gilt der Job als
 *   verlassen → `abandoned`. Der Mistral-Call wird eingespart, der Platz
 *   in der Warteschlange für andere frei.
 *
 * Zeitstempel sind plain Millisekunden-Numbers (`Date.now()`) — direkt
 * vergleichbar, konsistent mit counter.js, kein FieldValue nötig.
 */

const crypto = require("crypto");
const { Timestamp } = require("firebase-admin/firestore");
const { datenbank } = require("./db");
const { geltendeWerte, ZUSAGE_LOESCHFRISTEN } = require("./betriebsprofil");
const { deleteImage } = require("./queue-storage");

/* Holt die Betriebswerte oder bricht ab. Es gibt keine Ersatzzahlen mehr:
   Liegt kein gueltiger Einstellungssatz vor, laeuft auch keine Analyse — dann
   entstehen keine neuen Jobs. Die alten loescht der Aufraeumdienst weiter
   (loeschfrist unten). */
async function betriebswerteOderAbbruch() {
  const { werte, grund } = await geltendeWerte();
  if (!werte) {
    const fehler = new Error(`Betriebswerte fehlen: ${grund || "unbekannt"}`);
    fehler.code = "config_missing";
    throw fehler;
  }
  return werte;
}

/* BLEIBT IM CODE — Schutzgrenze, keine Betriebseinstellung: wie viele Auftraege
   ein Lauf des Aufraeumdienstes je Loeschabfrage nimmt, wenn kein gueltiger Satz
   vorliegt. Der naechste Lauf eine Minute spaeter nimmt den Rest. */
const LOESCH_STAPEL_OHNE_SATZ = 200;

/* Frist und Stapel fuer die zwei LOESCHABFRAGEN (PRIV-2026-10-03-26). Mit
   gueltigem Satz gelten seine Werte. Ohne ihn gilt die Zusage selbst
   (2 Stunden, 15 Minuten ab Abholung) — das Loeschen haengt nicht daran, ob
   gerade Analysen laufen koennen. Die drei Abfragen nach wartenden und
   haengenden Auftraegen brechen ohne Satz weiter ab: Fuer sie gibt es keine
   zugesagte Frist. */
async function loeschfrist(feld) {
  const { werte } = await geltendeWerte();
  if (werte) return { fristMs: werte[feld], stapel: werte.aufraeumStapel };
  return { fristMs: ZUSAGE_LOESCHFRISTEN[feld], stapel: LOESCH_STAPEL_OHNE_SATZ };
}

/* ARCH-2026-08-12-27: Frist des Sicherheitsnetzes (Firestore-TTL). Bewusst weit
   ueber JOB_RETENTION_MS (2 h): Der Reaper ist die Loeschung, die TTL faengt nur
   seinen Ausfall ab. Ein knapper Wert wuerde laufende Jobs mitten im Betrieb
   loeschen — genau die Gefahr, die diese Massnahme nicht schaffen darf. */
const TTL_NETZ_MS = 24 * 60 * 60 * 1000;

const JOBS_COLLECTION = "jobs";

/* Ein Job, der länger als das hier in `processing` hängt, gilt als verloren
   (Worker abgestürzt o.ä.) und wird auf `failed` gesetzt, damit kein Client
   ewig pollt.
   BUG-001 (Audit 2026-06): von 600s auf 540s gesenkt = exakt das Cloud-
   Function-Timeout. Ein Job kann nicht länger als 540s legitim in `processing`
   sein (Cloud Run killt den Worker dann). Bei 600s blieb der Job nach einem
   Worker-Kill bis zu 60s länger als „wird verarbeitet" hängen. Das globale
   Pipeline-Budget (REQUEST_BUDGET_MS=480s) liegt darunter, daher werden echte
   Jobs (≈480s + Overhead) NICHT fälschlich gescheitert — und die jetzt
   bedingten Statusübergänge (s. completeJob/failJob) verhindern jede Race. */

function jobsRef() {
  return datenbank().collection(JOBS_COLLECTION);
}

/* Welche Fehlermeldung ein Endzustand dem Kind zeigt und die eine Fehlerzeile
   dazu ("ein Alarm je gescheiterter Analyse"): analyse-ausgang.js. */
const { fehlerGrund, meldeGescheiterteAnalyse } = require("./analyse-ausgang");

/* Schreibt die Meldung und vermerkt sie am Auftrag (OPS-2026-10-03-31). In
   dieser Reihenfolge: Scheitert der Vermerk, bleibt `gemeldet: false` stehen,
   und der Aufraeumdienst meldet beim Loeschen ein zweites Mal — lieber zwei
   Nachrichten als keine. */
async function meldenUndVermerken(ref, grund) {
  meldeGescheiterteAnalyse(grund);
  await ref.update({ gemeldet: true }).catch(() => {});
}

/* Fuehrt einen Uebergang in den Endzustand aus und wiederholt ihn EINMAL, wenn
   er mit einem Fehler endet. Die Wiederholung traegt dieselbe Marke: Hat der
   erste Versuch doch geschrieben und nur die Bestaetigung kam nicht an, erkennt
   sie den eigenen Stand (siehe completeJob, failJob). */
async function mitWiederholung(uebergang) {
  const marke = crypto.randomUUID();
  return uebergang(marke).catch(() => uebergang(marke));
}

/* Meldet beim Loeschen nach, was im Endzustand eine Fehlermeldung zeigte und
   noch nicht gemeldet ist — fuer den Aufraeumdienst, NACH dem Loeschen des
   Auftrags. `gemeldet` ist nur dann `false`, wenn der Uebergang es so gesetzt
   hat; Auftraege aus der Zeit vor diesem Feld bleiben still. */
function nachmeldenBeimLoeschen(job) {
  if (job && job.gemeldet === false && fehlerGrund(job)) meldeGescheiterteAnalyse(fehlerGrund(job));
}

/**
 * Legt einen neuen Job an (Status `queued`). Gibt die generierte jobId zurück.
 *
 * @param {object} params
 * @param {string} params.lang       aufgelöste Sprache ("de"/"en")
 * @param {string} [params.traceId]  Trace-ID des Clients (Korrelation), optional
 * @param {string} params.imagePath  Storage-Pfad des zwischengespeicherten Bildes
 * @param {object} [params.exif]     sanitisierte Kamera-Metadaten (make/model),
 *                                   die der Worker an die Profil-Stufe weiterreicht
 * @param {number} [params.zaehlerStempel]  Marke des Einlasses im Stundenfenster
 * @param {boolean} [params.zaehlerNachtrag] true = der Worker traegt die Marke nach
 */
async function createJob({ lang, traceId, imagePath, exif, resultToken, zaehlerStempel, zaehlerNachtrag }) {
  const ref = jobsRef().doc();
  const now = Date.now();
  await ref.set({
    status: "queued",
    createdAt: now,
    /* ARCH-2026-08-12-27: Sicherheitsnetz UNTER dem Reaper. Der Reaper räumt
       Job-Dokumente nach JOB_RETENTION_MS (2 h) ab — er ist die eigentliche
       Löschung. Steht er still (pausierter Zeitplan, verlorene Berechtigung),
       gab es bisher nichts darunter: Dokumente mit fertigen Profilen wären
       unbegrenzt liegengeblieben, zugesagt sind "spätestens rund 2 Stunden".
       Firestore löscht Dokumente automatisch, sobald dieses Zeitstempel-Feld
       in der Vergangenheit liegt. Bewusst DEUTLICH später als der Reaper
       (24 h statt 2 h): Das Netz soll fangen, wenn der Reaper ausfällt, und ihm
       nicht ins Handwerk pfuschen, solange er läuft. */
    expiresAt: Timestamp.fromMillis(now + TTL_NETZ_MS),
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    deliveredAt: null,
    lang: lang || "de",
    traceId: traceId || null,
    imagePath: imagePath || null,
    exif: exif && typeof exif === "object" ? exif : {},
    /* PRIV-003 (Audit 2026-06): zweites Schloss auf das Ergebnis. Nur wer dieses
       Ticket hat (der Browser, der den Job angelegt hat), bekommt von job-status
       das `result` zurück — nicht jeder, der die jobId kennt. */
    resultToken: resultToken || null,
    /* Stundenzaehler (11.09.2026, counter.js "GENAU EINMAL IM FENSTER"): die
       Marke dieses Einlasses im rollenden Fenster — eine Zeitzahl, nichts
       ueber die Person. Damit gibt ein abgebrochener Auftrag genau seinen
       eigenen Platz frei, und der Worker traegt ihn nach, wenn der Zaehler
       beim Einlass ausgewichen war. */
    zaehlerStempel: typeof zaehlerStempel === "number" && Number.isFinite(zaehlerStempel) ? zaehlerStempel : null,
    zaehlerNachtrag: zaehlerNachtrag === true,
    result: null,
    errorReason: null,
    attempts: 0,
  });
  /* Gibt die ID zurueck, wie seit jeher.
     ABWAEGUNG (30.08.2026): Kurzzeitig lieferte createJob zusaetzlich den
     Zeitstempel, damit die zweite Stufe der Einlassgrenze ihn nicht nachlesen
     muss. Das spart EINEN Lesevorgang pro Upload — bei 2000 Analysen etwa
     einen Zehntelcent. Dafuer aendert es einen Vertrag, an dem 35 Teststellen
     haengen. Das Verhaeltnis stimmt nicht: Ein gebrochener Vertrag kostet
     mehr als er spart, und genau solche Kopplung wollen wir loswerden. */
  return ref.id;
}

/**
 * Liest einen Job. Gibt `{ id, ...data }` zurück oder `null`, wenn es ihn
 * nicht gibt.
 */
async function getJob(jobId) {
  const snap = await jobsRef().doc(jobId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Idempotenter Claim: versucht den Job von `queued` auf `processing` zu
 * schalten.
 *
 * - Gibt `true` zurück, wenn DIESER Aufruf den Job übernommen hat.
 * - Gibt `false` zurück, wenn der Job nicht (mehr) `queued` ist — z.B. weil
 *   Cloud Tasks den Task wiederholt hat oder zwei Dispatches kollidieren.
 *   In dem Fall darf `process-job` NICHT erneut Mistral aufrufen.
 *
 * Die Firestore-Transaction garantiert: bei parallelen Aufrufen gewinnt
 * genau einer.
 */

/* Hier stand vom 30.08. bis 01.09.2026 eine atomare Platzreservierung ueber
   ein Zaehler-Dokument (`stats/warteschlange`). Sie wurde am 30.08. durch die
   zaehlende Positionspruefung (platzBestaetigen) ersetzt, weil ein einzelnes
   Firestore-Dokument bei Andrang zum Engpass wird — der Zaehler wurde danach
   aber weiter bei jedem Uebergang beschrieben und minuetlich abgeglichen, ohne
   dass ihn noch jemand las (ARCH-2026-09-01-03). Jetzt gibt es ihn nicht mehr.
   Die Geschichte steht in docs/ARCHITECTURE.md ("Einlass-Politik"). */

async function claimJob(jobId) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.status !== "queued") return false;
    tx.update(ref, {
      status: "processing",
      startedAt: Date.now(),
      attempts: (data.attempts || 0) + 1,
    });
    return true;
  });
}

/**
 * Schließt einen Job erfolgreich ab: NUR `processing` → `done` mit Ergebnis.
 *
 * BUG-001 (Audit 2026-06): bedingter Übergang in einer Transaktion. Ein
 * nachlaufender Worker, dessen Job inzwischen vom Reaper auf `failed`/`abandoned`
 * gesetzt wurde, überschreibt diesen Terminalzustand NICHT mehr.
 *
 * `marke` (BUG-2026-10-03-30): Kennzeichen des Schreibers. Wiederholt er den
 * Aufruf nach einem Fehler und findet den Job schon `done` MIT seiner Marke,
 * war der erste Versuch angekommen und nur die Bestaetigung ging verloren —
 * das zaehlt als gelungen, nicht als "ein anderer war schneller".
 * `meldeGrund`: Grund fuer die Meldung "Analyse gescheitert", wenn er ein
 * anderer ist als der, den das Kind sieht (`result.blockedReason`).
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function completeJob(jobId, result, { marke = null, meldeGrund = null } = {}) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  /* Zeigt dieses Ergebnis dem Kind eine Fehlermeldung (blockiert oder leeres
     Profil)? Dann traegt der Auftrag ab dem Uebergang `gemeldet: false`. */
  const grund = fehlerGrund({ status: "done", result, errorReason: meldeGrund });
  const gemacht = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const daten = snap.data();
    if (marke && daten.status === "done" && daten.abschlussMarke === marke) return true;
    if (daten.status !== "processing") return false;
    tx.update(ref, {
      status: "done",
      finishedAt: Date.now(),
      result: result || null,
      errorReason: meldeGrund,
      abschlussMarke: marke,
      gemeldet: grund ? false : null,
    });
    return true;
  });
  if (gemacht && grund) await meldenUndVermerken(ref, grund);
  return gemacht;
}

/* BLEIBT IM CODE — Schutzgrenze, keine Betriebseinstellung: so oft wird das
   Speichern eines fertigen Ergebnisses versucht, bevor es als gescheitert gilt. */
const SPEICHER_VERSUCHE = 3;

/**
 * Speichert das fertige Ergebnis einer Analyse (BUG-2026-10-03-30). Scheitert
 * der Schreibvorgang, wird DERSELBE mit DEMSELBEN Ergebnis wiederholt — die
 * Analyse ist bezahlt und fertig, ein einzelner Datenbankfehler soll sie nicht
 * kosten. Erst nach dem letzten Versuch wirft die Funktion, mit
 * `code: "ergebnis_speichern"`; der Verarbeiter schreibt dann das
 * Ersatz-Ergebnis (ersatzErgebnisSpeichern).
 *
 * Die Warnung je gescheitertem Versuch traegt nur Code und Art des Fehlers:
 * Ein Firestore-Fehlertext kann den Dokumentpfad samt jobId enthalten.
 * @returns {Promise<boolean>} wie completeJob
 */
async function ergebnisSpeichern(jobId, result) {
  const marke = crypto.randomUUID();
  for (let versuch = 1; ; versuch += 1) {
    try {
      return await completeJob(jobId, result, { marke });
    } catch (err) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          step: "process-job",
          warning: "ergebnis-speichern-fehlgeschlagen",
          versuch,
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
      );
      if (versuch >= SPEICHER_VERSUCHE) {
        const fehler = new Error("Ergebnis nicht speicherbar");
        fehler.code = "ergebnis_speichern";
        throw fehler;
      }
    }
  }
}

/**
 * Schreibt das Ersatz-Ergebnis "technischer Fehler", wenn der Verarbeiter
 * unerwartet scheitert — ein sauberes, renderbares Ergebnis statt eines
 * haengenden Auftrags. Das Kind sieht in jedem Fall `blocked.apiError`;
 * `meldeGrund` nennt der Meldung den wahren Grund, wenn es nicht die KI war.
 */
function ersatzErgebnis(job) {
  return {
    profiles: null,
    blockedReason: "blocked.apiError",
    privacyRisks: [],
    exif: (job && job.exif) || {},
    meta: { traceId: (job && job.traceId) || null, mode: "blocked" },
  };
}

async function ersatzErgebnisSpeichern(jobId, job, meldeGrund) {
  return completeJob(jobId, ersatzErgebnis(job), { meldeGrund: meldeGrund || null });
}

/**
 * Markiert einen Job als gescheitert: NUR aus `queued`/`processing` → `failed`.
 *
 * BUG-001: bedingt — ein bereits `done`/`abandoned` Job wird NICHT überschrieben.
 * OPS-2026-10-03-31: Endet der Uebergang mit einem Fehler, wird er einmal
 * wiederholt (mitWiederholung) — kam nur die Bestaetigung nicht an, meldet die
 * Wiederholung.
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function failJob(jobId, reason) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  const errorReason = typeof reason === "string" ? reason.slice(0, 300) : "unknown";
  const gemacht = await mitWiederholung((marke) =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const daten = snap.data();
      if (daten.status === "failed" && daten.abschlussMarke === marke) return true;
      if (daten.status !== "queued" && daten.status !== "processing") return false;
      tx.update(ref, { status: "failed", finishedAt: Date.now(), errorReason, abschlussMarke: marke, gemeldet: false });
      return true;
    })
  );
  if (gemacht) await meldenUndVermerken(ref, reason);
  return gemacht;
}

/**
 * Warteschlangen-Position: Anzahl der Jobs mit Status `queued`, die VOR
 * diesem Job erstellt wurden. 0 = als nächstes dran.
 *
 * Nimmt das bereits geladene Job-Objekt entgegen (der Aufrufer hat es ohnehin
 * schon) — spart einen zusätzlichen Firestore-Read pro Poll.
 *
 * Nutzt eine Firestore-`count()`-Aggregation — liest nicht alle Dokumente,
 * daher auch bei voller Queue günstig. Benötigt den zusammengesetzten Index
 * (status ASC, createdAt ASC) aus firestore.indexes.json.
 *
 * Für Jobs, die nicht (mehr) `queued` sind, gibt die Funktion 0 zurück.
 */
async function getQueuePosition(job) {
  if (!job || job.status !== "queued") return 0;
  const agg = await jobsRef().where("status", "==", "queued").where("createdAt", "<", job.createdAt).count().get();
  return agg.data().count;
}

/**
 * ZWEITE STUFE der Einlassgrenze — exakt, ohne Kollisionen.
 *
 * WARUM ES SIE BRAUCHT (BUG-2026-08-30-14, zweiter Anlauf): Die Vorpruefung im
 * Einlass zaehlt, bevor der Auftrag angelegt ist — bei gleichzeitigem Andrang
 * sehen alle denselben Stand. Eine atomare Reservierung ueber ein
 * Zaehler-Dokument wurde am 30.08. versucht und verworfen: Ein einzelnes
 * Dokument vertraegt nur ungefaehr einen Schreibvorgang pro Sekunde. Bei 170
 * gleichzeitigen Anfragen wirft die Datenbank "ABORTED: Transaction lock
 * timeout" — im Simulator 167 Mal —, und die Notbremse liess alle durch.
 * Gemessen: 177 Wartende bei Grenze 155.
 *
 * DIESE STUFE HAT DAS PROBLEM NICHT. Sie zaehlt nur (Aggregat-Abfrage, keine
 * Sperre) und fragt: Wie viele warten VOR mir? Jeder Auftrag entscheidet fuer
 * sich, und die Antwort ist stabil — die ersten 155 bleiben, alle weiteren
 * nehmen sich selbst zurueck. Kein Wettlauf, weil niemand dasselbe Dokument
 * schreibt.
 *
 * Der Preis: Ein abgewiesener Auftrag wurde kurz angelegt. Das kostet einen
 * Schreib- und einen Loeschvorgang — verschwindend gegen eine Analyse.
 *
 * @returns {Promise<boolean>} true = der Platz ist bestaetigt, false = zu spaet
 */
async function platzBestaetigen(job, grenze) {
  if (typeof grenze !== "number" || !(grenze > 0)) {
    throw new Error("platzBestaetigen: warteschlangeTiefe fehlt");
  }
  if (!job || !job.createdAt) return true;
  const vorMir = await jobsRef().where("status", "==", "queued").where("createdAt", "<", job.createdAt).count().get();
  const position = vorMir.data().count;
  if (position < grenze) return true;
  /* Zu spaet: Der Auftrag wird zurueckgenommen, BEVOR er Kosten verursacht. */
  console.log(JSON.stringify({ step: "platz-bestaetigen", status: "zu-spaet", position, grenze }));
  return false;
}

/**
 * ARCH-001 (Audit 2026-08-10): Wie viele Jobs warten gerade?
 *
 * Seit v2.8 die Parallelität von 10 auf 7 gesenkt wurde, schafft die
 * Warteschlange rund 387 Analysen pro Stunde — der Einlass lässt aber 500 zu.
 * Bei Dauerlast wächst der Rückstau also, und ab etwa 190 Wartenden
 * überschreitet die Wartezeit den 30-Minuten-Deckel des Browsers: Der
 * Teilnehmer sieht einen Timeout, obwohl sein Job noch lebt.
 *
 * Statt das Stundenlimit zu senken (das würde einem großen Workshop mitten im
 * Betrieb den Hahn zudrehen) lehnt der Einlass ab einer Schwelle ehrlich ab.
 * Zählende Abfrage — günstig, unabhängig von der Warteschlangenlänge.
 */
async function countQueuedJobs() {
  const agg = await jobsRef().where("status", "==", "queued").count().get();
  return agg.data().count;
}

/**
 * Prüft, ob ein `processing`-Job über PROCESSING_TIMEOUT_MS hinaus hängt
 * (Worker tot/abgestürzt). Wenn ja, wird er auf `failed` gesetzt.
 *
 * Gibt den (ggf. aktualisierten) Job-Status zurück. Wird vom job-status-
 * Handler beim Pollen aufgerufen, damit kein Client unendlich wartet.
 */
async function markFailedIfStale(job) {
  if (!job || job.status !== "processing") return job;
  const startedAt = job.startedAt || job.createdAt || 0;
  const werte = await betriebswerteOderAbbruch();
  if (Date.now() - startedAt < werte.verarbeitungsZeitlimitMs) return job;
  const failed = await failJob(job.id, "processing_timeout");
  if (failed) {
    /* Der Verarbeiter ist nicht fertig geworden und loescht das Foto nicht mehr
       selbst. Der Aufraeumdienst sucht nur haengende Auftraege und faende diesen
       jetzt nicht mehr — also hier loeschen, sonst laege das Foto bis zur
       2-Stunden-Frist (PRIV-2026-10-03-28). Ein Fehlschlag meldet sich selbst. */
    await deleteImage(job.imagePath);
    return { ...job, status: "failed", errorReason: "processing_timeout" };
  }
  /* BUG-001: failJob hat NICHT gegriffen — der Job ist inzwischen terminal
     (z.B. der Worker hat doch noch `done` geschrieben). Frischen Stand lesen,
     statt fälschlich „failed" zu melden. */
  return (await getJob(job.id)) || job;
}

/* ── Client-Liveness ──────────────────────────────────────────────── */

/**
 * Aktualisiert den Liveness-Herzschlag (`lastSeenAt`) eines Jobs. `job-status`
 * ruft das bei jedem Client-Poll — solange der Browser pollt, gilt der Client
 * als anwesend.
 */
async function touchJob(jobId) {
  await jobsRef().doc(jobId).update({ lastSeenAt: Date.now() });
}

/**
 * Hält den Zeitpunkt der ERSTEN Auslieferung eines fertigen Jobs fest
 * (`deliveredAt`). Diagnose-Messung: trennt „fertig gerechnet" von „tatsächlich
 * beim Client angekommen" — unabhängig von der best-effort Client-Telemetrie.
 * Der job-status-Handler ruft das genau einmal pro Job (Guard dort: nur wenn
 * `deliveredAt` noch nicht gesetzt ist).
 *
 * KA-02 (Kurzaudit 2026-08-12): Mit der Auslieferung wird — im selben
 * Schreibvorgang — der HASH des Realitäts-Check-Einmal-Tickets abgelegt.
 * Das Ticket selbst geht nur an den Browser; die Datenbank kennt nur den
 * Hash und kann daraus kein gültiges Ticket machen.
 */
async function markDelivered(jobId, rcTicketHash) {
  const patch = { deliveredAt: Date.now() };
  if (typeof rcTicketHash === "string" && rcTicketHash.length > 0) {
    patch.rcTicketHash = rcTicketHash;
  }
  /* BUG-2026-10-03-29: An diesem Vermerk haengt die Loeschung des Ergebnisses
     15 Minuten nach der Abholung (findZugestellteJobs). Die Statusabfrage
     wartet ihn deshalb ab, bevor sie antwortet; scheitert er, wird er hier
     einmal wiederholt. Erst der zweite Fehlschlag geht an den Aufrufer. */
  const ref = jobsRef().doc(jobId);
  await ref.update(patch).catch(() => ref.update(patch));
}

/**
 * KA-02: Entwertet ein Realitäts-Check-Einmal-Ticket (per Hash) und meldet,
 * ob es gültig war. Jede echte Analyse gibt bei der ersten Auslieferung genau
 * EIN Ticket aus — damit zählt jede Analyse höchstens eine Stimme, egal wie
 * viele Function-Instanzen laufen (das frühere In-Memory-IP-Limit vervielfacht
 * sich je Instanz und schützt den öffentlichen Vergleichswert nicht).
 *
 * Ablauf: Job per Hash-Gleichheit suchen (automatischer Einzelfeld-Index,
 * kein zusammengesetzter nötig), dann in einer TRANSAKTION erneut lesen und
 * den Hash auf null setzen. Zwei gleichzeitige Einreichungen desselben
 * Tickets können so nie beide zählen: Die zweite Transaktion sieht den Hash
 * nicht mehr. Läuft die 15-Minuten-Löschfrist (PRIV-107b) vorher ab, ist das
 * Dokument weg und das Ticket damit von selbst wertlos.
 */
async function verbraucheRcTicket(rcTicketHash) {
  if (typeof rcTicketHash !== "string" || rcTicketHash.length === 0) return false;
  const snap = await jobsRef().where("rcTicketHash", "==", rcTicketHash).limit(1).get();
  if (snap.empty) return false;
  const ref = snap.docs[0].ref;
  const db = datenbank();
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().rcTicketHash !== rcTicketHash) return false;
    /* null statt FieldValue.delete(): Zeitstempel/Werte sind in dieser Datei
       bewusst plain (s. Datei-Kopf), und die Gleichheits-Suche oben findet
       ein null-Feld nie wieder — entwertet ist entwertet. */
    tx.update(ref, { rcTicketHash: null });
    return true;
  });
}

/**
 * v3.0 Phase 1 (+Phase 3): Legt die bereits angekommenen Live-Profiltexte
 * ins Job-Dokument.
 *
 * Der Worker ruft das waehrend jedes laufenden Mistral-Streams mit
 * `{ standard, beast }` auf (fest seit 10.09.2026), der job-status-Handler gibt die
 * Felder bei `processing` an den Client weiter. Die Feldnamen bleiben
 * abwaertskompatibel: `liveText` traegt weiter den Standard-Text, der
 * Beast-Text kommt ZUSAETZLICH als `liveTextBeast` dazu; `liveTextStand`
 * gilt gemeinsam fuer beide. Solange Beast noch nicht begonnen hat
 * (`beast === null`), bleibt das Feld dem Dokument bewusst fern — der
 * Client zeigt dann seinen Warte-Status.
 *
 * 4000 Zeichen Deckel JE FELD: Ein kompletter Profiltext liegt real bei
 * wenigen hundert Zeichen — die Grenze schuetzt das Dokument nur vor einem
 * amoklaufenden Modell (Firestore-Dokumente sind auf 1 MiB begrenzt, und
 * `result` muss spaeter auch noch hinein).
 *
 * Fehler werden STILL geschluckt: Eine verpasste Live-Welle darf nie etwas
 * kaputt machen — der naechste Schreibversuch kommt ohnehin in ~2 Sekunden,
 * und das eigentliche Ergebnis liefert completeJob unabhaengig davon. Auch
 * kein console.log je Welle: Bei ~1100 Chunks pro Analyse waere selbst ein
 * sparsames Fehler-Log nur Rauschen in Cloud Logging.
 */
async function setLiveText(jobId, texte) {
  try {
    /* Abwaertskompatibel: ein nackter String (alter Aufrufstil) zaehlt als
       Standard-Text ohne Beast. */
    const eingabe = typeof texte === "string" ? { standard: texte } : texte || {};
    /* Neuversuch nach einem Verbindungsabriss (01.10.2026, mistral.js): JEDE
       Welle traegt ihren Versuch. Eine verspaetet ankommende Welle des ersten
       Versuchs setzt ihn damit auf 1 zurueck, und der Browser verwirft sie,
       statt alten Text als neuen zu zeigen. Ab dem zweiten Versuch ist jede
       Welle der GANZE Stand: Beast-Text und Karten der verworfenen Antwort
       werden geleert, solange der neue Versuch keine eigenen liefert. */
    const versuch = Number.isInteger(eingabe.versuch) && eingabe.versuch > 1 ? eingabe.versuch : 1;
    const patch = {
      liveText: String(eingabe.standard || "").slice(0, 4000),
      liveTextStand: Date.now(),
      liveTextVersuch: versuch,
    };
    if (versuch > 1) Object.assign(patch, { liveTextBeast: null, liveKartenStandard: null, liveKartenBeast: null });
    if (typeof eingabe.beast === "string") {
      patch.liveTextBeast = eingabe.beast.slice(0, 4000);
    }
    /* FEATURE-2026-08-29-01: Fertige Kategorie-Karten mitschreiben, damit der
       Bildschirm nicht stillsteht, waehrend sie entstehen. Beide Grenzen sind
       Absicherung gegen ein aufgeblaehtes Job-Dokument, nicht Sparsamkeit:
       13 Karten sind das Maximum laut Schema, 400 Zeichen decken die im Prompt
       verlangten 20-30 Woerter mit Reserve. */
    for (const [feld, quelle] of [
      ["liveKartenStandard", eingabe.kartenStandard],
      ["liveKartenBeast", eingabe.kartenBeast],
    ]) {
      if (!Array.isArray(quelle)) continue;
      patch[feld] = quelle.slice(0, 13).map((k) => ({
        schluessel: String(k.schluessel || "").slice(0, 40),
        bezeichnung: String(k.bezeichnung || "").slice(0, 80),
        wert: String(k.wert || "").slice(0, 400),
      }));
    }
    await jobsRef().doc(jobId).update(patch);
  } catch (_) {
    /* still — siehe Funktionskommentar */
  }
}

/**
 * Markiert einen Job als `abandoned` — der Client hat die Seite verlassen,
 * bevor der Job verarbeitet wurde. Kein Fehler, sondern ein bewusst
 * eingesparter Lauf (kein Mistral-Call).
 */
async function abandonJob(jobId) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    /* BUG-001: nur einen noch `queued` Job verlassen — ein inzwischen in
       Verarbeitung gegangener (oder fertiger) Job wird NICHT abgewürgt. */
    if (!snap.exists || snap.data().status !== "queued") return false;
    tx.update(ref, { status: "abandoned", finishedAt: Date.now() });
    return true;
  });
}

/**
 * Prüft, ob ein noch wartender Job als verlassen gilt: Status `queued` und
 * seit über LIVENESS_GRACE_MS kein Client-Poll mehr.
 */
/* Die Gnadenfrist kommt seit 30.08.2026 aus dem Einstellungssatz und wird
   hereingereicht — diese Funktion bleibt synchron, weil sie in Schleifen ueber
   viele Jobs laeuft. Fehlt der Wert, gilt die Konstante: Eine Aufraeum-Frist
   darf nie fehlen, sonst blieben verwaiste Jobs ewig liegen. */
function isAbandoned(job, gnadenfristMs) {
  /* Die Frist ist Pflicht. Frueher stand hier ein Rueckfall auf eine Konstante
     — damit gab es dieselbe Zahl an zwei Orten, und welche galt, hing vom
     Aufrufweg ab. */
  if (typeof gnadenfristMs !== "number" || !(gnadenfristMs > 0)) {
    throw new Error("isAbandoned: livenessGnadenfristMs fehlt");
  }
  const frist = gnadenfristMs;
  if (!job || job.status !== "queued") return false;
  return Date.now() - (job.lastSeenAt || job.createdAt || 0) > frist;
}

/**
 * Zählt die Jobs im Status `processing`. Prozess-übergreifende Wahrheit für
 * die Drosselung des lokalen Cloud-Tasks-Ersatzes (siehe handle-process-job).
 */
async function countProcessingJobs() {
  const agg = await jobsRef().where("status", "==", "processing").count().get();
  return agg.data().count;
}

/**
 * Liefert wartende Jobs, deren Client-Herzschlag älter als das Karenz-Fenster
 * ist — die Arbeitsliste des Reapers. `limit` deckelt die Batch-Größe pro
 * Lauf. Benötigt den zusammengesetzten Index (status, lastSeenAt).
 */
async function findAbandonedJobs(limit) {
  const werte = await betriebswerteOderAbbruch();
  const cutoff = Date.now() - werte.livenessGnadenfristMs;
  limit = limit || werte.aufraeumStapel;
  const snap = await jobsRef().where("status", "==", "queued").where("lastSeenAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* SEC-003 (Audit 2026-08-10): Obergrenze, wie lange ein Job allein durch
   Pollen am Leben gehalten werden kann.

   Jeder Poll erneuert `lastSeenAt` — wer also einfach weiterfragt, haelt seinen
   Job unbegrenzt in der Warteschlange und blockiert damit einen Platz im
   Stundenfenster. Das ist der billigste Hebel, den Dienst fuer eine Schulklasse
   unbrauchbar zu machen: 500 Mini-Uploads anlegen, danach im Takt pollen, und
   der Reaper gibt nie einen Platz zurueck.

   Eine ehrliche Wartezeit liegt bei wenigen Minuten; der Browser gibt nach
   30 Minuten ohnehin auf. Alles darueber ist kein wartender Nutzer mehr. */

async function findUeberfaelligeJobs(limit) {
  const werte = await betriebswerteOderAbbruch();
  const cutoff = Date.now() - werte.wartendesHoechstalterMs;
  limit = limit || werte.aufraeumStapel;
  const snap = await jobsRef().where("status", "==", "queued").where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Liefert Jobs, die über PROCESSING_TIMEOUT_MS hinaus in `processing` hängen
 * (Worker abgestürzt, niemand pollt mehr → `markFailedIfStale` greift nie).
 * Arbeitsliste des Reapers, damit solche Dokumente nicht ewig liegen bleiben.
 * Benötigt den zusammengesetzten Index (status, startedAt).
 */
async function findStaleProcessingJobs(limit) {
  const werte = await betriebswerteOderAbbruch();
  const cutoff = Date.now() - werte.verarbeitungsZeitlimitMs;
  limit = limit || werte.aufraeumStapel;
  const snap = await jobsRef().where("status", "==", "processing").where("startedAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Liefert Job-Dokumente, die älter als JOB_RETENTION_MS sind — egal welchen
 * Status. Arbeitsliste des Reapers für die Datensparsamkeits-Aufräumung; ein
 * derart altes Dokument ist in jedem Status fertig (ein realer Job lebt
 * Sekunden bis Minuten). Einfache Ungleichheit auf `createdAt`, daher vom
 * automatischen Einzelfeld-Index abgedeckt — kein zusammengesetzter Index.
 */
async function findExpiredJobs(limit) {
  const { fristMs, stapel } = await loeschfrist("jobAufbewahrungMs");
  const cutoff = Date.now() - fristMs;
  limit = limit || stapel;
  const snap = await jobsRef().where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * PRIV-107b: Liefert zugestellte Jobs, deren Browser-Wiederholungs-Fenster
 * abgelaufen ist (`deliveredAt` älter als ZUSTELLUNG_AUFBEWAHRUNG_MS). Das
 * Dokument hat ab da keinen Zweck mehr — der Browser zeigt das Ergebnis
 * ohnehin nicht mehr an. Die Ungleichheits-Abfrage überspringt Dokumente
 * ohne `deliveredAt` (nie zugestellt) von selbst.
 */
async function findZugestellteJobs(limit) {
  const { fristMs, stapel } = await loeschfrist("zustellfensterMs");
  const cutoff = Date.now() - fristMs;
  limit = limit || stapel;
  const snap = await jobsRef().where("deliveredAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Löscht ein Job-Dokument endgültig.
 */
async function deleteJob(jobId) {
  await jobsRef().doc(jobId).delete();
}

module.exports = {
  platzBestaetigen,
  createJob,
  getJob,
  claimJob,
  completeJob,
  ergebnisSpeichern,
  ersatzErgebnis,
  ersatzErgebnisSpeichern,
  failJob,
  getQueuePosition,
  countQueuedJobs,
  markFailedIfStale,
  touchJob,
  markDelivered,
  verbraucheRcTicket,
  setLiveText,
  meldeGescheiterteAnalyse,
  nachmeldenBeimLoeschen,
  abandonJob,
  isAbandoned,
  findAbandonedJobs,
  findUeberfaelligeJobs,
  findStaleProcessingJobs,
  findExpiredJobs,
  findZugestellteJobs,
  deleteJob,
  countProcessingJobs,
};
