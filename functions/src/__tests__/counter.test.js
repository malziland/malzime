/* Tests for counter.js — Rolling window analysis counter */

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
}));

const {
  checkAndIncrement,
  incrementTotals,
  getStats,
  boostLimit,
  resetCounter,
  getMaintenanceStatus,
  setMaintenanceMode,
  _clearMaintenanceCache,
  filterRecent,
  calcRetrySeconds,
  getDateKeys,
} = require("../counter");

beforeEach(() => {
  jest.clearAllMocks();
  _clearMaintenanceCache();
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate, set: mockSet });
});

/* ── filterRecent ── */

describe("getDateKeys", () => {
  test("returns todayDate in YYYY-MM-DD format", () => {
    const keys = getDateKeys();
    expect(keys.todayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("returns weekStart in YYYY-MM-DD format", () => {
    const keys = getDateKeys();
    expect(keys.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("returns monthKey in YYYY-MM format", () => {
    const keys = getDateKeys();
    expect(keys.monthKey).toMatch(/^\d{4}-\d{2}$/);
  });

  test("returns yearKey as 4-digit string", () => {
    const keys = getDateKeys();
    expect(keys.yearKey).toMatch(/^\d{4}$/);
  });

  test("weekStart is a Monday", () => {
    const keys = getDateKeys();
    /* Parse the weekStart date and check day of week in Vienna timezone */
    const [y, m, d] = keys.weekStart.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    expect(date.getDay()).toBe(1); /* 1 = Monday */
  });

  test("uses Vienna timezone (not UTC)", () => {
    /* At 00:30 UTC on Jan 1, Vienna is already Jan 1 (UTC+1) — same day.
       At 23:30 UTC on Dec 31, Vienna is already Jan 1 (UTC+1) — different day. */
    const lateNightUtcDec31 = new Date("2026-12-31T23:30:00Z"); /* Vienna: 2027-01-01 00:30 */
    const keys = getDateKeys(lateNightUtcDec31);
    expect(keys.todayDate).toBe("2027-01-01");
    expect(keys.yearKey).toBe("2027");
    expect(keys.monthKey).toBe("2027-01");
  });
});

describe("filterRecent", () => {
  const WINDOW = 60 * 60 * 1000;

  test("filters out timestamps older than window", () => {
    const now = Date.now();
    const arr = [now - 90 * 60 * 1000, now - 30 * 60 * 1000, now - 5 * 60 * 1000];
    expect(filterRecent(arr, now, WINDOW)).toHaveLength(2);
  });

  test("handles Firestore timestamps with toMillis", () => {
    const now = Date.now();
    const arr = [{ toMillis: () => now - 5 * 60 * 1000 }, { toMillis: () => now - 90 * 60 * 1000 }];
    expect(filterRecent(arr, now, WINDOW)).toHaveLength(1);
  });

  test("returns empty array for null/undefined input", () => {
    expect(filterRecent(null, Date.now(), WINDOW)).toEqual([]);
    expect(filterRecent(undefined, Date.now(), WINDOW)).toEqual([]);
  });
});

/* ── calcRetrySeconds ── */

describe("calcRetrySeconds", () => {
  const WINDOW = 60 * 60 * 1000;

  test("returns 0 when under limit", () => {
    expect(calcRetrySeconds([Date.now()], 500, Date.now(), WINDOW)).toBe(0);
  });

  test("returns seconds until oldest entry ages out at exact limit", () => {
    const now = Date.now();
    const recent = [now - 50 * 60 * 1000, now - 10 * 60 * 1000]; // 2 entries
    const result = calcRetrySeconds(recent, 2, now, WINDOW);
    // oldest is 50 min ago, ages out in 10 min = 600s
    expect(result).toBeGreaterThanOrEqual(599);
    expect(result).toBeLessThanOrEqual(601);
  });

  test("returns seconds until pivot entry ages out when over limit", () => {
    const now = Date.now();
    // 3 entries, limit 2 → need 2nd oldest (index 1) to age out
    const recent = [now - 55 * 60 * 1000, now - 50 * 60 * 1000, now - 10 * 60 * 1000];
    const result = calcRetrySeconds(recent, 2, now, WINDOW);
    // pivot is index 1 (50 min ago), ages out in 10 min = 600s
    expect(result).toBeGreaterThanOrEqual(599);
    expect(result).toBeLessThanOrEqual(601);
  });
});

/* ── checkAndIncrement ── */

describe("checkAndIncrement", () => {
  test("allows request when under limit", async () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({
          recentAnalyses: [tenMinAgo, tenMinAgo + 1000],
          limit: 500,
          windowMinutes: 60,
        }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(3);
    expect(result.hourlyTotal).toBe(3);
    expect(result.retryAfterSeconds).toBe(0);
  });

  test("rolling window filters out old entries automatically", async () => {
    const now = Date.now();
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({
          recentAnalyses: [now - 90 * 60 * 1000, now - 30 * 60 * 1000, now - 5 * 60 * 1000],
          limit: 500,
          windowMinutes: 60,
        }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.hourlyTotal).toBe(3); // 2 recent + 1 new (old one filtered out)
  });

  test("blocks when at limit and returns retryAfterSeconds", async () => {
    const now = Date.now();
    const recent = Array.from({ length: 500 }, (_, i) => now - i * 1000);
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({ recentAnalyses: recent, limit: 500, windowMinutes: 60 }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(500);
    expect(result.hourlyTotal).toBe(500);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("sets justReached when count hits limit exactly", async () => {
    const now = Date.now();
    const recent = Array.from({ length: 499 }, (_, i) => now - i * 1000);
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({ recentAnalyses: recent, limit: 500, windowMinutes: 60 }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(500);
    expect(result.justReached).toBe(true);
  });

  test("unblocks automatically when entries age out", async () => {
    const now = Date.now();
    // 500 entries, but 499 are older than 60 min → only 1 recent
    const recent = [
      now - 5 * 60 * 1000, // recent
      ...Array.from({ length: 499 }, (_, i) => now - (61 + i) * 60 * 1000), // old
    ];
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({ recentAnalyses: recent, limit: 500, windowMinutes: 60 }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.hourlyTotal).toBe(2); // 1 recent + 1 new
  });

  test("works after admin reset (empty recentAnalyses)", async () => {
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({ recentAnalyses: [], limit: 500, windowMinutes: 60 }),
      });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.hourlyTotal).toBe(1);
  });

  test("initializes document when it does not exist", async () => {
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({ exists: false, data: () => ({}) });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.hourlyTotal).toBe(1);
  });

  test("fail-open on Firestore error", async () => {
    mockRunTransaction.mockRejectedValue(new Error("Firestore unavailable"));

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.error).toBe("Firestore unavailable");
  });

  test("v1.10.6: retries on ABORTED, succeeds on 2nd try", async () => {
    let calls = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      calls++;
      if (calls === 1) {
        const err = new Error("10 ABORTED: Aborted due to cross-transaction contention.");
        err.code = 10;
        throw err;
      }
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({ exists: true, data: () => ({ recentAnalyses: [], limit: 500 }) });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(calls).toBe(2);
  });

  test("v1.10.6: fail-open with aborted-retries-exhausted reason after all retries fail", async () => {
    const abortedErr = new Error("10 ABORTED: Aborted due to cross-transaction contention.");
    abortedErr.code = 10;
    mockRunTransaction.mockRejectedValue(abortedErr);

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.error).toContain("ABORTED");
    /* mockRunTransaction wurde 3× aufgerufen (initial + 2 Retries) */
    expect(mockRunTransaction).toHaveBeenCalledTimes(3);
  });

  test("uses default limit when not set in document", async () => {
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
      tx.get.mockResolvedValue({ exists: true, data: () => ({ recentAnalyses: [] }) });
      return fn(tx);
    });

    const result = await checkAndIncrement();
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(500);
  });
});

/* ── incrementTotals ── */

describe("incrementTotals", () => {
  test("increments all time periods on same day", async () => {
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const monthKey = now.toISOString().slice(0, 7);
    const yearKey = String(now.getFullYear());
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    const weekStart = monday.toISOString().slice(0, 10);

    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = { get: jest.fn(), set: jest.fn() };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({
          today: 10,
          todayDate,
          week: 50,
          weekStart,
          month: 200,
          monthKey,
          year: 500,
          yearKey,
          allTime: 1000,
        }),
      });
      return fn(tx);
    });

    await incrementTotals();
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  test("resets day counter on new day", async () => {
    let savedData = null;
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = {
        get: jest.fn(),
        set: jest.fn((_ref, data) => {
          savedData = data;
        }),
      };
      tx.get.mockResolvedValue({
        exists: true,
        data: () => ({
          today: 99,
          todayDate: "2020-01-01",
          week: 50,
          weekStart: "2020-01-01",
          month: 200,
          monthKey: "2020-01",
          year: 500,
          yearKey: "2020",
          allTime: 1000,
        }),
      });
      return fn(tx);
    });

    await incrementTotals();
    expect(savedData.today).toBe(1);
    expect(savedData.allTime).toBe(1001);
  });

  test("does not throw on Firestore error", async () => {
    mockRunTransaction.mockRejectedValue(new Error("DB down"));
    await expect(incrementTotals()).resolves.toBeUndefined();
  });
});

