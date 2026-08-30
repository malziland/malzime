/**
 * Stimmt der Einstellungssatz mit dem überein, was die Doku verspricht?
 *
 * ANLASS (Review 30.08.2026): Zwei Tests in throttle.test.js prüften nach der
 * Umstellung nur noch `expect(SATZ.drosselMaxParallel).toBe(6)` — also dass
 * die Testdatei die Zahl enthält, die in der Testdatei steht. Eine
 * Tautologie: Sie kann nicht rot werden, solange niemand beide Zeilen
 * gleichzeitig ändert. Vorher prüften sie eine Code-Konstante, was kaum besser
 * war.
 *
 * WAS HIER STATTDESSEN GEPRÜFT WIRD: Die Werte in `docs/BETRIEBSPROFILE.md`
 * sind die kanonische Beschreibung dessen, was im Betrieb gelten soll. Der
 * Testsatz ist das, wogegen alle Tests laufen. Laufen die beiden auseinander,
 * testet die ganze Suite gegen etwas, das es im Betrieb nicht gibt — und die
 * Doku beschreibt ein System, das nicht existiert.
 *
 * Der Test liest die Tabellen der Doku und vergleicht Feld für Feld. Er wird
 * rot, wenn jemand einen Wert nur an einer der beiden Stellen ändert.
 *
 * WAS ER NICHT KANN: Er sagt nichts über den Satz, der in Firestore
 * TATSÄCHLICH liegt — den kennt keine Testumgebung. Dafür gibt es den
 * Live-Smoke und den Firestore-Auslöser `satzWache`, der jede Änderung meldet.
 */

const fs = require("fs");
const pfad = require("path");
/* BEFUND 30.08.2026: Hier stand der TESTSATZ. Der trug dieselben veralteten
   Zahlen wie die Doku (7 und 65), waehrend die Produktion mit 4 und 40 lief.
   Zwei gleichlautende Irrtuemer ergaben einen gruenen Test. Die Doku sagt
   "heute" — also gehoert sie gegen den Satz gehalten, der wirklich in die
   Produktion geschrieben wird. */
const { T1_NORMAL: SATZ } = require("../produktiv-satz");
const { PFLICHTFELDER, _pruefe } = require("../betriebsprofil");

const DOKU = pfad.join(__dirname, "..", "..", "..", "docs", "BETRIEBSPROFILE.md");

/* Die Zeilen der Wertetabellen: | `feldname` | 300000 | Beschreibung | */
function werteAusDoku() {
  const text = fs.readFileSync(DOKU, "utf8");
  const treffer = {};
  for (const zeile of text.split("\n")) {
    /* Auch Dezimalzahlen: queueRatePerSekunde ist 0.125, keine ganze Zahl.
       Mit dem alten Muster wurde die Zeile gar nicht erst gefunden — und ein
       nicht gefundenes Feld faellt nur auf, weil die Messmittel-Probe oben
       die ANZAHL prueft. */
    const m = zeile.match(/^\|\s*`([a-zA-Z]+)`\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|/);
    if (m) treffer[m[1]] = Number(m[2]);
  }
  return treffer;
}

