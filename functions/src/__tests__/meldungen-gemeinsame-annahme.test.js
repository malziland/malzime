"use strict";

/* Fehler- und Erfolgsmeldungen des Browsers werden nach DENSELBEN Regeln
   angenommen (STRUCT-2026-10-03-56).

   Die zwei Annahmestellen (handle-errors.js, handle-telemetry.js) trugen je
   eine eigene Kopie von Rumpfpruefung, Wertgrenze und Messwert-Pruefung, und
   die Kopien waren schon auseinandergelaufen. Jetzt liegt das Gemeinsame in
   meldungs-annahme.js; jede Stelle behaelt nur ihre eigene Feldliste — das sind
   die Positivlisten, die der Datenschutztext deckt
   (diagnose-freigabeliste.test.js, datenschutz-deckung.test.js).

   EIN BEGRUENDETER UNTERSCHIED bleibt: Die Hochlade-Dauer (`enqueueMs`) nimmt
   nur die Erfolgsmeldung an. Kein Fehlermelder des Browsers schickt Messwerte;
   ein neues Feld in den Fehlermeldungen waere ein neues Feld im
   30-Tage-Speicher und braucht einen Eintrag in der Deckungstabelle. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../middleware", () => ({ getClientIp: jest.fn(() => "test"), checkRateLimit: jest.fn(() => true) }));
jest.mock("../counter", () => ({ zaehleRealitaetsCheck: jest.fn(async () => {}) }));
jest.mock("../jobs", () => ({ verbraucheRcTicket: jest.fn(async () => false) }));

const fs = require("fs");
const path = require("path");
const middleware = require("../middleware");
const annahme = require("../meldungs-annahme");
const { handleErrors } = require("../handle-errors");
const { handleTelemetry } = require("../handle-telemetry");

function antwort() {
  return {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

let log;
let fehler;

beforeEach(() => {
  middleware.checkRateLimit.mockReset().mockReturnValue(true);
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* Was die Annahmestelle aus einem Rumpf macht: die eine Zeile, die sie
   schreibt (Fehlermeldung als Fehlerzeile, Erfolgsmeldung als gewoehnliche). */
async function gespeichert(handler, spion, body) {
  spion.mockClear();
  const res = antwort();
  await handler({ method: "POST", headers: {}, body }, res);
  expect(res.statusCode).toBe(204);
  expect(spion).toHaveBeenCalledTimes(1);
  return JSON.parse(spion.mock.calls[0][0]);
}
const alsFehler = (body) => gespeichert(handleErrors, fehler, body);
const alsErfolg = (body) => gespeichert(handleTelemetry, log, body);

describe("dieselben Messwerte durch beide Annahmestellen", () => {
  const MESSWERTE = { prepareImageMs: 700, fetchMs: 20, enqueueMs: 1864, parseMs: 5, renderMs: 2199, totalMs: 5000 };

  test("alle gemeinsamen Messwerte kommen gleich an; der einzige Unterschied ist die Hochlade-Dauer", async () => {
    const beiFehler = (await alsFehler({ errorName: "x", timings: MESSWERTE })).timings;
    const beiErfolg = (await alsErfolg({ eventType: "analyse", timings: MESSWERTE })).timings;

    expect(beiFehler).toEqual({ prepareImageMs: 700, fetchMs: 20, parseMs: 5, renderMs: 2199, totalMs: 5000 });
    expect(beiErfolg).toEqual({ ...beiFehler, enqueueMs: 1864 });
  });

  test.each([
    ["negativ wird 0", -5, 0],
    ["ueber zehn Minuten wird auf zehn Minuten begrenzt", 600001, 600000],
    ["genau zehn Minuten bleibt", 600000, 600000],
    ["Nachkommastellen werden gerundet", 12.6, 13],
  ])("Grenzen gelten an beiden Stellen gleich: %s", async (_fall, roh, erwartet) => {
    expect((await alsFehler({ timings: { totalMs: roh } })).timings).toEqual({ totalMs: erwartet });
    expect((await alsErfolg({ timings: { totalMs: roh } })).timings).toEqual({ totalMs: erwartet });
  });

  test.each([
    ["Text statt Zahl", { totalMs: "5000" }],
    ["keine endliche Zahl", { totalMs: Infinity }],
    ["unbekannter Messwert", { geheimMs: 7 }],
    ["kein Objekt", "schnell"],
  ])("verworfen wird an beiden Stellen gleich: %s", async (_fall, timings) => {
    expect((await alsFehler({ timings })).timings).toBeUndefined();
    expect((await alsErfolg({ timings })).timings).toBeUndefined();
  });
});

