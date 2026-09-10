"use strict";

/**
 * feature-flags.js — Laufzeit-Feature-Flags (Firestore).
 *
 * Flags (welcher Wert gilt, wenn das Dokument nicht lesbar ist, steht je
 * Flag im catch-Zweig unten und in docs/FLAGS.md, Spalte „Fail-safe“):
 *   - `useQueue`: ENTFERNT mit v2.10 — es gibt nur noch die Warteschlange.
 *   - `useSingleLargeCall`: ENTFERNT am 10.09.2026 — es gibt nur noch den
 *     Ein-Aufruf-Weg. Der aeltere Drei-Aufruf-Weg, zwischen dem dieses Flag
 *     umschaltete, ist ausgebaut; ein vorhandener Eintrag im Dokument wirkt
 *     nicht mehr.
 *   - `usePromptCache`, `useLiveText`, `useSprachumschalter`: ENTFERNT am
 *     10.09.2026 — fest eingebaut. Alle drei standen dauerhaft auf `true`;
 *     als Schalter konnten sie nur noch eines: bei einer kurzen Stoerung der
 *     Datenbank still auf "aus" springen (Kosten hoch, Live-Text und
 *     DE/EN-Umschalter weg, mitten im Workshop). Ein vorhandener Eintrag im
 *     Dokument wirkt nicht mehr.
 *
 * Alle Flags liegen im Firestore-Dokument `featureFlags/current`. Umlegen
 * geht OHNE Deploy (Firestore-Console, auch vom Handy aus).
 *
 * Gelesen wird mit 30-Sekunden-Cache (analog zum Maintenance-Status in
 * counter.js) und fail-safe: Ist das Dokument nicht lesbar, gilt je Flag der
 * Wert aus dem catch-Zweig unten.
 */

const { datenbank } = require("./db");
const { isLocalQueueMode } = require("./config");

const FLAGS_DOC = "featureFlags/current";
const CACHE_TTL_MS = 30 * 1000;

let cache = { data: null, expiresAt: 0 };

/**
 * Liefert die aktuellen Feature-Flags.
 */
async function getFeatureFlags() {
  /* Lokal-Modus (Emulator): Die Queue ist per Definition an — der Emulator-
     Lauf dient ja gerade ihrem Test. Kein Firestore-Read, kein Seeding nötig. */
  if (isLocalQueueMode()) {
    return {
      useBeastAdsCall: true,
      useGemesseneDauer: false,
    };
  }

  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  try {
    const snap = await datenbank().doc(FLAGS_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const flags = {
      /* OPS-009 (Audit 2026-08-10): Notausschalter fuer den zweiten
         Mistral-Aufruf. Fehlt das Feld, ist er AN — der Zweitaufruf ist der
         Normalbetrieb seit v2.8. Ausschalten kostet nur die bessere
         Beast-Werbung; die Analyse laeuft unveraendert weiter. Gebraucht wird
         er, wenn die Anfragen pro Minute knapp werden: Er verdoppelt sie, und
         bisher gab es keinen Weg, ihn ohne Deploy stillzulegen. */
      useBeastAdsCall: data.useBeastAdsCall !== false,
      /* FEATURE-2026-08-29-02: Wartezeit und Einlassgrenze aus der gemessenen
         Dauer statt aus dem festen Wert `durchschnittsdauerSekunden` im
         Einstellungssatz (bis August 2026 die Konstante QUEUE_AVG_JOB_SECONDS).
         Fehlt das Feld, ist die Messung AN — sie ist die richtigere Rechnung,
         und ihr schlechtester Fall ist der feste Satzwert. Ausschalten ist der Notweg, nicht der
         Normalfall. */
      useGemesseneDauer: data.useGemesseneDauer !== false,
    };
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    /* Fail-safe: Der Zweitaufruf bleibt AN, denn er ist der Normalbetrieb und
       sein Ausfall waere ein stiller Qualitaetsverlust statt einer
       Absicherung. Die gemessene Dauer faellt auf den Wert aus dem
       Einstellungssatz zurueck. */
    return {
      useBeastAdsCall: true,
      useGemesseneDauer: false,
    };
  }
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
  isBeastAdsCallEnabled,
  _clearCache,
};
