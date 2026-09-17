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
    expect(prompt).toMatch(/(KALIBRIERUNG KINDER UND JUGENDLICHE|CALIBRATION CHILDREN AND TEENAGERS)/);
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

describe("Alter nur an der Person ablesen — nichts macht älter", () => {
  /* WARUM (Workshops 16. und 17.09.2026, Kinder 12-13 Jahre): Ein 12-jähriges
     Kind wurde auf rund 32 geschätzt, weil es Gegenstände hielt, die zu
     älteren Menschen passen. Die erste Antwort darauf (16.09.) verbot
     Umgebung und Gegenstände in BEIDE Richtungen — danach stieg der Anteil der
     Kinder mit Untergrenze ab 19 von 17 % auf 35 %. Die Fassung seit 17.09.
     ist einseitig:
       A. Die allgemeine Regel erlaubt Umgebung und Objekte für Lebensstil,
          aber nie, um jemanden älter zu schätzen.
       B. Nichts außer Gesicht, Hals, Händen und Haaren macht älter — auch
          Make-up, Filter und Styling nicht (Fachliteratur: Make-up lässt
          junge Frauen älter wirken, die Fehler sind bei Mädchen größer).
          Hinweise auf Kindheit dürfen nach UNTEN zeigen.
       C. Der Übergang Jugendlich/Erwachsen verweist auf die Kalibrierung für
          Erwachsene statt auf eine feste Spanne.
       D. Das Anti-Bias-Verbot für Setting und Outfit gilt nur nach oben.
     Geprüft wird der Modul-Export, also genau der Text, der an Mistral geht. */
  const REGELN = {
    de: {
      A: "- Nutze sichtbare Umgebung, Aktivität und Objekte für Lebensstil, Interessen, Kaufkraft und Werbeprofil, aber NICHT für ethnische Herkunft (Reisefoto-Falle) und NIE, um jemanden älter zu schätzen.",
      B:
        "WORAN DU DAS ALTER ABLIEST — GILT FÜR JEDES ALTER:\n" +
        "Das Alter liest du an Gesicht, Hals, Händen und Haaren der Person ab. Nichts anderes macht eine Person ÄLTER: nicht, was sie hält, trägt oder tut, und nicht, was um sie herum ist — Gegenstände, Hintergrund, Raum, Tätigkeit —, und ebenso wenig Make-up, Filter, Frisur, Schmuck, Kleidung, Pose und Selbstinszenierung. Ein Kind mit Strickzeug oder Gehstock bleibt ein Kind, ein geschminktes Mädchen bleibt ein Mädchen. Umgekehrt darfst du deutliche Hinweise auf Kindheit oder Jugend als Beleg für ein JÜNGERES Alter nennen: Kinderzimmer, Spielzeug, Schulsachen, eine Person, die neben Erwachsenen deutlich kleiner ist. Ein einzelner Gegenstand macht aus einem Erwachsenen aber kein Kind — Gesicht, Hals, Hände und Haare bleiben maßgeblich.",
      C: "- Wenn Halspartie und Hände erwachsen wirken, das Gesicht ausgewachsene Proportionen zeigt, KEINES der Kinder- und Jugendmerkmale oben (Augenlinie, Zahnstand, Wangenfett, Nasenrücken) sichtbar ist und noch keine Linie sichtbar ist: Die Person ist erwachsen — schätze ihr Alter nach der KALIBRIERUNG ERWACHSENE oben.",
      D: "- Setting, Outfit, Trikot, Bühne, Sportkleidung oder Bildbearbeitung machen niemanden älter.",
      kopf: "═══ ALTERSKALIBRIERUNG — GILT FÜR BEIDE MODI ═══",
      kinderTeil: "KALIBRIERUNG KINDER UND JUGENDLICHE:",
      /* Frühere Fassungen — kehrt eine zurück, ist die jeweilige Lücke wieder da. */
      alt: [
        "verschiebt das Alter weder nach oben noch nach unten",
        "verschieben das Alter NICHT — weder nach oben noch nach unten",
        "22-28 J — nicht jünger",
        "und NICHT für das Alter.",
      ],
    },
    en: {
      A: "- Use visible environment, activity and objects for lifestyle, interests, purchasing power and advertising profile, but NOT for ethnic origin (travel-photo trap) and NEVER to estimate someone as older.",
      B:
        "WHAT YOU READ AGE FROM — APPLIES TO EVERY AGE:\n" +
        "You read age from the person's face, neck, hands and hair. Nothing else makes a person OLDER: not what they hold, carry or do, not what surrounds them — objects, background, room, activity —, and just as little make-up, filters, hairstyle, jewellery, clothing, pose and self-presentation. A child with knitting or a walking stick remains a child, a girl wearing make-up remains a girl. Conversely, you may cite clear signs of childhood or youth as evidence for a YOUNGER age: a child's room, toys, school things, a person who is clearly smaller than the adults next to them. A single object does not turn an adult into a child, though — face, neck, hands and hair remain decisive.",
      C: "- If neck and hands appear adult, the face shows fully grown proportions, NONE of the child and teen markers above (eye line, dentition, cheek fat, nasal bridge) is visible and no line is visible yet: the person is an adult — estimate their age using the CALIBRATION ADULTS above.",
      D: "- Setting, outfit, jersey, stage, sportswear or image editing make nobody older.",
      kopf: "═══ AGE CALIBRATION — APPLIES TO BOTH MODES ═══",
      kinderTeil: "CALIBRATION CHILDREN AND TEENAGERS:",
      alt: [
        "shifts the age neither upwards nor downwards",
        "do NOT shift the age — neither upwards nor downwards",
        "22-28 y — not younger",
        "and NOT for age.",
      ],
    },
  };

  /* Liefert die Namen der Regeln, die fehlen oder in alter Fassung dastehen.
     Eine eigene Funktion, damit die Gegenprobe unten GENAU dieselbe Prüfung
     gegen veränderte Texte laufen lassen kann. */
  function befunde(prompt, sprache) {
    const r = REGELN[sprache];
    const fehlt = ["A", "B", "C", "D"].filter((name) => !prompt.includes(r[name]));
    /* B muss direkt unter der Überschrift der Alterskalibrierung stehen, vor
       dem Kinder-Teil — sonst gälte die Regel wieder nur für einen Teil. */
    if (!fehlt.includes("B") && !prompt.includes(`${r.kopf}\n\n${r.B}\n\n${r.kinderTeil}`)) {
      fehlt.push("B-Position");
    }
    r.alt.forEach((text, i) => {
      if (prompt.includes(text)) fehlt.push(`alte-Fassung-${i}`);
    });
    return fehlt;
  }

  test.each(PROMPTS)("%s enthält die vier Regeln an ihrer Stelle", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    expect(befunde(prompt, sprache)).toEqual([]);
  });

  test.each(PROMPTS)("%s: die Prüfung erkennt fehlende und alte Regeln (Gegenprobe)", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    const r = REGELN[sprache];
    /* Ohne diese Gegenprobe könnte befunde() immer [] liefern und der Test
       oben wäre grün, ohne etwas zu prüfen. */
    expect(befunde(prompt.replace(r.A, ""), sprache)).toEqual(["A"]);
    const ohneB = prompt.replace(`${r.B}\n\n`, "");
    expect(befunde(ohneB, sprache)).toEqual(["B"]);
    expect(befunde(prompt.replace(r.C, ""), sprache)).toEqual(["C"]);
    expect(befunde(prompt.replace(r.D, ""), sprache)).toEqual(["D"]);
    /* B an falscher Stelle (ans Ende verschoben) zählt nicht. */
    expect(befunde(`${ohneB}\n\n${r.B}`, sprache)).toEqual(["B-Position"]);
    /* Jede alte Fassung wird erkannt, auch wenn die neue daneben steht. */
    r.alt.forEach((text, i) => {
      expect(befunde(`${prompt}\n${text}`, sprache)).toEqual([`alte-Fassung-${i}`]);
    });
  });
});

