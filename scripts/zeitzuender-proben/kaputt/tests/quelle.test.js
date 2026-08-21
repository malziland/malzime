/* Probe: rechnet mit der ECHTEN Uhr gegen das feste Datum der Quelle — heute
   gruen, ab einem berechenbaren Tag fuer immer rot (TEST-2026-08-20-01). */
const { pruefe } = require("../quelle");
test("schweigt vor der Frist", () => {
  expect(pruefe()).toBe("still");
});
