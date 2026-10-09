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

/* ── UX-2026-10-03-48: Die Seite spricht EINE Sprache ───────────────────────── */

test.describe("Sprachwechsel und Sprachreste", () => {
  const ZU_ENGLISCH = '.sprach-knopf[data-lang="en"]';

  test("gescheiterte Analyse, dann Wechsel auf Englisch: Die Fehlermeldung wechselt mit", async ({ page, context }) => {
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "failed", errorReason: "mistral_error" }));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("Es ist ein Fehler aufgetreten", { timeout: 15000 });

    await page.click(ZU_ENGLISCH);
    await expect(page.locator("h1")).toHaveText("We see more than your photo.");
    /* Es läuft nichts und es steht kein Ergebnis da: Wechsel ohne Rückfrage. */
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
    await expect(page.locator("#status")).toContainText("Something went wrong");
    await expect(page.locator("#status")).not.toContainText("Es ist ein Fehler");
  });

  test("englische Seite: Der Sprunglink ist englisch — und deutsch auf der deutschen", async ({ page, context }) => {
    await grundrouten(page, context);
    for (const [adresse, text] of [
      ["/?lang=en", "Skip to content"],
      ["/?lang=de", "Zum Inhalt springen"],
      ["/stats.html?lang=en", "Skip to content"],
      ["/stats.html?lang=de", "Zum Inhalt springen"],
    ]) {
      await page.goto(adresse);
      await expect(page.locator("html")).toHaveAttribute("lang", adresse.slice(-2));
      await expect(page.locator(".skip-link").first(), adresse).toHaveText(text);
    }
    /* Auch nach einem Wechsel im laufenden Betrieb. */
    await page.click(ZU_ENGLISCH);
    await expect(page.locator(".skip-link").first()).toHaveText("Skip to content");
  });

  test("„Verbindung unterbrochen“, dann Wechsel auf Englisch: Die Seite fragt nach und analysiert neu — kein deutsches Profil unter englischer Seite", async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    await grundrouten(page, context);
    const sprachen = [];
    await page.route("**/api/enqueue", async (r) => {
      sprachen.push(JSON.parse(r.request().postData()).lang);
      await json(r, 200, { jobId: `job-${sprachen.length}`, resultToken: "tok" });
    });
    let netzWeg = true;
    await page.route("**/api/job-status*", (r) => {
      if (r.request().method() === "DELETE") return json(r, 200, { verworfen: true });
      if (netzWeg) return r.abort("failed");
      return json(r, 200, { status: "done", result: ERGEBNIS });
    });
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("Verbindung unterbrochen", { timeout: 40000 });

    await page.click(ZU_ENGLISCH);
    /* Der wartende Durchgang zählt wie ein laufender: erst die Rückfrage. */
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    netzWeg = false;
    await page.locator(".sw-grund.sichtbar button", { hasText: "Auf Englisch wechseln" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 30000 });
    /* Das angezeigte Profil stammt aus einem Auftrag in der Sprache der Seite. */
    expect(sprachen).toEqual(["de", "en"]);
  });

  test("Sprachdatei nicht ladbar: Der Klick auf „EN“ bleibt nicht ohne Rückmeldung", async ({ page, context }) => {
    await grundrouten(page, context);
    await page.route("**/locales/en.json", (r) => r.abort("failed"));
    await page.goto("/?lang=de");
    await expect(page.locator("h1")).toHaveText("Wir sehen mehr als dein Foto.");
    await expect(page.locator("#status")).toHaveText("");
    await page.click(ZU_ENGLISCH);
    /* Die Seite bleibt deutsch (kein halb übersetzter Bildschirm) und sagt, warum. */
    await expect(page.locator("#status")).toContainText("Die Sprache ließ sich gerade nicht wechseln", {
      timeout: 10000,
    });
    await expect(page.locator("#status")).toHaveAttribute("role", "alert");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("h1")).toHaveText("Wir sehen mehr als dein Foto.");
  });

  test("Erfolgsweg: Auf der leeren Seite wechselt ein Klick sofort, ohne Meldung", async ({ page, context }) => {
    await grundrouten(page, context);
    await page.goto("/?lang=de");
    await expect(page.locator("h1")).toHaveText("Wir sehen mehr als dein Foto.");
    await page.click(ZU_ENGLISCH);
    await expect(page.locator("h1")).toHaveText("We see more than your photo.");
    await expect(page.locator("#status")).toHaveText("");
    await expect(page.locator(".sw-grund.sichtbar")).toHaveCount(0);
  });

  test.describe("reduzierte Bewegung", () => {
    test.use({ reducedMotion: "reduce" });

    test("englische Seite: In den noch leeren Merkmal-Karten steht kein deutscher Text", async ({ page, context }) => {
      test.setTimeout(90000);
      await grundrouten(page, context);
      await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
      /* Das Modell hat erst 2 von 13 Karten geschrieben — 11 stehen als Platzhalter da. */
      await page.route("**/api/job-status*", (r) =>
        json(r, 200, {
          status: "processing",
          liveText: "The AI is writing about you.",
          liveKartenStandard: karten("EN", 2),
          liveTextVersuch: 1,
        })
      );
      await seiteOeffnen(page, "/?lang=en");
      await page.click('[data-demo="selfie"]');
      /* Zwei Karten hat das Modell geschrieben (sie werden nacheinander scharf), elf sind noch leer. */
      await page.waitForFunction(() => document.querySelectorAll("#facts .cat-card--unscharf").length === 11, null, {
        timeout: 60000,
      });
      const mess = await page.evaluate(() => {
        const leere = [...document.querySelectorAll("#facts .cat-card--unscharf")];
        const wert = leere[0].querySelector(".cat-value");
        return {
          anzahl: leere.length,
          texte: [...new Set(leere.map((k) => k.textContent.replace(/\s+/g, " ").trim()))],
          weichzeichner: getComputedStyle(wert).filter,
        };
      });
      expect(mess.anzahl).toBe(11);
      /* Bei reduzierter Bewegung sind die Platzhalter LESBAR (kein Weichzeichner)
         — dann müssen sie in der Sprache der Seite stehen. */
      expect(mess.weichzeichner).toBe("none");
      expect(mess.texte.join(" ")).not.toMatch(/Wird (gerade )?ausgewertet/);
      expect(mess.texte.join(" ")).toMatch(/Being analysed/);
    });
  });
});

