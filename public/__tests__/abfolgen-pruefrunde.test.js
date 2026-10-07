import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/**
 * abfolgen-pruefrunde.test.js — vier Abfolgen aus der Prüfrunde vom 07.10.2026.
 *
 * Jede stellt einen Ablauf am Handy nach, bei dem die Seite etwas schuldig
 * blieb (alle vier waren am Stand vor der Behebung rot):
 *   1. Auftrag wartet, App kurz gewechselt (die Wiederaufnahme übernimmt),
 *      dann ein anderes Foto — der erste Auftrag muss abgemeldet werden.
 *   2. Anderes Foto genau zwischen Kopf und Rumpf der Einreih-Antwort — der
 *      alte Auftrag darf nicht als „der des Tabs" gemerkt werden.
 *   3. Verbindung reißt ab, der Auftrag scheitert derweil — nach „erscheint
 *      automatisch" braucht es eine Antwort, keine leere Zeile.
 *   4. Laufende Analyse, dann eine zu große Datei — der Bildschirm-Wachhalter
 *      muss wieder frei sein.
 * Dazu der Erfolgsweg: Nach einem fertigen Ergebnis meldet ein neues Foto
 * nichts ab (es gibt nichts abzumelden).
 */

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));
vi.mock("../js/exif.js", () => ({ prepareImage: vi.fn() }));
vi.mock("../js/geocoding.js", () => ({ startGeocoding: vi.fn() }));
vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

const AUFBEREITET = (bild) => ({ imageBase64: bild, exif: {}, gps: null, mimeType: "image/jpeg" });
const antwort = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  clone() {
    return this;
  },
});

