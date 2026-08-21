/* Probe: stellt die Uhr selbst und deckt beide Zweige ab. */
const { pruefe } = require("../quelle");
test("schweigt innerhalb der Frist", () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-14T00:00:00Z"));
  expect(pruefe()).toBe("still");
  jest.useRealTimers();
});
test("meldet nach der Frist", () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-26T00:00:00Z"));
  expect(pruefe()).toBe("meldung");
  jest.useRealTimers();
});
