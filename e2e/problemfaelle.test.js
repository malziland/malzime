/**
 * problemfaelle.test.js — die Dateien, an denen Kinder scheitern, durch die
 * echte Seite.
 *
 * ANLASS (08.09.2026): In einer Klasse scheiterten 8 von 31 Versuchen im
 * Browser, bevor ein Byte den Server erreichte — 3× HEIC (Android-Browser
 * oeffnen das Samsung-Standardformat nicht), 5× "Datei nicht lesbar". Unsere
 * 332 Browser-Tests liefen bis dahin ausschliesslich mit JPEG-Demo-Bildern:
 * Wir prueften den Weg, der geht, und nicht die Wege, auf denen Kinder
 * scheitern. Christoph: "testest du nie Problemfaelle sondern nur Dinge, von
 * denen du eh weisst, dass sie funktionieren?"
 *
 * Jeder Fall geht ueber das echte Datei-Eingabefeld. Die Einreihung wird
 * abgefangen (kostenfrei, keine Analyse) und ihr Inhalt geprueft: ein
 * verkleinertes JPEG/PNG, keine GPS-Koordinaten, kein Hersteller/Modell im
 * Bild selbst. Fuer HEIC ist das der Datenschutz-Beweis des Dekoders — die
 * Fixtures tragen erfundene GPS-Daten (Wien, Graz), die den Browser nie
 * verlassen duerfen.
 *
 * Laeuft in Chromium und Firefox (koennen HEIC nicht — der Dekoder muss
 * greifen) und WebKit (kann HEIC nativ — der Dekoder darf NICHT geladen
 * werden). Die "Datei nicht lesbar"-Faelle lassen sich mit einem Browser
 * auf dem Mac nicht nachstellen; dafuer gibt es die Unit-Tests mit Attrappe
 * und den Android-Emulator (docs/RUNBOOK.md).
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

/* Basis ist das Arbeitsverzeichnis, nicht `import.meta.url` — Playwright laedt
   Testdateien nicht als echte ES-Module (siehe a11y.test.js). */
const FIXTURES = join(globalThis.process.cwd(), "e2e", "fixtures", "problemfaelle");
const HANDY = { width: 390, height: 844 };

/* Dieselbe Muster-Antwort wie in a11y.test.js — fuer den Fall, in dem das
   Ergebnis (und damit die Karte) erscheinen soll. */
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
  meta: { requestId: "problemfall-123", mode: "multimodal", subject: "HUMAN" },
};

/* Einreihung abfangen, Warteschlange antwortet "wartet" — die Probe endet vor
   jedem kostenpflichtigen Schritt. */
async function seiteMitAbgefangenerEinreihung(page, { ergebnisLiefern = false } = {}) {
  const gefangen = [];
  const geladen = [];
  page.on("request", (r) => geladen.push(r.url()));
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
      }),
    })
  );
  await page.route("**/api/enqueue", (r) => {
    gefangen.push(r.request().postData());
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "problemfall-1", resultToken: "t-1" }),
    });
  });
  await page.route("**/api/job-status**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        ergebnisLiefern ? { status: "done", result: MOCK_RESPONSE } : { status: "queued", position: 1 }
      ),
    })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/errors", (r) => r.fulfill({ status: 204 }));
  await page.setViewportSize(HANDY);
  await page.goto("/");
  await expect(page.locator("#fileInput")).toBeAttached();
  return { gefangen, geladen };
}

function upload(page, datei, mimeType) {
  return page.setInputFiles("#fileInput", {
    name: datei,
    mimeType,
    buffer: readFileSync(join(FIXTURES, datei)),
  });
}

/* Was im abgefangenen Upload stehen MUSS und was NICHT. Der Upload ist JSON:
   ein Base64-Bild, der Bildtyp, ein Dateiname nach Typ, zwei Kamera-Angaben
   (Hersteller, Modell — die Datenschutzerklaerung nennt genau diese zwei),
   Sprache, Spur-Kennung. Nichts anderes. */
