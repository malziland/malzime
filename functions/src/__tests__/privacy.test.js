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
