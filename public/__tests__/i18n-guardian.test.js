import { describe, it, expect } from "vitest";
/* Die Zuordnung wird aus dem Frontend GELESEN, nicht hier abgeschrieben.
   Eine zweite Liste waere eine, die driftet. */
import { RECHTSSEITEN } from "../js/i18n.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Jede HTML-Seite unter public/, relativ zu PUBLIC_DIR — auch in
   Unterordnern. Bis 2026-08-18 wurde nur die oberste Ebene durchsucht; die
   englischen Rechtsseiten in public/en/ waeren damit unbeachtet geblieben. */
function alleHtmlSeiten(unter = "") {
  const treffer = [];
  for (const e of fs.readdirSync(path.join(PUBLIC_DIR, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules" || e.name === "fonts") continue;
      treffer.push(...alleHtmlSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push(rel);
    }
  }
  return treffer;
}

/* Die vier Rechtsseiten und ihre englischen Zwillinge. Kanonische Quelle fuer
   die Paarung; firebase.json und die Umschalter-Links muessen dazu passen. */
const RECHTS_PAARE = [
  { de: "impressum.html", en: "en/legal-notice.html", dePfad: "/impressum", enPfad: "/en/legal-notice" },
  { de: "datenschutz.html", en: "en/privacy.html", dePfad: "/datenschutz", enPfad: "/en/privacy" },
  { de: "nutzungsbedingungen.html", en: "en/terms.html", dePfad: "/nutzungsbedingungen", enPfad: "/en/terms" },
  {
    de: "barrierefreiheit.html",
    en: "en/accessibility.html",
    dePfad: "/barrierefreiheit",
    enPfad: "/en/accessibility",
  },
];
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
      /* Rekursiv seit 2026-08-18: Die englischen Seiten liegen in public/en/.
         Eine Suche nur auf der obersten Ebene haette sie nie gesehen. */
      const htmlFiles = alleHtmlSeiten();

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
      /* BEWUSSTE AUSNAHME, kein Übergang mehr (Stand 2026-08-18):
         js/echtheit-pruefen.js rechnet auf der Datenschutzseite nach, ob der
         ausgelieferte Stand dem offenen Quelltext entspricht.

         Warum die Texte hier im Code stehen und nicht in den Sprachdateien:
         Diese Seite lädt KEINE Sprachdatei und ruft keine Schnittstelle auf —
         eine geprüfte Eigenschaft (e2e/sprachumschalter-unterseiten.test.js).
         Sie dafür zu öffnen wäre der schlechtere Tausch: ein Netzweg auf einer
         Rechtsseite, damit ein Wächter zufrieden ist.

         Die Ausnahme ist deshalb nicht folgenlos: Der Test direkt darunter
         verlangt, dass jeder Text HIER in beiden Sprachen vorliegt. Eine
         Ausnahme von der Übersetzung ist es also nicht — nur eine vom Ort.

         js/sprachhinweis.js stand hier bis 2026-08-18. Diese Übergangslösung
         hat ihr Ablaufdatum erreicht und ist gelöscht; der Test darunter hält
         das fest. */
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

    it("die Übergangslösung js/sprachhinweis.js ist fort, samt jeder Einbindung", () => {
      /* Sie trug auf den Rechtsseiten den Hinweis "gibt es nur auf Deutsch".
         Seit die vier englischen Seiten existieren, ist das eine Falschaussage
         — die Datei ist gelöscht und der Umschalter dort ein Link. Dieser Test
         verhindert, dass sie über einen Rückbau wieder hereinkommt. */
      expect(fs.existsSync(path.join(PUBLIC_DIR, "js/sprachhinweis.js"))).toBe(false);
      const einbindungen = alleHtmlSeiten().filter((f) =>
        fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8").includes("sprachhinweis")
      );
      expect(einbindungen).toEqual([]);
    });

    it("die Ausnahme übersetzt trotzdem: jeder Text in echtheit-pruefen.js liegt in DE und EN vor", () => {
      /* Eine Ausnahme von der Sprachdatei ist keine Ausnahme von der
         Übersetzung. Geprüft wird die TEXTE-Tabelle Schlüssel für Schlüssel:
         Was auf Deutsch existiert, muss auf Englisch existieren — und
         umgekehrt. Sonst fällt ein englischer Leser mitten im Ablauf auf
         Deutsch zurück, und niemand merkt es. */
      const code = fs.readFileSync(path.join(PUBLIC_DIR, "js/echtheit-pruefen.js"), "utf8");

      /* Klammern zählen statt Regex über den ganzen Block: Die Werte enthalten
         selbst geschweifte Klammern (Pfeilfunktionen). */
      function block(sprache) {
        const start = code.indexOf(`${sprache}: {`);
        /* Positivkontrolle: Fehlt der Block, ist die Messung blind — dann soll
           der Test scheitern, nicht eine leere Menge vergleichen. */
        expect(start, `Block "${sprache}:" in echtheit-pruefen.js nicht gefunden`).toBeGreaterThan(-1);
        let tiefe = 0;
        let i = code.indexOf("{", start);
        const von = i;
        for (; i < code.length; i++) {
          if (code[i] === "{") tiefe++;
          else if (code[i] === "}" && --tiefe === 0) break;
        }
        return code.slice(von + 1, i);
      }

      function schluessel(text) {
        return [...text.matchAll(/^\s{4}([A-Za-z][\w]*):/gm)].map((m) => m[1]).sort();
      }

      const de = schluessel(block("de"));
      const en = schluessel(block("en"));

      /* Positivkontrolle für die Schlüssel-Erkennung selbst. */
      expect(de.length).toBeGreaterThan(10);

      expect(
        de.filter((k) => !en.includes(k)),
        "nur auf Deutsch vorhanden"
      ).toEqual([]);
      expect(
        en.filter((k) => !de.includes(k)),
        "nur auf Englisch vorhanden"
      ).toEqual([]);
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

  /* ── 5. Rechts-Links: Beschriftung UND Ziel ── */
  describe("Rechts-Links folgen der Sprache", () => {
    /* ANLASS 2026-08-18: Die Fußzeile übersetzte ihre Beschriftung, nicht ihr
       Ziel — auf Englisch stand dort „Privacy Policy" und der Klick landete auf
       der deutschen Seite. Seit es die vier englischen Rechtsseiten gibt, ist
       das kein Schönheitsfehler mehr, sondern ein falscher Verweis.

       Die Mechanik (schaltet der Wechsel wirklich um, in beide Richtungen,
       schon beim ersten Laden) prüft i18n-rechtslinks.test.js. Hier steht die
       andere Hälfte: dass die Zuordnung im Frontend die RICHTIGE ist. */

    /* Bewusst ohne englisches Gegenstück, mit Grund:
       „/"      — die Startseite ist zweisprachig (dieselbe Datei).
       „/stats" — die Zahlen-Seite ebenso, die Sprache reist per `?lang=`.
       Eine Ausnahme mit Begründung ist zulässig, eine stille Lücke nicht. */
    const OHNE_GEGENSTUECK = ["/", "/stats"];

    /* Die Seiten, deren Links zur Laufzeit umgestellt werden — und die
       Sprachdateien, weil in `upload.privacyHint` ebenfalls ein Rechts-Link
       steckt. Rechtsseiten stehen bewusst NICHT in dieser Liste: Sie laden
       keine Sprachdatei und verlinken ihre Gegenstücke fest im HTML. */
    const QUELLEN = ["index.html", "stats.html", "locales/de.json", "locales/en.json"];

    /* Findet `href="/…"` im HTML und `href=\"/…\"` im JSON. Das Fragezeichen
       hinter dem Rückstrich ist der ganze Unterschied zwischen beiden Formen. */
    function interneZiele(text) {
      return [...text.matchAll(/href=\\?"(\/[^"\\?#]*)/g)].map((m) => m[1]);
    }

    it("die Zuordnung im Frontend deckt sich mit der kanonischen Paarliste", () => {
      /* Positivkontrolle: Wären beide Listen leer, vergliche der Test nichts
         mit nichts und bliebe still grün. */
      expect(RECHTS_PAARE.length, "kanonische Paarliste ist leer").toBeGreaterThan(0);

      const ausCode = Object.entries(RECHTSSEITEN)
        .map(([de, en]) => `${de} → ${en}`)
        .sort();
      const kanonisch = RECHTS_PAARE.map((p) => `${p.dePfad} → ${p.enPfad}`).sort();

      expect(ausCode, "js/i18n.js RECHTSSEITEN gegen RECHTS_PAARE").toEqual(kanonisch);
    });

    it("jede verlinkte deutsche Unterseite hat ein Gegenstück in der Zuordnung", () => {
      const fehlen = [];
      const hartEnglisch = [];
      const treffer = {};

      for (const quelle of QUELLEN) {
        const ziele = interneZiele(fs.readFileSync(path.join(PUBLIC_DIR, quelle), "utf8"));
        treffer[quelle] = ziele.length;

        for (const ziel of ziele) {
          if (ziel.startsWith("/en/")) {
            /* Englische Adressen gehören zur Laufzeit gesetzt, nicht fest ins
               HTML: Fest verdrahtet zeigten sie auch dem deutschen Leser die
               englische Seite. */
            hartEnglisch.push(`${quelle}: ${ziel}`);
            continue;
          }
          if (OHNE_GEGENSTUECK.includes(ziel)) continue;
          /* Was eine eigene Seite ist, entscheidet das Dateisystem, keine
             zweite Liste: /impressum → public/impressum.html. Verweise auf
             styles.css, Symbole oder das Manifest fallen damit von selbst raus. */
          if (!fs.existsSync(path.join(PUBLIC_DIR, `${ziel.slice(1)}.html`))) continue;
          if (!(ziel in RECHTSSEITEN)) fehlen.push(`${quelle}: ${ziel}`);
        }
      }

      /* Positivkontrolle je Quelle: Findet die Suche in einer Datei gar nichts,
         ist das Messmittel kaputt — im JSON etwa, wenn die Anführungszeichen
         anders entwertet werden. Ein leeres Ergebnis wäre sonst grün. */
      for (const quelle of QUELLEN) {
        expect(treffer[quelle], `keine internen Links in ${quelle} gefunden`).toBeGreaterThan(0);
      }

      expect(fehlen, "deutsche Unterseite ohne Eintrag in RECHTSSEITEN").toEqual([]);
      expect(hartEnglisch, "englische Adresse fest verdrahtet").toEqual([]);
    });

    it("zu jedem englischen Ziel gibt es eine Datei unter public/en/ und einen Rewrite", () => {
      const ziele = Object.values(RECHTSSEITEN);
      /* Positivkontrolle: Eine leere Zuordnung durchliefe die Schleife unten
         ohne eine einzige Prüfung. */
      expect(ziele.length, "RECHTSSEITEN ist leer").toBeGreaterThan(0);

      const firebase = fs.readFileSync(path.join(PUBLIC_DIR, "..", "firebase.json"), "utf8");
      /* Positivkontrolle für die zweite Messung: Ohne diese Zeile wäre eine
         leere oder falsch gelesene firebase.json nicht von einem fehlenden
         Rewrite zu unterscheiden. */
      expect(firebase, "firebase.json ohne Hosting-Rewrites gelesen").toContain('"rewrites"');

      for (const enPfad of ziele) {
        const datei = `${enPfad.slice(1)}.html`;
        expect(fs.existsSync(path.join(PUBLIC_DIR, datei)), `fehlt: public/${datei}`).toBe(true);
        expect(firebase.includes(`"${enPfad}"`), `kein Rewrite für ${enPfad} in firebase.json`).toBe(true);
      }
    });
  });
});
