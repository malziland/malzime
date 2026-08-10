import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

/* Karten mit gesteuerten Bildschirmpositionen bauen. jsdom rechnet kein
   Layout — getBoundingClientRect wird deshalb pro Karte gesetzt. */
function makeCards(specs) {
  const facts = document.getElementById("facts");
  facts.innerHTML = specs.map((s) => `<div class="cat-card" data-key="${s.key}"></div>`).join("");
  specs.forEach((s) => {
    const el = facts.querySelector(`[data-key="${s.key}"]`);
    el.getBoundingClientRect = () => ({ top: s.top, bottom: s.bottom });
  });
  return facts;
}

function stubToggleBar(bottom) {
  const wrap = document.getElementById("biasToggleWrap");
  wrap.getBoundingClientRect = () => ({ top: 0, bottom });
  return wrap;
}

describe("Sticky-Umschalter", () => {
  let scrollSpy;

  /* dom.js bindet seine Element-Referenzen beim Import. Ohne resetModules
     zeigen sie ab dem zweiten Test auf das DOM des ersten (setupDOM ersetzt
     document.body) — die Tests wuerden dann gegen abgehaengte Elemente
     messen und zufaellig gruen sein. */
  beforeEach(() => {
    vi.resetModules();
    setupDOM();
    scrollSpy = vi.fn();
    window.scrollTo = scrollSpy;
    /* jsdom meldet 768 — explizit setzen, damit die Sichtbarkeitsprüfung im
       Anker berechenbar ist. */
    Object.defineProperty(window, "innerHeight", { value: 800, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Scroll-Anker beim Moduswechsel", () => {
    it("gleicht die Verschiebung aus, wenn die Karte nach dem Wechsel tiefer sitzt", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      makeCards([
        { key: "alter_geschlecht", top: -200, bottom: -100 }, // schon durchgescrollt
        { key: "einkommen", top: 60, bottom: 160 }, // Ankerkarte
        { key: "bildung", top: 170, bottom: 270 },
      ]);

      /* Beast-Texte sind laenger: die Ankerkarte rutscht um 40px nach unten */
      renderKeepingScrollAnchor(() => {
        makeCards([
          { key: "alter_geschlecht", top: -240, bottom: -110 },
          { key: "einkommen", top: 100, bottom: 240 },
          { key: "bildung", top: 250, bottom: 390 },
        ]);
      });

      expect(scrollSpy).toHaveBeenCalledWith({ top: 40, behavior: "instant" });
    });

    it("ignoriert Karten, die hinter der geklebten Leiste liegen", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      /* Erste Karte endet bei 52 — nur 2px unter der Leiste, also faktisch
         verdeckt. Anker muss die zweite Karte sein. */
      makeCards([
        { key: "alter_geschlecht", top: -40, bottom: 52 },
        { key: "einkommen", top: 60, bottom: 160 },
      ]);

      renderKeepingScrollAnchor(() => {
        makeCards([
          { key: "alter_geschlecht", top: -40, bottom: 52 },
          { key: "einkommen", top: 85, bottom: 185 },
        ]);
      });

      /* 85 - 60 = 25 → die zweite Karte wurde als Anker genommen */
      expect(scrollSpy).toHaveBeenCalledWith({ top: 25, behavior: "instant" });
    });

    it("scrollt nicht, wenn sich nichts verschoben hat", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      makeCards([{ key: "einkommen", top: 60, bottom: 160 }]);

      renderKeepingScrollAnchor(() => {
        makeCards([{ key: "einkommen", top: 60, bottom: 160 }]);
      });

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("scrollt nicht, wenn es gar keine Karten gibt (blockiertes Profil)", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      document.getElementById("facts").innerHTML = "";

      const render = vi.fn();
      renderKeepingScrollAnchor(render);

      expect(render).toHaveBeenCalled();
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("scrollt nicht, wenn die Ankerkarte nach dem Wechsel fehlt", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      makeCards([{ key: "einkommen", top: 60, bottom: 160 }]);

      renderKeepingScrollAnchor(() => {
        makeCards([{ key: "politisch", top: 60, bottom: 160 }]);
      });

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("rendert auch dann, wenn kein Anker gefunden wird", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      /* Alle Karten liegen oberhalb der Leiste */
      makeCards([{ key: "einkommen", top: -300, bottom: -200 }]);

      const render = vi.fn();
      renderKeepingScrollAnchor(render);

      expect(render).toHaveBeenCalledTimes(1);
      expect(scrollSpy).not.toHaveBeenCalled();
    });
  });

  describe("Geklebt-Zustand", () => {
    it("setzt is-stuck, sobald die Marke den oberen Rand verlaesst", async () => {
      let observerCallback = null;
      window.IntersectionObserver = class {
        constructor(cb) {
          observerCallback = cb;
        }
        observe() {}
        disconnect() {}
      };
      globalThis.IntersectionObserver = window.IntersectionObserver;

      const { initStickyToggle } = await import("../js/sticky-toggle.js");
      initStickyToggle();

      const wrap = document.getElementById("biasToggleWrap");
      expect(document.querySelector(".bias-sticky-sentinel")).toBeTruthy();

      observerCallback([{ isIntersecting: false }]);
      expect(wrap.classList.contains("is-stuck")).toBe(true);

      observerCallback([{ isIntersecting: true }]);
      expect(wrap.classList.contains("is-stuck")).toBe(false);
    });

    it("die Marke ist fuer Screenreader unsichtbar", async () => {
      window.IntersectionObserver = class {
        constructor() {}
        observe() {}
        disconnect() {}
      };
      globalThis.IntersectionObserver = window.IntersectionObserver;

      const { initStickyToggle } = await import("../js/sticky-toggle.js");
      initStickyToggle();

      const sentinel = document.querySelector(".bias-sticky-sentinel");
      expect(sentinel.getAttribute("aria-hidden")).toBe("true");
    });

    it("bricht sauber ab, wenn der Browser IntersectionObserver nicht kennt", async () => {
      delete window.IntersectionObserver;
      delete globalThis.IntersectionObserver;

      const { initStickyToggle } = await import("../js/sticky-toggle.js");
      expect(() => initStickyToggle()).not.toThrow();
      expect(document.querySelector(".bias-sticky-sentinel")).toBeNull();
    });
  });

  describe("Kein Ankern, wenn man gar nicht in der Kartenliste steht", () => {
    it("scrollt nicht, wenn alle Karten unterhalb des Bildschirms liegen", async () => {
      /* Genau der gemeldete Fall: Man steht ganz oben bei der Überschrift und
         schaltet um. Vorher griff der Anker die erste Karte (die weit unten
         liegt) und scrollte dorthin — die Überschrift verschwand. */
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      makeCards([
        { key: "alter_geschlecht", top: 1200, bottom: 1340 },
        { key: "einkommen", top: 1350, bottom: 1490 },
      ]);

      renderKeepingScrollAnchor(() => {
        makeCards([
          { key: "alter_geschlecht", top: 1600, bottom: 1800 },
          { key: "einkommen", top: 1810, bottom: 2010 },
        ]);
      });

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("ankert weiterhin, sobald eine Karte im Bild steht", async () => {
      const { renderKeepingScrollAnchor } = await import("../js/sticky-toggle.js");
      stubToggleBar(50);
      makeCards([{ key: "einkommen", top: 700, bottom: 840 }]);

      renderKeepingScrollAnchor(() => {
        makeCards([{ key: "einkommen", top: 760, bottom: 900 }]);
      });

      expect(scrollSpy).toHaveBeenCalled();
    });
  });
});
