const mockDoc = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ doc: mockDoc }),
}));

const {
  getFeatureFlags,
  setAiProvider,
  setAiProviderHybridPct,
  resolveProvider,
  DEFAULT_FLAGS,
  ALLOWED_AI_PROVIDERS,
  _clearCache,
  _hashToBucket,
} = require("../feature-flags");

beforeEach(() => {
  jest.clearAllMocks();
  _clearCache();
});

describe("DEFAULT_FLAGS", () => {
  test("defaults to auto provider (Phase 4 Auto-Ramp)", () => {
    expect(DEFAULT_FLAGS.aiProvider).toBe("auto");
  });

  test("default pct is undefined (Auto-Ramp aktiv, kein manueller Override)", () => {
    expect(DEFAULT_FLAGS.aiProviderHybridPct).toBeUndefined();
  });

  test("is frozen (cannot be mutated)", () => {
    expect(Object.isFrozen(DEFAULT_FLAGS)).toBe(true);
  });
});

describe("ALLOWED_AI_PROVIDERS", () => {
  test("contains auto, gemini, hybrid", () => {
    expect(ALLOWED_AI_PROVIDERS.has("auto")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("gemini")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("hybrid")).toBe(true);
  });

  test("does not contain unknown values", () => {
    expect(ALLOWED_AI_PROVIDERS.has("openai")).toBe(false);
    expect(ALLOWED_AI_PROVIDERS.has("")).toBe(false);
  });
});

describe("getFeatureFlags", () => {
  test("returns auto-default when document does not exist", async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("auto");
  });

  test("returns auto when document exists but has no aiProvider field", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ someOtherField: 1 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("auto");
  });

  test("returns hybrid when explicitly set in Firestore", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("hybrid");
  });

  test("falls back to auto if Firestore returns an invalid aiProvider value", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "openai" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("auto");
  });

  test("falls back to auto defaults on Firestore error (fail-open)", async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockRejectedValue(new Error("boom")) });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("auto");
  });

  test("uses cache on subsequent calls within TTL", async () => {
    const getter = jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid" }) });
    mockDoc.mockReturnValue({ get: getter });
    await getFeatureFlags();
    await getFeatureFlags();
    await getFeatureFlags();
    expect(getter).toHaveBeenCalledTimes(1);
  });
});

describe("setAiProvider", () => {
  test("writes valid value to Firestore", async () => {
    const setter = jest.fn().mockResolvedValue();
    mockDoc.mockReturnValue({ set: setter });
    await setAiProvider("hybrid");
    expect(setter).toHaveBeenCalledWith(
      expect.objectContaining({ aiProvider: "hybrid", updatedAt: expect.any(Number) }),
      { merge: true }
    );
  });

  test("rejects invalid provider values", async () => {
    await expect(setAiProvider("openai")).rejects.toMatchObject({ code: "invalid_value" });
    await expect(setAiProvider("")).rejects.toMatchObject({ code: "invalid_value" });
    await expect(setAiProvider(null)).rejects.toMatchObject({ code: "invalid_value" });
  });

  test("invalidates cache after successful set", async () => {
    const getter = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ aiProvider: "gemini" }),
    });
    const setter = jest.fn().mockResolvedValue();
    mockDoc.mockReturnValue({ get: getter, set: setter });

    /* Prime cache mit gemini */
    await getFeatureFlags();
    expect(getter).toHaveBeenCalledTimes(1);

    /* Wechsel zu hybrid via setter */
    getter.mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid" }) });
    await setAiProvider("hybrid");

    /* Nächster getFeatureFlags muss Firestore neu lesen */
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("hybrid");
    expect(getter).toHaveBeenCalledTimes(2);
  });
});

/* ── Phase 4 Ramp-Up: aiProviderHybridPct ──────────────────────────── */

describe("getFeatureFlags — aiProviderHybridPct field", () => {
  test("is undefined when field absent (so Auto-Ramp greift)", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBeUndefined();
  });

  test("accepts integer 0-100", async () => {
    mockDoc.mockReturnValue({
      get: jest
        .fn()
        .mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid", aiProviderHybridPct: 25 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBe(25);
  });

  test("clamps negative values to 0", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProviderHybridPct: -10 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBe(0);
  });

  test("clamps values > 100 to 100", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProviderHybridPct: 200 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBe(100);
  });

  test("floors fractional values", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProviderHybridPct: 33.7 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBe(33);
  });

  test("falls back to undefined for non-numeric value (Auto-Ramp greift wieder)", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProviderHybridPct: "many" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProviderHybridPct).toBeUndefined();
  });
});

