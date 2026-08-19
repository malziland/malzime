/**
 * i18n-rechtslinks.test.js — Die Rechts-Links zeigen auf die Fassung in der
 * eingestellten Sprache (2026-08-18).
 *
 * ANLASS: Die Fußzeile von Startseite und Zahlen-Seite übersetzte seit v3.3.0
 * ihre BESCHRIFTUNG, nicht ihr ZIEL. Auf Englisch stand dort „Privacy Policy",
 * der Klick landete trotzdem auf der deutschen Seite. Solange es die englischen
 * Rechtsseiten nicht gab, war das nur unschön; seit sie existieren
 * (/en/legal-notice, /en/privacy, /en/terms, /en/accessibility), ist es ein
 * falscher Verweis: Die Beschriftung verspricht etwas, das der Klick nicht
 * hält.
 *
 * Geprüft wird hier die MECHANIK — schaltet der Wechsel die Ziele wirklich um,
 * in beide Richtungen, und stimmen sie schon beim ersten Laden. Ob die
 * Zuordnung selbst die richtige ist, hält i18n-guardian.test.js gegen die
 * kanonische Paarliste RECHTS_PAARE, gegen die Dateien unter public/en/ und
 * gegen die Rewrites in firebase.json.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const MANIFEST = { languages: ["de", "en"], default: "de" };
const TEXTE = {
  de: {
    "footer.impressum": "Impressum",
    "footer.datenschutz": "Datenschutz",
    "footer.nutzungsbedingungen": "Nutzungsbedingungen",
    "footer.barrierefreiheit": "Barrierefreiheit",
    "footer.stats": "Stats",
    "upload.privacyHint": 'Details in der <a href="/datenschutz" target="_blank" rel="noopener">Erklärung</a>.',
  },
  en: {
    "footer.impressum": "Legal Notice",
    "footer.datenschutz": "Privacy Policy",
    "footer.nutzungsbedingungen": "Terms of Use",
    "footer.barrierefreiheit": "Accessibility",
    "footer.stats": "Stats",
    /* Die englische Sprachdatei verweist bewusst ebenfalls auf die DEUTSCHE
       Adresse — genau wie im echten locales/en.json. Der Tausch ist Aufgabe
       des Frontends, nicht der Sprachdatei: sonst gäbe es die Zuordnung ein
       zweites Mal, verteilt über zwei JSON-Dateien. */
    "upload.privacyHint": 'Details in the <a href="/datenschutz" target="_blank" rel="noopener">policy</a>.',
  },
};

function mockeSprachdateien() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const pfad = String(url);
    /* `ok: true` ist Pflicht, nicht Deko: setLanguage bricht bei !res.ok ab
       und meldet false. Ohne dieses Feld schlüge der Wechsel still fehl und
       der Test prüfte die alte Sprache gegen die alte Sprache. */
    if (pfad.includes("manifest.json")) return { ok: true, json: async () => MANIFEST };
    const code = pfad.includes("/en.json") ? "en" : "de";
    return { ok: true, json: async () => TEXTE[code] };
  });
}

/* Die beiden Fußzeilen so nachgebaut, wie sie in public/index.html und
   public/stats.html stehen — inklusive des Unterschieds, auf den es ankommt:
   Die Startseite öffnet einen neuen Tab (`target="_blank"`), die Zahlen-Seite
   bleibt im selben. Eine Umstellung, die nur `target="_blank"` sieht, wäre auf
   der Zahlen-Seite wirkungslos und hier trotzdem grün.

   `data-rechts` trägt den ursprünglichen deutschen Pfad und ist reine
   Prüf-Ausstattung: Nach dem Tausch steht er nirgends mehr im Dokument, und
   ohne ihn wüsste die Prüfung unten nicht, welches Ziel sie erwarten soll. */
