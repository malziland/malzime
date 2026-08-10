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
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
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

  it("Verbindungsabbruch: Job-Nummer bleibt erhalten, damit das Ergebnis erreichbar bleibt", async () => {
    /* DER KERN DES FEHLERS (2026-08-10): Bei JEDEM Fehler wurde die Job-Nummer
       weggeworfen — auch bei einem vorübergehenden Verbindungsabbruch. Danach
       war das fertige Profil unerreichbar, obwohl es serverseitig noch rund
       zwei Stunden bereitliegt. Ein Neuladen half deshalb nicht. */
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-abbruch" });
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      throw new Error("Failed to fetch");
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(sessionStorage.getItem("malzime.queueJobId")).toBe("job-abbruch");
  });

  it("Job serverseitig weg (404): Job-Nummer wird aufgeräumt", async () => {
    /* Gegenprobe — sonst würde die Nummer ewig stehen bleiben und bei jedem
       Seitenstart einen sinnlosen Abholversuch auslösen. */
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-weg" });
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return new Response("{}", { status: 404 });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(20000);
    await p;
    expect(sessionStorage.getItem("malzime.queueJobId")).toBeNull();
  });

  it("Rückkehr aus dem Hintergrund: steckengebliebener Durchgang wird neu aufgesetzt", async () => {
    /* Sperrt man das Handy, friert der Browser die Seite ein — nicht nur die
       Netzwerkanfrage, sondern die JavaScript-Ausführung. Die Schleife kann
       danach in einem fetch feststecken, der nie zurückkommt: kein Fehler,
       kein Ergebnis, kein Spinner. Ein erster Anlauf hat nur die Fehlerzählung
       angefasst und genau diesen stillen toten Zustand erzeugt. Deshalb wird
       jetzt neu aufgesetzt statt repariert. */
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-eingefroren");
    state.isAnalyzing = true;
    state.lastPollOk = Date.now() - 60000; /* seit einer Minute nichts mehr */

    let statusAbfragen = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      statusAbfragen += 1;
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    initHintergrundWiederaufnahme();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(statusAbfragen).toBeGreaterThan(0);
  });

  it("Rückkehr bei laufendem Durchgang: kein unnötiger Neustart", async () => {
    /* Gegenprobe: Ein kurzer Tab-Wechsel darf keinen zweiten Durchgang
       auslösen — dafür gibt es den visibilitychange-Wecker in waitForNextPoll. */
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-laeuft");
    state.isAnalyzing = true;
    state.lastPollOk = Date.now(); /* gerade eben noch erfolgreich */

    let statusAbfragen = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) statusAbfragen += 1;
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    initHintergrundWiederaufnahme();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(statusAbfragen).toBe(0);
  });

  it("UX-001: laufender Upload wird von der Wiederaufnahme nicht verdrängt", async () => {
    /* Audit 2026-08-10: Nach einer fertigen Analyse bleibt die Job-Nummer
       bewusst stehen. Wählte das Kind ein zweites Foto und wechselte während
       des Uploads kurz die App, holte die Wiederaufnahme das ALTE Ergebnis und
       zeigte es neben dem NEUEN Foto — das neue Foto wurde nie hochgeladen.
       `state.uploadLaeuft` sperrt dieses Fenster. */
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-ALT");
    sessionStorage.setItem("malzime.queueResultToken", "tok-alt");
    state.isAnalyzing = true;
    state.uploadLaeuft = true; /* Upload unterwegs, noch keine neue Nummer */
    state.lastPollOk = Date.now() - 60000; /* alt genug, dass der 8-s-Wächter nicht greift */

    let alteAbfragen = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-ALT")) alteAbfragen += 1;
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    initHintergrundWiederaufnahme();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(alteAbfragen).toBe(0);
  });

  it("UX-002: nach fertiger Analyse löst ein Tab-Wechsel keine Wiederaufnahme aus", async () => {
    /* Audit 2026-08-10: `isAnalyzing` ist nach dem Rendern false, die
       Job-Nummer bleibt aber stehen. Ohne die Prüfung darauf setzte JEDER
       Tab-Wechsel das fertige Ergebnis neu — Scan-Animation, Sprung an den
       Seitenanfang, Fokus-Sprung, plus ein zusätzlicher Telemetrie-Erfolg. */
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-fertig");
    state.isAnalyzing = false; /* Analyse ist durch */
    state.uploadLaeuft = false;
    state.lastPollOk = Date.now() - 60000;

    let abfragen = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("job-status")) abfragen += 1;
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    initHintergrundWiederaufnahme();
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(abfragen).toBe(0);
  });

  it("Wiederaufnahme im laufenden Fenster: das Foto bleibt stehen", async () => {
    /* Bei der Rückkehr aus dem Hintergrund lief die Seite durchgehend — das
       Foto steht noch im Fenster. Der Datenschutz-Hinweis „Foto gelöscht" ist
       nur nach einem echten Reload richtig; ihn hier zu setzen würde dem
       Nutzer sein gerade ausgewähltes Bild wegnehmen. */
    const { resumeQueueJob } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-mit-foto");
    elements.imagePreview.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">';

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    await resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.imagePreview.querySelector("img")).not.toBeNull();
  });

  it("Wiederaufnahme nach echtem Reload: Datenschutz-Hinweis statt Foto", async () => {
    /* Gegenprobe — nach einem Reload ist das Foto tatsächlich weg (es wird
       bewusst nirgends zwischengespeichert), dann gehört der Hinweis hin. */
    const { resumeQueueJob } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-ohne-foto");
    elements.imagePreview.innerHTML = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (!String(url).includes("job-status")) return jsonResponse({ ok: true });
      return jsonResponse({ status: "done", result: DONE_RESULT });
    });

    await resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.imagePreview.querySelector(".photo-deleted-note")).not.toBeNull();
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

  it("BUG-003: haengender Antwort-Rumpf laeuft in den Timeout statt einzufrieren", async () => {
    /* Audit 2026-08-10: Der Zeitgeber lief frueher aus, sobald die Kopfzeilen
       da waren. Bricht die Verbindung danach mitten im Rumpf ab, ohne sich zu
       schliessen (Zellenwechsel im Schulgebaeude), settelte `resp.json()` nie
       und die Warteschleife fror lautlos ein — kein Fehler, kein Ergebnis.
       Jetzt deckt der Zeitgeber auch das Lesen ab. */
    const { analyzeImage } = await import("../js/api.js");
    let jsonAufgeloest = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      if (String(url).includes("/api/enqueue")) {
        return {
          ok: true,
          status: 200,
          clone() {
            return this;
          },
          /* Der Rumpf kommt nie — aber der Abbruch-Signalgeber muss ihn kippen. */
          json: () =>
            new Promise((_, reject) => {
              opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            }).finally(() => {
              jsonAufgeloest = true;
            }),
          text: () => Promise.resolve("{}"),
        };
      }
      return jsonResponse({ ok: true });
    });

    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(95000); /* ueber ENQUEUE_TIMEOUT_MS (90 s) */
    await p;

    expect(jsonAufgeloest).toBe(true);
    expect(state.isAnalyzing).toBe(false);
  });
  it("PRIV-004: nach langer Pause wird das Abhol-Ticket fallen gelassen (geteiltes Tablet)", async () => {
    /* Audit 2026-08-10: Nach einer fertigen Analyse bleiben Job-Nummer und
       Ticket bewusst stehen, damit ein Neuladen das Profil wiederholt. Im
       Klassenzimmer wird das Tablet aber weitergereicht, ohne den Tab zu
       schliessen — dann sah das nächste Kind das Profil des vorigen, ohne den
       „Nichts davon ist wahr"-Hinweis. Kurzer App-Wechsel: unverändert.
       Längere Pause: Ticket weg. */
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-vom-vorigen-kind");
    sessionStorage.setItem("malzime.queueResultToken", "tok");
    sessionStorage.setItem("malzime.queueDisclaimerAcked", "job-vom-vorigen-kind");
    initHintergrundWiederaufnahme();

    /* Seite geht in den Hintergrund ... */
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    /* ... vier Minuten vergehen ... */
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    /* ... und das Gerät wird weitergereicht. */
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sessionStorage.getItem("malzime.queueJobId")).toBeNull();
    expect(sessionStorage.getItem("malzime.queueResultToken")).toBeNull();
  });

  it("PRIV-004 Gegenprobe: kurzer App-Wechsel lässt das Ergebnis erreichbar", async () => {
    const { initHintergrundWiederaufnahme } = await import("../js/api.js");
    sessionStorage.setItem("malzime.queueJobId", "job-eigenes");
    sessionStorage.setItem("malzime.queueResultToken", "tok");
    initHintergrundWiederaufnahme();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20000); /* 20 Sekunden */
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sessionStorage.getItem("malzime.queueJobId")).toBe("job-eigenes");
  });
});
