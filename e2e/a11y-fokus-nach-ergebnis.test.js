import { test, expect } from "@playwright/test";

/* Fokus nach dem Ergebnis (BUG-2026-09-10-01).

   300 ms nach dem Anzeigen des Ergebnisses setzt die Seite den Fokus auf den
   Ergebnisbereich, damit ein Screenreader dort weiterliest. Bis 4.8.1 tat sie
   das in JEDEM Fall — auch wenn man in diesen 300 ms schon selbst etwas
   angesteuert hatte. Wer mit der Tastatur schnell ist, verlor dabei seinen
   Tastendruck: Die Leertaste ging am Beast-Umschalter runter und am
   Ergebnisbereich hoch, und der Schalter blieb stehen. In der Pipeline zeigte
   sich das dreimal als roter Tastatur-Test (e2e/keyboard.test.js), lokal fast
   nie — es ist ein Zeitfenster.

   Damit dieser Test das Fenster sicher trifft statt zufaellig, haelt er die
   Uhr der Seite an (page.clock): Leertaste runter, Uhr ueber die 300 ms
   hinaus vorstellen, Leertaste hoch. Der zweite Test haelt fest, dass der
   gewollte Sprung zum Ergebnis ohne eigene Bewegung weiterhin passiert —
   eine Pruefung nur des Fehlerfalls genuegt nicht.

   Laeuft in Chromium und (ueber den Namen) im Firefox-Barrierefreiheitslauf. */

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.8 },
      },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.9 },
      },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Mode-Profil.",
    },
  },
  privacyRisks: [],
  exif: {},
  meta: { requestId: "fokus-test", mode: "multimodal" },
};

/* Bis zum fertigen Ergebnis — mit angehaltener Uhr. Danach steht der
   300-ms-Zeitgeber noch aus; der Test entscheidet, was vorher passiert. */
async function bisZumErgebnis(page) {
  await page.clock.install();
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 1, week: 1, month: 1, total: 1 },
      }),
    })
  );
  await page.route("**/api/enqueue", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "fokus-job", resultToken: "fokus-token" }),
    })
  );
  await page.route("**/api/job-status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", result: MOCK_RESPONSE }),
    })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator('[data-demo="selfie"]').click();

  /* Die Uhr in kleinen Schritten vorstellen, bis die Karten stehen. Kleine
     Schritte, damit der 300-ms-Zeitgeber nicht schon im selben Schritt
     mitlaeuft. */
  let karten = 0;
  for (let i = 0; i < 200 && karten === 0; i++) {
    await page.clock.runFor(50);
    karten = await page.locator(".cat-card").count();
  }
  expect(karten, "Ergebnis-Karten erscheinen").toBeGreaterThan(0);
}

async function fokusId(page) {
  return page.evaluate(() => document.activeElement && document.activeElement.id);
}

test("Wer direkt nach dem Ergebnis den Umschalter bedient, behaelt den Fokus", async ({ page }) => {
  await bisZumErgebnis(page);

  await page.locator("#biasSwitch").focus();
  await page.keyboard.down("Space");
  /* Genau hier lief bis 4.8.1 der Zeitgeber und zog den Fokus weg. */
  await page.clock.runFor(400);
  await page.keyboard.up("Space");

  expect(await fokusId(page), "Fokus bleibt am Umschalter").toBe("biasSwitch");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Ohne eigene Bewegung springt der Fokus weiterhin zum Ergebnis", async ({ page }) => {
  await bisZumErgebnis(page);

  await page.clock.runFor(400);

  expect(await fokusId(page), "Fokus auf dem Ergebnisbereich").toBe("resultsPanel");
});
