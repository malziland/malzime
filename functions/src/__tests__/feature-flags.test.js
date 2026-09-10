/* Tests für feature-flags.js — Laufzeit-Feature-Flags aus Firestore.

   Seit 10.09.2026 gibt es nur noch zwei Schalter: den Notausschalter fuer den
   zweiten Mistral-Aufruf (useBeastAdsCall) und die gemessene Dauer
   (useGemesseneDauer). usePromptCache, useLiveText und useSprachumschalter
   sind fest eingebaut; ein alter Eintrag im Dokument darf nichts mehr
   bewirken. */

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
  test("fail-safe: bei Lesefehler bleibt der Zweitaufruf an, die Messung aus", async () => {
    mockGet.mockRejectedValue(new Error("firestore down"));
    expect(await flags.getFeatureFlags()).toEqual({
      useBeastAdsCall: true,
      /* Ist Firestore nicht lesbar, kann auch die Durchsatz-Messung nichts
         lesen — die Rechnung faellt ohnehin auf den Satz-Wert zurueck. Hier
         `false`, damit der Fehlerfall keine Messung behauptet, die es nicht
         gibt. */
      useGemesseneDauer: false,
    });
  });

  test("leeres Dokument: beide Schalter stehen im Normalbetrieb (an)", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    expect(await flags.getFeatureFlags()).toEqual({ useBeastAdsCall: true, useGemesseneDauer: true });
  });

  test("beide lassen sich nur mit genau false ausschalten", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useBeastAdsCall: false, useGemesseneDauer: false }) });
    expect(await flags.getFeatureFlags()).toEqual({ useBeastAdsCall: false, useGemesseneDauer: false });
    flags._clearCache();
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useBeastAdsCall: "nein", useGemesseneDauer: 0 }) });
    expect(await flags.getFeatureFlags()).toEqual({ useBeastAdsCall: true, useGemesseneDauer: true });
  });

  test("Ergebnis wird gecacht — kein erneuter Firestore-Read innerhalb der TTL", async () => {
    /* Eigener Mock-Wert: Der Test hing frueher am Zustand eines Nachbartests. */
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    await flags.getFeatureFlags();
    await flags.getFeatureFlags();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test.each(["useSingleLargeCall", "useQueue", "usePromptCache", "useLiveText", "useSprachumschalter"])(
    "ein alter Eintrag %s im Dokument wirkt nicht mehr",
    async (feld) => {
      /* Entfernte bzw. fest eingebaute Schalter: Steht ein Feld noch im
         Dokument, darf es weder gelesen noch weitergereicht werden — egal
         mit welchem Wert. */
      mockGet.mockResolvedValue({ exists: true, data: () => ({ [feld]: false }) });
      const ergebnis = await flags.getFeatureFlags();
      expect(ergebnis).not.toHaveProperty(feld);
      expect(ergebnis).toEqual({ useBeastAdsCall: true, useGemesseneDauer: true });
    }
  );

  test("die Kurzformen der entfernten Schalter gibt es nicht mehr", () => {
    for (const name of [
      "isSingleLargeCallEnabled",
      "isPromptCacheEnabled",
      "isLiveTextEnabled",
      "isSprachumschalterEnabled",
    ]) {
      expect(flags[name]).toBeUndefined();
    }
    /* Positivkontrolle: die verbleibende Kurzform ist da. */
    expect(typeof flags.isBeastAdsCallEnabled).toBe("function");
  });
});

describe("isBeastAdsCallEnabled", () => {
  test("spiegelt das useBeastAdsCall-Flag", async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ useBeastAdsCall: false }) });
    expect(await flags.isBeastAdsCallEnabled()).toBe(false);
  });

  test("fehlendes Dokument heisst an (Normalbetrieb)", async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await flags.isBeastAdsCallEnabled()).toBe(true);
  });
});

describe("Lokal-Modus (QUEUE_LOCAL=1)", () => {
  afterEach(() => delete process.env.QUEUE_LOCAL);

  test("Emulator-Modus: kein Firestore-Read, feste Werte", async () => {
    process.env.QUEUE_LOCAL = "1";
    flags._clearCache();
    expect(await flags.getFeatureFlags()).toEqual({ useBeastAdsCall: true, useGemesseneDauer: false });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
