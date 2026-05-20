"use strict";

/**
 * handle-reap.js — Reaper für verlassene Queue-Jobs (v2.0).
 *
 * Läuft als geplante Function im Minutentakt. Findet wartende Jobs, deren
 * Client-Herzschlag (`lastSeenAt`) älter als das Karenz-Fenster ist — der
 * Browser pollt nicht mehr, der Nutzer hat die Seite verlassen — und setzt
 * sie auf `abandoned`. Damit:
 *  - wird kein Mistral-Call mehr für einen Job verbraucht, auf dessen
 *    Ergebnis niemand mehr wartet,
 *  - fällt der Job aus der Warteschlangen-Zählung → alle dahinter rücken
 *    nach, die ETA der Wartenden sinkt.
 *
 * Das zwischengespeicherte Bild wird gleich mitgelöscht (die GCS-Lifecycle-
 * Regel bleibt nur das Sicherheitsnetz).
 *
 * Solange die Queue dormant ist (Feature-Flag `useQueue` AUS), gibt es keine
 * Jobs — der Lauf ist dann ein leerer, vernachlässigbar günstiger Query.
 *
 * Hinweis: Der Reaper ist nur die proaktive Aufräumung für die zügige
 * Nachrück-Wirkung. `process-job` prüft die Liveness zusätzlich selbst, bevor
 * es Mistral aufruft — ein Job, den der Reaper noch nicht erwischt hat, wird
 * dort ebenfalls abgefangen.
 */

const { findAbandonedJobs, abandonJob } = require("./jobs");
const { deleteImage } = require("./queue-storage");

/* Obergrenze der Jobs, die ein einzelner Lauf abräumt — verhindert, dass ein
   extremer Rückstau einen Lauf überlange macht. Der nächste Lauf (1 min
   später) nimmt den Rest. */
const REAP_BATCH_LIMIT = 200;

async function reapAbandonedJobs() {
  const stale = await findAbandonedJobs(REAP_BATCH_LIMIT);
  let reaped = 0;
  for (const job of stale) {
    try {
      await abandonJob(job.id);
      await deleteImage(job.imagePath);
      reaped += 1;
    } catch (err) {
      /* Ein einzelner fehlschlagender Job darf den Lauf nicht killen — der
         nächste Minutenlauf nimmt ihn erneut. */
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "reap-failed", error: err.message }));
    }
  }
  console.log(JSON.stringify({ step: "reap", scanned: stale.length, reaped }));
  return { scanned: stale.length, reaped };
}

module.exports = { reapAbandonedJobs };
