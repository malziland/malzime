"use strict";

/* Fehlermeldung des Browsers: nur die Geraeteangaben, die der Datenschutztext
   nennt (PRIV-2026-10-03-39).

   Der Text nennt fuer die Fehlermeldungen Browsertyp, Bildschirmgroesse
   (klein, mittel, gross), Sprache und Netz. Arbeitsspeicher, Zahl der
   Prozessorkerne und Pixeldichte nennt er nicht — die Annahmestelle uebernimmt
   sie deshalb nicht, auch dann nicht, wenn ein aelterer Browser (Seite aus dem
   Zwischenspeicher) sie noch schickt.

   NICHT alle Geraeteangaben fallen weg (Entscheidung vom 26.09.2026,
   SECURITY-MODEL "Diagnose-Speicher: nur, was der Datenschutztext nennt"):
   Was der Text nennt, kommt weiter an. Das haelt der zweite Test fest. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../counter");
jest.mock("../jobs");
const { handleErrors, _freigabeliste } = require("../handle-errors");

const NICHT_IM_TEXT = ["deviceMemoryGb", "hardwareConcurrency", "dpr"];

/* So meldet ein Browser, der die Seite noch aus dem Zwischenspeicher hat. */
const AELTERER_BROWSER = {
  errorName: "TypeError",
  errorMessage: "Load failed",
  phase: "enqueue",
  url: "/",
  userAgent: "Safari 17 / iOS",
  durationMs: 1200,
  client: {
    effectiveType: "4g",
    language: "de-AT",
    screen: "small",
    downlinkMbps: 9.5,
    rttMs: 100,
    saveData: false,
    automatisiert: false,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    dpr: 2.6,
  },
};

function antwort() {
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
      return this;
    },
  };
}

async function gemeldeteZeile(rumpf) {
  const zeilen = [];
  jest.spyOn(console, "error").mockImplementation((z) => zeilen.push(z));
  jest.spyOn(console, "log").mockImplementation(() => {});
  const res = antwort();
  await handleErrors({ method: "POST", body: rumpf, headers: {}, ip: "geraet-" + Math.random() }, res);
  expect(res.statusCode).toBe(204);
  const roh = zeilen.find((z) => typeof z === "string" && z.includes('"client-error"'));
  /* Messmittel: Ohne Zeile waere jede Aussage darunter leer. */
  expect(roh).toBeDefined();
  return JSON.parse(roh);
}

afterEach(() => jest.restoreAllMocks());

describe("Fehlermeldung des Browsers: Geraeteangaben nach dem Datenschutztext", () => {
  test("Arbeitsspeicher, Prozessorkerne und Pixeldichte werden nicht uebernommen", async () => {
    const zeile = await gemeldeteZeile(AELTERER_BROWSER);
    for (const feld of NICHT_IM_TEXT) expect(zeile.client).not.toHaveProperty(feld);
    /* Auch nicht unter anderem Namen: Die drei Werte stehen nirgends in der Zeile. */
    expect(JSON.stringify(zeile)).not.toMatch(/2\.6/);
  });

  test("was der Text nennt, kommt weiter an: Bildschirmgroesse, Sprache, Netz", async () => {
    const zeile = await gemeldeteZeile(AELTERER_BROWSER);
    expect(zeile.client).toEqual({
      effectiveType: "4g",
      language: "de-AT",
      screen: "small",
      downlinkMbps: 9.5,
      rttMs: 100,
      saveData: false,
      automatisiert: false,
    });
    expect(zeile.userAgent).toBe("Safari 17 / iOS");
  });

  test("die Freigabeliste nennt die drei Felder nicht mehr, die uebrigen Geraeteangaben schon", () => {
    for (const feld of NICHT_IM_TEXT) expect(_freigabeliste).not.toContain(`client.${feld}`);
    expect(_freigabeliste).toEqual(
      expect.arrayContaining(["client.screen", "client.language", "client.effectiveType", "client.rttMs"])
    );
  });
});
