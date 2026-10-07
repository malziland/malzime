const { buildPrivacyRisks } = require("../privacy");

describe("buildPrivacyRisks", () => {
  test("returns empty array for clean input", () => {
    expect(buildPrivacyRisks({ visibleText: "" })).toEqual([]);
    expect(buildPrivacyRisks({})).toEqual([]);
  });

  test("detects address in visible text", () => {
    expect(buildPrivacyRisks({ visibleText: "Musterstraße 12" })).toContain("privacy.address");
  });

  test("detects school reference", () => {
    expect(buildPrivacyRisks({ visibleText: "Grundschule Nord" })).toContain("privacy.address");
  });

  test("detects phone number", () => {
    expect(buildPrivacyRisks({ visibleText: "0732 12345678" })).toContain("privacy.phone");
  });

  test("ignores watermark text for phone detection", () => {
    expect(buildPrivacyRisks({ visibleText: "Shutterstock 123456789" })).not.toContain("privacy.phone");
  });

  test("detects license plate from visible text pattern", () => {
    expect(buildPrivacyRisks({ visibleText: "LL-AB 1234" })).toContain("privacy.licensePlate");
  });

  test("detects license plate mentioned only in the description prose", () => {
    /* Kennzeichen taucht NUR im Fließtext auf, nicht im sichtbaren Text */
    const fullDescription = "Eine Person vor einem geparkten Auto mit dem Kennzeichen W-AB 123.";
    expect(buildPrivacyRisks({ visibleText: "", fullDescription })).toContain("privacy.licensePlate");
  });

  test("address/phone stay scoped to visible text, not the prose", () => {
    /* "Straße" in der Beschreibungsprosa darf KEIN privacy.address auslösen */
    const fullDescription = "Eine Frau steht an einer belebten Straße in der Innenstadt.";
    expect(buildPrivacyRisks({ visibleText: "", fullDescription })).not.toContain("privacy.address");
  });
});

describe("buildPrivacyRisks — sichtbarer Text mit mehreren Eintraegen", () => {
  test("Schule und Kennzeichen aus demselben sichtbaren Text", () => {
    const risks = buildPrivacyRisks({ visibleText: "Realschule Linz; LL-AB 1234" });
    expect(risks).toContain("privacy.address");
    expect(risks).toContain("privacy.licensePlate");
  });

  test("die Funktion, die eine Zeile 'Sichtbarer Text:' aus Fliesstext las, gibt es nicht mehr", () => {
    /* BUG-2026-10-03-05: Gelesen wird das Feld der Antwort (job-pipelines.js). */
    expect(require("../privacy").extractVisibleText).toBeUndefined();
  });
});

/* BUG-2026-10-03-06: Der Hinweis auf eine Adresse oder Telefonnummer haengt am
   sichtbaren Text des Fotos, nicht an der Sprache der Seite — er muss
   oesterreichische und englische Schreibweisen kennen. Die Gegenproben halten
   fest, was KEIN Hinweis ist: Alltagswoerter, in denen ein Strassenwort nur
   steckt, und Zahlenfolgen, die keine Telefonnummer sind. */
describe("Adresse und Telefonnummer in ueblichen Schreibweisen (BUG-2026-10-03-06)", () => {
  const hinweise = (visibleText) => buildPrivacyRisks({ visibleText });

  test.each([
    "Mozartgasse 3",
    "Hauptplatz 3",
    "Am Marktplatz 2",
    "Linzer Weg 7",
    "Gymnasium Kirchdorf",
    "HAUPTSTRASSE 5",
  ])("deutsch und oesterreichisch: '%s' ist ein Adress-Hinweis", (text) => {
    expect(hinweise(text)).toContain("privacy.address");
  });

  test.each([
    "12 Main Street",
    "45 Elm Road",
    "Mill Road 12",
    "3 Park Avenue",
    "Springfield Elementary School",
    "Oxford High School",
    "Lincoln Middle School",
  ])("englisch: '%s' ist ein Adress-Hinweis", (text) => {
    expect(hinweise(text)).toContain("privacy.address");
  });

  test.each([
    "0664 123 45 67",
    "+43 664 123 45 67",
    "+43 (0)664 123 45 67",
    "+436641234567",
    "(555) 123-4567",
    "Tel. 01 234 56 78",
  ])("Telefonnummer mit Zifferngruppen: '%s'", (text) => {
    expect(hinweise(text)).toContain("privacy.phone");
  });

  test.each([
    "Platz 3",
    "1. Platz beim Vereinsskirennen",
    "Sackgasse",
    "Immer unterwegs",
    "Geh deinen Weg",
    "Norwegen 2024",
    "Streetwear",
    "Street Food Festival 2024",
    "Roadtrip 2023",
    "Route 66",
    "Sportplatz",
    /* Aufdrucke auf Kleidung: "school" allein nennt keine Schule. */
    "Old School",
    "OLD SCHOOL HIP HOP",
    "Back to School",
    "Too cool for school",
    "High School Musical",
  ])("kein Adress-Hinweis: '%s'", (text) => {
    expect(hinweise(text)).not.toContain("privacy.address");
  });

  test.each([
    "05 12 2024",
    "2024-05-12",
    "0 1 2 3 4 5 6 7 8 9",
    "Trikot 10",
    "Mo-Fr 08:00-12:00",
    "AT02 0500 1234 5678 9012",
    "0,99 Euro",
    "+3 Punkte 2024",
    "DE89 3704 0044 0532 0130 00",
  ])("keine Telefonnummer: '%s'", (text) => {
    expect(hinweise(text)).not.toContain("privacy.phone");
  });

  test("die bisherigen Formen gelten weiter", () => {
    expect(hinweise("Hauptstraße 5")).toContain("privacy.address");
    expect(hinweise("Mozartstr. 12")).toContain("privacy.address");
    expect(hinweise("Volksschule Neuhofen")).toContain("privacy.address");
    expect(hinweise("0664 1234567")).toContain("privacy.phone");
    expect(hinweise("0664/1234567")).toContain("privacy.phone");
    expect(hinweise("Getty Images 0664 123 45 67")).not.toContain("privacy.phone");
  });
});
