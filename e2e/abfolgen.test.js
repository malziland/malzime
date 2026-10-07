import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ── Abfolgen im Browser ─────────────────────────────────────────────────────
 *
 * Hier stehen Abläufe, bei denen es auf die REIHENFOLGE ankommt: zwei Klicks
 * kurz nacheinander, ein Tab-Wechsel mitten im Lauf, ein Netz, das wegbleibt,
 * ohne dass der Browser sich als getrennt meldet. Jeder Test bedient die Seite
 * über den echten Eingabeweg (Klick, Dateiwahl) und fälscht nur die Antworten
 * des Servers — so ist belegt, dass der Weg vom Finger bis zum Bildschirm zum
 * richtigen Bild führt.
 *
 * Nichts geht nach außen: Der Riegel bricht jede Anfrage an fremde Dienste ab.
 */

const RIEGEL = /run\.app|cloudfunctions\.net|mistral|nominatim|openstreetmap/;

const STATS = {
  current: { count: 12, limit: 500, limitActive: false, retryAfterSeconds: 0, hourlyTotal: 12 },
  totals: { today: 12, week: 60, month: 300, total: 2000, allTime: 2000 },
};

const SCHLUESSEL = [
  "alter_geschlecht",
  "herkunft",
  "beziehungsstatus",
  "bildung",
  "persoenlichkeit",
  "charakterzuege",
  "interessen",
  "einkommen",
  "kaufkraft",
  "werbeprofil",
  "verletzlichkeit",
  "gesundheit",
  "politisch",
];

function profil(art) {
  const categories = {};
  for (const k of SCHLUESSEL)
    categories[k] = { label: `${art}-LABEL-${k}`, value: `${art}-WERT-${k}`, confidence: 0.8 };
  return {
    profileText: `${art}-PROFILTEXT`,
    categories,
    ad_targeting: [`${art}-WERBUNG`],
    manipulation_triggers: [`${art}-TRIGGER`],
  };
}

function karten(art, n = SCHLUESSEL.length) {
  return SCHLUESSEL.slice(0, n).map((k) => ({
    schluessel: k,
    bezeichnung: `${art}-LABEL-${k}`,
    wert: `${art}-WERT-${k}`,
  }));
}

const ERGEBNIS = {
  profiles: { normal: profil("SERIOES"), boost: profil("BEAST") },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
};

const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

/* Ein Foto MIT Ort und Aufnahmedatum in den Bilddaten: eines der Beispielbilder
   (ihre Ortsdaten sind erfunden). */
const BILD_MIT_ORT = readFileSync(join(process.cwd(), "public", "img", "demo", "demo-selfie.jpg"));

