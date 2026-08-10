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

  it("Tab kehrt in den Vordergrund zurück → sofortiger Poll statt das 2s-Intervall abzuwarten", async () => {
    let pollCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-vis" });
      pollCount += 1;
      if (pollCount === 1) return jsonResponse({ status: "queued", position: 2, etaSeconds: 120 });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });
    const p = analyzeImage();
    /* In kleinen Schritten vorrücken, bis genau der erste Status-Poll passiert
       ist — danach stehen wir frisch (< 200 ms) im 2-Sekunden-Intervall vor
       dem zweiten Poll. */
    for (let i = 0; i < 100 && pollCount < 1; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(pollCount).toBe(1);
    /* Tab war im Hintergrund, kommt jetzt zurück. Der nächste Poll soll sofort
       feuern — bei nur 100 ms Vorlauf wäre das 2000-ms-Intervall noch lange
       nicht abgelaufen, ein zweiter Poll beweist also den visibilitychange-Wecker. */
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(100);
    expect(pollCount).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    await p;
  });

  it("Abfragen scheitern im Hintergrund → Lauf bricht NICHT ab, Ergebnis kommt nach der Rückkehr", async () => {
    /* v2.9.2 — realer Vorfall: Der Browser lag im Hintergrund, alle Abfragen
       schlugen fehl, nach fünf davon zeigte der Client "Netzwerkfehler".
       Serverseitig lief der Job ungestört weiter und war 85 s später fertig.
       Im Hintergrund friert der Browser fetch ein — das ist erwartetes
       Verhalten, kein Netzproblem, und darf den Lauf nicht beenden. */
    let pollCount = 0;
    let versteckt = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => versteckt });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-bg" });
      /* NUR die Status-Abfragen zählen — Telemetrie und Fehler-Logs laufen
         über dieselbe fetch-Attrappe und würden den Zähler verfälschen. */
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      pollCount += 1;
      /* Solange die Seite versteckt ist, schlägt jede Abfrage fehl —
         deutlich öfter als die fünf, die früher zum Abbruch geführt haben. */
      if (versteckt) throw new Error("Failed to fetch");
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(30000);
    expect(pollCount).toBeGreaterThan(5);

    /* Nutzer kehrt zurück: Ab jetzt liefert der Server das fertige Ergebnis. */
    versteckt = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3000);
    await p;

    elements.disclaimerConfirm.click();
    expect(renderCurrentMode).toHaveBeenCalled();
    delete document.hidden;
  });

  it("Abfragen scheitern im Vordergrund → nach mehreren Versuchen Fehlermeldung", async () => {
    /* Gegenprobe zur Mutationsprobe: Der Abbruch MUSS erhalten bleiben, wenn
       die Seite sichtbar ist — sonst hängt bei echtem Netzausfall die Anzeige
       stumm bis zur 30-Minuten-Grenze. */
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    let pollCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-fg" });
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      pollCount += 1;
      throw new Error("Failed to fetch");
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    const outcome = await p;
    /* Der Punkt ist, DASS er aufhört: Ohne Abbruch liefe die Schleife die
       vollen 30 Minuten weiter und hätte in 60 s rund 30 Abfragen gemacht. */
    expect(pollCount).toBeLessThan(12);
    expect(outcome).toBeUndefined();
    delete document.hidden;
  });

  it("behält die jobId nach Erfolg, damit ein Reload das Ergebnis wieder zeigt", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-xyz" });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    /* Bewusst NICHT gelöscht: das (serverseitig noch vorhandene, ticket-
       geschützte) Ergebnis soll einen Seiten-Reload überleben. */
    expect(getStoredJobId()).toBe("job-xyz");
  });

  it("Status failed → zeigt eine Fehlermeldung und räumt die jobId auf", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse({ status: "failed", errorReason: "processing_timeout" });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(elements.status.textContent).toContain("error.queueFailed");
    expect(getStoredJobId()).toBeNull();
  });

  it("Status abandoned → zeigt die Abbruch-Meldung und räumt die jobId auf", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      return jsonResponse({ status: "abandoned" });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(elements.status.textContent).toContain("error.queueAbandoned");
    expect(getStoredJobId()).toBeNull();
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

  it("resumeQueueJob schickt das gespeicherte Abhol-Ticket mit", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-tok");
    sessionStorage.setItem("malzime.queueResultToken", "ticket-abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "done", result: DONE_RESULT }));
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("token=ticket-abc"))).toBe(true);
  });

  it("resumeQueueJob: ist der Job serverseitig weg (404), still aufräumen — kein Fehler-Banner", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-gone");
    sessionStorage.setItem("malzime.queueResultToken", "ticket-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "Job not found" }, false, 404));
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(elements.status.textContent).toBe("");
    expect(getStoredJobId()).toBeNull();
  });

  it("resumeQueueJob überspringt den Hinweis-Dialog, wenn er für den Job schon bestätigt war", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-acked");
    sessionStorage.setItem("malzime.queueDisclaimerAcked", "job-acked");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "done", result: DONE_RESULT }));
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    /* Kein disclaimerConfirm.click() nötig — direkt gerendert, weil schon bestätigt. */
    expect(renderCurrentMode).toHaveBeenCalled();
  });

  it("resumeQueueJob zeigt den Foto-gelöscht-Datenschutzhinweis statt des Fotos", async () => {
    sessionStorage.setItem("malzime.queueJobId", "job-note");
    sessionStorage.setItem("malzime.queueDisclaimerAcked", "job-note");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "done", result: DONE_RESULT }));
    const p = resumeQueueJob();
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(elements.imagePreview.querySelector(".photo-deleted-note")).not.toBeNull();
  });
});