function pruefeUpload(rohJson, { gpsFragmente, make }) {
  const j = JSON.parse(rohJson);
  expect(Object.keys(j).sort()).toEqual(["exif", "filename", "imageBase64", "lang", "mimeType", "traceId"]);
  expect(["image/jpeg", "image/png"]).toContain(j.mimeType);
  expect(j.filename).toBe(j.mimeType === "image/png" ? "upload.png" : "upload.jpg");
  const bild = Buffer.from(j.imageBase64, "base64");
  /* Ein neu kodiertes Bild: JPEG- oder PNG-Kopf. */
  const jpeg = bild[0] === 0xff && bild[1] === 0xd8;
  const png = bild[0] === 0x89 && bild[1] === 0x50;
  expect(jpeg || png).toBe(true);
  /* GEMESSEN 08.09.2026: WebKit (Safari) schreibt beim Neu-Kodieren einen
     kleinen EXIF-Block ins JPEG — Farbraum und Bildmasse des NEUEN Bildes
     (exiftool: ColorSpace, ExifImageWidth/Height, leerer IPTC-Digest), nichts
     vom Original. Chromium und Firefox schreiben keinen. Geprueft wird deshalb
     nicht "kein EXIF", sondern: Was drin ist, traegt keine Spur des Originals —
     kein GPS-Verzeichnis, kein Hersteller, kein Modell, kein Aufnahmedatum. */
  const exif = exifSegment(bild);
  if (exif) {
    expect(exif.length).toBeLessThan(2048);
    for (const tag of [0x8825 /* GPS-IFD */, 0x010f /* Make */, 0x0110 /* Model */, 0x9003 /* DateTimeOriginal */]) {
      expect(enthaeltTag(exif, tag)).toBe(false);
    }
  }
  /* Keine Koordinaten, kein Aufnahmedatum — nirgends im Upload. */
  for (const g of gpsFragmente) expect(rohJson.includes(g)).toBe(false);
  expect(j).not.toHaveProperty("gps");
  expect(j).not.toHaveProperty("dateTimeOriginal");
  expect(j.exif && j.exif.gps).toBeUndefined();
  /* Hersteller/Modell duerfen mit — und bei HEIC belegen sie, dass die
     EXIF-Daten aus dem HEIC gelesen wurden (der Dekoder hat sie nicht). */
  if (make) expect(j.exif.make).toBe(make);
}

/* Das APP1-Segment "Exif" eines JPEG, falls vorhanden — nur darin wird nach
   Tag-Kennungen gesucht, nicht in den Bilddaten (dort kaeme jede Zahl vor). */
function exifSegment(bild) {
  let i = 2;
  while (i + 4 <= bild.length && bild[i] === 0xff) {
    const marker = bild[i + 1];
    const laenge = bild.readUInt16BE(i + 2);
    if (marker === 0xe1 && bild.slice(i + 4, i + 10).toString("latin1") === "Exif\0\0") {
      return bild.slice(i + 10, i + 2 + laenge);
    }
    if (marker === 0xda) break; /* Bilddaten beginnen */
    i += 2 + laenge;
  }
  return null;
}

/* Eine Tag-Kennung als 2 Byte in beiden Byte-Reihenfolgen. */
function enthaeltTag(segment, tag) {
  const be = Buffer.from([tag >> 8, tag & 0xff]);
  const le = Buffer.from([tag & 0xff, tag >> 8]);
  /* Nur an geraden Positionen eines IFD-Eintrags (12 Byte je Eintrag) suchen
     waere praeziser; die Segmente sind so klein, dass ein Zufallstreffer der
     Kennung praktisch ausgeschlossen ist. */
  return segment.includes(be) || segment.includes(le);
}

const ERFOLG = [
  {
    datei: "heic-samsung-mit-gps.heic",
    mime: "image/heic",
    gps: ["48.208", "48,208", "16.373"],
    make: "samsung",
    heic: true,
  },
  {
    datei: "heic-iphone-mit-gps.heic",
    mime: "image/heic",
    gps: ["47.070", "47,070", "15.439"],
    make: "Apple",
    heic: true,
  },
  { datei: "gedreht-orientation-6.jpg", mime: "image/jpeg", gps: [] },
  { datei: "bild.png", mime: "image/png", gps: [] },
  { datei: "bild.webp", mime: "image/webp", gps: [] },
  { datei: "png-als-jpg-umbenannt.jpg", mime: "image/jpeg", gps: [] },
];