function json(r, status, body) {
  return r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function grundrouten(page, context, stats = STATS) {
  await context.route(RIEGEL, (r) => r.abort());
  await page.route("**/api/stats", (r) => json(r, 200, stats));
  await page.route("**/api/errors", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/telemetry", (r) => r.fulfill({ status: 204, body: "" }));
}

/* Die Seite nimmt in den ersten zwei Sekunden keinen Upload an (Schutz gegen
   Automaten). Wer hier früher klickt, misst diese Wartezeit mit. */
async function seiteOeffnen(page, adresse = "/?lang=de") {
  await page.goto(adresse);
  await page.waitForTimeout(2200);
}

async function fotoWaehlen(page, name = "foto.jpg") {
  await page.setInputFiles("#fileInput", { name, mimeType: "image/jpeg", buffer: MINI_JPEG });
}

function fingerabdruck(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const ERGEBNIS_SICHTBAR = "#simulation .verdict-text";

/* ── BUG-2026-10-03-45: Wer überholt ist, schreibt nichts mehr ─────────────── */

test.describe("Zwei Auswahlen kurz nacheinander", () => {
  test("zwei Beispielbilder: analysiert wird das zuletzt gewählte, das auch in der Vorschau steht", async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    await grundrouten(page, context);
    const hochgeladen = [];
    await page.route("**/api/enqueue", async (r) => {
      hochgeladen.push(fingerabdruck(JSON.parse(r.request().postData()).imageBase64));
      await json(r, 200, { jobId: `job-${hochgeladen.length}`, resultToken: "tok" });
    });
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));

    /* Erfolgsweg und Referenz zugleich: Jedes Beispielbild einzeln angetippt —
       welcher Fingerabdruck geht zum Server? */
    async function einzeln(name) {
      await seiteOeffnen(page);
      hochgeladen.length = 0;
      await page.click(`[data-demo="${name}"]`);
      await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
      expect(hochgeladen).toHaveLength(1);
      /* Der Tab merkt sich den Auftrag, damit ein Neuladen das Ergebnis
         wiederholt. Für den nächsten Durchgang stört das: Die Seite zeigte
         sonst sofort das vorige Ergebnis. */
      await page.evaluate(() => sessionStorage.clear());
      return hochgeladen[0];
    }
    const refSelfie = await einzeln("selfie");
    const refCafe = await einzeln("cafe");
    expect(refSelfie).not.toBe(refCafe);

    /* Langsames Netz: Jedes Beispielbild braucht 0,6 s. Der zweite Klick kommt
       0,1 s nach dem ersten — das erste Bild ist da noch nicht geladen. */
    await page.route(/img\/demo\/demo-(selfie|cafe)\.jpg/, async (r) => {
      await new Promise((x) => setTimeout(x, 600));
      await r.continue();
    });
    await seiteOeffnen(page);
    hochgeladen.length = 0;
    await page.click('[data-demo="selfie"]');
    await page.waitForTimeout(100);
    await page.click('[data-demo="cafe"]');
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500); /* Zeit für einen etwaigen zweiten Upload */

    const vorschau = await page.evaluate(async () => {
      const s = (await import("/js/state.js")).state;
      return s.lastFile ? s.lastFile.name : null;
    });
    expect(vorschau).toBe("demo-cafe.jpg");
    /* Das Profil auf dem Bildschirm gehört zum Bild in der Vorschau — und das
       überholte erste Bild ist gar nicht erst hochgeladen worden. */
    expect(hochgeladen).toEqual([refCafe]);
  });

  test("Beispielbild angetippt, vor dem Laden ein Foto hochgeladen: Vorschau und Analyse gehören zum hochgeladenen Foto", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await grundrouten(page, context);
    const hochgeladen = [];
    await page.route("**/api/enqueue", async (r) => {
      hochgeladen.push(JSON.parse(r.request().postData()).imageBase64.length);
      await json(r, 200, { jobId: `job-${hochgeladen.length}`, resultToken: "tok" });
    });
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));
    await page.route(/img\/demo\/demo-cafe\.jpg/, async (r) => {
      await new Promise((x) => setTimeout(x, 1200));
      await r.continue();
    });
    await seiteOeffnen(page);
    await page.click('[data-demo="cafe"]');
    await page.waitForTimeout(150);
    await fotoWaehlen(page, "hochgeladenes-foto.jpg");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500); /* das Beispielbild ist inzwischen geladen */

    const mess = await page.evaluate(async () => {
      const s = (await import("/js/state.js")).state;
      const img = document.querySelector("#imagePreview img");
      return { lastFile: s.lastFile ? s.lastFile.name : null, vorschauBreite: img ? img.naturalWidth : null };
    });
    /* Zuletzt gewählt wurde das hochgeladene Foto (1 Pixel breit) — es steht
       in der Vorschau, und nur es ist zum Server gegangen. */
    expect(mess.lastFile).toBe("hochgeladenes-foto.jpg");
    expect(mess.vorschauBreite).toBe(1);
    expect(hochgeladen).toHaveLength(1);
    expect(hochgeladen[0]).toBeLessThan(5000);
  });
});

