"use strict";

/**
 * Die Formvorlagen am Ende des Analyse-Auftrags (locales/<sprache>/muster.js).
 *
 * WARUM ES DIESEN TEST GIBT (13.10.2026):
 * Bis dahin endete der Auftrag mit genau einem ausgefüllten Beispiel, einem
 * Ausdauersportler. Gemessen an einem Foto, das zu diesem Beispiel passte,
 * in drei Durchläufen: ganze Sätze des Beispiels standen in jedem Ergebnis,
 * darunter eine Haarfarbe, die auf dem Foto anders aussah. Und gemessen an 42
 * Analysen von 14 ganz anderen Fotos: 71 % der Beast-Texte begannen mit dem
 * Satzbau des Beispiels, 62 % endeten mit seinem Schlusssatz.
 *
 * Jetzt gibt es mehrere Vorlagen, je Analyse geht eine mit. Diese Tests
 * halten fest, was eine Vorlage erfüllen muss, damit dabei nichts kippt:
 * gleiche Form, gleiche Länge, kein Alter, keine abschreibbare Ausprägung
 * bei der Herkunft, und dieselben Werte dort, wo ein Wechsel das Ergebnis
 * desselben Fotos vom Würfel abhängig machen würde.
 */

const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");
const musterDe = require("../locales/de/muster");
const musterEn = require("../locales/en/muster");
const { REQUIRED_CARDS } = require("../mistral-antwort");
const { _waehleAuftrag } = require("../mistral");

const SPRACHEN = [
  ["de", de, musterDe, "═══ JSON-SCHEMA ═══\n\n"],
  ["en", en, musterEn, "═══ JSON SCHEMA ═══\n\n"],
];
const ANSICHTEN = ["standard", "beast"];

const woerter = (text) => text.trim().split(/\s+/).length;
const saetze = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

/* Karten einer Vorlage, die nicht zwei Sätze mit 15 bis 25 Wörtern haben. */
function kartenAusserhalbDerRegel(vorlage) {
  const befunde = [];
  for (const ansicht of ANSICHTEN) {
    for (const [name, karte] of Object.entries(vorlage[ansicht].categories)) {
      const w = woerter(karte.value);
      const s = saetze(karte.value).length;
      if (w < 15 || w > 25 || s !== 2) befunde.push(`${ansicht}.${name}: ${w} Wörter, ${s} Sätze`);
    }
  }
  return befunde;
}

/* Eine genannte Ausprägung (Farbe, Form) im Beleg zur Herkunft. */
const AUSPRAEGUNG = {
  de: /\b(hell|dunk|blond|braun|schwarz|rot|grau|kantig|schmal|breit|rundlich|oval)\w*/i,
  en: /\b(light|fair|dark|blond|brown|black|red|grey|gray|angular|narrow|broad|round|oval)\w*/i,
};
const herkunftNenntAuspraegung = (vorlage, sprache) =>
  AUSPRAEGUNG[sprache].test(vorlage.standard.categories.herkunft.value);

const KIND = {
  de: /\b(kind|kinder|kindes|schüler\w*|schule\w*|teenager\w*|jugendlich\w*)\b/i,
  en: /\b(child|children|kid|kids|pupil\w*|school\w*|teen\w*|youth\w*)\b/i,
};

