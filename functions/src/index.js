const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret } = require("firebase-functions/params");

const { handleAnalyze } = require("./handle-analyze");
const { handleStats } = require("./handle-stats");
const { handleAdmin } = require("./handle-admin");
const { handleErrors } = require("./handle-errors");
const { handleTelemetry } = require("./handle-telemetry");
const { handleEnqueue } = require("./handle-enqueue");
const { handleProcessJob } = require("./handle-process-job");
const { handleJobStatus } = require("./handle-job-status");
const { reapAbandonedJobs } = require("./handle-reap");
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

/* v1.10.6 — Workshop-Tauglichkeit ohne Architektur-Umbau.
   Hintergrund: heutiger Workshop (15 User) hat die Pipeline gerissen.
   Wurzelursache war NICHT Mistral selbst, sondern Cloud-Run-Routing:
   mit concurrency=20 hat Cloud Run alle 15 Requests auf EINE Instanz
   gepackt, deren Per-Instance-Drossel (6 Slots) sofort gestaut hat.
   Fix:
   - concurrency 20→8: zwingt Cloud Run, neue Instanzen hochzufahren,
     statt eine Instanz voll zu pumpen. Matched ungefaehr die 6 Throttle-
     Slots pro Instanz (+2 Headroom fuer kurze Spitzen).
   - maxInstances 10→4: deckelt den globalen Mistral-Cap auf max 24
     parallele Calls (4 Instanzen × 6 Slots) und passt zur Token-Bucket-Rate
     (4 × 0.67 RPS = 2.67 RPS, sicher unter Mistrals 6-RPS-Limit). Erste
     Lasttests mit 6 Instanzen zeigten noch Cold-Start-Bursts ueber dem Limit
     — 4 Instanzen sind konservativer und reichen fuer 25-50 Schueler.
   - timeoutSeconds 180→540: matched Cloud-Run-Maximum, gibt der Pipeline
     Luft fuer Auto-Retry-Zyklen unter Last.
   Damit haelt der Code zuverlaessig 25-30 gleichzeitige Workshop-Teil-
   nehmer; bis ~50 mit Auto-Retry des Clients verkraftbar. Fuer 100+
   braucht es die echte Queue-Architektur (siehe queue-arch-plan). */
exports.analyze = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    concurrency: 8,
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 4,
    timeoutSeconds: 540,
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

/* ── Queue-Architektur (v2.0) ──
   Parallel-Pfad zum synchronen /analyze. Diese drei Functions liegen
   dormant: Solange das Feature-Flag `useQueue` (Firestore featureFlags/
   current) AUS ist, leitet das Frontend keinen Nutzer hierher — jeder
   echte Request laeuft weiter ueber /analyze. Siehe memory/queue-plan. */

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
   Jeder Poll ist zugleich der Liveness-Herzschlag des wartenden Jobs. */
exports.jobStatus = onRequest(
  {
    region: "europe-west1",
    memory: "128MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 10,
  },
  handleJobStatus
);

/* reapJobs — geplanter Lauf (jede Minute): markiert wartende Jobs, deren
   Client nicht mehr pollt, als `abandoned`, gibt ihren Warteschlangen-Platz
   frei und loescht ihr Bild. Siehe handle-reap.js. Laeuft auch bei dormanter
   Queue — dann ein leerer, vernachlaessigbarer Query. */
exports.reapJobs = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 1 minutes",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  () => reapAbandonedJobs()
);