/* ── getStats ── */

describe("getStats", () => {
  /* Hilfsfunktion: Totals-Mock mit aktuellen Datums-Keys */
  function currentTotals(overrides = {}) {
    const keys = getDateKeys();
    return {
      todayDate: keys.todayDate,
      weekStart: keys.weekStart,
      monthKey: keys.monthKey,
      yearKey: keys.yearKey,
      today: 10,
      week: 50,
      month: 200,
      year: 500,
      allTime: 1000,
      ...overrides,
    };
  }

  test("returns rolling window count as hourlyTotal", async () => {
    const now = Date.now();
    const recentTs = [now - 10 * 60 * 1000, now - 20 * 60 * 1000, now - 90 * 60 * 1000];
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current" ? { recentAnalyses: recentTs, limit: 1000, windowMinutes: 60 } : currentTotals(),
      }),
    }));

    const result = await getStats();
    expect(result.current.count).toBe(2);
    expect(result.current.hourlyTotal).toBe(2);
    expect(result.current.limit).toBe(1000);
    expect(result.current.limitActive).toBe(false);
    expect(result.totals.allTime).toBe(1000);
  });

  test("returns 0 when recentAnalyses is empty", async () => {
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current" ? { recentAnalyses: [], limit: 500, windowMinutes: 60 } : currentTotals(),
      }),
    }));

    const result = await getStats();
    expect(result.current.hourlyTotal).toBe(0);
    expect(result.current.count).toBe(0);
    expect(result.current.limitActive).toBe(false);
  });

  test("detects limit as active and calculates retryAfterSeconds", async () => {
    const now = Date.now();
    const recent = Array.from({ length: 500 }, (_, i) => now - i * 1000);
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current" ? { recentAnalyses: recent, limit: 500, windowMinutes: 60 } : currentTotals(),
      }),
    }));

    const result = await getStats();
    expect(result.current.limitActive).toBe(true);
    expect(result.current.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.current.count).toBe(500);
  });

  test("returns null on Firestore error", async () => {
    mockDoc.mockImplementation(() => ({
      get: jest.fn().mockRejectedValue(new Error("DB down")),
    }));

    const result = await getStats();
    expect(result).toBeNull();
  });

  test("returns defaults when documents do not exist", async () => {
    mockDoc.mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    }));

    const result = await getStats();
    expect(result.current.count).toBe(0);
    expect(result.current.hourlyTotal).toBe(0);
    expect(result.current.limit).toBe(500);
    expect(result.totals.allTime).toBe(0);
  });

  test("does not write to Firestore (BUG-002, read-only path)", async () => {
    const now = Date.now();
    /* Create many stale entries that would have triggered cleanup before */
    const staleEntries = Array.from({ length: 50 }, (_, i) => now - (i + 1) * 120 * 60 * 1000);
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path.includes("current") ? { recentAnalyses: staleEntries, limit: 500, windowMinutes: 60 } : currentTotals(),
      }),
      update: mockUpdate,
      set: mockSet,
    }));

    await getStats();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test("resets today to 0 when todayDate is stale", async () => {
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current"
            ? { recentAnalyses: [], limit: 500, windowMinutes: 60 }
            : currentTotals({ todayDate: "2020-01-01", today: 42 }),
      }),
    }));

    const result = await getStats();
    expect(result.totals.today).toBe(0);
    expect(result.totals.allTime).toBe(1000);
  });

  test("resets week to 0 when weekStart is stale", async () => {
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current"
            ? { recentAnalyses: [], limit: 500, windowMinutes: 60 }
            : currentTotals({ weekStart: "2020-01-06", week: 99 }),
      }),
    }));

    const result = await getStats();
    expect(result.totals.week).toBe(0);
  });

  test("resets month to 0 when monthKey is stale", async () => {
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current"
            ? { recentAnalyses: [], limit: 500, windowMinutes: 60 }
            : currentTotals({ monthKey: "2020-01", month: 77 }),
      }),
    }));

    const result = await getStats();
    expect(result.totals.month).toBe(0);
  });

  test("resets year to 0 when yearKey is stale", async () => {
    mockDoc.mockImplementation((path) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () =>
          path === "stats/current"
            ? { recentAnalyses: [], limit: 500, windowMinutes: 60 }
            : currentTotals({ yearKey: "2020", year: 55 }),
      }),
    }));

    const result = await getStats();
    expect(result.totals.year).toBe(0);
  });
});

