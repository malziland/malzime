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
 *   1. Die Kalibrierung steht im singleLargePrompt jeder Sprachdatei — seit
 *      dem Ausbau des Drei-Aufruf-Wegs (10.09.2026) die einzige Stelle.
 *   2. Reifemerkmale dürfen nur in der Negativliste vorkommen.
 *   3. Deutsch und Englisch müssen dieselben Merkmale führen.
 */

/* Beide Stellen, an denen die Kalibrierung steht — hier zusammengefasst, damit
   jeder Test automatisch BEIDE prüft. */
const PROMPTS = [
  ["de/singleLargePrompt (aktiver Pfad)", de.singleLargePrompt],
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

describe("Alter nur an der Person ablesen, nie an Gegenständen", () => {
  /* WARUM (Workshop 16.09.2026, Kinder fast alle 12-13 Jahre): 32 von 188
     Personen bekamen eine Alters-Untergrenze von 19 oder mehr, ein
     12-jähriges Kind wurde auf rund 32 geschätzt, weil es Gegenstände hielt,
     die zu älteren Menschen passen. Drei Stellen im Prompt ließen das zu:
       A. Die allgemeine Regel erlaubte Umgebung, Aktivität und Objekte als
          Beleg und nahm nur die Herkunft aus, nicht das Alter.
       B. Die Ausschlussliste fürs Alter nannte Kleidung, Pose und Setting,
          aber keine Gegenstände, keinen Hintergrund und keine Tätigkeit —
          und das Setting-Verbot stand nur im Kinder-Teil.
       C. Der Übergang Teen/Erwachsen setzte "22-28, nicht jünger" ohne die
          Bedingung, dass keine Kindermerkmale sichtbar sind.
     Geprüft wird der Modul-Export, also genau der Text, der an Mistral geht. */
  const REGELN = {
    de: {
      A: "- Nutze sichtbare Umgebung, Aktivität und Objekte für Lebensstil, Interessen, Kaufkraft und Werbeprofil, aber NICHT für ethnische Herkunft (Reisefoto-Falle) und NICHT für das Alter.",
      B:
        "WORAN DU DAS ALTER ABLIEST — GILT FÜR JEDES ALTER:\n" +
        "Das Alter liest du ausschließlich an Gesicht, Hals, Händen und Haaren der Person ab. Was die Person hält, trägt oder tut und was um sie herum ist — Gegenstände, Hintergrund, Raum, Tätigkeit —, verschiebt das Alter weder nach oben noch nach unten: Ein Kind mit Strickzeug oder Gehstock bleibt ein Kind, ein Erwachsener mit Spielzeug bleibt erwachsen. Solche Dinge kommen im Bildbeleg zum Alter nicht vor.",
      C: "- Wenn Halspartie und Hände erwachsen wirken, das Gesicht ausgewachsene Proportionen zeigt, KEINES der Kinder- und Jugendmerkmale oben (Augenlinie, Zahnstand, Wangenfett, Nasenrücken) sichtbar ist und noch keine Linie sichtbar ist: 22-28 J — nicht jünger.",
      kopf: "═══ ALTERSKALIBRIERUNG — GILT FÜR BEIDE MODI ═══",
      kinderTeil: "KALIBRIERUNG ALTER 2-19:",
      /* Die Fassung vor dem 16.09.2026 — kehrt sie zurück, ist die Lücke wieder da. */
      altC: "erwachsen wirken und das Gesicht ausgewachsene Proportionen zeigt, aber noch keine Linie",
    },
    en: {
      A: "- Use visible environment, activity and objects for lifestyle, interests, purchasing power and advertising profile, but NOT for ethnic origin (travel-photo trap) and NOT for age.",
      B:
        "WHAT YOU READ AGE FROM — APPLIES TO EVERY AGE:\n" +
        "You read age exclusively from the person's face, neck, hands and hair. What the person holds, carries or does and what surrounds them — objects, background, room, activity — shifts the age neither upwards nor downwards: a child with knitting or a walking stick remains a child, an adult with toys remains an adult. Such things do not appear in the image evidence for age.",
      C: "- If neck and hands appear adult, the face shows fully grown proportions, NONE of the child and teen markers above (eye line, dentition, cheek fat, nasal bridge) is visible and no line is visible yet: 22-28 y — not younger.",
      kopf: "═══ AGE CALIBRATION — APPLIES TO BOTH MODES ═══",
      kinderTeil: "AGE CALIBRATION 2-19:",
      altC: "appear adult and the face shows fully grown proportions, but no line is visible yet",
    },
  };

  /* Liefert die Namen der Regeln, die im Text fehlen. Eine eigene Funktion,
     damit die Gegenprobe unten GENAU dieselbe Prüfung gegen einen Text ohne
     die Regeln laufen lassen kann. */
  function fehlendeRegeln(prompt, sprache) {
    const r = REGELN[sprache];
    const fehlt = ["A", "B", "C"].filter((name) => !prompt.includes(r[name]));
    /* B muss direkt unter der Überschrift der Alterskalibrierung stehen, vor
       dem Kinder-Teil — sonst gälte die Regel wieder nur für einen Teil. */
    if (!fehlt.includes("B") && !prompt.includes(`${r.kopf}\n\n${r.B}\n\n${r.kinderTeil}`)) {
      fehlt.push("B-Position");
    }
    if (prompt.includes(r.altC)) fehlt.push("C-alte-Fassung");
    return fehlt;
  }

  test.each(PROMPTS)("%s enthält die drei Regeln an ihrer Stelle", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    expect(fehlendeRegeln(prompt, sprache)).toEqual([]);
  });

  test.each(PROMPTS)("%s: die Prüfung erkennt fehlende und alte Regeln (Gegenprobe)", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    const r = REGELN[sprache];
    /* Ohne diese Gegenprobe könnte fehlendeRegeln() immer [] liefern und der
       Test oben wäre grün, ohne etwas zu prüfen. */
    const ohneA = prompt.replace(r.A, "");
    const ohneB = prompt.replace(`${r.B}\n\n`, "");
    const mitAltemC = prompt.replace(r.C, `- Wenn Halspartie und Hände ${r.altC}: 22-28 J.`);
    expect(fehlendeRegeln(ohneA, sprache)).toEqual(["A"]);
    expect(fehlendeRegeln(ohneB, sprache)).toEqual(["B"]);
    expect(fehlendeRegeln(mitAltemC, sprache)).toEqual(["C", "C-alte-Fassung"]);
    /* B an falscher Stelle (ans Ende verschoben) zählt nicht. */
    const bVerschoben = `${ohneB}\n\n${r.B}`;
    expect(fehlendeRegeln(bVerschoben, sprache)).toEqual(["B-Position"]);
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
