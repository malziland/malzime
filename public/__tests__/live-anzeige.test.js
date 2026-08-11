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

    /* Zeit-Anlauf für die Tests abschalten — nur der eigene Anlauf-Test
       stellt ihn gezielt wieder an. */
    liveAnzeige._setzeTippAnlaufMsFuerTest(0);

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

  it("Zeit-Anlauf (Nachschliff 11.08.): erst trägt die Scan-Animation, dann tippt es — kein Kriech-Start", async () => {
    liveAnzeige._setzeTippAnlaufMsFuerTest(10000);
    /* Vor der ersten Welle: nichts sichtbar. */
    expect(elements.liveKarte.classList.contains("active")).toBe(false);

    /* Erste Welle: Der Puffer sammelt Material, die Karte bleibt zu — die
       Scan-Animation trägt die Wartezeit. (Diese Erwartung wird ROT, wenn
       jemand den Sofort-Start zurückbaut.) */
    w("Hallo, hier entsteht gerade ein Profiltext.");
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent.length).toBe(0);

    /* Nach Ablauf des Anlaufs übernimmt die Karte und tippt sofort los. */
    await vi.advanceTimersByTimeAsync(5300);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
  });

  it("v3.0.2: der Standard-Anlauf beträgt 25 s — bei 24 s tippt noch nichts, kurz danach schon", async () => {
    /* Frischer Modul-Import, damit wirklich der STANDARDWERT geprüft wird —
       der beforeEach oben stellt den Anlauf für alle übrigen Tests auf 0. */
    vi.resetModules();
    const frisch = await import("../js/live-anzeige.js");
    const { elements: el } = await import("../js/dom.js");
    frisch.welle({ standard: "A".repeat(2000), beast: null });
    await vi.advanceTimersByTimeAsync(24000);
    expect(el.liveKarte.classList.contains("active")).toBe(false);
    expect(el.liveTextFest.textContent.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(el.liveKarte.classList.contains("active")).toBe(true);
    expect(el.liveTextFest.textContent.length).toBeGreaterThan(0);
    frisch.zuruecksetzen();
  });

  it("Adaptives Tempo: viel Puffer tippt am Deckel (~90 Z/s) — deutlich schneller als das alte Festtempo", async () => {
    /* Riesiger Rest → das Tempo läuft an den Deckel MAX_ZEICHEN_PRO_SEKUNDE.
       Diese Probe wird ROT, wenn jemand das feste 70-Z/s-Tempo zurückbaut. */
    w("A".repeat(6000));
    await vi.advanceTimersByTimeAsync(1000);
    const getippt = elements.liveTextFest.textContent.length;
    expect(getippt).toBeGreaterThanOrEqual(80);
    expect(getippt).toBeLessThanOrEqual(100);
  });

  it("Adaptives Tempo: wenig Puffer tippt am Boden (~20 Z/s) — flott, aber mitlesbar", async () => {
    /* Kleiner Rest → Untergrenze MIN_ZEICHEN_PRO_SEKUNDE. Mit festem Tempo
       (70 Z/s) wäre der Puffer hier nach unter einer halben Sekunde leer. */
    w("A".repeat(30));
    await vi.advanceTimersByTimeAsync(1000);
    const getippt = elements.liveTextFest.textContent.length;
    expect(getippt).toBeGreaterThanOrEqual(17);
    expect(getippt).toBeLessThanOrEqual(24);
  });

  it("Entkopplung: eine nachgeschobene Welle verlängert den Puffer, ohne das Tippen zu unterbrechen", async () => {
    w("A".repeat(600));
    await vi.advanceTimersByTimeAsync(2000);
    const mittendrin = elements.liveTextFest.textContent.length;
    expect(mittendrin).toBeGreaterThan(0);
    expect(mittendrin).toBeLessThan(600);

    /* Nächste 2-s-Poll-Welle: gleicher Anfang, mehr Text — es wird nahtlos
       am eigenen Stand weitergetippt, kein Neustart. */
    w("A".repeat(600) + "B".repeat(300));
    await vi.advanceTimersByTimeAsync(2000);
    const danach = elements.liveTextFest.textContent.length;
    expect(danach).toBeGreaterThan(mittendrin);
    expect(elements.liveTextFest.textContent).toBe("A".repeat(danach));

    /* Die Fertig-Meldung tippt den Rest im Schnellvorlauf zu Ende —
       inklusive der nachgeschobenen B-Zeichen. */
    const vorlauf = liveAnzeige.schnellVorlauf();
    await vi.advanceTimersByTimeAsync(8000);
    await vorlauf;
    expect(elements.liveTextFest.textContent.length).toBe(900);
    expect(elements.liveTextFest.textContent.endsWith("B")).toBe(true);
  });

  it("Schnellvorlauf: nach der Fertig-Meldung tippt der Rest mit ~150 Z/s aus, erst dann löst das Versprechen auf", async () => {
    w("A".repeat(600)); /* adaptiv: 600/30 = 20 Z/s */
    await vi.advanceTimersByTimeAsync(1000);
    const vorher = elements.liveTextFest.textContent.length;
    expect(vorher).toBeLessThan(100);

    let aufgeloest = false;
    const vorlauf = liveAnzeige.schnellVorlauf().then(() => {
      aufgeloest = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    /* ~150 weitere Zeichen in einer Sekunde — klar über dem Normal-Deckel
       von 90 Z/s. Diese Probe wird ROT, wenn der Schnellvorlauf fehlt. */
    expect(elements.liveTextFest.textContent.length - vorher).toBeGreaterThan(100);
    expect(aufgeloest).toBe(false);

    await vi.advanceTimersByTimeAsync(4000);
    await vorlauf;
    expect(aufgeloest).toBe(true);
    expect(elements.liveTextFest.textContent.length).toBe(600);
  });

  it("Rausch-Schweif nur bei Bewegung — bei leerem Puffer bleibt nur der Cursor", async () => {
    w("A".repeat(300));
    await vi.advanceTimersByTimeAsync(1000);
    /* Mitten im Tippen: Schweif da, nie länger als 7 Zeichen. */
    expect(elements.liveTextRausch.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextRausch.textContent.length).toBeLessThanOrEqual(7);

    /* Puffer per Schnellvorlauf leeren (300 Zeichen / 150 pro s = 2 s):
       Schweif weg, nur der Cursor blinkt. */
    const vorlauf = liveAnzeige.schnellVorlauf();
    await vi.advanceTimersByTimeAsync(3000);
    await vorlauf;
    expect(elements.liveTextFest.textContent.length).toBe(300);
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("reduced-motion: jede Welle erscheint sofort vollständig — kein Tippen, kein Rausch", async () => {
    reduzierteBewegung();
    /* Auch eine kurze erste Welle steht sofort komplett da. */
    w("A".repeat(80));
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    expect(elements.liveTextRausch.textContent).toBe("");

    w("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("Abbruch räumt auf: Karte samt Text verschwindet, das Tippen bleibt stehen", async () => {
    w("A".repeat(300));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);

    liveAnzeige.abbrechen();
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveTextRausch.textContent).toBe("");
    /* Auch ein eventuell aktives Warte-Auge ist mit aufgeräumt. */
    expect(elements.scanAnim.classList.contains("active")).toBe(false);

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
    /* Beim Wechsel steht bereits Text in der Karte — nie ein leer blinkender
       Cursor (v3.0.0, Befund des ersten Live-Tests). */
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
    /* Das erste Zeichen ist KEIN Abschluss — die srEnd-Ansage darf hier
       nicht fallen (die kommt erst am Ende des Durchgangs). */
    expect(elements.srAnnounce.textContent).toBe("scan.srStart");
    /* Stattdessen übernimmt die Live-Karte mit dem Dauerhinweis. */
    expect(elements.liveWarten.textContent).toBe("live.nochNichtFertig");
  });

  it("Spinner bleibt bis zum ersten Zeichen: Beast gewählt, aber noch ohne Beast-Text → Karte bleibt zu", async () => {
    /* Der einzige Fall, in dem trotz gelieferter Wellen noch nichts tippbar
       ist: Beast ist aktiv, das Modell schreibt aber erst den Standard-Teil.
       Dann bleibt die Scan-Animation — eine Karte, in der nur der Cursor
       blinkt, darf es nicht mehr geben (v3.0.0). */
    ui.startScanAnim(false);
    elements.biasSwitch.checked = true;
    w("S".repeat(300));
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent).toBe("");

    /* Sobald das erste Beast-Zeichen tippbar ist, übernimmt die Karte —
       mit Text, im selben Moment verschwindet der Spinner. */
    w("S".repeat(300), "B".repeat(90));
    await vi.advanceTimersByTimeAsync(300);
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(elements.liveTextFest.textContent.length));
  });

  it("hatLiveGelaufen: erst nach dem ersten sichtbaren Zeichen, zuruecksetzen löscht es", async () => {
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);
    /* Beast gewählt, aber nur Standard geliefert → nichts sichtbar →
       gilt nicht als gelaufen. */
    elements.biasSwitch.checked = true;
    w("S".repeat(150));
    await vi.advanceTimersByTimeAsync(1000);
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);

    /* Das erste sichtbare Beast-Zeichen macht den Lauf zum Live-Lauf. */
    w("S".repeat(150), "B".repeat(60));
    await vi.advanceTimersByTimeAsync(300);
    expect(liveAnzeige.hatLiveGelaufen()).toBe(true);

    liveAnzeige.zuruecksetzen();
    expect(liveAnzeige.hatLiveGelaufen()).toBe(false);
  });

  /* ── Warte-Auge oberhalb der Karte (v3.0.2, ersetzt die Status-Zeile) ───
     Läuft der aktive Puffer leer, kehrt das vertraute Scan-Auge (#scanAnim)
     zurück und trägt die rotierenden Warte-Zeilen (`live.warten`) im
     Spinner-Text (#scanText) — NICHT mehr in einer Zeile in der Karte. Die
     kurzen Texte hier (48 Zeichen, Boden-Tempo 20 Z/s ≈ 2,4 s) tippen
     bewusst schnell leer. */

  it("v3.0.2: die Warte-Rotation erscheint im Auge oberhalb der Karte — erst nach dem Tipp-Ende, im Spinner-Text", async () => {
    w("A".repeat(48));
    await vi.advanceTimersByTimeAsync(1000);
    /* Solange getippt wird, ist das Auge aus: das Tippen IST die Bewegung.
       (Diese Erwartungen werden ROT, wenn jemand den Spinner-Warte-Zustand
       stilllegt.) */
    expect(elements.scanAnim.classList.contains("active")).toBe(false);

    /* Fertig getippt (~2,4 s) → das Auge übernimmt mit den Warte-Zeilen. */
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.scanText.textContent).toBe("live.warten.0");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.scanText.textContent).toBe("live.warten.1");
    /* Der Cursor blinkt weiter: kein Rausch-Schweif, Karte bleibt aktiv. */
    expect(elements.liveTextRausch.textContent).toBe("");
    expect(elements.liveKarte.classList.contains("active")).toBe(true);

    /* Mit dem nächsten getippten Zeichen verschwindet das Auge sofort. */
    w("A".repeat(48) + "B".repeat(120));
    await vi.advanceTimersByTimeAsync(300);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(48);
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
  });

  it("v3.0.2: bei Enthüllungs-Beginn verschwindet das Warte-Auge endgültig", async () => {
    w("A".repeat(12));
    await vi.advanceTimersByTimeAsync(5000); /* fertig getippt → Auge läuft */
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.scanText.textContent).toMatch(/^live\.warten\./);

    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    /* Auch nach weiteren Takten schreibt keine Warte-Zeile mehr nach. */
    const stand = elements.scanText.textContent;
    await vi.advanceTimersByTimeAsync(6000);
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    expect(elements.scanText.textContent).toBe(stand);
  });

  it("v3.0.2: reduced-motion zeigt das Warte-Auge ebenfalls — ohne Tippen trägt es die gesamte Wartezeit", async () => {
    reduzierteBewegung();
    /* Ohne Tippen ist der Puffer nach jeder Welle sofort „leer" — das Auge
       mit den Warte-Zeilen übernimmt unmittelbar (Textwechsel ist keine
       Bewegung). */
    w("A".repeat(80));
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.scanText.textContent).toBe("live.warten.0");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.scanText.textContent).toBe("live.warten.1");
    await vi.advanceTimersByTimeAsync(2500);
    expect(elements.scanText.textContent).toBe("live.warten.2");

    /* Nachschub erscheint sofort vollständig — das Auge rotiert weiter. */
    w("A".repeat(80) + "B".repeat(40));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80) + "B".repeat(40));
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
  });

  /* ── Zwei Puffer: der Text folgt dem gewählten Modus (Phase 3) ────────── */

  it("Modus-Wechsel mitten im Tippen: sofort der Beast-Puffer, weitergetippt am eigenen Fortschritt", async () => {
    /* Beide Puffer gefüllt — getippt wird nur der seriöse (Schalter aus).
       1500 Zeichen → adaptives Tempo ~50 Z/s, genug Bewegung für die Probe. */
    w("S".repeat(1500), "B".repeat(1500));
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

  it("Beast gewählt, Puffer noch leer: das Auge trägt den Beast-Warte-Text — und Tippstart, sobald Beast eintrifft", async () => {
    /* Seriös tippt bereits … */
    w("S".repeat(250));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);

    /* … Wechsel auf Beast, obwohl das Modell Beast noch nicht schreibt:
       KEIN Standard-Text sichtbar, das Warte-Auge oberhalb der Karte trägt
       den Beast-Warte-Text, in der Karte blinkt der Cursor (Schweif leer —
       das Blinken selbst ist CSS). */
    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.scanText.textContent).toBe("live.beastWartet");
    await vi.advanceTimersByTimeAsync(2000);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.liveTextRausch.textContent).toBe("");

    /* Die nächste Welle bringt die ersten Beast-Zeichen: jetzt tippt es
       sofort los, das Auge verschwindet. */
    w("S".repeat(250), "B".repeat(230));
    await vi.advanceTimersByTimeAsync(500);
    expect(elements.liveTextFest.textContent.length).toBeGreaterThan(0);
    expect(elements.liveTextFest.textContent).toBe("B".repeat(elements.liveTextFest.textContent.length));
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
  });

  it("v3.0.0: auch ein kurzer Beast-Stand tippt nach dem Wechsel sofort — kein Anlauf-Puffer je Puffer mehr", async () => {
    w("S".repeat(250), "B".repeat(50));
    await vi.advanceTimersByTimeAsync(1000);
    schalte(true);
    /* Früher wartete der 200-Zeichen-Anlauf hier mit leerem Cursor —
       jetzt tippt der Beast-Puffer ab dem ersten vorhandenen Zeichen. */
    await vi.advanceTimersByTimeAsync(1000);
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

  it("reduced-motion: Beast gewählt und noch leer → Beast-Warte-Text im Auge, kein Standard-Text", async () => {
    reduzierteBewegung();
    w("S".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("S".repeat(80));

    schalte(true);
    expect(elements.liveTextFest.textContent).toBe("");
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
    expect(elements.scanText.textContent).toBe("live.beastWartet");

    /* Sobald Beast eintrifft, steht er sofort vollständig da — und das Auge
       wechselt zurück auf die Warte-Zeilen (ohne Tippen ist der Puffer
       sofort wieder „leer"). */
    w("S".repeat(80), "B".repeat(60));
    expect(elements.liveTextFest.textContent).toBe("B".repeat(60));
    expect(elements.scanText.textContent).toBe("live.warten.0");
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
    /* A11y: genau EINE Ankündigung, am Ende — der Abschluss-Text der
       Scan-Phase; eine sichtbare Abschluss-Box gibt es nicht mehr (v3.0.2). */
    expect(elements.srAnnounce.textContent).toBe("scan.srEnd");
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
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
    expect(elements.srAnnounce.textContent).toBe("scan.srEnd");
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

  it("späte Wellen nach Beginn der Enthüllung bringen Karte und Text nicht zurück", async () => {
    baueGerendertesErgebnis();
    reduzierteBewegung();
    w("A".repeat(80));
    expect(elements.liveTextFest.textContent).toBe("A".repeat(80));
    /* Der Enthüllungs-Beginn räumt die Karte weg — die Zusammenfassung steht
       ab jetzt in ihrer normalen Box (#simulation). */
    liveAnzeige.starteEnthuellung();
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent).toBe("");
    w("A".repeat(80) + "B".repeat(80));
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.liveTextFest.textContent).toBe("");
  });

  /* ── Abschluss ohne Status-Box + geführtes Mitscrollen (v3.0.2) ────────── */

  it("v3.0.2: nach der Enthüllung steht nirgends mehr eine Abschluss-Status-Box", async () => {
    baueGerendertesErgebnis();
    liveAnzeige.starteEnthuellung();
    /* Karte und Warte-Auge sind ab Enthüllungs-Beginn endgültig weg … */
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
    await vi.advanceTimersByTimeAsync(16000);
    /* … und auch nach dem Abschluss taucht keine Status-Box wieder auf.
       (Diese Erwartungen werden ROT, wenn jemand die Abschluss-Box — Text
       „Analyse abgeschlossen …", i18n-Schlüssel live.statusFertig — wieder
       einbaut.) */
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
    expect(document.body.textContent).not.toContain("live.statusFertig");
    /* Die EINE Screenreader-Ankündigung am Ende bleibt. */
    expect(elements.srAnnounce.textContent).toBe("scan.srEnd");
    expect(elements.exportPdf.classList.contains("export-btn--hidden")).toBe(false);
  });

  it("v3.0.2 Führung: jede enthüllte Box wird sanft ins Sichtfeld geholt (scrollIntoView je Box)", async () => {
    const scrollSpy = vi.fn();
    window.Element.prototype.scrollIntoView = scrollSpy;
    try {
      baueGerendertesErgebnis();
      liveAnzeige.starteEnthuellung();
      await vi.advanceTimersByTimeAsync(16000);
      /* 10 Boxen: privacy, gps, 5 Kategorien-Kinder, Werbung, Manipulation,
         Datenwert (der Realitäts-Check bleibt hier verborgen). */
      expect(scrollSpy).toHaveBeenCalledTimes(10);
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    } finally {
      delete window.Element.prototype.scrollIntoView;
    }
  });

  it("v3.0.2 NUTZER HAT VORRANG: das erste Rad-Ereignis beendet die Führung sofort und dauerhaft", async () => {
    const scrollSpy = vi.fn();
    window.Element.prototype.scrollIntoView = scrollSpy;
    try {
      baueGerendertesErgebnis();
      liveAnzeige.starteEnthuellung();
      /* privacy (~700 ms) wurde noch geführt ins Sichtfeld geholt … */
      await vi.advanceTimersByTimeAsync(800);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      /* … dann greift der Nutzer ein — ab jetzt scrollt NICHTS mehr
         automatisch. (Diese Erwartung wird ROT, wenn jemand die
         Übernahme-Wache entfernt.) */
      window.dispatchEvent(new Event("wheel"));
      await vi.advanceTimersByTimeAsync(15000);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete window.Element.prototype.scrollIntoView;
    }
  });

  it("v3.0.2 Übernahme-Tasten: Scroll-Tasten stoppen die Führung, Tab nicht", async () => {
    const scrollSpy = vi.fn();
    window.Element.prototype.scrollIntoView = scrollSpy;
    try {
      baueGerendertesErgebnis();
      liveAnzeige.starteEnthuellung();
      /* Tab ist Navigation, kein Scrollen — die Führung läuft weiter. */
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }));
      await vi.advanceTimersByTimeAsync(800);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      /* Eine Pfeiltaste ist bewusstes Scrollen — Führung endet. */
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown" }));
      await vi.advanceTimersByTimeAsync(15000);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete window.Element.prototype.scrollIntoView;
    }
  });

  it("v3.0.2 Ton-Sichtfeld-Regel: nach der Übernahme klingt der Pop nur für mehrheitlich sichtbare Boxen", async () => {
    baueGerendertesErgebnis();
    const { popTon } = await import("../js/klang.js");
    /* privacy liegt weit außerhalb des Fensters, gps mitten darin
       (jsdom-Fensterhöhe: 768 px). */
    elements.privacy.getBoundingClientRect = () => ({ top: 2000, bottom: 2120, height: 120 });
    elements.gpsMap.getBoundingClientRect = () => ({ top: 100, bottom: 220, height: 120 });
    liveAnzeige.starteEnthuellung();
    /* Sofortige Übernahme, noch vor der ersten Box. */
    window.dispatchEvent(new Event("wheel"));
    popTon.mockClear();
    await vi.advanceTimersByTimeAsync(750); /* privacy ist offen (~700 ms) */
    /* Außerhalb des Sichtfelds → kein Geräusch aus dem Off. (Diese
       Erwartung wird ROT, wenn jemand die Ton-Sichtfeld-Regel entfernt.) */
    expect(popTon).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1150); /* gps ist offen (~1800 ms) */
    expect(popTon).toHaveBeenCalledTimes(1);
  });

  it("v3.0.2: solange die Führung aktiv ist, klingt jeder Pop — auch außerhalb des Sichtfelds", async () => {
    baueGerendertesErgebnis();
    const { popTon } = await import("../js/klang.js");
    elements.privacy.getBoundingClientRect = () => ({ top: 2000, bottom: 2120, height: 120 });
    liveAnzeige.starteEnthuellung();
    popTon.mockClear();
    await vi.advanceTimersByTimeAsync(750); /* privacy ist offen (~700 ms) */
    expect(popTon).toHaveBeenCalledTimes(1);
  });

  it("v3.0.2 reduced-motion: kein einziges automatisches Scrollen", async () => {
    const scrollSpy = vi.fn();
    window.Element.prototype.scrollIntoView = scrollSpy;
    try {
      reduzierteBewegung();
      baueGerendertesErgebnis();
      liveAnzeige.starteEnthuellung();
      await vi.advanceTimersByTimeAsync(16000);
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      delete window.Element.prototype.scrollIntoView;
    }
  });
});
