"use strict";

/**
 * handle-reap.js — Reaper für hängengebliebene Queue-Jobs (v2.0).
 *
 * Läuft als geplante Function im Minutentakt und räumt drei Sorten auf:
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
 *  3. Abgelaufene Job-Dokumente — älter als JOB_RETENTION_MS. Das Dokument
 *     wird endgültig gelöscht (Datensparsamkeit: das fertige Profil im Feld
 *     `result` soll nicht unbegrenzt liegen bleiben).
 *
 * Bei (1) und (2) wird das zwischengespeicherte Bild mitgelöscht (die GCS-
 * Lifecycle-Regel bleibt nur das Sicherheitsnetz).
 *
 * Ist die Queue per Flag deaktiviert (`useQueue` = false, Rückfall auf den
 * synchronen /analyze-Pfad), gibt es keine Jobs — der Lauf ist dann ein
 * leerer, vernachlässigbar günstiger Query.
 */

const {
  findAbandonedJobs,
  findStaleProcessingJobs,
  findExpiredJobs,
  abandonJob,
  failJob,
  deleteJob,
} = require("./jobs");
const { deleteImage } = require("./queue-storage");
const { releaseHourlySlot } = require("./counter");

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
      const ok = await abandonJob(job.id);
      /* Schlug der Übergang fehl, hat ein Worker den Job zwischen Query und
         Abbruch geclaimt — er läuft noch und braucht das Bild: nichts anfassen. */
      if (!ok) continue;
      /* BIZ-001: Stunden-Slot zurückgeben — verlassener Job machte nie eine Analyse. */
      await releaseHourlySlot();
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

  /* (3) Abgelaufene Job-Dokumente → gelöscht. */
  const expired = await findExpiredJobs(REAP_BATCH_LIMIT);
  let reapedExpired = 0;
  for (const job of expired) {
    try {
      await deleteJob(job.id);
      reapedExpired += 1;
    } catch (err) {
      console.log(
        JSON.stringify({ step: "reap", jobId: job.id, warning: "delete-expired-failed", error: err.message })
      );
    }
  }

  console.log(
    JSON.stringify({ step: "reap", abandoned: reapedAbandoned, staleProcessing: reapedStale, expired: reapedExpired })
  );
  return { abandoned: reapedAbandoned, staleProcessing: reapedStale, expired: reapedExpired };
}

module.exports = { reapJobs };
