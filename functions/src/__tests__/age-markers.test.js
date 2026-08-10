const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");

/**
 * Sichert das Merkmalsraster für die Altersschätzung bei Kindern und
 * Jugendlichen ab (v2.9.0).
 *
 * WARUM ES DIESEN TEST GIBT:
 * Der Prompt hatte die Schulterbreite als PRIMÄRE Alters-Achse und dazu eine
 * Zusatzregel, die nur für Mädchen galt ("Mädchen erreichen diese Spanne oft
 * ohne Akne und Bartflaum"). Beides zusammen erklärt das Muster, das der
 * Inhaber über rund 5000 Workshop-Analysen beobachtet hat: Mädchen werden bis
 * zu sechs Jahre zu alt geschätzt, Jungen tendenziell zu jung.
 *
 * Der Grund ist rein biologisch: Der Pubertätsbeginn streut zwischen 8 und 14
 * Jahren und liegt bei Mädchen im Schnitt zwei Jahre früher. Jedes Merkmal,
 * das an der Pubertät hängt, verzerrt die beiden Geschlechter deshalb
 * gegenläufig.
 *
 * Diese Tests halten drei Dinge fest, die leicht wieder verloren gehen:
 *   1. Die Kalibrierung steht ZWEIMAL in jeder Sprachdatei (AGE_ANCHOR für
 *      den 3-Call-Fallback, noch einmal wörtlich im singleLargePrompt für den
 *      aktiven Pfad). Wer nur eine Stelle ändert, ändert nichts am Livebetrieb.
 *   2. Reifemerkmale dürfen nur in der Negativliste vorkommen.
 *   3. Deutsch und Englisch müssen dieselben Merkmale führen.
 */

/* Beide Stellen, an denen die Kalibrierung steht — hier zusammengefasst, damit
   jeder Test automatisch BEIDE prüft. */
const PROMPTS = [
  ["de/AGE_ANCHOR (Fallback-Pfad)", de.describePrompt],
  ["de/singleLargePrompt (aktiver Pfad)", de.singleLargePrompt],
  ["en/AGE_ANCHOR (Fallback-Pfad)", en.describePrompt],
  ["en/singleLargePrompt (aktiver Pfad)", en.singleLargePrompt],
];

/* Marker, die bei Jungen und Mädchen gleich schnell laufen. Je Sprache die
   Begriffe, die im Prompt tatsächlich stehen. */
const PFLICHT_MARKER = {
  de: [/augenlinie/i, /zahn/i, /wangenfett/i, /nasenrücken/i],
  en: [/eye line/i, /teeth|dentition/i, /cheek fat/i, /nasal bridge/i],
};

