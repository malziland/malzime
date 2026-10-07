"use strict";

/**
 * betriebsprofil-kopplung.js — welche Werte eines Einstellungssatzes
 * zusammenpassen muessen.
 *
 * Aus betriebsprofil.js herausgeloest: Dort stehen die Felder mit ihren
 * Bereichen und das Lesen aus der Datenbank; hier steht, was zwischen den
 * Feldern gilt — und zwischen einem Feld und einer festen Groesse des
 * Programms. Reine Rechnung, ohne Datenbank.
 *
 * Aufgerufen wird nur `pruefeKopplungen` aus `pruefe()` in betriebsprofil.js,
 * NACHDEM Vollstaendigkeit und Bereiche geprueft sind.
 */

/* Das gemessene Schreibtempo der KI — ein Messergebnis, kein Sollwert. */
const { MISTRAL_SLOWEST_TOKENS_PER_SECOND } = require("./config");

/* Obergrenze, die Google der Function gibt. Kein Profil darf darueber. */
const FUNCTION_LIMIT_MS = 540 * 1000;

/* DREI FESTE GROESSEN FUER DIE VIER LETZTEN REGELN UNTEN (BUG-2026-10-03-33).
   Sie beschreiben, wie das Programm gebaut ist, nicht wie es eingestellt wird. */

/* BLEIBT IM CODE — Bauweise, keine Einstellung: So lange laeuft der
   Werbe-Aufruf hoechstens, und zwar NACH dem Gesamtbudget (mistral.js,
   generateBeastAds: `timeoutMs`). Dieselbe Zahl an zwei Orten —
   betriebsprofil-kopplung.test.js haelt sie gleich. NICHT mitgerechnet ist
   der Abstand, den die eigene Drossel davor einhaelt (mistral-http.js; ein
   Auftrag je Instanz, also hoechstens der Raten-Abstand `tokenAbstandGrossMs`). */
const WERBE_AUFRUF_HOECHSTENS_MS = 30 * 1000;
/* BLEIBT IM CODE — Bauweise, keine Einstellung: was der Verarbeiter um die
   Analyse herum braucht (Auftrag uebernehmen, Foto laden, Ergebnis speichern
   mit Wiederholung, Foto loeschen). */
const RESERVE_NACH_ANALYSE_MS = 10 * 1000;
/* BLEIBT IM CODE — Schutzgrenze, keine Einstellung: Untergrenze der Karenz fuer
   verlassene Auftraege. Das Doppelte des Zaehler-Nachlaufs (counter.js,
   NACHLAUF_HOECHSTENS_MS = 60 s, "klar unter der Karenz") und damit das
   Vierfache des Mindestabstands, in dem die Statusabfrage das Lebenszeichen
   schreibt (handle-job-status.js, 30 s). */
const KARENZ_MINDESTENS_MS = 120 * 1000;

/**
 * Gibt `null` zurueck, wenn die Werte zusammenpassen, sonst den Grund im
 * Klartext.
 */
