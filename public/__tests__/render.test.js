import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

describe("Render helpers", () => {
  let elements, _escapeHtml;

  beforeEach(async () => {
    setupDOM();
    const domMod = await import("../js/dom.js");
    elements = domMod.elements;
    _escapeHtml = domMod.escapeHtml;
  });

  describe("EXIF labels", () => {
    it("render module exports EXIF_LABELS with German names", async () => {
      /* renderPrivacyRisks nutzt EXIF_LABELS intern — wir testen indirekt über den Output */
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            categories: { alter: { label: "Alter", value: "25", confidence: 0.8 } },
            ad_targeting: [],
            manipulation_triggers: [],
            profileText: "Test-Profil",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: { make: "Apple", model: "iPhone 15 Pro" },
        meta: { requestId: "test", mode: "multimodal" },
      };

      renderCurrentMode(mockData);

      /* EXIF-Karte sollte gerendert sein */
      expect(elements.privacy.innerHTML).toContain("Apple");
      expect(elements.privacy.innerHTML).toContain("iPhone 15 Pro");
      expect(elements.privacy.innerHTML).toContain("exif.make");
    });
  });

  describe("GPS Map rendering", () => {
    it("does not render map when no GPS data", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            categories: { alter: { label: "Alter", value: "25", confidence: 0.8 } },
            ad_targeting: [],
            manipulation_triggers: [],
            profileText: "Test",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "multimodal" },
      };

      renderCurrentMode(mockData);
      expect(elements.gpsMap.innerHTML).toBe("");
    });
  });

  describe("Blocked response", () => {
    it("renders blockedReason when profiles is null", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: null,
        blockedReason: "Bild wurde blockiert.",
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "blocked" },
      };

      renderCurrentMode(mockData);
      expect(elements.simulation.innerHTML).toContain("Bild wurde blockiert.");
    });
  });

  describe("Confidence zero handling (BUG-004)", () => {
    it("renders confidence=0 with a dot indicator (1 of 3 dots) instead of treating as missing", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            /* v2.1: nur Karten mit bekannten CATEGORY_GROUPS-Keys werden gerendert. */
            categories: {
              alter_geschlecht: { label: "Alter & Geschlecht", value: "männlich, 25", confidence: 0 },
            },
            ad_targeting: [],
            manipulation_triggers: [],
            profileText: "Test",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "multimodal" },
      };

      renderCurrentMode(mockData);

      /* v2.1: Konfidenz wird jetzt als 3 Punkte dargestellt — bei confidence=0
         ist immer noch genau 1 Punkt aktiv (low-Klasse), nie 0 Punkte. */
      expect(elements.facts.innerHTML).toContain("conf-dot");
      expect(elements.facts.innerHTML).toMatch(/conf-dot on/);
      /* Data value should use confidence 0, not fallback 0.5 */
      expect(elements.dataValue.innerHTML).not.toContain("NaN");
    });
  });

  describe("Animal mode", () => {
    it("hides data value for animal profiles", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            categories: { art: { label: "Tierart", value: "Hund", confidence: 0.9 } },
            ad_targeting: ["Hundefutter"],
            manipulation_triggers: ["Leckerli-Werbung"],
            profileText: "Wuff!",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "animal" },
      };

      renderCurrentMode(mockData);
      expect(elements.dataValue.innerHTML).toBe("");
    });
  });

  /* ── ARCH-002: Edge cases ── */

  describe("Empty profile fields", () => {
    it("renders profile with empty ad_targeting and manipulation_triggers", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            /* v2.1: bekannte Karten-Keys aus CATEGORY_GROUPS */
            categories: { alter_geschlecht: { label: "Alter & Geschlecht", value: "männlich, 30", confidence: 0.7 } },
            ad_targeting: [],
            manipulation_triggers: [],
            profileText: "",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "multimodal" },
      };

      renderCurrentMode(mockData);
      expect(elements.facts.innerHTML).toContain("Alter");
      expect(elements.facts.innerHTML).toContain("30");
    });

    it("renders profile with multiple categories correctly", async () => {
      const { renderCurrentMode } = await import("../js/render.js");

      const mockData = {
        profiles: {
          normal: {
            /* v2.1: bekannte Karten-Keys aus CATEGORY_GROUPS, sonst werden Karten ignoriert */
            categories: {
              alter_geschlecht: { label: "Alter & Geschlecht", value: "männlich, 25-30", confidence: 0.8 },
              bildung: { label: "Bildungsniveau", value: "Designer", confidence: 0.6 },
              interessen: { label: "Interessen & Hobbys", value: "Sportlich", confidence: 0.9 },
            },
            ad_targeting: ["Mode", "Sport"],
            manipulation_triggers: ["FOMO"],
            profileText: "Ein aktiver Mensch.",
          },
          boost: null,
        },
        privacyRisks: [],
        exif: {},
        meta: { requestId: "test", mode: "multimodal" },
      };

      renderCurrentMode(mockData);
      expect(elements.facts.innerHTML).toContain("Designer");
      expect(elements.facts.innerHTML).toContain("Sportlich");
      expect(elements.simulation.innerHTML).toContain("Ein aktiver Mensch.");
    });
  });
});
