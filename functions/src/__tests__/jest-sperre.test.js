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

/* Kein Test erreicht den KI-Dienst mit einem echten Schluessel (07.10.2026).
   Die Vorbereitungsdatei nimmt beide Namen aus der Umgebung, bevor eine
   Testdatei laeuft. Aussagekraeftig ist dieser Fall, wenn der Lauf MIT einem
   Schluessel in der Umgebung gestartet wurde — so ist er nachgestellt
   (`MISTRAL_API_KEY_EU=probe npx jest jest-sperre`); die Vorbereitungsdatei
   selbst ist ausserdem festgeschrieben (scripts/pruefe-deploy-riegel.py). */
describe("der KI-Dienst hat in Tests keinen Schluessel", () => {
  test("beide Namen sind aus der Umgebung entfernt", () => {
    expect(process.env.MISTRAL_API_KEY_EU).toBeUndefined();
    expect(process.env.MISTRAL_API_KEY).toBeUndefined();
  });

  test("ein Aufruf ohne erfundenen Schluessel endet vor dem Netz", async () => {
    const netz = jest.fn();
    const { callMistralRawUnthrottled, setFetchForTest } = require("../mistral-http");
    setFetchForTest(netz);
    try {
      await expect(
        callMistralRawUnthrottled({ model: "probe", messages: [], maxTokens: 10, ueberlastWartezeitenMs: [] })
      ).rejects.toMatchObject({ code: "no_api_key" });
      expect(netz).not.toHaveBeenCalled();
    } finally {
      setFetchForTest(null);
    }
  });

  test("ein erfundener Schluessel aus der Testdatei gilt weiter (Positivkontrolle)", () => {
    process.env.MISTRAL_API_KEY = "test-key-not-real";
    try {
      jest.resetModules();
      expect(process.env.MISTRAL_API_KEY).toBe("test-key-not-real");
    } finally {
      delete process.env.MISTRAL_API_KEY;
    }
  });
});
