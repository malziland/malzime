"use strict";

/**
 * feature-flags.js — Laufzeit-Feature-Flags (Firestore).
 *
 * Aktuell ein Flag: `useQueue` — schaltet zwischen dem synchronen
 * /analyze-Pfad (false, Default) und der Queue-Architektur (true).
 *
 * Das Flag liegt im Firestore-Dokument `featureFlags/current`. Umlegen geht
 * OHNE Deploy (Firestore-Console, auch vom Handy aus) — damit ist der
 * Rückfall auf den bewährten synchronen Pfad jederzeit in Sekunden möglich.
 * Das ist das zentrale Betriebssicherheits-Element der Queue-Einführung.
 *
 * Gelesen wird mit 30-Sekunden-Cache (analog zum Maintenance-Status in
 * counter.js) und fail-safe: Ist das Dokument nicht lesbar, gilt das Flag
 * als `false` — im Zweifel also der synchrone Pfad.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { isLocalQueueMode } = require("./config");

const FLAGS_DOC = "featureFlags/current";
const CACHE_TTL_MS = 30 * 1000;

let cache = { data: null, expiresAt: 0 };

/**
 * Liefert die aktuellen Feature-Flags. Aktuell: `{ useQueue: boolean }`.
 */
async function getFeatureFlags() {
  /* Lokal-Modus (Emulator): Die Queue ist per Definition an — der Emulator-
     Lauf dient ja gerade ihrem Test. Kein Firestore-Read, kein Seeding nötig. */
  if (isLocalQueueMode()) return { useQueue: true };

  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  try {
    const snap = await getFirestore().doc(FLAGS_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const flags = { useQueue: data.useQueue === true };
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    return { useQueue: false };
  }
}

/**
 * Kurzform: Ist der Queue-Pfad aktiv?
 */
async function isQueueEnabled() {
  return (await getFeatureFlags()).useQueue;
}

/* Nur für Tests — Cache zurücksetzen. */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = { getFeatureFlags, isQueueEnabled, FLAGS_DOC, _clearCache };
