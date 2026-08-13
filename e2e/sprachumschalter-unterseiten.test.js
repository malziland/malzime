import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* Der Sprachumschalter auf den Unterseiten.
 *
 * Zwei verschiedene Dinge werden geprüft:
 *
 * - `stats.html` ist übersetzt und bekommt den ECHTEN Umschalter
 *   (js/sprachumschalter.js). Dort wird wirklich umgeschaltet.
 * - Datenschutz, Impressum und Nutzungsbedingungen liegen nur auf Deutsch. Sie
 *   bekommen die ÜBERGANGSLÖSUNG (js/sprachhinweis.js): denselben Schalter,
 *   aber ein zweisprachiger Hinweis statt eines Wechsels. Verschwindet, sobald
 *   die Texte übersetzt sind.
 *
 * Diese drei Seiten laden sonst kein JavaScript und rufen keine Schnittstelle
 * auf. Das muss so bleiben — geprüft wird es unten ausdrücklich. */

const NUR_DEUTSCH = ["/datenschutz.html", "/impressum.html", "/nutzungsbedingungen.html"];

async function ruhe(page) {
  await page.evaluate(
    () =>
      new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig)))
  );
}

test.describe("Nur-deutsche Seiten: Hinweis statt Wechsel", () => {
  test.use({ locale: "en-US" });

  for (const seite of NUR_DEUTSCH) {
    test(`${seite}: ohne Tür kein Schalter, mit Tür einer`, async ({ page }) => {
      await page.goto(seite);
      await ruhe(page);
      await expect(page.locator(".sprach-pille")).toHaveCount(0);

      /* Positivkontrolle: Die Null oben wäre auch dann erfüllt, wenn der
         Schalter überhaupt nicht mehr gebaut werden könnte. */
      await page.goto(`${seite}?sprachumschalter=1`);
      await expect(page.locator(".sprach-pille")).toBeVisible();
    });
  }

  test("der Schalter steht auf DE — auch bei englischem Browser", async ({ page }) => {
    /* Er sagt aus, in welcher Sprache das dasteht, was man liest. Auf einer
       deutschen Seite EN anzuzeigen wäre gelogen. */
    await page.goto("/datenschutz.html?sprachumschalter=1");
    await expect(page.locator('.sprach-knopf[data-lang="de"]')).toHaveClass(/aktiv/);
    await expect(page.locator('.sprach-knopf[data-lang="en"]')).not.toHaveClass(/aktiv/);
  });

  test("EN öffnet einen zweisprachigen Hinweis und ändert nichts", async ({ page }) => {
    await page.goto("/datenschutz.html?sprachumschalter=1");
    await page.click('.sprach-knopf[data-lang="en"]');

    const hinweis = page.locator('.sw-grund[data-modal="unuebersetzt"]');
    await expect(hinweis).toBeVisible();

    /* Wer auf EN klickt, liest kein Deutsch — die Erklärung muss ihn erreichen. */
    await expect(hinweis).toContainText("nur auf Deutsch");
    await expect(hinweis).toContainText("German only");

    /* Beide Zeilen sind als ihre Sprache ausgezeichnet, sonst spricht ein
       Screenreader den englischen Satz deutsch aus. Und es bleibt bei je EINER
       Zeile — längere Hinweise liest im Workshop niemand. */
    await expect(hinweis.locator('[lang="de"]')).toHaveCount(1);
    await expect(hinweis.locator('[lang="en"]')).toHaveCount(1);
    expect((await hinweis.innerText()).split("\n").filter(Boolean).length).toBeLessThanOrEqual(4);

    await page.click(".sw-knopf--bleiben");
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator('.sprach-knopf[data-lang="de"]')).toHaveClass(/aktiv/);
  });

  test("Escape schließt, der Fokus kehrt auf den Schalter zurück", async ({ page }) => {
    await page.goto("/datenschutz.html?sprachumschalter=1");
    const en = page.locator('.sprach-knopf[data-lang="en"]');
    await en.focus();
    await en.click();
    await expect(page.locator('.sw-grund[data-modal="unuebersetzt"]')).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const drin = await page.evaluate(() => !!document.activeElement.closest(".sw-modal"));
      expect(drin, `Fokus nach ${i + 1} Tab-Schritten ausserhalb`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement.dataset.lang)).toBe("en");
  });

  test("keine Schnittstellen-Aufrufe von einer Rechtsseite", async ({ page }) => {
    /* Diese Seiten sollen still bleiben. Der Umschalter darf daran nichts
       ändern — er entscheidet allein an der Adresse und am Tab-Speicher. */
    const rufe = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/")) rufe.push(u.pathname);
    });
    await page.goto("/datenschutz.html?sprachumschalter=1");
    await page.click('.sprach-knopf[data-lang="en"]');
    await ruhe(page);
    expect(rufe).toEqual([]);
  });

  test("axe: Seite mit offenem Hinweis ohne ernste Verstöße", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/datenschutz.html?sprachumschalter=1");
    await page.click('.sprach-knopf[data-lang="en"]');
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(1);
    await page.evaluate(
      () =>
        Promise.race([
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
          new Promise((f) => setTimeout(f, 1000)),
        ])
    );
    const funde = (await new AxeBuilder({ page }).analyze()).violations;
    const ernst = funde.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      ernst.map((v) => ({ regel: v.id, elemente: v.nodes.map((n) => n.target.join(" ")) })),
      "Ernste A11y-Verstöße: Rechtsseite mit Hinweis"
    ).toEqual([]);
  });
});

test.describe("Spur aus dem Tab", () => {
  test("wer den Schalter auf der Startseite gesehen hat, sieht ihn auch auf der Rechtsseite", async ({
    page,
  }) => {
    await page.route("**/api/stats", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: { count: 1, limit: 500, limitActive: false },
          sprachumschalter: true,
        }),
      })
    );
    await page.goto("/");
    await expect(page.locator(".sprach-pille")).toBeVisible();

    /* Ohne Adress-Anhängsel — die Spur im Tab genügt. */
    await page.goto("/datenschutz.html");
    await expect(page.locator(".sprach-pille")).toBeVisible();
  });
});

test.describe("Zahlen-Seite: echter Wechsel", () => {
  /* Sonst startet der Testbrowser (en-US) die Seite bereits englisch und die
     Richtung des Wechsels stimmt nicht mehr. */
  test.use({ locale: "de-AT" });

  test("stats.html schaltet wirklich um, ohne Rückfrage", async ({ page }) => {
    await page.goto("/stats.html?sprachumschalter=1");
    await expect(page.locator(".sprach-pille")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Zahlen");

    await page.click('.sprach-knopf[data-lang="en"]');
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toContainText("numbers");
    /* Hier steht nichts auf dem Spiel — es darf keine Rückfrage kommen. */
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
  });
});
