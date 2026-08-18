import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(PUBLIC_DIR, "locales");

/* ── Helpers ── */

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "manifest.json"), "utf8"));
}

function readLocale(lang) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"));
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, "");
}

function getAllJsFiles() {
  const jsDir = path.join(PUBLIC_DIR, "js");
  const files = fs
    .readdirSync(jsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ rel: `js/${f}`, abs: path.join(jsDir, f) }));
  files.push({ rel: "app.js", abs: path.join(PUBLIC_DIR, "app.js") });
  return files;
}

function detectHardcodedGerman(code) {
  const stripped = stripComments(code);
  const issues = [];

  /* Umlauts in non-comment code → almost certainly in string literals */
  if (/[äöüÄÖÜß]/.test(stripped)) {
    issues.push("German umlauts outside comments");
  }

  /* Direct DOM text property assignment with non-empty string literal (not template) */
  if (/\.(textContent|innerHTML|alt|placeholder)\s*=\s*["'][^"']+/.test(stripped)) {
    issues.push("hardcoded string assigned to DOM text property");
  }

  /* Distinctly German phrases (catch strings without umlauts) */
  if (/\bDu bist\b|\bDu hast\b|\bDein[e]?\s/.test(stripped)) {
    issues.push("German phrases outside comments");
  }

  return issues;
}

/* ── Tests ── */

describe("i18n Guardian", () => {
  /* ── 1. Locale Structure ── */
  describe("Locale Structure", () => {
    it("manifest.json has valid format", () => {
      const m = readManifest();
      expect(m.languages).toBeInstanceOf(Array);
      expect(m.languages.length).toBeGreaterThan(0);
      expect(typeof m.default).toBe("string");
      expect(m.languages).toContain(m.default);
    });

    it("locale file exists for every language in manifest", () => {
      const m = readManifest();
      for (const lang of m.languages) {
        const p = path.join(LOCALES_DIR, `${lang}.json`);
        expect(fs.existsSync(p), `Missing: ${lang}.json`).toBe(true);
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        expect(typeof data).toBe("object");
      }
    });

    it("locale values are strings or arrays of strings", () => {
      const m = readManifest();
      for (const lang of m.languages) {
        const data = readLocale(lang);
        for (const [key, val] of Object.entries(data)) {
          const ok = typeof val === "string" || (Array.isArray(val) && val.every((v) => typeof v === "string"));
          expect(ok, `${lang}.json key "${key}" has invalid type`).toBe(true);
        }
      }
    });
  });

  /* ── 2. Language Consistency ── */
  describe("Language Consistency", () => {
    it("all locales have the same keys as the default locale", () => {
      const m = readManifest();
      const defaultKeys = Object.keys(readLocale(m.default)).sort();

      for (const lang of m.languages) {
        if (lang === m.default) continue;
        const keys = Object.keys(readLocale(lang)).sort();
        const missing = defaultKeys.filter((k) => !keys.includes(k));
        /* notice.contentLanguageMismatch exists only in non-default locales */
        const extra = keys.filter((k) => !defaultKeys.includes(k) && k !== "notice.contentLanguageMismatch");

        expect(missing, `${lang}.json is missing keys: ${missing.join(", ")}`).toEqual([]);
        expect(extra, `${lang}.json has extra keys: ${extra.join(", ")}`).toEqual([]);
      }
    });
  });

  /* ── 3. Key Completeness ── */
  describe("Key Completeness", () => {
    it("every data-i18n attribute in all HTML files has a key in default locale", () => {
      const m = readManifest();
      const localeKeys = Object.keys(readLocale(m.default));
      const htmlFiles = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".html"));

      const attrs = [
        "data-i18n",
        "data-i18n-alt",
        "data-i18n-title",
        "data-i18n-placeholder",
        "data-i18n-html",
        // A11Y-2026-08-13-FE-03: data-i18n-aria fehlte hier — der übersetzbare
        // aria-Mechanismus hatte deshalb 0 Nutzer, ohne dass etwas rot wurde.
        "data-i18n-aria",
      ];
      const missing = [];

      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
        for (const attr of attrs) {
          const regex = new RegExp(`${attr}="([^"]+)"`, "g");
          let match;
          while ((match = regex.exec(html))) {
            if (!localeKeys.includes(match[1])) {
              missing.push(`${file}: ${attr}="${match[1]}"`);
            }
          }
        }
      }

      expect(missing, `HTML references missing keys in ${m.default}.json`).toEqual([]);
    });

    /* A11Y-2026-08-13-FE-03: Ein hart kodiertes aria-label auf einem
       interaktiven Element ist für englische Screenreader-Nutzer der
       A11Y-001-Rückfall. Interaktive Beschriftungen müssen über data-i18n-aria
       laufen. Nicht-interaktive role="img"-Labels in JS-Templates (render.js)
       sind separat an t() gebunden. */
    it("kein hartes aria-label auf interaktivem Element ohne data-i18n-aria (index.html)", () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
      const treffer = [];
      const regex = /<[^>]*\baria-label="([^"]+)"[^>]*>/g;
      let m2;
      while ((m2 = regex.exec(html))) {
        const tag = m2[0];
        if (!/data-i18n-aria=/.test(tag)) {
          treffer.push(m2[1]);
        }
      }
      expect(treffer, "hart kodierte aria-label in index.html").toEqual([]);
    });

    it("every t() call in JS references a key in default locale", () => {
      const m = readManifest();
      const localeKeys = Object.keys(readLocale(m.default));

      /* If locale has no keys yet, no t() calls should exist either */
      const missing = [];
      for (const { rel, abs } of getAllJsFiles()) {
        const code = stripComments(fs.readFileSync(abs, "utf8"));
        const regex = /\bt\(\s*["']([^"']+)["']/g;
        let match;
        while ((match = regex.exec(code))) {
          if (!localeKeys.includes(match[1])) {
            missing.push(`${rel}: t("${match[1]}")`);
          }
        }
      }

      expect(missing, "t() calls reference missing locale keys").toEqual([]);
    });
  });

  /* ── 4. Hardcoded String Detection (Frontend) ── */
  describe("No Hardcoded German in Frontend JS", () => {
    /*
     * Allowlist: files that still contain hardcoded German strings.
     * As phases complete, files get REMOVED from this list.
     * The guardian then ensures they stay clean forever.
     */
    const ALLOWLIST = [
      /* ÜBERGANG (2026-08-13): js/sprachhinweis.js trägt den zweisprachigen
         Hinweis auf den noch nicht übersetzten Rechtsseiten. Die Texte stehen
         dort bewusst fest im Code: Diese Seiten laden KEINE Sprachdatei und
         rufen keine Schnittstelle auf — das ist eine geprüfte Eigenschaft
         (e2e/sprachumschalter-unterseiten.test.js). Sie dafür zu öffnen wäre
         der schlechtere Tausch.

         Der Eintrag löst sich selbst auf: Der Test direkt darunter macht ihn
         zum Fehler, sobald die Rechtsseiten übersetzt sind. */
      "js/sprachhinweis.js",

      /* ÜBERGANG (2026-08-18), gleiche Begründung: js/echtheit-pruefen.js
         rechnet auf der Datenschutzseite nach, ob der ausgelieferte Stand dem
         offenen Quelltext entspricht. Auch diese Seite lädt keine Sprachdatei
         — die Texte müssen deshalb im Code stehen.

         Er löst sich mit demselben Test auf: Sobald die Rechtsseiten übersetzt
         sind, gehört dieser Eintrag entfernt und die Texte in die Locales. */
      "js/echtheit-pruefen.js",
    ];

    it("non-allowlisted JS files have no hardcoded German", () => {
      const violations = [];
      for (const { rel, abs } of getAllJsFiles()) {
        if (ALLOWLIST.includes(rel)) continue;
        const code = fs.readFileSync(abs, "utf8");
        const issues = detectHardcodedGerman(code);
        if (issues.length > 0) {
          violations.push(`${rel}: ${issues.join(", ")}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it("die Übergangs-Ausnahme verschwindet, sobald die Rechtsseiten übersetzt sind", () => {
      /* Eine Ausnahme ohne Ablaufdatum wird zur Dauerlösung. Diese hier hat
         eines: Sobald eine der drei Rechtsseiten Übersetzungs-Marker trägt,
         ist die Übergangslösung überflüssig — dann müssen js/sprachhinweis.js,
         seine Einbindung im HTML und dieser Eintrag weg. */
      /* PUBLIC_DIR zeigt bereits auf public/ — siehe oben. */
      const rechtsseiten = ["datenschutz.html", "impressum.html", "nutzungsbedingungen.html"];
      const uebersetzt = rechtsseiten.filter((datei) => {
        const p = path.join(PUBLIC_DIR, datei);
        return fs.existsSync(p) && fs.readFileSync(p, "utf8").includes("data-i18n");
      });

      if (uebersetzt.length === 0) return; // Übergang gilt noch

      expect(
        ALLOWLIST.includes("js/sprachhinweis.js") || ALLOWLIST.includes("js/echtheit-pruefen.js"),
        `${uebersetzt.join(", ")} ist übersetzt — die Übergangslösungen js/sprachhinweis.js ` +
          "und js/echtheit-pruefen.js und ihre Allowlist-Einträge gehören jetzt entfernt"
      ).toBe(false);
    });

    it("allowlist contains only files that need it (hygiene)", () => {
      const stale = [];
      for (const rel of ALLOWLIST) {
        const abs = path.join(PUBLIC_DIR, rel);
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
