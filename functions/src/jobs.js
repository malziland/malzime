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

const { datenbank } = require("./db");
const { LIVENESS_GRACE_MS, JOB_RETENTION_MS } = require("./config");

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
const PROCESSING_TIMEOUT_MS = 9 * 60 * 1000;

function jobsRef() {
  return datenbank().collection(JOBS_COLLECTION);
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
 */
async function createJob({ lang, traceId, imagePath, exif, resultToken }) {
  const ref = jobsRef().doc();
  const now = Date.now();
  await ref.set({
    status: "queued",
    createdAt: now,
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
    result: null,
    errorReason: null,
    attempts: 0,
  });
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
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function completeJob(jobId, result) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== "processing") return false;
    tx.update(ref, { status: "done", finishedAt: Date.now(), result: result || null, errorReason: null });
    return true;
  });
}

/**
 * Markiert einen Job als gescheitert: NUR aus `queued`/`processing` → `failed`.
 *
 * BUG-001: bedingt — ein bereits `done`/`abandoned` Job wird NICHT überschrieben.
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function failJob(jobId, reason) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const st = snap.data().status;
    if (st !== "queued" && st !== "processing") return false;
    tx.update(ref, {
      status: "failed",
      finishedAt: Date.now(),
      errorReason: typeof reason === "string" ? reason.slice(0, 300) : "unknown",
    });
    return true;
  });
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
  if (Date.now() - startedAt < PROCESSING_TIMEOUT_MS) return job;
  const failed = await failJob(job.id, "processing_timeout");
  if (failed) return { ...job, status: "failed", errorReason: "processing_timeout" };
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
 */
async function markDelivered(jobId) {
  await jobsRef().doc(jobId).update({ deliveredAt: Date.now() });
}

/**
 * v3.0 Phase 1: Legt den bereits angekommenen Live-Profiltext ins Job-Dokument.
 *
 * Der Worker ruft das waehrend eines laufenden Mistral-Streams (Flag
 * `useLiveText`), der job-status-Handler gibt die Felder bei `processing`
 * an den Client weiter. 4000 Zeichen Deckel: Der komplette Standard-
 * Profiltext liegt real bei wenigen hundert Zeichen — die Grenze schuetzt
 * das Dokument nur vor einem amoklaufenden Modell (Firestore-Dokumente sind
 * auf 1 MiB begrenzt, und `result` muss spaeter auch noch hinein).
 *
 * Fehler werden STILL geschluckt: Eine verpasste Live-Welle darf nie etwas
 * kaputt machen — der naechste Schreibversuch kommt ohnehin in ~2 Sekunden,
 * und das eigentliche Ergebnis liefert completeJob unabhaengig davon. Auch
 * kein console.log je Welle: Bei ~1100 Chunks pro Analyse waere selbst ein
 * sparsames Fehler-Log nur Rauschen in Cloud Logging.
 */
async function setLiveText(jobId, text) {
  try {
    await jobsRef()
      .doc(jobId)
      .update({
        liveText: String(text || "").slice(0, 4000),
        liveTextStand: Date.now(),
      });
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
function isAbandoned(job) {
  if (!job || job.status !== "queued") return false;
  return Date.now() - (job.lastSeenAt || job.createdAt || 0) > LIVENESS_GRACE_MS;
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
async function findAbandonedJobs(limit = 200) {
  const cutoff = Date.now() - LIVENESS_GRACE_MS;
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
const MAX_QUEUED_AGE_MS = 35 * 60 * 1000;

async function findUeberfaelligeJobs(limit = 200) {
  const cutoff = Date.now() - MAX_QUEUED_AGE_MS;
  const snap = await jobsRef().where("status", "==", "queued").where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Liefert Jobs, die über PROCESSING_TIMEOUT_MS hinaus in `processing` hängen
 * (Worker abgestürzt, niemand pollt mehr → `markFailedIfStale` greift nie).
 * Arbeitsliste des Reapers, damit solche Dokumente nicht ewig liegen bleiben.
 * Benötigt den zusammengesetzten Index (status, startedAt).
 */
async function findStaleProcessingJobs(limit = 200) {
  const cutoff = Date.now() - PROCESSING_TIMEOUT_MS;
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
async function findExpiredJobs(limit = 200) {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  const snap = await jobsRef().where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Löscht ein Job-Dokument endgültig.
 */
async function deleteJob(jobId) {
  await jobsRef().doc(jobId).delete();
}

module.exports = {
  JOBS_COLLECTION,
  PROCESSING_TIMEOUT_MS,
  createJob,
  getJob,
  claimJob,
  completeJob,
  failJob,
  getQueuePosition,
  countQueuedJobs,
  markFailedIfStale,
  touchJob,
  markDelivered,
  setLiveText,
  abandonJob,
  isAbandoned,
  findAbandonedJobs,
  findUeberfaelligeJobs,
  MAX_QUEUED_AGE_MS,
  findStaleProcessingJobs,
  findExpiredJobs,
  deleteJob,
  countProcessingJobs,
};
