// ERWARTUNG: keine Fundstelle. `test.describe(...)` ist eine GRUPPE, kein Test —
// die Zusicherungen stehen in den Tests darin. Bis 2026-08-13 meldete die
// Pruefung jede Playwright-Gruppe als „Test ohne Zusicherung" und schnitt
// obendrein den Test darueber entzwei (derselbe Fehlalarm wie einst bei
// `test.use`, nur eine Zeile weiter).

test("steht vor der Gruppe und hat eine Zusicherung", () => {
  expect(1 + 1).toBe(2);
});

test.describe("eine Gruppe ohne eigene Zusicherung", () => {
  test.use({ locale: "de-AT" });

  test("der Test darin hat eine", () => {
    expect("a").toBe("a");
  });
});
