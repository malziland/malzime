const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/* ── Gemini-Modelle (heutiger Live-Stack) ── */
const DESCRIBE_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash-001"];
const PROFILE_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash-001"];

/* ── Mistral-Modelle (Phase 2 der Migration, noch nicht produktiv) ──
   Hybrid-Architektur: Describe-Stage via Large 3 (gute Vision), Profile-Stage
   via Small 4 (günstig + schnell für Text-zu-JSON-Generierung).

   Preise pro 1M Tokens (Stand 2026-05-12):
     - mistral-large-latest: $0.50 / $1.50  in/out — 600K TPM, 0.43 RPS
     - mistral-small-2603:   $0.15 / $0.60  in/out —  50K TPM, 0.83 RPS

   Wichtig: API-Key kommt aus `process.env.MISTRAL_API_KEY` (Firebase Secret),
   wird NIEMALS hier hartcodiert. */
const MISTRAL_DESCRIBE_MODEL = "mistral-large-latest";
const MISTRAL_PROFILE_MODEL = "mistral-small-2603";
const MISTRAL_FALLBACK_MODEL = "mistral-large-latest"; /* Falls Small 4 versagt */
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_DESCRIBE_MAX_TOKENS = 2048;
const MISTRAL_PROFILE_MAX_TOKENS = 8000; /* Höher als 5000 wegen Boost-Truncation-Erfahrung */

/* Eine separate Endpoint-URL für den ModelsList-Endpoint (Health-Check). */
const MISTRAL_MODELS_ENDPOINT = "https://api.mistral.ai/v1/models";

const API_TIMEOUT_MS = 45000;

/* Mistral-spezifischer Timeout — Large 3 kann bei großen Bildern länger brauchen. */
const MISTRAL_TIMEOUT_MS = 60000;

/* ── Globales Stundenlimit ── */
const HOURLY_LIMIT = 500;
const HOURLY_WINDOW_MINUTES = 60;

/* BUG-003: Globales Budget pro Request — verhindert dass die Summe aller
   internen Timeouts das Cloud-Function-Limit (120s) übersteigt. */
const REQUEST_BUDGET_MS = 90000;

/* Laufzeit-Validierung — fehlerhafte Config crasht sofort statt leise falsch zu laufen */
if (HOURLY_LIMIT < 1) throw new Error("Config: HOURLY_LIMIT must be >= 1");
if (RATE_LIMIT < 1) throw new Error("Config: RATE_LIMIT must be >= 1");
if (MAX_UPLOAD_BYTES < 1) throw new Error("Config: MAX_UPLOAD_BYTES must be >= 1");
if (MISTRAL_PROFILE_MAX_TOKENS < 1) throw new Error("Config: MISTRAL_PROFILE_MAX_TOKENS must be >= 1");

module.exports = {
  MAX_UPLOAD_BYTES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  ALLOWED_MIME,
  DESCRIBE_MODELS,
  PROFILE_MODELS,
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_MODELS_ENDPOINT,
  MISTRAL_DESCRIBE_MAX_TOKENS,
  MISTRAL_PROFILE_MAX_TOKENS,
  MISTRAL_TIMEOUT_MS,
  API_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
  HOURLY_LIMIT,
  HOURLY_WINDOW_MINUTES,
};
