/* Beispielmaterial: begruendet uebersprungen (KERN 12). Muss GRUEN bleiben —
   sonst zwingt die Pruefung zu Schein-Zusicherungen, also genau zu dem Fehler,
   gegen den sie antritt. */

// pruefungen:uebersprungen-weil braucht das Werkzeug gcloud, das hier fehlt
test.skip.each([[1], [2]])("begruendet uebersprungen (%i)", (a) => {
  expect(a).toBeGreaterThan(0);
});
