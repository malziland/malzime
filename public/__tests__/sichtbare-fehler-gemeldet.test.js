/**
 * sichtbare-fehler-gemeldet.test.js — jede Fehlermeldung, die ein Kind sieht,
 * erreicht auch die Fehlererfassung.
 *
 * ANLASS (Logauswertung 16.09.2026): Christoph stand im Workshop neben einem
 * Kind, dessen Samsung-Handy bei jedem Versuch eine Fehlermeldung zeigte. Die
 * Auswertung konnte nur die Faelle zaehlen, die gemeldet wurden — und sechs
 * sichtbare Meldungen (Datei fehlt, Datei zu gross, Ergebnis leer, Einreihen
 * ohne Auftragsnummer, Auftrag verworfen, Wiederaufnahme ohne Verbindung)
 * gingen nie an den Server. Dazu kam die stille Rueckkehr bei leerer Auswahl.
 *
 * Geprueft wird zweimal:
 *   1. Die FLAECHE: Jede `setStatus(...)`-Stelle mit Text in api.js, app.js
 *      und demo.js hat vor dem naechsten `return` eine Meldung. Neue Stellen
 *      fallen automatisch darunter.
 *   2. Das VERHALTEN an vier Wegen, die sich im Test ausloesen lassen: Die
 *      Meldung geht wirklich raus, mit der erwarteten Phase.
 */
import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDOM } from "./setup.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HIER, "..");

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

vi.mock("../js/exif.js", () => ({
  prepareImage: vi.fn().mockResolvedValue({ imageBase64: "QUFB", exif: {}, gps: null, dateTimeOriginal: null }),
}));

vi.mock("../js/geocoding.js", () => ({ startGeocoding: vi.fn() }));

vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

/* ── 1. Die Flaeche ─────────────────────────────────────────────────────── */

const MELDUNG = /\b(logClientError|meldeSichtbarenFehler)\s*\(/;
const REICHWEITE_ZEILEN = 40;

/** Liefert je `setStatus(`-Stelle mit Text: Zeilennummer und ob davor-vor-return gemeldet wird. */
function stellen(datei) {
  const zeilen = readFileSync(join(PUBLIC, datei), "utf8").split("\n");
  const ergebnis = [];
  zeilen.forEach((zeile, i) => {
    const m = zeile.match(/\bsetStatus\(\s*([^)]*)/);
    if (!m || /function\s+setStatus/.test(zeile)) return;
    /* setStatus("") raeumt nur auf — das ist keine Fehlermeldung. */
    if (/^\s*""/.test(m[1])) return;
    let gemeldet = false;
    for (let j = i; j < Math.min(zeilen.length, i + REICHWEITE_ZEILEN); j++) {
      if (MELDUNG.test(zeilen[j])) {
        gemeldet = true;
        break;
      }
      if (j > i && /^\s*return\b/.test(zeilen[j])) break;
    }
    ergebnis.push({ datei, zeile: i + 1, text: zeile.trim(), gemeldet });
  });
  return ergebnis;
}

describe("Flaeche: jede sichtbare Fehlermeldung wird gemeldet", () => {
  const alle = ["js/api.js", "app.js", "js/demo.js"].flatMap(stellen);

  /* Messmittel-Probe: Findet der Leser ueberhaupt Stellen? Ohne sie liefe die
     Pruefung unten ueber eine leere Liste und waere immer gruen. */
  test("der Leser findet die bekannten Fehlermeldungen (Messmittel-Probe)", () => {
    expect(alle.length).toBeGreaterThanOrEqual(15);
    expect(alle.some((s) => s.text.includes("error.noFile"))).toBe(true);
    expect(alle.some((s) => s.text.includes("error.readFailed"))).toBe(true);
  });

  test("keine Fehlermeldung ohne Meldung vor dem naechsten return", () => {
    const ungemeldet = alle.filter((s) => !s.gemeldet).map((s) => `${s.datei}:${s.zeile} ${s.text}`);
    expect(ungemeldet).toEqual([]);
  });

  test("leere Dateiauswahl kehrt nicht mehr still zurueck", () => {
    const app = readFileSync(join(PUBLIC, "app.js"), "utf8");
    const handler = app.slice(app.indexOf('elements.fileInput.addEventListener("change"'));
    const bisZumReturn = handler.slice(0, handler.indexOf("return;"));
    expect(bisZumReturn).toMatch(/logClientError\(/);
    expect(bisZumReturn).toMatch(/auswahl-leer/);
  });
});

/* ── 2. Das Verhalten ───────────────────────────────────────────────────── */

describe("Verhalten: die Meldung geht wirklich raus", () => {
  let analyzeImage, state, elements;
  let meldungen;

  /* fetch-Attrappe: sammelt jede Fehlermeldung, beantwortet den Rest je Adresse. */
  function netz(antworten = {}) {
    meldungen = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, optionen = {}) => {
      const u = String(url);
      if (u.includes("/api/errors")) {
        meldungen.push(JSON.parse(optionen.body));
        return { ok: true, status: 204 };
      }
      if (u.includes("/api/enqueue") && antworten.enqueue) return antworten.enqueue();
      if (u.includes("job-status") && antworten.status) return antworten.status();
      return { ok: true, status: 200, json: async () => ({}) };
    });
  }

  const phasen = () => meldungen.map((m) => m.phase);

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10000);
    analyzeImage = (await import("../js/api.js")).analyzeImage;
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    state.isAnalyzing = false;
    state.requestId = 0;
    state.lastPrepared = null;
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Datei fehlt: Phase datei-fehlt", async () => {
    netz();
    state.lastFile = null;
    Object.defineProperty(elements.fileInput, "files", { value: [], configurable: true });
    await analyzeImage();
    await vi.advanceTimersByTimeAsync(0);
    expect(elements.status.textContent).toBe("error.noFile");
    expect(phasen()).toEqual(["datei-fehlt"]);
    expect(meldungen[0].errorMessage).toBe("error.noFile");
  });

  it("Datei zu gross: Phase datei-zu-gross mit Groesse in KB", async () => {
    netz();
    state.lastFile = new File([new ArrayBuffer(30 * 1024 * 1024)], "gross.jpg", { type: "image/jpeg" });
    await analyzeImage();
    await vi.advanceTimersByTimeAsync(0);
    expect(elements.status.textContent).toBe("error.fileTooLarge");
    expect(phasen()).toEqual(["datei-zu-gross"]);
    expect(meldungen[0].fileSizeKb).toBe(30720);
  });

  it("Einreihen ohne Auftragsnummer: Phase einreihen-ohne-auftrag mit Status", async () => {
    netz({ enqueue: () => ({ ok: true, status: 200, json: async () => ({}) }) });
    await analyzeImage();
    await vi.advanceTimersByTimeAsync(0);
    expect(elements.status.textContent).toContain("error.queueFailed");
    expect(phasen()).toEqual(["einreihen-ohne-auftrag"]);
    expect(meldungen[0].httpStatus).toBe(200);
  });

  it("Auftrag verworfen: Phase auftrag-verworfen", async () => {
    netz({
      enqueue: () => ({ ok: true, status: 200, json: async () => ({ jobId: "j-1", resultToken: "t" }) }),
      status: () => ({ ok: true, status: 200, json: async () => ({ status: "abandoned" }) }),
    });
    const lauf = analyzeImage();
    await vi.advanceTimersByTimeAsync(5000);
    await lauf;
    expect(elements.status.textContent).toContain("error.queueAbandoned");
    expect(phasen()).toEqual(["auftrag-verworfen"]);
  });
});