describe("Altersmerkmale bei Kindern und Jugendlichen", () => {
  test.each(PROMPTS)("%s enthält überhaupt eine Alterskalibrierung", (_name, prompt) => {
    expect(typeof prompt).toBe("string");
    expect(prompt).toMatch(/(KALIBRIERUNG ALTER|AGE CALIBRATION)/);
  });

  test.each(PROMPTS)("%s nennt die pubertätsunabhängigen Marker", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    for (const marker of PFLICHT_MARKER[sprache]) {
      expect(prompt).toMatch(marker);
    }
  });

  test.each(PROMPTS)("%s benennt Reifemerkmale ausdrücklich als untauglich", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    const negativBlock = sprache === "de" ? /KEINE ALTERSMERKMALE/ : /NOT AGE MARKERS/;
    expect(prompt).toMatch(negativBlock);

    /* Der Hinweis auf die zwei Jahre Vorsprung ist die BEGRÜNDUNG. Ohne sie
       ist es eine Behauptung, die das Modell leichter übergeht. */
    /* \s+ statt Leerzeichen: Der Prompt ist umbrochen, die Wendung kann über
       zwei Zeilen laufen. */
    expect(prompt).toMatch(sprache === "de" ? /zwei\s+Jahre\s+früher/ : /two\s+years\s+earlier/);
  });

  test.each(PROMPTS)("%s macht die Schulterbreite nicht zur Alters-Achse", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";

    /* Mutationsprobe: Genau diese Formulierungen standen vorher drin. Kehrt
       eine davon zurück, ist die Regression da. */
    const alteAchse =
      sprache === "de"
        ? [/PRIMÄRE Achse — zuerst Körperproportionen/, /Schultern schmaler als der Kopf/, /Schultern etwa kopfbreit/]
        : [/PRIMARY axis — check body proportions/, /Shoulders narrower than the head/, /Shoulders about head-width/];

    for (const muster of alteAchse) {
      expect(prompt).not.toMatch(muster);
    }
  });

  test.each(PROMPTS)("%s hat keine Sonderregel für ein Geschlecht", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";

    /* Die entfernte Regel lautete: "Mädchen erreichen sie oft ohne diese
       Marker" — sie verbot, ein Mädchen mit glatter Haut jünger einzuordnen,
       und schob damit genau die Gruppe nach oben, die ohnehin zu alt
       geschätzt wird. */
    expect(prompt).not.toMatch(sprache === "de" ? /Mädchen erreichen sie oft ohne/ : /Girls often reach it without/);

    /* Und die positive Festlegung, dass beide gleich behandelt werden. */
    expect(prompt).toMatch(sprache === "de" ? /Jungen und Mädchen wortgleich/ : /boys and girls alike/);
  });

  test.each(PROMPTS)("%s verlangt eine nachvollziehbare Begründung", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    expect(prompt).toMatch(sprache === "de" ? /BEGRÜNDUNGSPFLICHT/ : /DUTY TO JUSTIFY/);
  });
});

describe("Deutsch und Englisch bleiben gleichauf", () => {
  test("beide Sprachen führen gleich viele Marker-Blöcke", () => {
    const zaehle = (text, muster) => muster.filter((m) => m.test(text)).length;
    expect(zaehle(de.singleLargePrompt, PFLICHT_MARKER.de)).toBe(zaehle(en.singleLargePrompt, PFLICHT_MARKER.en));
  });
});

describe("Erwachsene — Lücke bei unlesbarem Gesicht", () => {
  /* WARUM (2026-08-10): Der Prompt zählt Falten nur, wenn sie "auch bei
     entspanntem Gesicht" sichtbar sind. Auf Fotos wird aber gelächelt — die
     Regel greift also fast nie, und das Modell fiel auf "glatte Haut = jung"
     zurück. Drei von sieben Erwachsenen landeten dadurch auf exakt 28 Jahren,
     mit der wörtlichen Begründung "ohne sichtbare Falten". Bei halber
     Bildauflösung kam exakt dasselbe heraus — die Zahl stammt aus der Regel,
     nicht aus dem Foto. */
  test.each(PROMPTS)("%s wertet fehlende Falten nicht als Jugend", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    expect(prompt).toMatch(sprache === "de" ? /WENN DAS GESICHT NICHTS HERGIBT/ : /WHEN THE FACE GIVES NOTHING AWAY/);
    /* Die Ersatzquellen müssen mit dastehen, sonst ist die Regel ein Verbot
       ohne Alternative. */
    for (const muster of sprache === "de" ? [/Hals:/, /Hände:/, /Haaransatz/] : [/Neck:/, /Hands:/, /Hairline/]) {
      expect(prompt).toMatch(muster);
    }
  });

  test.each(PROMPTS)("%s nutzt die neu geeichte Alters-Skala", (_name, prompt) => {
    /* Die alte Skala setzte "erste feine Linien" mit 28-35 an und schickte
       damit jeden 44-Jährigen mit guter Haut zwangsläufig in die Dreißiger.
       Gemessen lag sie rund sieben Jahre zu tief. Mutationsprobe: Kehrt eine
       der alten Stufen zurück, wird dieser Test rot. */
    for (const alt of [/28-35/, /35-45/, /45-55/, /unter 25/, /under 25/]) {
      expect(prompt).not.toMatch(alt);
    }
    for (const neu of [/30-42/, /40-52/, /50-62/]) {
      expect(prompt).toMatch(neu);
    }
  });
});
