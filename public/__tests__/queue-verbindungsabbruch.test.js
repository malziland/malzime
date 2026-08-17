/**
 * queue-verbindungsabbruch.test.js — Was passiert, wenn mitten im Schreiben
 * die Verbindung abreisst (v3.3.1).
 *
 * HINTERGRUND: Ein Nutzer meldete, der Text sei waehrend des Schreibens
 * verschwunden und danach habe ein Netzwerkfehler dagestanden. Beides war so
 * gebaut. Zusaetzlich sagte die Meldung zu, die Analyse erscheine automatisch,
 * sobald man wieder online sei — dafuer gab es keinen Mechanismus: Es lauschte
 * niemand auf „online", und die Wiederaufnahme warf die Job-Nummer weg.
 *
 * Dieser Test haelt die drei Zusagen fest:
 *   1. Bei Verbindungsabbruch wird pausiert, nicht abgeraeumt.
 *   2. Die Job-Nummer ueberlebt — sie ist der einzige Weg zum fertigen Profil.
 *   3. „Wieder online" loest die Wiederaufnahme tatsaechlich aus.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

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
  pausieren: vi.fn(() => true),
  fortsetzen: vi.fn(() => true),
  istPausiert: vi.fn(() => false),
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

const JOB_ID_KEY = "malzime.queueJobId";

describe("Verbindungsabbruch mitten im Live-Text", () => {
  let apiMod, state, liveAnzeige;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10000);
    sessionStorage.clear();

    apiMod = await import("../js/api.js");
    ({ state } = await import("../js/state.js"));
    liveAnzeige = await import("../js/live-anzeige.js");

    state.isAnalyzing = false;
    state.requestId = 0;
    state.uploadLaeuft = false;
    state.wartetAufVerbindung = false;
    state.lastPrepared = null;
    state.lastData = null;
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  /** enqueue klappt, danach faellt jede Statusabfrage aus (Netz weg). */
  function mockeAbbruchNachErstemPoll() {
    let poll = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-abbruch", resultToken: "tok-1" });
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      poll += 1;
      if (poll === 1) return jsonResponse({ status: "processing", liveText: "Du bist 34 Jahre alt" });
      throw new TypeError("Load failed");
    });
  }

  it("pausiert den Live-Text, statt ihn wegzuraeumen", async () => {
    mockeAbbruchNachErstemPoll();

    const p = apiMod.analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    await p;

    expect(liveAnzeige.pausieren).toHaveBeenCalled();
    expect(liveAnzeige.abbrechen).not.toHaveBeenCalled();
  });

  it("behaelt die Job-Nummer — sonst ist das fertige Profil unerreichbar", async () => {
    mockeAbbruchNachErstemPoll();

    const p = apiMod.analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    await p;

    expect(sessionStorage.getItem(JOB_ID_KEY)).toBe("job-abbruch");
  });

  it("merkt sich, dass ein Durchgang auf die Verbindung wartet", async () => {
    mockeAbbruchNachErstemPoll();

    const p = apiMod.analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    await p;

    /* isAnalyzing ist bewusst wieder false (der Nutzer darf ein neues Foto
       waehlen) — der Anker fuer die Wiederaufnahme haengt deshalb hier. */
    expect(state.isAnalyzing).toBe(false);
    expect(state.wartetAufVerbindung).toBe(true);
  });

  it("das Ereignis 'wieder online' loest die Wiederaufnahme aus und liefert das Ergebnis nach", async () => {
    mockeAbbruchNachErstemPoll();
    apiMod.initHintergrundWiederaufnahme();

    const p = apiMod.analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(state.wartetAufVerbindung).toBe(true);

    /* Netz ist zurueck: Ab jetzt antwortet die Statusabfrage wieder. */
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) return jsonResponse({ status: "done", result: DONE_RESULT });
      return jsonResponse({ ok: true });
    });

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(5000);

    const renderMod = await import("../js/render.js");
    expect(renderMod.renderCurrentMode).toHaveBeenCalled();
  });

  it("setzt den Live-Text fort, wenn er nur pausiert war (kein Zuruecksetzen)", async () => {
    sessionStorage.setItem(JOB_ID_KEY, "job-abbruch");
    liveAnzeige.istPausiert.mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) return jsonResponse({ status: "done", result: DONE_RESULT });
      return jsonResponse({ ok: true });
    });

    await apiMod.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(3000);

    expect(liveAnzeige.fortsetzen).toHaveBeenCalled();
    /* Genau das war der Fehler bis v3.3.0: Die Wiederaufnahme setzte den Lauf
       zurueck und liess den Text damit fallen. */
    expect(liveAnzeige.zuruecksetzen).not.toHaveBeenCalled();
  });

  it("nach einem Neuladen (kein pausierter Lauf) bleibt es beim bisherigen Verhalten", async () => {
    sessionStorage.setItem(JOB_ID_KEY, "job-abbruch");
    liveAnzeige.istPausiert.mockReturnValue(false);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) return jsonResponse({ status: "done", result: DONE_RESULT });
      return jsonResponse({ ok: true });
    });

    await apiMod.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(3000);

    expect(liveAnzeige.zuruecksetzen).toHaveBeenCalled();
    expect(liveAnzeige.fortsetzen).not.toHaveBeenCalled();
  });

  it("ein zweiter Abbruch waehrend der Wiederaufnahme wirft die Job-Nummer NICHT weg", async () => {
    sessionStorage.setItem(JOB_ID_KEY, "job-abbruch");
    liveAnzeige.istPausiert.mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) throw new TypeError("Load failed");
      return jsonResponse({ ok: true });
    });

    const p = apiMod.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(60000);
    await p;

    expect(sessionStorage.getItem(JOB_ID_KEY)).toBe("job-abbruch");
    expect(state.wartetAufVerbindung).toBe(true);
  });
});
