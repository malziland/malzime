import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* i18n mocken — Schlüssel statt Texte, wie in den übrigen Frontend-Tests. */
vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

/* Klang nur als Spione — die Ton-Erzeugung selbst prüft klang.test.js. */
vi.mock("../js/klang.js", () => ({
  klangAktivieren: vi.fn(),
  tippTon: vi.fn(),
  popTon: vi.fn(),
}));

describe("Live-Anzeige (v3.0)", () => {
  let liveAnzeige, elements, ui;
  let echteMatchMedia;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers();

    liveAnzeige = await import("../js/live-anzeige.js");
    ({ elements } = await import("../js/dom.js"));
    ui = await import("../js/ui.js");

    /* Geteilte dom.js-Referenzen zwischen den Tests sauber zurücksetzen —
       laufende Schleifen stoppen, Klassen und Texte leeren. */
    liveAnzeige.zuruecksetzen();
    [
      elements.liveKarte,
      elements.scanAnim,
      elements.privacy,
      elements.gpsMap,
      elements.facts,
      elements.targeting,
      elements.dataValue,
      elements.exportPdf,
    ].forEach((el) => {
      el.className = "";
      el.innerHTML = "";
    });
    [
      elements.liveTextFest,
      elements.liveTextRausch,
      elements.liveStatusText,
      elements.liveWarten,
      elements.srAnnounce,
      elements.scanText,
    ].forEach((el) => {
      el.textContent = "";
    });

    echteMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    liveAnzeige.zuruecksetzen();
    window.matchMedia = echteMatchMedia;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function reduzierteBewegung() {
    window.matchMedia = () => ({ matches: true });
  }

  /* ── Tippen (Matrix-Dekodierung) ─────────────────────────────────────── */

  it("Anlauf: getippt wird erst, wenn ~200 Zeichen Puffer gesammelt sind", async () => {
    liveAnzeige.welle("A".repeat(150));
    await vi.advanceTimersByTimeAsync(3000);
    /* Unter der Anlauf-Schwelle: nichts sichtbar, Karte bleibt zu. */
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveKarte.classList.contains("active")).toBe(false);

    liveAnzeige.welle("A".repeat(230));
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
  });

  it("Entkopplung: eine nachgeschobene Welle verlängert den Puffer, ohne das Tippen zu unterbrechen", async () => {
    liveAnzeige.welle("A".repeat(250));
    await vi.advanceTimersByTimeAsync(2000);
    const mittendrin = elements.liveTextFest.textContent.length;
    expect(mittendrin).toBeGreaterThan(0);
    expect(mittendrin).toBeLessThan(250);

    /* Nächste 2-s-Poll-Welle: gleicher Anfang, mehr Text. */
    liveAnzeige.welle("A".repeat(250) + "B".repeat(150));
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.liveTextFest.textContent.length).toBe(400);
    expect(elements.liveTextFest.textContent.endsWith("B")).toBe(true);
  });

  it("Rausch-Schweif nur bei Bewegung — bei leerem Puffer bleibt nur der Cursor", async () => {
    liveAnzeige.welle("A".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    /* Mitten im Tippen: Schweif da, nie länger als 7 Zeichen. */
    expect(elements.liveTextRausch.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextRausch.textContent.length).toBeLessThanOrEqual(7);

    /* Puffer leer getippt (250 Zeichen / 70 pro s ≈ 3,6 s): Schweif weg. */
    await vi.advanceTimersByTimeAsync(4000);
    expect(elements.liveTextFest.textContent.length).toBe(250);
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("reduced-motion: jede Welle erscheint sofort vollständig — kein Tippen, kein Rausch", async () => {
    reduzierteBewegung();
    /* Sogar unterhalb der Anlauf-Schwelle: die Welle steht sofort komplett da. */
    liveAnzeige.welle("A".repeat(80));
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    expect(elements.liveTextRausch.textContent).toBe("");

    liveAnzeige.welle("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("Abbruch räumt auf: Karte samt Text verschwindet, das Tippen bleibt stehen", async () => {
    liveAnzeige.welle("A".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);

    liveAnzeige.abbrechen();
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveTextRausch.textContent).toBe("");
    expect(elements.liveStatusText.textContent).toBe("");

    /* Kein Wiederauferstehen durch die gestoppte Schleife. */
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.liveTextFest.textContent).toBe("");
  });

  it("die Scan-Animation verschwindet beim ersten getippten Zeichen — leise, ohne Abschluss-Ansage", async () => {
    ui.startScanAnim(false);
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.srAnnounce.textContent).toBe("scan.srStart");

    liveAnzeige.welle("A".repeat(250));
    await vi.advanceTimersByTimeAsync(100);
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    /* Das erste Zeichen ist KEIN Abschluss — die srEnd-Ansage darf hier
       nicht fallen (die kommt erst am Ende des Durchgangs). */
    expect(elements.srAnnounce.textContent).toBe("scan.srStart");
    /* Stattdessen übernimmt die Live-Karte mit Status + Dauerhinweis. */
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");
    expect(elements.liveWarten.textContent).toBe("live.nochNichtFertig");
  });

  it("hatLiveGelaufen: erst nach dem ersten sichtbaren Zeichen, zuruecksetzen löscht es", async () => {
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);
    liveAnzeige.welle("A".repeat(150));
    await vi.advanceTimersByTimeAsync(1000);
    /* Nur gepuffert, nie sichtbar → gilt nicht als gelaufen. */
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);

    liveAnzeige.welle("A".repeat(230));
    await vi.advanceTimersByTimeAsync(200);
    expect(liveAnzeige.hatLiveGelaufen()).toBe(true);

    liveAnzeige.zuruecksetzen();
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);
  });

  /* ── Gestaffelte Enthüllung ──────────────────────────────────────────── */

  function baueGerendertesErgebnis() {
    elements.privacy.innerHTML = '<div class="privacy-stack"><div class="meta-card"></div></div>';
    elements.gpsMap.innerHTML = '<div class="map-wrapper"></div>';
    elements.facts.innerHTML =
      '<div class="cat-group-head" data-grp="identity"></div>' +
      '<div class="cat-card" data-key="alter_geschlecht"></div>' +
      '<div class="cat-card" data-key="herkunft"></div>' +
      '<div class="cat-group-head" data-grp="risk"></div>' +
      '<div class="cat-card" data-key="verletzlichkeit"></div>';
    elements.targeting.innerHTML =
      '<div class="target-stack"><div class="target-card"></div><div class="target-card warn"></div></div>';
    elements.dataValue.innerHTML =
      '<div class="dv-card"><div class="dv-hero-value">0,53 €</div>' +
      '<div class="dv-bar-track"><div class="dv-bar-fill" data-bar-width="100"></div></div>' +
      '<div class="dv-bar-track"><div class="dv-bar-fill" data-bar-width="64"></div></div></div>';
    /* Nach renderCurrentMode ist der PDF-Knopf sichtbar — die Enthüllung
       muss ihn wieder verstecken, bis alles aufgedeckt ist. */
    elements.exportPdf.className = "export-btn";
  }

  const sichtbar = (el) => !!el && !el.classList.contains("lv-verdeckt");

  it("Enthüllungs-Reihenfolge: privacy vor GPS vor Kategorien vor Werbung vor Manipulation vor Datenwert vor PDF", async () => {
    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();

    /* Synchron nach dem Start: ALLES verdeckt, PDF-Knopf wieder versteckt. */
    expect(sichtbar(elements.privacy)).toBe(false);
    expect(sichtbar(elements.gpsMap)).toBe(false);
    expect(Array.from(elements.facts.children).some(sichtbar)).toBe(false);
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(true);

    const ads = elements.targeting.querySelector(".target-card:not(.warn)");
    const warn = elements.targeting.querySelector(".target-card.warn");
    const dv = elements.dataValue.querySelector(".dv-card");

    /* In 100-ms-Schritten vorspulen und festhalten, WANN was zum ersten Mal
       sichtbar wird — die Reihenfolge ist die Aussage, nicht die Millisekunde. */
    const reihenfolge = [];
    const gesehen = new Set();
    for (let schritt = 0; schritt < 160; schritt++) {
      await vi.advanceTimersByTimeAsync(100);
      const stationen = [
        ["privacy", sichtbar(elements.privacy)],
        ["gps", sichtbar(elements.gpsMap)],
        ["kategorien", Array.from(elements.facts.children).some(sichtbar)],
        ["werbung", sichtbar(ads)],
        ["manipulation", sichtbar(warn)],
        ["datenwert", sichtbar(dv)],
        ["pdf", !elements.exportPdf.classList.contains("export-btn--hidden")],
      ];
      for (const [name, ist] of stationen) {
        if (ist && !gesehen.has(name)) {
          gesehen.add(name);
          reihenfolge.push(name);
        }
      }
    }

    expect(reihenfolge).toEqual(["privacy", "gps", "kategorien", "werbung", "manipulation", "datenwert", "pdf"]);
    /* Alle Kategorien-Karten sind am Ende offen, der Betrag steht wieder auf
       dem gerenderten Endwert, die Balken auf Zielbreite. */
    expect(Array.from(elements.facts.children).every(sichtbar)).toBe(true);
    expect(elements.dataValue.querySelector(".dv-hero-value").textContent).toBe("0,53 €");
    expect(elements.dataValue.querySelector(".dv-bar-fill").style.width).toBe("100%");
    /* A11y: genau EINE Ankündigung, am Ende. */
    expect(elements.srAnnounce.textContent).toBe("live.statusFertig");
    expect(elements.liveStatusText.textContent).toBe("live.statusFertig");
  });

  it("Datenwert: der Euro-Betrag zählt von 0 hoch, bevor er auf dem Endwert landet", async () => {
    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();

    /* Bis kurz nach dem Aufdecken der Datenwert-Box vorspulen:
       700+1100+1400 (Fotodaten/GPS) + 650+280+280+650+280 (Kategorien)
       + 600+1200+1200 (Werbung/Manipulation) ≈ 8340 ms. */
    await vi.advanceTimersByTimeAsync(8500);
    const dvZahl = elements.dataValue.querySelector(".dv-hero-value");
    const zwischenstand = dvZahl.textContent;
    expect(zwischenstand).not.toBe("0,53 €");
    expect(zwischenstand).toMatch(/^\d+,\d\d €$/);

    await vi.advanceTimersByTimeAsync(2000);
    expect(dvZahl.textContent).toBe("0,53 €");
  });

  it("reduced-motion: die Enthüllung läuft ohne jede Verzögerung — alles sofort", async () => {
    reduzierteBewegung();
    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();

    /* Kein einziger Timer-Tick nötig: */
    expect(sichtbar(elements.privacy)).toBe(true);
    expect(sichtbar(elements.gpsMap)).toBe(true);
    expect(Array.from(elements.facts.children).every(sichtbar)).toBe(true);
    expect(sichtbar(elements.targeting.querySelector(".target-card.warn"))).toBe(true);
    expect(sichtbar(elements.dataValue.querySelector(".dv-card"))).toBe(true);
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(false);
    expect(elements.dataValue.querySelector(".dv-hero-value").textContent).toBe("0,53 €");
    expect(elements.dataValue.querySelector(".dv-bar-fill").style.width).toBe("100%");
    expect(elements.srAnnounce.textContent).toBe("live.statusFertig");
  });

  it("enthuellungAbkuerzen: mitten in der Enthüllung wird sofort alles sichtbar (Beast-Umschalter)", async () => {
    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();
    await vi.advanceTimersByTimeAsync(800);
    /* privacy ist offen, der Rest noch verdeckt. */
    expect(sichtbar(elements.privacy)).toBe(true);
    expect(sichtbar(elements.dataValue.querySelector(".dv-card"))).toBe(false);

    liveAnzeige.enthuellungAbkuerzen();
    expect(Array.from(elements.facts.children).every(sichtbar)).toBe(true);
    expect(sichtbar(elements.dataValue.querySelector(".dv-card"))).toBe(true);
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(false);

    /* Die abgekürzte Staffel darf später nichts mehr nachschieben. */
    await vi.advanceTimersByTimeAsync(15000);
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(false);
  });

  it("späte Wellen nach Beginn der Enthüllung ändern den Text nicht mehr", async () => {
    baueGerendertesErgebnis();
    reduzierteBewegung();
    liveAnzeige.welle("A".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    liveAnzeige.starteEnthuellung();
    liveAnzeige.welle("A".repeat(80) + "B".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
  });
});