describe.each(SPRACHEN)("Vorlagen %s", (sprache, prompts, muster, trenn) => {
  const auftraege = prompts.singleLargePromptVarianten;

  test("es gibt mindestens drei, und je Vorlage genau einen Auftrag", () => {
    expect(muster.length).toBeGreaterThanOrEqual(3);
    expect(auftraege).toHaveLength(muster.length);
  });

  test("der Teil vor der Vorlage ist in allen Aufträgen derselbe", () => {
    const regelteile = new Set(auftraege.map((a) => a.slice(0, a.indexOf(trenn) + trenn.length)));
    expect(regelteile.size).toBe(1);
    expect([...regelteile][0].length).toBeGreaterThan(30000);
  });

  test("jeder Auftrag endet mit genau seiner Vorlage, als gültiges JSON", () => {
    auftraege.forEach((a, i) => {
      expect(a.split(trenn)).toHaveLength(2);
      expect(JSON.parse(a.split(trenn)[1])).toEqual(muster[i]);
    });
  });

  test("der allgemeine Auftrag ist der erste dieser Aufträge", () => {
    expect(prompts.singleLargePrompt).toBe(auftraege[0]);
  });

  /* Die Reihenfolge trägt den Live-Text: Standard kommt vor Beast, und der
     Fließtext vor den Karten (mistral-antwort.js). */
  test.each(muster.map((m, i) => [i + 1, m]))("Vorlage %i hat den festen Aufbau und alle Karten", (_nr, m) => {
    expect(Object.keys(m)).toEqual(["subject", "visible_text", "hard_facts", "standard", "beast"]);
    for (const ansicht of ANSICHTEN) {
      /* Der seriöse Text ist das Fazit und steht deshalb nach den Karten. */
      const aufbau =
        ansicht === "standard"
          ? ["manipulation_triggers", "ad_targeting", "categories", "profileText"]
          : ["manipulation_triggers", "ad_targeting", "profileText", "categories"];
      expect(Object.keys(m[ansicht])).toEqual(aufbau);
      expect(Object.keys(m[ansicht].categories).sort()).toEqual([...REQUIRED_CARDS].sort());
      for (const karte of Object.values(m[ansicht].categories)) {
        expect(Object.keys(karte)).toEqual(["label", "value", "confidence"]);
        expect(karte.confidence).toBeGreaterThanOrEqual(0.4);
        expect(karte.confidence).toBeLessThanOrEqual(0.95);
      }
    }
  });

  test.each(muster.map((m, i) => [i + 1, m]))(
    "Vorlage %i: jede Karte hat zwei Sätze mit 15 bis 25 Wörtern",
    (_nr, m) => {
      expect(kartenAusserhalbDerRegel(m)).toEqual([]);
    }
  );

  test.each(muster.map((m, i) => [i + 1, m]))(
    "Vorlage %i: seriöser Text ist ein Fazit, keine Bildbeschreibung",
    (_nr, m) => {
      expect(m.standard.profileText).not.toMatch(
        /\b(stehst|kniest|Das Bild zeigt|You stand|You kneel|The image shows)\b/
      );
    }
  );

  test.each(muster.map((m, i) => [i + 1, m]))("Vorlage %i: Fließtexte in der bisherigen Länge", (_nr, m) => {
    expect(saetze(m.standard.profileText)).toHaveLength(6);
    expect(saetze(m.beast.profileText)).toHaveLength(10);
    expect(woerter(m.standard.profileText)).toBeGreaterThanOrEqual(40);
    expect(woerter(m.standard.profileText)).toBeLessThanOrEqual(65);
    expect(woerter(m.beast.profileText)).toBeGreaterThanOrEqual(90);
    expect(woerter(m.beast.profileText)).toBeLessThanOrEqual(125);
  });

  /* Stünden hier verschiedene Werte, hinge die Einschätzung desselben Fotos
     davon ab, welche Vorlage gerade gezogen wurde. */
  test("Herkunft, Einkommensspanne, Abschluss und Alterssatz sind in allen Vorlagen gleich", () => {
    const ohneGeschlecht = (text) => text.replace(/männlich|weiblich|female|male/g, "X");
    expect(new Set(muster.map((m) => m.hard_facts.herkunft)).size).toBe(1);
    expect(new Set(muster.map((m) => ohneGeschlecht(m.hard_facts.alter_geschlecht))).size).toBe(1);
    for (const ansicht of ANSICHTEN) {
      const karten = (name) => muster.map((m) => m[ansicht].categories[name].value);
      expect(new Set(karten("alter_geschlecht").map(ohneGeschlecht)).size).toBe(1);
      expect(new Set(karten("einkommen").map((t) => t.match(/\d[.,]\d{3}-\d[.,]\d{3}/)[0])).size).toBe(1);
      expect(new Set(karten("bildung").map((t) => saetze(t)[0])).size).toBe(1);
      expect(new Set(karten("herkunft").map((t) => saetze(t)[0])).size).toBe(1);
    }
  });

  test("der Beleg zur Herkunft nennt keine Ausprägung, die abgeschrieben werden könnte", () => {
    expect(muster.filter((m) => herkunftNenntAuspraegung(m, sprache))).toEqual([]);
  });

  test("keine Vorlage zeigt ein Kind oder eine Schule", () => {
    expect(muster.map((m, i) => (KIND[sprache].test(JSON.stringify(m)) ? i + 1 : null)).filter(Boolean)).toEqual([]);
  });

  test("die Vorlagen unterscheiden sich: kein Kartentext und kein Einstieg oder Schluss steht zweimal da", () => {
    for (const ansicht of ANSICHTEN) {
      for (const name of REQUIRED_CARDS.filter((k) => k !== "alter_geschlecht")) {
        expect(new Set(muster.map((m) => m[ansicht].categories[name].value)).size).toBe(muster.length);
      }
      const texte = muster.map((m) => saetze(m[ansicht].profileText));
      expect(new Set(texte.map((s) => s[s.length - 1])).size).toBe(muster.length);
      expect(new Set(texte.map((s) => s[1])).size).toBe(muster.length);
    }
    expect(new Set(muster.map((m) => saetze(m.beast.profileText)[0])).size).toBe(muster.length);
  });

  test("das frühere einzige Beispiel steht nicht mehr im Auftrag", () => {
    const reste =
      sprache === "de"
        ? [/Ausdauer-Event/, /Premium-Outdoor-Endurance/, /dunkelblond/, /Outdoor-Quälerei/]
        : [/endurance event/, /Premium-Outdoor-Endurance/, /dark blond/, /outdoor self-punishment/];
    for (const a of auftraege) expect(reste.filter((re) => re.test(a)).map(String)).toEqual([]);
  });
});