describe("Einstellungssatz und Dokumentation stimmen überein", () => {
  const ausDoku = werteAusDoku();

  /* MESSMITTEL-PROBE ZUERST: Findet der Leser überhaupt etwas? Ohne diese
     Zeile würde eine umformatierte Tabelle dazu führen, dass NICHTS gelesen
     wird — und alle folgenden Prüfungen liefen fröhlich über eine leere
     Liste. Ein grüner Test, der nichts gemessen hat, ist der gefährlichste. */
  test("die Doku-Tabelle ist lesbar (Messmittel-Probe)", () => {
    expect(Object.keys(ausDoku).length).toBe(PFLICHTFELDER.length);
  });

  test("jedes Pflichtfeld ist in der Doku beschrieben", () => {
    const fehlend = PFLICHTFELDER.filter((f) => ausDoku[f] === undefined);
    expect(fehlend).toEqual([]);
  });

  test("die Doku nennt kein Feld, das es nicht gibt", () => {
    const unbekannt = Object.keys(ausDoku).filter((f) => !PFLICHTFELDER.includes(f));
    expect(unbekannt).toEqual([]);
  });

  test.each(Object.keys(werteAusDoku()))("%s: Doku und Testsatz nennen denselben Wert", (feld) => {
    expect(SATZ[feld]).toBe(ausDoku[feld]);
  });

  /* Und der Satz, den die Doku beschreibt, muss die eigene Prüfung bestehen —
     sonst dokumentieren wir einen Satz, den das System ablehnen würde. */
  test("der dokumentierte Satz wird vom System akzeptiert", () => {
    expect(_pruefe(ausDoku)).toBeNull();
  });

  /* Die Beziehungen, die throttle.test.js vorher als Tautologie prüfte —
     jetzt als echte Aussage über den dokumentierten Betrieb. */
  test("die Drossel lässt nicht mehr durch, als die Warteschlange verarbeitet", () => {
    /* Sonst stauen sich Aufrufe vor Mistral statt vor der Warteschlange —
       dort sieht sie niemand, und die Wartezeit-Ansage rechnet daneben. */
    expect(ausDoku.drosselMaxParallel).toBeLessThanOrEqual(ausDoku.parallelitaet);
  });

  /* HIER STAND: "große Aufrufe dürfen dichter feuern als kleine"
     (tokenAbstandGrossMs < tokenAbstandKleinMs).

     Die Annahme ist falsch, und sie wurde am 30.08.2026 teuer: Mistral zählt
     ANFRAGEN pro Sekunde, nicht deren Größe. Ein großer Aufruf mit Bild zählt
     genauso einmal wie ein kleiner. Es gibt keinen Grund, warum der eine
     dichter feuern dürfte — und der Satz 800/2500 lag bei beiden unter dem
     erlaubten Abstand.

     Stattdessen wird jetzt geprüft, was tatsächlich gilt: Beide Abstände
     müssen mindestens so groß sein, wie die Mistral-Stufe erlaubt. Das ist
     eine schärfere Aussage als die alte, nicht eine gelockerte. */
  test("beide Abstände halten die Mistral-Stufe ein", () => {
    /* T1 erlaubt 0,25 Anfragen pro Sekunde -> ein Aufruf alle 4000 ms.
       Diese Zahl steht bewusst hier und nicht im Einstellungssatz: Sie ist
       keine Betriebsentscheidung, sondern eine Eigenschaft des Anbieters. */
    const T1_MINDESTABSTAND_MS = 4000;
    expect(ausDoku.tokenAbstandGrossMs).toBeGreaterThanOrEqual(T1_MINDESTABSTAND_MS);
    expect(ausDoku.tokenAbstandKleinMs).toBeGreaterThanOrEqual(T1_MINDESTABSTAND_MS);
  });

  test("die Warteschlangen-Rate passt zur Mistral-Stufe", () => {
    /* Die eigentliche Bremse: Jede Analyse macht zwei Mistral-Aufrufe
       (Analyse + Beast-Werbung). Bei 0,25 erlaubten Aufrufen pro Sekunde
       dürfen also höchstens 0,125 Analysen pro Sekunde losgeschickt werden.

       Ohne diese Prüfung lässt sich die Rate versehentlich anheben, und der
       Fehler zeigt sich erst beim nächsten Workshop — als Fehlermeldung bei
       Kindern, nicht als roter Test. */
    const T1_AUFRUFE_PRO_SEKUNDE = 0.25;
    const AUFRUFE_JE_ANALYSE = 2;
    expect(ausDoku.queueRatePerSekunde).toBeLessThanOrEqual(T1_AUFRUFE_PRO_SEKUNDE / AUFRUFE_JE_ANALYSE);
  });

  test("das Wiederholungsfenster liegt innerhalb der Aufbewahrung", () => {
    expect(ausDoku.zustellfensterMs).toBeLessThanOrEqual(ausDoku.jobAufbewahrungMs);
  });

  test("ein Wartender wird aufgegeben, bevor sein Auftrag gelöscht wird", () => {
    expect(ausDoku.wartendesHoechstalterMs).toBeLessThan(ausDoku.jobAufbewahrungMs);
  });
});
