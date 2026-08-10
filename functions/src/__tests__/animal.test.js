"use strict";

const { classifyDescription, detectAnimalType, buildAnimalProfiles } = require("../animal");

describe("classifyDescription", () => {
  test("parses SUBJECT: ANIMAL_ONLY from Mistral header", () => {
    const desc = "SUBJECT: ANIMAL_ONLY\n\nEin Hund spielt im Park.";
    const result = classifyDescription(desc);
    expect(result.subject).toBe("ANIMAL_ONLY");
    expect(result.hasAnimal).toBe(true);
    expect(result.hasPerson).toBe(false);
  });

  test("parses SUBJECT: HUMAN", () => {
    const desc = "SUBJECT: HUMAN\n\nEine Frau mit dunklen Haaren.";
    const result = classifyDescription(desc);
    expect(result.subject).toBe("HUMAN");
    expect(result.hasPerson).toBe(true);
    expect(result.hasAnimal).toBe(false);
  });

  test("parses SUBJECT: MIXED (animal + human)", () => {
    const desc = "SUBJECT: MIXED\n\nEine Frau mit ihrem Hund.";
    const result = classifyDescription(desc);
    expect(result.subject).toBe("MIXED");
    expect(result.hasPerson).toBe(true);
    expect(result.hasAnimal).toBe(true);
  });

  test("parses SUBJECT: OTHER (landscape, objects)", () => {
    const desc = "SUBJECT: OTHER\n\nEin Sonnenuntergang über Bergen.";
    const result = classifyDescription(desc);
    expect(result.subject).toBe("OTHER");
    expect(result.hasPerson).toBe(false);
    expect(result.hasAnimal).toBe(false);
  });

  test("defaults to HUMAN when SUBJECT line missing (sicherste Annahme)", () => {
    const result = classifyDescription("Eine Beschreibung ohne SUBJECT-Header.");
    expect(result.subject).toBe("HUMAN");
    expect(result.hasPerson).toBe(true);
  });

  test("defaults to HUMAN for empty/null input", () => {
    expect(classifyDescription("").subject).toBe("HUMAN");
    expect(classifyDescription(null).subject).toBe("HUMAN");
    expect(classifyDescription(undefined).subject).toBe("HUMAN");
  });

  test("animalType is null when subject is HUMAN", () => {
    const result = classifyDescription("SUBJECT: HUMAN\n\nEin Mann.");
    expect(result.animalType).toBeNull();
  });

  test("animalType detected from German keyword when subject is ANIMAL_ONLY", () => {
    const desc = "SUBJECT: ANIMAL_ONLY\n\nEin brauner Hund läuft durch den Park.";
    expect(classifyDescription(desc).animalType).toBe("dog");
  });

  test("animalType=generic when no specific type recognised", () => {
    const desc = "SUBJECT: ANIMAL_ONLY\n\nEin seltsames Wesen im Gras.";
    expect(classifyDescription(desc).animalType).toBe("generic");
  });
});

describe("detectAnimalType", () => {
  test("detects dog from German + English variants", () => {
    expect(detectAnimalType("Ein süßer Welpe spielt.")).toBe("dog");
    expect(detectAnimalType("A puppy in the garden.")).toBe("dog");
    expect(detectAnimalType("Hunde im Park.")).toBe("dog");
  });

  test("detects cat with German feminine forms", () => {
    expect(detectAnimalType("Eine Katze schläft.")).toBe("cat");
    expect(detectAnimalType("Mehrere Kätzchen spielen.")).toBe("cat");
  });

  test("detects bird including specific species", () => {
    expect(detectAnimalType("Ein Vogel auf dem Ast.")).toBe("bird");
    expect(detectAnimalType("Ein Papagei spricht.")).toBe("bird");
    expect(detectAnimalType("Eine Eule sitzt auf dem Baum.")).toBe("bird");
  });

  test("detects fish", () => {
    expect(detectAnimalType("Goldfische im Aquarium.")).toBe("fish");
  });

  test("detects horse", () => {
    expect(detectAnimalType("Ein Pferd auf der Weide.")).toBe("horse");
  });

  test("detects rabbit/hamster family", () => {
    expect(detectAnimalType("Ein Kaninchen knabbert.")).toBe("rabbit");
    expect(detectAnimalType("Hamster im Käfig.")).toBe("rabbit");
  });

  test("returns generic when no match", () => {
    expect(detectAnimalType("Eine Eidechse auf einem Stein.")).toBe("generic");
  });

  test("matches whole words only — does NOT match 'pigment' as pig (negative test)", () => {
    /* 'pig' ist NICHT in unseren TYPE_KEYWORDS — kein False Positive moeglich */
    expect(detectAnimalType("Pigment auf der Leinwand.")).toBe("generic");
  });

  test("picks the most-mentioned animal when the description mixes types", () => {
    /* 'Hund' einmal, 'Katze' mehrfach → Katze gewinnt (haeufigstes Tier, nicht erstes) */
    const desc = "Eine Katze liegt da. Die Katze hat oranges Fell. Kein Hund weit und breit, nur diese Katze.";
    expect(detectAnimalType(desc)).toBe("cat");
  });
});

