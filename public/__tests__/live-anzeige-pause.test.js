/**
 * live-anzeige-pause.test.js — Die Zusicherung beim Verbindungsabbruch (v3.3.1).
 *
 * Der Nutzer hat sie woertlich verlangt, in zwei Teilen:
 *   1. Der bereits geschriebene Text BLEIBT — und er wird nicht veraendert,
 *      wenn es weitergeht.
 *   2. Es geht auch wirklich weiter — nicht nur „wird fortgesetzt" und dann
 *      passiert nichts.
 *
 * Beides steht hier als Pruefung, nicht als Vorsatz. Vorher raeumte
 * `abbrechen()` bei jedem Fehler Karte und Text weg; das sah nach Datenverlust
 * aus, obwohl serverseitig nichts verloren war.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => (key === "live.warten" ? ["live.warten.0", "live.warten.1", "live.warten.2"] : key),
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

vi.mock("../js/klang.js", () => ({
  klangAktivieren: vi.fn(),
  tippTon: vi.fn(),
  popTon: vi.fn(),
}));

describe("Live-Anzeige: Pause und Fortsetzung beim Verbindungsabbruch", () => {
  let liveAnzeige, elements;
  let echteMatchMedia;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers();
    liveAnzeige = await import("../js/live-anzeige.js");
    ({ elements } = await import("../js/dom.js"));
    liveAnzeige.zuruecksetzen();
    elements.liveKarte.className = "";
    elements.liveTextFest.textContent = "";
    elements.liveTextRausch.textContent = "";
    elements.biasSwitch.checked = false;

    /* Volle Bewegung — sonst greift der Sofort-Pfad fuer reduzierte Bewegung
       und es wird nie Zeichen fuer Zeichen getippt. */
    echteMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    liveAnzeige.zuruecksetzen();
    window.matchMedia = echteMatchMedia;
    vi.useRealTimers();
  });

  /** Tippt so lange, bis mindestens `mindestens` Zeichen sichtbar sind. */
  async function tippenBis(mindestens) {
    for (let i = 0; i < 400 && elements.liveTextFest.textContent.length < mindestens; i++) {
      await vi.advanceTimersByTimeAsync(80);
    }
    return elements.liveTextFest.textContent;
  }

  it("pausieren() laesst Karte UND bereits getippten Text stehen", async () => {
    liveAnzeige.welle({ standard: "Du bist 34 Jahre alt und arbeitest vermutlich im Handel.", beast: null });
    const sichtbarVorher = await tippenBis(8);
    expect(sichtbarVorher.length).toBeGreaterThanOrEqual(8);
    expect(elements.liveKarte.classList.contains("active")).toBe(true);

    expect(liveAnzeige.pausieren()).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    /* Der Kern der Zusage: Nichts ist verschwunden, nichts hat sich geaendert. */
    expect(elements.liveKarte.classList.contains("active")).toBe(true);
    expect(elements.liveTextFest.textContent).toBe(sichtbarVorher);
    expect(liveAnzeige.istPausiert()).toBe(true);
    /* Gedaempft, damit der Stillstand sichtbar begruendet ist. */
    expect(elements.liveKarte.classList.contains("live-karte--pausiert")).toBe(true);
    /* Kein Rausch-Schweif: Er waere Bewegung ohne Fortschritt. */
    expect(elements.liveTextRausch.textContent).toBe("");
  });

  it("fortsetzen() tippt an derselben Stelle weiter — das Gelesene bleibt der Anfang", async () => {
    liveAnzeige.welle({ standard: "Du bist 34 Jahre alt und arbeitest vermutlich im Handel.", beast: null });
    await tippenBis(8);
    liveAnzeige.pausieren();
    const beimAbbruchGelesen = elements.liveTextFest.textContent;

    expect(liveAnzeige.fortsetzen()).toBe(true);
    expect(liveAnzeige.istPausiert()).toBe(false);
    expect(elements.liveKarte.classList.contains("live-karte--pausiert")).toBe(false);

    const nachher = await tippenBis(beimAbbruchGelesen.length + 6);

    /* Zwei Zusicherungen in zwei Zeilen: es ging weiter UND das Gelesene ist
       unveraendert der Anfang des Neuen. */
    expect(nachher.length).toBeGreaterThan(beimAbbruchGelesen.length);
    expect(nachher.startsWith(beimAbbruchGelesen)).toBe(true);
  });

  it("eine Welle darf bereits Gelesenes niemals umschreiben", async () => {
    liveAnzeige.welle({ standard: "Du bist 34 Jahre alt", beast: null });
    const gelesen = await tippenBis(10);

    /* Ein abweichender Stand — so etwas darf die Anzeige nie uebernehmen,
       sonst aendert sich Text vor den Augen des Nutzers. */
    liveAnzeige.welle({ standard: "VOELLIG ANDERER TEXT, der auch laenger ist als der bisherige.", beast: null });
    await vi.advanceTimersByTimeAsync(500);

    expect(elements.liveTextFest.textContent.startsWith(gelesen)).toBe(true);
    expect(elements.liveTextFest.textContent).not.toContain("VOELLIG ANDERER TEXT");
  });

  it("eine kuerzere (verspaetete) Welle setzt den Text nicht zurueck", async () => {
    liveAnzeige.welle({ standard: "Du bist 34 Jahre alt und arbeitest im Handel.", beast: null });
    const gelesen = await tippenBis(12);

    liveAnzeige.welle({ standard: "Du bist 34", beast: null });
    await vi.advanceTimersByTimeAsync(500);

    expect(elements.liveTextFest.textContent.length).toBeGreaterThanOrEqual(gelesen.length);
    expect(elements.liveTextFest.textContent.startsWith(gelesen)).toBe(true);
  });

  it("pausieren() ohne laufenden Live-Text ist ein No-Op und meldet das ehrlich", () => {
    expect(liveAnzeige.pausieren()).toBe(false);
    expect(liveAnzeige.istPausiert()).toBe(false);
    /* Wichtig fuer api.js: Nur an dieser Rueckmeldung erkennt der Aufrufer,
       ob er stattdessen die Scan-Animation zeigen muss. */
    expect(liveAnzeige.fortsetzen()).toBe(false);
  });

  it("abbrechen() raeumt auch aus der Pause heraus restlos auf", async () => {
    liveAnzeige.welle({ standard: "Du bist 34 Jahre alt und arbeitest im Handel.", beast: null });
    await tippenBis(8);
    liveAnzeige.pausieren();

    liveAnzeige.abbrechen();

    expect(liveAnzeige.istPausiert()).toBe(false);
    expect(elements.liveKarte.classList.contains("live-karte--pausiert")).toBe(false);
    expect(elements.liveKarte.classList.contains("active")).toBe(false);
  });
});
