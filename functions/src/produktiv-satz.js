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
  requestBudgetMs: 480000,

  /* GESENKT 08.09.2026 von 4 auf 3 — nachgerechnet am Vorfall vom selben
     Vormittag (eine Klasse, 47 Analysen, 6 Ablehnungen "429 Rate limit").
     Der Wert 4 war am 30.08. für 40 s je Aufruf gerechnet; am 08.09. lagen
     die Aufrufe bei 29 s (Median), und vier parallele Aufträge machten damit
     16 Aufrufe je Minute bei erlaubten 15. Mit drei sind es höchstens 12 —
     auch im Anfangsschub, den die Warteschlange (Burst 10) durchlässt. Die
     Nachrechnung mit den gemessenen Ankunfts- und Dauerdaten des Tages:
     4 → 6 bis 11 Ablehnungen, 3 → keine; auch bei zwei Klassen zugleich. */
  parallelitaet: 3,

  /* DIE GLOBALE BREMSE. Sie wird von der `satzWache` in die echte
     Cloud-Tasks-Queue übertragen (`maxDispatchesPerSecond`) und wirkt damit
     über alle Instanzen — anders als `tokenAbstand*`, das nur im
     Arbeitsspeicher einer einzelnen Instanz zählt und bei Andrang deshalb
     prinzipiell nicht greifen kann.

     Rechnung: Mistral-Stufe T1 erlaubt 15 Aufrufe je 60 Sekunden (gemessen
     08.09.2026: jede Ablehnung kam genau dann, wenn in den 60 s davor 15
     Aufrufe angenommen worden waren). Jede Analyse macht zwei Aufrufe
     (Analyse + Beast-Werbung), also höchstens 7,5 Analysen je Minute =
     0,125 je Sekunde. GENAU DIESER WERT stand hier bis zum 08.09. — ohne
     Abstand zur Grenze, und die Grenze riss. Jetzt 0,1 (6 je Minute, 12
     Aufrufe), ein Fünftel Abstand.

     BEI EINER HÖHEREN MISTRAL-STUFE darf der Wert steigen — aber erst nach
     einem Blick ins Mistral-Dashboard, nicht nach Gefühl. */
  queueRatePerSekunde: 0.1,

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
  /* GESENKT 30.08.2026 von 6 auf 4 und am 08.09.2026 mit `parallelitaet`
     auf 3. Die Drossel darf nie groesser sein als die Warteschlange
     durchlaesst — eine Bremse hinter einer schaerferen Bremse ist keine
     Bremse, sondern toter Code mit dem Anschein von Sicherheit. Der Doku-Test
     erzwingt das Verhaeltnis. Und sie zaehlt nur je Server-Instanz: Am
     08.09. liefen sieben Instanzen zugleich, jede hielt fuer sich Abstand. */
  drosselMaxParallel: 3,
  drosselWartelimitMs: 360000,

  /* MINDESTABSTAND ZWISCHEN KI-AUFRUFEN, gemessen 30.08.2026. Hier standen
     800 ms; erlaubt sind auf Stufe T1 vier Sekunden. Wirkt nur innerhalb einer
     Instanz — die verlässliche Bremse ist `queueRatePerSekunde`. */
  tokenAbstandGrossMs: 4000,

  /* DAS NETZ UNTER DER BREMSE (08.09.2026). Lehnt Mistral ab (429) oder ist
     kurz weg (502/503/504), wartet der Auftrag 10, 20, 40, 80 Sekunden und
     versucht es wieder — vier Mal, statt wie bisher einmal nach 2 Sekunden.
     Zwei Sekunden waren bei einem Limit von einem Aufruf je vier Sekunden
     aussichtslos: Am 08.09. bekamen alle sechs abgelehnten Aufträge beim
     zweiten Versuch wieder 429.

     NICHT GESCHÄTZT, SONDERN GERECHNET: Nachrechnung mit den gemessenen
     Ankunfts- und Dauerdaten des Vormittags, unter verschärften Annahmen
     (Mistral zählt 12 statt 15 je Minute, Aufrufe 40 % schneller, zwei
     Klassen zugleich): 10/20/40/80 → im Mittel 0,1 endgültige Ausfälle je
     Doppelklasse, nie mehr als einer; 10/20/40 → 0,6 (bis 3); die alte Logik
     → 12. Die Summe (150 s) liegt weit unter dem Gesamtbudget (480 s); was
     der Hauptaufruf schon verbraucht hat, kürzt die Reihe — wiederholt wird
     nur, solange das Restbudget für die nächste Wartezeit reicht. Nennt
     Mistral in der Antwort eine Wartezeit (Retry-After), gilt die längere. */
  ueberlastWarteMs: 10000,
  ueberlastVersuche: 4,

  jobAufbewahrungMs: 7200000,
  zustellfensterMs: 900000,
  livenessGnadenfristMs: 480000,
  verarbeitungsZeitlimitMs: 540000,
  wartendesHoechstalterMs: 2100000,
  aufraeumStapel: 200,
  ticketGueltigkeitMs: 1800000,
};

/* Eine vorbereitete Alternative, damit im Ernstfall EIN Feld umgestellt wird
   statt jedes Wertes einzeln. */
const PROFILE = {
  "t1-normal": T1_NORMAL,

  /* Wenn die KI langsamer wird — der Fall vom 28.08.2026. Die Bremse bleibt
     gleich: Sie hängt am Mistral-LIMIT, nicht an der Geschwindigkeit. */
  "t1-langsam": {
    ...T1_NORMAL,
    singleLargeTimeoutMs: 450000,
    durchschnittsdauerSekunden: 110,
  },
};

/* AUSGEMUSTERT — Uebergang beim Ausbau des Drei-Aufruf-Wegs (10.09.2026).
   Der Code kennt diese Felder und diesen Satz nicht mehr. In der Datenbank
   stehen sie noch, weil der BISHER laufende Code diese Felder als
   Pflichtfelder liest: Sie vor dem Ausliefern zu loeschen, hiesse, der
   laufenden Seite den Einstellungssatz ungueltig zu machen (die satzWache
   schlaegt Alarm, und keine Analyse laeuft). Reihenfolge deshalb: ausliefern,
   dann `node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`,
   dann diese Liste leeren.

   Bis dahin meldet der Abgleich vor dem Deploy (betriebsprofil-vergleichen.js)
   genau diese Reste als Hinweis statt als Abweichung — nichts anderes. Nach
   `bis` gelten sie dort wieder als Abweichung, und der Test
   ausgemustert-uebergang.test.js wird rot: Der Uebergang darf kein
   Dauerzustand werden. */
const AUSGEMUSTERT = {
  bis: "2026-09-24",
  /* LEER seit 10.09.2026: nach dem Deploy von 4.9.0 neu geschrieben. Zuletzt
     standen hier describeMaxTokens, profileMaxTokens, tokenAbstandKleinMs und
     der Satz t1-drei-call (docs/SECURITY-MODEL.md, Abschnitt zur Duldung). */
  felder: [],
  saetze: [],
};

module.exports = { PROFILE, T1_NORMAL, AKTIV: "t1-normal", AUSGEMUSTERT };
