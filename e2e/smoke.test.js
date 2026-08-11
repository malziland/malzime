import { test, expect } from "@playwright/test";

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.8 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.6 },
      },
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote"],
      manipulation_triggers: ["FOMO", "Statusvergleich"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.9 },
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

/* Voller Durchklick über den QUEUE-Pfad (Live-Pfad seit v2.0): Demo-Foto →
   /api/enqueue → /api/job-status (done) → Profil. Seit v3.0.2 startet die
   Analyse direkt bei der Foto-Wahl — ohne Hinweis-Pop-up. Die drei
   Queue-Endpunkte werden gemockt, damit der Test ohne echtes Backend läuft. */
test("Smoke: Demo-Foto → Queue → Profil wird angezeigt", async ({ page }) => {
  /* Feature-Flag „Queue an" + Limit-Infos */
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 10, week: 50, month: 200, total: 1000 },
        useQueue: true,
      }),
    })
  );
  /* Upload in die Warteschlange → liefert jobId + Abhol-Ticket zurück */
  await page.route("**/api/enqueue", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "smoke-job-1", resultToken: "smoke-token-1" }),
    })
  );
  /* Status-Poll → sofort „done" mit dem fertigen Ergebnis */
  await page.route("**/api/job-status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", result: MOCK_RESPONSE }),
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

  /* Demo-Foto klicken → die Queue-Analyse startet DIREKT (v3.0.2: kein
     Hinweis-Pop-up mehr). Bild-Prep, Mindest-Interaktionszeit 2s und
     Poll-Intervall 2s brauchen trotzdem ein grosszuegiges Timeout. */
  await page.click('[data-demo="selfie"]');

  /* Profil sollte gerendert werden */
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });

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
