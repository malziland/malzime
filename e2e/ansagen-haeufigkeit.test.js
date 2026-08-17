import { test, expect } from "@playwright/test";

/* Wie oft ein Screenreader waehrend der Wartezeit spricht — und dass das Ergebnis
 * einen Namen hat.
 *
 * ANLASS: Ein Nutzer hat mit VoiceOver zugehoert und gesagt, es sei „total
 * nervig, der wiederholt andauernd". Nachgemessen: 19 Ansagen in 30 Sekunden
 * Wartezeit, bei einer vollen Analyse rund 40 — fast immer derselbe Satz.
 * Ursache: `showQueueWaiting` schrieb den Text bei JEDER Statusabfrage neu, also
 * alle 2 Sekunden, auch wenn er sich nicht geaendert hatte. Jede Zuweisung an
 * `textContent` loest in einem `aria-live`-Bereich eine neue Ansage aus.
 *
 * Dazu kamen die rotierenden Zier-Meldungen („Analysiere Pixel…"), die sich
 * tatsaechlich aendern und deshalb ebenfalls vorgelesen wurden.
 *
 * WARUM KEIN TEST DAS FAND: Die Pruefungen sahen, DASS angesagt wird — nicht WIE
 * OFT. Eine Seite, die sich alle zwei Sekunden selbst wiederholt, ist fuer blinde
 * Nutzer unbenutzbar, waehrend jede Messung gruen bleibt.
 *
 * MASSSTAB: Waehrend einer Wartezeit gehoeren die Zustandswechsel angesagt —
 * „Foto unterwegs", „Analyse gestartet", die Warteschlangen-Position — und sonst
 * nichts. Drei bis vier pro Minute. Die Grenze hier ist bewusst grosszuegig
 * gesetzt (5 in 30 Sekunden), damit sie echte Rueckfaelle faengt und nicht bei
 * jeder Textaenderung anschlaegt.
 */

const PROFIL = {
  profiles: {
    normal: {
      categories: { alter_geschlecht: { label: "Alter", value: "25-30", confidence: 0.8 } },
      ad_targeting: ["X"],
      manipulation_triggers: ["Y"],
      profileText: "Ein junger Erwachsener.",
    },
    boost: {
      categories: { alter_geschlecht: { label: "Alter", value: "25-30", confidence: 0.9 } },
      ad_targeting: ["P"],
      manipulation_triggers: ["Q"],
      profileText: "Beast.",
    },
  },
  privacyRisks: [],
  exif: {},
  meta: { requestId: "h", mode: "multimodal", subject: "HUMAN" },
};

async function endpunkte(page, jobStatus) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
      }),
    })
  );
  await page.route("**/api/enqueue", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "h", resultToken: "t" }) })
  );
  await page.route("**/api/job-status**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
  );
}

test("Wartezeit: hoechstens fuenf Ansagen in 30 Sekunden", async ({ page }) => {
  test.setTimeout(90000);
  const ansagen = [];
  await page.exposeFunction("__ansage", (t) => ansagen.push((t || "").trim()));
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll("[aria-live]:not([aria-live='off']), [role='status'], [role='alert']").forEach((el) => {
        new MutationObserver(() => window.__ansage(el.textContent)).observe(el, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    });
  });

  await endpunkte(page, { status: "queued", position: 3, etaSeconds: 45 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(500);
  const vorher = ansagen.length;
  await page.click('[data-demo="selfie"]');
  await page.waitForTimeout(30000);
  const waehrend = ansagen.slice(vorher).filter(Boolean);

  /* POSITIVKONTROLLE: Null Ansagen waeren kein Erfolg, sondern eine kaputte
     Messung — oder eine Seite, die blinden Nutzern gar nichts sagt. */
  expect(waehrend.length).toBeGreaterThan(0);
  expect(waehrend.length).toBeLessThanOrEqual(5);
});

test("Nach der Analyse traegt der Ergebnisbereich einen Namen", async ({ page }) => {
  /* Der zweite Fund desselben Nutzers: „Analyse beendet" kam, danach nichts.
     Der Fokus sprang auf einen <section> ohne Rolle und ohne Namen — VoiceOver
     landet dort und hat nichts zu sagen. */
  await endpunkte(page, { status: "done", result: PROFIL });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.click('[data-demo="selfie"]');
  await page.waitForSelector(".cat-card", { timeout: 20000 });
  await page.waitForTimeout(1200);

  const fokus = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a?.id, rolle: a?.getAttribute("role"), name: a?.getAttribute("aria-label") };
  });
  expect(fokus.id).toBe("resultsPanel");
  expect(fokus.rolle).toBe("region");
  expect(fokus.name).toBeTruthy();
});
