import { test, expect } from "@playwright/test";

/* v3.0 Live-Erlebnis: Der Server (Flag useLiveText) liefert in den
   processing-Antworten den bereits angekommenen Profiltext mit. Die Seite
   tippt ihn in der Live-Karte (Matrix-Dekodierung) und fährt nach `done`
   die gestaffelte Enthüllung. Hier wird /api/job-status gemockt: zweimal
   processing mit wachsendem liveText, dann done mit vollem Ergebnis. */

const PROFIL_TEXT =
  "Ein junger Erwachsener mit aktivem Lebensstil, der gern unterwegs ist und Momente festhält. " +
  "Das Foto verrät eine Vorliebe für urbane Umgebungen, geplante Bildausschnitte und gutes Licht. " +
  "Algorithmen würden daraus Kaufkraft, Reiselust und eine hohe Empfänglichkeit für zeitlich begrenzte Angebote ableiten. " +
  "Nichts davon ist wahr — aber alles davon ist möglich.";

const LIVE_WELLE_1 = PROFIL_TEXT.slice(0, 230);
const LIVE_WELLE_2 = PROFIL_TEXT;

/* Beast-Text fuer den Modus-Wechsel-Fall — lang genug fuer den Anlauf-
   Mindestpuffer (~200 Zeichen) der Live-Anzeige. */
const BEAST_TEXT =
  "Du willst gesehen werden, und genau das macht dich berechenbar: Jede Pose sitzt, jedes Licht ist geplant, nichts ist Zufall. " +
  "Algorithmen lieben Profile wie deines — sie wissen vor dir, wann du schwach wirst, und verkaufen dir dann Status im Abo. " +
  "Nichts davon ist wahr — aber genau so würde eine Maschine dich lesen.";

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.8 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.6 },
        werbeprofil: { label: "Werbeprofil", value: "Reise-Angebote, Abo-Modelle", confidence: 0.7 },
      },
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote"],
      manipulation_triggers: ["FOMO", "Statusvergleich"],
      profileText: PROFIL_TEXT,
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
  meta: { requestId: "live-e2e-123", mode: "multimodal" },
};

/* Routen, die alle Live-Faelle brauchen: stats, enqueue, kein externer Call. */
async function basisRouten(page) {
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
      body: JSON.stringify({ jobId: "live-job-1", resultToken: "live-token-1" }),
    })
  );
  /* Kein externer Call im Test (die Demo-Bilder tragen fiktive GPS-Daten). */
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
}