/* ── boostLimit ── */

describe("boostLimit", () => {
  /* SEC-2026-08-13-A: boostLimit läuft jetzt in einer Transaktion und schreibt
     einen ABSOLUTEN Wert. Die Attrappe reicht der Transaktionsfunktion ein tx
     mit dem hinterlegten Startwert; txSet fängt den Schreibaufruf. */
  function transaktionMit(startLimit, { getWirft } = {}) {
    const txSet = jest.fn();
    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = {
        get: getWirft
          ? jest.fn().mockRejectedValue(new Error("firestore weg"))
          : jest.fn().mockResolvedValue({ exists: true, data: () => ({ limit: startLimit }) }),
        set: txSet,
      };
      return fn(tx);
    });
    return txSet;
  }

  test("hebt das Limit auf den absoluten Zielwert (Start + amount)", async () => {
    const txSet = transaktionMit(500);
    const ergebnis = await boostLimit(200);
    expect(txSet).toHaveBeenCalledWith(expect.anything(), { limit: 700 }, { merge: true });
    expect(ergebnis).toEqual({ limit: 700, abgelehnt: false });
  });

  test("defaults to 100 when no amount given", async () => {
    const txSet = transaktionMit(500);
    const ergebnis = await boostLimit();
    expect(txSet).toHaveBeenCalledWith(expect.anything(), { limit: 600 }, { merge: true });
    expect(ergebnis.limit).toBe(600);
  });

  /* SEC-2026-08-12-17 + SEC-2026-08-13-A: ohne Obergrenze UND ohne Atomarität
     konnte der abgeflossene Boost-Link die einzige globale Kostenbremse
     praktisch abschalten. Jetzt: Deckel in der Transaktion, kein Schreiben. */
  test("ueber der Obergrenze (2x Stundenlimit) wird abgelehnt und laut gemeldet", async () => {
    const txSet = transaktionMit(950);
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const ergebnis = await boostLimit(100);

    expect(ergebnis.abgelehnt).toBe(true);
    expect(txSet).not.toHaveBeenCalled();
    const zeile = JSON.parse(fehlerSpy.mock.calls[0][0]);
    expect(zeile.severity).toBe("ERROR");
    expect(zeile.error).toBe("boost-obergrenze-erreicht");
    fehlerSpy.mockRestore();
  });

  test("ist die aktuelle Grenze nicht lesbar, wird NICHT erhoeht (fail-closed)", async () => {
    const txSet = transaktionMit(0, { getWirft: true });
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const ergebnis = await boostLimit(100);

    expect(ergebnis.abgelehnt).toBe(true);
    expect(ergebnis.limit).toBeNull();
    expect(txSet).not.toHaveBeenCalled();
    expect(JSON.parse(fehlerSpy.mock.calls[0][0]).error).toBe("boost-limit-nicht-lesbar");
    fehlerSpy.mockRestore();
  });
});

