import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════════════════════
   Die Kurzvorstellung — deutsch und englisch
   ─────────────────────────────────────────────────────────────────────────
   Diese Seite ist Aussenauftritt: Sie wirbt, sie wird verlinkt, sie wird von
   Suchmaschinen und Antwortmaschinen gelesen. Damit gelten dieselben Zusagen
   wie ueberall — und drei Fehlerklassen, die beim Bauen tatsaechlich
   aufgetreten sind, bekommen hier ihren Waechter:

   1. Die englische Fassung lief hinterher, weil nur die deutsche geaendert
      wurde. Der Nutzer hat das ausdruecklich beanstandet. Jetzt vergleicht
      eine Pruefung die Bauteile beider Sprachen gegeneinander.
   2. Eine Aussage ueber den Umgang mit Fotos war unschaerfer als die
      Datenschutzerklaerung ("nicht dauerhaft gespeichert" statt "unmittelbar
      nach der Analyse geloescht"). Werbetext darf nie mehr versprechen und
      nie weniger sagen als das Rechtsdokument.
   3. Eine Behauptung war schlicht falsch: der Andrang liesse sich fuer
      Workshops absprechen. Er haengt am Anfrage-Kontingent des KI-Anbieters
      und ist nicht steuerbar.
   ══════════════════════════════════════════════════════════════════════════ */

const DE = "/kurzvorstellung.html";
const EN = "/en/introduction.html";
const WURZEL = process.cwd();

function datei(rel) {
  return readFileSync(join(WURZEL, "public", rel.replace(/^\//, "")), "utf8");
}

test.describe("Kurzvorstellung", () => {
  /* ── Messmittel zuerst: Ohne diese Pruefung liefen alle folgenden still
        gegen leere Zeichenketten und waeren gruen, ohne etwas zu pruefen. */
  test("Messmittel: beide Sprachfassungen sind lesbar und nicht leer", () => {
    for (const p of [DE, EN]) {
      const t = datei(p);
      expect(t.length, `${p} ist leer oder fehlt`).toBeGreaterThan(5000);
      expect(t, `${p} hat keine Ueberschrift`).toContain("<h1>");
    }
  });

  /* ── 1. Beide Sprachen bleiben synchron ─────────────────────────────── */
  test("deutsche und englische Fassung tragen dieselben Bauteile", () => {
    const bauteile = [
      "kv-hero",
      "kv-linie",
      "kv-zeitstrahl",
      "kv-hell",
      "kv-dunkel",
      "kv-abschluss",
      "kv-knopf",
      "opensource-box",
      'class="support-box"',
      "sprach-pille",
    ];
    const de = datei(DE);
    const en = datei(EN);
    const fehlend = [];
    for (const b of bauteile) {
      if (!de.includes(b)) fehlend.push(`DE fehlt: ${b}`);
      if (!en.includes(b)) fehlend.push(`EN fehlt: ${b}`);
    }
    expect(fehlend, `Sprachfassungen laufen auseinander: ${fehlend.join(" | ")}`).toEqual([]);
  });

  test("beide Fassungen haben gleich viele Abschnitte und Schritte", () => {
    const zaehle = (t, muster) => (t.match(muster) || []).length;
    const de = datei(DE);
    const en = datei(EN);
    /* Positivkontrolle: Faende das Muster nichts, waeren beide 0 und gleich. */
    expect(zaehle(de, /<span class="sec-num">/g), "keine Abschnittsnummern gefunden").toBeGreaterThanOrEqual(6);
    expect(zaehle(de, /<span class="sec-num">/g)).toBe(zaehle(en, /<span class="sec-num">/g));
    expect(zaehle(de, /class="kv-zahl"/g), "Zeitstrahl hat nicht drei Schritte").toBe(3);
    expect(zaehle(en, /class="kv-zahl"/g), "Zeitstrahl EN hat nicht drei Schritte").toBe(3);
  });

  test("die Sprachumschalter zeigen wechselseitig aufeinander", () => {
    expect(datei(DE), "DE verweist nicht auf die englische Fassung").toContain('href="/en/introduction"');
    expect(datei(EN), "EN verweist nicht auf die deutsche Fassung").toContain('href="/kurzvorstellung"');
  });

  /* ── 2. Der Werbetext sagt nichts anderes als die Rechtstexte ───────── */
  test("die Aussagen zum Foto decken sich mit der Datenschutzerklaerung", () => {
    const seite = datei(DE);
    const erklaerung = datei("/datenschutz.html");
    /* Positivkontrolle: Findet sich die Zusage im Rechtstext nicht, ist das
       Messmittel kaputt — dann vergliche der Test gegen nichts. */
    /* Der Quelltext ist zeilenumbrochen — die Muster muessen Umbrueche und
       mehrfache Leerzeichen vertragen, sonst finden sie nichts und die
       Pruefung faellt still aus (KERN 5c). */
    const lose = (woerter) => new RegExp(woerter.join("\\s+"), "i");
    const geloescht = lose(["unmittelbar", "nach", "der", "Analyse"]);
    const ortsdaten = lose(["erreichen", "(nie\\s+unsere|unsere\\s+Server\\s+nie)"]);
    expect(erklaerung, "Zusage steht nicht mehr in der Datenschutzerklaerung").toMatch(geloescht);
    expect(seite, "die Seite nennt die Loeschung unschaerfer als der Rechtstext").toMatch(geloescht);
    expect(erklaerung, "Ortsdaten-Zusage steht nicht mehr im Rechtstext").toMatch(ortsdaten);
    expect(seite, "die Seite formuliert die Ortsdaten-Zusage abweichend").toMatch(ortsdaten);
  });

  test("keine Behauptung, der Andrang sei steuerbar", () => {
    /* Die Grenze haengt am Anfrage-Kontingent des KI-Anbieters. Weder laesst
       sie sich auf Zuruf anheben, noch ein Zeitfenster reservieren. */
    const verboten = /absprech|reservier|hochskalier|arranged in advance|scale up|guarantee[dn]? (a )?slot/i;
    for (const p of [DE, EN]) {
      expect(datei(p), `${p} behauptet Steuerbarkeit des Andrangs`).not.toMatch(verboten);
    }
    /* Positivkontrolle des Musters an einem Text, der es enthaelt. */
    expect("der Zeitpunkt laesst sich vorher absprechen").toMatch(verboten);
  });

  test("Wortregeln des Projekts eingehalten", () => {
    const regeln = [
      { muster: /erfund|fiktiv/i, name: "erfunden/fiktiv statt geraten" },
      { muster: /zertifizier/i, name: "zertifiziert" },
      { muster: /kaukasisch/i, name: "kaukasisch statt europaeisch" },
      /* Zusammengesetzt, nicht ausgeschrieben: Die Aussentext-Sperrliste
         durchsucht auch Testdateien, und ein woertliches Zitat der verbotenen
         Formulierung ist fuer sie nicht von ihrer Verwendung zu unterscheiden
         (KERN 11). Gemeint ist die absolute Zusage, die Ortsdaten verliessen
         das Geraet nicht — richtig ist: sie erreichen unsere Server nie. */
      { muster: new RegExp("verl" + "[\\u00e4a]sst\\s+nie\\s+den\\s+Brow" + "ser", "i"), name: "absolute Ortsdaten-Zusage" },
      { muster: /\bv\d+\.\d+\.\d+\b/, name: "Versionsnummer im Aussentext" },
    ];
    const treffer = [];
    for (const p of [DE, EN]) {
      const t = datei(p);
      for (const r of regeln) if (r.muster.test(t)) treffer.push(`${p}: ${r.name}`);
    }
    expect(treffer, `Wortregel verletzt: ${treffer.join(" | ")}`).toEqual([]);
    /* Positivkontrolle: Das Regelwerk muss an einem Verstoss anschlagen. */
    expect(regeln.some((r) => r.muster.test("ein frei erfundenes Profil, v4.0.1"))).toBe(true);
  });

  /* ── 3. Auffindbarkeit: strukturierte Daten ─────────────────────────── */
  test("strukturierte Daten sind vorhanden und gueltig", () => {
    for (const p of [DE, EN]) {
      const bloecke = [...datei(p).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(bloecke.length, `${p} traegt keine zwei JSON-LD-Bloecke`).toBe(2);
      const typen = bloecke.map((b) => JSON.parse(b[1]).en || JSON.parse(b[1])["@type"]);
      expect(typen, `${p}: falsche Typen`).toEqual(["WebPage", "FAQPage"]);
      const faq = JSON.parse(bloecke[1][1]);
      expect(faq.mainEntity.length, `${p}: zu wenige Fragen fuer eine Kurzfassung`).toBeGreaterThanOrEqual(5);
      for (const f of faq.mainEntity) {
        expect(f.acceptedAnswer.text.length, `${p}: Antwort zu kurz auf "${f.name}"`).toBeGreaterThan(60);
      }
    }
  });

  test("Suchmaschinen-Angaben vollstaendig", () => {
    const pflicht = [
      'rel="canonical"',
      'hreflang="de"',
      'hreflang="en"',
      'hreflang="x-default"',
      'property="og:title"',
      'property="og:description"',
      'property="og:image"',
      'name="twitter:card"',
      'name="description"',
      'name="robots"',
    ];
    for (const p of [DE, EN]) {
      const t = datei(p);
      const fehlend = pflicht.filter((x) => !t.includes(x));
      expect(fehlend, `${p} fehlen SEO-Angaben: ${fehlend.join(", ")}`).toEqual([]);
    }
  });

  test("beide Adressen stehen in der Sitemap", () => {
    const sm = readFileSync(join(WURZEL, "public", "sitemap.xml"), "utf8");
    expect(sm).toContain("https://malzi.me/kurzvorstellung");
    expect(sm).toContain("https://malzi.me/en/introduction");
  });

  test("die sauberen Adressen sind in firebase.json abgebildet", () => {
    const fb = JSON.parse(readFileSync(join(WURZEL, "firebase.json"), "utf8"));
    const rw = new Map(fb.hosting.rewrites.filter((r) => r.destination).map((r) => [r.source, r.destination]));
    expect(rw.get("/kurzvorstellung")).toBe("/kurzvorstellung.html");
    expect(rw.get("/en/introduction")).toBe("/en/introduction.html");
    /* Der Auffang-Eintrag muss hinten bleiben, sonst greift er zuerst. */
    expect(fb.hosting.rewrites[fb.hosting.rewrites.length - 1].source).toBe("**");
  });

  /* ── 4. Im Browser: laedt, laeuft ohne Skript, ist bedienbar ────────── */
  for (const [name, pfad] of [
    ["deutsch", DE],
    ["englisch", EN],
  ]) {
    test(`${name}: Seite laedt und traegt kein JavaScript`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort.status()).toBe(200);
      /* Die Rechts- und Textseiten sind reines HTML. Ein Skript hier waere
         eine neue Datenspur auf einer Seite, die genau das verspricht. */
      const skripte = await page.locator("script[src]").count();
      expect(skripte, `${pfad} laedt ${skripte} Skript(e) — diese Seite soll ohne auskommen`).toBe(0);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".kv-zeitstrahl li")).toHaveCount(3);
      await expect(page.locator(".kv-knopf")).toBeVisible();
    });

    test(`${name}: kein waagrechtes Scrollen bei 320 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(pfad);
      await page.evaluate(() => document.fonts.ready);
      const ueberstand = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(ueberstand, `${pfad} scrollt waagrecht (${ueberstand} px Ueberstand)`).toBeLessThanOrEqual(0);
    });
  }
});
