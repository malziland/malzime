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
  test("useQueue ist false, wenn das Dokument fehlt", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: false, useSingleLargeCall: false });
  });

  test("useQueue ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useQueue: true }) });
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: true, useSingleLargeCall: false });
  });

  test("useQueue ist false bei jedem nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useQueue: "yes" }) });
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: false, useSingleLargeCall: false });
  });

  test("fail-safe: bei Lesefehler gelten Flags als false", async () => {
    mockGet.mockRejectedValue(new Error("firestore down"));
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: false, useSingleLargeCall: false });
  });

  test("Ergebnis wird gecacht — kein erneuter Firestore-Read innerhalb der TTL", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useQueue: true }) });
    await flags.getFeatureFlags();
    await flags.getFeatureFlags();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("useSingleLargeCall ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useQueue: true, useSingleLargeCall: true }) });
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: true, useSingleLargeCall: true });
  });

  test("useSingleLargeCall ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: 1 }) });
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: false, useSingleLargeCall: false });
  });
});

describe("isQueueEnabled", () => {
  test("spiegelt das useQueue-Flag", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useQueue: true }) });
    expect(await flags.isQueueEnabled()).toBe(true);
  });

  test("ist false, wenn das Flag nicht gesetzt ist", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.isQueueEnabled()).toBe(false);
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

describe("Lokal-Modus (QUEUE_LOCAL=1)", () => {
  afterEach(() => delete process.env.QUEUE_LOCAL);

  test("die Queue gilt im Emulator-Modus als an, useSingleLargeCall standardmäßig aus — ohne Firestore-Read", async () => {
    process.env.QUEUE_LOCAL = "1";
    flags._clearCache();
    expect(await flags.getFeatureFlags()).toEqual({ useQueue: true, useSingleLargeCall: false });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
