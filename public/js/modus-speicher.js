/* ── Merken der Modus-Wahl (seriös / Beast) über ein Neuladen hinweg ──
 *
 * ANLASS (im Betrieb aufgefallen, 2026-08-11): Wer im Beast Mode die Seite neu lädt,
 * landete wieder im seriösen Modus. Im laufenden Durchgang ist das ärgerlich —
 * das Ergebnis wird nach dem Neuladen ja wiederhergestellt, aber im falschen
 * Modus, und die Umschaltung muss von Hand wiederholt werden.
 *
 * Vorher war das ausdrücklich so gewollt („Beast startet immer ausgeschaltet").
 * Die Regel ist präzisiert, und die Präzisierung trifft es genau:
 *
 *   „Beast startet immer ausgeschaltet — das stimmt, aber ein Reload ist
 *    kein Start."
 *
 * Der didaktische Sinn bleibt also erhalten, die Umsetzung ändert sich:
 *
 *   sessionStorage, NICHT localStorage.
 *
 * Damit überlebt die Wahl ein Neuladen und einen Tab-Wechsel, aber NICHT das
 * Schliessen des Tabs. Wer die Seite frisch aufruft — im Workshop also jede
 * neue Person, jedes weitergereichte Gerät — startet wieder im seriösen Modus
 * und erlebt den Kontrast selbst. Genau der Punkt, um den es didaktisch geht.
 *
 * Dieselbe Ablage nutzt schon die Job-Nummer (api.js); Datenschutz-Bewertung
 * daher unverändert: nichts Personenbezogenes, endet mit dem Tab.
 */

const SCHLUESSEL = "malzime.beastMode";

/**
 * Merkt die Modus-Wahl. Fehler werden geschluckt: Im privaten Modus kann
 * sessionStorage werfen, und daran darf die Umschaltung nicht scheitern —
 * sie funktioniert dann eben nur ohne Gedächtnis.
 */
export function merkeModus(beastAktiv) {
  try {
    sessionStorage.setItem(SCHLUESSEL, beastAktiv ? "1" : "0");
  } catch (_err) {
    /* kein Gedächtnis verfügbar — kein Grund, irgendetwas abzubrechen */
  }
}

/**
 * Liefert die gemerkte Wahl, oder `null`, wenn nichts gemerkt ist.
 *
 * Bewusst `null` statt `false`: Der Aufrufer muss „nie gewählt" von „bewusst
 * seriös gewählt" unterscheiden können. Sonst würde ein leerer Speicher wie
 * eine aktive Entscheidung aussehen und könnte eine vom Browser
 * wiederhergestellte Checkbox überschreiben.
 */
export function gemerkterModus() {
  try {
    const wert = sessionStorage.getItem(SCHLUESSEL);
    if (wert === "1") return true;
    if (wert === "0") return false;
    return null;
  } catch (_err) {
    return null;
  }
}

/** Vergisst die Wahl (für Tests und einen möglichen Zurücksetzen-Knopf). */
export function vergissModus() {
  try {
    sessionStorage.removeItem(SCHLUESSEL);
  } catch (_err) {
    /* nichts zu tun */
  }
}
