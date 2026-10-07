"use strict";

/* Kein Test erreicht die echte Datenbank (TEST-2026-10-03-42).

   functions/jest.setup.js ersetzt den Zugang zu Firestore fuer JEDEN Test durch
   eine Sperre, die wirft. Sie ist die einzige Sicherung dafuer, dass ein Test
   mit einem nicht nachgestellten Modul nicht mit der Datenbank der laufenden
   Anwendung spricht — dort liegt der Einstellungssatz. Die Sperre selbst hielt
   kein Test: Sie liess sich ausbauen, ohne dass etwas rot wurde. */

test("der Zugang zur echten Datenbank ist in Tests gesperrt", () => {
  expect(() => require("firebase-admin/firestore").getFirestore()).toThrow(/echte Firestore-Datenbank/);
});

test("die zentrale Stelle fuer die Datenbank (db.js) laeuft in dieselbe Sperre", () => {
  expect(() => require("../db").datenbank()).toThrow(/echte Firestore-Datenbank/);
});

test("alles andere aus der Datenbank-Bibliothek bleibt benutzbar (die Sperre trifft nur den Zugang)", () => {
  const { Timestamp } = require("firebase-admin/firestore");
  expect(Timestamp.fromMillis(1000).toMillis()).toBe(1000);
});
