const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret } = require("firebase-functions/params");

const { handleStats } = require("./handle-stats");
const { handleAdmin } = require("./handle-admin");
const { handleErrors } = require("./handle-errors");
const { handleTelemetry } = require("./handle-telemetry");
const { handleEnqueue } = require("./handle-enqueue");
const { handleProcessJob } = require("./handle-process-job");
const { handleJobStatus } = require("./handle-job-status");
const { reapJobs } = require("./handle-reap");
const { ALLOWED_ORIGINS } = require("./domains");

const adminSecret = defineSecret("ADMIN_SECRET");
const ntfyUrl = defineSecret("NTFY_URL");
const ntfyTopic = defineSecret("NTFY_TOPIC");
/* Mistral AI API-Key — Pflicht seit v1.6.0 (Mistral-only Pipeline).
   Wird via process.env.MISTRAL_API_KEY von mistral.js gelesen. Firebase
   injiziert das Secret automatisch als env-Var wenn es in `secrets`
   deklariert ist. Wenn das Secret fehlt, schlagen alle Analyse-Calls
   mit code "no_api_key" fehl. */
const mistralApiKey = defineSecret("MISTRAL_API_KEY");

initializeApp();

exports.stats = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 5,
  },
  handleStats
);

exports.admin = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 2,
    secrets: [adminSecret],
  },
  (req, res) => handleAdmin(req, res, { adminSecret })
);

exports.errors = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 3,
    timeoutSeconds: 10,
  },
  handleErrors
);

exports.telemetry = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 3,
    timeoutSeconds: 10,
  },
  handleTelemetry
);

/* ── Queue-Architektur (v2.0) ──
   Der Live-Pfad: Seit v2.0 laeuft jeder Upload ueber diese Functions
   (Feature-Flag `useQueue` in Firestore featureFlags/current, live true).
   Bei useQueue=false faellt alles auf den synchronen /analyze-Pfad
   zurueck — der Rueckfall-Hebel ohne Deploy (docs/RUNBOOK.md, Hebel 2).
   Siehe docs/ARCHITECTURE.md, Abschnitt Queue-Architektur. */

/* enqueue — public Annahme-Endpoint: validiert, speichert das Bild,
   legt den Job an und reiht ihn in Cloud Tasks ein. */
exports.enqueue = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 60,
    secrets: [ntfyUrl, ntfyTopic, adminSecret],
  },
  (req, res) => handleEnqueue(req, res, { ntfyUrl, ntfyTopic, adminSecret })
);

/* processJob — Worker, NICHT public. Nur Cloud Tasks ruft ihn auf:
   invoker "private" → Cloud Run verlangt Authentifizierung; der Cloud-
   Tasks-Service-Account erhaelt beim Deploy die Invoker-Rolle. concurrency
   1 = ein Job pro Instanz, die Dosierung uebernimmt die Cloud-Tasks-Queue.
   MISTRAL_API_KEY wird als Secret injiziert (mistral.js liest die env-Var). */
exports.processJob = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    invoker: "private",
    concurrency: 1,
    maxInstances: 10,
    timeoutSeconds: 540,
    secrets: [mistralApiKey],
  },
  handleProcessJob
);

/* jobStatus — public, leichtgewichtiger Polling-Endpoint fuer den Client.
   Jeder Poll ist zugleich der Liveness-Herzschlag des wartenden Jobs.
   memory 256MiB: 128MiB hatte keinen Puffer ueber dem firebase-admin-
   Grundbedarf — beim Workshop 2026-05-21 ein OOM unter Poll-Last. */
exports.jobStatus = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 10,
  },
  handleJobStatus
);

/* reapJobs — geplanter Lauf (jede Minute): markiert wartende Jobs, deren
   Client nicht mehr pollt, als `abandoned`, gibt ihren Warteschlangen-Platz
   frei und loescht ihr Bild. Siehe handle-reap.js. Laeuft auch, wenn die
   Queue per Flag deaktiviert ist (useQueue=false, Rueckfall auf /analyze) —
   dann ein leerer, vernachlaessigbarer Query. */
exports.reapJobs = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 1 minutes",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  () => reapJobs()
);
