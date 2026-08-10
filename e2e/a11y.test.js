import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* Automatisierter Accessibility-Check (axe-core) des kritischsten Nutzerflusses:
   Startseite und fertige Profil-Ansicht. Gate: Verstöße mit Impact "serious"
   oder "critical" brechen den Test — OHNE Ausnahmen (Altlasten in v2.3.2
   behoben); leichtere Funde werden nur geloggt, damit sie sichtbar bleiben,
   ohne jeden PR zu blockieren.

   Gemessen wird mit reduzierter Bewegung: Ohne das erwischt axe Elemente
   mitten in der Einblend-Animation (halbtransparenter Text → Schein-Funde
   mit Kontrast ~1:1). Die Seite respektiert prefers-reduced-motion ohnehin
   vollständig — gemessen wird also ein realer Endzustand. */

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
  meta: { requestId: "a11y-test-123", mode: "multimodal" },
};

async function checkA11y(page, kontext) {
  const results = await new AxeBuilder({ page }).analyze();
  const alle = results.violations;
  if (alle.length > 0) {
    /* Alles loggen (auch minor/moderate), damit Funde im CI-Log sichtbar sind */
    console.log(
      `[a11y] ${kontext}: ${alle.length} Fund(e):`,
      alle.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`).join(", ")
    );
  }
  const ernst = alle.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    ernst.map((v) => ({ regel: v.id, impact: v.impact, elemente: v.nodes.map((n) => n.target.join(" ")) })),
    `Ernste A11y-Verstöße auf ${kontext}`
  ).toEqual([]);
}

test("A11y: Startseite ohne ernste Verstöße", async ({ page }) => {
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 0, limit: 500, limitActive: false },
      }),
    })
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();

  await checkA11y(page, "Startseite");
});

test("A11y: Profil-Ansicht ohne ernste Verstöße", async ({ page }) => {
  /* Gleiche Mocks wie im Smoke-Test: Queue-Endpunkte liefern sofort ein Ergebnis */
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
  await page.route("**/api/enqueue", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "a11y-job-1", resultToken: "a11y-token-1" }),
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
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 20000 });
  await page.click("#disclaimerConfirm");
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 5000 });
  await expect(page.locator(".cat-card").first()).toBeVisible();

  await checkA11y(page, "Profil-Ansicht");

  /* TEST-003 (Audit 2026-08-10): Beast Mode wurde nie gemessen.
     Das Umschalten wechselt das GESAMTE Farbschema (data-theme="dark") — ein
     Kontrastproblem dort fiel durch jede Pruefung, obwohl das Gate als „ohne
     Ausnahmen" gilt. Und der Beast Mode ist im Workshop die Haelfte der
     Nutzung; er ist der Modus, um den es didaktisch geht. */
  /* Die Checkbox ist visuell durch den Schalter ersetzt und daher nicht
     direkt klickbar — wie in sticky-toggle.test.js ueber das Element selbst. */
  await page.evaluate(() => document.getElementById("biasSwitch").click());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".cat-card").first()).toBeVisible();

  await checkA11y(page, "Profil-Ansicht im Beast Mode");

  /* Und der geklebte Umschalter im gescrollten Zustand — er liegt dann ueber
     dem Inhalt und war ebenfalls nie gemessen. */
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(300);
  await checkA11y(page, "Beast Mode, Umschalter geklebt");
});
