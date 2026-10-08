/* Beispielmaterial fuer die Selbstpruefung — absichtlich in Ordnung.
   Zeigt beide Faelle, die gruen bleiben muessen: eine Tabellenform MIT
   Zusicherung, und ein begruendet uebersprungener Test. Ohne diese Seite
   waere eine Pruefung, die einfach jede Tabellenform meldet, ebenfalls
   "bestanden" — sie waere nur ueberempfindlich statt blind. */

test.each([
  [1, 2, 3],
  [3, 4, 7],
])("Tabellenform mit Zusicherung (%i + %i = %i)", (a, b, erwartet) => {
  expect(a + b).toBe(erwartet);
});

// pruefungen:uebersprungen-weil braucht das Werkzeug gcloud, das in dieser Umgebung fehlt
test.skip.each([[1], [2]])("begruendet uebersprungen (%i)", (a) => {
  expect(a).toBeGreaterThan(0);
});
