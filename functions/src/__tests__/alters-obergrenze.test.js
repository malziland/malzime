/**
 * Obere Altersgrenze in der Kinderschutz-Zeile (25.09.2026).
 *
 * Anlass: Geloggt war nur die Untergrenze der Altersschaetzung. In Workshops
 * begann die Spanne oft deutlich unter dem Alter der Klasse. Ob "8–13" ein
 * 12-jaehriges Kind verfehlt oder trifft, liess sich ohne das obere Ende
 * nicht sagen.
 *
 * Vier Zusicherungen:
 *   1. Die Obergrenze ist das obere Ende der erkannten Spanne; Fremdzahlen
 *      im Text ("1,60 m", "14:30", "80 %") verschieben sie nicht.
 *   2. Sie entscheidet nichts: Stufe 2 haengt an Untergrenze und lesbarem
 *      Alter — geprueft ueber ein Raster aller Spannen, nicht an Beispielen.
 *   3. Sie kommt aus derselben Quelle wie die Untergrenze (Anker vor Karte).
 *   4. Die Logzeile traegt sie, ohne Vorgangskennung, und ihre Feldmenge ist
 *      festgeschrieben.
 */
const { obereAltersgrenze, untereAltersgrenze } = require("../alters-lesbarkeit");
const { applyMinorSafety, _SCHUTZ_BIS } = require("../minor-safety");
const { loggeMinorSafety } = require("../job-helfer");

const FAELLE = [
  ["Du bist weiblich, ~14 Jahre alt (Spanne 12-16).", 12, 16],
  ["Männlich, ~38 — die Krähenfüße verraten dich.", 38, 38],
  ["Du bist männlich, etwa 38. Spanne 35-42.", 35, 42],
  ["weiblich, 16 bis 22", 16, 22],
  ["Du bist weiblich, etwa dreizehn (Spanne elf bis fünfzehn).", 11, 15],
  ["male, around twenty-five (range twenty-two to thirty)", 22, 30],
  ["Du bist männlich, ~14 Jahre alt, rund 170 cm groß (Spanne 12–16).", 12, 16],
  ["weiblich, zwölf- bis vierzehnjährig", 12, 14],
  ["männlich, ~‹14› Jahre alt (Spanne ‹12›-‹16›)", 12, 16],
  /* "zwischen … und …" ohne "Jahre" ergab bis 27.09.2026 die erste Zahl. */
  ["weiblich, zwischen 12 und 14", 12, 14],
  ["weiblich, zwischen zwölf und vierzehn", 12, 14],
  ["male, between 12 and 14", 12, 14],
];

describe("obereAltersgrenze", () => {
  test.each(FAELLE)("%s → Spanne %i bis %i", (text, unten, oben) => {
    expect(untereAltersgrenze(text)).toBe(unten);
    expect(obereAltersgrenze(text)).toBe(oben);
  });

  /* Fremdzahlen: bei der Untergrenze ziehen sie Richtung Schutz (gewollt),
     hier duerfen sie die Spanne nicht kuenstlich breit machen. */
  test.each([
    ["weiblich, ~14, etwa 1,60 m groß (Spanne 12-16)", 16],
    ["männlich, ~13 Jahre alt (Spanne 11-15), Foto um 14:30", 15],
    ["weiblich, ~12 (Spanne 10-14) — zu 80 % sicher", 14],
    ["Du bist männlich, ~14 Jahre, trägt Größe 42", 14],
    ["Trikot Nummer 99, ~12 Jahre alt", 12],
    ["als Elf verkleidet, ~9 Jahre", 9],
    ["Du bist weiblich, ~14 Jahre alt (± 2).", 16],
    ["0-3 Jahre", 3],
  ])("Fremdzahl: %s → %i", (text, oben) => {
    expect(obereAltersgrenze(text)).toBe(oben);
  });

  test.each([
    ["Jahrzehnt ohne Ende", "männlich, Ende zwanzig"],
    ["Jahrzehnt englisch", "male, in his twenties"],
    ["Jahrzehnt in Ziffern", "weiblich, Mitte 30"],
    ["Jahrzehnt als Mehrzahl", "in den Zwanzigern"],
    ["Kategorie ohne Zahl", "Du bist männlich, ein Teenager."],
    ["kein Altersversuch", "Keine klaren Bildsignale."],
    ["abgeschriebene Vorlage", "männlich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)"],
    ["leer", ""],
    ["null", null],
  ])("%s → null", (_name, text) => {
    expect(obereAltersgrenze(text)).toBeNull();
  });

  test.each([
    ["zwanzigjährig", 20],
    ["fünfundzwanzig Jahre", 25],
    ["twenty-five years old", 25],
  ])("genaue Zahl in Worten: %s → %i", (text, oben) => {
    expect(obereAltersgrenze(text)).toBe(oben);
  });

  test("nie kleiner als die Untergrenze, wenn beide gesetzt sind", () => {
    const texte = [
      ...FAELLE.map(([t]) => t),
      "weiblich, ~14, etwa 1,60 m groß (Spanne 12-16)",
      "Du bist weiblich, ~14 Jahre alt (± 2).",
      "Trikot Nummer 99, ~12 Jahre alt",
      "männlich, Ende zwanzig",
      "Teenager, Spanne 13-19",
      "16-12",
    ];
    for (const t of texte) {
      const u = untereAltersgrenze(t);
      const o = obereAltersgrenze(t);
      if (u !== null && o !== null) expect(o).toBeGreaterThanOrEqual(u);
    }
  });
});

