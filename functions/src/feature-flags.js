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
 *   - `usePromptCache` (seit v2.5): schickt `prompt_cache_key` an Mistral mit,
 *     damit der immer gleiche Prompt-Anfang (~9.500 der 10.821 Eingabe-Tokens)
 *     nur zu 10% berechnet wird. Reine Kostenmassnahme — das Modell, die
 *     Antwortqualitaet und die Laufzeit bleiben unveraendert (gecacht wird die
 *     Vorarbeit am statischen Text, NICHT die Antwort und NICHT das Bild).
 *     `false` = Ist-Zustand vor v2.5, jederzeit ohne Deploy erreichbar.
 *   - `useLiveText` (v3.0 Phase 1): der Queue-Worker liest die Mistral-Antwort
 *     als Stream mit und legt die bereits angekommenen Profiltexte ins
 *     Job-Dokument (`liveText` = Standard, seit Phase 3 zusaetzlich
 *     `liveTextBeast`), damit der wartende Client sie zeigen kann.
 *     Default AUS: ohne Flag laeuft der Mistral-Aufruf exakt wie heute (kein
 *     `stream: true`, kein zusaetzlicher Firestore-Schreibvorgang). Damit ist
 *     der bewaehrte Pfad jederzeit ohne Deploy zurueckholbar.
 *   - `useSprachumschalter` (v3.3): zeigt den DE/EN-Umschalter auf der
 *     Startseite. Default AUS — ist er aus, baut das Frontend das Bedienelement
 *     gar nicht erst; ein sichtbarer, wirkungsloser Schalter waere schlimmer
 *     als keiner. Die englische Fassung selbst haengt NICHT an diesem Flag:
 *     Sie ist ueber ?lang=en und die Geraetesprache seit jeher erreichbar.
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
    /* Der Live-Text-Strom ist im Emulator standardmaessig AUS. Seit
       2026-08-29 laesst er sich per `QUEUE_LOCAL_LIVE=1` in
       `functions/.env.local` einschalten — die Attrappe stellt den
       Datenstrom nach. Ohne diesen Schalter waere die Live-Anzeige lokal
       ueberhaupt nicht zu sehen, und jede Pruefung an ihr braeuchte echte
       Mistral-Aufrufe. */
    const live = process.env.QUEUE_LOCAL_LIVE === "1";
    return {
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: live,
      useSprachumschalter: false,
      useGemesseneDauer: false,
    };
  }

  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  try {
    const snap = await datenbank().doc(FLAGS_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const flags = {
      usePromptCache: data.usePromptCache === true,
      /* OPS-009 (Audit 2026-08-10): Notausschalter fuer den zweiten
         Mistral-Aufruf. Fehlt das Feld, ist er AN — der Zweitaufruf ist der
         Normalbetrieb seit v2.8. Ausschalten kostet nur die bessere
         Beast-Werbung; die Analyse laeuft unveraendert weiter. Gebraucht wird
         er, wenn die Anfragen pro Minute knapp werden: Er verdoppelt sie, und
         bisher gab es keinen Weg, ihn ohne Deploy stillzulegen. */
      useBeastAdsCall: data.useBeastAdsCall !== false,
      /* v3.0 Phase 1: Live-Text-Strom. Streng opt-in (`=== true`) — jeder
         andere Wert laesst den Worker exakt wie heute laufen. Der Stream ist
         ein Experiment am teuersten Aufruf der Pipeline; er darf sich nie
         durch einen Tippfehler im Dokument selbst einschalten. */
      useLiveText: data.useLiveText === true,
      /* v3.3: Sprachumschalter. Streng opt-in — ein Tippfehler im Dokument
         darf ein Bedienelement nicht versehentlich vor ein Workshop-Publikum
         stellen. */
      useSprachumschalter: data.useSprachumschalter === true,
      /* FEATURE-2026-08-29-02: Wartezeit und Einlassgrenze aus der gemessenen
         Dauer statt aus QUEUE_AVG_JOB_SECONDS. Fehlt das Feld, ist die Messung
         AN — sie ist die richtigere Rechnung, und ihr schlechtester Fall ist
         der bisherige Code-Wert. Ausschalten ist der Notweg, nicht der
         Normalfall. */
      useGemesseneDauer: data.useGemesseneDauer !== false,
    };
    cache = { data: flags, expiresAt: now + CACHE_TTL_MS };
    return flags;
  } catch (err) {
    console.log(JSON.stringify({ warning: "feature-flags-read-error", error: err.message }));
    /* Fail-safe: kein Cache, keine Experimente — der Zweitaufruf bleibt aber
       AN, denn er ist der Normalbetrieb und sein Ausfall waere ein stiller
       Qualitaetsverlust statt einer Absicherung. */
    return {
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
      useGemesseneDauer: false,
    };
  }
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

/**
 * Kurzform: Soll der Worker den Profiltext live ins Job-Dokument streamen?
 */
async function isLiveTextEnabled() {
  return (await getFeatureFlags()).useLiveText;
}

/**
 * Kurzform: Soll die Startseite den DE/EN-Umschalter zeigen?
 */
async function isSprachumschalterEnabled() {
  return (await getFeatureFlags()).useSprachumschalter;
}

/* Nur für Tests — Cache zurücksetzen. */
function _clearCache() {
  cache = { data: null, expiresAt: 0 };
}

module.exports = {
  getFeatureFlags,
  isPromptCacheEnabled,
  isBeastAdsCallEnabled,
  isLiveTextEnabled,
  isSprachumschalterEnabled,
  FLAGS_DOC,
  _clearCache,
};
