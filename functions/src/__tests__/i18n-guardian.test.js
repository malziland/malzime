"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(SRC_DIR, "locales");

/* ── Helpers ── */

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "manifest.json"), "utf8"));
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, "");
}

function getBackendJsFiles() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ rel: f, abs: path.join(SRC_DIR, f) }));
}

function detectHardcodedGerman(code) {
  const stripped = stripComments(code);
  const issues = [];

  if (/[äöüÄÖÜß]/.test(stripped)) {
    issues.push("German umlauts outside comments");
  }

  /* Distinctly German phrases (catch files without umlauts like animal profiles) */
  if (/\bDu bist\b|\bDu hast\b|\bDein[e]?\s/.test(stripped)) {
    issues.push("German phrases outside comments");
  }

  return issues;
}

/* ── Tests ── */

describe("i18n Guardian (Backend)", () => {
  /* ── 1. Locale Structure ── */
  describe("Locale Structure", () => {
    it("manifest.json has valid format", () => {
      const m = readManifest();
      expect(m.languages).toBeInstanceOf(Array);
      expect(m.languages.length).toBeGreaterThan(0);
      expect(typeof m.default).toBe("string");
      expect(m.languages).toContain(m.default);
    });
  });

  /* ── 2. i18n Module ── */
  describe("resolveLanguage", () => {
    const { resolveLanguage } = require("../i18n");

    it("returns requested language when available", () => {
      expect(resolveLanguage("de")).toBe("de");
    });

    it("returns default for unknown language", () => {
      expect(resolveLanguage("xx")).toBe("de");
    });

    it("returns default for undefined", () => {
      expect(resolveLanguage(undefined)).toBe("de");
    });

    it("returns default for non-string input", () => {
      expect(resolveLanguage(42)).toBe("de");
    });
  });

  /* ── 3. Schema Consistency ── */
  describe("JSON Schema Consistency", () => {
    const { loadPrompts } = require("../i18n");
    const prompts = loadPrompts("de");

    function extractJsonKeys(schemaStr) {
      const match = schemaStr.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        /* Schema enthaelt 0.0-1.0 Platzhalter — durch 0.5 ersetzen fuer JSON.parse */
        const sanitized = match[0].replace(/0\.0-1\.0/g, "0.5");
        const obj = JSON.parse(sanitized);
        return {
          categoryKeys: Object.keys(obj.categories || {}).sort(),
          topKeys: Object.keys(obj).sort(),
        };
      } catch {
        return null;
      }
    }

    it("jsonSchemaNormal and jsonSchemaBoost exist", () => {
      expect(typeof prompts.jsonSchemaNormal).toBe("string");
      expect(typeof prompts.jsonSchemaBoost).toBe("string");
    });

    it("both schemas have identical JSON keys", () => {
      const normal = extractJsonKeys(prompts.jsonSchemaNormal);
      const boost = extractJsonKeys(prompts.jsonSchemaBoost);
      expect(normal).not.toBeNull();
      expect(boost).not.toBeNull();
      expect(normal.topKeys).toEqual(boost.topKeys);
      expect(normal.categoryKeys).toEqual(boost.categoryKeys);
    });
  });

  /* ── 4. Hardcoded String Detection ── */
  describe("No Hardcoded German in Backend JS", () => {
    /*
     * Allowlist: files that still contain hardcoded German strings.
     * As phases complete, files get REMOVED from this list.
     * The guardian ensures cleaned files stay clean.
     */
    const ALLOWLIST = [
      "privacy.js", // OCR detection patterns (straße, ÄÖÜ) — not translatable
      "animal.js", // German + English animal keywords for SUBJECT classification — not translatable
    ];

    /* Infrastructure files — no user-facing text, permanently excluded */
    const EXCLUDED = ["i18n.js", "config.js", "middleware.js", "vision.js"];

    it("non-allowlisted backend JS files have no hardcoded German", () => {
      const violations = [];
      for (const { rel, abs } of getBackendJsFiles()) {
        if (ALLOWLIST.includes(rel) || EXCLUDED.includes(rel)) continue;
        const code = fs.readFileSync(abs, "utf8");
        const issues = detectHardcodedGerman(code);
        if (issues.length > 0) {
          violations.push(`${rel}: ${issues.join(", ")}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it("allowlist contains only files that need it (hygiene)", () => {
      const stale = [];
      for (const rel of ALLOWLIST) {
        const abs = path.join(SRC_DIR, rel);
        if (!fs.existsSync(abs)) continue;
        const code = fs.readFileSync(abs, "utf8");
        if (detectHardcodedGerman(code).length === 0) {
          stale.push(`${rel} — no hardcoded German found, remove from allowlist`);
        }
      }
      expect(stale).toEqual([]);
    });
  });
});
