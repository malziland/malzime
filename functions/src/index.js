const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret } = require("firebase-functions/params");

const { handleAnalyze } = require("./handle-analyze");
const { handleStats } = require("./handle-stats");
const { handleAdmin } = require("./handle-admin");
const { handleErrors } = require("./handle-errors");
const { handleTelemetry } = require("./handle-telemetry");
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

exports.analyze = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    concurrency: 20,
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 180,
    secrets: [ntfyUrl, ntfyTopic, adminSecret, mistralApiKey],
  },
  (req, res) => handleAnalyze(req, res, { ntfyUrl, ntfyTopic, adminSecret, mistralApiKey })
);

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
    memory: "128MiB",
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
    memory: "128MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 3,
    timeoutSeconds: 10,
  },
  handleTelemetry
);
