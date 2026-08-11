"use strict";

/* Realitäts-Check (v3.1): Der Telemetrie-Endpunkt nimmt für das Ereignis
   `realitaets-check` AUSSCHLIESSLICH die Kategorie-Stufen an. Alles andere
   (falsche Schlüssel, falsche Werte, verknüpfbare Felder) wird verworfen —
   die Privacy-Zusage hängt an genau dieser Strenge. */

jest.mock("../counter");
const { zaehleRealitaetsCheck } = require("../counter");
const { handleTelemetry } = require("../handle-telemetry");

function mockRes() {
  return {
    statusCode: null,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function mockReq(body) {
  return { method: "POST", body, headers: {}, ip: "test-" + Math.random() };
}

/* Ein vollständig gültiger Stufen-Satz (6 Zeilen). */
function gueltigeStufen() {
  return { alter: 1, geschlecht: 0, interessen: 0.5, charakter: 0.5, werbung: 1, manipulation: 0 };
}

describe("handleTelemetry — Ereignis realitaets-check", () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    zaehleRealitaetsCheck.mockResolvedValue(undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function geloggtesEreignis() {
    expect(logSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(logSpy.mock.calls[0][0]);
  }

  test("gültige Stufen (6 Zeilen): 204, Aggregat wird mit serverseitig berechnetem Score erhöht", async () => {
    const res = mockRes();
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen: gueltigeStufen() }), res);
    expect(res.statusCode).toBe(204);
    /* (1 + 0 + 0,5 + 0,5 + 1 + 0) / 6 = 0,5 → 50 */
    expect(zaehleRealitaetsCheck).toHaveBeenCalledTimes(1);
    expect(zaehleRealitaetsCheck).toHaveBeenCalledWith(50);
  });

  test("gültige Stufen OHNE Geschlecht (Weglass-Fall): Score aus 5 Zeilen", async () => {
    const res = mockRes();
    const stufen = { alter: 1, interessen: 1, charakter: 1, werbung: 1, manipulation: 0.5 };
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(res.statusCode).toBe(204);
    /* 4,5 / 5 = 0,9 → 90 */
    expect(zaehleRealitaetsCheck).toHaveBeenCalledWith(90);
  });

  test("dem Client wird kein fertiger Score geglaubt — er wird aus den Stufen gerechnet", async () => {
    const res = mockRes();
    /* Ein mitgeschickter score wäre ein fremder Schlüssel im BODY (nicht in
       stufen) — die Stufen zählen, der Behauptung wird nicht gefolgt. */
    await handleTelemetry(mockReq({ eventType: "realitaets-check", score: 100, stufen: gueltigeStufen() }), res);
    expect(zaehleRealitaetsCheck).toHaveBeenCalledWith(50);
  });

  test("fremder Schlüssel in stufen → komplett verworfen, kein Inkrement, kein Log", async () => {
    const res = mockRes();
    const stufen = { ...gueltigeStufen(), einkommen: 1 };
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(res.statusCode).toBe(204);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("unerlaubter Stufen-Wert (0,7) → verworfen, kein Inkrement", async () => {
    const res = mockRes();
    const stufen = { ...gueltigeStufen(), interessen: 0.7 };
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(res.statusCode).toBe(204);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
  });

  test("Geschlecht ist binär — 0,5 dort ist ungültig und verwirft alles", async () => {
    const res = mockRes();
    const stufen = { ...gueltigeStufen(), geschlecht: 0.5 };
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
  });

  test("fehlende Pflicht-Stufe → verworfen", async () => {
    const res = mockRes();
    const stufen = gueltigeStufen();
    delete stufen.manipulation;
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
  });

  test("stufen fehlt oder ist kein Objekt → verworfen", async () => {
    for (const stufen of [undefined, null, "alter=1", 42, [1, 0.5, 0]]) {
      const res = mockRes();
      await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
      expect(res.statusCode).toBe(204);
    }
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
  });

  test('String-Werte statt Zahlen ("1") → verworfen, kein Inkrement', async () => {
    const res = mockRes();
    const stufen = { ...gueltigeStufen(), alter: "1" };
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen }), res);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
  });

  test("nichts Verknüpfbares: traceId/jobId/userAgent aus dem Body landen NICHT im Log", async () => {
    const res = mockRes();
    await handleTelemetry(
      mockReq({
        eventType: "realitaets-check",
        stufen: gueltigeStufen(),
        traceId: "trace-123",
        jobId: "job-456",
        userAgent: "Mozilla/5.0",
        url: "/",
        client: { screen: "1200x800" },
      }),
      res
    );
    const ereignis = geloggtesEreignis();
    expect(ereignis.eventType).toBe("realitaets-check");
    expect(ereignis.stufen).toEqual(gueltigeStufen());
    expect(ereignis.traceId).toBeUndefined();
    expect(ereignis.jobId).toBeUndefined();
    expect(ereignis.userAgent).toBeUndefined();
    expect(ereignis.url).toBeUndefined();
    expect(ereignis.client).toBeUndefined();
  });

  test("Fehler beim Zählen wird still geschluckt — die Antwort bleibt 204", async () => {
    zaehleRealitaetsCheck.mockRejectedValue(new Error("Firestore weg"));
    const res = mockRes();
    await handleTelemetry(mockReq({ eventType: "realitaets-check", stufen: gueltigeStufen() }), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  test("gewöhnliche Telemetrie (analyze-success) bleibt unberührt und zählt NICHT ins Aggregat", async () => {
    const res = mockRes();
    await handleTelemetry(mockReq({ eventType: "analyze-success", durationMs: 1200 }), res);
    expect(res.statusCode).toBe(204);
    expect(zaehleRealitaetsCheck).not.toHaveBeenCalled();
    const ereignis = geloggtesEreignis();
    expect(ereignis.eventType).toBe("analyze-success");
  });
});
