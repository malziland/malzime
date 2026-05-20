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

const { QUEUE_NAME, QUEUE_REGION, PROCESS_JOB_FUNCTION } = require("./config");

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

/* Nur für Tests — ersetzt den CloudTasksClient durch eine Attrappe. */
function setClientForTest(impl) {
  clientOverride = impl;
}

module.exports = {
  enqueueJob,
  processJobUrl,
  invokerServiceAccount,
  setClientForTest,
};
