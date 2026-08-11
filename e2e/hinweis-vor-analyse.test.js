import { test, expect } from "@playwright/test";

/* v3.0.1 (FIX 3): Der „Wichtiger Hinweis"-Dialog steht VOR der Analyse.
 *
 * ANLASS (erster Live-Test des Inhabers): Beim Live-Erlebnis platzte das Modal
 * am ENDE mitten in die Dramaturgie — und der getippte Profiltext war schon
 * VOR der Einordnung „nichts davon ist wahr" sichtbar. Jetzt erscheint der
 * Hinweis nach der Foto-Wahl und BEVOR der Upload beginnt; bestätigt gilt
 * einmal pro Tab. Am Ende erscheint KEIN Modal mehr.
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
  meta: { requestId: "hinweis-test-123", mode: "multimodal" },
};

test("Hinweis vor der Analyse: Modal nach Foto-Wahl, Analyse erst nach der Bestätigung, kein zweites Modal am Ende", async ({
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
      body: JSON.stringify({ jobId: `hinweis-job-${enqueueAufrufe}`, resultToken: "hinweis-token-1" }),
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

  /* 1. Foto-Wahl → der Hinweis erscheint SOFORT, mit dem Start-Button-Text —
     und noch ist NICHTS hochgeladen. */
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator("#disclaimerConfirm")).toHaveText(/Analyse starten|Start analysis/);
  expect(enqueueAufrufe).toBe(0);

  /* 2. Nach der Bestätigung läuft die Analyse — mit Sofort-Text statt stummem
     Auge (FIX 1) — und der Upload geht raus. */
  await page.click("#disclaimerConfirm");
  await expect(page.locator("#scanText")).toHaveText(/unterwegs|on its way/, { timeout: 5000 });
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
  expect(enqueueAufrufe).toBe(1);

  /* 3. Am Ende KEIN zweites Modal — das Ergebnis steht direkt da. */
  await expect(page.locator("#disclaimerModal")).not.toHaveClass(/active/);
  await expect(page.locator(".cat-card").first()).toBeVisible();

  /* 4. Zweites Foto im selben Tab: kein Modal mehr, die Analyse startet direkt
     (bestätigt gilt einmal pro Tab). */
  await page.click('[data-demo="cafe"]');
  await expect(page.locator("#scanAnim")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator("#disclaimerModal")).not.toHaveClass(/active/);
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
  await expect.poll(() => enqueueAufrufe, { timeout: 15000 }).toBe(2);
});