describe("Beide Sprachen führen dieselben Vorlagen", () => {
  test("gleiche Anzahl, gleiches Geschlecht, gleiche Sicherheitswerte je Karte", () => {
    expect(musterEn).toHaveLength(musterDe.length);
    musterDe.forEach((m, i) => {
      expect(/weiblich/.test(m.hard_facts.alter_geschlecht)).toBe(
        /female/.test(musterEn[i].hard_facts.alter_geschlecht)
      );
      for (const ansicht of ANSICHTEN) {
        const werte = (x) => Object.values(x[ansicht].categories).map((k) => k.confidence);
        expect(werte(musterEn[i])).toEqual(werte(m));
      }
    });
  });
});

describe("Die Prüfungen können scheitern (Gegenproben)", () => {
  const kopie = () => JSON.parse(JSON.stringify(musterDe[0]));

  test("eine zu kurze Karte und eine Karte mit drei Sätzen fallen auf", () => {
    const m = kopie();
    m.standard.categories.interessen.value = "Du kochst gern. Das sieht man.";
    m.beast.categories.kaufkraft.value = `${m.beast.categories.kaufkraft.value} Und noch ein dritter Satz dazu.`;
    expect(kartenAusserhalbDerRegel(m)).toEqual([
      "standard.interessen: 6 Wörter, 2 Sätze",
      expect.stringMatching(/^beast\.kaufkraft: \d+ Wörter, 3 Sätze$/),
    ]);
  });

  test("eine Haarfarbe im Beleg zur Herkunft fällt auf", () => {
    const m = kopie();
    m.standard.categories.herkunft.value =
      "Du bist mitteleuropäisch. Heller Hautton, kantige Gesichtszüge und dunkelblonde Haare stützen diese algorithmische Einordnung.";
    expect(herkunftNenntAuspraegung(m, "de")).toBe(true);
    expect(herkunftNenntAuspraegung(musterDe[0], "de")).toBe(false);
  });

  test("ein Kind in einer Vorlage fällt auf", () => {
    expect(KIND.de.test("Du stehst mit deinem Kind in der Küche.")).toBe(true);
    expect(KIND.en.test("You stand in the kitchen with your kids.")).toBe(true);
    expect(KIND.en.test("cooking classes and algorithmic classification")).toBe(false);
  });
});

describe("Welche Vorlage mitgeht", () => {
  const prompts = { singleLargePromptVarianten: ["A", "B", "C"] };

  test("eine vorgegebene Nummer wählt genau diese Vorlage, auch über das Ende hinaus", () => {
    expect([0, 1, 2, 3, 4, -1].map((i) => _waehleAuftrag(prompts, i))).toEqual(["A", "B", "C", "A", "B", "B"]);
  });

  test("ohne Nummer kommt über viele Analysen jede Vorlage vor", () => {
    const gezogen = new Set();
    for (let i = 0; i < 200; i++) gezogen.add(_waehleAuftrag(prompts));
    expect([...gezogen].sort()).toEqual(["A", "B", "C"]);
  });

  test("was keine Zahl ist, gilt als nicht vorgegeben", () => {
    for (const wert of [undefined, null, "1", NaN, Infinity]) {
      expect(["A", "B", "C"]).toContain(_waehleAuftrag(prompts, wert));
    }
  });
});
