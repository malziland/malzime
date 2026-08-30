"use strict";

/**
 * produktiv-satz.js — die Werte, die im ECHTEN Betrieb gelten sollen.
 *
 * WARUM DIESE DATEI EXISTIERT (Befund 30.08.2026): Die Werte standen in
 * `scripts/betriebsprofil-anlegen.js`. Das ist ein ausführbares Skript — es
 * prüft, gibt aus und beendet sich. Ein Test kann es deshalb nicht lesen.
 *
 * Die Folge war eine Doku, die log: `docs/BETRIEBSPROFILE.md` behauptete in
 * der Spalte "heute" die Werte 7 und 65, während in der Produktion 4 und 40
 * liefen. Der Test `satz-gegen-doku.test.js` hielt die Doku gegen den
 * TESTSATZ — und der trug zufällig dieselben veralteten Zahlen. Beide Seiten
 * stimmten überein, und beide waren falsch. Ein grüner Test über zwei
 * gleichlautende Irrtümer.
 *
 * Seitdem liegen die Betriebswerte hier, als reines Datenmodul ohne
 * Seiteneffekte. Das Anlege-Skript schreibt sie in die Datenbank, der Test
 * hält die Doku dagegen. Eine Quelle, zwei Leser.
 *
 * NICHT ZU VERWECHSELN MIT `test-satz.js`: Der Testsatz darf sich mit den
 * Tests ändern und trägt bewusst andere Zahlen, damit ein Test nicht zufällig
 * grün wird, wenn der Code eine Konstante statt des Satzwertes liest.
 */

/* Der Alltag. Jede Zahl hier ist gemessen oder begründet — siehe die
   Kommentare an den Stellen, wo die Begründung nicht offensichtlich ist. */
const T1_NORMAL = {
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  describeMaxTokens: 2048,
  profileMaxTokens: 16000,
  requestBudgetMs: 480000,

  /* GESENKT 30.08.2026 von 7 auf 4 — gemessen, nicht geschätzt. Sieben
     gleichzeitige Analysen sind zwei Mistral-Aufrufe je Analyse, also 0,39
     Aufrufe pro Sekunde bei erlaubten 0,25. Wir fuhren seit jeher darüber; im
     Alltag fällt es nicht auf, bei echtem Andrang schon. */
  parallelitaet: 4,

  /* DIE GLOBALE BREMSE. Sie wird von der `satzWache` in die echte
     Cloud-Tasks-Queue übertragen (`maxDispatchesPerSecond`) und wirkt damit
     über alle Instanzen — anders als `tokenAbstand*`, das nur im
     Arbeitsspeicher einer einzelnen Instanz zählt und bei Andrang deshalb
     prinzipiell nicht greifen kann.

     Rechnung: Mistral-Stufe T1 erlaubt 0,25 Aufrufe pro Sekunde, jede Analyse
     macht zwei (Analyse + Beast-Werbung) -> 0,125 Analysen pro Sekunde, also
     eine alle acht Sekunden.

     BEI EINER HÖHEREN MISTRAL-STUFE darf der Wert steigen — aber erst nach
     einem Blick ins Mistral-Dashboard, nicht nach Gefühl. */
  queueRatePerSekunde: 0.125,

  warteschlangeTiefe: 155,

  /* GEMESSEN 30.08.2026 an der Produktion: Median 40 s (Spanne 34–41), nicht
     65. Der Wert steuert die angezeigte Wartezeit — zu hoch heißt, die Leute
     warten auf eine Zahl, die nie eintrifft. */
  durchschnittsdauerSekunden: 40,

  stundenlimit: 500,
  stundenfensterMinuten: 60,
  adressLimit: 500,
  adressfensterMs: 600000,
  boostFaktor: 2,
  boostFristMs: 7200000,
  /* GESENKT 30.08.2026 von 6 auf 4. Sechs war groesser als `parallelitaet`
     (4) — die Drossel haette also nie greifen koennen, weil die Warteschlange
     ohnehin nur vier gleichzeitig durchlaesst. Eine Bremse hinter einer
     schaerferen Bremse ist keine Bremse, sondern toter Code mit dem Anschein
     von Sicherheit. Aufgefallen, weil der Doku-Test seit heute gegen die
     echten Betriebswerte prueft. */
  drosselMaxParallel: 4,
  drosselWartelimitMs: 360000,

  /* MINDESTABSTAND ZWISCHEN KI-AUFRUFEN, gemessen 30.08.2026. Hier standen
     800 ms; erlaubt sind auf Stufe T1 vier Sekunden. Wirkt nur innerhalb einer
     Instanz — die verlässliche Bremse ist `queueRatePerSekunde`. */
  tokenAbstandGrossMs: 4000,
  tokenAbstandKleinMs: 4000,

  jobAufbewahrungMs: 7200000,
  zustellfensterMs: 900000,
  livenessGnadenfristMs: 480000,
  verarbeitungsZeitlimitMs: 540000,
  wartendesHoechstalterMs: 2100000,
  aufraeumStapel: 200,
  ticketGueltigkeitMs: 1800000,
};

/* Zwei vorbereitete Alternativen, damit im Ernstfall EIN Feld umgestellt wird
   statt siebenundzwanzig. */
const PROFILE = {
  "t1-normal": T1_NORMAL,

  /* Wenn die KI langsamer wird — der Fall vom 28.08.2026. Die Bremse bleibt
     gleich: Sie hängt am Mistral-LIMIT, nicht an der Geschwindigkeit. */
  "t1-langsam": {
    ...T1_NORMAL,
    singleLargeTimeoutMs: 450000,
    durchschnittsdauerSekunden: 110,
  },

  /* Rollback auf die 3-Call-Pipeline, ohne Deploy. Ersetzt den früheren
     Drei-Schritte-Rollback aus dem RUNBOOK.

     ACHTUNG, die Bremse steht hier ANDERS: Dieser Pfad macht DREI
     Mistral-Aufrufe je Analyse statt zwei. 0,25 / 3 = 0,083. Wer das vergisst,
     läuft auf dem Rollback-Pfad in genau die Fehler, vor denen der Rollback
     schützen soll. */
  "t1-drei-call": {
    ...T1_NORMAL,
    parallelitaet: 3,
    queueRatePerSekunde: 0.083,
    durchschnittsdauerSekunden: 100,
  },
};

module.exports = { PROFILE, T1_NORMAL, AKTIV: "t1-normal" };