/* ── UX-2026-10-03-49: Vier Anzeige-Fehler in Randfällen ────────────────────── */

test.describe("Anzeige in Randfällen", () => {
  const LIMIT_AKTIV = (restSekunden) => ({
    current: { count: 500, limit: 500, limitActive: true, retryAfterSeconds: restSekunden, hourlyTotal: 500 },
    totals: { today: 500, week: 900, month: 3000, total: 9000, allTime: 9000 },
  });
  const ANSAGE = "#srAnnounce";

  test("gescheiterte Analyse: Angesagt wird die Fehlermeldung, nicht „Analyse abgeschlossen“", async ({
    page,
    context,
  }) => {
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "failed", errorReason: "mistral_error" }));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("Es ist ein Fehler aufgetreten", { timeout: 15000 });
    await expect(page.locator("#status")).toHaveAttribute("role", "alert");
    await expect(page.locator(ANSAGE)).not.toHaveText("Analyse abgeschlossen");
  });

  test("Einlass abgelehnt (Serverfehler): keine Ansage „Analyse abgeschlossen“", async ({ page, context }) => {
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 500, {}));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("überlastet", { timeout: 15000 });
    await expect(page.locator(ANSAGE)).not.toHaveText("Analyse abgeschlossen");
  });

  test("Erfolgsweg: Nach einer gelungenen Analyse wird „Analyse abgeschlossen“ angesagt", async ({ page, context }) => {
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await expect(page.locator(ANSAGE)).toHaveText("Analyse abgeschlossen");
  });

  test("Zahlen-Seite bei aktivem Limit: Ein Sprachwechsel setzt die Restzeit nicht zurück", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await grundrouten(page, context, LIMIT_AKTIV(600));
    await page.goto("/stats.html?lang=de");
    const feld = page.locator("#limitCountdownStats");
    await expect(feld).toContainText("Wieder verfügbar", { timeout: 15000 });
    /* Zahlform der Sprache: deutsch mit Komma. */
    await expect(page.locator("#limitFree")).toHaveText("0,0 % frei");
    const sekunden = (text) => {
      const m = /(\d+):(\d\d)/.exec(text);
      return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    };
    await expect.poll(async () => sekunden(await feld.innerText()), { timeout: 15000 }).toBeLessThanOrEqual(594);
    const vorher = sekunden(await feld.innerText());
    await page.click('.sprach-knopf[data-lang="en"]');
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(feld).toContainText("Available again");
    const nachher = sekunden(await feld.innerText());
    /* Die Restzeit läuft weiter: nicht größer als vorher, höchstens zwei Sekunden kleiner. */
    expect(nachher).toBeLessThanOrEqual(vorher);
    expect(nachher).toBeGreaterThanOrEqual(vorher - 2);
    await expect(page.locator("#limitFree")).toHaveText("0.0 % free");
  });

  test("Limit läuft ab, während ein wiederhergestelltes Profil gelesen wird: Die Seite lädt nicht von selbst neu", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    /* Stundenlimit aktiv, Rest 5 Sekunden. */
    await grundrouten(page, context, LIMIT_AKTIV(5));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));
    /* Der Tab hat ein fertiges Ergebnis gemerkt (Neuladen, oder das Handy hat den Tab neu geladen). */
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem("malzime.queueJobId", "job-1");
        sessionStorage.setItem("malzime.queueResultToken", "tok");
      } catch (_) {
        /* ohne Tab-Speicher prüft der Test nichts — er scheitert dann am fehlenden Ergebnis */
      }
    });
    let ladungen = 0;
    page.on("load", () => {
      ladungen += 1;
    });
    await page.goto("/?lang=de");
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#limitBanner")).toBeVisible();
    const ladungenBeimLesen = ladungen;
    /* Der Rückwärtszähler läuft ab: Der Hinweis verschwindet, der Hochlade-Bereich ist wieder frei … */
    await expect(page.locator("#limitBanner")).toBeHidden({ timeout: 15000 });
    await expect(page.locator(".upload-section")).not.toHaveClass(/upload-section--limited/);
    await page.waitForTimeout(3500);
    /* … und das Profil steht noch da, ohne dass die Seite neu geladen hat. */
    expect(ladungen).toBe(ladungenBeimLesen);
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible();
  });

  test("Erfolgsweg: Ohne Ergebnis auf dem Bildschirm lädt die Seite nach Ablauf des Limits neu", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await grundrouten(page, context, LIMIT_AKTIV(3));
    let ladungen = 0;
    page.on("load", () => {
      ladungen += 1;
    });
    await page.goto("/?lang=de");
    await expect(page.locator("#limitBanner")).toBeVisible();
    await expect.poll(() => ladungen, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  });

  test("Abriss in den ersten Sekunden bei gewählter Beast-Art: Nach der Wiederaufnahme ist zu sehen, dass etwas läuft", async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    await grundrouten(page, context);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    let abfragen = 0;
    let netzWeg = false;
    await page.route("**/api/job-status*", (r) => {
      abfragen += 1;
      /* Erst zwei Wellen mit seriösem Text (Beast hat das Modell noch nicht begonnen), dann Abriss. */
      if (abfragen > 2 && !netzWeg) netzWeg = "ja";
      if (netzWeg === "ja") return r.abort("failed");
      return json(r, 200, { status: "processing", liveText: "Seriöser Text, erster Teil.", liveTextVersuch: 1 });
    });
    await seiteOeffnen(page);
    await page.click(".bias-opt.boost"); /* erst Beast wählen, dann das Foto */
    await fotoWaehlen(page);
    await expect(page.locator("#status")).toContainText("Verbindung unterbrochen", { timeout: 40000 });
    netzWeg = "vorbei";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("#status")).toHaveText("", { timeout: 10000 });
    const lesen = () =>
      page.evaluate(async () => {
        const s = (await import("/js/state.js")).state;
        const q = (id) => document.getElementById(id);
        return {
          laeuft: s.isAnalyzing,
          zeigtEtwas: q("scanAnim").classList.contains("active") || q("liveKarte").classList.contains("active"),
        };
      });
    /* Läuft die Analyse, zeigt die Seite das auch: Wartefigur oder getippter Text. */
    for (let i = 0; i < 4; i += 1) {
      const stand = await lesen();
      expect(stand).toEqual({ laeuft: true, zeigtEtwas: true });
      await page.waitForTimeout(1000);
    }
  });
});

