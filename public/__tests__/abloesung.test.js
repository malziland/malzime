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
  let api, state, elements, renderCurrentMode, speicher;
  let hochgeladen, abruf, abfragen, fehlerMeldungen, sicht, lauscher;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    steuerung.offen.clear();
    steuerung.sofort = null;
    hochgeladen = [];
    abfragen = []; /* Adressen der Statusabfragen */
    fehlerMeldungen = []; /* Meldungen an die Fehlererfassung */
    abruf = () => jsonResponse({ status: "done", result: ERGEBNIS() });
    sicht = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => sicht });
    /* Jeder Test lädt api.js frisch. Die Lauscher, die es an Fenster und
       Dokument hängt, werden mitgeschrieben und am Ende wieder abgenommen —
       sonst hörte das Modul eines früheren Tests im nächsten noch mit. */
    lauscher = [];
    for (const ziel of [window, document]) {
      const echt = ziel.addEventListener.bind(ziel);
      vi.spyOn(ziel, "addEventListener").mockImplementation((art, fn, opt) => {
        lauscher.push([ziel, art, fn, opt]);
        return echt(art, fn, opt);
      });
    }

    api = await import("../js/api.js");
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    renderCurrentMode = (await import("../js/render.js")).renderCurrentMode;
    speicher = await import("../js/auftrag-speicher.js");
    renderCurrentMode.mockClear();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opt) => {
      if (String(url).includes("/api/enqueue")) {
        hochgeladen.push(JSON.parse(opt.body).imageBase64);
        return jsonResponse({ jobId: "job-" + hochgeladen.length, resultToken: "tok" });
      }
      if (String(url).includes("job-status")) {
        abfragen.push(String(url));
        return abruf();
      }
      if (String(url).includes("/api/errors")) fehlerMeldungen.push(String((opt && opt.body) || ""));
      return jsonResponse({ ok: true });
    });
  });

  afterEach(() => {
    for (const [ziel, art, fn, opt] of lauscher) ziel.removeEventListener(art, fn, opt);
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

  /* ── BUG-2026-10-03-46: Die Seite wartet auf die Verbindung ──────────────
     Nach fünf gescheiterten Abfragen steht „Verbindung unterbrochen … erscheint
     automatisch" da. Der Browser meldet sich in einem wackeligen Schul-WLAN
     aber oft gar nicht als getrennt — dann kommt auch nie das Ereignis „wieder
     online". Deshalb prüft die Seite von selbst nach. */

  const AUFBEREITET = () => ({
    imageBase64: "QUFB",
    mimeType: "image/jpeg",
    dateiname: "upload.jpg",
    exif: {},
    gps: null,
    dateTimeOriginal: null,
  });
  const NETZ_WEG = () => {
    throw new TypeError("Failed to fetch");
  };

  /* Foto wählen, das Netz bleibt nach dem Einreihen weg: Die Seite gibt nach
     fünf Abfragen auf und zeigt die Zusage. */
  async function bisZurZusage() {
    steuerung.sofort = AUFBEREITET();
    api.initHintergrundWiederaufnahme();
    abruf = NETZ_WEG;
    const p = neuesFotoGewaehlt(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    await vi.advanceTimersByTimeAsync(20000);
    await p;
    expect(elements.status.textContent).toContain("error.connectionLost");
    expect(speicher.getStoredJobId()).toBe("job-1");
    expect(state.wartetAufVerbindung).toBe(true);
  }

  it("Netz kommt zurück, ohne dass der Browser „wieder online“ meldet: Das Ergebnis erscheint von selbst", async () => {
    await bisZurZusage();
    const abfragenBeiMeldung = abfragen.length;

    /* Der Server ist wieder erreichbar und hat das fertige Ergebnis. Niemand
       wechselt den Tab, niemand lädt neu, kein Ereignis „online". */
    abruf = () => jsonResponse({ status: "done", result: ERGEBNIS() });
    await vi.advanceTimersByTimeAsync(20000);

    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
    expect(elements.status.textContent).toBe("");
    expect(state.wartetAufVerbindung).toBe(false);
    /* Die erste neue Abfrage war die stille Prüfung — OHNE Abhol-Ticket, damit
       sie kein Ergebnis zustellt; abgeholt hat danach der gewohnte Weg mit Ticket. */
    const neue = abfragen.slice(abfragenBeiMeldung);
    expect(neue[0]).not.toContain("token=");
    expect(neue[1]).toContain("token=tok");
  });

  it("Netz bleibt weg: Die Seite prüft still weiter — die Zusage bleibt ruhig stehen, ohne neue Fehlermeldungen", async () => {
    await bisZurZusage();
    const abfragenBeiMeldung = abfragen.length;
    const fehlerBeiMeldung = fehlerMeldungen.length;
    const statusWechsel = [];
    const beobachter = new MutationObserver(() => statusWechsel.push(elements.status.textContent));
    beobachter.observe(elements.status, { childList: true, characterData: true, subtree: true });

    await vi.advanceTimersByTimeAsync(60000);
    beobachter.disconnect();

    /* Rund alle 12 Sekunden eine stille Prüfung, jede ohne Abhol-Ticket. */
    const neue = abfragen.slice(abfragenBeiMeldung);
    expect(neue.length).toBeGreaterThanOrEqual(4);
    expect(neue.length).toBeLessThanOrEqual(6);
    expect(neue.every((u) => !u.includes("token="))).toBe(true);
    /* Auf dem Bildschirm ändert sich nichts, und die Fehlererfassung bekommt
       für das Weiterwarten keine neuen Meldungen. */
    expect(statusWechsel).toEqual([]);
    expect(elements.status.textContent).toContain("error.connectionLost");
    expect(fehlerMeldungen.length).toBe(fehlerBeiMeldung);
    expect(speicher.getStoredJobId()).toBe("job-1");
  });

  it("Obergrenze: Nach 30 Minuten ohne Verbindung prüft die Seite nicht mehr von selbst", async () => {
    await bisZurZusage();
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    const abfragenNachObergrenze = abfragen.length;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(abfragen.length).toBe(abfragenNachObergrenze);
    /* Die Auftragsnummer bleibt: „Wieder online" und ein Neuladen holen das Ergebnis weiterhin. */
    expect(speicher.getStoredJobId()).toBe("job-1");
    abruf = () => jsonResponse({ status: "done", result: ERGEBNIS() });
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
  });

  it("Ein neues Foto beendet das Nachprüfen für den alten Auftrag", async () => {
    await bisZurZusage();
    abruf = () => jsonResponse({ status: "queued", position: 2, etaSeconds: 30 });
    const p = neuesFotoGewaehlt(new File(["b"], "b.jpg", { type: "image/jpeg" }));
    await vi.advanceTimersByTimeAsync(30000);
    /* Abgefragt wird nur noch der neue Auftrag, jede Abfrage mit Ticket. */
    const zumAlten = abfragen.filter((u) => u.includes("jobId=job-1") && !u.includes("token="));
    expect(zumAlten).toEqual([]);
    expect(abfragen.some((u) => u.includes("jobId=job-2"))).toBe(true);
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(3000);
    await p;
  });

  it("Erfolgsweg: Ohne Abriss gibt es keine stille Prüfung", async () => {
    steuerung.sofort = AUFBEREITET();
    api.initHintergrundWiederaufnahme();
    const p = neuesFotoGewaehlt(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(renderCurrentMode).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(abfragen.every((u) => u.includes("token=tok"))).toBe(true);
    expect(abfragen).toHaveLength(1);
  });

  it("Handy länger als drei Minuten weggelegt, während die Seite auf die Verbindung wartet: Die Zusage bleibt nicht stehen", async () => {
    await bisZurZusage();

    /* Handy gesperrt / App gewechselt: vier Minuten verborgen. Das Gerät gilt
       danach als weitergereicht — der Auftrag wird bewusst nicht mehr abgeholt. */
    sicht = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    abruf = () => jsonResponse({ status: "done", result: ERGEBNIS() });
    const abfragenVorher = abfragen.length;
    sicht = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(30000);

    /* Kein fremdes Profil auf dem weitergereichten Gerät … */
    expect(renderCurrentMode).not.toHaveBeenCalled();
    expect(speicher.getStoredJobId()).toBeNull();
    expect(abfragen.length).toBe(abfragenVorher);
    /* … aber auch keine Zusage mehr, die niemand einlöst: Die Meldung sagt,
       was zu tun ist, und geht an die Fehlererfassung. */
    expect(state.wartetAufVerbindung).toBe(false);
    expect(elements.status.textContent).not.toContain("error.connectionLost");
    expect(elements.status.textContent).toContain("error.queueAbandoned");
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    expect(fehlerMeldungen.some((m) => m.includes("error.queueAbandoned"))).toBe(true);
  });

  it("Wieder online ohne pausierten Live-Text: Während die Seite wieder abholt, steht keine Fehlermeldung mehr daneben", async () => {
    await bisZurZusage();

    /* Netz zurück, der Auftrag ist serverseitig noch in Arbeit. */
    abruf = () => jsonResponse({ status: "processing" });
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.status.textContent).toBe("");
    state.requestId += 1;
    await vi.advanceTimersByTimeAsync(3000);
  });
});
