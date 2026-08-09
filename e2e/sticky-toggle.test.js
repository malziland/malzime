import { test, expect } from "@playwright/test";

/* Sticky-Umschalter (v2.6.0): Der Umschalter Seriöse Analyse ↔ Beast Mode
 * bleibt beim Scrollen oben stehen, sobald ein Ergebnis vorliegt — damit man
 * dieselbe Karte in beiden Modi vergleichen kann, ohne hoch- und
 * runterzuscrollen.
 *
 * Geprüft wird das, was in Unit-Tests nicht geht: echtes Layout, echtes
 * Scrollen, echtes position:sticky.
 */

/* Profile mit deutlich unterschiedlich langen Texten — genau die Situation,
   in der die Leseposition ohne Scroll-Anker wegrutschen würde. */
const CATS = [
  "alter_geschlecht",
  "herkunft",
  "einkommen",
  "bildung",
  "beziehungsstatus",
  "interessen",
  "persoenlichkeit",
  "charakterzuege",
  "politisch",
  "gesundheit",
  "kaufkraft",
  "verletzlichkeit",
  "werbeprofil",
];

function buildCategories(textLength) {
  const out = {};
  for (const key of CATS) {
    out[key] = {
      label: key,
      value: "Satz. ".repeat(textLength),
      confidence: 0.8,
    };
  }
  return out;
}

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: buildCategories(6),
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote"],
      manipulation_triggers: ["FOMO"],
      profileText: "Sachliches Profil. ".repeat(10),
    },
    boost: {
      /* Beast ist bewusst deutlich laenger — so verschiebt sich der Inhalt */
      categories: buildCategories(18),
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Profil viel laenger. ".repeat(25),
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "sticky-test-1", mode: "multimodal" },
};

async function mockBackend(page) {
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 10, week: 50, month: 200, total: 1000 },
        useQueue: true,
      }),
    }),
  );
  await page.route("**/api/enqueue", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "sticky-job-1", resultToken: "sticky-token-1" }),
    }),
  );
  await page.route("**/api/job-status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", result: MOCK_RESPONSE }),
    }),
  );
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

async function runAnalysis(page) {
  await page.goto("/");
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 20000 });
  await page.click("#disclaimerConfirm");
  await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 5000 });

  /* Die App scrollt nach der Analyse selbst nach oben (js/api.js, weiches
     Scrollen). Erst abwarten, bis das durch ist — sonst kollidiert es mit dem
     Scrollen im Test. */
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        let last = window.scrollY;
        let stableFrames = 0;
        const tick = () => {
          if (window.scrollY === last) stableFrames++;
          else stableFrames = 0;
          last = window.scrollY;
          if (stableFrames > 5) resolve(true);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    null,
    { timeout: 5000 },
  );
}

/* Eine Karte gezielt in die Bildmitte holen — robuster als eine feste
   Pixelzahl, die je nach Fensterhoehe im Nichts landen kann. */
async function scrollCardIntoView(page, index) {
  await page.evaluate((i) => {
    const card = document.querySelectorAll("#facts .cat-card")[i];
    card.scrollIntoView({ block: "center", behavior: "instant" });
  }, index);
  await page.waitForTimeout(150);
}

test("Sticky: Umschalter klebt erst, wenn ein Ergebnis vorliegt", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");

  /* Ohne Ergebnis: kein Kleben — der Umschalter soll auf der Startseite
     keinen Platz kosten. */
  await expect(page.locator("html")).not.toHaveAttribute("data-has-result", /.*/);
  const before = await page.locator("#biasToggleWrap").evaluate((el) => getComputedStyle(el).position);
  expect(before).not.toBe("sticky");

  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 20000 });
  await page.click("#disclaimerConfirm");
  await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 5000 });

  await expect(page.locator("html")).toHaveAttribute("data-has-result", "1");
  const after = await page.locator("#biasToggleWrap").evaluate((el) => getComputedStyle(el).position);
  expect(after).toBe("sticky");
});

test("Sticky: Umschalter bleibt beim Scrollen sichtbar und erreichbar", async ({ page }) => {
  await mockBackend(page);
  await runAnalysis(page);

  /* Weit nach unten scrollen — der Umschalter stand urspruenglich ganz oben */
  await scrollCardIntoView(page, 8);

  const box = await page.locator("#biasToggleWrap").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  /* Er muss im sichtbaren Bereich liegen, nicht darueber hinausgescrollt sein */
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeLessThan(viewport.height / 2);

  /* Und er muss anklickbar sein (nicht von Inhalt verdeckt) */
  await expect(page.locator("#biasSwitch")).toBeVisible();

  /* Geklebt-Zustand ist erkannt worden */
  await expect(page.locator("#biasToggleWrap")).toHaveClass(/is-stuck/);
});

test("Sticky: Umschalten mitten in der Seite haelt die Leseposition", async ({ page }) => {
  await mockBackend(page);
  await runAnalysis(page);

  /* Mitten in die Kartenliste — Karte 6 von 13 in die Bildmitte */
  await scrollCardIntoView(page, 6);

  /* Welche Karte steht gerade oben unter der Leiste — und wo genau? */
  const readBefore = await page.evaluate(() => {
    const bar = document.getElementById("biasToggleWrap").getBoundingClientRect().bottom;
    const card = Array.from(document.querySelectorAll("#facts .cat-card")).find(
      (c) => c.getBoundingClientRect().bottom > bar + 4,
    );
    return card ? { key: card.dataset.key, top: card.getBoundingClientRect().top } : null;
  });
  expect(readBefore).not.toBeNull();

  /* Umschalten OHNE page.click(): Playwright scrollt das Ziel vor dem Klick in
     den Blick und verschiebt die Seite dabei um mehrere hundert Pixel — der
     Test wuerde dann seine eigene Verschiebung messen statt der des
     Moduswechsels. Ein echter Nutzer tippt auf die ohnehin sichtbare Leiste. */
  await page.evaluate(() => document.getElementById("biasSwitch").click());
  await page.waitForTimeout(300);

  const readAfter = await page.evaluate((key) => {
    const card = Array.from(document.querySelectorAll("#facts .cat-card")).find(
      (c) => c.dataset.key === key,
    );
    return card ? card.getBoundingClientRect().top : null;
  }, readBefore.key);

  expect(readAfter).not.toBeNull();
  /* Dieselbe Karte muss noch (fast) an derselben Bildschirmhoehe stehen.
     Ohne Scroll-Anker verschiebt sie sich hier um hunderte Pixel. */
  expect(Math.abs(readAfter - readBefore.top)).toBeLessThan(24);
});

test("Sticky: im Beast Mode klebt der Umschalter genauso", async ({ page }) => {
  await mockBackend(page);
  await runAnalysis(page);

  await page.click(".toggle-switch");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "boost");

  await scrollCardIntoView(page, 8);

  await expect(page.locator("#biasToggleWrap")).toHaveClass(/is-stuck/);
  const pos = await page.locator("#biasToggleWrap").evaluate((el) => getComputedStyle(el).position);
  expect(pos).toBe("sticky");
});
