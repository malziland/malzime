import { test, expect } from "@playwright/test";

/* Jedes Bedienelement muss tabindex="0" tragen — auch die, die JavaScript baut.
 *
 * WARUM DIESER TEST EXISTIERT (BUG-2026-08-17-08): Safari tabbt ohne
 * „Vollzugriff Tastatur" NICHT zu Buttons und Links. Deshalb gilt im Projekt
 * die Regel, dass jedes interaktive Element ein ausdrueckliches tabindex="0"
 * braucht. Ein Unit-Test erzwingt das seit Langem — aber nur fuer die STATISCHE
 * index.html. Die Knoepfe des Sprachumschalters entstehen im JavaScript, und
 * dort fehlte es: Auf Safari war der Umschalter mit der Tastatur nicht
 * erreichbar. WCAG 2.1.1, Stufe A.
 *
 * WARUM DIE VORHANDENEN TESTS DAS NICHT FANDEN: Playwrights WebKit tabbt auf
 * Buttons unabhaengig von Safaris Einstellung. Ein Tab-Durchlauf im Test kann
 * diesen Fehler also grundsaetzlich nicht zeigen — er ist gruen, waehrend die
 * echte Bedienung scheitert. Geprueft wird deshalb die STRUKTUR (traegt das
 * Element tabindex?), nicht das Tabben.
 *
 * Gefunden hat den Fehler ein Nutzer auf der Live-Seite. Dieser Test ist die
 * Antwort darauf, dass das nie wieder von Handarbeit abhaengen soll.
 */

const SEITEN = [
  "/",
  "/stats.html",
  "/datenschutz.html",
  "/impressum.html",
  "/nutzungsbedingungen.html",
  "/barrierefreiheit.html",
];

/** Bewusst ausgenommen, mit Grund. */
const AUSNAHMEN = [{ auswahl: "#website", grund: "Honeypot — darf fuer Menschen NICHT erreichbar sein (tabindex=-1)" }];

async function fehlendeErfassen(page) {
  return page.evaluate(
    (ausnahmen) => {
      const raus = [];
      document.querySelectorAll("a[href], button, input, select, textarea, [role='button']").forEach((el) => {
        if (ausnahmen.some((a) => el.matches(a))) return;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return;
        if (!el.getClientRects().length) return;
        if (el.getAttribute("tabindex") !== "0") {
          raus.push({
            wer:
              (el.id ? "#" + el.id : "") +
              (typeof el.className === "string" && el.className
                ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                : el.tagName.toLowerCase()),
            text: (el.textContent || "").trim().slice(0, 25),
            tabindex: el.getAttribute("tabindex"),
          });
        }
      });
      return raus;
    },
    AUSNAHMEN.map((a) => a.auswahl)
  );
}

async function endpunkteStellen(page) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
        sprachumschalter: true,
      }),
    })
  );
}

for (const pfad of SEITEN) {
  test(`Tastatur: jedes Bedienelement auf ${pfad} traegt tabindex=0`, async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto(pfad);
    /* Warten, bis das JavaScript seine Elemente gebaut hat — sonst prueft der
       Test genau die statischen Elemente, die schon in Ordnung sind. */
    await page.waitForTimeout(800);

    /* POSITIVKONTROLLE: Es muss ueberhaupt etwas zu pruefen geben. Ohne diese
       Zeile waere eine leere Seite ein perfektes Ergebnis. */
    const anzahl = await page.evaluate(
      () => document.querySelectorAll("a[href], button, input, [role='button']").length
    );
    expect(anzahl, `keine Bedienelemente auf ${pfad} gefunden`).toBeGreaterThan(2);

    const fehlend = await fehlendeErfassen(page);
    expect(fehlend, `Bedienelemente ohne tabindex=0 auf ${pfad} (Safari erreicht sie nicht)`).toEqual([]);
  });
}

test("Tastatur: auch der Sprachumschalter und seine Rueckfrage", async ({ page }) => {
  /* Der konkrete Fall aus dem Fehlerbericht: Der Umschalter entsteht erst durch
     JavaScript, seine Rueckfrage sogar erst auf Klick. Beide werden hier
     ausdruecklich geoeffnet und geprueft. */
  await endpunkteStellen(page);
  await page.goto("/");
  await page.waitForTimeout(800);

  const pille = page.locator(".sprach-pille");
  await expect(pille, "Umschalter nicht entstanden — Test wuerde nichts pruefen").toHaveCount(1);
  expect(await fehlendeErfassen(page), "Umschalter-Knoepfe ohne tabindex=0").toEqual([]);

  /* Und der zweisprachige Hinweis auf einer Rechtsseite. */
  await page.goto("/datenschutz.html");
  await page.waitForTimeout(600);
  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator('.sw-grund[data-modal="unuebersetzt"]')).toBeVisible();
  expect(await fehlendeErfassen(page), "Dialog-Knoepfe ohne tabindex=0").toEqual([]);
});
