import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("stats page", () => {
  /* ── i18n keys ── */

  describe("i18n keys exist in de.json", () => {
    const deJson = JSON.parse(readFileSync(resolve(__dirname, "../locales/de.json"), "utf-8"));

    const requiredKeys = [
      "stats.backLink",
      "stats.errorText",
      "stats.heroTitle",
      "stats.heroSub",
      "stats.liveText",
      "stats.totalLabel",
      "stats.totalSince",
      "stats.today",
      "stats.thisWeek",
      "stats.thisMonth",
      "stats.avgDay",
      "stats.avgWeek",
      "stats.avgMonth",
      "stats.percentFree",
      "stats.limitTitle",
      "stats.limitReached",
      "stats.available",
      "stats.countdownMinutes",
      "stats.countdownSeconds",
      "stats.countdownDone",
      "stats.infoCountTitle",
      "stats.infoCountText",
      "stats.infoLimitTitle",
      "stats.infoLimitText",
      "stats.infoFundingTitle",
      "stats.infoFundingText",
      "stats.infoFundingButton",
    ];

    for (const key of requiredKeys) {
      it(`has key "${key}"`, () => {
        expect(deJson[key]).toBeDefined();
        expect(typeof deJson[key]).toBe("string");
        expect(deJson[key].length).toBeGreaterThan(0);
      });
    }
  });

  /* ── stats.html data-i18n attributes ── */

  describe("stats.html has data-i18n attributes", () => {
    const html = readFileSync(resolve(__dirname, "../stats.html"), "utf-8");

    it("has data-i18n for hero title", () => {
      expect(html).toContain('data-i18n="stats.heroTitle"');
    });

    it("has data-i18n for hero sub", () => {
      expect(html).toContain('data-i18n="stats.heroSub"');
    });

    it("has data-i18n for live text", () => {
      expect(html).toContain('data-i18n="stats.liveText"');
    });

    it("has data-i18n for total label", () => {
      expect(html).toContain('data-i18n="stats.totalLabel"');
    });

    it("has data-i18n for period labels", () => {
      expect(html).toContain('data-i18n="stats.today"');
      expect(html).toContain('data-i18n="stats.thisWeek"');
      expect(html).toContain('data-i18n="stats.thisMonth"');
    });

    it("has data-i18n for limit title", () => {
      expect(html).toContain('data-i18n="stats.limitTitle"');
    });

    it("has data-i18n for info sections", () => {
      expect(html).toContain('data-i18n="stats.infoCountTitle"');
      expect(html).toContain('data-i18n="stats.infoLimitTitle"');
      expect(html).toContain('data-i18n="stats.infoFundingTitle"');
    });
  });

  /* ── stats.js has no hardcoded German strings ── */

  describe("stats.js uses i18n", () => {
    const statsJs = readFileSync(resolve(__dirname, "../js/stats.js"), "utf-8");

    it("imports i18n module", () => {
      expect(statsJs).toContain('from "./i18n.js"');
    });

    it("uses getLanguage() for Intl.NumberFormat", () => {
      expect(statsJs).toContain("getLanguage()");
      expect(statsJs).not.toMatch(/NumberFormat\s*\(\s*["']de["']\s*\)/);
    });

    it("uses t() for dynamic strings", () => {
      expect(statsJs).toContain('t("stats.');
    });

    it("does not contain hardcoded German display strings", () => {
      expect(statsJs).not.toContain('"/ Tag"');
      expect(statsJs).not.toContain('"/ Woche"');
      expect(statsJs).not.toContain('"/ Monat"');
      expect(statsJs).not.toContain('"Limit erreicht"');
      expect(statsJs).not.toMatch(/["']Verf[uü]gbar["']/);
      expect(statsJs).not.toContain('"% frei"');
    });

    it("calls initI18n and applyTranslations", () => {
      expect(statsJs).toContain("initI18n()");
      expect(statsJs).toContain("applyTranslations()");
    });
  });
});
