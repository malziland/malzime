"use strict";

/**
 * feature-flags.js — Laufzeit-Schalter für Provider-Wahl und andere Toggles.
 *
 * Liest aus Firestore-Doc `featureFlags/current`, gleiches Muster wie der
 * Maintenance-Kill-Switch in counter.js (30s Cache, fail-open auf Defaults).
 *
 * Aktuell unterstützte Flags:
 *   - aiProvider: "gemini" (default) | "hybrid"
 *   - aiProviderHybridPct: 0-100, Default 100 — bei aiProvider="hybrid" entscheidet
 *     dieser Wert, welcher PROZENTSATZ der Analysen tatsächlich Hybrid bekommt.
 *     Rest fällt auf Gemini. Bei aiProvider="gemini" ignoriert. Phase-4 Ramp-Up:
 *     "hybrid" + 1% → 10% → 50% → 100%.
 *
 * Sample-Wahl ist deterministisch via SHA-256-Hash eines sampleKey (z.B. IP) —
 * derselbe User sieht über mehrere Analysen konsistent denselben Provider.
 */

const crypto = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { MISTRAL_RAMP_START_ISO, MISTRAL_RAMP_SCHEDULE } = require("./config");

const FLAGS_DOC = "featureFlags/current";
const CACHE_TTL_MS = 30000;

/* Default: aiProvider="auto" → resolveProvider nimmt Auto-Ramp aus config.
   Wenn Firestore-Doc fehlt oder unlesbar, gilt dieser Default. */
const DEFAULT_FLAGS = Object.freeze({
  aiProvider: "auto",
  aiProviderHybridPct: undefined,
});

/* "auto" = Auto-Ramp aus Code-Schedule, "gemini" = Kill-Switch, "hybrid" = Force */
const ALLOWED_AI_PROVIDERS = new Set(["auto", "gemini", "hybrid"]);

let cache = { data: null, expiresAt: 0 };

/**
 * Liest die Feature-Flags. Fail-open: bei Firestore-Fehler werden Defaults
 * zurückgegeben, damit ein einzelner DB-Hickser nicht den Service abreißt.
 */
async function getFeatureFlags() {
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) {
    return cache.data;
  }
  try {
    const db = getFirestore();
    const snap = await db.doc(FLAGS_DOC).get();
    const raw = snap.exists ? snap.data() : {};
    const flags = normalize(raw);
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    return { ...DEFAULT_FLAGS };
  }
}

/**
 * Setzt das aiProvider-Flag (Admin-Funktion, nicht für Live-Pfad).
 * Wirft, wenn der Wert kein gültiger Provider ist.
 */
