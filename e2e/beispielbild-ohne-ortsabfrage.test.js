import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Beispielbild gewaehlt -> der Browser fragt NICHTS bei OpenStreetMap an
 * (PRIV-2026-10-03-38).
 *
 * Die Beispielbilder tragen absichtlich erfundene Ortsdaten, damit die
 * Ergebnis-Seite zeigen kann, was ein Foto verraet (public/img/demo/LICENSE.md).
 * Adresse und Kartenausschnitt dieser drei Orte liefert die Seite selbst mit;
 * weder die Ortsaufloesung (Nominatim) noch ein Kachel-Server wird gefragt.
 * Bei einem eigenen Foto mit Ortsdaten bleibt alles, wie es war.
 *
 * WIE GEZAEHLT WIRD: Jede Anfrage der Seite an einen FREMDEN Rechner wird
 * mitgeschrieben — am Ereignis `request`, das auch dann feuert, wenn eine
 * Attrappe die Anfrage beantwortet. Genau daran ist der Fall vorher
 * vorbeigegangen: Die Browser-Tests fingen den Aufruf an Nominatim ab
 * ("kein externer Call im Test") und beantworteten ihn; gezaehlt hat ihn
 * niemand.
 *
 * Nichts davon geht wirklich ins Netz: Jede fremde Adresse wird hier
 * abgefangen — Nominatim und Kacheln mit einer Attrappe beantwortet, alles
 * andere abgebrochen. Die Analyse selbst ist gestellt (keine KI).
 */

/* Der Testbrowser meldet sonst en-US, und die Seite startet dann englisch. */
test.use({ locale: "de-AT" });

const PROFIL = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.8 },
        interessen: { label: "Interessen", value: "Outdoor", confidence: 0.7 },
      },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: { alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.9 } },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Profil.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 16 Pro" },
  meta: { requestId: "beispiel-1", mode: "multimodal", subject: "HUMAN" },
};

/* Was die Nominatim-Attrappe antwortet. Steht diese Zeile bei einem
   Beispielbild auf dem Bildschirm, kam die Adresse aus einer Abfrage. */
const ADRESSE_AUS_ABFRAGE = "Abfrageweg 7, 4020 Linz, Oberösterreich, Österreich";

/* Ein gueltiges Bild als Kachel (ein Bildpunkt genuegt, siehe e2e/karte.test.js). */
const KACHEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/* Die festen Adressen stehen in den Sprachdateien — der Test liest sie dort,
   statt sie ein zweites Mal aufzuschreiben. */
function sprachdatei(sprache) {
  return JSON.parse(readFileSync(join(process.cwd(), "public", "locales", `${sprache}.json`), "utf8"));
}

/* Ein eigenes Foto mit Ortsdaten. Bewusst die Datei eines Beispielbilds, nur
   ueber die Dateiauswahl hochgeladen: gleiche Koordinaten, anderer Weg. */
const EIGENES_FOTO = join(process.cwd(), "public", "img", "demo", "demo-selfie.jpg");

