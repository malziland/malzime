import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* Abfolgen rund um Ablösung und Wiederaufnahme: Ein Durchgang, der nicht mehr
   der jüngste ist, schreibt nichts mehr in den gemeinsamen Zustand.
   Aufbau wie queue-livetext.test.js; api.js, ui.js, state.js und
   auftrag-speicher.js sind ECHT. Die Aufbereitung des Fotos (exif.js) ist
   steuerbar gemacht: Der Test bestimmt, wann welches Foto fertig wird. Den
   echten Eingabeweg im Browser prüft e2e/abfolgen.test.js. */

const steuerung = vi.hoisted(() => ({ offen: new Map(), sofort: null }));

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

vi.mock("../js/exif.js", () => ({
  prepareImage: vi.fn((file) => {
    if (steuerung.sofort) return Promise.resolve(steuerung.sofort);
    return new Promise((res) => steuerung.offen.set(file.name, res));
  }),
}));

vi.mock("../js/geocoding.js", () => ({ startGeocoding: vi.fn() }));

vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

vi.mock("../js/live-anzeige.js", () => ({
  welle: vi.fn(),
  modusWechsel: vi.fn(),
  hatLiveGelaufen: vi.fn(() => false),
  schnellVorlauf: vi.fn(() => Promise.resolve()),
  starteEnthuellung: vi.fn(),
  enthuellungAbkuerzen: vi.fn(),
  abbrechen: vi.fn(),
  zuruecksetzen: vi.fn(),
  pausieren: vi.fn(() => false),
  fortsetzen: vi.fn(() => false),
  istPausiert: vi.fn(() => false),
  fuehrungStarten: vi.fn(),
  augeInsBild: vi.fn(),
  versuchAbgleichen: vi.fn(),
}));

const ERGEBNIS = () => ({
  profiles: { normal: { categories: { a: {} }, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
});

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    clone() {
      return this;
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("Ablösung und Wiederaufnahme", () => {
  let api, state, renderCurrentMode;
  let hochgeladen, abruf, sicht;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    steuerung.offen.clear();
    steuerung.sofort = null;
    hochgeladen = [];
    abruf = () => jsonResponse({ status: "done", result: ERGEBNIS() });
    sicht = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => sicht });

    api = await import("../js/api.js");
    state = (await import("../js/state.js")).state;
    renderCurrentMode = (await import("../js/render.js")).renderCurrentMode;
    renderCurrentMode.mockClear();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opt) => {
      if (String(url).includes("/api/enqueue")) {
        hochgeladen.push(JSON.parse(opt.body).imageBase64);
        return jsonResponse({ jobId: "job-" + hochgeladen.length, resultToken: "tok" });
      }
      if (String(url).includes("job-status")) return abruf();
      return jsonResponse({ ok: true });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  /* Die Zustandszeilen von handleNewFile aus public/app.js (handleNewFile
     selbst ist nicht exportiert). */
  function neuesFotoGewaehlt(file) {
    state.auswahlNr += 1;
    state.isAnalyzing = false;
    state.pendingGeocode = null;
    state.geocodeCache = null;
    state.lastFile = file;
    state.auswahlZeit = Date.now();
    state.lastPrepared = null;
    state.lastData = null;
    return api.analyzeImage();
  }

  it("Zweites Foto, während das erste noch aufbereitet wird: Ort und Aufnahmedatum des ERSTEN landen nicht im Ergebnis des ZWEITEN", async () => {
    const fotoA = new File(["a"], "a.heic", { type: "image/heic" });
    const fotoB = new File(["b"], "b.jpg", { type: "image/jpeg" });

    const p1 = neuesFotoGewaehlt(fotoA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(steuerung.offen.has("a.heic")).toBe(true); /* Foto A steckt in der Aufbereitung */

    const p2 = neuesFotoGewaehlt(fotoB);
    await vi.advanceTimersByTimeAsync(200);
    expect(steuerung.offen.has("b.jpg")).toBe(true);

    /* Foto B (JPEG) ist schnell fertig und geht zum Server. */
    steuerung.offen.get("b.jpg")({
      imageBase64: "QkJC",
      mimeType: "image/jpeg",
      dateiname: "upload.jpg",
      exif: { make: "Samsung", model: "B" },
      gps: null,
      dateTimeOriginal: null,
    });
    await vi.advanceTimersByTimeAsync(300);
    /* Erst jetzt wird das langsame Foto A (HEIC) fertig — sein Durchgang ist laengst abgeloest. */
    steuerung.offen.get("a.heic")({
      imageBase64: "QUFB",
      mimeType: "image/jpeg",
      dateiname: "upload.jpg",
      exif: { make: "Apple", model: "A" },
      gps: { latitude: 48.2082, longitude: 16.3738 },
      dateTimeOriginal: "2026-06-01T10:00:00.000Z",
    });
    await vi.advanceTimersByTimeAsync(8000);
    await p1;
    await p2;

    expect(hochgeladen).toEqual(["QkJC"]); /* hochgeladen wurde nur Foto B — richtig */
    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
    const daten = renderCurrentMode.mock.calls[0][0];
    expect(daten.exif.gpsLatitude).toBeUndefined();
    expect(daten.exif.dateTimeOriginal).toBeUndefined();
    expect(state.lastPrepared.imageBase64).toBe("QkJC");
  });
});
