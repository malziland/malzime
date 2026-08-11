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
 *  2c. PRIV-107b: Zugestellte Ergebnisse nach Ablauf des Browser-
 *     Wiederholungs-Fensters (15 min ab Erstzustellung) — das Dokument hat
 *     ab da keinen Zweck mehr, der Browser zeigt das Ergebnis ohnehin nicht
 *     mehr an. Vorher deckelte nur Zweig (3) mit 2 h.
 *
 *  3. Abgelaufene Job-Dokumente — älter als JOB_RETENTION_MS. Das Dokument
 *     wird endgültig gelöscht (Datensparsamkeit: das fertige Profil im Feld
 *     `result` soll nicht unbegrenzt liegen bleiben).
 *
 * Bei (1) und (2) wird das zwischengespeicherte Bild mitgelöscht (die GCS-
 * Lifecycle-Regel bleibt nur das Sicherheitsnetz).
 *
 */

const {
  findAbandonedJobs,
  findUeberfaelligeJobs,
  findStaleProcessingJobs,
  findExpiredJobs,
  findZugestellteJobs,
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

  /* (2b) SEC-003: Jobs, die nur noch durch Pollen am Leben gehalten werden.
     Jeder Poll erneuert `lastSeenAt`, deshalb sieht Zweig (1) sie nie. Ohne
     diese Grenze kann jemand 500 Mini-Uploads anlegen, im Takt weiterfragen und
     damit das komplette Stundenfenster dauerhaft blockieren — ohne dass je ein
     Platz zurueckkommt. Nach 35 Minuten wartet niemand mehr ernsthaft; der
     Browser gibt bereits nach 30 auf. */
  const ueberfaellig = await findUeberfaelligeJobs(REAP_BATCH_LIMIT);
  let reapedUeberfaellig = 0;
  for (const job of ueberfaellig) {
    try {
      const ok = await abandonJob(job.id);
      if (!ok) continue;
      await releaseHourlySlot();
      await deleteImage(job.imagePath);
      reapedUeberfaellig += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "overdue-failed", error: err.message }));
    }
  }

  /* (2c) PRIV-107b: Zugestellte Ergebnisse nach dem Browser-Wiederholungs-
     Fenster löschen — Bild zuerst (BUG-002-Regel), defensiv: normal ist es
     nach der Analyse längst weg. */
  const zugestellt = await findZugestellteJobs(REAP_BATCH_LIMIT);
  let reapedZugestellt = 0;
  for (const job of zugestellt) {
    try {
      if (job.imagePath) await deleteImage(job.imagePath);
      await deleteJob(job.id);
      reapedZugestellt += 1;
    } catch (err) {
      console.log(
        JSON.stringify({ step: "reap", jobId: job.id, warning: "delete-delivered-failed", error: err.message })
      );
    }
  }

  /* (3) Abgelaufene Job-Dokumente → gelöscht. */
  const expired = await findExpiredJobs(REAP_BATCH_LIMIT);
  let reapedExpired = 0;
  for (const job of expired) {
    try {
      /* BUG-002 (Audit 2026-08-10): Zuerst das Bild, dann das Dokument.
         Mit dem Dokument verschwindet `imagePath` — danach kennt niemand mehr
         den Pfad, und ein Bild, das ein anderer Pfad liegen gelassen hat,
         waere endgueltig verwaist. Dieser Zweig sieht JEDEN abgelaufenen Job
         unabhaengig vom Status und ist damit die einzige Stelle, die jede
         denkbare Waise erwischt: Stirbt der Worker hart, kippt der erste
         Client-Poll den Job ueber `markFailedIfStale` auf `failed` — ohne
         Loeschung — und Zweig (2) sucht nur nach `processing`, findet ihn also
         nie wieder. Deckelt die Verweildauer auf 2 h statt auf die
         Lifecycle-Regel (1 Tag). */
      if (job.imagePath) await deleteImage(job.imagePath);
      await deleteJob(job.id);
      reapedExpired += 1;
    } catch (err) {
      console.log(
        JSON.stringify({ step: "reap", jobId: job.id, warning: "delete-expired-failed", error: err.message })
      );
    }
  }

  console.log(
    JSON.stringify({
      step: "reap",
      abandoned: reapedAbandoned,
      staleProcessing: reapedStale,
      expired: reapedExpired,
      ueberfaellig: reapedUeberfaellig,
      zugestellt: reapedZugestellt,
    })
  );
  return {
    abandoned: reapedAbandoned,
    staleProcessing: reapedStale,
    expired: reapedExpired,
    ueberfaellig: reapedUeberfaellig,
    zugestellt: reapedZugestellt,
  };
}

module.exports = { reapJobs };
