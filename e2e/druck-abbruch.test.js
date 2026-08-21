/**
 * druck-abbruch.test.js — REPRODUKTION eines Nutzer-Fundes vom 2026-08-18.
 *
 * Gemeldet: Profil laden → Beast-Modus → „PDF speichern" → im Druckdialog
 * ABBRECHEN → die Seite ist danach schwarz, kein Inhalt mehr sichtbar. Erst
 * ein Neuladen bringt sie zurück.
 *
 * Simulationstreue: Der Druckdialog selbst lässt sich nicht fernsteuern, aber
 * sein Effekt auf die Seite schon — Playwright kann das Druck-Stylesheet
 * aktivieren und wieder abschalten.
 *
 * BEFUND DER REPRODUKTION: So lässt sich der Fehler NICHT auslösen — weder in
 * Chromium noch in WebKit. Der Ergebnisbereich bleibt danach sichtbar, in
 * voller Höhe, mit allen Karten. Die Ursache liegt also nicht im Umschalten
 * des Stylesheets, sondern in etwas, das nur der echte Druckdialog tut.
 *
 * Der Test bleibt trotzdem: Er hält fest, was gelten MUSS, und wird rot,
 * sobald jemand am Druck- oder Aufräumweg etwas kaputtmacht. Die eigentliche
 * Aufklärung übernimmt die Messung in app.js — sie meldet den Fall, wenn er
 * am echten Gerät wieder auftritt.
 */

import { test, expect } from "@playwright/test";

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
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "a-1", mode: "multimodal", subject: "HUMAN" },
};

/** Schreibt jede Aenderung in einem aria-live-Bereich mit — das sind die Ansagen. */

async function endpunkte(page, jobStatus) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
        sprachumschalter: true,
      }),
    })
  );
  await page.route("**/api/enqueue", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "a", resultToken: "t" }) })
  );
  await page.route("**/api/job-status**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
}

test("Nach Abbrechen des Druckdialogs ist die Seite im Beast-Modus wieder da", async ({ page }) => {
  /* OPS-2026-08-21-08: Der Wartewert von 45 s unten war wirkungslos — das
     Zeitlimit des Tests liegt bei 30 s. `test.slow()` verdreifacht es. */
  test.slow();
  await endpunkte(page, { status: "done", result: PROFIL });
  await page.goto("/");
  await page.click('[data-demo="selfie"]');
  await page.waitForSelector(".cat-card", { timeout: 45000 });

  /* In den Beast-Modus wechseln — dort trat der Fehler auf. */
  await page.locator('[data-mode="boost"]').first().click();
  await page.waitForTimeout(700);
  expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");

  const vorher = await page.locator(".cat-card").count();
  expect(vorher).toBeGreaterThan(0);

  /* Druckvorschau öffnen und wieder verlassen = Abbrechen. */
  await page.locator("#exportPdf").click();
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(500);
  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(1500);

  /* DER EIGENTLICHE FUND: Ist der Inhalt danach noch sichtbar? */
  const karte = page.locator(".cat-card").first();
  await expect(karte).toBeVisible();
  expect(await page.locator(".cat-card").count()).toBe(vorher);

  /* Und sind die Druck-Hinweise wieder entfernt? */
  expect(await page.locator(".print-note").count()).toBe(0);

  /* Sichtprobe: Der Ergebnisbereich darf nicht auf null Höhe zusammenfallen. */
  const zustand = await page.evaluate(() => {
    const r = document.getElementById("resultsPanel");
    const s = r ? getComputedStyle(r) : null;
    const sichtbare = [...document.querySelectorAll("#resultsPanel *")].filter((n) => {
      const c = getComputedStyle(n);
      return c.display !== "none" && c.visibility !== "hidden";
    }).length;
    return {
      hoehe: r ? Math.round(r.getBoundingClientRect().height) : -1,
      display: s ? s.display : "?",
      sichtbarkeit: s ? s.visibility : "?",
      deckkraft: s ? s.opacity : "?",
      bodyHoehe: document.body.scrollHeight,
      sichtbareKinder: sichtbare,
      theme: document.documentElement.getAttribute("data-theme"),
    };
  });
  console.log("[druck] Zustand nach Abbrechen:", JSON.stringify(zustand));
  expect(zustand.hoehe).toBeGreaterThan(100);
  expect(zustand.sichtbareKinder).toBeGreaterThan(10);
});
