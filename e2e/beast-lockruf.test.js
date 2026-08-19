import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/* Der Beast-Lockruf am echten Ablauf.
 *
 * WOZU DIESE DATEI. Die Logik-Pruefung (public/__tests__/beast-lockruf.test.js)
 * belegt, WANN der Lockruf kommt und wann nicht — aber nur an Klassennamen.
 * Eine Klasse ist noch keine Bewegung. Hier wird gemessen, was der Browser
 * daraus TATSAECHLICH rechnet: wie weit sich die Pille hebt und wie weit die
 * Rille volllaeuft.
 *
 * KEIN WARTEN AUF DEN HOEHEPUNKT. Die Animation wird angehalten und exakt auf
 * ihren Scheitel gestellt (Web Animations API). Das ist genauer als jede
 * Wartezeit und kann nicht flackern.
 */

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

/* Scheitel der ersten Wiederholung: 0,4 s Vorlauf + 42–58 % von 2 s.
   1400 ms liegt mittig im Plateau. Quelle der Werte: styles.css, Abschnitt
   „Beast-Lockruf". */
const SCHEITEL_MS = 1400;

async function endpunkte(page) {
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
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", result: PROFIL }),
    })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
}

/** Fuehrt eine vollstaendige Analyse bis zum fertigen Profil — OHNE Live-Text,
    also ohne gestaffelte Enthuellung. Dieser Weg ist der leicht zu uebersehende:
    Wiederaufnahme nach Neuladen, Tier-Profil, Merkmal aus. */
async function analyseLaufen(page) {
  await endpunkte(page);
  await page.goto("/");
  await page.waitForTimeout(600);
  await page.click('[data-demo="selfie"]');
}

/** Derselbe Ablauf MIT Live-Text — dann laeuft die gestaffelte Enthuellung, und
    der Lockruf muss auf deren Ende warten statt auf das Rendern. Das ist der
    haeufigste Weg im Betrieb. */
async function analyseMitEnthuellung(page) {
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
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "b", resultToken: "t" }) })
  );
  let runde = 0;
  await page.route("**/api/job-status**", (r) => {
    runde += 1;
    const koerper =
      runde <= 2
        ? { status: "processing", position: 0, etaSeconds: 20, liveText: "Ein junger Erwachsener mit" }
        : { status: "done", result: PROFIL };
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(koerper) });
  });
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.goto("/");
  await page.waitForTimeout(600);
  await page.click('[data-demo="selfie"]');

  /* POSITIVKONTROLLE fuer den Weg selbst: Die gestaffelte Enthuellung verdeckt
     das fertig Gerenderte und deckt es Stueck fuer Stueck wieder auf. Sind nie
     Elemente verdeckt, lief keine Enthuellung — dann waere diese Pruefung
     heimlich eine Kopie der ersten. */
  await expect
    .poll(async () => page.locator(".lv-verdeckt").count(), {
      timeout: 25000,
      message: "Es lief keine gestaffelte Enthuellung — dieser Weg prueft dann nicht, was er soll",
    })
    .toBeGreaterThan(0);
}

/** Haelt die Lockruf-Animationen an und stellt sie auf den Scheitel. */
async function aufScheitel(page) {
  return page.evaluate((ms) => {
    const namen = [];
    for (const a of document.getAnimations()) {
      const name = a.animationName || "";
      if (!name.startsWith("biasLockruf")) continue;
      namen.push(name);
      a.pause();
      a.currentTime = ms;
    }
    return namen;
  }, SCHEITEL_MS);
}

