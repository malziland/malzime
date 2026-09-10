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
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
      /* Ist Firestore nicht lesbar, kann auch die Durchsatz-Messung nichts
         lesen — die Rechnung faellt ohnehin auf den Code-Wert zurueck. Hier
         `false`, damit der Fehlerfall keine Messung behauptet, die es nicht
         gibt. */
      useGemesseneDauer: false,
    });
  });

  test("Ergebnis wird gecacht — kein erneuter Firestore-Read innerhalb der TTL", async () => {
    /* Eigener Mock-Wert: Der Test hing frueher am Zustand eines Nachbartests. */
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    await flags.getFeatureFlags();
    await flags.getFeatureFlags();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("ein alter Eintrag useSingleLargeCall im Dokument wirkt nicht mehr", async () => {
    /* Das Flag ist mit dem Drei-Aufruf-Weg ausgebaut (10.09.2026). Steht es
       noch im Dokument, darf es weder gelesen noch weitergereicht werden. */
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSingleLargeCall: false }) });
    const ergebnis = await flags.getFeatureFlags();
    expect(ergebnis).not.toHaveProperty("useSingleLargeCall");
    expect(flags.isSingleLargeCallEnabled).toBeUndefined();
  });

  test("usePromptCache ist true, wenn das Dokument es so setzt", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: true }) });
    expect(await flags.getFeatureFlags()).toEqual({
      usePromptCache: true,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
      useGemesseneDauer: true,
    });
  });

  test("usePromptCache ist false bei nicht-true-Wert (kein versehentliches Aktivieren)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ usePromptCache: "ja" }) });
    expect(await flags.getFeatureFlags()).toEqual({
      usePromptCache: false,
      useBeastAdsCall: true,
      useLiveText: false,
      useSprachumschalter: false,
      useGemesseneDauer: true,
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

  test("Emulator-Modus: kein Firestore-Read, Live-Text nur mit QUEUE_LOCAL_LIVE", async () => {
    process.env.QUEUE_LOCAL = "1";
    flags._clearCache();
    try {
      const ohne = await flags.getFeatureFlags();
      expect(ohne.useLiveText).toBe(false);
      expect(ohne).not.toHaveProperty("useSingleLargeCall");
      process.env.QUEUE_LOCAL_LIVE = "1";
      expect((await flags.getFeatureFlags()).useLiveText).toBe(true);
    } finally {
      delete process.env.QUEUE_LOCAL_LIVE;
    }
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useSprachumschalter (v3.3)", () => {
  test("streng opt-in: nur der Wert true schaltet ihn ein", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: true }) });
    expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(true);
  });

  test.each([
    ["'true'", "true"],
    ["1", 1],
    ["ja", "ja"],
    ["null", null],
  ])("der Wert %s schaltet ihn NICHT ein", async (_name, wert) => {
    /* Ein Tippfehler im Firestore-Dokument darf kein Bedienelement vor ein
         Workshop-Publikum stellen. */
    flags._clearCache();
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: wert }) });
    expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(false);
  });

  test("fehlendes Dokument heisst aus", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect((await flags.getFeatureFlags()).useSprachumschalter).toBe(false);
  });

  test("Kurzform isSprachumschalterEnabled liefert dasselbe", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useSprachumschalter: true }) });
    expect(await flags.isSprachumschalterEnabled()).toBe(true);
  });
});