async function seiteMitZaehler(page) {
  const j = (o) => ({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  await page.route("**/api/stats", (r) =>
    r.fulfill(
      j({
        current: { count: 1, limit: 500, limitActive: false },
        totals: { today: 1, week: 1, month: 1, total: 1 },
      })
    )
  );
  let auftrag = 0;
  await page.route("**/api/enqueue", (r) => r.fulfill(j({ jobId: `beispiel-${++auftrag}`, resultToken: "t" })));
  await page.route("**/api/job-status**", (r) => r.fulfill(j({ status: "done", result: PROFIL })));
  await page.route("**/api/telemetry", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/errors", (r) => r.fulfill({ status: 204, body: "" }));

  /* Alles, was NICHT an die eigene Seite geht: abfangen, damit im Lauf nichts
     das Netz erreicht. */
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.hostname !== "localhost",
    (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "nominatim.openstreetmap.org") return route.fulfill(j({ display_name: ADRESSE_AUS_ABFRAGE }));
      if (host.endsWith("tile.openstreetmap.org")) {
        return route.fulfill({ status: 200, contentType: "image/png", body: KACHEL });
      }
      return route.abort();
    }
  );

  const netz = {
    fremd: [],
    /* Die festen Kartenausschnitte kommen von der eigenen Seite — mitgezaehlt
       nur, um zu sehen, WELCHE Datei geladen wird. */
    kartenbilder: [],
    letzteAnfrage: Date.now(),
    nominatim: () => netz.fremd.filter((u) => new URL(u).hostname === "nominatim.openstreetmap.org"),
    kacheln: () => netz.fremd.filter((u) => new URL(u).hostname.endsWith("tile.openstreetmap.org")),
    leeren: () => {
      netz.fremd.length = 0;
    },
  };
  page.on("request", (anfrage) => {
    netz.letzteAnfrage = Date.now();
    let url;
    try {
      url = new URL(anfrage.url());
    } catch (_fehler) {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return; /* blob: und data: sind keine Netz-Anfragen */
    if (url.hostname === "localhost") {
      if (url.pathname.startsWith("/img/demo/karte-")) netz.kartenbilder.push(url.pathname);
      return;
    }
    netz.fremd.push(anfrage.url());
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#fileInput")).toBeAttached();
  return netz;
}

/* Wartet, bis die Seite eine Weile nichts mehr anfragt. Eine bewegliche Karte
   fordert ihre Kacheln sofort beim Aufbau an — nach dieser Ruhe waeren sie
   gezaehlt. Dass die Wartezeit dafuer reicht, belegt die Positivkontrolle
   unten mit derselben Funktion. */
async function netzRuhe(page, netz, ruheMs = 800) {
  const ende = Date.now() + 10000;
  while (Date.now() < ende && Date.now() - netz.letzteAnfrage < ruheMs) {
    await page.waitForTimeout(100);
  }
}

async function ergebnisMitOrtSteht(page) {
  await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#gpsMap .gps-address")).toBeVisible({ timeout: 20000 });
}

function erwarteKeineOrtsabfrage(netz, wann) {
  expect.soft(netz.nominatim(), `${wann}: Anfrage an nominatim.openstreetmap.org`).toEqual([]);
  expect.soft(netz.kacheln(), `${wann}: Anfrage an einen Kachel-Server`).toEqual([]);
  expect.soft(netz.fremd, `${wann}: Anfrage an einen fremden Rechner`).toEqual([]);
}

/* Die Demonstration bleibt erhalten: fester Kartenausschnitt, Markierung,
   Adresse und Quellenangabe stehen da — ohne bewegliche Karte. */
async function erwarteFesteKarte(page, adresse) {
  await expect(page.locator("#gpsMap .gps-address")).toHaveText(adresse);
  const bild = page.locator("#gpsMap .gps-festkarte img");
  await expect(bild).toBeVisible();
  /* Das Bild ist wirklich geladen — ein kaputter Verweis haette Breite 0. */
  await expect.poll(() => bild.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  expect((await bild.getAttribute("alt")) || "", "das Kartenbild braucht eine Textalternative").not.toBe("");
  await expect(page.locator("#gpsMap .gps-festkarte .gps-zeiger svg")).toBeVisible();
  const quelle = page.locator('#gpsMap .gps-festkarte a[href="https://www.openstreetmap.org/copyright"]');
  await expect(quelle).toBeVisible();
  await expect(quelle).toHaveText(/OpenStreetMap/);
  await expect(quelle).toHaveAttribute("target", "_blank");
  await expect(quelle).toHaveAttribute("rel", /noopener/);
  /* Und KEINE bewegliche Karte daneben. */
  await expect(page.locator("#gpsMapLeaflet")).toHaveCount(0);
  await expect(page.locator("#gpsMap .leaflet-container")).toHaveCount(0);
}

test.describe("Beispielbild: der Browser fragt nichts nach aussen", () => {
  test("Ergebnis, Moduswechsel, Sprachwechsel und Druck: 0 Anfragen an Nominatim und Kachel-Server", async ({
    page,
  }) => {
    test.slow();
    const netz = await seiteMitZaehler(page);
    const de = sprachdatei("de");
    const en = sprachdatei("en");

    await page.click('[data-demo="selfie"]');
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "Ergebnis (serioese Ansicht)");
    await erwarteFesteKarte(page, de["demo.place.selfie"]);

    /* Umschalten zwischen den beiden Ansichten baut den Ortsbereich neu auf. */
    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await expect(page.locator("html")).toHaveAttribute("data-mode", "boost");
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "nach dem Wechsel in die Beast-Ansicht");
    await erwarteFesteKarte(page, de["demo.place.selfie"]);

    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await expect(page.locator("html")).toHaveAttribute("data-mode", "normal");
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "nach dem Wechsel zurueck in die serioese Ansicht");

    /* Drucken: Knopf druecken, Druck-Stilblatt an und wieder aus. */
    await page.locator("#exportPdf").click();
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    await page.waitForTimeout(500);
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "beim Drucken");

    /* Sprachwechsel: Dieselbe Datei wird neu analysiert — ueber denselben Weg,
       den auch ein eigenes Foto nimmt. Sie bleibt trotzdem ein Beispielbild. */
    await page.click('.sprach-knopf[data-lang="en"]');
    const rueckfrage = page.locator('.sw-grund[data-modal="fertig"]');
    await expect(rueckfrage).toBeVisible();
    await rueckfrage.locator(".sw-knopf--wechseln").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#gpsMap .gps-address")).toHaveText(en["demo.place.selfie"], { timeout: 20000 });
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "nach dem Sprachwechsel");
    await erwarteFesteKarte(page, en["demo.place.selfie"]);
  });

  for (const bild of ["selfie", "cafe", "hiker"]) {
    test(`Beispielbild „${bild}“: fester Kartenausschnitt und feste Adresse, 0 Anfragen`, async ({ page }) => {
      const netz = await seiteMitZaehler(page);
      const de = sprachdatei("de");

      await page.click(`[data-demo="${bild}"]`);
      await ergebnisMitOrtSteht(page);
      await netzRuhe(page, netz);
      erwarteKeineOrtsabfrage(netz, `Beispielbild ${bild}`);

      /* POSITIVKONTROLLE der Erwartung: Fehlte der Text in der Sprachdatei,
         verglichen die Zeilen unten "undefined" mit irgendetwas. */
      expect(de[`demo.place.${bild}`], `demo.place.${bild} fehlt in de.json`).toMatch(/Österreich$/);
      await erwarteFesteKarte(page, de[`demo.place.${bild}`]);
      await expect(page.locator("#gpsMap .gps-festkarte img")).toHaveAttribute("src", new RegExp(`karte-${bild}\\.`));
    });
  }
});

