const mockDoc = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ doc: mockDoc }),
}));

const {
  getFeatureFlags,
  setAiProvider,
  DEFAULT_FLAGS,
  ALLOWED_AI_PROVIDERS,
  _clearCache,
} = require("../feature-flags");

beforeEach(() => {
  jest.clearAllMocks();
  _clearCache();
});

describe("DEFAULT_FLAGS", () => {
  test("defaults to gemini provider", () => {
    expect(DEFAULT_FLAGS.aiProvider).toBe("gemini");
  });

  test("is frozen (cannot be mutated)", () => {
    expect(Object.isFrozen(DEFAULT_FLAGS)).toBe(true);
  });
});

describe("ALLOWED_AI_PROVIDERS", () => {
  test("contains gemini and hybrid", () => {
    expect(ALLOWED_AI_PROVIDERS.has("gemini")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("hybrid")).toBe(true);
  });

  test("does not contain unknown values", () => {
    expect(ALLOWED_AI_PROVIDERS.has("openai")).toBe(false);
    expect(ALLOWED_AI_PROVIDERS.has("")).toBe(false);
  });
});

describe("getFeatureFlags", () => {
  test("returns defaults when document does not exist", async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("gemini");
  });

  test("returns gemini when document exists but has no aiProvider field", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ someOtherField: 1 }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("gemini");
  });

  test("returns hybrid when explicitly set in Firestore", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "hybrid" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("hybrid");
  });

  test("falls back to gemini if Firestore returns an invalid aiProvider value", async () => {
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ aiProvider: "openai" }) }),
    });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("gemini");
  });

  test("falls back to defaults on Firestore error (fail-open)", async () => {
    mockDoc.mockReturnValue({ get: jest.fn().mockRejectedValue(new Error("boom")) });
    const flags = await getFeatureFlags();
    expect(flags.aiProvider).toBe("gemini");
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