function baueFusszeilen() {
  document.body.innerHTML = `
    <p id="hinweis" data-i18n-html="upload.privacyHint"></p>

    <footer id="startseite">
      <a id="s-impressum" data-rechts="/impressum" href="/impressum" target="_blank" rel="noopener"
         data-i18n="footer.impressum">Impressum</a>
      <a id="s-datenschutz" data-rechts="/datenschutz" href="/datenschutz" target="_blank" rel="noopener"
         data-i18n="footer.datenschutz">Datenschutz</a>
      <a id="s-nutzung" data-rechts="/nutzungsbedingungen" href="/nutzungsbedingungen" target="_blank" rel="noopener"
         data-i18n="footer.nutzungsbedingungen">Nutzungsbedingungen</a>
      <a id="s-barrierefreiheit" data-rechts="/barrierefreiheit" href="/barrierefreiheit" target="_blank" rel="noopener"
         data-i18n="footer.barrierefreiheit">Barrierefreiheit</a>
      <a id="s-stats" href="/stats" target="_blank" rel="noopener" data-i18n="footer.stats">Stats</a>
    </footer>

    <footer id="zahlenseite">
      <a id="z-start" href="/" data-i18n="footer.startseite">Startseite</a>
      <a id="z-impressum" data-rechts="/impressum" href="/impressum" data-i18n="footer.impressum">Impressum</a>
      <a id="z-datenschutz" data-rechts="/datenschutz" href="/datenschutz" data-i18n="footer.datenschutz">Datenschutz</a>
      <a id="z-nutzung" data-rechts="/nutzungsbedingungen" href="/nutzungsbedingungen"
         data-i18n="footer.nutzungsbedingungen">Nutzungsbedingungen</a>
      <a id="z-barrierefreiheit" data-rechts="/barrierefreiheit" href="/barrierefreiheit"
         data-i18n="footer.barrierefreiheit">Barrierefreiheit</a>
      <a id="z-stats" href="/stats" data-i18n="footer.stats">Stats</a>
    </footer>
  `;
}

/* Positivkontrolle in Zahlen: Der Aufbau oben enthält acht ausgezeichnete
   Rechts-Links (vier je Fußzeile). Jeder Test unten sichert diese Zahl zu.
   Ohne sie liefe eine Prüfung, die gar keinen Link findet, über eine leere
   Schleife und bliebe still grün — der klassische leere Suchtreffer, gelesen
   als Ergebnis. */
const ANZAHL_RECHTS_LINKS = 8;

function pfadVon(el) {
  return new URL(el.getAttribute("href"), "https://malzi.me").pathname;
}

/**
 * Die eine Zusicherung, die alle Fälle teilen — und die die Rückbauprobe ganz
 * unten bewusst zum Scheitern bringt.
 *
 * Der Rückgabewert ist kein Beiwerk: Jeder Aufrufer sichert ihn ausdrücklich
 * zu. So trägt JEDER Test seine eigene sichtbare Zusicherung, statt sie in
 * einen Helfer auszulagern — ein Test, dessen Behauptung nur woanders steht,
 * sieht von aussen aus wie einer ohne (scripts/pruefungen/checks/test-blind.py
 * meldet ihn zu Recht).
 *
 * @param {object} tabelle deutscher Pfad → englischer Pfad (aus dem Frontend)
 * @param {string} sprache "de" | "en"
 * @returns {number} Anzahl tatsächlich geprüfter Links
 */
function pruefeZiele(tabelle, sprache) {
  const links = Array.from(document.querySelectorAll("a[data-rechts]"));

  for (const a of links) {
    const deutsch = a.dataset.rechts;
    const erwartet = sprache === "en" ? tabelle[deutsch] : deutsch;
    /* Positivkontrolle: Fehlt der Pfad in der Tabelle, ist `erwartet`
       undefined — dann soll der Test scheitern statt gegen nichts zu prüfen. */
    expect(typeof erwartet, `kein Ziel für ${deutsch} in der Zuordnung`).toBe("string");
    expect(pfadVon(a), `#${a.id} auf ${sprache}`).toBe(erwartet);
  }

  return links.length;
}

