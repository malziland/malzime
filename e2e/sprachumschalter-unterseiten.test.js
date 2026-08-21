import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * sprachumschalter-unterseiten.test.js — der Sprachwechsel auf den Rechtsseiten.
 *
 * WAS SICH GEAENDERT HAT: Bis zum 18.08.2026 gab es die vier Rechtstexte nur
 * auf Deutsch. `js/sprachhinweis.js` baute dort eine Umschalter-Pille, deren
 * EN-Knopf keinen Wechsel auslöste, sondern einen zweisprachigen Hinweis
 * („Diese Seite gibt es nur auf Deutsch / This page is German only"). Diese
 * Übergangslösung ist weg — die Datei ist gelöscht. Es gibt jetzt vier
 * englische Fassungen, und der Umschalter ist ein reiner Link OHNE JavaScript:
 *
 *   /impressum.html            <->  /en/legal-notice.html
 *   /datenschutz.html          <->  /en/privacy.html
 *   /nutzungsbedingungen.html  <->  /en/terms.html
 *   /barrierefreiheit.html     <->  /en/accessibility.html
 *
 * Ersatzlos gestrichen ist deshalb alles, was den Hinweis-Dialog betraf: seine
 * Fokusfalle, das Schließen mit Escape, die Prüfung auf je eine deutsche und
 * eine englische Zeile. Es gibt keinen Dialog mehr, den man prüfen könnte.
 * Ebenfalls gestrichen ist die „Spur aus dem Tab": Ob die Pille erscheint,
 * entschied früher ein Merkmal, das die Startseite im Tab hinterließ — heute
 * steht sie fest im Markup jeder der acht Seiten.
 *
 * GEBLIEBEN, und wichtiger als vorher, sind die drei Zusicherungen, die diese
 * Seiten still halten. Sie stehen so in der Datenschutzerklärung, sind also
 * keine Geschmacksfrage:
 *   - Sie legen nichts im Browser ab (weder localStorage noch sessionStorage).
 *   - Sie rufen keine Schnittstelle auf. Eine Rechtsseite, die nach Hause
 *     funkt, wäre genau das, was ihr eigener Text ausschließt.
 *   - NEU: Sechs der acht Seiten laden überhaupt kein JavaScript; nur die
 *     beiden Datenschutzseiten laden genau ein Skript, `js/echtheit-pruefen.js`.
 *     Früher hing diese Zusage am bloßen Fehlen eines Umschalter-Skripts,
 *     jetzt wird sie ausdrücklich gemessen — und zwar an dem, was der Browser
 *     WIRKLICH angefordert hat (`page.on("request")`). Der Quelltext beweist
 *     das nicht: Ein Skript kann ein zweites nachladen, und ein `<script>`-Tag
 *     im Quelltext beweist umgekehrt nicht, dass die Datei auch ankam.
 *
 * Ausführen:  npx playwright test e2e/sprachumschalter-unterseiten.test.js
 * Läuft in den Projekten `chromium` und `webkit-sprachumschalter` — WebKit ist
 * die Maschine hinter Safari auf den iPhones, auf denen die Workshops laufen.
 */

/* Die vier Paare. `klar` ist jeweils die Adresse OHNE Endung — genau die, die
   im href des Umschalters steht und die Firebase Hosting per Rewrite auf die
   HTML-Datei abbildet (firebase.json). */
const SEITENPAARE = [
  {
    name: "Impressum",
    de: { datei: "/impressum.html", klar: "/impressum" },
    en: { datei: "/en/legal-notice.html", klar: "/en/legal-notice" },
  },
  {
    name: "Datenschutz",
    de: { datei: "/datenschutz.html", klar: "/datenschutz" },
    en: { datei: "/en/privacy.html", klar: "/en/privacy" },
  },
  {
    name: "Nutzungsbedingungen",
    de: { datei: "/nutzungsbedingungen.html", klar: "/nutzungsbedingungen" },
    en: { datei: "/en/terms.html", klar: "/en/terms" },
  },
  {
    name: "Barrierefreiheit",
    de: { datei: "/barrierefreiheit.html", klar: "/barrierefreiheit" },
    en: { datei: "/en/accessibility.html", klar: "/en/accessibility" },
  },
];

/* Welche Skripte eine Seite laden DARF — vollständig, nicht „mindestens".
   Die Datenschutzseiten tragen den Echtheits-Nachweis (nachrechnen der
   ausgelieferten Prüfsummen im Browser); der braucht ein Skript und ist im
   Text angekündigt. Alle übrigen sechs Seiten sind reines HTML. */
const ERLAUBTE_SKRIPTE = new Map([
  ["/datenschutz.html", ["/js/echtheit-pruefen.js"]],
  ["/en/privacy.html", ["/js/echtheit-pruefen.js"]],
]);

/* Alle acht Seiten flach, für die Prüfungen, die je Seite laufen. */
const ALLE_RECHTSSEITEN = SEITENPAARE.flatMap((p) => [p.de.datei, p.en.datei]);

/* Adresse ohne Endung -> Datei mit Endung, exakt die acht Rewrites aus
   firebase.json. Gebraucht von der Attrappe weiter unten. */
const REWRITES = new Map(
  SEITENPAARE.flatMap((p) => [
    [p.de.klar, p.de.datei],
    [p.en.klar, p.en.datei],
  ])
);

/** Zwei Bildaufbauten abwarten — danach ist alles gelaufen, was beim Laden läuft. */
async function ruhe(page) {
  await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
}

/**
 * Stellt die Hosting-Rewrites nach.
 *
 * WARUM: Der Umschalter verweist auf die sauberen Adressen ohne Endung
 * (`/en/privacy`), weil Firebase Hosting sie auf die HTML-Datei umschreibt.
 * Der Testserver ist ein nackter Dateiserver und kennt diese Regel nicht — ein
 * Klick liefe dort in einen 404, und der Test würde den Testserver messen
 * statt den Umschalter. Die Attrappe bildet genau die acht Regeln aus
 * firebase.json nach und nichts sonst; die Antwort holt sie vom Testserver,
 * nicht von der Festplatte, damit gemessen bleibt, was auch ausgeliefert wird.
 */
async function hostingAdressenNachstellen(page) {
  await page.route(
    (url) => REWRITES.has(url.pathname),
    async (route) => {
      const adresse = new URL(route.request().url());
      const antwort = await route.fetch({ url: adresse.origin + REWRITES.get(adresse.pathname) });
      await route.fulfill({ response: antwort });
    }
  );
}

/**
 * Die Pille auf einer Rechtsseite prüfen.
 *
 * Der Kern: Die Sprache, in der die Seite dasteht, ist KEIN Bedienelement. Sie
 * ist ein `<span>` mit `aria-current="page"` — man kann sie nicht anklicken,
 * weil man dort schon ist, und ein Screenreader sagt „aktuelle Seite" statt
 * einen Link anzubieten. Die andere Sprache ist ein echter `<a href>`.
 */
async function pilleErwarten(page, { aktiv, verweis, ziel, rechts }) {
  const pille = page.locator(".sprach-pille");
  await expect(pille, "genau eine Umschalter-Pille erwartet").toHaveCount(1);
  await expect(pille).toBeVisible();
  await expect(pille.locator(".sprach-knopf"), "genau zwei Sprachen in der Pille").toHaveCount(2);

  /* Der Schieber steht links (DE) oder rechts (EN). Ohne die Klasse `rechts`
     stünde die Markierung auf der englischen Seite unter DE — die Pille würde
     das Gegenteil dessen anzeigen, was man liest. */
  await expect(pille).toHaveClass(rechts ? /\brechts\b/ : /^(?!.*\brechts\b).*$/);

  const aktivEl = pille.locator(`.sprach-knopf.aktiv[data-lang="${aktiv}"]`);
  await expect(aktivEl, `die aktive Sprache ${aktiv.toUpperCase()} fehlt in der Pille`).toHaveCount(1);
  expect(
    await aktivEl.evaluate((el) => el.tagName),
    "die aktive Sprache muss ein <span> sein, kein Link auf die Seite, auf der man steht"
  ).toBe("SPAN");
  await expect(aktivEl).toHaveAttribute("aria-current", "page");
  await expect(aktivEl).toHaveAttribute("lang", aktiv);

  const verweisEl = pille.locator(`.sprach-knopf[data-lang="${verweis}"]`);
  await expect(verweisEl, `der Verweis auf ${verweis.toUpperCase()} fehlt in der Pille`).toHaveCount(1);
  expect(await verweisEl.evaluate((el) => el.tagName), "die andere Sprache muss ein echter Link sein").toBe("A");
  await expect(verweisEl).toHaveAttribute("href", ziel);
  /* BUG-2026-08-17-08: Safari tabbt ohne „Vollzugriff Tastatur" nicht auf
     Bedienelemente ohne ausdrückliches tabindex="0". Gefunden hat das ein
     Nutzer auf der Live-Seite, nicht ein Test — deshalb steht es hier. */
  await expect(verweisEl, 'ohne tabindex="0" ist der Link auf Safari nicht erreichbar').toHaveAttribute(
    "tabindex",
    "0"
  );
  /* Ohne `lang` spricht ein Screenreader „EN" deutsch aus. */
  await expect(verweisEl).toHaveAttribute("lang", verweis);
  expect(
    await verweisEl.evaluate((el) => el.hasAttribute("aria-current")),
    "nur die Seite, auf der man steht, darf aria-current tragen"
  ).toBe(false);

  /* Kein Rest der Übergangslösung: kein Dialog, keine Rückfrage. */
  await expect(page.locator(".sw-grund, .sw-modal"), "es darf keinen Hinweis-Dialog mehr geben").toHaveCount(0);
}

/**
 * Schneidet jeden Aufruf mit, den der Browser stellt.
 *
 * Rückgabe ist absichtlich die LEBENDE Liste — sie füllt sich weiter, solange
 * die Seite läuft. Gemessen wird der Pfad ohne Abfrageteil, damit der
 * Cache-Buster (`?v=…`) die Erwartung nicht bei jedem Deploy umwirft.
 */
function aufrufeMitschneiden(page) {
  const alle = [];
  page.on("request", (r) => alle.push(new URL(r.url()).pathname));
  return alle;
}

/* TEST-2026-08-20-17: Alle Riegel dieser Datei hingen an der festen Liste
   SEITENPAARE — dem Stand vom 19.08., nicht dem Repository. Eine neue Rechtsseite
   koennte unbemerkt Skripte laden oder einen per Tastatur unerreichbaren
   Umschalter tragen, ohne dass irgendeine Pruefung anspringt: Sie stuende
   schlicht nicht auf der Liste. Diese Kontrolle haelt das Dateisystem gegen die
   Liste, damit die Luecke nicht still entsteht. */
test.describe("Rechtsseiten: die Liste deckt die Flaeche", () => {
  /* index und stats sind keine Rechtsseiten: die Startseite traegt die Analyse,
     die Zahlen-Seite ist dynamisch zweisprachig und in eigenen Tests abgedeckt. */
  const KEINE_RECHTSSEITEN = new Set(["index.html", "stats.html"]);

  test("jede HTML-Seite in public/ und public/en/ steht in SEITENPAARE", () => {
    const wurzel = join(process.cwd(), "public");
    const gefunden = [
      ...readdirSync(wurzel)
        .filter((n) => n.endsWith(".html") && !KEINE_RECHTSSEITEN.has(n))
        .map((n) => `/${n}`),
      ...readdirSync(join(wurzel, "en"))
        .filter((n) => n.endsWith(".html"))
        .map((n) => `/en/${n}`),
    ].sort();

    /* Positivkontrolle gegen die eigene Messung: Findet die Suche gar nichts,
       waere "keine fehlende Seite" kein Ergebnis, sondern ein leeres Blatt. */
    expect(gefunden.length, "keine einzige Rechtsseite gefunden — die Suche greift nicht").toBeGreaterThan(4);

    const fehlend = gefunden.filter((datei) => !ALLE_RECHTSSEITEN.includes(datei));
    expect(
      fehlend,
      `Diese Seiten werden ausgeliefert, stehen aber in keiner Pruefung dieser Datei: ${fehlend.join(", ")}`
    ).toEqual([]);

    /* Und umgekehrt: Eine Seite auf der Liste, die es nicht mehr gibt, bedeutet
       Pruefungen, die ins Leere laufen. */
    const verwaist = ALLE_RECHTSSEITEN.filter((datei) => !gefunden.includes(datei));
    expect(verwaist, `Diese Seiten stehen auf der Liste, existieren aber nicht mehr: ${verwaist.join(", ")}`).toEqual(
      []
    );
  });
});

test.describe("Rechtsseiten: der Umschalter ist ein Link, kein Skript", () => {
  /* Bewusst mit englischem Browser gemessen: Diese Seiten sind statisch und
     dürfen sich von der Browsersprache NICHT umstimmen lassen. Eine deutsche
     Seite, die sich als englisch ausgibt, weil der Browser Englisch spricht,
     wäre gelogen. */
  test.use({ locale: "en-US" });

  for (const paar of SEITENPAARE) {
    test(`${paar.de.datei}: Pille steht auf DE, EN verweist auf ${paar.en.klar}`, async ({ page }) => {
      await page.goto(paar.de.datei);
      await ruhe(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      await pilleErwarten(page, { aktiv: "de", verweis: "en", ziel: paar.en.klar, rechts: false });
    });

    test(`${paar.en.datei}: Pille steht auf EN, DE verweist auf ${paar.de.klar}`, async ({ page }) => {
      await page.goto(paar.en.datei);
      await ruhe(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await pilleErwarten(page, { aktiv: "en", verweis: "de", ziel: paar.de.klar, rechts: true });
    });

    test(`${paar.name}: der Wechsel geschieht wirklich — hin und zurück`, async ({ page }) => {
      /* Dass ein href dasteht, ist noch kein Wechsel. Geprüft wird der ganze
         Weg: klicken, ankommen, und von dort zurückfinden. Wer im Workshop auf
         EN klickt, muss englisch lesen — nicht gefragt werden, ob er das
         wirklich will. */
      await hostingAdressenNachstellen(page);
      await page.goto(paar.de.datei);

      const nachEnglisch = page.locator('.sprach-knopf[data-lang="en"]');
      await expect(nachEnglisch, "ohne EN-Verweis gibt es nichts zu klicken").toHaveCount(1);
      await nachEnglisch.click();

      await expect(page).toHaveURL(new RegExp(`${paar.en.klar}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await pilleErwarten(page, { aktiv: "en", verweis: "de", ziel: paar.de.klar, rechts: true });

      const zurueckDeutsch = page.locator('.sprach-knopf[data-lang="de"]');
      await expect(zurueckDeutsch, "ohne DE-Verweis gibt es keinen Rückweg").toHaveCount(1);
      await zurueckDeutsch.click();

      await expect(page).toHaveURL(new RegExp(`${paar.de.klar}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      await pilleErwarten(page, { aktiv: "de", verweis: "en", ziel: paar.en.klar, rechts: false });
    });
  }

  for (const seite of ALLE_RECHTSSEITEN) {
    test(`${seite}: legt nichts im Browser ab und ruft keine Schnittstelle`, async ({ page }) => {
      /* Zwei Zusagen aus der Datenschutzerklärung in einem Seitenaufbau:
         nichts im Browser ablegen, nichts nach außen rufen. Bis v3.3.0 stand
         hier `malzime-umschalter-aktiv` im localStorage — genau der Fund, der
         zur Streichung der Erprobungs-Tür geführt hat. */
      const alle = aufrufeMitschneiden(page);
      await page.goto(seite);
      await ruhe(page);

      /* POSITIVKONTROLLE 1: Ist die Seite überhaupt angekommen? Auf einer
         404-Seite wäre der Speicher auch leer — still grün, nichts geprüft. */
      await expect(page.locator(".sprach-pille"), "Seite nicht geladen — die Prüfung liefe ins Leere").toHaveCount(1);
      /* POSITIVKONTROLLE 2: Hört der Mitschnitt überhaupt etwas? */
      expect(alle.length, "kein einziger Aufruf mitgeschnitten — der Mitschnitt ist blind").toBeGreaterThan(0);

      const schnittstellen = alle.filter((p) => p.startsWith("/api/"));
      expect(schnittstellen, "eine Rechtsseite darf keine Schnittstelle aufrufen").toEqual([]);

      const speicher = await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      }));
      expect(speicher.local, "localStorage muss leer bleiben").toEqual([]);
      expect(speicher.session, "sessionStorage muss leer bleiben").toEqual([]);
    });

    test(`${seite}: lädt genau die zugesagten Skripte`, async ({ page }) => {
      /* Gemessen an den ANGEFORDERTEN Dateien, nicht am Quelltext. Ein
         <script>-Tag im Quelltext beweist nicht, dass die Datei ankam, und ein
         geladenes Skript kann ein zweites nachziehen, das im Quelltext nirgends
         steht. Die Zusage lautet: hier läuft nichts außer dem, was
         danebensteht. */
      const alle = aufrufeMitschneiden(page);
      await page.goto(seite);
      await ruhe(page);

      await expect(page.locator(".sprach-pille"), "Seite nicht geladen — die Messung liefe ins Leere").toHaveCount(1);
      /* POSITIVKONTROLLE: Jede dieser Seiten lädt styles.css. Sehen wir kein
         Stylesheet, hat der Mitschnitt nichts gehört — dann wäre auch ein
         heimlich geladenes Skript unsichtbar geblieben. */
      expect(
        alle.filter((p) => p.endsWith(".css")).length,
        "kein Stylesheet mitgeschnitten — der Mitschnitt würde auch ein Skript übersehen"
      ).toBeGreaterThan(0);

      const skripte = alle.filter((p) => p.endsWith(".js")).sort();
      expect(skripte, `unerwartetes JavaScript auf ${seite}`).toEqual(ERLAUBTE_SKRIPTE.get(seite) ?? []);
    });
  }

  test("Gegenprobe: die Skript-Messung zeigt geladene Skripte wirklich an", async ({ page }) => {
    /* Ohne diese Gegenprobe wäre die Zusage oben wertlos: Ein Filter, der
       nichts findet, weil er falsch gebaut ist, meldet dasselbe wie eine Seite
       ohne JavaScript. /stats.html lädt nachweislich Skripte — findet die
       Messung dort keins, misst sie nichts. */
    await page.route("**/api/stats", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ current: { count: 1, limit: 500, limitActive: false } }),
      })
    );
    const alle = aufrufeMitschneiden(page);
    await page.goto("/stats.html");
    await ruhe(page);
    const skripte = alle.filter((p) => p.endsWith(".js"));
    expect(skripte.length, "die Messmethode findet nicht einmal auf /stats.html ein Skript").toBeGreaterThan(0);
  });

  test("/datenschutz.html: EN ist ertastbar und mit Enter auslösbar", async ({ page }) => {
    /* BUG-2026-08-17-08, gefunden von einem Nutzer auf der Live-Seite: Safari
       springt ohne „Vollzugriff Tastatur" nicht auf Bedienelemente, denen ein
       ausdrückliches tabindex="0" fehlt. Geprüft wird hier beides — dass der
       Fokus ankommt und dass Enter denselben Weg geht wie ein Klick. */
    await hostingAdressenNachstellen(page);
    await page.goto("/datenschutz.html");

    let erreicht = false;
    let schritte = 0;
    for (; schritte < 12 && !erreicht; schritte++) {
      await page.keyboard.press("Tab");
      erreicht = await page.evaluate(() => document.activeElement?.matches('a.sprach-knopf[data-lang="en"]') === true);
    }
    expect(erreicht, "EN-Link nach 12 Tab-Schritten nicht erreicht").toBe(true);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("/en/privacy.html: DE ist ertastbar und mit Enter auslösbar", async ({ page }) => {
    /* Der Rückweg zählt genauso: Wer per Tastatur nach Englisch kommt, muss
       per Tastatur auch wieder heraus. */
    await hostingAdressenNachstellen(page);
    await page.goto("/en/privacy.html");

    let erreicht = false;
    for (let i = 0; i < 12 && !erreicht; i++) {
      await page.keyboard.press("Tab");
      erreicht = await page.evaluate(() => document.activeElement?.matches('a.sprach-knopf[data-lang="de"]') === true);
    }
    expect(erreicht, "DE-Link nach 12 Tab-Schritten nicht erreicht").toBe(true);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/datenschutz$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });

  /* TEST-2026-08-20-14/46: Hier standen zwei Seiten, mit der Begründung, was dort
     durchgehe, gelte auch für die übrigen sechs, "die weniger enthalten". Das war
     eine Annahme, keine Messung — die öffentliche Zusage "0 Verstöße" in
     Prüfbericht und Erklärung gilt für ALLE acht Rechtsseiten, und sie konnte für
     sechs davon still falsch werden, ohne dass ein Riegel rot wird. Jede Seite
     bringt eigene Inhalte mit (Tabellen, rollbare Kästen, Fußnoten), und der
     Kontrast hängt am Inhalt, nicht am Gerüst. */
  for (const seite of [
    "/datenschutz.html",
    "/impressum.html",
    "/nutzungsbedingungen.html",
    "/barrierefreiheit.html",
    "/en/privacy.html",
    "/en/legal-notice.html",
    "/en/terms.html",
    "/en/accessibility.html",
  ]) {
    test(`axe: ${seite} ohne ernste Verstöße`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(seite);
      await expect(page.locator(".sprach-pille"), "Seite nicht geladen — axe prüfte eine Fehlerseite").toHaveCount(1);
      await page.evaluate(() =>
        Promise.race([
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
          new Promise((f) => setTimeout(f, 1000)),
        ])
      );
      const ergebnis = await new AxeBuilder({ page }).analyze();
      /* POSITIVKONTROLLE: axe muss überhaupt etwas geprüft haben. Ein Lauf
         ohne bestandene Regeln bedeutet, dass axe gar nicht lief. */
      expect(ergebnis.passes.length, "axe hat keine einzige Regel geprüft").toBeGreaterThan(0);
      const ernst = ergebnis.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        ernst.map((v) => ({ regel: v.id, elemente: v.nodes.map((n) => n.target.join(" ")) })),
        `Ernste A11y-Verstöße auf ${seite}`
      ).toEqual([]);
    });
  }
});

