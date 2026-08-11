import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

/* v3.0 Phase 2: Verdrahtung des Live-Texts in api.js — Mock-Aufbau wie in
   queue.test.js, zusätzlich wird die Live-Anzeige selbst gemockt (ihre
   Innereien prüft live-anzeige.test.js). */

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

vi.mock("../js/live-anzeige.js", () => ({
  welle: vi.fn(),
  modusWechsel: vi.fn(),
  hatLiveGelaufen: vi.fn(() => false),
  schnellVorlauf: vi.fn(() => Promise.resolve()),
  starteEnthuellung: vi.fn(),
  enthuellungAbkuerzen: vi.fn(),
  abbrechen: vi.fn(),
  zuruecksetzen: vi.fn(),
  /* v3.0.3 Blick-Führung: api.js ruft beides beim Analyse-Beginn. */
  fuehrungStarten: vi.fn(),
  augeInsBild: vi.fn(),
}));

const DONE_RESULT = {
  profiles: { normal: { categories: { a: {} }, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
};

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

describe("Queue-Verdrahtung des Live-Texts (v3.0)", () => {
  let analyzeImage, resumeQueueJob, state, elements, renderCurrentMode, liveAnzeige;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10000);
    sessionStorage.clear();

    const apiMod = await import("../js/api.js");
    const stateMod = await import("../js/state.js");
    const domMod = await import("../js/dom.js");
    const renderMod = await import("../js/render.js");
    liveAnzeige = await import("../js/live-anzeige.js");

    analyzeImage = apiMod.analyzeImage;
    resumeQueueJob = apiMod.resumeQueueJob;
    state = stateMod.state;
    elements = domMod.elements;
    renderCurrentMode = renderMod.renderCurrentMode;

    state.isAnalyzing = false;
    state.requestId = 0;
    state.lastPrepared = null;
    state.lastData = null;
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
    liveAnzeige.hatLiveGelaufen.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  /* Fetch-Mock: enqueue → jobId, danach die übergebene Folge von
     job-status-Antworten (die letzte wiederholt sich). */
  function mockeStatusFolge(statuses) {
    let poll = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-live", resultToken: "tok-1" });
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return jsonResponse(statuses[Math.min(poll++, statuses.length - 1)]);
    });
  }

  it("processing-Antwort mit liveText → die Welle erreicht die Live-Anzeige (beast null vor dessen Beginn)", async () => {
    mockeStatusFolge([
      { status: "processing", liveText: "Erste Welle" },
      { status: "processing", liveText: "Erste Welle, zweite Welle" },
      { status: "done", result: DONE_RESULT },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(12000);
    await p;
    expect(liveAnzeige.welle).toHaveBeenNthCalledWith(1, { standard: "Erste Welle", beast: null });
    expect(liveAnzeige.welle).toHaveBeenNthCalledWith(2, { standard: "Erste Welle, zweite Welle", beast: null });
  });

  it("processing-Antwort mit liveText UND liveTextBeast → beide Felder gehen als eine Welle ans Modul", async () => {
    mockeStatusFolge([
      { status: "processing", liveText: "Standard-Text.", liveTextBeast: "Du bist ein" },
      { status: "done", result: DONE_RESULT },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(12000);
    await p;
    expect(liveAnzeige.welle).toHaveBeenCalledWith({ standard: "Standard-Text.", beast: "Du bist ein" });
  });

  it("processing OHNE liveText (Flag aus) → keine einzige Welle, heutiger Pfad", async () => {
    mockeStatusFolge([{ status: "processing" }, { status: "done", result: DONE_RESULT }]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    expect(liveAnzeige.welle).not.toHaveBeenCalled();
  });

  it("done nach Live-Lauf → NACH dem normalen Rendern startet die gestaffelte Enthüllung", async () => {
    liveAnzeige.hatLiveGelaufen.mockReturnValue(true);
    mockeStatusFolge([
      { status: "processing", liveText: "A".repeat(240) },
      { status: "done", result: DONE_RESULT },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(renderCurrentMode).toHaveBeenCalled();
    expect(liveAnzeige.starteEnthuellung).toHaveBeenCalledTimes(1);
    /* Reihenfolge: erst rendern, dann verdecken+enthüllen (gleicher Frame). */
    expect(liveAnzeige.starteEnthuellung.mock.invocationCallOrder[0]).toBeGreaterThan(
      renderCurrentMode.mock.invocationCallOrder[0]
    );
  });

  it("v3.0.0: bei done wird ERST der Rest-Puffer schnell ausgetippt, DANN gerendert", async () => {
    /* Der Schnellvorlauf muss VOR dem Rendern abgewartet werden — sonst
       stünde das fertige Ergebnis schon unverdeckt auf der Seite, während
       die Karte noch tippt (harter Sprung statt sauberem Abschluss). */
    liveAnzeige.hatLiveGelaufen.mockReturnValue(true);
    let vorlaufFertig = false;
    liveAnzeige.schnellVorlauf.mockImplementationOnce(
      () =>
        new Promise((aufloesen) => {
          setTimeout(() => {
            vorlaufFertig = true;
            aufloesen();
          }, 500);
        })
    );
    let renderNachVorlauf = null;
    renderCurrentMode.mockImplementationOnce(() => {
      renderNachVorlauf = vorlaufFertig;
    });

    mockeStatusFolge([
      { status: "processing", liveText: "A".repeat(240) },
      { status: "done", result: DONE_RESULT },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(liveAnzeige.schnellVorlauf).toHaveBeenCalled();
    expect(renderNachVorlauf).toBe(true);
  });

  it("done OHNE Live-Lauf → EXAKT der heutige Pfad, die Enthüllung läuft NICHT", async () => {
    liveAnzeige.hatLiveGelaufen.mockReturnValue(false);
    mockeStatusFolge([{ status: "processing" }, { status: "done", result: DONE_RESULT }]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(renderCurrentMode).toHaveBeenCalled();
    expect(liveAnzeige.starteEnthuellung).not.toHaveBeenCalled();
  });

  it("Tier-Profil: auch nach Live-Lauf keine Enthüllung (heutiges Verhalten)", async () => {
    liveAnzeige.hatLiveGelaufen.mockReturnValue(true);
    const tierResult = { ...DONE_RESULT, meta: { mode: "animal", subject: "ANIMAL" } };
    mockeStatusFolge([
      { status: "processing", liveText: "A".repeat(240) },
      { status: "done", result: tierResult },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(renderCurrentMode).toHaveBeenCalled();
    expect(liveAnzeige.starteEnthuellung).not.toHaveBeenCalled();
    /* Eine eventuell stehende Live-Karte wird stattdessen abgeräumt. */
    expect(liveAnzeige.abbrechen).toHaveBeenCalled();
  });

  it("Resume nach Reload: Live-Wellen werden bewusst NICHT durchgereicht", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-resumed");
    sessionStorage.setItem("malzime.queueResultToken", "tok-1");
    const statuses = [
      { status: "processing", liveText: "Nach dem Reload angekommener Text" },
      { status: "done", result: DONE_RESULT },
    ];
    let poll = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return jsonResponse(statuses[Math.min(poll++, statuses.length - 1)]);
    });

    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(8000);
    await p;

    expect(liveAnzeige.welle).not.toHaveBeenCalled();
    expect(liveAnzeige.starteEnthuellung).not.toHaveBeenCalled();
    /* Ein eingefrorener Live-Lauf aus der Zeit vor dem Einfrieren wird beim
       Wiederaufsetzen restlos weggeräumt. */
    expect(liveAnzeige.zuruecksetzen).toHaveBeenCalled();
    expect(renderCurrentMode).toHaveBeenCalled();
  });

  it("Fehler mitten im Live-Text: Live-Karte samt Text wird entfernt, normale Fehlerbehandlung", async () => {
    mockeStatusFolge([
      { status: "processing", liveText: "A".repeat(240) },
      { status: "failed", errorReason: "processing_timeout" },
    ]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(liveAnzeige.welle).toHaveBeenCalled();
    expect(liveAnzeige.abbrechen).toHaveBeenCalled();
    expect(liveAnzeige.starteEnthuellung).not.toHaveBeenCalled();
    expect(elements.status.textContent).toContain("error.queueFailed");
  });

  it("Abbruch (abandoned) mitten im Live-Text: dito — Karte weg, Abbruch-Meldung", async () => {
    mockeStatusFolge([{ status: "processing", liveText: "A".repeat(240) }, { status: "abandoned" }]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    expect(liveAnzeige.abbrechen).toHaveBeenCalled();
    expect(elements.status.textContent).toContain("error.queueAbandoned");
  });

  it("jeder neue Durchgang beginnt mit zurückgesetzter Live-Anzeige", async () => {
    mockeStatusFolge([{ status: "done", result: DONE_RESULT }]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(liveAnzeige.zuruecksetzen).toHaveBeenCalled();
  });

  it("v3.0.3 Blick-Führung: der Analyse-Beginn startet die Führung und holt das Auge ins Bild", async () => {
    mockeStatusFolge([{ status: "done", result: DONE_RESULT }]);
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    /* (Rückbauprobe: Wird der Führungs-Start beim Analyse-Beginn entfernt —
       die Verallgemeinerung der Übernahme-Wache auf den ganzen Lauf —,
       werden diese Erwartungen ROT.) */
    expect(liveAnzeige.fuehrungStarten).toHaveBeenCalledTimes(1);
    expect(liveAnzeige.augeInsBild).toHaveBeenCalledTimes(1);
    /* Erst die Wache, dann das Anfahren — ohne Wache darf nie gescrollt werden. */
    expect(liveAnzeige.fuehrungStarten.mock.invocationCallOrder[0]).toBeLessThan(
      liveAnzeige.augeInsBild.mock.invocationCallOrder[0]
    );
  });

  it("v3.0.3: die Wiederaufnahme nach einem Reload startet KEINE Blick-Führung", async () => {
    /* Der Seitenstart ist keine Foto-Wahl — hier darf nichts von selbst
       scrollen (die Wiederaufnahme bleibt beim heutigen, stillen Bild). */
    sessionStorage.setItem("malzime.queueJobId", "job-resumed");
    sessionStorage.setItem("malzime.queueResultToken", "tok-1");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(liveAnzeige.fuehrungStarten).not.toHaveBeenCalled();
    expect(liveAnzeige.augeInsBild).not.toHaveBeenCalled();
  });
});
