/* Betriebswerte kommen seit 30.08.2026 ausschliesslich aus Firestore. Fuer
   Tests, die eine Analyse durchspielen, wird hier ein gueltiger Satz gestellt —
   sonst bricht jeder Aufruf mit "Betriebswerte fehlen" ab, was diese Tests
   nicht pruefen wollen. Wer das Verhalten OHNE Satz prueft, tut das in
   betriebsprofil*.test.js. */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { handleStats } = require("../handle-stats");

jest.mock("../counter");
const { getStats, getMaintenanceStatus, leseRealitaetsCheck } = require("../counter");

function mockReq(method = "GET") {
  return { method };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = jest.fn();
  return res;
}

describe("handleStats", () => {
  afterEach(() => jest.restoreAllMocks());

  test("returns 405 for POST", async () => {
    const res = mockRes();
    await handleStats(mockReq("POST"), res);
    expect(res.statusCode).toBe(405);
    expect(res.json).toHaveBeenCalledWith({ error: "Method not allowed" });
  });

  test("returns 405 for DELETE", async () => {
    const res = mockRes();
    await handleStats(mockReq("DELETE"), res);
    expect(res.statusCode).toBe(405);
  });

  test("returns 503 when getStats returns null", async () => {
    getStats.mockResolvedValue(null);
    getMaintenanceStatus.mockResolvedValue(false);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.statusCode).toBe(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Stats unavailable" });
  });

  test("returns stats with maintenance flag on success", async () => {
    const statsData = {
      current: { count: 10, limit: 500 },
      totals: { today: 10, week: 50, month: 200, total: 1000 },
    };
    getStats.mockResolvedValue(statsData);
    getMaintenanceStatus.mockResolvedValue(false);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({
      ...statsData,
      maintenance: false,
      useQueue: true,
      realitaetsCheck: undefined,
      /* Betriebswerte (29.08.2026): Ohne Firestore-Profil steht hier die
         Herkunft "code" und kein Profilname — genau der heutige Zustand.
         Die Zeitgrenze geht mit, damit der Browser weiss, wie lange er
         mindestens durchhalten muss. */
      /* Seit 30.08.2026 kommen die Betriebswerte ausschliesslich aus Firestore;
         der gestellte Satz oben liefert "firestore" und den Namen. */
      betrieb: { profil: "test", quelle: "firestore", analyseZeitgrenzeMs: 300000 },
      /* v3.3: Merkmals-Schloss des Sprachumschalters. Ohne gesetztes Flag
         steht es auf false — das Frontend baut den Schalter dann nicht. */
      sprachumschalter: false,
    });
  });

  test("includes maintenance: true when maintenance is active", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(true);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ maintenance: true }));
  });

  test("meldet useQueue: true — Uebergang fuer alte, zwischengespeicherte Clients", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(false);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ useQueue: true }));
  });

  test("liefert den anonymen Realitäts-Check-Zähler mit (eingaben + mittelProzent)", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(false);
    leseRealitaetsCheck.mockResolvedValue({ eingaben: 137, mittelProzent: 58 });
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ realitaetsCheck: { eingaben: 137, mittelProzent: 58 } })
    );
  });

  test("ohne Eingaben ist mittelProzent null — die Antwort bleibt vollständig", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(false);
    leseRealitaetsCheck.mockResolvedValue({ eingaben: 0, mittelProzent: null });
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ realitaetsCheck: { eingaben: 0, mittelProzent: null } })
    );
  });
});
