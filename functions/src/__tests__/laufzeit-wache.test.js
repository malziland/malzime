/**
 * laufzeit-wache.test.js — Merkt die Wache eine schleichende Verlangsamung?
 *
 * HINTERGRUND (FEATURE-2026-08-29-03): Der Einbruch vom 26.08.2026 fiel erst am
 * 28.08. durch Beschwerden auf. Diese Pruefung stellt die Lage jenes Wochenendes
 * nach und verlangt, dass die Wache sie erkennt — und dass sie bei normalem
 * Betrieb und bei einzelnen Ausschlaegen schweigt.
 *
 * Reine Rechnung auf Zahlenreihen — kein Netzwerk, keine Cloud.
 */

const { _bewerte, _MIN_ANALYSEN } = require("../laufzeit-wache");

/** Baut einen Tag mit n Analysen der angegebenen Dauer. */
function tag(datum, sekunden, n = 6) {
  return { d: datum, w: Array.from({ length: n }, () => sekunden) };
}

describe("Bewertung der Laufzeit", () => {
  test("normaler Betrieb ist unauffaellig", () => {
    const tage = [];
    for (let i = 1; i <= 17; i += 1) tage.push(tag(`2026-08-${String(i).padStart(2, "0")}`, 65));

    const befund = _bewerte(tage);
    expect(befund.auffaellig).toBe(false);
    expect(befund.grund).toBe("im-rahmen");
  });

  test("die Lage vom 26.-28.08. wird erkannt", () => {
    /* Vierzehn Tage bei rund 65 s, dann drei Tage mit 110, 95 und 150 s —
       das ist der reale Verlauf jenes Wochenendes. */
    const tage = [];
    for (let i = 11; i <= 25; i += 1) tage.push(tag(`2026-08-${i}`, 65));
    tage.push(tag("2026-08-26", 110), tag("2026-08-27", 95), tag("2026-08-28", 150));

    const befund = _bewerte(tage);
    expect(befund.auffaellig).toBe(true);
  });

  test("ein einzelner Ausschlag loest nichts aus", () => {
    /* Am 28.08. lagen zwischen 19 und 66 Token/s drei Stunden. Eine Wache, die
       darauf anspringt, meldet staendig und wird ignoriert. */
    const tage = [];
    for (let i = 11; i <= 26; i += 1) tage.push(tag(`2026-08-${i}`, 65));
    tage.push(tag("2026-08-27", 65), { d: "2026-08-28", w: [65, 65, 300, 65, 65, 65] });

    expect(_bewerte(tage).auffaellig).toBe(false);
  });

  test("zu wenige Analysen ergeben keine Aussage", () => {
    /* malziME ruht ueber Ferien wochenlang — dann darf nichts behauptet
       werden, weder gut noch schlecht. */
    const tage = [tag("2026-08-27", 200, 2), tag("2026-08-28", 200, 3)];

    const befund = _bewerte(tage);
    expect(befund.auffaellig).toBe(false);
    expect(befund.grund).toBe("zu-wenige-analysen");
    expect(befund.zahlen.juengst).toBeLessThan(_MIN_ANALYSEN);
  });

  test("Naehe zur Zeitgrenze schlaegt auch ohne Vergleichszeitraum an", () => {
    /* Der wichtigere Indikator: Er braucht keine Vorwochen und greift damit
       auch beim ersten Workshop nach langer Pause. 250 s liegen ueber 80 %
       der 300-Sekunden-Grenze. */
    const tage = [tag("2026-08-27", 250, 6), tag("2026-08-28", 250, 6)];

    const befund = _bewerte(tage);
    expect(befund.auffaellig).toBe(true);
    expect(befund.grund).toBe("nah-an-der-zeitgrenze");
    expect(befund.zahlen.anteilProzent).toBe(100);
  });

  test("eine leere Historie behauptet nichts", () => {
    const befund = _bewerte([]);
    expect(befund.auffaellig).toBe(false);
    expect(befund.grund).toBe("zu-wenige-analysen");
  });
});
