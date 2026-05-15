import { test, expect } from "@playwright/test";

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter: { label: "Geschätztes Alter", value: "25-30 Jahre", confidence: 0.8 },
        beruf: { label: "Vermuteter Beruf", value: "Kreativbranche", confidence: 0.6 },
      },
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote"],
      manipulation_triggers: ["FOMO", "Statusvergleich"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: {
        alter: { label: "Geschätztes Alter", value: "25-30 Jahre", confidence: 0.9 },
      },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Mode-Profil.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "smoke-test-123", mode: "multimodal" },
};

test("Smoke: Demo-Foto → Disclaimer → Profil wird angezeigt", async ({ page }) => {
  /* API-Calls abfangen */
  await page.route("**/analyze*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_RESPONSE),
    })
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 10, week: 50, month: 200, total: 1000 },
      }),
    })
  );
  /* Nominatim abfangen (kein externer Call im Test) */
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );

  await page.goto("/");

  /* Seite geladen: Titel und Demo-Buttons sichtbar */
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator('[data-demo="selfie"]')).toBeVisible();

  /* Demo-Foto klicken */
  await page.click('[data-demo="selfie"]');

  /* Disclaimer-Modal sollte erscheinen */
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 15000 });

  /* Bestaetigen */
  await page.click("#disclaimerConfirm");

  /* Profil sollte gerendert werden */
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 5000 });

  /* Mindestens eine Kategorie-Karte sichtbar */
  await expect(page.locator(".cat-card").first()).toBeVisible();
});

test("Smoke: Seite laesst sich ohne Fehler laden", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 0, limit: 500, limitActive: false },
      }),
    })
  );

  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();

  /* Keine JS-Fehler auf der Seite */
  expect(errors).toEqual([]);
});
