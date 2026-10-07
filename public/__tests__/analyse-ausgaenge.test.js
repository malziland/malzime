/**
 * analyse-ausgaenge.test.js — jeder Ausgang eines Analyse-Durchgangs setzt die
 * Zustandsflaggen über EINE Funktion zurück (STRUCT-2026-10-03-54).
 *
 * `analyzeImageQueued` und `resumeQueueJob` in js/api.js haben zusammen über
 * zwanzig Ausgänge. Bleibt an einem davon `isAnalyzing` oder `uploadLaeuft`
 * stehen, nimmt die Seite kein Foto mehr an oder holt kein Ergebnis mehr ab —
 * ohne Fehlermeldung. Deshalb gibt es genau eine Stelle, die zurücksetzt
 * (`beendeAnalyse`), und sie wird aus jedem Ausgang gerufen.
 *
 * Geprüft wird zweimal:
 *   1. Die FLÄCHE am Quelltext: Zurückgesetzt wird nur in `beendeAnalyse`; jeder
 *      Ausgang ruft sie. Ein neuer Ausgang ohne den Aufruf fällt hier auf.
 *   2. Das VERHALTEN: Nach jedem auslösbaren Ausgang stehen die Flaggen auf
 *      „aus" — und während des Laufs auf „an" (sonst prüfte der Test nichts).
 *
 * An denselben Ausgängen hängt die Ansage für Screenreader
 * (UX-2026-10-03-49): „Analyse abgeschlossen" wird nur nach einem Ergebnis
 * angesagt. Auf jedem Fehlerweg trägt die Fehlermeldung die Ansage selbst.
 */
import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDOM } from "./setup.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const API_QUELLE = readFileSync(join(HIER, "..", "js", "api.js"), "utf8");

const steuerung = vi.hoisted(() => ({ aufbereitung: null }));

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));
vi.mock("../js/exif.js", () => ({ prepareImage: vi.fn(() => steuerung.aufbereitung()) }));
vi.mock("../js/geocoding.js", () => ({ startGeocoding: vi.fn() }));
vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

/* ── 1. Die Fläche ──────────────────────────────────────────────────────── */

/** Die Zeilen einer Funktion auf oberster Ebene, von der Kopfzeile bis zur schließenden Klammer. */
function funktion(kopf) {
  const zeilen = API_QUELLE.split("\n");
  const start = zeilen.findIndex((z) => z.includes(kopf));
  expect(start, `Funktion „${kopf}" nicht gefunden`).toBeGreaterThan(-1);
  const ende = zeilen.findIndex((z, i) => i > start && z === "}");
  return zeilen.slice(start, ende + 1);
}

function vorkommen(muster) {
  return API_QUELLE.split("\n").filter((z) => muster.test(z)).length;
}

describe("Fläche: zurückgesetzt wird an EINER Stelle", () => {
  it("`state.isAnalyzing = false` steht nur in beendeAnalyse", () => {
    expect(vorkommen(/state\.isAnalyzing\s*=\s*false/)).toBe(1);
    expect(funktion("function beendeAnalyse(").join("\n")).toMatch(/state\.isAnalyzing = false;/);
  });

  it("`state.uploadLaeuft = false` steht in beendeAnalyse und sonst nur beim Übergang „Auftragsnummer da“", () => {
    expect(funktion("function beendeAnalyse(").join("\n")).toMatch(/state\.uploadLaeuft = false;/);
    const zeilen = API_QUELLE.split("\n");
    const stellen = zeilen.map((z, i) => (/state\.uploadLaeuft\s*=\s*false/.test(z) ? i : -1)).filter((i) => i >= 0);
    expect(stellen).toHaveLength(2);
    /* Die zweite Stelle ist kein Ausgang: Der Upload ist durch, die
       Auftragsnummer gemerkt, der Durchgang fragt weiter ab. */
    const davor = zeilen.slice(Math.max(0, stellen[1] - 4), stellen[1]).join("\n");
    expect(davor).toMatch(/storeJobId\(jobId, resultToken\);/);
  });

  test.each([["async function analyzeImageQueued("], ["export async function resumeQueueJob("]])(
    "%s: jeder Ausgang ruft beendeAnalyse(myId)",
    (kopf) => {
      const zeilen = funktion(kopf);
      const beginn = zeilen.findIndex((z) => /^ {2}state\.isAnalyzing = true;/.test(z));
      expect(beginn, "Der Durchgang setzt isAnalyzing nicht").toBeGreaterThan(-1);
      const versuch = zeilen.findIndex((z) => z === "  try {");
      const schluss = zeilen.findIndex((z) => z === "  } finally {");
      expect(versuch).toBeGreaterThan(beginn);
      expect(schluss).toBeGreaterThan(versuch);

      /* Zwischen dem Setzen der Flagge und dem try: Jeder frühe Ausgang ruft
         die Funktion unmittelbar vor seinem `return`. */
      const fruehe = [];
      for (let i = beginn; i < versuch; i += 1) {
        if (/^\s+return\b/.test(zeilen[i])) fruehe.push({ zeile: zeilen[i].trim(), davor: zeilen[i - 1].trim() });
      }
      for (const ausgang of fruehe) expect(ausgang.davor).toBe("beendeAnalyse(myId);");

      /* Alles ab dem try läuft durch den finally-Block — und der ruft sie. */
      const schlussBlock = zeilen.slice(schluss).join("\n");
      expect(schlussBlock).toMatch(/beendeAnalyse\(myId\);/);
      /* Nach dem finally-Block kommt nichts mehr, was einen weiteren Ausgang öffnete. */
      const nachSchluss = zeilen.slice(schluss + 1, -1).filter((z) => /^ {2}\S/.test(z) && z !== "  }");
      expect(nachSchluss).toEqual([]);
    }
  );

  it("analyzeImageQueued hat genau die drei bekannten frühen Ausgänge", () => {
    const zeilen = funktion("async function analyzeImageQueued(");
    const versuch = zeilen.findIndex((z) => z === "  try {");
    const fruehe = zeilen.slice(0, versuch).filter((z) => /^\s+return\b/.test(z));
    expect(fruehe).toHaveLength(3);
  });
});

