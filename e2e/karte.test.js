import { test, expect } from "@playwright/test";

/* Die GPS-Karte — geprueft an ihrer Wirkung, nicht an ihren Einstellungen.
 *
 * ANLASS 2026-08-19: Sieben Befunde auf einmal, gefunden durch schlichtes
 * Hinsehen auf zwei Bildschirmgroessen. Die schlimmsten waren am Handy
 * sichtbar: Die Sprechblase lief ueber den Kartenrand hinaus, und die
 * Zoom-Tasten schnitten ihren Text ab — aus "Your location" wurde
 * "ur location". Dazu kaperte die Karte das Scrollen der Seite und zeichnete
 * ueber die geklebte Umschalt-Leiste.
 *
 * Jede Pruefung hier misst, was ein Mensch merken wuerde.
 */

const PROFIL = {
  profiles: {
    normal: {
      categories: { alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.8 } },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: { alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30", confidence: 0.9 } },
      ad_targeting: ["Premium"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "karte-1", mode: "multimodal", subject: "HUMAN" },
};

const ADRESSE = "Bergstraße 12, 4501 Neuhofen an der Krems, Oberösterreich, Österreich";

async function seiteMitKarte(page) {
  const j = (o) => ({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  await page.route("**/api/stats", (r) =>
    r.fulfill(
      j({
        current: { count: 1, limit: 500, limitActive: false },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
        sprachumschalter: true,
      })
    )
  );
  await page.route("**/api/enqueue", (r) => r.fulfill(j({ jobId: "k", resultToken: "t" })));
  await page.route("**/api/job-status**", (r) => r.fulfill(j({ status: "done", result: PROFIL })));
  await page.route("**/nominatim.openstreetmap.org/**", (r) => r.fulfill(j({ display_name: ADRESSE })));
  /* Kacheln nicht von OpenStreetMap holen (kein Netz im Lauf, keine Last dort),
     aber ein GUELTIGES Bild liefern. Ein leerer Koerper war der erste Versuch —
     dann rendert der Browser gar keine Kachel, und die Stapel-Pruefung weiter
     unten misst an einer Stelle, an der es nichts zu stapeln gibt. Sie war
     dadurch gruen, auch wenn die Behebung ausgebaut war (Rueckbauprobe
     2026-08-19). Ein Bildpunkt genuegt: Leaflet gibt jeder Kachel per Stilblatt
     256 x 256. */
  const KACHEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  await page.route("**/tile.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: KACHEL })
  );
  await page.goto("/");
  await page.waitForTimeout(600);
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#gpsMapLeaflet")).toBeVisible({ timeout: 40000 });
}

test.describe("GPS-Karte", () => {
  test.setTimeout(90000);

  test("der Ort steht als Zeile da und wird von nichts verdeckt", async ({ page }) => {
    await seiteMitKarte(page);

    /* Die Adresse ist normaler Text — lesbar, kopierbar, im Ausdruck dabei. */
    await expect(page.locator(".gps-address")).toHaveText(ADRESSE);

    /* Und es gibt KEINE Sprechblase mehr. Genau die hat am Handy den halben
       Kartenausschnitt verdeckt und ihren eigenen Text abgeschnitten. */
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  });

  test("BUG-2026-08-20-06: die Adresse ueberlebt den Moduswechsel", async ({ page }) => {
    /* OPS-2026-08-21-08: Der Wartewert von 40 s weiter unten war wirkungslos —
       das Zeitlimit des Tests liegt bei 30 s und greift vorher. Die Karte baut
       sich nach dem Moduswechsel neu auf, das dauert unter Last. `test.slow()`
       verdreifacht das Limit; geprueft wird unveraendert dasselbe. */
    test.slow();
    /* Der erste Aufbau verbrauchte das Geocoding-Versprechen und setzte es auf
       null. Beim zweiten Aufbau — jedem Moduswechsel und jedem Ausdruck — stand
       deshalb nur noch das Koordinatenpaar da. Der Ort, den die Karte zeigen
       soll, war genau ab dem ersten Umschalten weg. */
    await seiteMitKarte(page);
    await expect(page.locator(".gps-address")).toHaveText(ADRESSE);

    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await expect(page.locator("html")).toHaveAttribute("data-mode", "boost");
    await expect(page.locator("#gpsMapLeaflet")).toBeVisible({ timeout: 40000 });
    await expect(
      page.locator(".gps-address"),
      "nach dem Moduswechsel steht dort das Koordinatenpaar statt der Adresse"
    ).toHaveText(ADRESSE);

    /* Und zurueck: auch der dritte Aufbau muss die Adresse behalten. */
    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await expect(page.locator("html")).toHaveAttribute("data-mode", "normal");
    await expect(page.locator(".gps-address")).toHaveText(ADRESSE);
  });

  test("die Quellenangabe verweist auf die Lizenzseite", async ({ page }) => {
    /* Die OSM-Lizenz verlangt eine Nennung MIT Verweis. Bis v3.8.1 stand dort
       nur unverlinkter Text. */
    await seiteMitKarte(page);
    const verweis = page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]');
    await expect(verweis).toHaveCount(1);
    await expect(verweis).toHaveText(/OpenStreetMap/);
  });

  test("beide Verweise in der Karte oeffnen einen neuen Tab", async ({ page }) => {
    /* ANLASS 2026-08-19, vom Nutzer gefunden: "Der Link auf die
       OpenStreetMap-Verlinkung oeffnet sich im selben Tab. Das muss ein neuer
       Tab sein. Ich kann nicht meine eigene Seite ueberschreiben." Er hat
       recht — ein Klick daneben haette das fertige Profil weggeworfen.
       Betrifft BEIDE Verweise: die Quellenangabe und den Leaflet-Hinweis. */
    await seiteMitKarte(page);

    const verweise = page.locator(".leaflet-control-attribution a");
    /* POSITIVKONTROLLE: Ohne Verweise waere jede Aussage darueber wertlos. */
    await expect(verweise).toHaveCount(2);

    const befund = await verweise.evaluateAll((els) =>
      els.map((el) => ({
        ziel: el.getAttribute("href"),
        tab: el.getAttribute("target"),
        schutz: el.getAttribute("rel"),
      }))
    );
    for (const v of befund) {
      expect(v.tab, `${v.ziel} oeffnet im selben Tab`).toBe("_blank");
      expect(v.schutz || "", `${v.ziel} ohne noopener`).toContain("noopener");
    }
  });

  test("der Ortszeiger ist unserer, nicht Leaflets Standard-Blau", async ({ page }) => {
    await seiteMitKarte(page);
    await expect(page.locator(".gps-zeiger svg")).toHaveCount(1);
    /* POSITIVKONTROLLE: Leaflets Standardzeiger ist ein <img> mit marker-icon.png.
       Bliebe der uebrig, waere oben trotzdem alles gruen. */
    await expect(page.locator('.leaflet-marker-icon[src*="marker-icon"]')).toHaveCount(0);
    const farbe = await page.locator(".gps-zeiger svg path").getAttribute("fill");
    expect(farbe?.toLowerCase()).toBe("#9c4e36");
  });

  test("das Mausrad ueber der Karte scrollt die Seite, statt zu zoomen", async ({ page }) => {
    await seiteMitKarte(page);
    const karte = page.locator("#gpsMapLeaflet");
    await karte.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    const mitte = await karte.boundingBox();
    const vorher = {
      seite: await page.evaluate(() => Math.round(window.scrollY)),
      stufe: await page.evaluate(() => window.__karteStufe ?? null),
    };
    await page.mouse.move(mitte.x + mitte.width / 2, mitte.y + mitte.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);

    const nachher = await page.evaluate(() => Math.round(window.scrollY));
    expect(nachher, "die Karte hat das Scrollen der Seite gekapert").toBeGreaterThan(vorher.seite);
    void vorher.stufe;
  });

  test("die geklebte Umschalt-Leiste liegt ueber der Karte, nicht darunter", async ({ page }) => {
    /* Leaflets Bedienelemente liegen auf Ebene 800 und brachen ohne eigenen
       Stapel-Kontext aus dem Kartenrahmen aus — sie zeichneten dann ueber die
       geklebte Leiste (Ebene 20).
       WO GEMESSEN WIRD, ENTSCHEIDET ALLES: Die erste Fassung dieser Pruefung
       tastete nur die Mitte der Leiste ab, waehrend der OBERE Kartenrand
       dahinterstand. Dort tritt der Fehler nicht auf — die Pruefung war gruen,
       auch wenn die Behebung ausgebaut war. Es trifft die Quellenangabe unten
       RECHTS: also den UNTEREN Kartenrand hinter die Leiste schieben und die
       ganze Breite abtasten. */
    await seiteMitKarte(page);

    const k = await page.locator("#gpsMapLeaflet").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { oben: r.top + window.scrollY, hoehe: r.height };
    });

    /* Den UNTEREN Kartenrand durch die Leiste WANDERN lassen, statt auf eine
       einzige Stellung zu zielen. Der Fehler zeigt sich nur in einem schmalen
       Fenster, und wo genau das liegt, haengt von Fensterbreite und
       Leistenhoehe ab. Eine feste Stellung war zweimal gruen, obwohl die
       Behebung ausgebaut war. */
    await expect(page.locator(".bias-toggle-wrap")).toHaveClass(/is-stuck/);
    const treffer = [];
    let ueberlappt = false;
    for (const rest of [10, 25, 40, 55, 70, 85]) {
      await page.evaluate((t) => window.scrollTo({ top: t, behavior: "instant" }), k.oben + k.hoehe - rest);
      await page.waitForTimeout(350);
      const runde = await page.evaluate(() => {
        const l = document.querySelector(".bias-toggle-wrap").getBoundingClientRect();
        const karte = document.getElementById("gpsMapLeaflet").getBoundingClientRect();
        const raus = [];
        for (let i = 0; i <= 8; i++) {
          const x = Math.min(l.x + (l.width * i) / 8, l.right - 1);
          for (const y of [l.top + 3, l.bottom - 3]) {
            const el = document.elementFromPoint(x, y);
            if (el?.closest("#gpsMapLeaflet")) raus.push(`${Math.round(x)},${Math.round(y)}`);
          }
        }
        return { raus, ueberlappt: karte.top < l.bottom && karte.bottom > l.top };
      });
      treffer.push(...runde.raus.map((t) => `Rest ${rest}px @ ${t}`));
      ueberlappt = ueberlappt || runde.ueberlappt;
    }

    /* POSITIVKONTROLLE: Ohne Ueberlappung waere jede Aussage ueber "wer liegt
       oben" ein perfektes Ergebnis fuer nichts. */
    expect(ueberlappt, "Karte und Leiste ueberlappen in keiner Stellung").toBe(true);
    expect(treffer, "die Karte zeichnet ueber die geklebte Leiste").toEqual([]);
  });
});
