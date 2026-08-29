"use strict";

/**
 * betriebsprofil.js — Betriebswerte aus Firestore, als benannte Saetze.
 *
 * WARUM PROFILE UND NICHT EINZELNE SCHALTER:
 *
 * Die Betriebswerte haengen zusammen. Steigt malziME von Mistral-Tarif T1 auf
 * T2, gehoeren Parallelitaet, Stundenlimit und Zeitgrenzen GEMEINSAM angefasst
 * — wer einen vergisst, bekommt eine Anlage, die sich selbst widerspricht.
 * Genau daran ist der Vorschlag "einzelne Werte aus Firestore" am 18.08.2026
 * gescheitert und wurde zu Recht gestrichen: Er haette die Kopplung zwischen
 * Zeitgrenze und Token-Menge aufgehoben, die einen Ausfall am 17.08. verhindert
 * hat.
 *
 * Ein Profil ist ein VOLLSTAENDIGER Satz. Umgestellt wird ein Feld — der Name
 * des aktiven Profils. Alles andere zieht mit.
 *
 * DIE SICHERUNG BLEIBT, SIE WANDERT NUR MIT. Die Rechnung aus config.js
 * (erlaubte Ausgabelaenge muss in die erlaubte Zeit passen) laeuft hier beim
 * LADEN. Ein Profil, das sie nicht besteht, wird abgelehnt — es gelten die
 * Code-Werte weiter. Damit ist die Externalisierung strenger als der heutige
 * Zustand, nicht laxer: Heute crasht ein falscher Wert beim Start, hier wird
 * er verworfen und der Betrieb laeuft mit den bewaehrten Zahlen weiter.
 *
 * WAS BEWUSST IM CODE BLEIBT, OBWOHL ES IN GRUPPE B STEHT:
 *
 * `HOURLY_LIMIT` — das Stundenlimit ist bereits zur Laufzeit steuerbar. Der
 * Boost-Mechanismus in counter.js hebt es ueber `stats/current.limit`, mit
 * Ablauffrist und der bewussten Eigenschaft, niemanden mitten in einer
 * laufenden Klasse auszusperren. Es hier nochmals anzubinden hiesse, denselben
 * Wert an zwei Stellen steuerbar zu machen — genau die Vervielfachung, gegen
 * die dieser Entwurf antritt. `wirksamesLimit()` ist ausserdem synchron und
 * sitzt in der Einlasskontrolle; ein async-Umbau dort waere ein Eingriff in
 * den Pfad, ueber den jede Analyse hereinkommt, ohne neuen Nutzen.
 *
 * `QUEUE_DISPATCH_CONCURRENCY` — steht im Profil und wird gelesen, aber die
 * Warteschlange bei Google zieht NICHT automatisch mit (fremdes System, siehe
 * kapazitaets-wache.js). Der Profilwert dient der Wartezeit-Rechnung; die
 * Wache meldet, wenn beide Seiten auseinanderlaufen.
 *
 * WAS BEWUSST NICHT HIER STEHT: Upload-Grenze (Sicherheitsgrenze),
 * Feldlaengen der Fehlererfassung (Datenschutzzusage in Zahlenform),
 * Modellname und EU-Endpunkt (Zusage an die Nutzer). Zur Laufzeit umschaltbar
 * waeren das Wege, eine Zusage unbemerkt zu brechen. Sie bleiben im Code, wo
 * sie eine Pruefkette durchlaufen.
 */

const { datenbank } = require("./db");
const {
  MISTRAL_TIMEOUT_MS,
  MISTRAL_SINGLE_LARGE_TIMEOUT_MS,
  MISTRAL_SINGLE_LARGE_MAX_TOKENS,
  MISTRAL_SLOWEST_TOKENS_PER_SECOND,
  REQUEST_BUDGET_MS,
  QUEUE_DISPATCH_CONCURRENCY,
  HOURLY_LIMIT,
  RATE_LIMIT,
} = require("./config");

const DOKUMENT = "config/betriebsprofil";
/* Wie die Feature-Flags: kurz genug, dass eine Umstellung in Sekunden wirkt,
   lang genug, dass nicht jeder Aufruf Firestore liest. */
const CACHE_MS = 30 * 1000;
/* Obergrenze, die Google der Function gibt. Kein Profil darf darueber. */
const FUNCTION_LIMIT_MS = 540 * 1000;

/* Die Werte, die ein Profil tragen darf — und ihre Herkunft im Code, die als
   Rueckfallebene gilt. Was hier nicht steht, ist nicht umstellbar. */
const ERLAUBT = {
  mistralTimeoutMs: MISTRAL_TIMEOUT_MS,
  singleLargeTimeoutMs: MISTRAL_SINGLE_LARGE_TIMEOUT_MS,
  singleLargeMaxTokens: MISTRAL_SINGLE_LARGE_MAX_TOKENS,
  requestBudgetMs: REQUEST_BUDGET_MS,
  parallelitaet: QUEUE_DISPATCH_CONCURRENCY,
  stundenlimit: HOURLY_LIMIT,
  adressLimit: RATE_LIMIT,
};