test.describe("Zweites Foto, während das erste noch aufbereitet wird", () => {
  /* Das erste Foto trägt Ort und Aufnahmedatum (es ist eines der Beispielbilder,
     hier aber über die Dateiwahl HOCHGELADEN — dann gilt es als gewöhnliches
     Foto). Sein Einlesen dauert künstlich 1,5 Sekunden: ein großes Foto auf
     einem langsamen Gerät. Das zweite Foto trägt keine Ortsdaten. */
  const LANGSAM = "erstes-foto-mit-ort.jpg";

  async function langsamesEinlesen(page) {
    await page.addInitScript((name) => {
      const echt = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        if (this instanceof File && this.name === name) {
          return new Promise((weiter) => setTimeout(weiter, 1500)).then(() => echt.call(this));
        }
        return echt.call(this);
      };
    }, LANGSAM);
  }

  async function routen(page, context) {
    await grundrouten(page, context);
    const hochgeladen = [];
    await page.route("**/api/enqueue", async (r) => {
      hochgeladen.push(JSON.parse(r.request().postData()).imageBase64.length);
      await json(r, 200, { jobId: `job-${hochgeladen.length}`, resultToken: "tok" });
    });
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));
    return hochgeladen;
  }

  const ortImErgebnis = (page) =>
    page.evaluate(() => ({
      karte: document.getElementById("gpsMap").children.length,
      fotodaten: document.getElementById("privacy").textContent,
    }));

  test("Erfolgsweg: das Foto mit Ort allein zeigt seine Landkarte", async ({ page, context }) => {
    test.setTimeout(60000);
    await langsamesEinlesen(page);
    const hochgeladen = await routen(page, context);
    await seiteOeffnen(page);
    await page.setInputFiles("#fileInput", { name: LANGSAM, mimeType: "image/jpeg", buffer: BILD_MIT_ORT });
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    expect(hochgeladen).toHaveLength(1);
    expect((await ortImErgebnis(page)).karte).toBeGreaterThan(0);
  });

  test("Ort und Aufnahmedatum des ersten Fotos stehen nicht im Ergebnis des zweiten", async ({ page, context }) => {
    test.setTimeout(60000);
    await langsamesEinlesen(page);
    const hochgeladen = await routen(page, context);
    await seiteOeffnen(page);
    await page.setInputFiles("#fileInput", { name: LANGSAM, mimeType: "image/jpeg", buffer: BILD_MIT_ORT });
    await fotoWaehlen(page, "zweites-foto.jpg");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500); /* das erste Foto ist inzwischen fertig aufbereitet */

    /* Zum Server ging nur das zweite Foto (1 Pixel, wenige hundert Zeichen). */
    expect(hochgeladen).toHaveLength(1);
    expect(hochgeladen[0]).toBeLessThan(5000);
    const mess = await ortImErgebnis(page);
    expect(mess.karte).toBe(0);
    const gemerkt = await page.evaluate(async () => {
      const s = (await import("/js/state.js")).state;
      return { ort: Boolean(s.lastPrepared && s.lastPrepared.gps), laenge: s.lastPrepared.imageBase64.length };
    });
    /* Die gemerkte Aufbereitung gehört zum zweiten Foto. */
    expect(gemerkt.ort).toBe(false);
    expect(gemerkt.laenge).toBe(hochgeladen[0]);
  });
});

/* ── PRIV-2026-10-03-57: Ein verworfenes Foto wird nicht weiter verarbeitet ── */

test.describe("Anderes Foto gewählt, während das erste unterwegs ist", () => {
  test("während des Hochladens: der erste Upload wird abgebrochen, ohne Fehlermeldung", async ({ page, context }) => {
    test.setTimeout(60000);
    await grundrouten(page, context);
    const einreihungen = [];
    const abgebrochen = [];
    let ersteFreigeben;
    const ersteHaengt = new Promise((weiter) => (ersteFreigeben = weiter));
    page.on("requestfailed", (anfrage) => {
      if (anfrage.url().includes("/api/enqueue")) abgebrochen.push(anfrage.failure()?.errorText || "");
    });
    await page.route("**/api/enqueue", async (r) => {
      einreihungen.push(r.request());
      if (einreihungen.length === 1) {
        /* Langsamer Upload: Die erste Anfrage bekommt bis zum Testende keine Antwort. */
        await ersteHaengt;
        return r.abort().catch(() => {});
      }
      return json(r, 200, { jobId: "job-2", resultToken: "tok-2" });
    });
    const abfragen = [];
    await page.route("**/api/job-status*", (r) => {
      abfragen.push(`${r.request().method()} ${new URL(r.request().url()).searchParams.get("jobId")}`);
      return json(r, 200, { status: "done", result: ERGEBNIS });
    });
    await seiteOeffnen(page);
    await fotoWaehlen(page, "falsches-foto.jpg");
    await expect.poll(() => einreihungen.length, { timeout: 15000 }).toBe(1);
    await fotoWaehlen(page, "richtiges-foto.jpg");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });

    /* Der Browser hat den ersten Upload selbst beendet, als das zweite Foto kam. */
    expect(abgebrochen).toHaveLength(1);
    expect(einreihungen).toHaveLength(2);
    /* Abgefragt wird nur der Auftrag des zweiten Fotos. */
    expect(new Set(abfragen)).toEqual(new Set(["GET job-2"]));
    /* Der Abbruch ist kein Fehler. */
    await expect(page.locator("#status")).toHaveText("");
    ersteFreigeben();
  });

  test("nach dem Einreihen: der Browser meldet den verworfenen Auftrag mit seinem Abhol-Ticket ab", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await grundrouten(page, context);
    let einreihungen = 0;
    await page.route("**/api/enqueue", (r) => {
      einreihungen += 1;
      return json(r, 200, { jobId: `job-${einreihungen}`, resultToken: `tok-${einreihungen}` });
    });
    const abmeldungen = [];
    const abfragen = [];
    await page.route("**/api/job-status*", (r) => {
      const adresse = new URL(r.request().url());
      const auftrag = adresse.searchParams.get("jobId");
      if (r.request().method() === "DELETE") {
        abmeldungen.push(`${auftrag} ${adresse.searchParams.get("token")}`);
        return json(r, 200, { verworfen: true });
      }
      abfragen.push(auftrag);
      /* Der erste Auftrag wartet in der Schlange, der zweite ist sofort fertig. */
      if (auftrag === "job-1") return json(r, 200, { status: "queued", position: 3, etaSeconds: 60 });
      return json(r, 200, { status: "done", result: ERGEBNIS });
    });
    await seiteOeffnen(page);
    await fotoWaehlen(page, "falsches-foto.jpg");
    /* Erfolgsweg: Solange niemand ein anderes Foto wählt, wird abgefragt und nichts abgemeldet. */
    await expect.poll(() => abfragen.filter((a) => a === "job-1").length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(abmeldungen).toEqual([]);

    await fotoWaehlen(page, "richtiges-foto.jpg");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => abmeldungen.length, { timeout: 10000 }).toBe(1);
    expect(abmeldungen).toEqual(["job-1 tok-1"]);
    /* Der Auftrag des zweiten Fotos bleibt unangetastet. */
    await page.waitForTimeout(2500);
    expect(abmeldungen).toEqual(["job-1 tok-1"]);
  });
});

