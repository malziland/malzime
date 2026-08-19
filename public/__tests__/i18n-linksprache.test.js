/**
 * i18n-linksprache.test.js — Die Sprache reist in einen neuen Tab mit
 * (v3.3.1).
 *
 * ANLASS: Die Sprachwahl liegt bewusst im `sessionStorage`, also pro Tab —
 * damit ein weitergereichtes Workshop-Gerät wieder in der Gerätesprache
 * startet. Ein mit `target="_blank"` geöffneter Tab bekommt aber einen LEEREN
 * sessionStorage. Von der englischen Startseite führte deshalb JEDER Weg nach
 * draußen zurück in die Gerätesprache: Alle sechs Links der Startseite öffnen
 * einen neuen Tab.
 *
 * Die Lösung braucht weder Speicher noch Schnittstelle — die Sprache steht in
 * der Adresse, und `i18n.js` liest sie beim Start als Erstes (`?lang=` schlägt
 * alles andere).
 *
 * Gemessen am Bestand: 6 interne Links mit `target="_blank"` (alle auf der
 * Startseite), 28 im selben Tab (auf den Unterseiten).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const MANIFEST = { languages: ["de", "en"], default: "de" };
const TEXTE = {
  de: {
    "footer.stats": "Zahlen",
    "upload.privacyHint": 'Details in der <a href="/datenschutz" target="_blank">Erklärung</a>.',
  },
  en: {
    "footer.stats": "Numbers",
    "upload.privacyHint": 'Details in the <a href="/datenschutz" target="_blank">policy</a>.',
  },
};

function mockeSprachdateien() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const pfad = String(url);
    /* `ok: true` ist Pflicht, nicht Deko: setLanguage bricht bei !res.ok ab
       und meldet false. Ohne dieses Feld schlug der Wechsel still fehl und der
       Test prüfte die alte Sprache gegen die alte Sprache. */
    if (pfad.includes("manifest.json")) return { ok: true, json: async () => MANIFEST };
    const code = pfad.includes("/en.json") ? "en" : "de";
    return { ok: true, json: async () => TEXTE[code] };
  });
}

function baueSeite() {
  document.body.innerHTML = `
    <a id="stats" href="/stats" target="_blank" rel="noopener" data-i18n="footer.stats">Zahlen</a>
    <a id="impressum" href="/impressum" target="_blank" rel="noopener">Impressum</a>
    <a id="gleicherTab" href="/datenschutz">Datenschutz</a>
    <a id="extern" href="https://malziland.at" target="_blank" rel="noopener">malziland</a>
    <p id="hinweis" data-i18n-html="upload.privacyHint"></p>
  `;
}

function href(id) {
  return document.getElementById(id).getAttribute("href");
}

describe("Sprache als Übergabewert in der Adresse", () => {
  let i18n;

  beforeEach(async () => {
    vi.resetModules();
    mockeSprachdateien();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    /* jsdom meldet als Gerätesprache „en-US". Ohne diese Zeile startete jeder
       Test englisch, und die deutschen Erwartungen unten prüften nichts —
       schlimmer noch, sie wären grün gewesen, wenn das Stempeln gar nicht
       liefe und die Adresse zufällig schon gestimmt hätte. */
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    baueSeite();
    i18n = await import("../js/i18n.js");
  });

  it("Links in einen neuen Tab tragen die Sprache — auch auf Deutsch", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();

    /* Bewusst BEIDE Sprachen stempeln: Steht das Gerät auf Englisch und jemand
       hat die Seite auf Deutsch gestellt, wäre ein fehlender Wert genauso
       falsch herum wie umgekehrt. */
    expect(href("stats")).toBe("/stats?lang=de");
    expect(href("impressum")).toBe("/impressum?lang=de");
  });

  it("nach dem Wechsel auf Englisch tragen sie en", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();
    await i18n.setLanguage("en");

    /* Die Zahlen-Seite ist in beiden Sprachen dieselbe Datei — hier bleibt nur
       das Anhängsel übrig, um das es diesem Test geht. */
    expect(href("stats")).toBe("/stats?lang=en");
    /* Seit 2026-08-18 wandert beim Impressum ZUSÄTZLICH das Ziel mit: Es gibt
       eine englische Fassung, und eine Fußzeile, die nur ihre Beschriftung
       übersetzt, verspricht etwas, das der Klick nicht hält. Die Umstellung
       selbst prüft i18n-rechtslinks.test.js; hier steht sie, weil das
       Anhängsel den Tausch überleben muss — beides zusammen ergibt die
       Adresse, die am Ende in der Leiste steht. */
    expect(href("impressum")).toBe("/en/imprint?lang=en");
  });

  it("Links im SELBEN Tab bekommen kein Anhängsel", () => {
    /* Dort trägt der sessionStorage die Wahl bereits — ein Anhängsel wäre
       Ballast in der Adressleiste ohne jeden Nutzen.

       „Unangetastet" hiess das hier bis 2026-08-18. Das stimmt seither nur
       noch für das Anhängsel: Das ZIEL wird auch im selben Tab umgestellt,
       sonst wäre die Fußzeile der Zahlen-Seite die einzige, die auf Englisch
       weiter nach Deutschland zeigt. Deutsch bleibt die Ausgangslage dieses
       Tests, deshalb ändert sich an der Adresse hier nichts. */
    i18n.applyTranslations();
    expect(href("gleicherTab")).toBe("/datenschutz");
  });

  it("externe Links werden nicht angefasst", () => {
    i18n.applyTranslations();
    expect(href("extern")).toBe("https://malziland.at");
  });

  it("auch ein Link INNERHALB eines übersetzten Textblocks wird gestempelt", async () => {
    /* Der eigentliche Stolperstein: `data-i18n-html` ersetzt ganze
       innerHTML-Bereiche und wirft dabei zuvor gesetzte Adressen weg. Deshalb
       stempelt applyTranslations() als LETZTES. Ohne diese Reihenfolge wäre
       genau dieser Link stumm falsch. */
    await i18n.initI18n();
    await i18n.setLanguage("en");

    const drin = document.querySelector("#hinweis a");
    expect(drin).not.toBeNull();
    /* Seit 2026-08-18 auch hier: erst das englische Ziel, dann das Anhängsel.
       Die Sprachdatei verweist bewusst weiter auf die deutsche Adresse — die
       Zuordnung steht an genau einer Stelle (js/i18n.js), nicht in zwei
       JSON-Dateien. */
    expect(drin.getAttribute("href")).toBe("/en/privacy?lang=en");
  });

  it("mehrfaches Anwenden hängt nichts an", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();
    i18n.applyTranslations();
    i18n.applyTranslations();

    expect(href("stats")).toBe("/stats?lang=de");
  });

  it("ein vorhandenes anderes Anhängsel bleibt erhalten", () => {
    document.getElementById("stats").setAttribute("href", "/stats?von=fussleiste");
    i18n.applyTranslations();

    const ziel = new URL(href("stats"), "https://malzi.me");
    expect(ziel.searchParams.get("von")).toBe("fussleiste");
    expect(ziel.searchParams.get("lang")).toBe("de");
  });
});