/* ── resetCounter ── */

describe("resetCounter", () => {
  test("clears recentAnalyses and resets limit", async () => {
    await resetCounter();
    expect(mockSet).toHaveBeenCalledWith({ recentAnalyses: [], limit: 500 }, { merge: true });
  });
});

/* ── getMaintenanceStatus ── */

describe("getMaintenanceStatus", () => {
  test("returns enabled:false when document does not exist", async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const result = await getMaintenanceStatus();
    expect(result.enabled).toBe(false);
  });

  test("returns enabled:true with message when flag is set", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ enabled: true, message: "Wartungsarbeiten" }),
      }),
    });
    const result = await getMaintenanceStatus();
    expect(result.enabled).toBe(true);
    expect(result.message).toBe("Wartungsarbeiten");
  });

  test("returns enabled:false when flag is not set", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ enabled: false }),
      }),
    });
    const result = await getMaintenanceStatus();
    expect(result.enabled).toBe(false);
  });

  test("fail-open on Firestore error", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockRejectedValue(new Error("DB down")),
    });
    const result = await getMaintenanceStatus();
    expect(result.enabled).toBe(false);
  });
});

/* ── setMaintenanceMode ── */

describe("setMaintenanceMode", () => {
  test("writes enabled flag to Firestore", async () => {
    await setMaintenanceMode(true, "Wartung aktiv");
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, message: "Wartung aktiv" }));
  });

  test("writes disabled flag to Firestore", async () => {
    await setMaintenanceMode(false);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, message: "" }));
  });
});
