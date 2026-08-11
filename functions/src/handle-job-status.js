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
const { getJob, getQueuePosition, markFailedIfStale, touchJob, markDelivered } = require("./jobs");
const { safeCompare } = require("./auth");

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
  /* PRIV-003: Abhol-Ticket fürs Ergebnis (vom enqueue an genau diesen Browser
     ausgegeben). Status/Position bleiben ohne Ticket abrufbar; nur das fertige
     `result` ist an das Ticket gebunden. */
  const token = req.query && typeof req.query.token === "string" ? req.query.token : "";

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
    const antwort = {
      status: "processing",
      position: 0,
      etaSeconds: QUEUE_AVG_JOB_SECONDS,
    };
    /* v3.0 Phase 1: Der bereits angekommene Live-Profiltext, falls der Worker
       ihn (Flag `useLiveText`) ins Job-Dokument gelegt hat. Er ist ein
       Vorgriff auf das `result` und unterliegt deshalb DEMSELBEN
       PRIV-003-Abhol-Ticket wie das fertige Ergebnis — der Client schickt
       das Ticket ohnehin bei jedem Poll mit. Ohne Live-Text (Flag aus,
       Analyse vor der ersten Welle) ist die Antwort byte-gleich zu heute. */
    if (typeof job.liveText === "string" && job.resultToken && safeCompare(token, job.resultToken)) {
      antwort.liveText = job.liveText;
      antwort.liveTextStand = typeof job.liveTextStand === "number" ? job.liveTextStand : null;
      /* v3.0 Phase 3: Der Beast-Text, sobald das Modell ihn schreibt —
         BEWUSST im selben Ticket-Block: dieselbe PRIV-003-Bindung, kein
         zweiter Pruefpfad. Solange Beast fehlt, fehlt auch das Feld. */
      if (typeof job.liveTextBeast === "string") {
        antwort.liveTextBeast = job.liveTextBeast;
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
       Tab) loggen nicht erneut. Der Schreibvorgang läuft nebenläufig — er darf
       die Antwort an den wartenden Client nicht verzögern. */
    if (!job.deliveredAt) {
      const now = Date.now();
      markDelivered(job.id).catch((err) =>
        console.log(JSON.stringify({ warning: "markDelivered-error", jobId: job.id, error: err.message }))
      );
      console.log(
        JSON.stringify({
          step: "job-delivered",
          jobId: job.id,
          traceId: job.traceId || null,
          deliveryGapMs: typeof job.finishedAt === "number" ? now - job.finishedAt : null,
          totalMs: typeof job.createdAt === "number" ? now - job.createdAt : null,
        })
      );
    }
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
