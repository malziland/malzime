import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* ── Der Kopfbereich: Wortmarke, Sprachumschalter, Überschrift, Tab-Zeichen ──
 *
 * ANLASS: Am 2026-08-19 kam die Wortmarke dazu. Der Nutzer hat dabei DREI
 * Fehler gefunden, die ich zuvor als „geprüft" gemeldet hatte — allen dreien
 * lag derselbe Denkfehler zugrunde: Ich hatte den MECHANISMUS gemessen und
 * nicht die WIRKUNG.
 *
 *   1. „Auf diesen Seiten sehe ich überhaupt kein Logo."
 *   2. „Der Sprachumschalter ist auf der Startseite auf Höhe des Logos, auf
 *       den Unterseiten nicht."
 *   3. „Die Überschrift klebt direkt unter dem Logo." — und das war der
 *       schlimmste: Der Abstand hing an `.seiten-kopfzeile`, die auf der
 *       Startseite erst JavaScript erzeugt. In meinem Browser lief das Skript,
 *       in seinem nicht. Ich maß 66 px und meldete „erledigt", während er
 *       etwas anderes sah.
 *
 * Diese Datei hält alles drei fest — und prüft ausdrücklich auch den Fall OHNE
 * das Skript, weil genau dort der Fehler saß.
 *
 * Basis ist das Arbeitsverzeichnis, nicht `import.meta.url`: Playwright lädt
 * Testdateien nicht als echte ES-Module, `import.meta` wirft dort.
 */

const PUBLIC = join(process.cwd(), "public");

function alleSeiten(unter = "") {
  const treffer = [];
  for (const e of readdirSync(join(PUBLIC, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["__tests__", "node_modules", "fonts", "img", "js", "locales", "lib"].includes(e.name)) continue;
      treffer.push(...alleSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push("/" + rel);
    }
  }
  return treffer.sort();
}

const SEITEN = alleSeiten();

/* Die Zahlen-Seite und die Startseite holen ihr Merkmal von /api/stats. Ohne
   Antwort entsteht der Umschalter nicht — dann prüfte der Test etwas anderes
   als das, was live steht. */
async function merkmalStellen(page) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 6, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 6, week: 26, month: 172, allTime: 5129 },
        useQueue: true,
        sprachumschalter: true,
      }),
    })
  );
}

