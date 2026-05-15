"use strict";

/**
 * config.js — Konstanten für die Mistral-only Pipeline (seit v1.6.0).
 *
 * Vor v1.6.0 standen hier auch Gemini-Modelle (DESCRIBE_MODELS, PROFILE_MODELS)
 * und Vision-API-Konfiguration. Beides wurde mit dem Vision/Gemini-Cleanup
 * entfernt. Die heute aktive Pipeline nutzt ausschließlich Mistral AI.
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/* ── Mistral-Modelle ──
   Describe-Stage via Large 3 (gute Bilderkennung),
   Profile-Stage via Small 4 (günstig + schnell für Text-zu-JSON-Generierung).
   Mistral-internes Fallback bei Profile-Versagen: Large 3.

   Preise pro 1M Tokens (Stand 2026-05):
     - mistral-large-latest: $0.50 / $1.50  in/out
     - mistral-small-2603:   $0.15 / $0.60  in/out

   API-Key kommt aus `process.env.MISTRAL_API_KEY` (Firebase Secret). */
const MISTRAL_DESCRIBE_MODEL = "mistral-large-latest";
const MISTRAL_PROFILE_MODEL = "mistral-small-2603";
const MISTRAL_FALLBACK_MODEL = "mistral-large-latest";
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODELS_ENDPOINT = "https://api.mistral.ai/v1/models";
const MISTRAL_DESCRIBE_MAX_TOKENS = 2048;
const MISTRAL_PROFILE_MAX_TOKENS = 8000;
const MISTRAL_TIMEOUT_MS = 90000;

/* ── Globales Stundenlimit ── */
const HOURLY_LIMIT = 500;
const HOURLY_WINDOW_MINUTES = 60;

/* BUG-003: Globales Budget pro Request — verhindert dass die Summe aller
   internen Timeouts das Cloud-Function-Limit (180s) übersteigt. */
const REQUEST_BUDGET_MS = 120000;

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
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_MODELS_ENDPOINT,
  MISTRAL_DESCRIBE_MAX_TOKENS,
  MISTRAL_PROFILE_MAX_TOKENS,
  MISTRAL_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
  HOURLY_LIMIT,
  HOURLY_WINDOW_MINUTES,
};
