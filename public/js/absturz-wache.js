/**
 * absturz-wache.js — erkennt, wenn die Seite wiederholt in kurzer Folge neu
 * startet, meldet es einmalig und bricht die Schleife.
 *
 * ANLASS (2026-08-11): Auf einem iPhone erschien wiederholt Safaris Meldung
 * „Auf https://malzi.me/ ist wiederholt ein Problem aufgetreten." Sechs
 * Erklärungen wurden geprüft und ausgeschlossen: die 2-Stunden-Frist der
 * Aufträge (wird sauber abgefangen), eine Neulade-Schleife am Stundenlimit
 * (Limit war bei 0 von 500), ein Absturz beim Sprachdatei-Laden (ist
 * abgefangen), das Foto als Speicherfresser (liegt als Verweis vor, nicht als
 * Zeichenkette), die Abfrage-Schleife samt Wartefunktion (beide sauber
 * begrenzt) und der DNS-Ausfall desselben Tages (zeitlich ausgeschlossen).
 *
 * DAS EIGENTLICHE PROBLEM: Wenn diese Meldung erscheint, läuft unser Code
 * nicht — deshalb kommt auch keine Fehlermeldung an. Das Ereignis ist
 * unsichtbar, und Weiterraten kostet nur Zeit. Diese Datei macht es sichtbar.
 *
 * ZWEI AUFGABEN:
 *
 *   1. Melden. Startet die Seite mehrfach binnen einer Minute, ist das kein
 *      normales Verhalten — dann geht EINE Meldung über den vorhandenen
 *      Diagnose-Kanal raus. Keine neue Datenart: Anzahl der Starts, Zeitspanne,
 *      ob ein Auftrag offen war, wie weit die Seite zuletzt kam.
 *
 *   2. Die Schleife brechen. Hängt der Absturz an einem bestimmten
 *      wiederaufgenommenen Auftrag, wiederholt er sich bei jedem Start endlos.
 *      Wird eine Schleife erkannt, wird der gemerkte Auftrag verworfen — der
 *      nächste Start beginnt sauber. Lieber ein verlorenes Ergebnis als eine
 *      Seite, die sich nicht mehr öffnen lässt.
 *
 * sessionStorage überlebt einen Absturz und den Neustart des Tabs, endet aber
 * mit dem Tab — genau die Lebensdauer, die hier gebraucht wird.
 */

import { logClientError } from "./error-logger.js";

const STARTS_SCHLUESSEL = "malzime.starts";
const PHASE_SCHLUESSEL = "malzime.letztePhase";

/* Drei Starts binnen einer Minute. Zwei wären zu wenig — ein bewusstes
   Neuladen direkt nach dem Öffnen ist normal und soll nichts auslösen. */
const FENSTER_MS = 60 * 1000;
const SCHWELLE = 3;

function lies(schluessel) {
  try {
    return sessionStorage.getItem(schluessel);
  } catch (_err) {
    return null;
  }
}

function schreibe(schluessel, wert) {
  try {
    sessionStorage.setItem(schluessel, wert);
  } catch (_err) {
    /* Kein Gedächtnis verfügbar — dann eben keine Wache. Nie ein harter Fehler. */
  }
}

/**
 * Hält fest, wie weit die Seite gekommen ist. Stirbt sie danach, steht in der
 * Meldung, an welcher Stelle — das ist der Unterschied zwischen „irgendwo" und
 * einer verwertbaren Spur.
 */
export function merkePhase(name) {
  schreibe(PHASE_SCHLUESSEL, String(name).slice(0, 40));
}

/**
 * Muss als eine der ERSTEN Zeilen beim Seitenstart laufen — sonst zählt ein
 * Absturz, der vor diesem Aufruf passiert, gar nicht mit.
 *
 * @param {object} haken
 * @param {Function} haken.verwirfAuftrag  wird bei erkannter Schleife gerufen
 * @returns {boolean} true, wenn eine Schleife erkannt wurde
 */
export function initAbsturzWache({ verwirfAuftrag } = {}) {
  const jetzt = Date.now();

  let starts = [];
  try {
    const roh = lies(STARTS_SCHLUESSEL);
    if (roh) starts = JSON.parse(roh).filter((z) => typeof z === "number");
  } catch (_err) {
    starts = [];
  }

  /* Nur das gleitende Fenster behalten; alles Ältere ist bedeutungslos. */
  starts = starts.filter((z) => jetzt - z < FENSTER_MS);
  starts.push(jetzt);
  schreibe(STARTS_SCHLUESSEL, JSON.stringify(starts.slice(-SCHWELLE)));

  if (starts.length < SCHWELLE) return false;

  /* ── Schleife erkannt ── */
  const spanneMs = jetzt - starts[0];
  const letztePhase = lies(PHASE_SCHLUESSEL) || "unbekannt";
  let hatteAuftrag = false;
  try {
    hatteAuftrag = Boolean(sessionStorage.getItem("malzime.queueJobId"));
  } catch (_err) {
    /* egal — dann steht eben false in der Meldung */
  }

  /* Zähler sofort zurücksetzen: Die Meldung soll EINMAL rausgehen, nicht bei
     jedem weiteren Start erneut. */
  schreibe(STARTS_SCHLUESSEL, "[]");

  /* Schleife brechen, bevor irgendetwas anderes läuft. */
  if (typeof verwirfAuftrag === "function") {
    try {
      verwirfAuftrag();
    } catch (_err) {
      /* Aufräumen darf den Start nie verhindern. */
    }
  }

  logClientError(new Error(`Seite ${starts.length}x in ${Math.round(spanneMs / 1000)}s neu gestartet`), {
    phase: "absturz-schleife",
    durationMs: spanneMs,
    errorDetail: `starts=${starts.length} letztePhase=${letztePhase} offenerAuftrag=${hatteAuftrag}`,
  });

  return true;
}