/* ── 2. Das Verhalten ───────────────────────────────────────────────────── */

const AUFBEREITET = () =>
  Promise.resolve({
    imageBase64: "QUFB",
    mimeType: "image/jpeg",
    dateiname: "upload.jpg",
    exif: {},
    gps: null,
    dateTimeOriginal: null,
  });

function antwort(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone() {
      return this;
    },
    json: () => Promise.resolve(body),
  };
}

const ERGEBNIS = () => ({
  profiles: { normal: { categories: { a: {} }, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
});

describe("Verhalten: Nach jedem Ausgang stehen die Flaggen auf „aus“", () => {
  let api, state, elements, speicher, renderCurrentMode;
  let einreihen, abruf, waehrendUpload;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    steuerung.aufbereitung = AUFBEREITET;
    api = await import("../js/api.js");
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    speicher = await import("../js/auftrag-speicher.js");
    renderCurrentMode = (await import("../js/render.js")).renderCurrentMode;
    renderCurrentMode.mockClear();
    /* Mindest-Interaktionszeit (api.js): die Uhr erst NACH dem Laden des Moduls vorstellen. */
    vi.setSystemTime(Date.now() + 60000);

    einreihen = () => antwort({ jobId: "job-1", resultToken: "tok" });
    abruf = () => antwort({ status: "done", result: ERGEBNIS() });
    waehrendUpload = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/enqueue")) {
        waehrendUpload = { isAnalyzing: state.isAnalyzing, uploadLaeuft: state.uploadLaeuft };
        return einreihen();
      }
      if (u.includes("/api/job-status")) return abruf();
      return antwort({});
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const foto = (groesse = 1) => {
    const datei = new File(["a"], "a.jpg", { type: "image/jpeg" });
    if (groesse > 1) Object.defineProperty(datei, "size", { value: groesse });
    return datei;
  };

  async function analysiere(datei, dauerMs = 8000) {
    state.lastFile = datei;
    state.lastPrepared = null;
    const lauf = api.analyzeImage();
    await vi.advanceTimersByTimeAsync(dauerMs);
    await lauf;
  }

  /* `fehlerweg`: Der Ausgang ist ein Fehler — dann darf im Ansage-Bereich
     nicht „Analyse abgeschlossen" stehen (der Text-Schlüssel ist `scan.srEnd`). */
  function flaggenAus({ fehlerweg = true } = {}) {
    expect({ isAnalyzing: state.isAnalyzing, uploadLaeuft: state.uploadLaeuft }).toEqual({
      isAnalyzing: false,
      uploadLaeuft: false,
    });
    if (fehlerweg) expect(elements.srAnnounce.textContent).not.toBe("scan.srEnd");
    else expect(elements.srAnnounce.textContent).toBe("scan.srEnd");
  }

  it("Erfolg — und während des Uploads stehen beide Flaggen auf „an“", async () => {
    await analysiere(foto());
    expect(waehrendUpload).toEqual({ isAnalyzing: true, uploadLaeuft: true });
    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
    flaggenAus({ fehlerweg: false });
    expect(state.wartetAufVerbindung).toBe(false);
  });

  it("keine Datei gewählt", async () => {
    /* Das Test-Dokument kennt die Dateiliste des Eingabefelds nicht — hier ist sie leer. */
    Object.defineProperty(elements.fileInput, "files", { configurable: true, value: [] });
    await analysiere(null, 100);
    expect(elements.status.textContent).toContain("error.noFile");
    flaggenAus();
  });

  it("Datei zu groß", async () => {
    await analysiere(foto(26 * 1024 * 1024), 100);
    expect(elements.status.textContent).toContain("error.fileTooLarge");
    flaggenAus();
  });

  it("unsichtbares Feld ausgefüllt (Automat)", async () => {
    /* Das Feld steht in index.html; im Test-Dokument wird es nachgebaut. */
    const feld = document.createElement("input");
    feld.id = "website";
    feld.value = "x";
    document.body.appendChild(feld);
    await analysiere(foto(), 100);
    expect(waehrendUpload).toBeNull();
    flaggenAus();
  });

  it("Foto lässt sich nicht aufbereiten", async () => {
    steuerung.aufbereitung = () => Promise.reject(new Error("image_decode_failed"));
    await analysiere(foto());
    expect(elements.status.textContent).toContain("error.decodeFailed");
    flaggenAus();
  });

  test.each([
    ["Stundenlimit", 429, { blocked: "limit", retryAfterSeconds: 600 }],
    ["Warteschlange voll", 429, { blocked: "queueFull" }],
    ["Betriebseinstellungen fehlen", 503, { blocked: "configMissing" }],
    ["Bild zu groß", 413, {}],
    ["Format nicht lesbar", 400, {}],
    ["Serverfehler", 500, {}],
  ])("Einreihen abgelehnt: %s", async (_name, status, body) => {
    einreihen = () => antwort(body, status);
    await analysiere(foto());
    expect(waehrendUpload).toEqual({ isAnalyzing: true, uploadLaeuft: true });
    flaggenAus();
  });

  it("Wartungsfenster beim Einreihen", async () => {
    einreihen = () => antwort({ maintenance: true, message: "Wartung" }, 503);
    await analysiere(foto());
    expect(elements.maintenanceModal.classList.contains("active")).toBe(true);
    flaggenAus();
  });

  it("Einreihen ohne Auftragsnummer", async () => {
    einreihen = () => antwort({});
    await analysiere(foto());
    expect(elements.status.textContent).toContain("error.queueFailed");
    flaggenAus();
  });

  it("Netzfehler beim Einreihen", async () => {
    einreihen = () => {
      throw new TypeError("Failed to fetch");
    };
    await analysiere(foto());
    expect(elements.status.textContent).toContain("error.networkError");
    flaggenAus();
  });

  test.each([
    ["Auftrag verworfen", { status: "abandoned" }, "error.queueAbandoned"],
    ["Analyse gescheitert", { status: "failed", errorReason: "mistral_error" }, "error.queueFailed"],
    ["fertig ohne Ergebnis", { status: "done", result: null, tokenRequired: true }, "error.queueFailed"],
  ])("Abfrage endet mit: %s", async (_name, body, text) => {
    abruf = () => antwort(body);
    await analysiere(foto());
    expect(elements.status.textContent).toContain(text);
    flaggenAus();
  });

  it("Verbindungsabriss beim Abfragen: Flaggen aus, nur der Verbindungs-Anker bleibt", async () => {
    abruf = () => {
      throw new TypeError("Failed to fetch");
    };
    await analysiere(foto(), 20000);
    expect(elements.status.textContent).toContain("error.connectionLost");
    flaggenAus();
    expect(state.wartetAufVerbindung).toBe(true);
  });

  it("Wiederaufnahme: Erfolg, Auftrag weg und erneuter Abriss", async () => {
    speicher.storeJobId("job-1", "tok");
    let lauf = api.resumeQueueJob();
    expect(state.isAnalyzing).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    await lauf;
    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
    flaggenAus({ fehlerweg: false });

    elements.srAnnounce.textContent = "";
    abruf = () => antwort({ error: "Job not found" }, 404);
    lauf = api.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(3000);
    await lauf;
    expect(speicher.getStoredJobId()).toBeNull();
    flaggenAus();

    speicher.storeJobId("job-2", "tok");
    abruf = () => {
      throw new TypeError("Failed to fetch");
    };
    lauf = api.resumeQueueJob({ force: true });
    await vi.advanceTimersByTimeAsync(20000);
    await lauf;
    flaggenAus();
    expect(state.wartetAufVerbindung).toBe(true);
  });

  it("Ein überholter Durchgang fasst die Flaggen des jüngeren nicht an", async () => {
    let antworte;
    einreihen = () => new Promise((weiter) => (antworte = weiter));
    state.lastFile = foto();
    const lauf = api.analyzeImage();
    await vi.advanceTimersByTimeAsync(3000);
    expect(waehrendUpload).toEqual({ isAnalyzing: true, uploadLaeuft: true });
    /* Ein jüngerer Durchgang hat übernommen und läuft noch. */
    state.requestId += 1;
    antworte(antwort({}, 500));
    await vi.advanceTimersByTimeAsync(3000);
    await lauf;
    expect(state.isAnalyzing).toBe(true);
    expect(state.uploadLaeuft).toBe(true);
  });
});
