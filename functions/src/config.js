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

/* ╔════════════════════════════════════════════════════════════════════════╗
   ║ PHASE 4 AUTO-RAMP — IN PHASE 6 ENTFERNEN!                                ║
   ║                                                                          ║
   ║ Diese drei Konstanten und die zugehörige Logik in feature-flags.js       ║
   ║ (calculateRampPct + Auto-Default in resolveProvider) sind eine temporäre ║
   ║ Mechanik für die Mistral-Migration. Sobald die Migration in Phase 6      ║
   ║ abgeschlossen ist (Mistral stabil seit 30+ Tagen, Gemini-Code als reine  ║
   ║ Fallback-Schicht), muss dieser Block entfernt werden:                    ║
   ║                                                                          ║
   ║   1. MISTRAL_RAMP_START_ISO + MISTRAL_RAMP_SCHEDULE hier entfernen       ║
   ║   2. calculateRampPct() aus feature-flags.js entfernen                   ║
   ║   3. resolveProvider() Default-Pfad umstellen:                           ║
   ║        alt: kein Flag → Auto-Ramp                                        ║
   ║        neu: kein Flag → "hybrid" (Mistral wird permanenter Default)      ║
   ║   4. Tests für calculateRampPct + Auto-Ramp entfernen                    ║
   ║   5. memory/mistral-migration-plan.md Phase-6-Checkliste durchgehen      ║
   ╚════════════════════════════════════════════════════════════════════════╝ */

/* Ramp-Start: zeitlich kurz nach geplantem Deploy (12.05.2026 22:15 UTC =
   00:15 lokal Wien am 13.05.). Vor diesem Zeitpunkt → 0 % Hybrid (alles Gemini). */
const MISTRAL_RAMP_START_ISO = "2026-05-12T22:15:00Z";

/* 8-Tage-Schedule. Jeder Schritt: ab `afterHours` Stunden nach Start gilt `pct`. */
const MISTRAL_RAMP_SCHEDULE = Object.freeze([
  { afterHours: 0, pct: 1 } /* Tag 1: 1 % */,
  { afterHours: 24, pct: 10 } /* Tag 2: 10 % */,
  { afterHours: 48, pct: 33 } /* Tag 3-5: 33 % */,
  { afterHours: 120, pct: 66 } /* Tag 6-7: 66 % */,
  { afterHours: 168, pct: 100 } /* Tag 8+: 100 % */,
]);

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
  /* PHASE 4 — IN PHASE 6 ENTFERNEN */
  MISTRAL_RAMP_START_ISO,
  MISTRAL_RAMP_SCHEDULE,
  /* ENDE Phase-4-Block */
  API_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
  HOURLY_LIMIT,
  HOURLY_WINDOW_MINUTES,
};
