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
      useLiveText: false,
      useSprachumschalter: false,
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
      useLiveText: false,
      useSprachumschalter: false,
    });
  });

  test("usePromptCache ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: true }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: true,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
    });
  });

  test("usePromptCache ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: "ja" }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
    });
  });

  test("useSingleLargeCall ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: 1 }) });
    expect(await flags.getFeatureFlags()).toEqual({
      useSingleLargeCall: false,
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
    });
  });
});

/* ── v3.0 Phase 1: useLiveText ───────────────────────────────────────────
   Das Flag schaltet den Live-Text-Strom des Workers. Entscheidend ist der
   Default: AUS — ohne explizites `useLiveText: true` im Dokument darf sich
   am Mistral-Aufruf nichts aendern. */
describe("useLiveText (v3.0 Phase 1)", () => {
  test("Default ist AUS — ein leeres Flag-Dokument aktiviert nichts", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    expect((await flags.getFeatureFlags()).useLiveText).toBe(false);
  });

  test("useLiveText ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useLiveText: true }) });
    expect((await flags.getFeatureFlags()).useLiveText).toBe(true);
  });

  test("useLiveText ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useLiveText: "ja" }) });
    expect((await flags.getFeatureFlags()).useLiveText).toBe(false);
  });

  test("fail-safe: bei Lesefehler bleibt der Live-Text aus", async () => {
    mockGet.mockRejectedValue(new Error("firestore down"));
    expect((await flags.getFeatureFlags()).useLiveText).toBe(false);
  });
});

describe("isLiveTextEnabled", () => {
  test("spiegelt das useLiveText-Flag", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useLiveText: true }) });
    expect(await flags.isLiveTextEnabled()).toBe(true);
  });

  test("ist false, wenn das Flag nicht gesetzt ist", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.isLiveTextEnabled()).toBe(false);
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

describe("useSprachumschalter (v3.3)", () => {
  test("streng opt-in: nur der Wert true schaltet ihn ein", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: true }) });
    expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(true);
  });

  test.each([["'true'", "true"], ["1", 1], ["ja", "ja"], ["null", null]])(
    "der Wert %s schaltet ihn NICHT ein",
    async (_name, wert) => {
      /* Ein Tippfehler im Firestore-Dokument darf kein Bedienelement vor ein
         Workshop-Publikum stellen. */
      flags._clearCache();
      mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: wert }) });
      expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(false);
    }
  );

  test("fehlendes Dokument heisst aus", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(false);
  });

  test("Kurzform isSprachumschalterEnabled liefert dasselbe", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: true }) });
    expect(await flags.isSprachumschalterEnabled()).toBe(true);
  });
});