describe("setAiProviderHybridPct", () => {
  test("writes valid integer 0-100", async () => {
    const setter = jest.fn().mockResolvedValue();
    mockDoc.mockReturnValue({ set: setter });
    await setAiProviderHybridPct(50);
    expect(setter).toHaveBeenCalledWith(
      expect.objectContaining({ aiProviderHybridPct: 50, updatedAt: expect.any(Number) }),
      { merge: true }
    );
  });

  test("rejects negative values", async () => {
    await expect(setAiProviderHybridPct(-1)).rejects.toMatchObject({ code: "invalid_value" });
  });

  test("rejects values > 100", async () => {
    await expect(setAiProviderHybridPct(101)).rejects.toMatchObject({ code: "invalid_value" });
  });

  test("rejects non-integer values", async () => {
    await expect(setAiProviderHybridPct(33.5)).rejects.toMatchObject({ code: "invalid_value" });
  });

  test("rejects NaN, Infinity, strings", async () => {
    await expect(setAiProviderHybridPct(NaN)).rejects.toMatchObject({ code: "invalid_value" });
    await expect(setAiProviderHybridPct(Infinity)).rejects.toMatchObject({ code: "invalid_value" });
    await expect(setAiProviderHybridPct("50")).rejects.toMatchObject({ code: "invalid_value" });
  });
});

/* ── resolveProvider Sample-Logik ──────────────────────────────────── */