let cache = { zeit: 0, werte: null, quelle: "code" };

/** Die Code-Werte, unveraendert — die Rueckfallebene. */
function codeWerte() {
  return { ...ERLAUBT };
}

/**
 * Prueft einen Satz Werte auf Widerspruchsfreiheit.
 * Reine Rechnung, ohne Firestore — damit ohne Netzwerk pruefbar.
 *
 * Gibt `null` zurueck, wenn alles stimmt, sonst den Grund im Klartext.
 */
function pruefe(werte) {
  for (const [name, wert] of Object.entries(werte)) {
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      return `${name} ist keine positive Zahl (${JSON.stringify(wert)})`;
    }
  }
  /* Die Sicherung aus config.js: Die erlaubte Ausgabelaenge muss in die
     erlaubte Zeit passen. Sonst toetet die Uhr Laeufe, die das Token-Budget
     ausdruecklich zulaesst (BUG-2026-08-17-01). */
  const brauchtSekunden = werte.singleLargeMaxTokens / MISTRAL_SLOWEST_TOKENS_PER_SECOND;
  if (brauchtSekunden > werte.singleLargeTimeoutMs / 1000) {
    return (
      `singleLargeMaxTokens (${werte.singleLargeMaxTokens}) braucht bei ` +
      `${MISTRAL_SLOWEST_TOKENS_PER_SECOND} Token/s ${Math.round(brauchtSekunden)} s, ` +
      `singleLargeTimeoutMs erlaubt aber nur ${Math.round(werte.singleLargeTimeoutMs / 1000)} s`
    );
  }
  /* Jede Einzelgrenze unter dem Gesamtbudget. */
  for (const name of ["mistralTimeoutMs", "singleLargeTimeoutMs"]) {
    if (werte[name] > werte.requestBudgetMs) {
      return `${name} (${werte[name]} ms) liegt ueber requestBudgetMs (${werte.requestBudgetMs} ms)`;
    }
  }
  /* Das Gesamtbudget unter dem, was Google der Function gibt. */
  if (werte.requestBudgetMs > FUNCTION_LIMIT_MS) {
    return `requestBudgetMs (${werte.requestBudgetMs} ms) liegt ueber dem Function-Limit (${FUNCTION_LIMIT_MS} ms)`;
  }
  return null;
}

/**
 * Setzt ein Profil aus Firestore auf die Code-Werte auf.
 * Unbekannte Felder werden ignoriert, fehlende bleiben beim Code-Wert —
 * ein unvollstaendiges Profil ist damit brauchbar statt gefaehrlich.
 */
function zusammenfuehren(profil) {
  const werte = codeWerte();
  if (!profil || typeof profil !== "object") return werte;
  for (const name of Object.keys(ERLAUBT)) {
    if (typeof profil[name] === "number") werte[name] = profil[name];
  }
  return werte;
}

/**
 * Liest die geltenden Betriebswerte.
 *
 * Reihenfolge der Rueckfaelle, jede Stufe fuehrt zu den Code-Werten:
 *   kein Dokument · kein aktives Profil · Profil unbekannt · Pruefung
 *   fehlgeschlagen · Firestore nicht lesbar
 *
 * Der schlechteste Fall ist damit der heutige Zustand, nie ein schlechterer.
 */
async function geltendeWerte() {
  const jetzt = Date.now();
  if (cache.werte && jetzt - cache.zeit < CACHE_MS) return cache;

  let ergebnis = { werte: codeWerte(), quelle: "code", grund: null, profil: null };
  try {
    const snap = await datenbank().doc(DOKUMENT).get();
    if (snap.exists) {
      const daten = snap.data() || {};
      const aktiv = typeof daten.aktiv === "string" ? daten.aktiv : null;
      const profile = daten.profile && typeof daten.profile === "object" ? daten.profile : {};
      if (!aktiv) {
        ergebnis.grund = "kein aktives Profil benannt";
      } else if (!profile[aktiv]) {
        ergebnis.grund = `Profil "${aktiv}" ist nicht hinterlegt`;
      } else {
        const werte = zusammenfuehren(profile[aktiv]);
        const fehler = pruefe(werte);
        if (fehler) {
          ergebnis.grund = `Profil "${aktiv}" abgelehnt: ${fehler}`;
        } else {
          ergebnis = { werte, quelle: "firestore", grund: null, profil: aktiv };
        }
      }
    } else {
      ergebnis.grund = "kein Dokument";
    }
  } catch (fehler) {
    ergebnis.grund = `nicht lesbar: ${String(fehler.message)}`;
  }

  cache = { zeit: jetzt, ...ergebnis };
  return cache;
}

/* Fuer Tests: Cache leeren, damit jede Pruefung frisch liest. */
function _cacheLeeren() {
  cache = { zeit: 0, werte: null, quelle: "code" };
}

module.exports = {
  geltendeWerte,
  codeWerte,
  _pruefe: pruefe,
  _zusammenfuehren: zusammenfuehren,
  _cacheLeeren,
  _DOKUMENT: DOKUMENT,
  _ERLAUBT: ERLAUBT,
};
