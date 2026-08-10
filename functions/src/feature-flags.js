"use strict";

/**
 * feature-flags.js — Laufzeit-Feature-Flags (Firestore).
 *
 * Flags (live stehen BEIDE auf true — Queue + Single-Large = Normalbetrieb;
 * `false` ist jeweils nur der fail-safe Default bei unlesbarem Dokument):
 *   - `useQueue`: ENTFERNT mit v2.10 — es gibt nur noch die Warteschlange
 *     (false, Rückfall-Pfad) und der Queue-Architektur (true, Live-Pfad).
 *   - `useSingleLargeCall` (seit v2.2): schaltet innerhalb der Pipeline
 *     zwischen der 3-Call-Fallback-Architektur (Describe Large + 2× Profile
 *     Small, false) und der Single-Large-Architektur (1× Large macht alles,
 *     true). Wird nur ausgewertet, wenn die Queue an ist (im synchronen Pfad
 *     bleibt die 3-Call-Pipeline aktiv, weil dort nicht relevant).
 *   - `usePromptCache` (seit v2.5): schickt `prompt_cache_key` an Mistral mit,
 *     damit der immer gleiche Prompt-Anfang (~9.500 der 10.821 Eingabe-Tokens)
 *     nur zu 10% berechnet wird. Reine Kostenmassnahme — das Modell, die
 *     Antwortqualitaet und die Laufzeit bleiben unveraendert (gecacht wird die
 *     Vorarbeit am statischen Text, NICHT die Antwort und NICHT das Bild).
 *     `false` = Ist-Zustand vor v2.5, jederzeit ohne Deploy erreichbar.
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
 * Liefert die aktuellen Feature-Flags.
 */
async function getFeatureFlags() {
  /* Lokal-Modus (Emulator): Die Queue ist per Definition an — der Emulator-
     Lauf dient ja gerade ihrem Test. Single-Large-Call bleibt im Lokal-Modus
     standardmäßig aus, damit der Emulator-Klick die bewährte Pipeline trifft.
     Kein Firestore-Read, kein Seeding nötig. */
  if (isLocalQueueMode()) return { useSingleLargeCall: false, usePromptCache: false, useBeastAdsCall: true };

  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  try {
    const snap = await getFirestore().doc(FLAGS_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const flags = {
      useSingleLargeCall: data.useSingleLargeCall === true,
      usePromptCache: data.usePromptCache === true,
      /* OPS-009 (Audit 2026-08-10): Notausschalter fuer den zweiten
         Mistral-Aufruf. Fehlt das Feld, ist er AN — der Zweitaufruf ist der
         Normalbetrieb seit v2.8. Ausschalten kostet nur die bessere
         Beast-Werbung; die Analyse laeuft unveraendert weiter. Gebraucht wird
         er, wenn die Anfragen pro Minute knapp werden: Er verdoppelt sie, und
         bisher gab es keinen Weg, ihn ohne Deploy stillzulegen. */
      useBeastAdsCall: data.useBeastAdsCall !== false,
    };
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    /* Fail-safe: bewaehrte Pipeline, kein Cache — der Zweitaufruf bleibt aber
       AN, denn er ist der Normalbetrieb und sein Ausfall waere ein stiller
       Qualitaetsverlust statt einer Absicherung. */
    return { useSingleLargeCall: false, usePromptCache: false, useBeastAdsCall: true };
  }
}

/**
 * Kurzform: Ist der Queue-Pfad aktiv?
 */
/**
 * Kurzform: Ist die Single-Large-Call-Architektur aktiv?
 */
async function isSingleLargeCallEnabled() {
  return (await getFeatureFlags()).useSingleLargeCall;
}

/**
 * Kurzform: Soll `prompt_cache_key` an Mistral mitgeschickt werden?
 */
async function isPromptCacheEnabled() {
  return (await getFeatureFlags()).usePromptCache;
}

/**
 * Kurzform: Soll der zweite Mistral-Aufruf fuer die Beast-Werbung laufen?
 */
async function isBeastAdsCallEnabled() {
  return (await getFeatureFlags()).useBeastAdsCall;
}

/* Nur für Tests — Cache zurücksetzen. */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = {
  getFeatureFlags,
  isSingleLargeCallEnabled,
  isPromptCacheEnabled,
  isBeastAdsCallEnabled,
  FLAGS_DOC,
  _clearCache,
};
