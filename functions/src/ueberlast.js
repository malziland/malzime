"use strict";

/**
 * ueberlast.js — was ein Mistral-Aufruf tut, wenn Mistral ablehnt (429) oder
 * kurz weg ist (502, 503, 504).
 *
 * BELEG 08.09.2026, 12:19–12:27 Wien: Eine Klasse lud 47 Fotos hoch, 6
 * Analysen scheiterten mit "429 Rate limit exceeded". Jede Ablehnung kam
 * genau dann, wenn in den 60 s davor 15 Aufrufe angenommen worden waren
 * (Stufe T1). Der Code wiederholte EINMAL nach 2 s — bei einem Aufruf je vier
 * Sekunden aussichtslos: alle sechs bekamen beim zweiten Versuch wieder 429,
 * die Auftraege wurden "blocked", sechs Kinder sahen "technischer Fehler".
 *
 * Seitdem: Wartezeiten aus dem Einstellungssatz (ueberlastWarteMs,
 * ueberlastVersuche), verdoppelnd — im Betrieb 10, 20, 40, 80 s. Herleitung
 * in produktiv-satz.js. Waehrend des Wartens bleibt der Platz in der
 * Warteschlange belegt; genau das nimmt Last von Mistral.
 *
 * Ein 500 oder 4xx wird nicht wiederholt: Das ist eine Antwort auf genau
 * diese Anfrage, keine Stoerung. (503-Beleg vom 07.09.2026 in
 * mistral-503-wiederholung.test.js.)
 */

const WIEDERHOLBARE_STATUS = new Set([429, 502, 503, 504]);

/* Die Reihe der Wartezeiten: jede Wiederholung wartet doppelt so lang wie
   die vorige. */
function ueberlastWartezeiten(werte) {
  const reihe = [];
  for (let i = 0; i < werte.ueberlastVersuche; i++) reihe.push(werte.ueberlastWarteMs * 2 ** i);
  return reihe;
}

/* Retry-After, wie Mistral es mitschicken KANN (HTTP-Standard: Sekunden).
   Die Dokumentation von Mistral nennt den Kopf nicht; ob er kommt, zeigt erst
   der naechste echte 429 — deshalb wird er bei jeder Wiederholung geloggt.
   Nur eine Zahl von Sekunden wird verstanden; ein Datum (ebenfalls erlaubt)
   wird ignoriert, dann gilt die eigene Reihe. */
function retryAfterSekunden(res) {
  try {
    const roh = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
    if (roh == null || roh === "") return null;
    const n = Number(roh);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch (_) {
    return null;
  }
}

/**
 * Entscheidet nach einer wiederholbaren Antwort, ob und wie lange gewartet
 * wird, und schreibt eine Logzeile je Wiederholung — damit die naechste
 * Logauswertung sieht, wie oft das Netz greift.
 *
 * @returns {{ wartezeitMs: number, retryAfter: number|null, aufgeben: boolean }}
 */
function planeWiederholung({ res, attempt, backoffs, aufrufStart, timeoutMs }) {
  /* Nennt Mistral selbst eine Wartezeit, gilt die laengere von beiden:
     Kuerzer als geplant zu warten hiesse, gegen ein Fenster zu laufen, das
     noch nicht auf ist. */
  const retryAfter = retryAfterSekunden(res);
  const wartezeitMs = Math.max(backoffs[attempt], retryAfter != null ? retryAfter * 1000 : 0);
  /* Reicht das Restbudget des Auftrags nicht mehr fuer die Wartezeit, wird
     nicht gewartet, sondern aufgegeben — sonst reisst die Uhr des Durchlaufs
     mitten in der Pause, und der Fehler saehe aus wie eine
     Zeitueberschreitung statt wie Ueberlast. */
  const aufgeben = timeoutMs != null && Date.now() - aufrufStart + wartezeitMs >= timeoutMs;
  console.log(
    JSON.stringify({
      step: "mistral-wiederholung",
      status: res.status,
      versuch: attempt + 1,
      wartezeitMs,
      retryAfter,
      ...(aufgeben ? { aufgegeben: "restbudget reicht nicht" } : {}),
    })
  );
  return { wartezeitMs, retryAfter, aufgeben };
}

module.exports = { WIEDERHOLBARE_STATUS, ueberlastWartezeiten, planeWiederholung };
