import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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

/* ── Welche Seiten geprueft werden ────────────────────────────────────────
   OPS-2026-08-19: Hier stand eine feste Liste mit sechs Pfaden. Am 2026-08-18
   kamen vier englische Seiten unter public/en/ dazu; die Liste kannte sie
   nicht. Ein Bedienelement ohne `tabindex="0"` waere dort unbemerkt geblieben —
   und genau dieser Fehler (BUG-2026-08-17-08) wurde seinerzeit von einem
   Nutzer auf der Live-Seite gefunden, nicht von einem Test.

   Deshalb wird jetzt das Dateisystem gefragt, wie in e2e/a11y.test.js und
   e2e/barrierefreiheit-protokoll.test.js. Jede neue Seite ist ab ihrer
   Entstehung dabei, ohne dass jemand daran denken muss. */
/* Basis ist das ARBEITSVERZEICHNIS, nicht `import.meta.url`: Playwright laedt
   Testdateien nicht als echte ES-Module, `import.meta` wirft dort. Dieselbe
   Begruendung steht in e2e/barrierefreiheit-protokoll.test.js — ich bin genau
   in diese Falle getreten, obwohl der Kommentar zwei Dateien weiter stand. */
const PUBLIC = join(process.cwd(), "public");

function alleSeiten(unter = "") {
  const treffer = [];
  for (const e of readdirSync(join(PUBLIC, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["__tests__", "node_modules", "fonts", "img", "js", "locales", "lib"].includes(e.name)) continue;
      treffer.push(...alleSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push("/" + rel);
    }
  }
  return treffer.sort();
}

const SEITEN = alleSeiten();

/* Positivkontrolle fuer die Suche selbst: Faende sie nichts oder zu wenig,
   liefe die Schleife unten still leer und der Test waere gruen, ohne gemessen
   zu haben. Stand 2026-08-19: zehn Seiten. */
test("Messmittel: die Seitensuche findet die ausgelieferten Seiten", () => {
  expect(SEITEN.length, `gefunden: ${SEITEN.join(", ")}`).toBeGreaterThanOrEqual(10);
  expect(SEITEN).toContain("/en/privacy.html");
  expect(SEITEN).toContain("/index.html");
});

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

test("Tastatur: der Sprachumschalter auf der Startseite und auf einer Rechtsseite", async ({ page }) => {
  /* Der konkrete Fall aus dem Fehlerbericht (BUG-2026-08-17-08): Auf der
     Startseite entsteht der Umschalter erst durch JavaScript — ein Test, der
     nur das statische HTML prueft, haette ihn nie gesehen. Er wird deshalb
     ausdruecklich abgewartet und geprueft.

     Auf den RECHTSSEITEN war er bis v3.6.1 ebenfalls JavaScript und oeffnete
     eine Rueckfrage ("Diese Seite gibt es nur auf Deutsch"), deren Knoepfe hier
     mitgeprueft wurden. Seit die englischen Seiten existieren, ist er dort ein
     LINK — kein Dialog, kein Skript. Geprueft wird jetzt der Link: Er muss
     `tabindex="0"` tragen, sonst springt Safari ohne "Vollzugriff Tastatur"
     nicht auf ihn, und der Sprachwechsel waere per Tastatur unerreichbar. */
  await endpunkteStellen(page);
  await page.goto("/");
  await page.waitForTimeout(800);

  const pille = page.locator(".sprach-pille");
  await expect(pille, "Umschalter nicht entstanden — Test wuerde nichts pruefen").toHaveCount(1);
  expect(await fehlendeErfassen(page), "Umschalter-Knoepfe ohne tabindex=0").toEqual([]);

  /* Und auf einer Rechtsseite, wo er ein reiner Link ist. */
  await page.goto("/datenschutz.html");
  const verweis = page.locator("a.sprach-knopf");
  await expect(verweis, "kein Sprachverweis auf der Rechtsseite — Test wuerde nichts pruefen").toHaveCount(1);
  await expect(verweis).toHaveAttribute("tabindex", "0");
  await expect(verweis).toHaveAttribute("href", "/en/privacy");
  expect(await fehlendeErfassen(page), "Sprachverweis ohne tabindex=0").toEqual([]);

  /* Die Rueckfrage ist fort — und darf nicht zurueckkommen. */
  await expect(page.locator(".sw-grund, .sw-modal")).toHaveCount(0);
});