async function seiteMitLiveMocks(page) {
  await basisRouten(page);
  /* Die Poll-Folge: 2× processing mit wachsendem Live-Text, dann done. */
  let poll = 0;
  await page.route("**/api/job-status**", (route) => {
    poll += 1;
    const body =
      poll === 1
        ? { status: "processing", position: 0, etaSeconds: 60, liveText: LIVE_WELLE_1 }
        : poll === 2
          ? { status: "processing", position: 0, etaSeconds: 60, liveText: LIVE_WELLE_2 }
          : { status: "done", result: MOCK_RESPONSE };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
}

/* Fuer den Modus-Wechsel-Fall: erst nur Standard-Text, ab dem 2. Poll BEIDE
   Felder (Beast beginnt im echten Stream spaeter — das bilden die Polls ab).
   `processing` haelt an, bis der Test fertigMachen() ruft — so bleibt sicher
   Zeit, den Schalter MITTEN im Stream umzulegen. */
async function seiteMitBeastMocks(page) {
  await basisRouten(page);
  let fertig = false;
  let poll = 0;
  await page.route("**/api/job-status**", (route) => {
    poll += 1;
    const body = fertig
      ? { status: "done", result: MOCK_RESPONSE }
      : poll === 1
        ? { status: "processing", position: 0, etaSeconds: 60, liveText: LIVE_WELLE_1 }
        : { status: "processing", position: 0, etaSeconds: 60, liveText: LIVE_WELLE_2, liveTextBeast: BEAST_TEXT };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  return {
    fertigMachen() {
      fertig = true;
    },
  };
}

test("Live-Erlebnis: Karte tippt wachsenden Text, danach Enthüllung bis zum PDF-Knopf", async ({ page }) => {
  test.setTimeout(90000);
  await seiteMitLiveMocks(page);

  await page.click('[data-demo="selfie"]');

  /* v3.0.1 (FIX 3): Der Hinweis-Dialog steht jetzt VOR der Analyse —
     bestätigen, dann startet der Upload. */
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 10000 });
  await page.click("#disclaimerConfirm");

  /* Die Live-Karte übernimmt (erste Welle ≥ Anlauf-Puffer) und die
     Scan-Animation verschwindet mit dem ersten getippten Zeichen. */
  await expect(page.locator("#liveKarte")).toHaveClass(/active/, { timeout: 20000 });
  await expect(page.locator("#scanAnim")).not.toHaveClass(/active/);

  /* Der Text WÄCHST — erst ein Stück, später mehr (Matrix-Tippen). */
  await expect
    .poll(async () => (await page.locator("#liveTextFest").textContent()).length, { timeout: 15000 })
    .toBeGreaterThan(10);
  const zwischenstand = (await page.locator("#liveTextFest").textContent()).length;
  await expect
    .poll(async () => (await page.locator("#liveTextFest").textContent()).length, { timeout: 15000 })
    .toBeGreaterThan(zwischenstand);

  /* done → KEIN zweites Modal mehr (FIX 3): das Ergebnis rendert direkt und
     die Enthüllung läuft an; die Zusammenfassung steht in ihrer normalen Box. */
  await expect(page.locator("#simulation .verdict")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#disclaimerModal")).not.toHaveClass(/active/);
  /* Während der Enthüllung ist der PDF-Knopf noch verborgen. */
  await expect(page.locator("#exportPdf")).toHaveClass(/export-btn--hidden/);

  /* Am Ende der Staffel: Ergebnis-Bereiche sichtbar, PDF-Knopf da. */
  await expect(page.locator("#facts .cat-card").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#targeting .target-card.warn")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#dataValue .dv-card")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#exportPdf")).not.toHaveClass(/export-btn--hidden/, { timeout: 30000 });
  await expect(page.locator("#liveStatusText")).toHaveText(/nichts davon ist wahr|none of this is true/i);
});

test("Modus-Wechsel mitten im Stream: die Live-Karte springt auf den Beast-Text und tippt dort weiter", async ({
  page,
}) => {
  test.setTimeout(90000);
  const steuerung = await seiteMitBeastMocks(page);

  await page.click('[data-demo="selfie"]');

  /* v3.0.1 (FIX 3): Hinweis vor dem Start bestätigen. */
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 10000 });
  await page.click("#disclaimerConfirm");

  /* Erst tippt der seriöse Text wie gewohnt. */
  await expect(page.locator("#liveKarte")).toHaveClass(/active/, { timeout: 20000 });
  await expect
    .poll(async () => (await page.locator("#liveTextFest").textContent()).length, { timeout: 15000 })
    .toBeGreaterThan(10);
  expect(PROFIL_TEXT.startsWith(await page.locator("#liveTextFest").textContent())).toBe(true);

  /* MITTEN im Stream auf Beast schalten (wie in modus-merken.test.js). */
  await page.evaluate(() => document.getElementById("biasSwitch").click());

  /* Jetzt gehört die Karte dem Beast-Text: Er beginnt am eigenen Anfang
     (kein Rest des seriösen Texts) und tippt weiter. Bis die Beast-Welle
     eintrifft, überbrückt die Karte mit dem Warte-Status. */
  await expect
    .poll(async () => (await page.locator("#liveTextFest").textContent()) || "", { timeout: 15000 })
    .toMatch(/^Du willst gesehen werden/);
  const beastStand = (await page.locator("#liveTextFest").textContent()).length;
  await expect
    .poll(async () => (await page.locator("#liveTextFest").textContent()).length, { timeout: 15000 })
    .toBeGreaterThan(beastStand);

  /* done → der Abschluss rendert direkt, ohne zweites Modal (FIX 3) — auch
     im Beast-Modus. */
  steuerung.fertigMachen();
  await expect(page.locator("#simulation .verdict")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#disclaimerModal")).not.toHaveClass(/active/);
});

test("Live-Erlebnis mit reduced-motion: Text sofort vollständig, Enthüllung ohne Verzögerung", async ({ page }) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seiteMitLiveMocks(page);

  await page.click('[data-demo="selfie"]');

  /* v3.0.1 (FIX 3): Hinweis vor dem Start bestätigen. */
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 10000 });
  await page.click("#disclaimerConfirm");

  await expect(page.locator("#liveKarte")).toHaveClass(/active/, { timeout: 20000 });
  /* Kein Tippen: kurz nach dem Erscheinen steht bereits eine KOMPLETTE Welle
     da (beim Tippen wären nach 200 ms erst ~14 Zeichen sichtbar). */
  await page.waitForTimeout(200);
  const text = await page.locator("#liveTextFest").textContent();
  expect(text === LIVE_WELLE_1 || text === LIVE_WELLE_2).toBe(true);
  /* Und kein Rausch-Schweif. */
  await expect(page.locator("#liveTextRausch")).toHaveText("");

  /* done → direkt gerendert (kein zweites Modal, FIX 3); die Enthüllung läuft
     ohne Verzögerungen — alles praktisch sofort sichtbar. */
  await expect(page.locator("#exportPdf")).not.toHaveClass(/export-btn--hidden/, { timeout: 30000 });
  await expect(page.locator("#disclaimerModal")).not.toHaveClass(/active/);
  await expect(page.locator("#facts .cat-card").first()).toBeVisible();
  await expect(page.locator("#dataValue .dv-card")).toBeVisible();
});