for (const fall of ERFOLG) {
  test(`Problemfall ${fall.datei}: wird eingereiht, ohne Metadaten`, async ({ page }) => {
    const { gefangen, geladen } = await seiteMitAbgefangenerEinreihung(page);
    /* Kann DIESER Browser HEIC selbst? Gemessen mit der echten Datei, nicht
       angenommen: WebKit kann es auf dem Mac (ImageIO), auf dem Linux-Laeufer
       der Pipeline nicht — am 08.09.2026 machte genau diese Annahme zwei Tests
       rot. (Eine Mini-HEIC aus nur einem Dateikopf taugt nicht als Probe: Die
       lehnt auch ein faehiger Browser ab.) */
    const kannHeicNativ = fall.heic
      ? await page.evaluate(
          /* eslint-disable no-undef -- laeuft im Browser */
          (b64) =>
            new Promise((res) => {
              const i = new Image();
              i.onload = () => res(i.naturalWidth > 0);
              i.onerror = () => res(false);
              i.src = "data:image/heic;base64," + b64;
            }),
          /* eslint-enable no-undef */
          readFileSync(join(FIXTURES, fall.datei)).toString("base64")
        )
      : false;
    await upload(page, fall.datei, fall.mime);
    await expect.poll(() => gefangen.length, { timeout: 30000, message: "Einreihung muss abgefangen werden" }).toBe(1);
    pruefeUpload(gefangen[0], { gpsFragmente: fall.gps, make: fall.make });
    /* Die Vorschau oben zeigt ein Bild — auch wenn der Browser das Original
       nicht anzeigen kann (HEIC: dann das umgewandelte). */
    await expect
      /* eslint-disable-next-line no-undef -- laeuft im Browser */
      .poll(() => page.evaluate(() => (document.querySelector("#imagePreview img") || {}).naturalWidth || 0), {
        timeout: 10000,
        message: "Vorschau muss ein anzeigbares Bild zeigen",
      })
      .toBeGreaterThan(0);
    /* Der Dekoder wird NUR geladen, wenn es HEIC ist UND der Browser es nicht
       selbst kann. */
    const dekoderGeladen = geladen.some((u) => u.includes("/lib/libheif/"));
    expect(dekoderGeladen).toBe(Boolean(fall.heic) && !kannHeicNativ);
  });
}

test("Problemfall HEIC mit GPS: die Karte erscheint im Browser — GPS wurde gelesen, aber nicht gesendet", async ({
  page,
}) => {
  const { gefangen } = await seiteMitAbgefangenerEinreihung(page, { ergebnisLiefern: true });
  await upload(page, "heic-samsung-mit-gps.heic", "image/heic");
  await expect.poll(() => gefangen.length, { timeout: 30000 }).toBe(1);
  await expect(page.locator("#simulation")).not.toBeEmpty({ timeout: 30000 });
  /* Die Karte erscheint nur, wenn der Browser die Koordinaten kennt — aus dem
     HEIC gelesen, im Browser geblieben (der Upload hatte sie nicht). */
  await expect(page.locator("#gpsMap .leaflet-container")).toBeVisible({ timeout: 15000 });
});

const FEHLER = [
  /* DE oder EN — die Seite folgt der Browsersprache. */
  { datei: "leer.jpg", mime: "image/jpeg", meldung: /nicht geöffnet werden|couldn.t be opened/i },
  { datei: "text-als-jpg.jpg", mime: "image/jpeg", meldung: /nicht geöffnet werden|couldn.t be opened/i },
];

for (const fall of FEHLER) {
  test(`Problemfall ${fall.datei}: klare Meldung, keine Einreihung, kein Dekoder`, async ({ page }) => {
    const { gefangen, geladen } = await seiteMitAbgefangenerEinreihung(page);
    await upload(page, fall.datei, fall.mime);
    await expect(page.locator("#status")).toContainText(fall.meldung, { timeout: 15000 });
    expect(gefangen).toHaveLength(0);
    expect(geladen.some((u) => u.includes("/lib/libheif/"))).toBe(false);
  });
}

test("Problemfall zu grosse Datei (ueber 25 MB): Meldung vor jedem Lesen", async ({ page }) => {
  const { gefangen } = await seiteMitAbgefangenerEinreihung(page);
  /* Zur Laufzeit erzeugt, damit keine 26-MB-Datei im Repository liegt:
     JPEG-Kopf plus Fuellung, knapp UEBER der Grenze von 25 MiB. */
  const buffer = Buffer.alloc(25 * 1024 * 1024 + 1, 0);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  await page.setInputFiles("#fileInput", { name: "riesig.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.locator("#status")).toContainText(/zu groß|too large|25 MB/i, { timeout: 15000 });
  expect(gefangen).toHaveLength(0);
});
