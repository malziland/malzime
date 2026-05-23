"use strict";

/**
 * feature-flags.js — Laufzeit-Feature-Flags (Firestore).
 *
 * Flags:
 *   - `useQueue` (seit v2.0): schaltet zwischen dem synchronen /analyze-Pfad
 *     (false, Default) und der Queue-Architektur (true).
 *   - `useSingleLargeCall` (v2.2 Experiment): schaltet innerhalb der Pipeline
 *     zwischen heutiger 3-Call-Architektur (Describe Large + 2× Profile Small,
 *     Default false) und der Single-Call-Large-Architektur (1× Large macht
 *     alles). Wird nur ausgewertet, wenn die Queue an ist (im synchronen Pfad
 *     bleibt die 3-Call-Pipeline aktiv, weil dort nicht relevant).
 *
 * Beide Flags liegen im Firestore-Dokument `featureFlags/current`. Umlegen
 * geht OHNE Deploy (Firestore-Console, auch vom Handy aus) — damit ist der
 * Rückfall auf den bewährten Pfad jederzeit in Sekunden möglich. Das ist das
 * zentrale Betriebssicherheits-Element jeder Architektur-Experiment-Einführung.
 *
 * Gelesen wird mit 30-Sekunden-Cache (analog zum Maintenance-Status in
 * counter.js) und fail-safe: Ist das Dokument nicht lesbar, gelten die Flags
 * als `false` — im Zweifel also der bewährte Pfad.
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
     Lauf dient ja gerade ihrem Test. Single-Large-Call bleibt im Lokal-Modus
     standardmäßig aus, damit der Emulator-Klick die bewährte Pipeline trifft.
     Kein Firestore-Read, kein Seeding nötig. */
  if (isLocalQueueMode()) return { useQueue: true, useSingleLargeCall: false };

  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  try {
    const snap = await getFirestore().doc(FLAGS_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const flags = {
      useQueue: data.useQueue === true,
      useSingleLargeCall: data.useSingleLargeCall === true,
    };
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    return { useQueue: false, useSingleLargeCall: false };
  }
}

/**
 * Kurzform: Ist der Queue-Pfad aktiv?
 */
async function isQueueEnabled() {
  return (await getFeatureFlags()).useQueue;
}

/**
 * Kurzform: Ist die Single-Large-Call-Architektur aktiv?
 */
async function isSingleLargeCallEnabled() {
  return (await getFeatureFlags()).useSingleLargeCall;
}

/* Nur für Tests — Cache zurücksetzen. */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = { getFeatureFlags, isQueueEnabled, isSingleLargeCallEnabled, FLAGS_DOC, _clearCache };