describe("Rechts-Links folgen der Sprache", () => {
  let i18n;
  let tabelle;

  beforeEach(async () => {
    vi.resetModules();
    mockeSprachdateien();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    /* jsdom meldet als Gerätesprache „en-US". Ohne diese Zeile startete jeder
       Test englisch, und die deutschen Erwartungen prüften nichts. */
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    baueFusszeilen();
    i18n = await import("../js/i18n.js");
    tabelle = i18n.RECHTSSEITEN;
  });

  it("beim ersten Laden auf Deutsch führen alle Rechts-Links auf die deutschen Seiten", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();

    expect(pruefeZiele(tabelle, "de"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
  });

  it("nach dem Wechsel auf Englisch führen sie auf /en/…", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();
    await i18n.setLanguage("en");

    expect(pruefeZiele(tabelle, "en"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
    /* Ein wörtlicher Anker neben der Tabellen-Prüfung: genau der Fall aus dem
       Fehlerbericht („Privacy Policy" führte auf /datenschutz). Er hängt an
       keiner Zuordnung und bliebe auch dann stehen, wenn die Tabelle kippt. */
    expect(document.getElementById("s-datenschutz").getAttribute("href")).toBe("/en/privacy?lang=en");
    expect(document.getElementById("z-datenschutz").getAttribute("href")).toBe("/en/privacy");
  });

  it("und zurück auf Deutsch wieder auf die deutschen Seiten", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();
    await i18n.setLanguage("en");
    await i18n.setLanguage("de");

    expect(pruefeZiele(tabelle, "de"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
    expect(document.getElementById("s-datenschutz").getAttribute("href")).toBe("/datenschutz?lang=de");
  });

  it("beim ERSTEN Laden mit ?lang=en stimmen die Ziele sofort, ohne Klick auf den Umschalter", async () => {
    /* Der Weg, auf dem die Sprache in einen neuen Tab reist (v3.3.1). Wer von
       der englischen Startseite die Zahlen-Seite öffnet und dort auf
       „Privacy Policy" klickt, hat den Umschalter nie berührt. */
    window.history.replaceState({}, "", "/?lang=en");
    await i18n.initI18n();
    i18n.applyTranslations();

    expect(i18n.getLanguage()).toBe("en");
    expect(pruefeZiele(tabelle, "en"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
  });

  it("beim ERSTEN Laden mit englischem Browser ebenso", async () => {
    Object.defineProperty(navigator, "language", { value: "en-GB", configurable: true });
    await i18n.initI18n();
    i18n.applyTranslations();

    expect(i18n.getLanguage()).toBe("en");
    expect(pruefeZiele(tabelle, "en"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
  });

  it("auch der Link INNERHALB des übersetzten Hochlade-Hinweises", async () => {
    /* Der Stolperstein: `data-i18n-html` ersetzt ganze innerHTML-Bereiche und
       wirft dabei zuvor gesetzte Adressen weg. Deshalb steht die Umstellung am
       Ende von applyTranslations(). Ohne diese Reihenfolge zeigte genau dieser
       Link stumm weiter auf die deutsche Seite. */
    await i18n.initI18n();
    await i18n.setLanguage("en");

    const drin = document.querySelector("#hinweis a");
    expect(drin, "Positivkontrolle: Link im Hinweis nicht gefunden").not.toBeNull();
    expect(drin.getAttribute("href")).toBe("/en/privacy?lang=en");
  });

  it("die Zahlen-Seite behält ihr Ziel — sie ist in beiden Sprachen dieselbe Datei", async () => {
    await i18n.initI18n();
    i18n.applyTranslations();
    await i18n.setLanguage("en");

    /* Kein /en/stats: Die Seite ist zweisprachig über `?lang=`. Ein Gegenstück
       zu erfinden hieße, auf eine Adresse zu verweisen, die es nicht gibt. */
    expect(document.getElementById("s-stats").getAttribute("href")).toBe("/stats?lang=en");
    expect(document.getElementById("z-stats").getAttribute("href")).toBe("/stats");
    expect(document.getElementById("z-start").getAttribute("href")).toBe("/");
  });

  it("mehrfaches Anwenden verschiebt nichts", async () => {
    await i18n.initI18n();
    await i18n.setLanguage("en");
    i18n.applyTranslations();
    i18n.applyTranslations();

    expect(pruefeZiele(tabelle, "en"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);
  });

  it("Rückbauprobe: dieselbe Prüfung wird rot, wenn die Adresse deutsch stehen bleibt", async () => {
    /* Ein Test, der nicht scheitern kann, ist keine Prüfung. Hier wird der
       Zustand VOR der Änderung von Hand wiederhergestellt — die feste deutsche
       Adresse im HTML — und belegt, dass genau die Zusicherung von oben ihn
       bemerkt. */
    await i18n.initI18n();
    await i18n.setLanguage("en");
    expect(pruefeZiele(tabelle, "en"), "geprüfte Rechts-Links").toBe(ANZAHL_RECHTS_LINKS);

    document.querySelectorAll("a[data-rechts]").forEach((a) => {
      a.setAttribute("href", a.dataset.rechts);
    });

    expect(() => pruefeZiele(tabelle, "en")).toThrow();
  });
});