test.describe("Fester Kartenausschnitt: geladen wird genau eine Datei", () => {
  /* Jeder Ausschnitt liegt in einfacher und in doppelter Punktdichte vor. Der
     Browser holt die eine, die zum Bildschirm passt — nicht beide. */
  for (const [dichte, datei] of [
    [1, "/img/demo/karte-selfie.webp"],
    [2, "/img/demo/karte-selfie-2x.webp"],
  ]) {
    test.describe(`Bildschirm mit ${dichte}-facher Punktdichte`, () => {
      test.use({ deviceScaleFactor: dichte });

      test(`geladen wird nur ${datei}`, async ({ page }) => {
        const netz = await seiteMitZaehler(page);
        const de = sprachdatei("de");

        await page.click('[data-demo="selfie"]');
        await ergebnisMitOrtSteht(page);
        await erwarteFesteKarte(page, de["demo.place.selfie"]);
        await netzRuhe(page, netz);

        expect([...new Set(netz.kartenbilder)]).toEqual([datei]);
        /* Der Ausschnitt wird unverkleinert gezeigt: 238 Bildpunkte hoch, wie
           die Flaeche innerhalb ihres Randes. */
        const hoehe = await page
          .locator("#gpsMap .gps-festkarte img")
          .evaluate((el) => el.getBoundingClientRect().height);
        expect(hoehe).toBe(238);
        erwarteKeineOrtsabfrage(netz, `Punktdichte ${dichte}`);
      });
    });
  }
});

