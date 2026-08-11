import { test, expect } from "@playwright/test";

/* Tastatur-Smoketest des kritischsten Nutzerflusses (Profilpflicht UI,
   docs/VERIFICATION.md): Der komplette Weg Demo-Foto → Profil muss ohne
   Maus funktionieren — nur mit Tab und Enter — und der Fokus muss dabei
   sichtbar sein. Seit v3.0.0 startet die Analyse direkt bei der Foto-Wahl
   (kein Hinweis-Pop-up mehr). */

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
  meta: { requestId: "keyboard-test-123", mode: "multimodal" },
};

/* Tab drücken, bis das Ziel-Element den Fokus hat (mit Obergrenze) */
async function tabToElement(page, selector, maxTabs = 40) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      (sel) => document.activeElement?.matches(sel) === true,
      selector
    );
    if (focused) return true;
  }
  return false;
}

/* Sichtbarer Fokus: Outline oder Box-Shadow am fokussierten Element */
async function focusIsVisible(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const hasOutline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const hasShadow = s.boxShadow !== "none";
    return hasOutline || hasShadow;
  });
}

test("Tastatur: Demo-Foto → Profil, nur mit Tab + Enter", async ({ page }) => {
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
      body: JSON.stringify({ jobId: "kbd-job-1", resultToken: "kbd-token-1" }),
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
  await expect(page.locator("h1")).toBeVisible();

  /* 1. Per Tab zum Demo-Button — und der Fokus muss sichtbar sein */
  expect(await tabToElement(page, '[data-demo="selfie"]'), "Demo-Button per Tab erreichbar").toBe(true);
  expect(await focusIsVisible(page), "Fokus auf dem Demo-Button sichtbar").toBe(true);

  /* 2. Enter startet die Analyse DIREKT (v3.0.0: kein Hinweis-Dialog mehr)
     und das Profil wird angezeigt */
  await page.keyboard.press("Enter");
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
  await expect(page.locator(".cat-card").first()).toBeVisible();

  /* TEST-003 (Audit 2026-08-10): Der Umschalter war im Tastaturtest gar nicht
     enthalten — weder seine Erreichbarkeit noch die sichtbare Fokus-Markierung.
     Er ist das wichtigste Bedienelement der Seite. */
  await page.keyboard.press("Tab");
  const erreichbar = await page.evaluate(() => {
    const el = document.getElementById("biasSwitch");
    if (!el) return "fehlt";
    el.focus();
    if (document.activeElement !== el) return "nicht fokussierbar";
    const s = getComputedStyle(el, ":focus-visible");
    return s.outlineStyle !== "none" || s.boxShadow !== "none" ? "ok" : "keine Fokus-Markierung";
  });
  expect(erreichbar).toBe("ok");

  /* Mit der Leertaste umschalten — nicht nur mit der Maus. */
  await page.evaluate(() => document.getElementById("biasSwitch").focus());
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
