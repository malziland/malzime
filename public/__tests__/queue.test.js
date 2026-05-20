import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

/* Mock-Module die api.js importiert (analog zu api.test.js) */
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

/* Eine done-Job-Antwort des job-status-Endpoints. */
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

describe("Queue-Modus", () => {
  let analyzeImage, resumeQueueJob, getStoredJobId, state, elements, renderCurrentMode;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10000);
    sessionStorage.clear();

    const apiMod = await import("../js/api.js");
    const stateMod = await import("../js/state.js");
    const domMod = await import("../js/dom.js");
    const renderMod = await import("../js/render.js");

    analyzeImage = apiMod.analyzeImage;
    resumeQueueJob = apiMod.resumeQueueJob;
    getStoredJobId = apiMod.getStoredJobId;
    state = stateMod.state;
    elements = domMod.elements;
    renderCurrentMode = renderMod.renderCurrentMode;

    state.isAnalyzing = false;
    state.requestId = 0;
    state.lastPrepared = null;
    state.lastData = null;
    state.useQueue = true;
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("Flag aus → synchroner Pfad: kein Aufruf an /api/enqueue", async () => {
    state.useQueue = false;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(DONE_RESULT));
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/enqueue"))).toBe(false);
  });

  it("Flag an → reiht via /api/enqueue ein und pollt /api/job-status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/enqueue"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/job-status?jobId=job-1"))).toBe(true);
  });

  it("queued → processing → done: rendert am Ende das Ergebnis", async () => {
    const statuses = [
      { status: "queued", position: 3, etaSeconds: 180 },
      { status: "processing" },
      { status: "done", result: DONE_RESULT },
    ];
    let poll = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse(statuses[Math.min(poll++, statuses.length - 1)]);
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(12000);
    await p;
    elements.disclaimerConfirm.click();
    expect(renderCurrentMode).toHaveBeenCalled();
  });

  it("speichert die jobId und räumt sie nach Abschluss wieder auf", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-xyz" });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(getStoredJobId()).toBeNull();
  });

  it("Status failed → zeigt eine Fehlermeldung", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse({ status: "failed", errorReason: "processing_timeout" });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(elements.status.textContent).toContain("error.queueFailed");
  });

  it("Status abandoned → zeigt die Abbruch-Meldung", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse({ status: "abandoned" });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(elements.status.textContent).toContain("error.queueAbandoned");
  });

  it("enqueue 429 mit blocked:limit → Rate-Limit-Meldung, kein Polling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ blocked: "limit", retryAfterSeconds: 600 }, false, 429)
    );
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(elements.status.textContent).toContain("error.rateLimit");
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/job-status"))).toBe(false);
  });

  it("resumeQueueJob ohne gespeicherte jobId ist ein No-Op", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    await resumeQueueJob();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("resumeQueueJob mit offener jobId pollt weiter und rendert das Ergebnis", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-resumed");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "done", result: DONE_RESULT }));
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/job-status?jobId=job-resumed"))).toBe(true);
    elements.disclaimerConfirm.click();
    expect(renderCurrentMode).toHaveBeenCalled();
  });
});