test.describe("Eigenes Foto mit Ortsdaten: alles wie bisher", () => {
  test("Positivkontrolle: der Zaehler schlaegt an — auch bei denselben Koordinaten wie ein Beispielbild", async ({
    page,
  }) => {
    const netz = await seiteMitZaehler(page);

    await page.setInputFiles("#fileInput", EIGENES_FOTO);
    await ergebnisMitOrtSteht(page);
    await expect(page.locator("#gpsMapLeaflet")).toBeVisible({ timeout: 20000 });
    await netzRuhe(page, netz);

    /* Genau EINE Ortsaufloesung, mit den Koordinaten aus dem Foto. */
    expect(netz.nominatim(), "die Ortsaufloesung wurde nicht angefragt").toHaveLength(1);
    const abfrage = new URL(netz.nominatim()[0]);
    expect(abfrage.searchParams.get("lat")).toMatch(/^48\.2082/);
    expect(abfrage.searchParams.get("lon")).toBe("16.3738");
    /* Und die Kacheln der beweglichen Karte. */
    expect(netz.kacheln().length, "die bewegliche Karte hat keine Kachel angefragt").toBeGreaterThan(0);

    /* Die Adresse kommt aus der Abfrage, nicht aus dem festen Text. */
    await expect(page.locator("#gpsMap .gps-address")).toHaveText(ADRESSE_AUS_ABFRAGE);
    await expect(page.locator("#gpsMap .gps-festkarte")).toHaveCount(0);
  });

  test("das Merkmal klebt nicht: Beispielbild -> eigenes Foto -> Beispielbild", async ({ page }) => {
    test.slow();
    const netz = await seiteMitZaehler(page);
    const de = sprachdatei("de");

    await page.click('[data-demo="selfie"]');
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "erstes Beispielbild");

    /* Jetzt ein eigenes Foto — mit denselben Koordinaten. Es geht den
       normalen Weg: Abfrage und bewegliche Karte. */
    netz.leeren();
    await page.setInputFiles("#fileInput", EIGENES_FOTO);
    await expect(page.locator("#gpsMapLeaflet")).toBeVisible({ timeout: 20000 });
    await netzRuhe(page, netz);
    expect(netz.nominatim(), "eigenes Foto nach einem Beispielbild: keine Ortsaufloesung").toHaveLength(1);
    expect(netz.kacheln().length, "eigenes Foto nach einem Beispielbild: keine Kachel").toBeGreaterThan(0);
    await expect(page.locator("#gpsMap .gps-address")).toHaveText(ADRESSE_AUS_ABFRAGE);
    await expect(page.locator("#gpsMap .gps-festkarte")).toHaveCount(0);

    /* Und zurueck: Das naechste Beispielbild fragt wieder nichts an und zeigt
       weder die Adresse aus der Abfrage noch die bewegliche Karte. */
    netz.leeren();
    await page.click('[data-demo="cafe"]');
    await expect(page.locator("#gpsMap .gps-address")).toHaveText(de["demo.place.cafe"], { timeout: 20000 });
    await ergebnisMitOrtSteht(page);
    await netzRuhe(page, netz);
    erwarteKeineOrtsabfrage(netz, "Beispielbild nach einem eigenen Foto");
    await erwarteFesteKarte(page, de["demo.place.cafe"]);
  });
});
