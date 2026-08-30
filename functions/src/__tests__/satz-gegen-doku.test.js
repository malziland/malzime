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
const { SATZ } = require("../test-satz");
const { PFLICHTFELDER, _pruefe } = require("../betriebsprofil");

const DOKU = pfad.join(__dirname, "..", "..", "..", "docs", "BETRIEBSPROFILE.md");

/* Die Zeilen der Wertetabellen: | `feldname` | 300000 | Beschreibung | */
function werteAusDoku() {
  const text = fs.readFileSync(DOKU, "utf8");
  const treffer = {};
  for (const zeile of text.split("\n")) {
    const m = zeile.match(/^\|\s*`([a-zA-Z]+)`\s*\|\s*([0-9]+)\s*\|/);
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

  test("große Aufrufe dürfen dichter feuern als kleine", () => {
    expect(ausDoku.tokenAbstandGrossMs).toBeLessThan(ausDoku.tokenAbstandKleinMs);
  });

  test("das Wiederholungsfenster liegt innerhalb der Aufbewahrung", () => {
    expect(ausDoku.zustellfensterMs).toBeLessThanOrEqual(ausDoku.jobAufbewahrungMs);
  });

  test("ein Wartender wird aufgegeben, bevor sein Auftrag gelöscht wird", () => {
    expect(ausDoku.wartendesHoechstalterMs).toBeLessThan(ausDoku.jobAufbewahrungMs);
  });
});
