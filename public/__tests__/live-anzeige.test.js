import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* i18n mocken — Schlüssel statt Texte, wie in den übrigen Frontend-Tests.
   `live.warten` ist im Original ein ARRAY (Warte-Rotation, FIX 2) und wird
   deshalb auch hier als Array geliefert. */
vi.mock("../js/i18n.js", () => ({
  t: (key) => (key === "live.warten" ? ["live.warten.0", "live.warten.1", "live.warten.2"] : key),
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
    /* Der Beast-Schalter lebt (wie alle dom.js-Referenzen) über die Tests
       hinweg — jeder Test startet seriös. */
    elements.biasSwitch.checked = false;
    /* v3.1: Die Realitäts-Check-Karte startet wie in index.html verborgen —
       nur der eigene Enthüllungs-Test macht sie sichtbar. */
    elements.realCheck.hidden = true;
    elements.realCheck.className = "";

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

  /* Kurzform: eine Welle wie aus api.js — { standard, beast }. */
  function w(standard, beast = null) {
    liveAnzeige.welle({ standard, beast });
  }

  /* Beast-Schalter umlegen und den Wechsel melden, wie app.js es tut. */
  function schalte(beast) {
    elements.biasSwitch.checked = beast;
    liveAnzeige.modusWechsel();
  }

  /* ── Tippen (Matrix-Dekodierung) ─────────────────────────────────────── */

  it("Anlauf: getippt wird erst, wenn ~200 Zeichen Puffer gesammelt sind", async () => {
    w("A".repeat(150));
    await vi.advanceTimersByTimeAsync(3000);
    /* Unter der Anlauf-Schwelle: nichts sichtbar, Karte bleibt zu. */
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveKarte.classList.contains("active")).toBe(false);

    w("A".repeat(230));
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
  });

  it("Entkopplung: eine nachgeschobene Welle verlängert den Puffer, ohne das Tippen zu unterbrechen", async () => {
    w("A".repeat(250));
    await vi.advanceTimersByTimeAsync(2000);
    const mittendrin = elements.liveTextFest.textContent.length;
    expect(mittendrin).toBeGreaterThan(0);
    expect(mittendrin).toBeLessThan(250);

    /* Nächste 2-s-Poll-Welle: gleicher Anfang, mehr Text. */
    w("A".repeat(250) + "B".repeat(150));
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.liveTextFest.textContent.length).toBe(400);
    expect(elements.liveTextFest.textContent.endsWith("B")).toBe(true);
  });

  it("Rausch-Schweif nur bei Bewegung — bei leerem Puffer bleibt nur der Cursor", async () => {
    w("A".repeat(250));
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
    w("A".repeat(80));
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    expect(elements.liveTextRausch.textContent).toBe("");

    w("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("Abbruch räumt auf: Karte samt Text verschwindet, das Tippen bleibt stehen", async () => {
    w("A".repeat(250));
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

    w("A".repeat(250));
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
    w("A".repeat(150));
    await vi.advanceTimersByTimeAsync(1000);
    /* Nur gepuffert, nie sichtbar → gilt nicht als gelaufen. */
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);

    w("A".repeat(230));
    await vi.advanceTimersByTimeAsync(200);
    expect(liveAnzeige.hatLiveGelaufen()).toBe(true);

    liveAnzeige.zuruecksetzen();
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);
  });

  /* ── Warte-Rotation nach dem fertig getippten Text (FIX 2, v3.0.1) ────── */

  it("FIX 2: die Warte-Rotation startet erst nach dem Tipp-Ende — nicht schon, wenn die Lieferung fertig ist", async () => {
    w("A".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");

    /* Nächste Poll-Welle OHNE neue Zeichen → Lieferung abgeschlossen. Getippt
       wird aber noch (~250 Zeichen / 70 pro s ≈ 3,6 s) — die Status-Zeile
       bleibt beim Schreib-Status. */
    w("A".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");

    /* Fertig getippt → jetzt rotieren die ehrlichen Warte-Zeilen. */
    await vi.advanceTimersByTimeAsync(3000);
    expect(elements.liveStatusText.textContent).toBe("live.warten.0");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.liveStatusText.textContent).toBe("live.warten.1");
    /* Der Cursor blinkt weiter: kein Rausch-Schweif, Karte bleibt aktiv. */
    expect(elements.liveTextRausch.textContent).toBe("");
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
  });

  it("FIX 2: die Rotation stoppt bei done (Enthüllung übernimmt die Status-Zeile)", async () => {
    w("A".repeat(250));
    await vi.advanceTimersByTimeAsync(500);
    w("A".repeat(250)); /* Lieferung fertig */
    await vi.advanceTimersByTimeAsync(5000); /* fertig getippt → Rotation läuft */
    expect(elements.liveStatusText.textContent).toMatch(/^live\.warten\./);

    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();
    /* Ab jetzt gehört die Status-Zeile der Enthüllung — keine Warte-Zeile
       darf sie mehr überschreiben, auch nicht nach weiteren Takten. */
    expect(elements.liveStatusText.textContent).toBe("live.statusFotoDaten");
    await vi.advanceTimersByTimeAsync(6000);
    expect(elements.liveStatusText.textContent).not.toMatch(/^live\.warten\./);
  });

  it("FIX 2: reduced-motion zeigt die rotierenden Warte-Zeilen ebenfalls — Textwechsel ist keine Bewegung", async () => {
    reduzierteBewegung();
    w("A".repeat(80));
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");

    /* Welle ohne Wachstum: Text steht sofort vollständig da (kein Tippen),
       die Lieferung ist fertig → Rotation startet unmittelbar. */
    w("A".repeat(80));
    expect(elements.liveStatusText.textContent).toBe("live.warten.0");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.liveStatusText.textContent).toBe("live.warten.1");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.liveStatusText.textContent).toBe("live.warten.2");

    /* Kommt doch noch Text nach, endet die Rotation und es gilt wieder der
       Schreib-Status. */
    w("A".repeat(80) + "B".repeat(40));
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");
  });

  /* ── Zwei Puffer: der Text folgt dem gewählten Modus (Phase 3) ────────── */

  it("Modus-Wechsel mitten im Tippen: sofort der Beast-Puffer, weitergetippt am eigenen Fortschritt", async () => {
    /* Beide Puffer gefüllt — getippt wird nur der seriöse (Schalter aus). */
    w("S".repeat(250), "B".repeat(250));
    await vi.advanceTimersByTimeAsync(2000);
    const seriousStand = elements.liveTextFest.textContent.length;
    expect(seriousStand).toBeGreaterThan(50);
    expect(elements.liveTextFest.textContent).toBe("S".repeat(seriousStand));

    /* Schalter auf Beast: die Anzeige springt SOFORT auf den Beast-Puffer —
       dessen Fortschritt beginnt bei 0, kein Rest vom seriösen Text. */
    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    const beastStand = elements.liveTextFest.textContent.length;
    expect(beastStand).toBeGreaterThan(30);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(beastStand));

    /* Zurück auf seriös: der alte Stand steht SOFORT wieder da (kein
       Neustart von vorn) und dort wird weitergetippt. */
    schalte(false);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThanOrEqual(seriousStand);
    expect(elements.liveTextFest.textContent.startsWith("S".repeat(seriousStand))).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(seriousStand);
    expect(elements.liveTextFest.textContent).toBe("S".repeat(elements.liveTextFest.textContent.length));
  });

  it("Beast gewählt, Puffer noch leer: Warte-Status statt Standard-Text — und Tippstart, sobald Beast eintrifft", async () => {
    /* Seriös tippt bereits … */
    w("S".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);

    /* … Wechsel auf Beast, obwohl das Modell Beast noch nicht schreibt:
       KEIN Standard-Text sichtbar, eigener Warte-Status, Cursor blinkt
       (Schweif leer — das Blinken selbst ist CSS). */
    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveStatusText.textContent).toBe("live.beastWartet");
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveTextRausch.textContent).toBe("");

    /* Die nächste Welle bringt die ersten Beast-Zeichen (≥ Anlauf-Puffer):
       jetzt tippt es los, der Status wechselt zurück auf „schreibt". */
    w("S".repeat(250), "B".repeat(230));
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(elements.liveTextFest.textContent.length));
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");
  });

  it("der Anlauf-Mindestpuffer gilt JE Puffer: ein kurzer Beast-Stand tippt noch nicht", async () => {
    w("S".repeat(250), "B".repeat(50));
    await vi.advanceTimersByTimeAsync(1000);
    schalte(true);
    /* Beast liegt unter der Anlauf-Schwelle → noch kein Zeichen, Cursor
       blinkt im Warte-Status. */
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.liveTextFest.textContent).toBe("");

    w("S".repeat(250), "B".repeat(210));
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(elements.liveTextFest.textContent.length));
  });

  it("reduced-motion: auch beim Modus-Wechsel sofort der volle Stand des Ziel-Puffers, kein Tippen", async () => {
    reduzierteBewegung();
    w("S".repeat(80), "B".repeat(40));
    expect(elements.liveTextFest.textContent).toBe("S".repeat(80));

    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(40));
    expect(elements.liveTextRausch.textContent).toBe("");

    schalte(false);
    expect(elements.liveTextFest.textContent).toBe("S".repeat(80));
  });

  it("reduced-motion: Beast gewählt und noch leer → Warte-Status, kein Standard-Text", async () => {
    reduzierteBewegung();
    w("S".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("S".repeat(80));

    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveStatusText.textContent).toBe("live.beastWartet");

    /* Sobald Beast eintrifft, steht er sofort vollständig da. */
    w("S".repeat(80), "B".repeat(60));
    expect(elements.liveTextFest.textContent).toBe("B".repeat(60));
    expect(elements.liveStatusText.textContent).toBe("live.statusSchreibt");
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

  it("v3.1: ein sichtbarer Realitäts-Check reiht sich zwischen Manipulation und Datenwert ein", async () => {
    baueGerendertesErgebnis();
    /* realitaets-check.js hat die Karte für dieses Ergebnis sichtbar gemacht. */
    elements.realCheck.hidden = false;
    liveAnzeige.starteEnthuellung();

    /* Synchron nach dem Start ist auch die Check-Karte verdeckt. */
    expect(sichtbar(elements.realCheck)).toBe(false);

    const warn = elements.targeting.querySelector(".target-card.warn");
    const dv = elements.dataValue.querySelector(".dv-card");
    const reihenfolge = [];
    const gesehen = new Set();
    for (let schritt = 0; schritt < 160; schritt++) {
      await vi.advanceTimersByTimeAsync(100);
      const stationen = [
        ["manipulation", sichtbar(warn)],
        ["realitaetsCheck", sichtbar(elements.realCheck)],
        ["datenwert", sichtbar(dv)],
      ];
      for (const [name, ist] of stationen) {
        if (ist && !gesehen.has(name)) {
          gesehen.add(name);
          reihenfolge.push(name);
        }
      }
    }
    expect(reihenfolge).toEqual(["manipulation", "realitaetsCheck", "datenwert"]);
  });

  it("v3.1: ohne sichtbaren Realitäts-Check (Tier/blocked) läuft die Staffel wie bisher", async () => {
    baueGerendertesErgebnis();
    /* Karte bleibt hidden (realitaets-check.js hat sie nicht freigegeben). */
    liveAnzeige.starteEnthuellung();
    await vi.advanceTimersByTimeAsync(16000);
    /* Kein lv-verdeckt-Rest an der Karte, sie bleibt schlicht verborgen. */
    expect(elements.realCheck.hidden).toBe(true);
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(false);
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
    w("A".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    liveAnzeige.starteEnthuellung();
    w("A".repeat(80) + "B".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
  });
});
