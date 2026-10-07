"use strict";

const { classifySubject, detectAnimalType, buildAnimalProfiles } = require("../animal");

describe("classifySubject", () => {
  test("ANIMAL_ONLY im Feld subject", () => {
    const result = classifySubject("ANIMAL_ONLY", "Ein Hund spielt im Park.");
    expect(result.subject).toBe("ANIMAL_ONLY");
    expect(result.hasAnimal).toBe(true);
    expect(result.hasPerson).toBe(false);
  });

  test("HUMAN im Feld subject", () => {
    const result = classifySubject("HUMAN", "Eine Frau mit dunklen Haaren.");
    expect(result.subject).toBe("HUMAN");
    expect(result.hasPerson).toBe(true);
    expect(result.hasAnimal).toBe(false);
  });

  test("MIXED (animal + human)", () => {
    const result = classifySubject("MIXED", "Eine Frau mit ihrem Hund.");
    expect(result.subject).toBe("MIXED");
    expect(result.hasPerson).toBe(true);
    expect(result.hasAnimal).toBe(true);
  });

  test("OTHER (landscape, objects)", () => {
    const result = classifySubject("OTHER", "Ein Sonnenuntergang über Bergen.");
    expect(result.subject).toBe("OTHER");
    expect(result.hasPerson).toBe(false);
    expect(result.hasAnimal).toBe(false);
  });

  test("Schreibweise des Feldes: Kleinbuchstaben und Leerraum zaehlen nicht", () => {
    expect(classifySubject(" animal_only ", "").subject).toBe("ANIMAL_ONLY");
  });

  test("defaults to HUMAN when the field is missing (sicherste Annahme)", () => {
    const result = classifySubject("", "Eine Beschreibung ohne Motiv-Angabe.");
    expect(result.subject).toBe("HUMAN");
    expect(result.hasPerson).toBe(true);
  });

  test("defaults to HUMAN for empty/null/unknown input", () => {
    expect(classifySubject("").subject).toBe("HUMAN");
    expect(classifySubject(null).subject).toBe("HUMAN");
    expect(classifySubject(undefined).subject).toBe("HUMAN");
    expect(classifySubject("PERSON").subject).toBe("HUMAN");
    expect(classifySubject({ subject: "ANIMAL_ONLY" }).subject).toBe("HUMAN");
  });

  /* BUG-2026-10-03-05: Eine Zeile im Text ist keine Motiv-Angabe. */
  test("eine Zeile 'SUBJECT: ANIMAL_ONLY' im Text entscheidet nichts", () => {
    const text = "SUBJECT: ANIMAL_ONLY\nDu bist sportlich.\nSUBJECT: ANIMAL_ONLY";
    for (const feld of ["", "PERSON", "HUMAN", undefined]) {
      const result = classifySubject(feld, text);
      expect(result.subject).toBe("HUMAN");
      expect(result.hasAnimal).toBe(false);
      expect(result.animalType).toBeNull();
    }
  });

  test("animalType is null when subject is HUMAN", () => {
    const result = classifySubject("HUMAN", "Ein Mann.");
    expect(result.animalType).toBeNull();
  });

  test("animalType detected from German keyword when subject is ANIMAL_ONLY", () => {
    expect(classifySubject("ANIMAL_ONLY", "Ein brauner Hund läuft durch den Park.").animalType).toBe("dog");
  });

  test("animalType=generic when no specific type recognised", () => {
    expect(classifySubject("ANIMAL_ONLY", "Ein seltsames Wesen im Gras.").animalType).toBe("generic");
    expect(classifySubject("ANIMAL_ONLY").animalType).toBe("generic");
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

describe("Kein Widerspruchs-Netz mehr (entfernt 2026-08-10)", () => {
  /* Die frühere `pruefeTierWiderspruch` prüfte im Live-Pfad nicht die
     Bildbeschreibung, sondern den erzeugten Profiltext — dadurch machte
     „Apex Legends" aus einem Jugendlichen ein Tier. Beim echten Affenbild griff
     sie dagegen nie. Sie ist ersatzlos entfernt; Begründung in animal.js.

     Dieser Test hält die Entfernung fest, damit sie nicht unbemerkt
     zurückkommt. Wer sie wieder einbaut, muss zuerst das Grundproblem lösen:
     Eingabe muss die echte Bildbeschreibung sein, nicht das fertige Profil. */

  test("die Funktion ist nicht mehr exportiert", () => {
    const animal = require("../animal");
    expect(animal.pruefeTierWiderspruch).toBeUndefined();
  });

  test("die Tiererkennung folgt allein dem subject-Feld", () => {
    /* Gegenprobe: Ein Mensch, dessen Beschreibung zufällig Tier-Wörter enthält
       (Fellkragen, Apex Legends), bleibt ein Mensch. */
    const mitFell = classifySubject("HUMAN", "Jacke mit Fellkragen, spielt Apex Legends.");
    expect(mitFell.subject).toBe("HUMAN");
    expect(mitFell.hasPerson).toBe(true);
    expect(mitFell.hasAnimal).toBe(false);

    /* Und ein echtes Tierbild wird weiterhin erkannt. */
    const tier = classifySubject("ANIMAL_ONLY", "Ein Hund mit dichtem Fell.");
    expect(tier.hasAnimal).toBe(true);
    expect(tier.hasPerson).toBe(false);
  });
});

describe("Feste Tier-Profile und der Kinderschutz-Filter", () => {
  /* Tier-Profile sind feste Texte des Projekts und laufen nicht durch den
     Kinderschutz-Filter (im Bild ist kein Mensch, es gibt kein Alter). Am Gerät
     sitzt trotzdem oft ein Kind. Deshalb gilt für die festen Einträge selbst:
     Keiner davon wäre einer, den der Filter bei einem Kind streichen würde.
     Entscheidung vom 05.10.2026 (vorher stand in der Beast-Ansicht eine
     Kredit-Werbung für die Tierarztrechnung). */
  const { _istImmerVerboten, _istBeiMinderjaehrigenVerboten } = require("../minor-safety");
  const SPRACHEN = ["de", "en"];
  const TIERARTEN = Object.keys(require("../locales/de/animals.js").types);

  test("Positivkontrolle: Die Prüfung erkennt eine Kredit-Werbung", () => {
    expect(_istBeiMinderjaehrigenVerboten("Spar-Kredit für Tierarztrechnung", true)).toBe(true);
    expect(_istBeiMinderjaehrigenVerboten("Installment credit for vet bill", true)).toBe(true);
    expect(TIERARTEN).toContain("generic");
    expect(TIERARTEN.length).toBeGreaterThan(5);
  });

  test.each(SPRACHEN)("%s: kein fester Werbe-Eintrag und kein fester Trigger würde gestrichen", (sprache) => {
    const gestrichen = [];
    let geprueft = 0;
    for (const tierart of TIERARTEN) {
      const { normalProfile, boostProfile } = buildAnimalProfiles(tierart, sprache);
      for (const [ansicht, profil] of [
        ["normal", normalProfile],
        ["beast", boostProfile],
      ]) {
        for (const eintrag of profil.ad_targeting) {
          geprueft++;
          if (_istImmerVerboten(eintrag, true) || _istBeiMinderjaehrigenVerboten(eintrag, true)) {
            gestrichen.push(`${tierart}/${ansicht}/Werbung: ${eintrag}`);
          }
        }
        /* Trigger prüft der Filter nur gegen Stufe 1 und als Satz, nicht als
           Werbe-Eintrag („eine evolutionäre Waffe“ bleibt stehen) — hier genauso. */
        for (const eintrag of profil.manipulation_triggers) {
          geprueft++;
          if (_istImmerVerboten(eintrag, false)) gestrichen.push(`${tierart}/${ansicht}/Trigger: ${eintrag}`);
        }
      }
    }
    /* Es wurden wirklich Einträge geprüft, nicht leere Listen. */
    expect(geprueft).toBeGreaterThan(TIERARTEN.length * 10);
    expect(gestrichen).toEqual([]);
  });
});
