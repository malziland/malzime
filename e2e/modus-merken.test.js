import { test, expect } from "@playwright/test";

/* Beast Mode überlebt ein Neuladen — aber nicht einen neuen Tab.

   ANLASS (aufgefallen 2026-08-11): Im Beast Mode neu laden landete
   wieder im seriösen Modus. Die Regel lautete „Beast startet immer
   ausgeschaltet"; die Regel ist präzisiert:

     „Beast startet immer ausgeschaltet — das stimmt, aber ein Reload ist
      kein Start."

   Genau diese Unterscheidung prüfen die beiden Tests hier: Der eine hält das
   gewünschte neue Verhalten fest, der andere die didaktische Zusage, die dabei
   NICHT verloren gehen darf. Ohne den zweiten wäre ein Wechsel auf
   localStorage eine stille Verschlechterung, die niemandem auffällt. */

async function seiteMitMocks(page) {
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 0, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 0, week: 0, month: 0, year: 0, allTime: 0 },
        useQueue: true,
      }),
    })
  );
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
}

/* Die Checkbox ist visuell durch den Schalter ersetzt und daher nicht direkt
   klickbar — wie in den anderen E2E-Tests über das Element selbst. */
async function beastEinschalten(page) {
  await page.evaluate(() => document.getElementById("biasSwitch").click());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

test("Beast Mode überlebt ein Neuladen", async ({ page }) => {
  await seiteMitMocks(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await beastEinschalten(page);

  await page.reload();
  await expect(page.locator("h1")).toBeVisible();

  /* Beides prüfen: das Aussehen UND den Schalter. Nur das Theme zu prüfen
     würde einen Zustand durchgehen lassen, in dem die Seite dunkel aussieht,
     der Schalter aber auf „seriös" steht — dann wäre der nächste Klick ein
     Sprung ins Dunkle statt zurück ins Helle. */
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#biasSwitch")).toBeChecked();
});

test("ein neuer Tab startet wieder seriös (didaktische Zusage)", async ({ browser }) => {
  const kontext = await browser.newContext();

  const ersteSeite = await kontext.newPage();
  await seiteMitMocks(ersteSeite);
  await beastEinschalten(ersteSeite);
  await ersteSeite.close();

  /* Neuer Tab = neue sessionStorage-Sitzung. Im Workshop ist das die nächste
     Person am weitergereichten Gerät: Sie soll den Kontrast selbst herstellen
     und nicht bereits im Beast Mode landen. */
  const zweiteSeite = await kontext.newPage();
  await seiteMitMocks(zweiteSeite);

  await expect(zweiteSeite.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(zweiteSeite.locator("#biasSwitch")).not.toBeChecked();

  await kontext.close();
});