async function setAiProvider(value) {
  if (!ALLOWED_AI_PROVIDERS.has(value)) {
    const e = new Error(`Invalid aiProvider value: ${value}`);
    e.code = "invalid_value";
    throw e;
  }
  const db = getFirestore();
  await db.doc(FLAGS_DOC).set(
    {
      aiProvider: value,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  cache = { data: null, expiresAt: 0 };
}

/**
 * Setzt den Hybrid-Sample-Prozentsatz (Admin-Funktion). Wirft bei ungültigen Werten.
 * Akzeptiert Integers 0-100 inklusive.
 */
async function setAiProviderHybridPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100 || Math.floor(value) !== value) {
    const e = new Error(`Invalid aiProviderHybridPct value: ${value}`);
    e.code = "invalid_value";
    throw e;
  }
  const pct = value;
  const db = getFirestore();
  await db.doc(FLAGS_DOC).set(
    {
      aiProviderHybridPct: pct,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  cache = { data: null, expiresAt: 0 };
}

/**
 * Normalisiert Firestore-Raw-Daten zu sauberen Flags.
 * Unbekannte oder ungültige Werte fallen auf Defaults zurück.
 */
function normalize(raw) {
  const result = { ...DEFAULT_FLAGS };
  if (raw && typeof raw.aiProvider === "string" && ALLOWED_AI_PROVIDERS.has(raw.aiProvider)) {
    result.aiProvider = raw.aiProvider;
  }
  if (raw && typeof raw.aiProviderHybridPct === "number" && Number.isFinite(raw.aiProviderHybridPct)) {
    result.aiProviderHybridPct = Math.max(0, Math.min(100, Math.floor(raw.aiProviderHybridPct)));
  }
  return result;
}

/**
 * Entscheidet anhand der Flags + sampleKey, welcher Provider tatsächlich aufgerufen wird.
 *
 * Logik:
 *   - aiProvider !== "hybrid" → immer "gemini"
 *   - aiProvider === "hybrid" UND aiProviderHybridPct >= 100 → "hybrid"
 *   - aiProvider === "hybrid" UND aiProviderHybridPct <= 0 → "gemini"
 *   - aiProvider === "hybrid" UND 0 < pct < 100 → Hash(sampleKey) % 100 < pct → "hybrid", sonst "gemini"
 *
 * Hash ist deterministisch (SHA-256) → derselbe sampleKey liefert immer denselben
 * Provider. Üblicherweise ist sampleKey die Client-IP, damit ein einzelner User
 * über mehrere Analysen konsistent denselben Pfad sieht (Sticky-Behavior). Falls
 * sampleKey leer ist, wird ein zufälliger Wert verwendet (per-Request-Zufall).
 */
function resolveProvider(flags, sampleKey, now = Date.now()) {
  /* Override-Hierarchie:
     1. aiProvider="gemini" → IMMER Gemini (Kill-Switch, höchste Priorität)
     2. aiProviderHybridPct gesetzt → manueller Pct-Override (egal welcher aiProvider)
     3. aiProvider="hybrid" → IMMER Hybrid (100%)
     4. aiProvider="auto" oder kein Flag → Auto-Ramp aus Code-Schedule */
  if (flags && flags.aiProvider === "gemini") return "gemini";

  let pct;
  if (flags && typeof flags.aiProviderHybridPct === "number") {
    pct = Math.max(0, Math.min(100, flags.aiProviderHybridPct));
  } else if (flags && flags.aiProvider === "hybrid") {
    pct = 100;
  } else {
    /* PHASE 4 AUTO-RAMP — IN PHASE 6 ENTFERNEN und Default-Pfad auf
       `pct = 100` (Mistral wird permanenter Default) umstellen. */
    pct = calculateRampPct(now);
  }

  if (pct >= 100) return "hybrid";
  if (pct <= 0) return "gemini";
  const bucket = sampleKey ? hashToBucket(sampleKey) : Math.floor(Math.random() * 100);
  return bucket < pct ? "hybrid" : "gemini";
}

/* PHASE 4 AUTO-RAMP — IN PHASE 6 ENTFERNEN.
   Berechnet anhand der hartcodierten MISTRAL_RAMP_SCHEDULE aus config.js,
   welcher Prozentsatz JETZT gelten soll. Vor MISTRAL_RAMP_START_ISO: 0 %. */
function calculateRampPct(now) {
  const startMs = Date.parse(MISTRAL_RAMP_START_ISO);
  if (!Number.isFinite(startMs)) return 0;
  if (now < startMs) return 0;
  const elapsedHours = (now - startMs) / (1000 * 60 * 60);
  let pct = 0;
  for (const step of MISTRAL_RAMP_SCHEDULE) {
    if (elapsedHours >= step.afterHours) pct = step.pct;
  }
  return pct;
}

/* SHA-256 → 0..99. Wir nehmen die ersten 4 Bytes als UInt32 und modulo 100.
   Die ~1.5 % Bias bei modulo 100 ist für unsere Ramp-Up-Zwecke irrelevant. */
function hashToBucket(key) {
  const hash = crypto.createHash("sha256").update(String(key)).digest();
  const n = hash.readUInt32BE(0);
  return n % 100;
}

/* Nur für Tests: Cache zurücksetzen */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = {
  getFeatureFlags,
  setAiProvider,
  setAiProviderHybridPct,
  resolveProvider,
  /* PHASE 4 AUTO-RAMP — exportiert für Tests, IN PHASE 6 ENTFERNEN */
  calculateRampPct,
  DEFAULT_FLAGS,
  ALLOWED_AI_PROVIDERS,
  _clearCache,
  _hashToBucket: hashToBucket,
};
