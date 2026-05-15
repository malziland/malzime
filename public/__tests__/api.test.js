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

  it("shows user-friendly message on 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("{}"),
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

  it("shows server error on 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("{}"),
    });
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.serverError");
  });

  it("handles AbortError (timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.timeout");
  });

  it("handles network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.networkError");
  });

  it("shows suspend message when the page was hidden during the request (Wake-Lock)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      /* Gerät geht während des Requests in Standby → Seite wird versteckt */
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      throw new Error("network");
    });
    await analyzeImage();
    expect(elements.status.textContent).toContain("error.suspended");
    /* Cleanup für nachfolgende Tests */
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("injects GPS data client-side", async () => {
    prepareImage.mockResolvedValue({
      imageBase64: "QUFB",
      exif: { make: "Apple" },
      gps: { latitude: 48.2, longitude: 16.3 },
      dateTimeOriginal: "2025-01-01T12:00:00Z",
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

    /* showDisclaimerModal wurde aufgerufen — simuliere Confirm-Click
       elements referenziert die gecachten DOM-Nodes aus dom.js */
    expect(elements.disclaimerModal.classList.contains("active")).toBe(true);
    elements.disclaimerConfirm.click();

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
    /* Nach Disclaimer-Confirm: */
    elements.disclaimerConfirm.click();
    expect(state.isAnalyzing).toBe(false);
  });
});
