/**
 * texte.test.js — Schreibweise, Zahlformen und Sprache der sichtbaren Texte
 * (UX-2026-10-03-48).
 *
 * Die Texte kommen aus den ECHTEN Sprachdateien. Der Sprach-Wächter
 * (i18n-guardian.test.js) prüft den Gleichstand der Schlüssel, nicht, was
 * drinsteht — deshalb hier: Rechtschreibung, Einzahl und Mehrzahl, dieselbe
 * Schreibweise für Euro-Beträge, Platzhalter in der Sprache der Seite, und
 * dass jede Meldung der Statuszeile einen Sprachwechsel mitmachen kann.
 */
import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDOM } from "./setup.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HIER, "..");
const TEXTE = {
  de: JSON.parse(readFileSync(join(PUBLIC, "locales", "de.json"), "utf8")),
  en: JSON.parse(readFileSync(join(PUBLIC, "locales", "en.json"), "utf8")),
};

const sprache = vi.hoisted(() => ({ jetzt: "de", texte: null }));
sprache.texte = TEXTE;

vi.mock("../js/i18n.js", () => ({
  t: (key, params) => {
    const wert = sprache.texte[sprache.jetzt][key];
    if (wert === undefined) return key;
    if (Array.isArray(wert)) return wert;
    let aus = wert;
    for (const [k, v] of Object.entries(params || {})) aus = aus.replaceAll(`{{${k}}}`, v);
    return aus;
  },
  getLanguage: () => sprache.jetzt,
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

const SCHLUESSEL = ["alter_geschlecht", "einkommen", "gesundheit"];
function profil() {
  const categories = {};
  for (const k of SCHLUESSEL) categories[k] = { label: `L-${k}`, value: `W-${k}`, confidence: 0.8 };
  return { profileText: "Text", categories, ad_targeting: ["a"], manipulation_triggers: ["m"] };
}

describe("Sprachdateien: Schreibweise", () => {
  it("deutsche Texte schreiben Umlaute und ß aus (kein „ue“, „weisst“, „heisst“)", () => {
    const funde = [];
    for (const [schluessel, wert] of Object.entries(TEXTE.de)) {
      const text = Array.isArray(wert) ? wert.join(" ") : String(wert);
      const treffer = text.match(/[A-Za-zäöüß]*(ueb|weiss|heiss)[A-Za-zäöüß]*/g);
      if (treffer) funde.push(`${schluessel}: ${treffer.join(", ")}`);
    }
    expect(funde).toEqual([]);
  });

  it("das Beispielbild heißt in Unterschrift und Bildbeschreibung gleich", () => {
    expect(TEXTE.de["demo.selfie"]).toContain("Stephansplatz");
    expect(TEXTE.de["demo.alt.selfie"]).toContain("Stephansplatz");
    expect(TEXTE.en["demo.selfie"]).toContain("St. Stephen's Square");
    expect(TEXTE.en["demo.alt.selfie"]).toContain("St. Stephen's Square");
  });
});

describe("Texte mit Zahlen", () => {
  beforeEach(() => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  test.each([
    ["de", 1, "Wieder verfügbar in 1 Sekunde"],
    ["de", 2, "Wieder verfügbar in 2 Sekunden"],
    ["de", 59, "Wieder verfügbar in 59 Sekunden"],
    ["de", 599, "Wieder verfügbar in 9:59 Min"],
    ["en", 1, "Available again in 1 second"],
    ["en", 2, "Available again in 2 seconds"],
    ["en", 599, "Available again in 9:59 min"],
  ])("Limit-Hinweis (%s) bei %i s Rest: „%s“", async (lang, sekunden, erwartet) => {
    sprache.jetzt = lang;
    const ui = await import("../js/ui.js");
    const { elements } = await import("../js/dom.js");
    ui.showLimitBanner(sekunden);
    expect(elements.limitCountdown.textContent).toBe(erwartet);
  });

  it("die Zahlen-Seite hat für eine Sekunde Rest einen eigenen Text", () => {
    const quelle = readFileSync(join(PUBLIC, "js", "stats.js"), "utf8");
    expect(quelle).toContain('t("stats.countdownSecond")');
    expect(TEXTE.de["stats.countdownSecond"]).toBe("Wieder verfügbar in 1 Sekunde");
    expect(TEXTE.en["stats.countdownSecond"]).toBe("Available again in 1 second");
  });

  test.each([
    ["en", (betrag) => betrag.startsWith("€")],
    ["de", (betrag) => betrag.endsWith("€")],
  ])("Datenwert (%s): Das Euro-Zeichen steht überall an derselben Stelle", async (lang, richtig) => {
    sprache.jetzt = lang;
    const render = await import("../js/render.js");
    const { elements } = await import("../js/dom.js");
    render.renderCurrentMode({
      profiles: { normal: profil() },
      privacyRisks: [],
      exif: {},
      meta: { mode: "multimodal", subject: "HUMAN" },
    });
    const kopf = elements.dataValue.querySelector(".dv-hero-value").textContent.trim();
    const balken = [...elements.dataValue.querySelectorAll(".dv-bar-val")].map((e) => e.textContent.trim());
    expect(balken.length).toBeGreaterThan(0);
    expect(richtig(kopf), `Betrag oben: ${kopf}`).toBe(true);
    for (const betrag of balken) expect(richtig(betrag), `Betrag in der Aufschlüsselung: ${betrag}`).toBe(true);
  });
});

describe("Noch leere Merkmal-Karten stehen in der Sprache der Seite", () => {
  beforeEach(() => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  test.each([
    ["en", /Being analysed/, /Wird/],
    ["de", /Wird (gerade )?ausgewertet/, /Being analysed/],
  ])("%s", async (lang, erwartet, fremd) => {
    sprache.jetzt = lang;
    const render = await import("../js/render.js");
    const { elements } = await import("../js/dom.js");
    render.zeigeLiveKarten([{ schluessel: "alter_geschlecht", bezeichnung: "L", wert: "W" }]);
    const leere = [...elements.facts.querySelectorAll(".cat-card--unscharf")];
    expect(leere.length).toBe(12);
    for (const karte of leere) {
      expect(karte.querySelector(".cat-label").textContent).toMatch(erwartet);
      expect(karte.querySelector(".cat-value").textContent).toMatch(erwartet);
      expect(karte.textContent).not.toMatch(fremd);
    }
    /* Nach einem Wechsel der Profil-Art werden die Karten wieder zu Platzhaltern — in derselben Sprache. */
    render.liveKartenModusWechsel();
    const alle = [...elements.facts.querySelectorAll(".cat-card")];
    expect(alle.length).toBe(13);
    for (const karte of alle) expect(karte.querySelector(".cat-value").textContent).toMatch(erwartet);
  });
});

describe("Fläche: Jede Meldung der Statuszeile macht einen Sprachwechsel mit", () => {
  /** Zerlegt die Argumente eines Aufrufs auf oberster Klammerebene. */
  function argumente(text) {
    const teile = [];
    let tiefe = 0;
    let anfang = 0;
    for (let i = 0; i < text.length; i += 1) {
      const z = text[i];
      if (z === "(" || z === "[" || z === "{") tiefe += 1;
      else if (z === ")" || z === "]" || z === "}") {
        if (tiefe === 0) {
          teile.push(text.slice(anfang, i).trim());
          return teile;
        }
        tiefe -= 1;
      } else if (z === "," && tiefe === 0) {
        teile.push(text.slice(anfang, i).trim());
        anfang = i + 1;
      }
    }
    return teile;
  }

  it("setStatus(…) mit Text trägt immer den Schlüssel als dritten Wert", () => {
    const dateien = [
      join(PUBLIC, "app.js"),
      ...readdirSync(join(PUBLIC, "js"))
        .filter((n) => n.endsWith(".js"))
        .map((n) => join(PUBLIC, "js", n)),
    ];
    const aufrufe = [];
    const ohneSchluessel = [];
    for (const datei of dateien) {
      const quelle = readFileSync(datei, "utf8");
      for (const treffer of quelle.matchAll(/\bsetStatus\(/g)) {
        const vorher = quelle.slice(Math.max(0, treffer.index - 9), treffer.index);
        if (/function $/.test(vorher)) continue;
        const args = argumente(quelle.slice(treffer.index + "setStatus(".length));
        if (args.length === 1 && args[0] === '""') continue; /* Zeile leeren */
        aufrufe.push(args);
        if (args.length < 3 || !args[2])
          ohneSchluessel.push(`${datei.slice(PUBLIC.length + 1)}: setStatus(${args.join(", ")})`);
      }
    }
    /* Gegenprobe: Die Suche findet die Aufrufe überhaupt. */
    expect(aufrufe.length).toBeGreaterThan(15);
    expect(ohneSchluessel).toEqual([]);
  });

  it("die Abfrage gibt Schlüssel zurück, keine fertigen Texte", () => {
    const quelle = readFileSync(join(PUBLIC, "js", "api.js"), "utf8");
    expect(quelle).not.toMatch(/return \{ error: t\(/);
    expect(quelle.match(/return \{ error: "error\.[A-Za-z]+"/g).length).toBeGreaterThanOrEqual(6);
  });
});
