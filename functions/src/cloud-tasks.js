"use strict";

/**
 * cloud-tasks.js — dünner Wrapper um Google Cloud Tasks.
 *
 * Reiht Analyse-Jobs in die Queue `analyze-queue` ein. Cloud Tasks dispatcht
 * sie anschließend dosiert an die `processJob`-Function. Die Dosier-Parameter
 * (`maxConcurrentDispatches`, `maxDispatchesPerSecond`) stehen in der
 * Queue-Definition selbst — sie werden bei der Queue-Erstellung gesetzt,
 * NICHT hier im Code. Genau diese Drossel verhindert die 429er strukturell:
 * Mistral sieht nie mehr als N parallele Calls.
 *
 * Authentifizierung: Jeder Task trägt ein OIDC-Token eines Service-Accounts.
 * `processJob` akzeptiert nur Aufrufe mit gültigem Token — damit ist der
 * Worker nicht öffentlich anstoßbar.
 *
 * Der CloudTasksClient wird lazy erzeugt (erst beim ersten Einreihen) und
 * ist über `setClientForTest()` für Unit-Tests ersetzbar — so braucht kein
 * Test echte GCP-Credentials.
 */

const { QUEUE_NAME, QUEUE_REGION, PROCESS_JOB_FUNCTION, isLocalQueueMode } = require("./config");

let client = null;
let clientOverride = null;

function getClient() {
  if (clientOverride) return clientOverride;
  if (!client) {
    /* Lazy require: das SDK wird nur geladen, wenn der Queue-Pfad aktiv ist. */
    const { CloudTasksClient } = require("@google-cloud/tasks");
    client = new CloudTasksClient();
  }
  return client;
}

/* Cloud Functions / Cloud Run setzen GCLOUD_PROJECT bzw. GCP_PROJECT. */
function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
}

/* Stabile Alias-URL der Worker-Function. */
function processJobUrl() {
  return `https://${QUEUE_REGION}-${projectId()}.cloudfunctions.net/${PROCESS_JOB_FUNCTION}`;
}

/* Service-Account, mit dem Cloud Tasks das OIDC-Token signiert. Standard ist
   der App-Engine-Default-SA; per QUEUE_INVOKER_SA überschreibbar, falls das
   Projekt einen anderen Runtime-SA nutzt. Dieser SA braucht die Rolle
   "Cloud Functions Invoker" auf processJob (IAM-Setup, Deploy-Schritt). */
function invokerServiceAccount() {
  return process.env.QUEUE_INVOKER_SA || `${projectId()}@appspot.gserviceaccount.com`;
}

/**
 * Reiht einen Job in die Cloud-Tasks-Queue ein. Cloud Tasks ruft danach
 * `processJob` mit `{ jobId }` im Body auf.
 *
 * @param {string} jobId  Firestore-Job-ID (aus jobs.createJob)
 * @returns {Promise<string>} der von Cloud Tasks vergebene Task-Name
 */
async function enqueueJob(jobId) {
  /* Lokal-Modus (Emulator): Es gibt keinen Cloud-Tasks-Emulator — daher
     processJob direkt anstoßen statt einen echten Task zu erzeugen. */
  if (isLocalQueueMode()) return enqueueJobLocal(jobId);

  const c = getClient();
  const parent = c.queuePath(projectId(), QUEUE_REGION, QUEUE_NAME);
  const url = processJobUrl();
  const task = {
    httpRequest: {
      httpMethod: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ jobId })),
      oidcToken: {
        serviceAccountEmail: invokerServiceAccount(),
        audience: url,
      },
    },
  };
  const [created] = await c.createTask({ parent, task });
  return created.name;
}

/* URL der processJob-Function im laufenden Firebase-Emulator. */
function localProcessJobUrl() {
  if (process.env.QUEUE_LOCAL_PROCESS_URL) return process.env.QUEUE_LOCAL_PROCESS_URL;
  const port = process.env.FUNCTIONS_EMULATOR_PORT || "5001";
  return `http://127.0.0.1:${port}/${projectId() || "malzime"}/${QUEUE_REGION}/processJob`;
}

/* Stößt processJob lokal per HTTP an (Emulator). */
function dispatchLocal(jobId) {
  fetch(localProcessJobUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    console.log(JSON.stringify({ warning: "local-dispatch-failed", jobId, error: err.message }));
  });
}

/**
 * Lokaler Cloud-Tasks-Ersatz: stößt processJob direkt per HTTP an. Fire-and-
 * forget — enqueue wartet NICHT auf die Verarbeitung, genau wie beim echten
 * Cloud-Tasks-Dispatch. Nur aktiv bei QUEUE_LOCAL=1.
 *
 * Die Drosselung (maxConcurrentDispatches bei echtem Cloud Tasks) übernimmt
 * im Lokal-Modus processJob selbst: Es zählt vor der Verarbeitung die laufenden
 * Jobs in Firestore und vertagt sich via `redispatchJobLocal`, wenn die Grenze
 * erreicht ist. Firestore ist die prozess-übergreifende Wahrheit — nötig, weil
 * der Emulator mehrere Worker-Prozesse fährt (Modul-Variablen sind nicht
 * geteilt). Siehe handle-process-job.js.
 */
function enqueueJobLocal(jobId) {
  dispatchLocal(jobId);
  return Promise.resolve(`local-dispatch/${jobId}`);
}

/* Verzögerung, nach der ein vertagter Job erneut angestoßen wird. */
const LOCAL_REDISPATCH_MS = 2500;

/**
 * Stößt einen vertagten Job (Lokal-Modus, Drossel war voll) nach kurzer
 * Verzögerung erneut an. So lange wiederholt, bis ein Slot frei ist.
 */
function redispatchJobLocal(jobId) {
  setTimeout(() => dispatchLocal(jobId), LOCAL_REDISPATCH_MS);
}

/* Nur für Tests — ersetzt den CloudTasksClient durch eine Attrappe. */
function setClientForTest(impl) {
  clientOverride = impl;
}

module.exports = {
  enqueueJob,
  redispatchJobLocal,
  processJobUrl,
  invokerServiceAccount,
  setClientForTest,
};