/* ── Foto nicht lesbar: was die Fehlermeldung an den Server dazu sagt ────────
 *
 * Workshop 09.10.2026: Auf mehreren Android-Handys gab Chrome das gewählte
 * Foto nicht an die Seite heraus (`NotReadableError` auf jedem Leseweg). Am
 * Prüfgerät ließ sich dasselbe Bild nur erzeugen, wenn sich die Zeit der Datei
 * zwischen Auswahl und Lesen ändert; warum sie das auf den betroffenen Handys
 * tut, ist offen. Die Meldung trägt deshalb zwei Wörter: welche Art Zeit der
 * Browser zur Datei hatte, und ob sich diese Zeit geändert hat, wenn dieselbe
 * Datei noch einmal gewählt wird.
 *
 * Nachgestellt wird hier der Fehler selbst (das Lesen der Datei scheitert).
 */
test.describe("Foto nicht lesbar: Angaben in der Fehlermeldung", () => {
  const UNLESBAR = "vom-geraet-nicht-herausgegeben.jpg";
  const TEXT = JSON.parse(readFileSync(join(process.cwd(), "public", "locales", "de.json"), "utf8"))[
    "error.readFailed"
  ];

  /* Jede Datei dieses Namens ist für die Seite nicht lesbar — auf dem neuen und
     auf dem älteren Leseweg, so wie es die Handys im Workshop meldeten. */
  async function geraetGibtDateiNichtHeraus(page) {
    await page.addInitScript((name) => {
      const fehler = () => new DOMException("nicht lesbar", "NotReadableError");
      const echtBytes = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        if (this instanceof File && this.name === name) return Promise.reject(fehler());
        return echtBytes.call(this);
      };
      const echtLesen = FileReader.prototype.readAsArrayBuffer;
      FileReader.prototype.readAsArrayBuffer = function (blob) {
        if (blob instanceof File && blob.name === name) {
          Object.defineProperty(this, "error", { configurable: true, get: fehler });
          setTimeout(() => this.onerror && this.onerror(new ProgressEvent("error")), 0);
          return undefined;
        }
        return echtLesen.call(this, blob);
      };
    }, UNLESBAR);
  }

  /* Schneidet mit, was die Seite als Fehlermeldung an den Server schickt. */
  async function fehlermeldungenMitschneiden(page) {
    const meldungen = [];
    await page.route("**/api/errors", async (r) => {
      meldungen.push(JSON.parse(r.request().postData()));
      await r.fulfill({ status: 204, body: "" });
    });
    return meldungen;
  }

  const lesefehler = (meldungen) => meldungen.filter((m) => m.phase === "image-read");
  const unlesbaresFoto = (page) =>
    page.setInputFiles("#fileInput", { name: UNLESBAR, mimeType: "image/jpeg", buffer: MINI_JPEG });

  test("zwei Wörter zur Zeit der Datei: erst „neu“, bei derselben Datei noch einmal nicht mehr „neu“", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await geraetGibtDateiNichtHeraus(page);
    await grundrouten(page, context);
    const meldungen = await fehlermeldungenMitschneiden(page);
    await seiteOeffnen(page);

    await unlesbaresFoto(page);
    await expect(page.locator("#status")).toContainText(TEXT, { timeout: 15000 });
    await expect.poll(() => lesefehler(meldungen).length).toBe(1);

    /* Dasselbe Foto noch einmal — das tun Kinder nach der Fehlermeldung. */
    await unlesbaresFoto(page);
    await expect.poll(() => lesefehler(meldungen).length, { timeout: 15000 }).toBe(2);

    const [erste, zweite] = lesefehler(meldungen);
    expect(erste.zeitsprung).toBe("neu");
    expect(["gleich", "bis-2s", "stunden", "anders"]).toContain(zweite.zeitsprung);
    /* Feste Wörter, kein Datum und keine Zahl — und kein Dateiname in der Meldung. */
    for (const m of [erste, zweite]) {
      expect(["keine", "sekunden", "millisekunden", "unbekannt"]).toContain(m.dateizeit);
      expect(JSON.stringify(m)).not.toContain(UNLESBAR);
    }
  });

  test("Erfolgsweg: Andere Fehlermeldungen tragen diese zwei Wörter nicht", async ({ page, context }) => {
    await grundrouten(page, context);
    const meldungen = await fehlermeldungenMitschneiden(page);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "failed", errorReason: "mistral_error" }));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect.poll(() => meldungen.length, { timeout: 15000 }).toBeGreaterThan(0);
    for (const m of meldungen) {
      expect(m.dateizeit == null).toBe(true);
      expect(m.zeitsprung == null).toBe(true);
    }
  });

  test("Erfolgsweg: Ein lesbares Foto läuft durch wie bisher, ohne Lesefehler-Meldung", async ({ page, context }) => {
    await geraetGibtDateiNichtHeraus(page);
    await grundrouten(page, context);
    const meldungen = await fehlermeldungenMitschneiden(page);
    await page.route("**/api/enqueue", (r) => json(r, 200, { jobId: "job-1", resultToken: "tok" }));
    await page.route("**/api/job-status*", (r) => json(r, 200, { status: "done", result: ERGEBNIS }));
    await seiteOeffnen(page);
    await fotoWaehlen(page);
    await expect(page.locator(ERGEBNIS_SICHTBAR)).toBeVisible({ timeout: 20000 });
    expect(lesefehler(meldungen)).toHaveLength(0);
  });
});
