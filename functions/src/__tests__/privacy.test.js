const { buildPrivacyRisks, extractVisibleText } = require("../privacy");

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
    /* Kennzeichen taucht NUR im Fließtext auf, nicht in der Sichtbarer-Text-Zeile */
    const fullDescription = "Eine Person vor einem geparkten Auto mit dem Kennzeichen W-AB 123.";
    expect(buildPrivacyRisks({ visibleText: "", fullDescription })).toContain("privacy.licensePlate");
  });

  test("address/phone stay scoped to visible text, not the prose", () => {
    /* "Straße" in der Beschreibungsprosa darf KEIN privacy.address auslösen */
    const fullDescription = "Eine Frau steht an einer belebten Straße in der Innenstadt.";
    expect(buildPrivacyRisks({ visibleText: "", fullDescription })).not.toContain("privacy.address");
  });
});

describe("extractVisibleText", () => {
  test("returns empty string when description is missing", () => {
    expect(extractVisibleText("")).toBe("");
    expect(extractVisibleText(null)).toBe("");
    expect(extractVisibleText(undefined)).toBe("");
  });

  test("extracts German 'Sichtbarer Text:' line", () => {
    const desc = `SUBJECT: HUMAN

Eine Frau mit dunklen Haaren steht vor einem Schild.

Sichtbarer Text: Hauptstraße 12; Café Wien; ÖFB`;
    expect(extractVisibleText(desc)).toBe("Hauptstraße 12; Café Wien; ÖFB");
  });

  test("extracts English 'Visible text:' line", () => {
    const desc = `SUBJECT: HUMAN

A person near a sign.

Visible text: Main Street 42; STOP`;
    expect(extractVisibleText(desc)).toBe("Main Street 42; STOP");
  });

  test("returns empty when no 'Sichtbarer Text' marker found", () => {
    const desc = `SUBJECT: ANIMAL_ONLY\n\nEin Hund im Park.`;
    expect(extractVisibleText(desc)).toBe("");
  });

  test("trims whitespace from extracted text", () => {
    const desc = `Sichtbarer Text:    Schule Mustermann  `;
    expect(extractVisibleText(desc)).toBe("Schule Mustermann");
  });

  test("end-to-end: privacy risks from Mistral description", () => {
    const desc = `SUBJECT: HUMAN

Eine Person vor einer Schule.

Sichtbarer Text: Realschule Linz; LL-AB 1234`;
    const visibleText = extractVisibleText(desc);
    const risks = buildPrivacyRisks({ visibleText });
    expect(risks).toContain("privacy.address");
    expect(risks).toContain("privacy.licensePlate");
  });
});
