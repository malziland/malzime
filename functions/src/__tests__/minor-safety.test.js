const {
  applyMinorSafety,
  _istImmerVerboten,
  _istBeiMinderjaehrigenVerboten,
  _geschaetztesAlter,
} = require("../minor-safety");

function profil(alterText, ads, trigger = []) {
  return {
    normal: {
      categories: { alter_geschlecht: { value: alterText } },
      ad_targeting: [...ads],
      manipulation_triggers: [...trigger],
    },
    boost: {
      categories: { alter_geschlecht: { value: alterText } },
      ad_targeting: [...ads],
      manipulation_triggers: [...trigger],
    },
  };
}

describe("Altersauslesung", () => {
  test("liest den Punktwert", () => {
    expect(_geschaetztesAlter("Du bist weiblich, ~14 Jahre alt (Spanne 12-16).")).toBe(14);
  });
  test("nimmt sonst die erste Zahl", () => {
    expect(_geschaetztesAlter("Du bist männlich, 40 Jahre alt.")).toBe(40);
  });
  test("gibt null zurück, wenn kein Alter drinsteht", () => {
    expect(_geschaetztesAlter("Keine klaren Bildsignale.")).toBeNull();
    expect(_geschaetztesAlter("")).toBeNull();
  });
});

describe("Stufe 1 — immer verboten, unabhängig vom Alter", () => {
  test.each([
    ["OnlyFans Merch Drops"],
    ["Fansly Premium"],
    ["Escort Service Wien"],
    ["Glock 19 Zubehör"],
    ["Munition Großhandel"],
  ])("erkennt %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(true);
  });

  test("greift auch bei Erwachsenen", () => {
    const p = profil("Du bist männlich, ~44 Jahre alt.", ["OnlyFans Merch", "Rolex Datejust"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Rolex Datejust"]);
    expect(p.boost.ad_targeting).toEqual(["Rolex Datejust"]);
    expect(b.applied).toBe(true);
    expect(b.entfernt.some((e) => e.grund === "immer")).toBe(true);
  });

  test("greift auch, wenn gar kein Alter erkennbar ist", () => {
    /* Das ist der Kern der Entscheidung: Die schwerste Absicherung darf NICHT
       an der Altersschätzung hängen, weil die unzuverlässig ist. */
    const p = profil("Keine klaren Bildsignale.", ["Pornhub Premium", "Nike Metcon"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike Metcon"]);
  });

  test("greift auch in den Manipulations-Triggern", () => {
    const p = profil("Du bist männlich, ~30 Jahre alt.", [], ["Wir bewerben dich mit OnlyFans-Angeboten."]);
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual([]);
  });
});

describe("Stufe 2 — nur bei Minderjährigen", () => {
  const heikel = ["Bet365 Live-Wetten", "N26 Kreditkarte", "Botox Behandlung", "Ozempic Kur", "Vodka Tasting"];

  test("wird bei 14-Jährigen entfernt", () => {
    const p = profil("Du bist weiblich, ~14 Jahre alt.", [...heikel, "Lego Friends"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Lego Friends"]);
    expect(b.minderjaehrig).toBe(true);
  });

  test("bleibt bei Erwachsenen stehen — das ist der Lerninhalt", () => {
    const p = profil("Du bist männlich, ~44 Jahre alt.", [...heikel]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(heikel);
    expect(b.applied).toBe(false);
  });

  test("bleibt stehen, wenn kein Alter erkennbar ist", () => {
    /* Im Zweifel NICHT filtern: Sonst verlöre man bei Erwachsenen legitime
       Aufklärungsinhalte. Die harte Liste greift ja trotzdem. */
    const p = profil("Keine klaren Bildsignale.", [...heikel]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(heikel);
  });

  test("17 gilt als minderjährig, 18 nicht", () => {
    const p17 = profil("~17 Jahre alt", ["Tipico Wetten"]);
    applyMinorSafety(p17);
    expect(p17.normal.ad_targeting).toEqual([]);

    const p18 = profil("~18 Jahre alt", ["Tipico Wetten"]);
    applyMinorSafety(p18);
    expect(p18.normal.ad_targeting).toEqual(["Tipico Wetten"]);
  });
});

describe("Nicht gefiltert wird die gewollte System-Perspektive", () => {
  test("„Dating-Apps zielen auf dich“ bleibt stehen", () => {
    /* Der Prompt verlangt bei Minderjährigen ausdrücklich die System-Ebene:
       Werbedruck und Plattform-Mechanik zeigen. Ein zu scharfer Filter würde
       genau die Aufklärung wegschneiden, um die es geht. */
    const p = profil(
      "~14 Jahre alt",
      [],
      [
        "Dein Single-Status macht dich zur Zielgruppe für Dating-Apps.",
        "Diätprodukte reden dir ein, dein Körper sei ein Problem.",
      ]
    );
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toHaveLength(2);
  });

  test("harmlose Werbung bleibt unangetastet", () => {
    const ads = ["Lego Friends", "Playmobil Junior", "Thalia Erstleser", "Spotify Premium Student"];
    const p = profil("~10 Jahre alt", ads);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(ads);
    expect(b.applied).toBe(false);
  });
});

describe("Robustheit", () => {
  test("verträgt fehlende Profile", () => {
    expect(() => applyMinorSafety(null)).not.toThrow();
    expect(() => applyMinorSafety({})).not.toThrow();
    expect(() => applyMinorSafety({ normal: null, boost: undefined })).not.toThrow();
  });

  test("verträgt fehlende Felder", () => {
    const p = { normal: { categories: {} }, boost: {} };
    expect(() => applyMinorSafety(p)).not.toThrow();
  });

  test("meldet, was entfernt wurde", () => {
    const p = profil("~14 Jahre alt", ["OnlyFans Merch", "Bet365 Wetten", "Lego"]);
    const b = applyMinorSafety(p);
    const gruende = b.entfernt.map((e) => e.grund);
    expect(gruende).toContain("immer");
    expect(gruende).toContain("minor");
    expect(b.alter).toBe(14);
  });
});
