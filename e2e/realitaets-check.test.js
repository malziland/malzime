import { test, expect } from "@playwright/test";

/* Realitäts-Check (v3.1): kompletter Durchlauf mit gemockter Analyse —
   Foto wählen → Ergebnis erscheint samt Check-Karte → alle Zeilen
   beantworten → absenden → Ring mit der richtigen Prozentzahl +
   Vergleichsbalken (Zähler steht über 100) → zweites Foto setzt alles
   zurück. Der Telemetrie-POST wird abgefangen und auf seine Minimal-Form
   geprüft (NUR die Stufen — nichts Verknüpfbares). */

const MOCK_RESPONSE = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.8 },
        interessen: { label: "Interessen", value: "Outdoor, Fotografie", confidence: 0.7 },
        charakterzuege: { label: "Charakterzüge", value: "diszipliniert, planend", confidence: 0.6 },
        werbeprofil: { label: "Werbeprofil", value: "Reise-Angebote, Abo-Modelle", confidence: 0.7 },
      },
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote", "Foto-Kurs"],
      manipulation_triggers: ["FOMO", "Statusvergleich"],
      profileText: "Ein aktiver Mensch mit Hang zu geplanten Bildern. Nichts davon ist wahr.",
    },
    boost: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30, männlich — Zielgruppe", confidence: 0.9 },
      },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Mode-Profil.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "rc-e2e-1", mode: "multimodal" },
};

async function seiteMitMocks(page) {
  /* Stats: der anonyme Zähler steht über 100 → der Vergleichsbalken darf
     nach dem Absenden erscheinen (Ø 58 %). */
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 10, week: 50, month: 200, total: 1000 },
        realitaetsCheck: { eingaben: 137, mittelProzent: 58 },
        useQueue: true,
      }),
    })
  );
  let jobNr = 0;
  await page.route("**/api/enqueue", (route) => {
    jobNr += 1;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "rc-job-" + jobNr, resultToken: "rc-token-" + jobNr }),
    });
  });
  /* Ohne Live-Text: klassischer Pfad — das Ergebnis erscheint mit dem Render. */
  await page.route("**/api/job-status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", result: MOCK_RESPONSE }),
    })
  );
  /* Telemetrie abfangen und die Nutzlast fuer die Pruefung einsammeln. */
  const telemetrie = [];
  await page.route("**/api/telemetry", (route) => {
    try {
      telemetrie.push(route.request().postDataJSON());
    } catch (_e) {
      /* kein JSON — ignorieren */
    }
    route.fulfill({ status: 204, body: "" });
  });
  /* Kein externer Call im Test (die Demo-Bilder tragen fiktive GPS-Daten). */
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );

  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  return telemetrie;
}

test("Realitäts-Check: tippen → absenden → Ring mit richtiger Prozentzahl → zweites Foto setzt zurück", async ({
  page,
}) => {
  test.setTimeout(90000);
  const telemetrie = await seiteMitMocks(page);

  await page.click('[data-demo="selfie"]');
  await expect(page.locator("#disclaimerModal")).toHaveClass(/active/, { timeout: 10000 });
  await page.click("#disclaimerConfirm");

  /* Das Ergebnis erscheint — die Check-Karte steht zwischen Manipulations-
     Box und Datenwert und zeigt 6 Zeilen (Geschlecht ist eindeutig). */
  await expect(page.locator("#simulation .verdict")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#realCheck")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#realCheck .rc-zeile")).toHaveCount(6);
  /* Das Zitat der ersten Zeile stammt aus dem echten Profil. */
  await expect(page.locator("#realCheck .rc-zitat").first()).toContainText("25-30 Jahre");

  /* Absenden ist gesperrt, bis JEDE Zeile beantwortet ist. */
  await expect(page.locator("#rcAbsenden")).toBeDisabled();

  /* Antworten: alter=Getroffen(1), geschlecht=Getroffen(1, binär),
     interessen=Knapp(0,5), charakter=Daneben(0), werbung=Getroffen(1),
     manipulation=Knapp(0,5) → 4,0 / 6 → 67 % */
  const zeilen = page.locator("#realCheck .rc-zeile");
  await zeilen.nth(0).locator(".rc-knopf").nth(0).click();
  await zeilen.nth(1).locator(".rc-knopf").nth(0).click();
  await zeilen.nth(2).locator(".rc-knopf").nth(1).click();
  await zeilen.nth(3).locator(".rc-knopf").nth(2).click();
  await zeilen.nth(4).locator(".rc-knopf").nth(0).click();
  await zeilen.nth(5).locator(".rc-knopf").nth(1).click();

  await expect(page.locator("#rcAbsenden")).toBeEnabled();
  await page.click("#rcAbsenden");

  /* Ring fährt auf die richtige Prozentzahl, der Vergleichsbalken erscheint
     (Zähler > 100), die Antwort-Box füllt sich. */
  await expect(page.locator("#rcProzent")).toHaveText("67", { timeout: 15000 });
  await expect(page.locator("#rcVergleich")).toBeVisible();
  await expect(page.locator("#rcWenige")).toBeHidden();
  await expect(page.locator("#rcAntwort")).not.toBeEmpty();

  /* Eingefroren: der Absenden-Knopf ist weg, Antworten unveränderlich. */
  await expect(page.locator("#rcAbsenden")).toBeHidden();
  const gewaehlt = await zeilen.nth(0).locator(".rc-knopf.gewaehlt").innerText();
  await zeilen.nth(0).locator(".rc-knopf").nth(2).click({ force: true });
  await expect(zeilen.nth(0).locator(".rc-knopf.gewaehlt")).toHaveText(gewaehlt);

  /* Der anonyme Zähler bekam GENAU EIN Ereignis — und AUSSCHLIESSLICH die
     Stufen (keine traceId, keine jobId, kein UserAgent). */
  const rcEreignisse = telemetrie.filter((e) => e && e.eventType === "realitaets-check");
  expect(rcEreignisse).toHaveLength(1);
  expect(Object.keys(rcEreignisse[0]).sort()).toEqual(["eventType", "stufen"]);
  expect(rcEreignisse[0].stufen).toEqual({
    alter: 1,
    geschlecht: 1,
    interessen: 0.5,
    charakter: 0,
    werbung: 1,
    manipulation: 0.5,
  });

  /* Zweites Foto: alles zurückgesetzt — Karte frisch, Ergebnis weg,
     Absenden wieder da und gesperrt. */
  await page.click('[data-demo="cafe"]');
  await expect(page.locator("#simulation .verdict")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#realCheck")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#rcErgebnis")).toBeHidden();
  await expect(page.locator("#rcAbsenden")).toBeVisible();
  await expect(page.locator("#rcAbsenden")).toBeDisabled();
  await expect(page.locator("#realCheck .rc-knopf.gewaehlt")).toHaveCount(0);
});
