import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* PRIV-2026-10-03-57: Wer während des Hochladens ein anderes Foto wählt,
   dessen erstes Foto soll nicht weiter hochgeladen und analysiert werden.
   - Läuft der Upload noch, wird er abgebrochen.
   - Ist der Auftrag schon angenommen, meldet der Browser ihn beim Server ab.
   Echt: js/api.js, js/state.js, js/auftrag-speicher.js. Nachgestellt: die
   Zustandszeilen von handleNewFile aus public/app.js (die Funktion ist nicht
   exportiert). Gestellt: das Netz. Den echten Eingabeweg im Browser prüft
   e2e/abfolgen.test.js. */

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

describe("Zweites Foto, während das erste hochgeladen oder eingereiht ist", () => {
  let analyzeImage, state, elements, prepareImage, speicher;
  let uploads, abfragen, abmeldungen, fehlerMeldungen;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    analyzeImage = (await import("../js/api.js")).analyzeImage;
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    prepareImage = (await import("../js/exif.js")).prepareImage;
    speicher = await import("../js/auftrag-speicher.js");
    /* Mindest-Interaktionszeit (api.js): die Uhr erst NACH dem Laden des Moduls vorstellen. */
    vi.setSystemTime(Date.now() + 60000);

    uploads = []; /* je Einreih-Aufruf: { bild, signal, antworte } */
    abfragen = []; /* Statusabfragen (GET) */
    abmeldungen = []; /* Abmeldungen (DELETE) */
    fehlerMeldungen = []; /* Meldungen an die Fehlererfassung */
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init = {}) => {
      const u = String(url);
      if (u.includes("/api/enqueue")) {
        return new Promise((antworte, scheitere) => {
          /* Wie der echte Browser: Ein abgebrochener Aufruf scheitert sofort. */
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
        return Promise.resolve(antwort({ status: "queued", position: 1, etaSeconds: 5 }));
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

  /* Die Zustandszeilen von handleNewFile aus public/app.js. */
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
    return analyzeImage();
  }

  const foto = (name) => new File([name], `${name}.jpg`, { type: "image/jpeg" });

  it("Upload läuft noch: der erste wird abgebrochen, ohne Fehlermeldung, und nur das zweite Foto wird abgefragt", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B")).mockResolvedValueOnce(AUFBEREITET("Rk9UT19C"));

    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    expect(uploads[0].signal.aborted).toBe(false);

    const laufB = wieHandleNewFile(foto("b"));
    /* Erster Upload abgebrochen, als das zweite Foto kam. */
    expect(uploads[0].signal.aborted).toBe(true);
    await laufA;
    await vi.waitFor(() => expect(uploads.length).toBe(2), { timeout: 8000 });

    /* Genau ein Einreih-Aufruf bleibt bestehen: der des zweiten Fotos. */
    expect(uploads.filter((u) => !u.signal.aborted).map((u) => u.bild)).toEqual(["Rk9UT19C"]);
    /* Der Abbruch ist kein Fehler: keine Meldung auf dem Bildschirm, keine an die Fehlererfassung. */
    expect(elements.status.textContent).toBe("");
    expect(fehlerMeldungen).toEqual([]);

    uploads[1].antworte(antwort({ jobId: "AUFTRAG-B", resultToken: "tb" }));
    await vi.advanceTimersByTimeAsync(2500);
    expect(abfragen.length).toBeGreaterThan(0);
    expect(abfragen.every((u) => u.includes("AUFTRAG-B"))).toBe(true);
    expect(speicher.getStoredJobId()).toBe("AUFTRAG-B");
    /* Durchgang B beenden, damit kein Zeitgeber über das Testende hinaus läuft. */
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufB;
  });

  it("Auftrag schon eingereiht: der Browser meldet den verworfenen Auftrag mit seinem Abhol-Ticket ab", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B")).mockResolvedValueOnce(AUFBEREITET("Rk9UT19C"));

    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(2500);
    expect(abfragen.some((u) => u.includes("AUFTRAG-A"))).toBe(true);
    expect(abmeldungen).toEqual([]); /* solange nichts verworfen ist, wird nichts abgemeldet */

    const laufB = wieHandleNewFile(foto("b"));
    await vi.waitFor(() => expect(uploads.length).toBe(2), { timeout: 8000 });
    await vi.advanceTimersByTimeAsync(2500);
    await laufA;

    expect(abmeldungen).toHaveLength(1);
    expect(abmeldungen[0]).toContain("jobId=AUFTRAG-A");
    expect(abmeldungen[0]).toContain("token=ta");

    uploads[1].antworte(antwort({ jobId: "AUFTRAG-B", resultToken: "tb" }));
    await vi.advanceTimersByTimeAsync(2500);
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufB;
    /* Auch der zweite Durchgang ist jetzt abgelöst — aber sein Auftrag ist
       weiter der gemerkte des Tabs und wird deshalb NICHT abgemeldet (so
       läuft die Wiederaufnahme desselben Auftrags). */
    expect(abmeldungen).toHaveLength(1);
  });

  it("Die Antwort trifft erst nach der Ablösung ein: der eben angenommene Auftrag wird abgemeldet", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    /* Abgelöst, ohne dass der Upload abgebrochen wurde (etwa durch einen Sprachwechsel). */
    state.requestId += 1;
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await laufA;
    expect(abmeldungen).toHaveLength(1);
    expect(abmeldungen[0]).toContain("jobId=AUFTRAG-A");
    expect(abfragen).toEqual([]);
  });

  it("Erfolgsweg: ein einzelnes Foto wird weder abgebrochen noch abgemeldet", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    /* Während des Uploads steht der Abbruch-Schalter bereit … */
    expect(state.currentAbortController).not.toBeNull();
    uploads[0].antworte(antwort({ jobId: "AUFTRAG-A", resultToken: "ta" }));
    await vi.advanceTimersByTimeAsync(2500);
    /* … und ist nach der Annahme wieder weg. */
    expect(state.currentAbortController).toBeNull();
    expect(uploads[0].signal.aborted).toBe(false);
    expect(abfragen.length).toBeGreaterThan(0);
    expect(abmeldungen).toEqual([]);
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(2500);
    await laufA;
  });

  it("Zeitüberschreitung beim Hochladen bleibt ein sichtbarer Fehler", async () => {
    prepareImage.mockResolvedValueOnce(AUFBEREITET("Rk9UT19B"));
    const laufA = wieHandleNewFile(foto("a"));
    await vi.waitFor(() => expect(uploads.length).toBe(1), { timeout: 8000 });
    await vi.advanceTimersByTimeAsync(91000);
    await laufA;
    expect(uploads[0].signal.aborted).toBe(true);
    expect(elements.status.textContent).toContain("error.networkError");
    expect(state.isAnalyzing).toBe(false);
  });
});
