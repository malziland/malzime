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
  /* `subject` war hier nie gesetzt — deshalb blieb der Realitaets-Check
     unsichtbar und dieser Waechter hat ihn NIE gemessen. Aufgefallen erst beim
     Aufbau des Barrierefreiheits-Protokolls (2026-08-17), das mit vollem
     Profil misst. Ein Waechter, der einen ganzen Bildschirmteil nicht sieht,
     meldet "gruen" fuer etwas, das er nicht geprueft hat. */
  meta: { requestId: "a11y-test-123", mode: "multimodal", subject: "HUMAN" },
};

async function checkA11y(page, kontext) {
  /* Erst zur Ruhe kommen lassen, dann messen. `document.getAnimations()` allein
     genuegt nicht: Eine Animation, die erst im naechsten Bildschirmrahmen
     beginnt — etwa der Farbuebergang beim Wechsel ins dunkle Thema — steht dort
     noch nicht drin. axe erwischt dann Elemente mitten im Uebergang und meldet
     Kontrastwerte, die es im Endzustand nicht gibt. Genau das ist am
     2026-08-17 passiert: 19 „ernste" Verstoesse, die in einer ruhigen Messung
     und in der Nachrechnung von Hand alle bestanden. */
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f))));
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  }
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
  /* v3.0.0: Die Analyse startet direkt bei der Demo-Wahl (kein Hinweis-
     Pop-up mehr) — das Timeout deckt Bild-Prep + Mindest-Interaktionszeit. */
  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 15000 });
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

  /* Bei reduzierter Bewegung darf KEINE Karte unsichtbar sein.
     Die Karten laufen mit `animation: fadeUp … both` und gestaffelten
     `animation-delay` bis 0,33 s; `both` haelt waehrend der Wartezeit den
     Startzustand `opacity: 0`. Der reduced-motion-Block setzte lange nur die
     Dauer zurueck, nicht die Verzoegerung — die Karten poppten also auch fuer
     Menschen nacheinander auf, die Animationen ausdruecklich abbestellt haben.

     Fuer axe sah das aus wie unsichtbarer Text: Kontrast 1:1, 19 ernste
     Verstoesse (CI 2026-08-10). Der Fund war echt, nur nicht dort, wo er zu
     stehen schien — deshalb hier eine Pruefung auf die URSACHE statt auf das
     Symptom.

     v3.0.1: Die Ursache wird jetzt wirklich zeitunabhaengig geprueft — an den
     BERECHNETEN Animationswerten (Verzoegerung 0, Dauer praktisch 0) statt an
     einer Opacity-Momentaufnahme. Die erwischte unter Volllast (sieben
     parallele E2E-Dateien seit v3.0.1) naemlich die eine Frame-Luecke, in der
     `fill: both` nach dem Neu-Rendern noch den Startzustand haelt. Die
     Sichtbarkeit selbst wird zusaetzlich geprueft, sobald alle Animationen
     beendet sind. */
  const kartenAnimation = await page.$$eval(".cat-card", (karten) =>
    karten.map((k, i) => {
      const s = getComputedStyle(k);
      return { i, delay: parseFloat(s.animationDelay), dauer: parseFloat(s.animationDuration) };
    })
  );
  for (const k of kartenAnimation) {
    expect(k.delay, `Karte ${k.i}: animation-delay bei reduzierter Bewegung nicht zurueckgesetzt`).toBe(0);
    expect(k.dauer, `Karte ${k.i}: animation-duration bei reduzierter Bewegung nicht zurueckgesetzt`).toBeLessThan(
      0.05
    );
  }
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const unsichtbar = await page.$$eval(".cat-card", (karten) =>
    karten.map((k, i) => ({ i, opacity: Number(getComputedStyle(k).opacity) })).filter((k) => k.opacity < 1)
  );
  expect(unsichtbar, "Karten, die bei reduzierter Bewegung unsichtbar bleiben").toEqual([]);

  await checkA11y(page, "Profil-Ansicht im Beast Mode");

  /* Und der geklebte Umschalter im gescrollten Zustand — er liegt dann ueber
     dem Inhalt und war ebenfalls nie gemessen. */
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(300);
  await checkA11y(page, "Beast Mode, Umschalter geklebt");
});

/* ── Zwei Riegel fuer die Behebungen vom 2026-08-17 ───────────────────────── */

test("A11y: kein waagrechtes Scrollen bei 320 px (WCAG 1.4.10 AA)", async ({ page }) => {
  /* Gemessen und behoben am 2026-08-17: Die Nutzungsbedingungen standen bei
     333 px, die Profil-Seite bei 324. Ursachen waren eine nicht umbrechbare
     EU-Adresse und eine Wert-Plakette, die die Zeile aufschob — dazu eine
     geklebte Leiste, deren negativer Rand nicht zur Container-Polsterung
     passte. Ohne diesen Riegel faellt das still zurueck. */
  await page.setViewportSize({ width: 320, height: 800 });
  for (const pfad of [
    "/",
    "/datenschutz.html",
    "/impressum.html",
    "/nutzungsbedingungen.html",
    "/barrierefreiheit.html",
    "/stats.html",
  ]) {
    await page.goto(pfad);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const mass = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      fenster: window.innerWidth,
    }));
    expect(mass.doc, `${pfad} scrollt waagrecht bei 320 px`).toBeLessThanOrEqual(mass.fenster + 1);
  }
});

test("A11y: jedes fokussierbare Element hat einen eigenen Fokus-Ring", async ({ page }) => {
  /* Gemessen am 2026-08-17: 7 von 12 bis 20 Elementen trugen nur den
     Browser-Standardring. Sichtbar ist der (WCAG 2.4.7 AA erfuellt), aber sein
     Aussehen entscheidet jeder Browser selbst. Seit dem eigenen Ring sind es 0
     — dieser Riegel haelt das fest. */
  for (const pfad of ["/impressum.html", "/datenschutz.html", "/nutzungsbedingungen.html", "/barrierefreiheit.html"]) {
    await page.goto(pfad);
    const schwach = await page.evaluate(() => {
      const raus = [];
      document.querySelectorAll("a, button, [tabindex='0']").forEach((el) => {
        if (!el.getClientRects().length) return;
        el.focus();
        const s = getComputedStyle(el);
        const staerke = parseFloat(s.outlineWidth) || 0;
        if (staerke < 2 || s.outlineStyle === "none") {
          raus.push((el.id ? "#" + el.id : String(el.className || el.tagName).slice(0, 30)) + " " + staerke + "px");
        }
      });
      return raus;
    });
    expect(schwach, `${pfad}: Elemente ohne eigenen Fokus-Ring`).toEqual([]);
  }
});