describe("Abfolgen aus der Prüfrunde", () => {
  let api, state, elements, prepareImage, speicher;
  let uploads, abfragen, abmeldungen, fehlerMeldungen, statusAntwort;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    api = await import("../js/api.js");
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    prepareImage = (await import("../js/exif.js")).prepareImage;
    speicher = await import("../js/auftrag-speicher.js");
    vi.setSystemTime(Date.now() + 60000);

    uploads = [];
    abfragen = [];
    abmeldungen = [];
    fehlerMeldungen = [];
    statusAntwort = () => Promise.resolve(antwort({ status: "queued", position: 3, etaSeconds: 60 }));
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init = {}) => {
      const u = String(url);
      if (u.includes("/api/enqueue")) {
        return new Promise((antworte, scheitere) => {
          if (init.signal) {
            init.signal.addEventListener("abort", () =>
              scheitere(new DOMException("The operation was aborted.", "AbortError"))
            );
          }
          uploads.push({ bild: JSON.parse(init.body).imageBase64, signal: init.signal, antworte });
        });
      }
      if (u.includes("/api/job-status")) {
        if (init.method === "DELETE") {
          abmeldungen.push(u);
          return Promise.resolve(antwort({ verworfen: true }));
        }
        abfragen.push(u);
        return statusAntwort(u);
      }
      if (u.includes("/api/errors")) fehlerMeldungen.push(String(init.body || ""));
      return Promise.resolve(antwort({}));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function wieHandleNewFile(file) {
    state.auswahlNr += 1;
    if (state.currentAbortController) {
      state.currentAbortController.abort();
      state.currentAbortController = null;
    }
    state.isAnalyzing = false;
    state.lastFile = file;
    state.auswahlZeit = Date.now();
    state.lastPrepared = null;
    state.lastData = null;
    return api.analyzeImage();
  }
  const foto = (name) => new File([name], `${name}.jpg`, { type: "image/jpeg" });

  it("Auftrag wartet, die Wiederaufnahme übernimmt ihn, dann ein anderes Foto: der erste Auftrag wird abgemeldet", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B")).mockResolvedValueOnce(AUFBEREITET("Rk9UT19C"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(2500);
    expect(speicher.getStoredJobId()).toBe("AUFTRAG-A");

    /* Tab war kurz weg: die Hintergrund-Wiederaufnahme übernimmt denselben Auftrag. */
    const wieder = api.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(2500);
    await laufA;
    expect(abmeldungen).toEqual([]); /* richtig: derselbe Auftrag, nichts abmelden */

    /* Jetzt wählt das Kind ein anderes Foto. */
    const laufB = wieHandleNewFile(foto("b"));
    await vi.waitFor(() => expect(uploads.length).toBe(2), { timeout: 8000 });
    uploads[1].antworte(antwort({ jobId: "AUFTRAG-B", resultToken: "tb" }));
    await vi.advanceTimersByTimeAsync(5000);
    await wieder;
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufB;
    expect(abmeldungen.some((u) => u.includes("AUFTRAG-A"))).toBe(true);
  });

  it("anderes Foto zwischen Kopf und Rumpf der Einreih-Antwort: der alte Auftrag wird nicht gemerkt, sondern abgemeldet", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B")).mockResolvedValueOnce(AUFBEREITET("Rk9UT19C"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    let rumpfA;
    const kopfA = {
      ok: true,
      status: 200,
      json: () => new Promise((r) => (rumpfA = r)),
      clone() {
        return this;
      },
    };
    uploads[0].antworte(kopfA);
    await vi.waitFor(() => expect(typeof rumpfA).toBe("function"), { timeout: 8000 });
    /* Kopf ist da, Rumpf noch nicht: jetzt das andere Foto. */
    const laufB = wieHandleNewFile(foto("b"));
    await vi.waitFor(() => expect(uploads.length).toBe(2), { timeout: 8000 });
    rumpfA({ jobId: "AUFTRAG-A", resultToken: "ta" });
    await vi.advanceTimersByTimeAsync(100);
    await laufA;
    const gemerkt = speicher.getStoredJobId();
    uploads[1].antworte(antwort({ jobId: "AUFTRAG-B", resultToken: "tb" }));
    await vi.advanceTimersByTimeAsync(2500);
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufB;
    expect(gemerkt).not.toBe("AUFTRAG-A");
    expect(abmeldungen.some((u) => u.includes("AUFTRAG-A"))).toBe(true);
  });

  it("Verbindung reißt ab, der Auftrag scheitert derweil: danach steht eine Meldung da, und die Fehlererfassung bekommt sie", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(2500);
    /* Abriss: fünf Abfragen scheitern. */
    statusAntwort = () => Promise.reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(12000);
    await laufA;
    expect(elements.status.textContent).toContain("error.connectionLost");
    /* Netz ist zurück; der Auftrag ist inzwischen gescheitert. */
    statusAntwort = () => Promise.resolve(antwort({ status: "failed", errorReason: "blocked.apiError" }));
    await vi.advanceTimersByTimeAsync(15000);
    expect(elements.status.textContent).toContain("error.queueFailed");
    expect(speicher.getStoredJobId()).toBeNull();
    expect(state.wartetAufVerbindung).toBe(false);
    expect(fehlerMeldungen.map((m) => JSON.parse(m).phase)).toContain("resume-nach-abriss");
  });

  it("laufende Analyse, dann eine zu große Datei: der Bildschirm-Wachhalter ist wieder frei", async () => {
    const freigabe = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: vi.fn(async () => ({ release: freigabe })) },
    });
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B"));
    await api.acquireWakeLock(); /* wie app.js: im Klick */
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(2500);
    const gross = foto("gross");
    Object.defineProperty(gross, "size", { value: 26 * 1024 * 1024 });
    await api.acquireWakeLock();
    const laufB = wieHandleNewFile(gross);
    await laufB;
    await vi.advanceTimersByTimeAsync(5000);
    await laufA;
    expect(elements.status.textContent).toContain("error.fileTooLarge");
    expect(freigabe).toHaveBeenCalled();
  });

  it("nach einem fertigen Ergebnis meldet ein neues Foto nichts ab (Erfolgsweg)", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B")).mockResolvedValueOnce(AUFBEREITET("Rk9UT19C"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    statusAntwort = () =>
      Promise.resolve(
        antwort({ status: "done", result: { profiles: { normal: { categories: {} }, boost: { categories: {} } } } })
      );
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(3000);
    await laufA;
    /* Das Ergebnis ist angekommen; die Nummer bleibt für ein Neuladen gemerkt. */
    expect(speicher.getStoredJobId()).toBe("AUFTRAG-A");
    expect(speicher.offenerAuftrag()).toBeNull();

    statusAntwort = () => Promise.resolve(antwort({ status: "queued", position: 1, etaSeconds: 30 }));
    const laufB = wieHandleNewFile(foto("b"));
    await vi.waitFor(() => expect(uploads.length).toBe(2), { timeout: 8000 });
    expect(abmeldungen).toEqual([]);
    uploads[1].antworte(antwort({ jobId: "AUFTRAG-B", resultToken: "tb" }));
    await vi.advanceTimersByTimeAsync(2500);
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufB;
    expect(abmeldungen).toEqual([]);
  });
});