test.describe("Zahlen-Seite: echter Wechsel im laufenden Betrieb", () => {
  /* Sonst startet der Testbrowser (en-US) die Seite bereits englisch und die
     Richtung des Wechsels stimmt nicht mehr. */
  test.use({ locale: "de-AT" });

  test("stats.html schaltet wirklich um, ohne Rückfrage", async ({ page }) => {
    /* Die Statistik-Seite ist der EINE Ort, an dem der Umschalter weiterhin
       Programm ist (js/sprachumschalter.js): Sie ist übersetzt, also wird dort
       der Text getauscht statt die Adresse. Die Rechtsseiten oben gehen den
       anderen Weg — eigene Datei je Sprache, bloßer Link. Beide Wege stehen
       nebeneinander, deshalb steht diese Prüfung in derselben Datei.

       Ob der Umschalter überhaupt entsteht, entscheidet allein das
       Merkmals-Schloss, das stats.js aus /api/stats liest. Der Testserver
       liefert die Schnittstelle nicht, also wird sie hier gestellt. */
    await page.route("**/api/stats", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
          totals: { today: 10, week: 50, month: 200, total: 1000 },
          useQueue: true,
          sprachumschalter: true,
        }),
      })
    );
    await page.goto("/stats.html");
    await expect(page.locator(".sprach-pille")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Zahlen");

    await page.click('.sprach-knopf[data-lang="en"]');
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toContainText("numbers");
    /* Hier steht nichts auf dem Spiel — es darf keine Rückfrage kommen. */
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
  });
});
