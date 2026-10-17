"use strict";

/* Die Fehler-Annahme zaehlt jede angenommene Meldung in den Tageszaehler
   (16.10.2026, statistik.js): nur Phase und Geraetefamilie, vor der Antwort,
   und ohne je an der Zaehlung zu scheitern. Echte Annahme gegen eine
   Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const speicher = require("./hilfen/speicher-datenbank");
const statistik = require("../statistik");
const { handleErrors } = require("../handle-errors");

function antwort(ablauf) {
  return {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    end() {
      ablauf.push("antwort");
      return this;
    },
  };
}

const anfrage = (body) => ({ method: "POST", body, headers: {}, ip: "test-" + Math.random() });

beforeEach(() => {
  speicher.leeren();
  statistik._zuruecksetzen();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("Phase und Geraetefamilie landen im Tagesdokument, geschrieben vor der Antwort", async () => {
  const ablauf = [];
  speicher.vor(({ art, pfad }) => {
    if (art === "set") ablauf.push(`zaehler:${pfad}`);
  });
  const res = antwort(ablauf);
  await handleErrors(
    anfrage({
      errorName: "Error",
      errorMessage: "x",
      phase: "image-read",
      userAgent: "Safari 17 / iOS",
      traceId: "abc123",
      client: { screen: "small", language: "de" },
    }),
    res
  );
  expect(res.statusCode).toBe(204);
  const tag = speicher.lies(`statistik/${statistik.tagId(Date.now())}`);
  expect(tag.browserFehler).toEqual({ "image-read": { appleTelefon: 1 } });
  /* Keine Zufallsnummer, kein Text der Meldung, keine Sprache im Zaehler. */
  expect(JSON.stringify(tag)).not.toMatch(/abc123|"x"|"de"/);
  expect(ablauf[0]).toMatch(/^zaehler:statistik\/tag-/);
  expect(ablauf[ablauf.length - 1]).toBe("antwort");
});

test("Datenbank weg: die Meldung wird trotzdem angenommen", async () => {
  speicher.vor(({ art }) => {
    if (art === "set") throw new Error("weg");
  });
  const res = antwort([]);
  await handleErrors(anfrage({ errorName: "Error", phase: "queue-poll", userAgent: "Chrome 126 / Android" }), res);
  expect(res.statusCode).toBe(204);
});