describe("dieselbe Rumpfpruefung an beiden Annahmestellen", () => {
  const beide = [
    ["Fehlermeldung", handleErrors],
    ["Erfolgsmeldung", handleTelemetry],
  ];

  test.each(beide)("%s: falsche Methode → 405", async (_name, handler) => {
    const res = antwort();
    await handler({ method: "GET", headers: {} }, res);
    expect([res.statusCode, res.body]).toEqual([405, { error: "Method not allowed" }]);
  });

  test.each(beide)("%s: zu viele Aufrufe einer Adresse → 429, nichts gespeichert", async (_name, handler) => {
    middleware.checkRateLimit.mockReturnValue(false);
    const res = antwort();
    await handler({ method: "POST", headers: {}, body: { errorName: "x", eventType: "y" } }, res);
    expect([res.statusCode, res.body]).toEqual([429, { error: "Rate limit exceeded" }]);
    expect(fehler).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  test.each(beide)("%s: kaputtes JSON als Text → 400", async (_name, handler) => {
    const res = antwort();
    await handler({ method: "POST", headers: {}, body: "{kaputt" }, res);
    expect([res.statusCode, res.body]).toEqual([400, { error: "Invalid JSON" }]);
  });

  test.each(beide)("%s: Rumpf ist kein Objekt → 400", async (_name, handler) => {
    const res = antwort();
    await handler({ method: "POST", headers: {}, body: 7 }, res);
    expect([res.statusCode, res.body]).toEqual([400, { error: "Invalid body" }]);
  });

  test.each(beide)("%s: JSON als Text wird gelesen", async (_name, handler) => {
    const res = antwort();
    await handler({ method: "POST", headers: {}, body: JSON.stringify({ errorName: "x", eventType: "y" }) }, res);
    expect(res.statusCode).toBe(204);
  });
});

describe("das Gemeinsame steht an EINER Stelle", () => {
  const quelle = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

  test.each([["handle-errors.js"], ["handle-telemetry.js"]])(
    "%s traegt keine eigene Kopie von Messwert-Pruefung, Wertgrenze und Rumpfpruefung",
    (name) => {
      const text = quelle(name);
      expect(text).toContain('require("./meldungs-annahme")');
      expect(text).not.toMatch(/function sanitizeTimings/);
      expect(text).not.toContain("600000");
      expect(text).not.toContain("JSON.parse(");
      expect(text).not.toContain("checkRateLimit");
    }
  );

  test("die Wertgrenze: null bis zehn Minuten", () => {
    expect(annahme.HOECHSTWERT_MS).toBe(10 * 60 * 1000);
    expect(annahme.messwerte({ a: 1, b: -1, c: 600001 }, ["a", "b", "c"])).toEqual({ a: 1, b: 0, c: 600000 });
    expect(annahme.messwerte({ a: 1 }, ["b"])).toBeNull();
  });

  test("die kleinste angenommene Zahl legt die Annahmestelle fest: Fehlermeldungen lassen -1 zu, Erfolgsmeldungen 0", async () => {
    expect((await alsFehler({ httpStatus: -5, durationMs: -5 })).httpStatus).toBe(-1);
    expect((await alsErfolg({ eventType: "y", durationMs: -5 })).durationMs).toBe(0);
  });
});
