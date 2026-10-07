"use strict";

/* Lehnt der KI-Dienst den Werbe-Aufruf wegen Ueberlast ab (429), ist das eine
   Warnung, kein Fehler (OPS-2026-10-03-31).

   Der Werbe-Aufruf ist der zweite Aufruf einer Analyse und fuellt unter Andrang
   das Minutenlimit. Faellt er aus, bleibt die Werbeliste aus dem Hauptaufruf
   stehen — das Kind bekommt sein Ergebnis. Die Zeile `beast-ads-failed` loeste
   trotzdem die Nachricht "Fehler im Server" aus. Jeder andere Fehlschlag des
   Aufrufs bleibt eine Fehlerzeile: Ein dauerhaft scheiternder Zweitaufruf soll
   auffallen. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const mistral = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const API_KEY_VORHER = process.env.MISTRAL_API_KEY;
const PROFIL = {
  profileText: "Du wirkst aufmerksam.",
  categories: {
    alter_geschlecht: { label: "Alter", value: "Du bist erwachsen.", confidence: 0.8 },
    verletzlichkeit: { label: "V", value: "Du vergleichst dich.", confidence: 0.8 },
    gesundheit: { label: "G", value: "Du bist fit.", confidence: 0.8 },
    kaufkraft: { label: "K", value: "Mittel.", confidence: 0.8 },
  },
};

let fehler;
let warnung;
let aufrufe;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));
const werbeZeilen = (spion) => zeilen(spion).filter((zeile) => zeile.alert === "beast-ads-failed");

function kiAntwortet(status) {
  aufrufe = 0;
  mistral.setFetchForTest(async () => {
    aufrufe += 1;
    if (status !== 200) return { ok: false, status, headers: { get: () => null }, text: async () => "abgelehnt" };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"ad_targeting":["A","B"]}' } }], usage: {} }),
    };
  });
}

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  jest.spyOn(console, "log").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (API_KEY_VORHER === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = API_KEY_VORHER;
  mistral.setFetchForTest(null);
  jest.restoreAllMocks();
});

test("429 bei jedem Versuch: keine Werbeliste, eine Warnung, keine Fehlerzeile", async () => {
  kiAntwortet(429);

  const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de");

  expect(liste).toBeNull();
  expect(aufrufe).toBeGreaterThan(1);
  expect(fehler).not.toHaveBeenCalled();
  expect(werbeZeilen(warnung)).toHaveLength(1);
  expect(werbeZeilen(warnung)[0]).toMatchObject({ severity: "WARNING", step: "mistral-beast-ads", status: "failed" });
});

test.each([[400], [401], [500]])("HTTP %i: weiter eine Fehlerzeile", async (status) => {
  kiAntwortet(status);

  const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de");

  expect(liste).toBeNull();
  expect(werbeZeilen(warnung)).toHaveLength(0);
  expect(werbeZeilen(fehler)).toHaveLength(1);
  expect(werbeZeilen(fehler)[0]).toMatchObject({ severity: "ERROR", step: "mistral-beast-ads", status: "failed" });
});

test("Erfolg: weder Warnung noch Fehlerzeile", async () => {
  kiAntwortet(200);

  const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de");

  expect(liste).toEqual(["A", "B"]);
  expect(werbeZeilen(warnung)).toHaveLength(0);
  expect(fehler).not.toHaveBeenCalled();
});
