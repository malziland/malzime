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

const { getFirestore } = require("firebase-admin/firestore");
const { LIVENESS_GRACE_MS } = require("./config");

const JOBS_COLLECTION = "jobs";

/* Ein Job, der länger als das hier in `processing` hängt, gilt als verloren
   (Worker abgestürzt o.ä.) und wird von `markFailedIfStale` auf `failed`
   gesetzt, damit kein Client ewig pollt. Großzügig über dem Cloud-Function-
   Timeout (540s) angesetzt. */
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

function jobsRef() {
  return getFirestore().collection(JOBS_COLLECTION);
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
async function createJob({ lang, traceId, imagePath, exif }) {
  const ref = jobsRef().doc();
  const now = Date.now();
  await ref.set({
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    lang: lang || "de",
    traceId: traceId || null,
    imagePath: imagePath || null,
    exif: exif && typeof exif === "object" ? exif : {},
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
  const db = getFirestore();
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
 * Schließt einen Job erfolgreich ab: `processing` → `done` mit Ergebnis.
 */
async function completeJob(jobId, result) {
  await jobsRef()
    .doc(jobId)
    .update({
      status: "done",
      finishedAt: Date.now(),
      result: result || null,
      errorReason: null,
    });
}

/**
 * Markiert einen Job als gescheitert: → `failed` mit Grund.
 */
async function failJob(jobId, reason) {
  await jobsRef()
    .doc(jobId)
    .update({
      status: "failed",
      finishedAt: Date.now(),
      errorReason: typeof reason === "string" ? reason.slice(0, 300) : "unknown",
    });
}

/**
 * Warteschlangen-Position: Anzahl der Jobs mit Status `queued`, die VOR
 * diesem Job erstellt wurden. 0 = als nächstes dran.
 *
 * Nutzt eine Firestore-`count()`-Aggregation — liest nicht alle Dokumente,
 * daher auch bei voller Queue günstig. Benötigt den zusammengesetzten Index
 * (status ASC, createdAt ASC) aus firestore.indexes.json.
 *
 * Für Jobs, die nicht (mehr) `queued` sind, gibt die Funktion 0 zurück.
 */
async function getQueuePosition(jobId) {
  const job = await getJob(jobId);
  if (!job || job.status !== "queued") return 0;
  const agg = await jobsRef().where("status", "==", "queued").where("createdAt", "<", job.createdAt).count().get();
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
  await failJob(job.id, "processing_timeout");
  return { ...job, status: "failed", errorReason: "processing_timeout" };
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
 * Markiert einen Job als `abandoned` — der Client hat die Seite verlassen,
 * bevor der Job verarbeitet wurde. Kein Fehler, sondern ein bewusst
 * eingesparter Lauf (kein Mistral-Call).
 */
async function abandonJob(jobId) {
  await jobsRef().doc(jobId).update({
    status: "abandoned",
    finishedAt: Date.now(),
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
 * Liefert wartende Jobs, deren Client-Herzschlag älter als das Karenz-Fenster
 * ist — die Arbeitsliste des Reapers. `limit` deckelt die Batch-Größe pro
 * Lauf. Benötigt den zusammengesetzten Index (status, lastSeenAt).
 */
async function findAbandonedJobs(limit = 200) {
  const cutoff = Date.now() - LIVENESS_GRACE_MS;
  const snap = await jobsRef().where("status", "==", "queued").where("lastSeenAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  markFailedIfStale,
  touchJob,
  abandonJob,
  isAbandoned,
  findAbandonedJobs,
};
