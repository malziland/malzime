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
  /* 410 s: 16000 Token bei der langsamsten je gemessenen Geschwindigkeit
     (39,4 Token/s). Die Kopplung verlangt das. Large 4 selbst bricht frueher ab
     (analyseZeitgrenzeMs in config.js) und versucht es ein zweites Mal. */
  singleLargeTimeoutMs: 410000,
  /* 16000 seit dem Wechsel auf Large 4: Das Nachdenken zaehlt zu den
     Antwort-Token (gemessen 31.10.2026 rund 10.500 je Analyse, Spitze 15.500). */
  singleLargeMaxTokens: 16000,
  requestBudgetMs: 480000,

  /* WIEDER 4 SEIT 16.09.2026 (Freigabe Christoph nach dem Workshop-Tag).
     Am 08.09. von 4 auf 3 gesenkt, weil Mistral (Stufe T1, 15 Aufrufe je
     60 s) bei 4 parallelen Aufträgen und damals nur einem Wiederholversuch
     nach 2 s sechs Analysen einer Klasse ablehnte. Im selben Schritt kam das
     Netz unten (ueberlastWarteMs/ueberlastVersuche) dazu — beides zusammen
     war doppelt abgesichert und kostete Wartezeit: Am 16.09. (199 Analysen,
     0 Ablehnungen, höchstens 12 Aufrufe je 60 s) dauerte es vom Einreihen
     bis zum Ergebnis im Median 126 s, 43 von 193 warteten über 3 Minuten,
     29 fertige Ergebnisse wurden nie abgeholt.
     Nachrechnung mit den Ankunftszeiten und Dauern dieses Tages (Mistral-
     Grenze 15/60 s, Burst 10, Netz 10/20/40/80 s, je 20 Läufe; das Modell
     traf den gemessenen Median bis auf 5 %): 4 → Median rund 60 s, praktisch
     niemand über 3 Minuten, im Mittel 2 Ablehnungen (höchstens 6), die das
     Netz auffängt, 0 gescheiterte Analysen; bei 30 % schnellerem Mistral
     rund 30 Ablehnungen, weiterhin 0 gescheiterte. Rückweg: 3 eintragen,
     die satzWache zieht die Warteschlange binnen Sekunden nach.

     6 SEIT 31.10.2026 (Vorgabe Christoph). Gemessen mit 30 Fotos direkt gegen
     Mistral, 8 zugleich: 30 von 30 fertig in 145 s, 60 Aufrufe, keine
     Ablehnung, zuletzt nur 5 von 30 Aufrufen je Minute frei. 8 waere fuer eine
     zweite Klasse zu knapp, deshalb 6. Rueckweg: `git revert` dieser Aenderung,
     dann `node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`
     (die vier Felder parallelitaet, queueRatePerSekunde, drosselMaxParallel,
     tokenAbstandGrossMs zusammen, in beiden Profilen). */
  /* 15 mit Large 4 (Lasttest 31.10.2026: 30 von 30 fertig in 3:46 min, keine
     Ablehnung; mit 30 zugleich scheiterten 3 von 30). Grenze laut Kopfzeile:
     2000 Aufrufe je Minute. */
  parallelitaet: 15,

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
     Abstand zur Grenze, und die Grenze riss. Danach 0,1 (6 je Minute, 12
     Aufrufe), ein Fünftel Abstand.

     BEI EINER HÖHEREN MISTRAL-STUFE darf der Wert steigen — aber erst nach
     einem Blick ins Mistral-Dashboard, nicht nach Gefühl.

     0,2 SEIT 31.10.2026: Mistral meldet in den Kopfzeilen jeder Antwort 30
     Aufrufe je Minute (x-ratelimit-limit-req-minute, gemessen 31.10.2026).
     Das sind 15 Analysen je Minute = 0,25 je Sekunde; 0,2 hält wieder ein
     Fünftel Abstand (12 je Minute, 24 Aufrufe). Mit 0,1 bliebe die höhere
     Parallelität wirkungslos. */
  queueRatePerSekunde: 0.2,

  /* EINLASSGRENZE OHNE MESSUNG: 100, bewusst eine runde Zahl (Festlegung
     11.09.2026; bis dahin 155). Gilt nur, wenn keine gemessene Dauer vorliegt
     — frische Installation, Messung abgeschaltet oder aelter als eine Woche,
     Datenbank hakt. Sonst rechnet warteschlangen-rechnung.js laufend aus den
     letzten 20 Analysen: 30 Minuten Browser-Geduld / Dauer je Analyse
     (80-Perzentil) × parallelitaet × 0,8 Abstand — hoechstens aber, was
     queueRatePerSekunde in 30 Minuten losschickt (× 0,8; bei 0,2 je Sekunde
     288). Zum Vergleich mit derselben Formel und 6 parallel (seit
     31.10.2026): 40 s (Median, gemessen 30.08.2026) ergaeben 216; rund 63 s
     ergaeben 137 (80-Perzentil des Mistral-Aufrufs ueber 567 Analysen vom
     12.08. bis 10.09.2026: 59 s, dazu geschaetzt 4 s fuer den Werbe-Aufruf).
     Die 155 stammten aus der Rechnung mit 7 parallel und 65 s. */
  warteschlangeTiefe: 100,

  /* GEMESSEN 30.08.2026 an der Produktion: Median 40 s (Spanne 34–41), nicht
     65. Der Wert steuert die angezeigte Wartezeit — zu hoch heißt, die Leute
     warten auf eine Zahl, die nie eintrifft. */
  durchschnittsdauerSekunden: 80,

  stundenlimit: 500,
  stundenfensterMinuten: 60,
  adressLimit: 500,
  adressfensterMs: 600000,
  boostFaktor: 2,
  boostFristMs: 7200000,
  /* FOLGT `parallelitaet` (30.08.2026 6 → 4, 08.09. → 3, 16.09. wieder 4, 31.10. 6).
     Die Drossel darf nie groesser sein als die Warteschlange durchlaesst —
     eine Bremse hinter einer schaerferen Bremse ist keine Bremse, sondern
     toter Code mit dem Anschein von Sicherheit. Der Doku-Test erzwingt das
     Verhaeltnis. Und sie zaehlt nur je Server-Instanz: Am 08.09. liefen
     sieben Instanzen zugleich, jede hielt fuer sich Abstand. */
  drosselMaxParallel: 15,
  drosselWartelimitMs: 360000,

  /* MINDESTABSTAND ZWISCHEN KI-AUFRUFEN, gemessen 30.08.2026. Hier standen
     800 ms, dann bis 31.10.2026 4000. Seither 2500 = 24 Aufrufe je Minute,
     passend zur gemessenen Grenze. Wirkt nur innerhalb einer Instanz und die
     traegt bei concurrency 1 nur einen Auftrag, praktisch also keine Bremse.
     Die verlässliche Bremse ist `queueRatePerSekunde`. */
  tokenAbstandGrossMs: 2500,

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
    /* Dieselbe Formel wie oben mit 110 s und 6 parallel (seit 31.10.2026):
       1800 / 110 × 6 × 0,8 = 78 (vorher mit 4 parallel: 52). */
    warteschlangeTiefe: 78,
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
