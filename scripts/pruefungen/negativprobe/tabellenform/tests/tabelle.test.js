/* Beispielmaterial fuer die Selbstpruefung — absichtlich mangelhaft.
   Zwei Formen, die test-blind.py bis 2026-08-13 nicht als Test erkannt hat
   (TEST-2026-08-12-06): die Tabellenform mit mehreren Zusaetzen und die
   Schablonenform. Beide muessen gefunden werden. */

test.skip.each([
  [1, 2],
  [3, 4],
])("uebersprungene Tabellenform ohne Begruendung (%i, %i)", (a, b) => {
  const summe = a + b;
  console.log(summe);
});

test.each`
  a    | b
  ${1} | ${2}
`("Schablonenform ohne Zusicherung", ({ a, b }) => {
  const summe = a + b;
  console.log(summe);
});
