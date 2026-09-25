/**
 * Obere Altersgrenze in der Kinderschutz-Zeile (25.09.2026).
 *
 * Anlass: Geloggt war nur die Untergrenze der Altersschaetzung. In den
 * Workshops vom 21. und 25.09. begann bei 41 bzw. 45 % der Kinder die Spanne
 * bei 9 oder darunter. Ob "8–13" ein 12-jaehriges Kind verfehlt oder trifft,
 * liess sich ohne das obere Ende nicht sagen.
 *
 * Drei Zusicherungen:
 *   1. Die Obergrenze ist die groesste plausible Alterszahl der Angabe —
 *      bei einer Spanne ihr oberes Ende, auch in Worten geschrieben.
 *   2. Sie entscheidet nichts: Stufe 2 haengt allein an der Untergrenze.
 *   3. Die Logzeile traegt sie, weiterhin ohne Vorgangskennung.
 */
const { obereAltersgrenze, untereAltersgrenze } = require("../alters-lesbarkeit");
const { applyMinorSafety } = require("../minor-safety");
const { loggeMinorSafety } = require("../job-helfer");

const FAELLE = [
  ["Du bist weiblich, ~14 Jahre alt (Spanne 12-16).", 12, 16],
  ["Männlich, ~38 — die Krähenfüße verraten dich.", 38, 38],
  ["Du bist männlich, etwa 38. Spanne 35-42.", 35, 42],
  ["weiblich, 16 bis 22", 16, 22],
  ["Du bist weiblich, etwa dreizehn (Spanne elf bis fünfzehn).", 11, 15],
  ["male, around twenty-five (range twenty-two to thirty)", 22, 30],
  ["Du bist männlich, ~14 Jahre alt, rund 170 cm groß (Spanne 12–16).", 12, 16],
];

describe("obereAltersgrenze", () => {
  test.each(FAELLE)("%s → Spanne %i bis %i", (text, unten, oben) => {
    expect(untereAltersgrenze(text)).toBe(unten);
    expect(obereAltersgrenze(text)).toBe(oben);
  });

  test("nie kleiner als die Untergrenze", () => {
    for (const [text] of FAELLE) {
      expect(obereAltersgrenze(text)).toBeGreaterThanOrEqual(untereAltersgrenze(text));
    }
  });

  test.each([
    ["Kategorie ohne Zahl", "Du bist männlich, ein Teenager."],
    ["kein Altersversuch", "Keine klaren Bildsignale."],
    ["abgeschriebene Vorlage", "männlich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)"],
    ["leer", ""],
  ])("%s → null", (_name, text) => {
    expect(obereAltersgrenze(text)).toBeNull();
  });
});

describe("Obergrenze entscheidet nichts", () => {
  function profil(alterText) {
    const modus = () => ({
      categories: { alter_geschlecht: { value: alterText } },
      ad_targeting: ["Klarna Ratenkauf", "Nike"],
      manipulation_triggers: [],
      profileText: "",
    });
    return { normal: modus(), boost: modus() };
  }

  test("Spanne 24-40: Stufe 2 greift wegen der Untergrenze, trotz hoher Obergrenze", () => {
    const b = applyMinorSafety(profil("Du bist weiblich, ~30 Jahre alt (Spanne 24-40)."));
    expect(b.alter).toBe(24);
    expect(b.alterBis).toBe(40);
    expect(b.minderjaehrig).toBe(true);
    expect(b.entfernt.some((e) => e.stichwort === "klarna")).toBe(true);
  });

  test("Spanne 26-30: Stufe 2 greift nicht, die Obergrenze aendert daran nichts", () => {
    const b = applyMinorSafety(profil("Du bist weiblich, ~28 Jahre alt (Spanne 26-30)."));
    expect(b.alterBis).toBe(30);
    expect(b.minderjaehrig).toBe(false);
    expect(b.entfernt).toEqual([]);
  });

  test("ohne Profil: beide Grenzen null", () => {
    const b = applyMinorSafety(null);
    expect(b.alter).toBeNull();
    expect(b.alterBis).toBeNull();
  });
});

describe("Logzeile minor-safety traegt die Obergrenze", () => {
  let ausgabe;
  beforeEach(() => {
    ausgabe = [];
    jest.spyOn(console, "log").mockImplementation((z) => ausgabe.push(z));
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("alter und alterBis stehen nebeneinander, keine Vorgangskennung", () => {
    const b = applyMinorSafety({
      normal: { categories: { alter_geschlecht: { value: "Du bist weiblich, ~10 Jahre alt (Spanne 8-13)." } } },
    });
    loggeMinorSafety(b, "trace-verbindbar-7", "de");
    const zeile = JSON.parse(ausgabe.find((z) => z.includes('"minor-safety"')));
    expect(zeile.alter).toBe(8);
    expect(zeile.alterBis).toBe(13);
    expect(zeile).not.toHaveProperty("traceId");
    expect(ausgabe.join("\n")).not.toContain("trace-verbindbar-7");
  });

  test("ein Bericht ohne Obergrenze loggt null statt das Feld wegzulassen", () => {
    loggeMinorSafety({ alter: 14, minderjaehrig: true, entfernt: [], durchgerutscht: [] }, null, "de");
    const zeile = JSON.parse(ausgabe[0]);
    expect(zeile).toHaveProperty("alterBis", null);
  });
});
