// ERWARTUNG: keine Fundstelle. Beide Tests haben eine Zusicherung — sie steht
// nur hinter einem mehrzeiligen Text, dessen Zeilen keine Einrueckung haben.
test("liest die deutsche Zeile", () => {
  const beschreibung = `SUBJECT: HUMAN

Eine Person steht vor einem Schild.

Sichtbarer Text: Hauptstrasse 12`;
  expect(lies(beschreibung)).toBe("Hauptstrasse 12");
});

test("liest die englische Zeile", () => {
  const beschreibung = `SUBJECT: HUMAN

A person in front of a sign.

Visible text: Main Street 12`;
  expect(lies(beschreibung)).toBe("Main Street 12");
});
