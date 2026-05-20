"use strict";

/**
 * handle-reap.js — Reaper für hängengebliebene Queue-Jobs (v2.0).
 *
 * Läuft als geplante Function im Minutentakt und räumt zwei Sorten auf:
 *
 *  1. Verlassene wartende Jobs — Status `queued`, aber der Client-Herzschlag
 *     (`lastSeenAt`) ist älter als das Karenz-Fenster: Der Browser pollt nicht
 *     mehr, der Nutzer hat die Seite verlassen. → `abandoned`. Damit wird kein
 *     Mistral-Call mehr für ein Ergebnis verbraucht, das niemand abholt, und
 *     der Warteschlangen-Platz wird für andere frei.
 *
 *  2. Hängende Jobs — Status `processing` über dem Verarbeitungs-Timeout
 *     (Worker abgestürzt). `markFailedIfStale` greift nur, wenn ein Client
 *     pollt; pollt keiner mehr, bliebe das Dokument ewig liegen. → `failed`.
 *
 * Das zwischengespeicherte Bild wird jeweils mitgelöscht (die GCS-Lifecycle-
 * Regel bleibt nur das Sicherheitsnetz).
 *
 * Solange die Queue dormant ist (Feature-Flag `useQueue` AUS), gibt es keine
 * Jobs — der Lauf ist dann ein leerer, vernachlässigbar günstiger Query.
 */

const { findAbandonedJobs, findStaleProcessingJobs, abandonJob, failJob } = require("./jobs");
const { deleteImage } = require("./queue-storage");

/* Obergrenze der Jobs, die ein einzelner Lauf je Sorte abräumt — verhindert,
   dass ein extremer Rückstau einen Lauf überlange macht. Der nächste Lauf
   (1 min später) nimmt den Rest. */
const REAP_BATCH_LIMIT = 200;

async function reapJobs() {
  /* (1) Verlassene wartende Jobs → abandoned. */
  const abandoned = await findAbandonedJobs(REAP_BATCH_LIMIT);
  let reapedAbandoned = 0;
  for (const job of abandoned) {
    try {
      await abandonJob(job.id);
      await deleteImage(job.imagePath);
      reapedAbandoned += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "abandon-failed", error: err.message }));
    }
  }

  /* (2) In `processing` hängende Jobs → failed. */
  const stale = await findStaleProcessingJobs(REAP_BATCH_LIMIT);
  let reapedStale = 0;
  for (const job of stale) {
    try {
      await failJob(job.id, "processing_timeout");
      await deleteImage(job.imagePath);
      reapedStale += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "fail-stale-failed", error: err.message }));
    }
  }

  console.log(JSON.stringify({ step: "reap", abandoned: reapedAbandoned, staleProcessing: reapedStale }));
  return { abandoned: reapedAbandoned, staleProcessing: reapedStale };
}

module.exports = { reapJobs };
