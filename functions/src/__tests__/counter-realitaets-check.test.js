"use strict";

/* Realitäts-Check (v3.1): das anonyme Aggregat stats/realitaetsCheck —
   atomares Hochzählen (eingaben +1, summeProzent +score) und das Lesen
   für /api/stats. Fehler dürfen nie nach aussen schlagen (Telemetrie). */

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockRunTransaction = jest.fn();
const mockDoc = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: mockDoc,
    runTransaction: mockRunTransaction,
  }),
  FieldValue: {
    increment: (n) => ({ __increment: n }),
  },
}));

jest.mock("../config", () => ({
  HOURLY_LIMIT: 500,
  HOURLY_WINDOW_MINUTES: 60,
  FIRESTORE_DATABASE_ID: "",
}));

const { zaehleRealitaetsCheck, leseRealitaetsCheck } = require("../counter");

beforeEach(() => {
  jest.clearAllMocks();
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate, set: mockSet });
});

describe("zaehleRealitaetsCheck", () => {
  test("erhöht eingaben um 1 und summeProzent um den Score — atomar per increment, merge", async () => {
    mockSet.mockResolvedValue(undefined);
    await zaehleRealitaetsCheck(83);
    expect(mockDoc).toHaveBeenCalledWith("stats/realitaetsCheck");
    expect(mockSet).toHaveBeenCalledWith(
      {
        eingaben: { __increment: 1 },
        summeProzent: { __increment: 83 },
      },
      { merge: true }
    );
  });

  test("klemmt den Score defensiv auf 0–100", async () => {
    mockSet.mockResolvedValue(undefined);
    await zaehleRealitaetsCheck(1000);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ summeProzent: { __increment: 100 } }), {
      merge: true,
    });
    await zaehleRealitaetsCheck(-5);
    expect(mockSet).toHaveBeenLastCalledWith(expect.objectContaining({ summeProzent: { __increment: 0 } }), {
      merge: true,
    });
  });

  test("Firestore-Fehler wird still geschluckt (nur Log-Warnung, kein Wurf)", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockSet.mockRejectedValue(new Error("kaputt"));
    await expect(zaehleRealitaetsCheck(50)).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("realitaets-check-zaehler-fehler"));
    logSpy.mockRestore();
  });
});

describe("leseRealitaetsCheck", () => {
  test("liefert eingaben und den gerundeten Mittelwert", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ eingaben: 3, summeProzent: 200 }) });
    /* 200 / 3 = 66,67 → 67 */
    await expect(leseRealitaetsCheck()).resolves.toEqual({ eingaben: 3, mittelProzent: 67 });
  });

  test("bei 0 Eingaben ist mittelProzent null (keine Division durch 0)", async () => {
    mockGet.mockResolvedValue({ exists: false, data: () => ({}) });
    await expect(leseRealitaetsCheck()).resolves.toEqual({ eingaben: 0, mittelProzent: null });
  });

  test("Firestore-Fehler liefert den leeren Stand statt zu werfen", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockGet.mockRejectedValue(new Error("kaputt"));
    await expect(leseRealitaetsCheck()).resolves.toEqual({ eingaben: 0, mittelProzent: null });
    logSpy.mockRestore();
  });
});
