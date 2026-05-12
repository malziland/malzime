"use strict";

/**
 * feature-flags.js — Laufzeit-Schalter für Provider-Wahl und andere Toggles.
 *
 * Liest aus Firestore-Doc `featureFlags/current`, gleiches Muster wie der
 * Maintenance-Kill-Switch in counter.js (30s Cache, fail-open auf Defaults).
 *
 * Aktuell unterstützte Flags:
 *   - aiProvider: "gemini" (default) | "hybrid"
 *
 * Phase 3 der Mistral-Migration: Default bleibt "gemini", bis Phase 4 die
 * Ramp-Up-Aktivierung startet.
 */

const { getFirestore } = require("firebase-admin/firestore");

const FLAGS_DOC = "featureFlags/current";
const CACHE_TTL_MS = 30000;

const DEFAULT_FLAGS = Object.freeze({
  aiProvider: "gemini",
});

const ALLOWED_AI_PROVIDERS = new Set(["gemini", "hybrid"]);

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
 * Normalisiert Firestore-Raw-Daten zu sauberen Flags.
 * Unbekannte oder ungültige Werte fallen auf Defaults zurück.
 */
function normalize(raw) {
  const result = { ...DEFAULT_FLAGS };
  if (raw && typeof raw.aiProvider === "string" && ALLOWED_AI_PROVIDERS.has(raw.aiProvider)) {
    result.aiProvider = raw.aiProvider;
  }
  return result;
}

/* Nur für Tests: Cache zurücksetzen */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = {
  getFeatureFlags,
  setAiProvider,
  DEFAULT_FLAGS,
  ALLOWED_AI_PROVIDERS,
  _clearCache,
};
