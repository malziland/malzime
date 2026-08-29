import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

/* Mock-Module die api.js importiert */
vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

vi.mock("../js/exif.js", () => ({
  prepareImage: vi.fn().mockResolvedValue({
    imageBase64: "QUFB",
    exif: { make: "Apple", model: "iPhone" },
    gps: null,
    dateTimeOriginal: null,
  }),
}));

vi.mock("../js/geocoding.js", () => ({
  startGeocoding: vi.fn(),
}));

vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  /* FEATURE-2026-08-29-01: Karten waehrend der Analyse. */
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

describe("analyzeImage", () => {
  let analyzeImage, state, elements, _setStatus;
  let prepareImage, startGeocoding, renderCurrentMode;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    /* Date.now() weit genug in der Zukunft für MIN_INTERACTION_MS */
    vi.setSystemTime(Date.now() + 10000);

    const apiMod = await import("../js/api.js");
    const stateMod = await import("../js/state.js");
    const domMod = await import("../js/dom.js");
    const uiMod = await import("../js/ui.js");
    const exifMod = await import("../js/exif.js");
    const geoMod = await import("../js/geocoding.js");
    const renderMod = await import("../js/render.js");

    analyzeImage = apiMod.analyzeImage;
    state = stateMod.state;
    elements = domMod.elements;
    _setStatus = uiMod.setStatus;
    prepareImage = exifMod.prepareImage;
    startGeocoding = geoMod.startGeocoding;
    renderCurrentMode = renderMod.renderCurrentMode;

    /* State zurücksetzen */
    state.isAnalyzing = false;
    state.requestId = 0;
    state.currentAbortController = null;
    state.lastPrepared = null;
    state.lastFile = null;
    state.lastData = null;
    state.pendingGeocode = null;

    /* Mock-File bereitstellen */
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sets isAnalyzing during execution", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: { normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
          privacyRisks: [],
          exif: {},
          meta: { requestId: "t", mode: "multimodal" },
        }),
    });
    const promise = analyzeImage();
    expect(state.isAnalyzing).toBe(true);
    await promise;
  });

  it("prevents double invocation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: { normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
          privacyRisks: [],
          exif: {},
          meta: {},
        }),
    });
    const p1 = analyzeImage();
    const p2 = analyzeImage();
    await p1;
    await p2;
    /* fetch sollte nur einmal aufgerufen werden */
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows error when no file selected", async () => {
    state.lastFile = null;
    /* fileInput.files muss leer sein */
    Object.defineProperty(elements.fileInput, "files", { value: [], configurable: true });
    await analyzeImage();
    expect(elements.status.textContent).toBe("error.noFile");
  });

  it("shows error for oversized file", async () => {
    state.lastFile = new File([new ArrayBuffer(30 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    await analyzeImage();
    expect(elements.status.textContent).toBe("error.fileTooLarge");
  });

  it("silently returns on honeypot trigger", async () => {
    /* Honeypot-Feld erstellen und befüllen */
    const hp = document.createElement("input");
    hp.id = "website";
    hp.value = "spam";
    document.body.appendChild(hp);
    await analyzeImage();
    expect(elements.status.textContent).toBe("");
    expect(state.isAnalyzing).toBe(false);
  });

  it("shows hard-limit message on 429 with blocked:limit body", async () => {
    /* v1.10.6: 429 mit blocked:"limit" → harter Stundenlimit-Treffer, kein Auto-Retry.
       Setup mit response.clone() damit der Code den Body lesen kann. */
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      clone: function () {
        return this;
      },
      json: () => Promise.resolve({ blocked: "limit", retryAfterSeconds: 600 }),
      text: () => Promise.resolve('{"blocked":"limit","retryAfterSeconds":600}'),
    });
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.rateLimit");
  });

  it("shows user-friendly message on 413", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 413,
      text: () => Promise.resolve("{}"),
    });
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.imageTooLarge");
  });

  it("shows user-friendly message on 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("{}"),
    });
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.invalidFormat");
  });

  it("handles network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.networkError");
  });

  it("injects GPS data client-side", async () => {
    prepareImage.mockResolvedValue({
      imageBase64: "QUFB",
      exif: { make: "Apple" },
      gps: { latitude: 48.2, longitude: 16.3 },
      dateTimeOriginal: "2025-01-01T12:00:00Z",
    });
    state.lastPrepared = null;

    /* Seit v2.10 laeuft jede Analyse ueber die Warteschlange — der GPS-Teil
       selbst ist unveraendert: Die Koordinaten verlassen den Browser nie und
       werden erst beim Rendern ins Ergebnis gelegt. */
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/enqueue")) return { ok: true, status: 200, json: async () => ({ jobId: "job-gps" }) };
      if (u.includes("job-status")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "done",
            result: {
              profiles: {
                normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "T" },
              },
              privacyRisks: [],
              exif: {},
              meta: {},
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const lauf = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await lauf;

    expect(renderCurrentMode).toHaveBeenCalled();
    const data = renderCurrentMode.mock.calls[0][0];
    expect(data.exif.gpsLatitude).toBe(48.2);
    expect(data.exif.gpsLongitude).toBe(16.3);
    expect(data.exif.dateTimeOriginal).toBe("2025-01-01T12:00:00Z");
  });

  it("starts geocoding when GPS is present", async () => {
    prepareImage.mockResolvedValue({
      imageBase64: "QUFB",
      exif: {},
      gps: { latitude: 48.0, longitude: 16.0 },
      dateTimeOriginal: null,
    });
    state.lastPrepared = null;

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: { normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
          privacyRisks: [],
          exif: {},
          meta: {},
        }),
    });

    await analyzeImage();
    expect(startGeocoding).toHaveBeenCalledWith(48.0, 16.0);
  });

  it("resets isAnalyzing after completion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: { normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
          privacyRisks: [],
          exif: {},
          meta: {},
        }),
    });
    await analyzeImage();
    /* FIX 3: kein End-Modal mehr — der Durchgang ist direkt abgeschlossen. */
    expect(state.isAnalyzing).toBe(false);
  });
});