describe("buildAnimalProfiles", () => {
  test("returns normalProfile and boostProfile for dog", () => {
    const { normalProfile, boostProfile } = buildAnimalProfiles("dog", "de");
    expect(normalProfile).toBeDefined();
    expect(boostProfile).toBeDefined();
    expect(normalProfile.categories).toBeDefined();
    expect(normalProfile.ad_targeting).toBeDefined();
    expect(normalProfile.manipulation_triggers).toBeDefined();
    expect(normalProfile.profileText).toBeDefined();
  });

  test("dog profile mentions Stöckchen", () => {
    const { normalProfile } = buildAnimalProfiles("dog", "de");
    expect(normalProfile.categories.beruf.value).toContain("Stöckchen");
  });

  test("cat profile uses feminine grammar", () => {
    const { normalProfile } = buildAnimalProfiles("cat", "de");
    expect(normalProfile.profileText).toContain("deine Katze");
  });

  test("returns generic Tier profile for unknown type", () => {
    const { normalProfile } = buildAnimalProfiles("xyz_unknown", "de");
    expect(normalProfile.profileText).toContain("Tier");
  });

  test("returns generic when called with 'generic' type explicitly", () => {
    const { normalProfile } = buildAnimalProfiles("generic", "de");
    expect(normalProfile.profileText).toContain("Tier");
  });
});

describe("Netz gegen Tier-als-Mensch (v2.9.1)", () => {
  const { pruefeTierWiderspruch } = require("../animal");

  /* ANLASS: Ein Schüler hat das Bild eines Affen hochgeladen, das Modell hat
     daraus ein Profil eines afrikanischen Kleinkindes erzeugt. Die vorhandene
     Tiererkennung folgt dem Feld `subject` — und das Modell hatte HUMAN
     gemeldet. Dieses Netz prüft eine Ebene tiefer: Beschreibt die Antwort
     Merkmale, die es bei Menschen nicht gibt, obwohl HUMAN dasteht? */

  test.each([
    ["Ein Affe sitzt auf einem Ast.", "affe"],
    ["Das Gesicht eines Schimpansen, frontal.", "schimpanse"],
    ["A gorilla looking at the camera.", "gorilla"],
    ["Das Tier hat eine lange Schnauze.", "schnauze"],
    ["Die Pfoten liegen auf dem Boden.", "pfoten"],
    ["Dichtes Fell bedeckt den Körper.", "fell"],
  ])("erkennt den Widerspruch in %s", (text) => {
    const r = pruefeTierWiderspruch("HUMAN", text);
    expect(r.widerspruch).toBe(true);
    expect(typeof r.treffer).toBe("string");
  });

  test("greift NICHT, wenn das Modell ohnehin ein Tier gemeldet hat", () => {
    /* Dann läuft der reguläre Easter-Egg-Pfad — kein Grund einzugreifen. */
    expect(pruefeTierWiderspruch("ANIMAL_ONLY", "Ein Hund mit Fell.").widerspruch).toBe(false);
    expect(pruefeTierWiderspruch("MIXED", "Frau mit Hund, Pfoten sichtbar.").widerspruch).toBe(false);
  });

  test.each([
    ["Sie trägt ihre Haare zu einem Pferdeschwanz gebunden."],
    ["Er trägt eine Fellweste über dem Hemd."],
    ["Die Jacke hat einen Fellkragen aus Kunstfell."],
    ["Sie hat Katzenaugen als Lidstrich geschminkt."],
  ])("blockiert kein echtes Foto: %s", (text) => {
    /* Ein zu scharfer Filter wäre im Workshop schlimmer als ein seltener
       Durchrutscher — diese Wörter enthalten Tier-Begriffe, meinen aber
       Frisur, Kleidung oder Make-up. */
    expect(pruefeTierWiderspruch("HUMAN", text).widerspruch).toBe(false);
  });

  test("kommt mit leerer oder fehlender Beschreibung klar", () => {
    expect(pruefeTierWiderspruch("HUMAN", "").widerspruch).toBe(false);
    expect(pruefeTierWiderspruch("HUMAN", null).widerspruch).toBe(false);
    expect(pruefeTierWiderspruch(null, "Ein Affe.").widerspruch).toBe(false);
  });
});