describe("Keine Zahlen als Anker im Altersteil", () => {
  /* WARUM (17.09.2026): In zwei Workshops mit 12- bis 13-Jährigen lagen alle
     Untergrenzen ab 19 auf genau 19, genau 25 oder über 25 — kein einziger
     Wert zwischen 20 und 24 (16.09.: 24 von 31 genau 19 oder 25, 17.09.: 40
     von 50). Im Prompt stand die Überschrift "19-25". Die Fachliteratur
     belegt, dass Zahlen im Prompt die Zahlen der Antwort anziehen und dass
     Ermahnungen dagegen nicht helfen (Lou & Sun 2024, arXiv 2412.06593).
     Deshalb stehen im Altersteil und in den Beispielen keine solchen Zahlen
     mehr; das Beispiel zeigt nur den Platzhalter. */
  const ANKER = {
    de: ["19-25", "22-28", "2-19", "15-19", "20-35", "35-42", "~38 Jahre"],
    en: ["19-25", "22-28", "2-19", "15-19", "20-35", "35-42", "~38 years"],
  };
  const VORLAGE = {
    de: {
      beispiel: "~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)",
      anweisung: "setze dort IMMER deine eigenen geschätzten Zahlen ein, nie das Wort ‹Zahl›",
    },
    en: {
      beispiel: "~‹number› years old (range ‹number›-‹number›)",
      anweisung: "ALWAYS put your own estimated numbers there, never the word ‹number›",
    },
  };

  function ankerBefunde(prompt, sprache) {
    const gefunden = ANKER[sprache].filter((a) => prompt.includes(a));
    const v = VORLAGE[sprache];
    /* Das Beispiel steht dreimal: im Schema (hard_facts) und in je einer
       Beispielkarte pro Modus. */
    if (prompt.split(v.beispiel).length - 1 !== 3) gefunden.push("Platzhalter-Beispiel");
    if (!prompt.includes(v.anweisung)) gefunden.push("Platzhalter-Anweisung");
    return gefunden;
  }

  test.each(PROMPTS)("%s enthält keine Alters-Anker, nur den Platzhalter", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    expect(ankerBefunde(prompt, sprache)).toEqual([]);
  });

  test.each(PROMPTS)("%s: die Prüfung erkennt zurückgekehrte Anker (Gegenprobe)", (name, prompt) => {
    const sprache = name.startsWith("de") ? "de" : "en";
    const v = VORLAGE[sprache];
    for (const anker of ANKER[sprache]) {
      expect(ankerBefunde(`${prompt}\n${anker}`, sprache)).toEqual([anker]);
    }
    const mitZahl = prompt.replace(
      v.beispiel,
      sprache === "de" ? "~38 Jahre alt (Spanne 35-42)" : "~38 years old (range 35-42)"
    );
    expect(ankerBefunde(mitZahl, sprache)).toEqual(["35-42", ANKER[sprache][6], "Platzhalter-Beispiel"]);
    expect(ankerBefunde(prompt.replace(v.anweisung, ""), sprache)).toEqual(["Platzhalter-Anweisung"]);
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