test.describe("Kopfbereich", () => {
  test("Messmittel: die Seitensuche findet die ausgelieferten Seiten", () => {
    /* Positivkontrolle. Fände sie nichts, liefen die Schleifen unten still
       leer und alles wäre grün, ohne gemessen zu haben. */
    expect(SEITEN.length, `gefunden: ${SEITEN.join(", ")}`).toBeGreaterThanOrEqual(10);
    expect(SEITEN).toContain("/index.html");
    expect(SEITEN).toContain("/en/privacy.html");
  });

  for (const pfad of SEITEN) {
    test(`Wortmarke steht auf ${pfad}`, async ({ page }) => {
      await merkmalStellen(page);
      await page.goto(pfad);
      const marke = page.locator(".wortmarke");
      await expect(marke, "keine Wortmarke — der Nutzer sah hier gar kein Logo").toHaveCount(1);
      await expect(marke).toBeVisible();
      /* Sie muss als EIN Wort lesbar sein: `malzi` und der Kasten stehen ohne
         Leerzeichen nebeneinander, der Abstand kommt aus `gap`. Ein Screenreader
         liest sonst „malzi, M E". */
      expect((await marke.innerText()).replace(/\s+/g, "")).toBe("malziME");
    });
  }

  test("Wortmarke und Sprachumschalter liegen auf gleicher Höhe — auf JEDER Seite", async ({ page }) => {
    await merkmalStellen(page);
    const versatz = [];
    for (const pfad of SEITEN) {
      await page.goto(pfad);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".sprach-pille")).toHaveCount(1);
      const v = await page.evaluate(() => {
        const w = document.querySelector(".wortmarke").getBoundingClientRect();
        const p = document.querySelector(".sprach-pille").getBoundingClientRect();
        return Math.round(p.top + p.height / 2 - (w.top + w.height / 2));
      });
      if (Math.abs(v) > 2) versatz.push(`${pfad}: ${v} px`);
    }
    expect(versatz, "Umschalter nicht auf Logo-Höhe").toEqual([]);
  });

  /* AUSNAHME, bewusst und sichtbar (KERN 12): Die Kurzvorstellung ist eine
     Landeseite mit Verlaufs-Kopf — dort sitzt die Überschrift IM Farbkasten,
     nicht auf der Textkante. Sie kann die gemeinsame Höhe nicht einhalten,
     ohne den Kopf aufzugeben. Die Regel schützt vor Sprüngen beim Wechsel
     zwischen den gleichartigen Text- und Rechtsseiten; eine bewusst anders
     gebaute Landeseite ist kein solcher Fall.
     Die Ausnahme wird bei JEDEM Lauf ausgegeben — eine Ausnahme, die niemand
     mehr sieht, ist nach zwei Monaten der Normalzustand. */
  const HOEHEN_AUSNAHMEN = ["/kurzvorstellung.html", "/en/introduction.html"];

  test("alle Überschriften stehen auf derselben Höhe", async ({ page }) => {
    await merkmalStellen(page);
    console.log(`[kopfbereich] Höhenregel ausgenommen: ${HOEHEN_AUSNAHMEN.join(", ")} (Landeseiten mit Verlaufs-Kopf)`);
    const hoehen = {};
    for (const pfad of SEITEN.filter((p) => !HOEHEN_AUSNAHMEN.includes(p))) {
      await page.goto(pfad);
      await page.evaluate(() => document.fonts.ready);
      /* ANLASS 30.08.2026, durch das erste Fehlerbild der CI geklaert: Die
         Zahlen-Seite fiel wiederholt mit 136 statt 115 auf. Das Bild zeigte
         sie auf ENGLISCH und halb aufgebaut ("NaN Analyses in the last hour").

         Grund: /stats.html ist die EINZIGE Seite, die in beiden Sprachen
         dieselbe Datei ist — sie wird erst nach dem Laden uebersetzt. Alle
         anderen existieren getrennt und stehen sofort richtig. Playwright
         meldet dem Browser Englisch, die Uebersetzung laeuft also immer, und
         sie verschiebt das Layout. `document.fonts.ready` sagt darueber
         nichts.

         Gewartet wird deshalb auf LAYOUT-RUHE: Die Lage der Ueberschrift muss
         ueber zwei aufeinanderfolgende Bilder gleich bleiben. Das faengt jede
         Bewegung ab, gleich wodurch sie ausgeloest wird — und macht den Test
         unabhaengig davon, wie schnell der Laeufer gerade ist.

         Die Zusicherung darunter bleibt unveraendert; korrigiert wird nur der
         Zeitpunkt der Messung. */
      hoehen[pfad] = await page.evaluate(async () => {
        const messen = () => Math.round(document.querySelector("h1").getBoundingClientRect().top);
        const bild = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)));
        let vorher = messen();
        for (let i = 0; i < 40; i += 1) {
          await bild();
          const jetzt = messen();
          if (jetzt === vorher) return jetzt;
          vorher = jetzt;
        }
        return vorher;
      });
    }
    const werte = [...new Set(Object.values(hoehen))];
    /* Positivkontrolle: Wären alle 0, hätte nichts gemessen. */
    expect(werte[0]).toBeGreaterThan(50);
    /* Zweite Positivkontrolle: Eine Ausnahme, die auf eine nicht mehr
       vorhandene Seite zeigt, nimmt still nichts mehr aus — und niemand
       merkt, dass die Liste veraltet ist. */
    for (const a of HOEHEN_AUSNAHMEN) {
      expect(SEITEN, `Ausnahme ${a} zeigt ins Leere — Seite gibt es nicht mehr`).toContain(a);
    }
    /* Und sie darf nicht alles ausnehmen. */
    expect(Object.keys(hoehen).length, "alle Seiten ausgenommen — der Test misst nichts").toBeGreaterThanOrEqual(8);
    expect(werte, `Überschriften auf verschiedenen Höhen: ${JSON.stringify(hoehen)}`).toHaveLength(1);
  });

  test("BUG-2026-08-21-03: die Überschrift bleibt an Ort und Stelle, auch wenn die Zahlen nicht laden", async ({
    page,
  }) => {
    /* Der Fehlerhinweis der Zahlen-Seite stand ZWISCHEN Augenbraue und
       Überschrift und war nur mit `display: none` versteckt. Sobald er erschien
       — also genau dann, wenn die Zahlen nicht luden —, schob er die Überschrift
       um 21 Bildpunkte nach unten: derselbe Sprung, den v3.8.1 schon einmal
       behoben hat, nur diesmal an einen Fehlerfall gekoppelt. In der Pipeline
       fiel er auf, weil dort kein Backend antwortet; wer die Seite bei einer
       Störung öffnet, sah ihn ebenso. */
    await merkmalStellen(page);

    await page.route("**/api/stats", (r) => r.fulfill({ status: 500, body: "kaputt" }));
    await page.goto("/stats.html");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#statsError")).toBeVisible();
    const mitFehler = await page.evaluate(() => Math.round(document.querySelector("h1").getBoundingClientRect().top));

    await page.unroute("**/api/stats");
    await page.goto("/index.html");
    await page.evaluate(() => document.fonts.ready);
    const referenz = await page.evaluate(() => Math.round(document.querySelector("h1").getBoundingClientRect().top));

    expect(mitFehler, `Überschrift springt bei Fehler: ${mitFehler} statt ${referenz}`).toBe(referenz);
  });

  test("der Abstand hält auch OHNE das Umschalter-Skript", async ({ page }) => {
    /* DER FEHLER VOM 2026-08-19. Der Abstand hing an `.seiten-kopfzeile`, die
       auf der Startseite erst js/sprachumschalter.js erzeugt. Lief das Skript
       nicht — blockiert, zu spät, veraltet im Zwischenspeicher —, fiel der
       Abstand weg und die Überschrift rutschte an die Wortmarke.

       Ein Abstand darf nicht davon abhängen, ob ein Skript durchläuft. */
    await merkmalStellen(page);
    await page.goto("/index.html");
    await page.evaluate(() => document.fonts.ready);
    /* WARTEN, nicht sofort zaehlen: Die Kopfzeile entsteht erst, nachdem
       js/sprachumschalter.js das Merkmal von /api/stats gelesen hat. Ein
       sofortiges `count()` traf die Luecke — lokal nie, in der Pipeline sofort.
       (Genau derselbe Fehlertyp, den dieser Test eigentlich pruefen soll: eine
       Aussage ueber etwas, das noch gar nicht da ist.) */
    await expect(page.locator(".seiten-kopfzeile"), "ohne Kopfzeile prüft der Vergleich nichts").toHaveCount(1);
    const mit = await page.evaluate(() => Math.round(document.querySelector("h1").getBoundingClientRect().top));

    const ohne = await page.context().newPage();
    await ohne.route("**/js/sprachumschalter.js*", (r) => r.abort());
    await ohne.goto("/index.html");
    await ohne.evaluate(() => document.fonts.ready);
    /* Hier ist die Abwesenheit die Aussage — kurz warten, damit ein verspaetetes
       Skript den Test nicht faelschlich bestehen laesst. */
    await ohne.waitForTimeout(600);
    await expect(ohne.locator(".seiten-kopfzeile"), "Kopfzeile trotz blockiertem Skript da?").toHaveCount(0);
    const ohneWert = await ohne.evaluate(() => Math.round(document.querySelector("h1").getBoundingClientRect().top));
    await ohne.close();

    expect(ohneWert, `mit Skript ${mit} px, ohne ${ohneWert} px — der Abstand hängt am Skript`).toBe(mit);
  });

  test("das Tab-Zeichen wird im Beast-Modus schwarz und kehrt zurück", async ({ page }) => {
    /* Auch hier hatte ich zuerst nur das Attribut gelesen und „belegt" gemeldet.
       Geprüft wird deshalb, was der Browser tatsächlich laden WÜRDE: die Datei
       über die gesetzte Adresse abrufen und ihre Farben lesen. */
    await merkmalStellen(page);
    await page.goto("/index.html");

    const zeichen = () =>
      page.evaluate(async () => {
        const l = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
        const text = await (await fetch(l.href)).text();
        return { adresse: new URL(l.href).pathname, inhalt: text };
      });

    const vorher = await zeichen();
    expect(vorher.adresse).toBe("/favicon.svg");
    /* Positivkontrolle: Käme kein SVG zurück, sagten die Farbprüfungen nichts. */
    expect(vorher.inhalt).toContain("<svg");

    await page.locator("#biasSwitch").click({ force: true });
    const beast = await zeichen();
    expect(beast.adresse, "das Tab-Zeichen wechselt im Beast-Modus nicht").toBe("/favicon-beast.svg");

    /* UND es darf kein zweites geben. BEFUND 2026-08-19: Die Seite nennt DREI
       Zeichen (ico, svg, 192-px-png). Der Browser sucht sich EINES aus und
       bevorzugt oft das .ico. Solange nur der SVG-Verweis getauscht wurde,
       tauschten wir etwas, das gar nicht angezeigt wird — beim Nutzer blieb der
       Tab unveraendert, in Safari wie in Brave. Im echten Chrome nachgemessen:
       Erst als genau ein Verweis uebrig blieb, holte der Browser
       favicon-beast.svg tatsaechlich (HTTP 200 im Netzwerk-Mitschnitt). */
    const alleImBeast = await page
      .locator("link[rel='icon']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(alleImBeast, "im Beast-Modus darf nur EIN Zeichen angeboten werden").toHaveLength(1);

    /* Und es muss WIRKLICH dunkel sein — nicht nur eine andere Datei. Die erste
       Fassung war ein HELLER Kasten (die Vorlagen-Fassung für dunkle
       Tab-Leisten); auf einer hellen Leiste blieb der Tab dadurch hell, und der
       Nutzer sah keinen Unterschied. */
    const kasten = /\.kasten\s*\{\s*fill:\s*(#[0-9a-f]{6})/i.exec(beast.inhalt);
    expect(kasten, "keine Kastenfarbe in favicon-beast.svg gefunden").not.toBeNull();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(kasten[1].slice(i, i + 2), 16));
    const helligkeit = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    expect(helligkeit, `Beast-Kasten ist zu hell (${kasten[1]}) — im Tab nicht als Wechsel erkennbar`).toBeLessThan(
      0.2
    );

    await page.locator("#biasSwitch").click({ force: true });
    expect((await zeichen()).adresse, "kehrt nach dem Zurückschalten nicht zurück").toBe("/favicon.svg");
    const alleZurueck = await page
      .locator("link[rel='icon']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(alleZurueck.length, "der urspruengliche Satz wird nicht wiederhergestellt").toBeGreaterThan(1);
  });

  test("beide Zeichen haben dieselbe Form — nur andere Farben", () => {
    /* Sonst wäre es nicht dasselbe Logo, sondern ein zweites. */
    const pfad = (d) => /<path class="zeichen" d="([^"]+)"/.exec(readFileSync(join(PUBLIC, d), "utf8"))[1];
    const radius = (d) => /rx="([\d.]+)"/.exec(readFileSync(join(PUBLIC, d), "utf8"))[1];
    expect(pfad("favicon-beast.svg")).toBe(pfad("favicon.svg"));
    expect(radius("favicon-beast.svg")).toBe(radius("favicon.svg"));
    /* Positivkontrolle für die Messung selbst. */
    expect(pfad("favicon.svg").length).toBeGreaterThan(100);
  });
});