function pruefeKopplungen(werte) {
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
  /* Die Wartezeiten bei Ueberlast muessen ins Gesamtbudget passen:
     warte + 2·warte + 4·warte + … = warte·(2^n − 1). Liegt die Summe ueber
     dem Budget, koennten die letzten Wiederholungen NIE stattfinden — der
     Satz verspraeche ein Netz, das es nicht gibt. Was der Hauptaufruf vorher
     verbraucht hat, regelt der Aufruf selbst: Er wiederholt nur, solange das
     Restbudget fuer die naechste Wartezeit reicht (mistral-http.js). Deshalb
     zaehlt hier die Summe allein, nicht Summe plus Aufrufdauer — sonst waere
     der Langsam-Satz (450 s Aufruf) ohne Netz. (08.09.2026) */
  const wartesummeMs = werte.ueberlastWarteMs * (2 ** werte.ueberlastVersuche - 1);
  if (wartesummeMs >= werte.requestBudgetMs) {
    return (
      `ueberlastWarteMs (${werte.ueberlastWarteMs}) × ${werte.ueberlastVersuche} Wiederholungen ergeben ` +
      `${Math.round(wartesummeMs / 1000)} s Wartezeit — mehr als requestBudgetMs ` +
      `(${Math.round(werte.requestBudgetMs / 1000)} s); die letzten Wiederholungen faenden nie statt`
    );
  }
  /* Das Zustellfenster darf die Aufbewahrung nicht ueberschreiten — sonst
     wartet der Reaper auf ein Fenster, das nach der Loeschung endet. */
  if (werte.zustellfensterMs > werte.jobAufbewahrungMs) {
    return (
      `zustellfensterMs (${werte.zustellfensterMs} ms) liegt ueber ` +
      `jobAufbewahrungMs (${werte.jobAufbewahrungMs} ms) — das Ergebnis waere ` +
      `geloescht, bevor das Wiederholungsfenster endet`
    );
  }
  /* Das Gesamtbudget unter dem, was Google der Function gibt. */
  if (werte.requestBudgetMs > FUNCTION_LIMIT_MS) {
    return `requestBudgetMs (${werte.requestBudgetMs} ms) liegt ueber dem Function-Limit (${FUNCTION_LIMIT_MS} ms)`;
  }

  /* VIER KOPPLUNGSREGELN (BUG-2026-10-03-33). Jeder dieser Werte liegt fuer
     sich im erlaubten Bereich; zusammen mit einer festen Groesse des Programms
     wuergt er laufende oder wartende Auftraege ab. */

  /* 1. Das Haenge-Limit nicht unter der Zeitgrenze der Function: So lange darf
        der Verarbeiter rechnen. Laege das Limit darunter, setzte die
        Statusabfrage eine laufende Analyse auf "gescheitert", und das fertige
        Ergebnis wuerde verworfen. */
  if (werte.verarbeitungsZeitlimitMs < FUNCTION_LIMIT_MS) {
    return (
      `verarbeitungsZeitlimitMs (${werte.verarbeitungsZeitlimitMs} ms) liegt unter dem ` +
      `Function-Limit (${FUNCTION_LIMIT_MS} ms) — laufende Analysen wuerden als gescheitert abgeraeumt`
    );
  }
  /* 2. Nach dem Gesamtbudget laeuft noch der Werbe-Aufruf; dazu die Arbeit um
        die Analyse herum. Alles zusammen muss in die Zeitgrenze passen. */
  if (werte.requestBudgetMs + WERBE_AUFRUF_HOECHSTENS_MS + RESERVE_NACH_ANALYSE_MS > FUNCTION_LIMIT_MS) {
    return (
      `requestBudgetMs (${werte.requestBudgetMs} ms) laesst dem Werbe-Aufruf ` +
      `(${WERBE_AUFRUF_HOECHSTENS_MS} ms) und dem Abschluss (${RESERVE_NACH_ANALYSE_MS} ms) keinen Platz ` +
      `unter dem Function-Limit (${FUNCTION_LIMIT_MS} ms)`
    );
  }
  /* 3. Die Karenz klar ueber dem Nachlauf des Stundenzaehlers und dem Abstand
        des Lebenszeichens — sonst gilt als verlassen, wer noch wartet. */
  if (werte.livenessGnadenfristMs < KARENZ_MINDESTENS_MS) {
    return (
      `livenessGnadenfristMs (${werte.livenessGnadenfristMs} ms) liegt unter ${KARENZ_MINDESTENS_MS} ms — ` +
      `wartende Auftraege wuerden als verlassen abgeraeumt, obwohl ihr Browser noch nachfragt`
    );
  }
  /* 4. Ein Auftrag darf bis zum Hoechstalter warten und danach bis zum
        Haenge-Limit rechnen. Erst dann darf die Aufbewahrung enden — sonst
        loeschte der Aufraeumdienst Foto und Auftrag einer LAUFENDEN Analyse. */
  if (werte.wartendesHoechstalterMs + werte.verarbeitungsZeitlimitMs > werte.jobAufbewahrungMs) {
    return (
      `wartendesHoechstalterMs (${werte.wartendesHoechstalterMs} ms) und verarbeitungsZeitlimitMs ` +
      `(${werte.verarbeitungsZeitlimitMs} ms) liegen zusammen ueber jobAufbewahrungMs ` +
      `(${werte.jobAufbewahrungMs} ms) — ein Auftrag waere geloescht, waehrend er noch wartet oder rechnet`
    );
  }
  return null;
}

module.exports = {
  pruefeKopplungen,
  FUNCTION_LIMIT_MS,
  WERBE_AUFRUF_HOECHSTENS_MS,
  RESERVE_NACH_ANALYSE_MS,
  KARENZ_MINDESTENS_MS,
};
