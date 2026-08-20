import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/* ── Welche Seiten geprueft werden ─────────────────────────────────────────
   OPS-2026-08-18-03: Hier standen zwei feste Listen mit denselben vier
   deutschen Rechtsseiten. Am 2026-08-18 kamen vier englische Seiten unter
   public/en/ dazu — beide Listen haetten sie nicht gesehen, und der
   Pruefbericht haette weiter behauptet, die Stichprobe umfasse die Website
   "vollstaendig". Eine Konformitaetsaussage, die auf einer veralteten Liste
   steht, ist keine.

   Deshalb wird jetzt das Dateisystem gefragt. Jede neue Seite ist damit ab
   ihrer Entstehung in der Pruefung — ohne dass jemand daran denken muss. */
/* Basis ist das ARBEITSVERZEICHNIS, nicht `import.meta.url`: Playwright laedt
   Testdateien nicht als echte ES-Module, `import.meta` wirft dort. Dieselbe
   Begruendung steht seit Langem in e2e/barrierefreiheit-protokoll.test.js — ich
   habe sie beim Umbau uebersehen UND die Datei danach nicht laufen lassen. Der
   Fehler blieb dadurch einen Tag unbemerkt. */
const PUBLIC = join(process.cwd(), "public");

function alleSeiten(unter = "") {
  const treffer = [];
  for (const e of readdirSync(join(PUBLIC, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["__tests__", "node_modules", "fonts", "img", "js", "locales"].includes(e.name)) continue;
      treffer.push(...alleSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push("/" + rel);
    }
  }
  return treffer.sort();
}

const ALLE_SEITEN = alleSeiten();

/* Die Rechtsseiten: alles ausser Startseite und Zahlen-Seite. Deutsch UND
   englisch — /en/privacy.html traegt dieselbe Verantwortung wie
   /datenschutz.html. */
const RECHTSSEITEN = ALLE_SEITEN.filter((p) => !/^\/(index|stats)\.html$/.test(p));

/* Positivkontrolle fuer die Suche selbst: Faende sie nichts oder zu wenig,
   liefen die Schleifen unten still leer und der Test waere gruen ohne
   gemessen zu haben. Stand 2026-08-18: 10 Seiten, davon 8 Rechtsseiten. */
test("Messmittel: die Seitensuche findet die ausgelieferten Seiten", () => {
  expect(ALLE_SEITEN.length, `gefunden: ${ALLE_SEITEN.join(", ")}`).toBeGreaterThanOrEqual(10);
  expect(RECHTSSEITEN.length).toBeGreaterThanOrEqual(8);
  expect(ALLE_SEITEN).toContain("/en/privacy.html");
  expect(ALLE_SEITEN).toContain("/datenschutz.html");
});

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

  /* POSITIVKONTROLLE: HAT axe die tragenden Bereiche ueberhaupt angefasst?
   *
   * ANLASS 2026-08-19, vom Nutzer angestossen: "Aber eigentlich haettest du die
   * gesamte Seite ja schon ueberpruefen muessen auf Barrierefreiheit." Er hatte
   * recht. Im Beast-Modus lieferte axe fuer die acht Werte der Datenwert-Skala
   * und fuer die Werbe-Schlagworte NICHTS — weder Verstoss noch "unklar" noch
   * "in Ordnung". Sie waren im Dokument, sichtbar, mit Text. Gemessen wurden
   * sie nicht. Der Waechter meldete trotzdem gruen, und das Pruefprotokoll
   * schrieb "0 Verstoesse" fuer einen Bereich, den niemand geprueft hatte.
   * Tatsaechlich lagen dort drei echte Kontrastfehler (4.01, 4.40, 4.41 statt
   * 4.5) — gefunden erst, als eine neue Zeile in der Karte axe dazu brachte,
   * den Bereich doch anzusehen.
   *
   * URSACHE, nachgewiesen: die Sprechblase der GPS-Karte, die sich von selbst
   * oeffnete. Nimmt man am alten Stand NUR das `openPopup()` weg und aendert
   * sonst nichts, misst axe den Profilinhalt sofort — und meldet die drei
   * Verstoesse. Eine ueberdeckende Flaeche bringt die Kontrastregel dazu, den
   * dahinterliegenden Bereich zu ueberspringen. Die Sprechblase hat damit
   * jahrelang genau die Fehler verdeckt, die sie sichtbar gemacht haette.
   *
   * Ein Waechter, der schweigt, ist von einem Waechter, der Entwarnung gibt,
   * nicht zu unterscheiden — es sei denn, man fragt ihn, was er gesehen hat.
   * Genau das passiert hier. */
  const angefasst = new Set();
  for (const liste of [results.violations, results.incomplete, results.passes]) {
    for (const v of liste) {
      if (v.id !== "color-contrast") continue;
      for (const n of v.nodes) angefasst.add(n.target.join(" "));
    }
  }
  /* TEST-2026-08-20-13: Hier stand eine feste Liste von fuenf Klassen — der
     Stand vom 19.08., nicht die Seite. Ein umbenannter oder neu hinzugekommener
     Bereich waere davon nie erfasst worden, und der blinde Fleck von damals
     ("gruen gemeldet, ohne hingesehen zu haben", drei echte Kontrastfehler
     dahinter) haette in identischer Form zurueckkehren koennen.
     Jetzt bestimmt der Waechter seine Sollmenge aus der FLAECHE: jedes sichtbare
     Element mit eigenem Text. Verglichen wird ueber die Elemente selbst, nicht
     ueber Klassennamen — axe rechnet den Text eines Kindes haeufig dem
     Elternknoten zu, und ein Namensvergleich meldete dann Bereiche als
     uebersehen, die sehr wohl gemessen wurden (vier Fehlalarme auf der
     Startseite). Ein Element gilt als gemessen, wenn axe es selbst oder einen
     seiner Vorfahren angefasst hat.
     Nur Elemente, die selbst TEXT tragen — fuer Behaelter ohne eigenen Text ist
     die Kontrastregel gar nicht zustaendig (`.cat-card` stand frueher in der
     Liste und war deshalb ein Fehlalarm der Kontrolle selbst). */
  const erwartet = await page.evaluate(
    (axeZiele) => {
      const gemessen = axeZiele
        .map((ziel) => {
          try {
            return document.querySelector(ziel);
          } catch (_fehler) {
            return null;
          }
        })
        .filter(Boolean);
      const wurdeGemessen = (el) => gemessen.some((g) => g === el || g.contains(el));
      const kennung = (el) =>
        el.classList.length ? "." + [...el.classList].join(".") : el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");

      const sammle = (wurzel) => {
        const uebersehen = new Set();
        let betrachtet = 0;
        for (const el of wurzel.querySelectorAll("*")) {
          /* Dekoratives ist fuer Screenreader und Kontrastregel unsichtbar. */
          if (el.closest('[aria-hidden="true"]')) continue;
          /* WCAG 1.4.3 nimmt deaktivierte Bedienelemente ausdruecklich von der
           Kontrastanforderung aus ("inactive user interface components"), und axe
           misst sie deshalb zu Recht nicht. Ohne diese Ausnahme meldete die
           Kontrolle den deaktivierten Absende-Knopf des Realitaets-Checks als
           uebersehenen Bereich — ein Fehlalarm der Kontrolle selbst. */
          if (el.disabled || el.closest("[disabled]") || el.closest('[aria-disabled="true"]')) continue;
          const eigenerText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
          if (!eigenerText) continue;
          const kasten = el.getBoundingClientRect();
          if (kasten.width < 1 || kasten.height < 1) continue;
          const stil = getComputedStyle(el);
          if (stil.display === "none" || stil.visibility === "hidden" || Number(stil.opacity) === 0) continue;
          /* Der Sprunglink liegt bis zum Fokus ausserhalb des Bildes; axe misst
           ihn dort zu Recht nicht. */
          if (kasten.bottom < 0 || kasten.right < 0) continue;
          betrachtet += 1;
          if (!wurdeGemessen(el)) uebersehen.add(kennung(el));
        }
        return { uebersehen: [...uebersehen], betrachtet };
      };
      /* Vor der ersten Analyse ist der Ergebnisbereich leer — dann gilt die ganze
       Seite als Flaeche. So deckt die Kontrolle auch die Startseite ab, statt
       dort mangels Inhalt stillschweigend nichts zu pruefen. */
      const panel = document.getElementById("resultsPanel");
      const ausPanel = panel ? sammle(panel) : { uebersehen: [], betrachtet: 0 };
      return ausPanel.betrachtet > 0 ? ausPanel : sammle(document.body);
    },
    [...angefasst]
  );
  /* Positivkontrolle gegen die eigene Messung: Findet der Waechter ueberhaupt
     keinen sichtbaren Text, misst er nichts — und "keine Uebersehenen" waere
     dann keine Entwarnung, sondern ein leeres Blatt. */
  expect(
    erwartet.betrachtet,
    `auf ${kontext} wurde kein sichtbarer Text gefunden — die Abdeckungskontrolle haette nichts zu pruefen`
  ).toBeGreaterThan(0);
  const uebersehen = erwartet.uebersehen;
  expect(
    uebersehen,
    `axe hat diese sichtbaren Bereiche auf ${kontext} gar nicht gemessen — "keine Verstoesse" heisst hier "nicht geprueft"`
  ).toEqual([]);
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
  for (const pfad of ALLE_SEITEN) {
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
  for (const pfad of RECHTSSEITEN) {
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
