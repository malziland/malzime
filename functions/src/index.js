const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret } = require("firebase-functions/params");

const { handleAnalyze } = require("./handle-analyze");
const { handleStats } = require("./handle-stats");
const { handleAdmin } = require("./handle-admin");
const { ALLOWED_ORIGINS } = require("./domains");

const adminSecret = defineSecret("ADMIN_SECRET");
const ntfyUrl = defineSecret("NTFY_URL");
const ntfyTopic = defineSecret("NTFY_TOPIC");
/* Phase 3 Mistral-Migration: Key wird via process.env.MISTRAL_API_KEY von
   mistral.js gelesen. Firebase Functions injiziert Secrets automatisch als
   env-Vars wenn sie hier deklariert sind. Wird erst beim ersten Hybrid-
   Provider-Call genutzt — der Live-Pfad (aiProvider="gemini") braucht den
   Key nicht. Solange das Secret nicht in Firebase Secret Manager gesetzt
   ist, ist die env-Var leer; das ist OK weil mistral.js erst beim Aufruf
   eine entsprechende Fehlermeldung wirft, und der Aufruf passiert nur bei
   aktivem Hybrid-Flag. */
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
    timeoutSeconds: 120,
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
