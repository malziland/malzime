import { test, expect } from "@playwright/test";

/* v3.0.2: Das Hinweis-Pop-up vor der Analyse ist ersatzlos entfernt
 * (Entscheidung des Inhabers: „dieses Pop-Up liest sowieso keiner durch").
 *
 * Dieser Test belegt den modallosen Fluss: Die Foto-/Demo-Wahl startet die
 * Analyse DIREKT — der Upload geht ohne Zwischenklick raus, es existiert
 * nicht einmal mehr ein Modal im Markup, und das Ergebnis erscheint ohne
 * jeden Dialog. Er wird ROT, wenn jemand wieder ein Pop-up zwischen
 * Foto-Wahl und Upload schiebt.
 */

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.8 },
      },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
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
  meta: { requestId: "ohne-hinweis-123", mode: "multimodal" },
};

test("Start ohne Hinweis-Pop-up: Demo-Wahl startet die Analyse direkt, kein Dialog bis zum fertigen Profil", async ({
  page,
}) => {
  test.setTimeout(60000);
  let enqueueAufrufe = 0;
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
  await page.route("**/api/enqueue", (route) => {
    enqueueAufrufe += 1;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: `ohne-hinweis-job-${enqueueAufrufe}`, resultToken: "ohne-hinweis-token" }),
    });
  });
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

  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();

  /* Das frühere Hinweis-Modal existiert nicht einmal mehr im Markup. */
  await expect(page.locator("#disclaimerModal")).toHaveCount(0);
  await expect(page.locator("#disclaimerConfirm")).toHaveCount(0);

  /* 1. Demo-Wahl → die Analyse startet SOFORT (Scan-Animation mit
     Upload-Text ab der ersten Sekunde), ohne dass irgendein Dialog
     dazwischen bestätigt werden müsste. */
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#scanAnim")).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator("#scanText")).toHaveText(/unterwegs|on its way/, { timeout: 5000 });

  /* 2. Der Upload geht ohne Zwischenklick raus und das Profil erscheint. */
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
  await expect(page.locator(".cat-card").first()).toBeVisible();
  await expect.poll(() => enqueueAufrufe, { timeout: 15000 }).toBe(1);

  /* 3. Zu keinem Zeitpunkt ein Dialog: das einzige verbliebene Modal
     (Wartungsmodus) ist nie aktiv geworden. */
  await expect(page.locator("#maintenanceModal")).not.toHaveClass(/active/);
  await expect(page.locator(".modal-overlay.active")).toHaveCount(0);

  /* 4. Auch das zweite Foto startet direkt — kein Dialog, zweiter Upload. */
  await page.click('[data-demo="cafe"]');
  await expect(page.locator("#scanAnim")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator(".modal-overlay.active")).toHaveCount(0);
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
  await expect.poll(() => enqueueAufrufe, { timeout: 15000 }).toBe(2);
});