describe("resolveProvider", () => {
  /* Kill-Switch hat höchste Priorität */
  test("returns gemini when aiProvider is gemini regardless of pct", () => {
    expect(resolveProvider({ aiProvider: "gemini", aiProviderHybridPct: 100 }, "any")).toBe("gemini");
    expect(resolveProvider({ aiProvider: "gemini", aiProviderHybridPct: 50 }, "any")).toBe("gemini");
  });

  test("aiProvider=hybrid forces 100% regardless of schedule", () => {
    expect(resolveProvider({ aiProvider: "hybrid" }, "x")).toBe("hybrid");
  });

  test("manual aiProviderHybridPct=0 overrides hybrid to give gemini", () => {
    expect(resolveProvider({ aiProvider: "hybrid", aiProviderHybridPct: 0 }, "x")).toBe("gemini");
    expect(resolveProvider({ aiProvider: "auto", aiProviderHybridPct: 0 }, "x")).toBe("gemini");
  });

  test("manual aiProviderHybridPct=100 forces hybrid", () => {
    expect(resolveProvider({ aiProvider: "auto", aiProviderHybridPct: 100 }, "x")).toBe("hybrid");
  });

  test("is deterministic for the same sampleKey", () => {
    const flags = { aiProvider: "auto", aiProviderHybridPct: 50 };
    const first = resolveProvider(flags, "192.168.1.42");
    const second = resolveProvider(flags, "192.168.1.42");
    const third = resolveProvider(flags, "192.168.1.42");
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test("distribution across many sampleKeys approximates the configured pct", () => {
    const flags = { aiProvider: "auto", aiProviderHybridPct: 30 };
    let hybridCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (resolveProvider(flags, `ip-${i}`) === "hybrid") hybridCount++;
    }
    expect(hybridCount).toBeGreaterThan(250);
    expect(hybridCount).toBeLessThan(350);
  });

  test("uses random fallback when sampleKey is empty", () => {
    const flags = { aiProvider: "auto", aiProviderHybridPct: 50 };
    const outcomes = new Set();
    for (let i = 0; i < 100; i++) {
      outcomes.add(resolveProvider(flags, ""));
    }
    expect(outcomes.size).toBe(2);
  });
});

/* ── Phase 4 Auto-Ramp ───────────────────────────────────────────── */

describe("calculateRampPct", () => {
  const { calculateRampPct } = require("../feature-flags");
  const { MISTRAL_RAMP_START_ISO } = require("../config");
  const startMs = Date.parse(MISTRAL_RAMP_START_ISO);

  test("returns 0 before ramp start time", () => {
    expect(calculateRampPct(startMs - 1000)).toBe(0);
    expect(calculateRampPct(0)).toBe(0);
  });

  test("returns 1 at start (Tag 1)", () => {
    expect(calculateRampPct(startMs)).toBe(1);
    expect(calculateRampPct(startMs + 12 * 3600 * 1000)).toBe(1);
  });

  test("returns 10 from hour 24 (Tag 2)", () => {
    expect(calculateRampPct(startMs + 24 * 3600 * 1000)).toBe(10);
    expect(calculateRampPct(startMs + 40 * 3600 * 1000)).toBe(10);
  });

  test("returns 33 from hour 48 (Tag 3-5)", () => {
    expect(calculateRampPct(startMs + 48 * 3600 * 1000)).toBe(33);
    expect(calculateRampPct(startMs + 100 * 3600 * 1000)).toBe(33);
  });

  test("returns 66 from hour 120 (Tag 6-7)", () => {
    expect(calculateRampPct(startMs + 120 * 3600 * 1000)).toBe(66);
    expect(calculateRampPct(startMs + 150 * 3600 * 1000)).toBe(66);
  });

  test("returns 100 from hour 168 (Tag 8+)", () => {
    expect(calculateRampPct(startMs + 168 * 3600 * 1000)).toBe(100);
    expect(calculateRampPct(startMs + 1000 * 3600 * 1000)).toBe(100);
  });
});

describe("resolveProvider — Auto-Ramp default behavior", () => {
  const { MISTRAL_RAMP_START_ISO } = require("../config");
  const startMs = Date.parse(MISTRAL_RAMP_START_ISO);

  test("auto mode before ramp start: all gemini", () => {
    /* Egal welcher Hash-Bucket, mit pct=0 ist immer gemini */
    for (let i = 0; i < 50; i++) {
      expect(resolveProvider({ aiProvider: "auto" }, `ip-${i}`, startMs - 1000)).toBe("gemini");
    }
  });

  test("auto mode at Day 1 (1% hybrid)", () => {
    let hybridCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (resolveProvider({ aiProvider: "auto" }, `ip-${i}`, startMs) === "hybrid") hybridCount++;
    }
    /* 1% von 1000 = ~10, mit Toleranz */
    expect(hybridCount).toBeLessThan(25);
  });

  test("auto mode at Day 8+: all hybrid", () => {
    const day8 = startMs + 168 * 3600 * 1000;
    for (let i = 0; i < 50; i++) {
      expect(resolveProvider({ aiProvider: "auto" }, `ip-${i}`, day8)).toBe("hybrid");
    }
  });

  test("null/undefined flags use auto-ramp (Phase 4 default)", () => {
    /* Vor Start → gemini (weil pct=0 errechnet wird) */
    expect(resolveProvider(null, "any", startMs - 1000)).toBe("gemini");
    expect(resolveProvider(undefined, "any", startMs - 1000)).toBe("gemini");
    /* An Tag 8 → hybrid */
    const day8 = startMs + 168 * 3600 * 1000;
    expect(resolveProvider(null, "any", day8)).toBe("hybrid");
  });

  test("aiProvider=gemini kill-switch wirkt auch nach Tag 8", () => {
    const day8 = startMs + 168 * 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      expect(resolveProvider({ aiProvider: "gemini" }, `ip-${i}`, day8)).toBe("gemini");
    }
  });

  test("manueller pct-Override schlägt Auto-Ramp", () => {
    const day8 = startMs + 168 * 3600 * 1000; /* Auto würde 100 sagen */
    /* Mit Override auf 0 → trotz Tag 8 alles gemini */
    for (let i = 0; i < 20; i++) {
      expect(resolveProvider({ aiProvider: "auto", aiProviderHybridPct: 0 }, `ip-${i}`, day8)).toBe("gemini");
    }
  });
});

describe("_hashToBucket", () => {
  test("returns integer in range [0, 99]", () => {
    for (const key of ["a", "x", "192.168.1.1", "very-long-string-with-bytes"]) {
      const b = _hashToBucket(key);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(99);
      expect(Number.isInteger(b)).toBe(true);
    }
  });

  test("is deterministic", () => {
    expect(_hashToBucket("test")).toBe(_hashToBucket("test"));
  });

  test("different inputs typically give different buckets", () => {
    const buckets = new Set();
    for (let i = 0; i < 100; i++) buckets.add(_hashToBucket(`key-${i}`));
    /* Erwarten zumindest 30 unterschiedliche Buckets bei 100 verschiedenen Inputs */
    expect(buckets.size).toBeGreaterThan(30);
  });
});
