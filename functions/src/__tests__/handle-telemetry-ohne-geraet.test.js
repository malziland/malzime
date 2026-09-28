"use strict";

/* Erfolgsmeldung ohne Geraet und ohne Kennung (26.09.2026).

   Die Erfolgsmeldung (`analyze-success`) kommt Sekunden nach der
   Kinderschutz-Zeile an; beide liegen 30 Tage im Diagnose-Speicher. Gemessen
   16.–26.09.2026: Bei 390 von 638 Kinderschutz-Zeilen kam in den 10 s danach
   genau eine Erfolgsmeldung — ueber die Uhrzeit liess sich die
   Altersschaetzung dem Geraet zuordnen.

   Zusicherung: Der Server uebernimmt aus einer Erfolgsmeldung weder
   Browsertyp noch Geraete-/Netzangaben noch Vorgangskennung noch den
   Wake-Lock-Zustand — auch dann nicht, wenn ein aelterer Browser (Seite aus
   dem Zwischenspeicher) sie noch schickt. Positivkontrolle: Die erlaubten
   Felder kommen an, der Test sieht also die Logzeile. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../counter");
jest.mock("../jobs");
const { handleTelemetry } = require("../handle-telemetry");

function mockRes() {
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

/* So hat ein Browser bis zur Umstellung gemeldet. */
const ALTER_RUMPF = {
  eventType: "analyze-success",
  durationMs: 41719,
  online: true,
  hidden: false,
  userAgent: "Chrome 153 / Android",
  url: "/",
  traceId: "vorgang-geheim-42",
  timings: { prepareImageMs: 705, enqueueMs: 1864, renderMs: 2199, totalMs: 41719 },
  meta: { subject: "HUMAN", mode: "multimodal", lang: "de", wakeLock: "acquired", queue: true },
  client: {
    deviceMemoryGb: 4,
    downlinkMbps: 9.5,
    dpr: 2.8,
    effectiveType: "4g",
    hardwareConcurrency: 8,
    language: "de-AT",
    rttMs: 0,
    saveData: false,
    screen: "small",
  },
};

describe("Erfolgsmeldung: kein Geraet, keine Kennung", () => {
  let zeilen;
  beforeEach(() => {
    zeilen = [];
    jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(z));
  });
  afterEach(() => jest.restoreAllMocks());

  test("ein aelterer Browser schickt alles — gespeichert wird nur Dauer, Seite und Motiv", async () => {
    await handleTelemetry({ method: "POST", body: ALTER_RUMPF, headers: {}, ip: "t-" + Math.random() }, mockRes());
    const roh = zeilen.find((z) => z.includes('"client-telemetry"'));
    expect(roh).toBeDefined();
    const zeile = JSON.parse(roh);
    /* Positivkontrolle: die erlaubten Angaben kommen an. */
    expect(zeile.eventType).toBe("analyze-success");
    expect(zeile.timings.totalMs).toBe(41719);
    expect(zeile.meta.subject).toBe("HUMAN");
    /* Nichts, was das Geraet beschreibt oder den Vorgang kennzeichnet. */
    expect(zeile).not.toHaveProperty("userAgent");
    expect(zeile).not.toHaveProperty("client");
    expect(zeile).not.toHaveProperty("traceId");
    expect(zeile.meta).not.toHaveProperty("wakeLock");
    for (const wert of ["Chrome 153", "Android", "vorgang-geheim-42", "de-AT", "small", "acquired"]) {
      expect(roh).not.toContain(wert);
    }
  });
});