test.describe("Beast-Lockruf", () => {
  /* Ein vollstaendiger Analyse-Durchgang plus drei Sekunden Ruhe plus der
     Lockruf selbst passt nicht in die Standardzeit. */
  test.setTimeout(90000);

  test("kommt nach dem fertigen Profil und bewegt sich wirklich", async ({ page }) => {
    await analyseLaufen(page);
    await expect(page.locator("html")).toHaveAttribute("data-has-result", "1", { timeout: 40000 });
    /* Nach einem Lauf OHNE Live-Text springt die Seite zurueck nach oben
     (api.js: window.scrollTo top 0). Die Pille steht dann unterhalb des
     Bildrands, und der Lockruf wartet zu Recht — ein Hinweis, den niemand
     sieht, ist keiner. Fuer die folgenden Messungen wird sie deshalb ins Bild
     geholt; das entspricht dem, was ein Mensch tut, sobald er das Profil lesen
     will. */
    await page.locator(".bias-toggle").scrollIntoViewIfNeeded();

    const pille = page.locator(".bias-toggle");

    /* Erst muss die Enthuellung durch sein — expect.poll wiederholt von selbst,
       statt auf eine geratene Wartezeit zu setzen. */
    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), {
        timeout: 40000,
        message: "Der Lockruf ist nach dem fertigen Profil nie gekommen",
      })
      .toBe(true);

    /* POSITIVKONTROLLE: Laufen ueberhaupt Lockruf-Animationen? Ohne sie waeren
       alle folgenden Messungen ein perfektes Ergebnis fuer nichts. */
    const namen = await aufScheitel(page);
    expect(namen, "keine einzige Lockruf-Animation aktiv").toEqual(
      expect.arrayContaining(["biasLockrufHeben", "biasLockrufFuellen"])
    );

    /* Die Pille hebt sich WIRKLICH — gemessen an dem, was der Browser rechnet,
       nicht an der Klasse. */
    const hub = await pille.evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { y: m.f, skalierung: m.a };
    });
    expect(hub.y, `Pille hebt sich nicht (translateY = ${hub.y})`).toBeLessThan(-3);
    expect(hub.skalierung, "Pille waechst nicht").toBeGreaterThan(1.01);

    /* Und die Rille laeuft WIRKLICH voll. */
    const fuellung = page.locator(".bias-lockruf-fuellung");
    await expect(fuellung).toHaveCount(1);
    const breite = await fuellung.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    expect(breite, `Rille laeuft nicht voll (scaleX = ${breite})`).toBeGreaterThan(0.9);

    /* Beweisfoto vom Scheitel — die Gestaltung wird angesehen, nicht nur
       gemessen. */
    mkdirSync("test-results", { recursive: true });
    await pille.screenshot({ path: "test-results/lockruf-scheitel.png" });
  });

  test("kommt auch auf dem Weg MIT gestaffelter Enthuellung", async ({ page }) => {
    /* Beim Bauen hing der Lockruf zuerst NUR an der Enthuellung und blieb auf
       dem anderen Weg stumm. Seither senden beide Wege — also muessen auch
       beide geprueft werden, sonst faellt der naechste Umbau in dieselbe
       Grube. */
    await analyseMitEnthuellung(page);

    const pille = page.locator(".bias-toggle");
    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), {
        timeout: 45000,
        message: "Der Lockruf kommt nach der gestaffelten Enthuellung nicht",
      })
      .toBe(true);

    /* Und er kommt NACH der Enthuellung, nicht waehrend ihr: Zu diesem
       Zeitpunkt darf nichts mehr verdeckt sein. */
    const verdeckt = await page.locator(".lv-verdeckt").count();
    expect(verdeckt, "der Lockruf kam mitten in die laufende Enthuellung").toBe(0);
  });

  test("laeuft drei Durchlaeufe, nicht zwei", async ({ page }) => {
    /* Nutzerwunsch 2026-08-19: "Die Bewegung soll 3 Durchlaeufe sein, mit
       2 Sekunden jeweils." Gemessen wird, was der Browser rechnet. */
    await analyseLaufen(page);
    await expect(page.locator("html")).toHaveAttribute("data-has-result", "1", { timeout: 40000 });
    /* Nach einem Lauf OHNE Live-Text springt die Seite zurueck nach oben
     (api.js: window.scrollTo top 0). Die Pille steht dann unterhalb des
     Bildrands, und der Lockruf wartet zu Recht — ein Hinweis, den niemand
     sieht, ist keiner. Fuer die folgenden Messungen wird sie deshalb ins Bild
     geholt; das entspricht dem, was ein Mensch tut, sobald er das Profil lesen
     will. */
    await page.locator(".bias-toggle").scrollIntoViewIfNeeded();

    const pille = page.locator(".bias-toggle");
    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), { timeout: 40000 })
      .toBe(true);

    const takt = await pille.evaluate((el) => {
      const st = getComputedStyle(el);
      return { durchlaeufe: st.animationIterationCount, dauer: st.animationDuration, vorlauf: st.animationDelay };
    });
    expect(takt.durchlaeufe).toBe("3");
    expect(takt.dauer).toBe("2s");
    expect(takt.vorlauf).toBe("0.4s");
  });

  test("wartet, bis die Pille im Bild ist, und geht dann los", async ({ page }) => {
    /* ANLASS 2026-08-19, Nutzerbefund: "Zumindest konnte ich das nicht sehen."
       Der Hinweis lief stur drei Sekunden nach dem Profil los — war die Pille
       zu dem Zeitpunkt weggescrollt, sah ihn niemand, und er kam nie wieder.
       Hier wird das Fenster klein gemacht und ganz nach oben gescrollt, sodass
       die Pille unterhalb des Bildrands liegt. */
    await page.setViewportSize({ width: 390, height: 500 });
    await analyseLaufen(page);
    const pille = page.locator(".bias-toggle");

    /* Warten, bis das Profil fertig ist — dann sofort ganz nach oben. */
    await expect(page.locator("html")).toHaveAttribute("data-has-result", "1", { timeout: 40000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(200);

    /* POSITIVKONTROLLE: Liegt die Pille wirklich ausserhalb des Bildes? Sonst
       prueft der Rest nichts. */
    const drausssen = await pille.evaluate((el) => el.getBoundingClientRect().top > window.innerHeight);
    expect(drausssen, "die Pille ist doch im Bild — der Fall wird nicht geprueft").toBe(true);

    /* Deutlich laenger warten als die drei Sekunden Vorlauf. */
    await page.waitForTimeout(7000);
    await expect(pille, "der Hinweis lief los, obwohl ihn niemand sehen konnte").not.toHaveClass(/bias-lockruf/);

    /* Jetzt ins Bild holen — nun muss er kommen. */
    await pille.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), {
        timeout: 15000,
        message: "der Hinweis kommt auch dann nicht, wenn die Pille sichtbar wird",
      })
      .toBe(true);
  });

  test("bleibt aus, wer den Schalter schon selbst gefunden hat", async ({ page }) => {
    await analyseLaufen(page);

    /* Waehrend die Analyse laeuft, schaltet die Person selbst um. */
    await page.locator("#biasSwitch").click({ force: true });

    /* Enthuellung abwarten plus die drei Sekunden Ruhe plus Puffer. */
    await page.waitForTimeout(20000);
    await expect(page.locator(".bias-toggle")).not.toHaveClass(/bias-lockruf/);
    await expect(page.locator(".bias-lockruf-fuellung")).toHaveCount(0);
  });

  test("raeumt sich restlos ab und laesst den Umschalter unveraendert zurueck", async ({ page }) => {
    await analyseLaufen(page);
    await expect(page.locator("html")).toHaveAttribute("data-has-result", "1", { timeout: 40000 });
    /* Nach einem Lauf OHNE Live-Text springt die Seite zurueck nach oben
     (api.js: window.scrollTo top 0). Die Pille steht dann unterhalb des
     Bildrands, und der Lockruf wartet zu Recht — ein Hinweis, den niemand
     sieht, ist keiner. Fuer die folgenden Messungen wird sie deshalb ins Bild
     geholt; das entspricht dem, was ein Mensch tut, sobald er das Profil lesen
     will. */
    await page.locator(".bias-toggle").scrollIntoViewIfNeeded();

    const pille = page.locator(".bias-toggle");

    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), { timeout: 40000 })
      .toBe(true);

    await expect
      .poll(async () => pille.evaluate((el) => el.classList.contains("bias-lockruf")), {
        timeout: 15000,
        message: "Der Lockruf hoert nie wieder auf",
      })
      .toBe(false);

    await expect(page.locator(".bias-lockruf-fuellung")).toHaveCount(0);
    const rest = await pille.evaluate((el) => getComputedStyle(el).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"], `Pille bleibt verschoben: ${rest}`).toContain(rest);
  });
});
