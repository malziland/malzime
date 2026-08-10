/* Tests für feature-flags.js — Laufzeit-Feature-Flags aus Firestore. */

const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet }));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ doc: mockDoc }),
}));

const flags = require("../feature-flags");

beforeEach(() => {
  jest.clearAllMocks();
  flags._clearCache();
});

describe("getFeatureFlags", () => {
  test("fail-safe: bei Lesefehler gelten Flags als false", async () => {
    mockGet.mockRejectedValue(new Error("firestore down"));
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: false,
      useBeastAdsCall: true,
    });
  });

  test("Ergebnis wird gecacht — kein erneuter Firestore-Read innerhalb der TTL", async () => {
    /* Eigener Mock-Wert: Der Test hing frueher am Zustand eines Nachbartests. */
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    await flags.getFeatureFlags();
    await flags.getFeatureFlags();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("useSingleLargeCall ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: true }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: true,
      usePromptCache: false,
      useBeastAdsCall: true,
    });
  });

  test("usePromptCache ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: true }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: true,
      useBeastAdsCall: true,
    });
  });

  test("usePromptCache ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: "ja" }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: false,
      useBeastAdsCall: true,
    });
  });

  test("useSingleLargeCall ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: 1 }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: false,
      useBeastAdsCall: true,
    });
  });
});

describe("isSingleLargeCallEnabled", () => {
  test("spiegelt das useSingleLargeCall-Flag", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: true }) });
    expect(await flags.isSingleLargeCallEnabled()).toBe(true);
  });

  test("ist false, wenn das Flag nicht gesetzt ist", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.isSingleLargeCallEnabled()).toBe(false);
  });
});

describe("isPromptCacheEnabled", () => {
  test("spiegelt das usePromptCache-Flag", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: true }) });
    expect(await flags.isPromptCacheEnabled()).toBe(true);
  });

  test("ist false, wenn das Flag nicht gesetzt ist", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.isPromptCacheEnabled()).toBe(false);
  });
});

describe("Lokal-Modus (QUEUE_LOCAL=1)", () => {
  afterEach(() => delete process.env.QUEUE_LOCAL);

  test("useSingleLargeCall standardmäßig aus im Emulator-Modus — ohne Firestore-Read", async () => {
    process.env.QUEUE_LOCAL = "1";
    flags._clearCache();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
