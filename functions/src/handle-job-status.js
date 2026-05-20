"use strict";

/**
 * handle-job-status.js — GET /job-status?jobId=… (Queue-Architektur v2.0).
 *
 * Leichtgewichtiger Polling-Endpoint. Der Client fragt hier im Sekundentakt
 * den Stand seines Jobs ab und erhält: Status, Warteschlangen-Position,
 * grobe ETA und — sobald fertig — das Ergebnis.
 *
 * Kein IP-Rate-Limit: Der Endpoint wird konstruktionsbedingt im 2-Sekunden-
 * Takt gepollt; der Upload-Rate-Limiter (für /enqueue) würde legitime
 * Workshop-Klassen hinter einer geteilten Schul-IP sofort aussperren. Schutz
 * stattdessen: Die jobId ist eine zufällige, praktisch nicht erratbare
 * Firestore-ID, und der teure Einstieg (/enqueue) ist sehr wohl limitiert.
 * Ein Poll löst nur einen günstigen Firestore-Read aus.
 */

const { QUEUE_AVG_JOB_SECONDS, QUEUE_DISPATCH_CONCURRENCY } = require("./config");
const { getJob, getQueuePosition, markFailedIfStale, touchJob } = require("./jobs");

/* Grobe Wartezeit-Schätzung aus der Warteschlangen-Position.
   Kalibrierung der Konstanten erfolgt in Phase 3/4 (config.js). */
function etaForPosition(position) {
  return Math.ceil(position / QUEUE_DISPATCH_CONCURRENCY) * QUEUE_AVG_JOB_SECONDS;
}

async function handleJobStatus(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const jobId = req.query && typeof req.query.jobId === "string" ? req.query.jobId : "";
  if (!jobId) {
    res.status(400).json({ error: "Missing jobId" });
    return;
  }

  let job = await getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  /* Hängt der Job zu lange in `processing` (Worker abgestürzt o.ä.), hier
     auf `failed` kippen — damit der pollende Client nicht ewig wartet. */
  if (job.status === "processing") {
    job = await markFailedIfStale(job);
  }

  if (job.status === "queued") {
    /* Liveness-Herzschlag: Dieser Poll belegt, dass der Client noch da ist. */
    await touchJob(jobId);
    const position = await getQueuePosition(job);
    res.status(200).json({
      status: "queued",
      position,
      etaSeconds: etaForPosition(position),
    });
    return;
  }

  if (job.status === "processing") {
    res.status(200).json({
      status: "processing",
      position: 0,
      etaSeconds: QUEUE_AVG_JOB_SECONDS,
    });
    return;
  }

  if (job.status === "done") {
    res.status(200).json({
      status: "done",
      result: job.result || null,
    });
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

module.exports = { handleJobStatus };