/* ── BUG-2026-10-03-46: „erscheint automatisch" wird eingelöst ─────────────── */

test.describe("Netz weg, ohne dass der Browser sich als getrennt meldet", () => {
  test("fünf gescheiterte Abfragen, dann ist der Server wieder da: Das Ergebnis erscheint von selbst", async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    const abfragen = [];
    await page.route("**/api/job-status*", async (r) => {
      abfragen.push(new URL(r.request().url()).searchParams.get("token"));
      /* Die ersten fünf Abfragen scheitern am Netz (WLAN verbunden, Internet
         weg) — der Browser bleibt dabei „online". Danach ist der Server wieder
         erreichbar und hat das fertige Ergebnis. */
      if (abfragen.length <= 5) return r.abort("failed");
      return json(r, 200, { status: "done", result: ERGEBNIS });
    });
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("Verbindung unterbrochen", { timeout: 40000 });
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    expect(abfragen).toHaveLength(5);

    /* Sitzen bleiben: kein Tab-Wechsel, kein Neuladen, kein Ereignis „online". */
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 45000 });
    await expect(page.locator("#status")).toHaveText("");
    /* Die sechste Abfrage war die stille Prüfung ohne Abhol-Ticket, die
       siebte hat mit Ticket abgeholt. */
    expect(abfragen.slice(5, 7)).toEqual([null, "tok"]);
  });
});

test.describe("Tab kurz weg und zurück mitten im Lauf", () => {
  test.use({ reducedMotion: "reduce" });

  test("nach der Rückkehr stehen keine halb gefüllten Merkmal-Karten neben der Wartefigur", async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    let haengen = false;
    await page.route("**/api/job-status*", async (r) => {
      if (haengen) {
        haengen = false;
        /* Eingefrorener Tab: Diese Abfrage bleibt zehn Sekunden ohne Antwort. */
        await new Promise((x) => setTimeout(x, 10000));
      }
      return json(r, 200, {
        status: "processing",
        liveText: "Die KI schreibt gerade über dich.",
        liveKartenStandard: karten("SERIOES", 5),
        liveTextVersuch: 1,
      });
    });
    await seiteOeffnen(page);
    await page.click('[data-demo="selfie"]');
    await page.waitForFunction(
      () => document.querySelectorAll("#facts .cat-card:not(.cat-card--unscharf)").length >= 5,
      null,
      { timeout: 60000 }
    );
    const lesen = () =>
      page.evaluate(() => {
        const q = (id) => document.getElementById(id);
        return {
          wartefigur: q("scanAnim").classList.contains("active"),
          liveKarte: q("liveKarte").classList.contains("active"),
          karten: q("facts").querySelectorAll(".cat-card").length,
        };
      });
    /* Erfolgsweg: Vor dem Tab-Wechsel stehen alle 13 Karten als Gerüst da. */
    expect((await lesen()).karten).toBe(13);

    haengen = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(9500);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(1500);

    /* Die Wiederaufnahme zeigt die Wartefigur und tippt nicht weiter. Dann
       dürfen auch keine Karten stehen bleiben, die sich nie mehr füllen. */
    const danach = await lesen();
    expect(danach.wartefigur).toBe(true);
    expect(danach.liveKarte).toBe(false);
    expect(danach.karten).toBe(0);
  });
});