function profil(karte, ads = ["Klarna Ratenkauf", "Nike"]) {
  const modus = () => ({
    categories: { alter_geschlecht: { value: karte } },
    ad_targeting: [...ads],
    manipulation_triggers: [],
    profileText: "",
  });
  return { normal: modus(), boost: modus() };
}

describe("Obergrenze entscheidet nichts", () => {
  /* Raster statt Beispiele: Jede Kopplung der Schutzentscheidung an alterBis
     (etwa "nur, wenn die Spanne nicht bis 60 reicht") bricht hier irgendwo.
     Soll: Stufe 2 genau dann, wenn die Untergrenze unter SCHUTZ_BIS liegt. */
  test("Raster Untergrenze 1-60 × Obergrenze bis 99: Stufe 2 folgt allein der Untergrenze", () => {
    const brueche = [];
    for (let u = 1; u <= 60; u++) {
      for (let o = u; o <= 99; o++) {
        const b = applyMinorSafety(profil(`Du bist weiblich, ~${u} Jahre alt (Spanne ${u}-${o}).`));
        if (b.alter !== u || b.alterBis !== o || b.minderjaehrig !== u < _SCHUTZ_BIS) brueche.push(`${u}-${o}`);
      }
    }
    expect(brueche).toEqual([]);
  });

  test("breite Spanne bei einem Kind: Werbung wird trotzdem gestrichen", () => {
    const b = applyMinorSafety(profil("Du bist weiblich, ~12 Jahre alt (Spanne 12-60)."));
    expect(b.minderjaehrig).toBe(true);
    expect(b.entfernt.some((e) => e.stichwort === "klarna")).toBe(true);
  });

  test("ohne Profil: beide Grenzen null", () => {
    const b = applyMinorSafety(null);
    expect(b.alter).toBeNull();
    expect(b.alterBis).toBeNull();
  });
});

describe("Obergrenze aus derselben Quelle wie die Untergrenze", () => {
  test("der Anker gilt, nicht die Karte", () => {
    const b = applyMinorSafety(profil("Du bist weiblich, ~40 Jahre, 1,60 m groß (Spanne 35-45)."), {
      alterText: "Du bist weiblich, ~10 Jahre alt (Spanne 8-13).",
    });
    expect(b.alter).toBe(8);
    expect(b.alterBis).toBe(13);
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

  const zeile = () => JSON.parse(ausgabe.find((z) => z.includes('"minor-safety"')));

  test("Kind: alter und alterBis stehen nebeneinander, keine Vorgangskennung", () => {
    loggeMinorSafety(applyMinorSafety(profil("Du bist weiblich, ~10 Jahre alt (Spanne 8-13).")), "de", "trace-7");
    expect(zeile().alter).toBe(8);
    expect(zeile().alterBis).toBe(13);
    expect(zeile()).not.toHaveProperty("traceId");
    expect(ausgabe.join("\n")).not.toContain("trace-7");
  });

  test("Erwachsener ohne Stufe 2: alterBis steht ebenfalls in der Zeile", () => {
    loggeMinorSafety(applyMinorSafety(profil("Du bist männlich, ~35 Jahre alt (Spanne 30-40).")), "de");
    expect(zeile().minderjaehrig).toBe(false);
    expect(zeile().alterBis).toBe(40);
  });

  test("ein Bericht ohne Obergrenze loggt null statt das Feld wegzulassen", () => {
    loggeMinorSafety({ alter: 14, minderjaehrig: true, entfernt: [], durchgerutscht: [] }, "de");
    expect(zeile()).toHaveProperty("alterBis", null);
  });

  /* Die Zeile liegt im 30-Tage-Diagnose-Speicher. Ihre Felder stehen EINMAL,
     in der Deckungstabelle des Datenschutztexts; dort prueft
     public/__tests__/datenschutz-deckung.test.js jedes Feld gegen den Text
     (DE und EN). Hier: die echte Zeile hat genau diese Felder. */
  test("Feldmenge der Zeile = Feldgruppe der Deckungstabelle", () => {
    const tabelle = require("../../../public/__tests__/fixtures/datenschutz-deckung.json");
    loggeMinorSafety(applyMinorSafety(profil("Du bist weiblich, ~10 Jahre alt (Spanne 8-13).")), "de");
    expect(Object.keys(zeile()).sort()).toEqual(Object.keys(tabelle.felder["minor-safety"]).sort());
  });
});
