#!/usr/bin/env node
/**
 * ki-wasserzeichen.mjs — Brennt die Kennzeichnung „KI ERSTELLT" in die
 * Demo-Bilder und schreibt die maschinenlesbaren Metadaten dazu.
 *
 * WARUM: Die drei Demo-Fotos auf der Startseite sind KI-generiert (siehe
 * public/img/demo/LICENSE.md). Seit August 2026 müssen solche Bilder
 * gekennzeichnet sein — sichtbar für Menschen UND maschinenlesbar. Ein
 * CSS-Overlay allein reicht dafür nicht: Es verschwindet, sobald jemand das
 * Bild speichert oder weitergibt. Deshalb wird das Zeichen in die Pixel
 * gebrannt und zusätzlich in die Metadaten geschrieben.
 *
 * WORTLAUT: „KI ERSTELLT", nicht „KI BEARBEITET" — die Bilder sind vollständig
 * erzeugt, nicht nachträglich verändert.
 *
 * WERKZEUG: Playwright rendert das Bild mit Badge und schießt einen Screenshot.
 * Bewusst KEINE neue Abhängigkeit wie sharp: Deren optionale Plattform-Pakete
 * schneidet npm auf macOS aus der Lockfile, worauf die Linux-CI in `npm ci`
 * bricht (siehe RUNBOOK, „Lockfile-Falle"). Playwright liegt für die E2E-Tests
 * ohnehin im Projekt.
 *
 * EINMAL-WERKZEUG, aber bewusst im Repo: Kommen neue Demo-Bilder dazu oder
 * ändert sich die Vorgabe, ist der Vorgang damit wiederholbar statt
 * handgeklickt.
 *
 * Aufruf:  node scripts/ki-wasserzeichen.mjs [--dry]
 *          --dry schreibt nach /tmp statt in public/img/demo (zum Ansehen).
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, "..");
const DEMO_DIR = path.join(REPO, "public/img/demo");
/* WICHTIG (Audit 2026-08-10, PRIV-002): Die Sicherung der un-gewasserzeichneten
   Originale liegt AUSSERHALB von public/. Frueher stand sie in
   public/img/demo/original/ — und wurde damit von Firebase Hosting mit
   ausgeliefert. Unter malzi.me/img/demo/original/ waren die KI-Bilder ohne
   jede Kennzeichnung oeffentlich abrufbar, also genau das, was die
   Kennzeichnungspflicht verhindern soll. Nie wieder nach public/ legen. */
const SICHERUNG = path.join(REPO, ".demo-originale");

const TROCKEN = process.argv.includes("--dry");
const ZIEL_DIR = TROCKEN ? "/tmp/ki-wasserzeichen" : DEMO_DIR;

/* SPRACHFASSUNGEN (2026-08-13): Das Zeichen ist in die Pixel gebrannt und kann
   deshalb nicht mituebersetzen. Bei englischer Oberflaeche stand trotzdem
   "KI ERSTELLT" im Bild. Loesung: ein zweiter Dateisatz mit englischem Zeichen,
   Endung `-en`. Das Frontend waehlt nach Sprache; die deutschen Dateinamen
   bleiben unveraendert, damit nichts Bestehendes bricht.
   Aufruf:  node scripts/ki-wasserzeichen.mjs            -> deutsche Fassung
            node scripts/ki-wasserzeichen.mjs --lang=en  -> englische Fassung */
const SPRACHE = (process.argv.find((a) => a.startsWith("--lang=")) || "--lang=de").split("=")[1];
const SPRACHEN = {
  de: {
    endung: "",
    kuerzel: "KI",
    wort: "ERSTELLT",
    beschreibung: "Mit KI erstelltes Bild. Zeigt keine reale Person.",
    credit: "KI erstellt",
    quelleIptc: "Generative KI",
  },
  en: {
    endung: "-en",
    kuerzel: "AI",
    wort: "GENERATED",
    beschreibung: "AI-generated image. Does not depict a real person.",
    credit: "AI-generated",
    quelleIptc: "Generative AI",
  },
};
if (!SPRACHEN[SPRACHE]) {
  console.error(`Abbruch: unbekannte Sprache "${SPRACHE}". Erlaubt: ${Object.keys(SPRACHEN).join(", ")}`);
  process.exit(2);
}
const L = SPRACHEN[SPRACHE];

/* anzeigeBreite = wie breit das Bild auf der Seite tatsaechlich erscheint.
   zuschnitt = das Thumbnail wird im Kachel-Format erzeugt statt im Hochformat.

   WARUM DER ZUSCHNITT: Die Kacheln zeigen die Bilder mit aspect-ratio 3/2 und
   object-position top (styles.css ~2405). Bei einem Hochformat-Thumbnail faellt
   damit die untere Haelfte weg — ein Badge rechts unten waere in der Datei
   vorhanden, auf der Startseite aber unsichtbar. Genau das ist zweimal
   passiert. Wird das Thumbnail selbst im 3/2-Format erzeugt, zeigt die Kachel
   es vollstaendig, und das Zeichen ist da, wo es hingehoert. */
const BILDER = [
  { name: "demo-selfie.jpg", anzeigeBreite: 360, zielSchrift: 13 },
  { name: "demo-selfie-thumb.jpg", anzeigeBreite: 220, zielSchrift: 7, zuschnitt: "3:2", quelle: "demo-selfie.jpg" },
  { name: "demo-cafe.jpg", anzeigeBreite: 360, zielSchrift: 13 },
  { name: "demo-cafe-thumb.jpg", anzeigeBreite: 220, zielSchrift: 7, zuschnitt: "3:2", quelle: "demo-cafe.jpg" },
  { name: "demo-hiker.jpg", anzeigeBreite: 360, zielSchrift: 13 },
  { name: "demo-hiker-thumb.jpg", anzeigeBreite: 220, zielSchrift: 7, zuschnitt: "3:2", quelle: "demo-hiker.jpg" },
];

/* Badge-Größe skaliert mit der Bildbreite, damit es auf dem 200-px-Thumbnail
   genauso lesbar bleibt wie auf dem 1280er. Unten begrenzt, sonst wird die
   Schrift auf den Thumbnails unleserlich klein. */
/* Die Groesse richtet sich nach der ANZEIGE, nicht nach der Dateigroesse:
   Das Vollbild erscheint in der Vorschau rund 360 px breit, das Thumbnail in
   der Kachel rund 220 px. Eine reine Prozentrechnung auf die Dateibreite
   macht das Zeichen im Vollbild zu klein — dort schrumpft die Anzeige auf ein
   Drittel. Deshalb wird mit der erwarteten Anzeigebreite gerechnet. */
function badgeMasse(breite, anzeigeBreite, zielSchrift) {
  const skala = breite / anzeigeBreite;
  const schrift = Math.max(10, Math.round(zielSchrift * skala));
  return {
    schrift,
    abstand: Math.round(schrift * 0.75),
    polsterX: Math.round(schrift * 0.62),
    polsterY: Math.round(schrift * 0.4),
    radius: Math.round(schrift * 0.4),
  };
}

function seite(dataUrl, breite, hoehe, anzeigeBreite, zielSchrift) {
  const m = badgeMasse(breite, anzeigeBreite, zielSchrift);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${breite}px; height:${hoehe}px; overflow:hidden; }
  .rahmen { position:relative; width:${breite}px; height:${hoehe}px; }
  .rahmen img { width:100%; height:100%; display:block; object-fit:cover; object-position:top; }
  /* RECHTS UNTEN — die übliche Ecke für Bildnachweise und ausdrücklich so
     gewünscht.
     ZU WISSEN: Auf der Startseite ist das Badge dort NICHT zu sehen. Die
     Kacheln zeigen die Hochformat-Bilder in 3/2 mit Ausrichtung nach oben
     (styles.css ~2405), die untere Bildhälfte fällt also weg. Sichtbar wird
     es, sobald das Bild groß erscheint — in der Vorschau nach dem Klick und
     überall dort, wo die Datei weitergegeben wird. Für die Kachel-Ansicht
     trägt die Zeile darüber den Hinweis „(mit KI erstellt)". */
  .badge {
    position:absolute; right:${m.abstand}px; bottom:${m.abstand}px;
    display:flex; align-items:center; gap:${Math.round(m.schrift * 0.45)}px;
    background:rgba(17,17,17,.86); border-radius:${m.radius}px;
    padding:${m.polsterY}px ${m.polsterX}px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    font-size:${m.schrift}px; line-height:1; color:#fff;
    /* Leichter Schein nach aussen, damit das Badge auch auf dunklem
       Bildinhalt eine erkennbare Kante behaelt. */
    box-shadow:0 0 0 1px rgba(255,255,255,.18), 0 ${Math.round(m.schrift * 0.15)}px ${Math.round(m.schrift * 0.5)}px rgba(0,0,0,.45);
  }
  .kuerzel {
    border:${Math.max(1, Math.round(m.schrift * 0.09))}px solid #fff;
    border-radius:${Math.round(m.radius * 0.5)}px;
    padding:${Math.round(m.schrift * 0.12)}px ${Math.round(m.schrift * 0.26)}px;
    font-weight:700; letter-spacing:.02em;
  }
  .wort { font-weight:600; letter-spacing:.08em; }
  </style></head><body>
  <div class="rahmen">
    <img src="${dataUrl}" alt="">
    <div class="badge"><span class="kuerzel">${L.kuerzel}</span><span class="wort">${L.wort}</span></div>
  </div></body></html>`;
}

function masse(datei) {
  const roh = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", datei], {
    encoding: "utf8",
  });
  const b = Number(roh.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const h = Number(roh.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!b || !h) throw new Error(`Masse nicht lesbar: ${datei}`);
  return { breite: b, hoehe: h };
}

/* Der offizielle IPTC-Wert für „vollständig von einem Algorithmus erzeugt".
   Nicht zu verwechseln mit compositeWithTrainedAlgorithmicMedia — das wäre ein
   echtes Foto mit KI-Anteilen, also „bearbeitet" statt „erstellt". */
const IPTC_QUELLE = "https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/**
 * Überträgt die Metadaten des Originals auf das gebrannte Bild und ergänzt die
 * maschinenlesbare KI-Kennzeichnung.
 *
 * WARUM DAS ÜBERTRAGEN NÖTIG IST: Der Screenshot erzeugt eine nackte
 * JPEG-Datei — alle EXIF-Daten sind weg. Bei den Demo-Bildern sind Kamera,
 * Ort und Datum aber ABSICHTLICH gesetzt (fiktiv, siehe LICENSE.md): Genau
 * daran führt malziME vor, welche versteckten Daten in einem Foto stecken.
 * Ohne diesen Schritt wäre die Demo nach dem Wasserzeichen kaputt.
 */
function metadatenSetzen(quelle, ziel) {
  execFileSync("exiftool", [
    "-overwrite_original",
    "-quiet",
    /* Erst alles vom Original übernehmen … */
    "-TagsFromFile",
    quelle,
    "-all:all",
    /* … dann die KI-Kennzeichnung obendrauf. Reihenfolge zählt: umgekehrt
       würde das Übernehmen die Kennzeichnung wieder überschreiben. */
    `-XMP-iptcExt:DigitalSourceType=${IPTC_QUELLE}`,
    "-XMP-dc:Creator=malziland - learning | training | consulting e.U.",
    `-XMP-dc:Description=${L.beschreibung}`,
    `-IPTC:Credit=${L.credit}`,
    `-IPTC:Source=${L.quelleIptc}`,
    `-XMP-photoshop:Credit=${L.credit}`,
    ziel,
  ]);
}

async function main() {
  if (!existsSync(ZIEL_DIR)) mkdirSync(ZIEL_DIR, { recursive: true });

  /* Originale einmalig sichern — die Bilder liegen im Repo, aber ein
     versehentlich doppelt aufgebranntes Badge waere sonst nur ueber git
     zurueckzuholen. */
  if (!TROCKEN && !existsSync(SICHERUNG)) {
    mkdirSync(SICHERUNG, { recursive: true });
    for (const b of BILDER) copyFileSync(path.join(DEMO_DIR, b.name), path.join(SICHERUNG, b.name));
    console.log(`Originale gesichert in ${SICHERUNG}`);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const bild of BILDER) {
    const { name, anzeigeBreite } = bild;
    /* Thumbnails aus dem VOLLBILD erzeugen — die alten Thumbnails sind nur
       200 px breit und waeren fuer die Kachel zu grob, sobald sie im
       3/2-Format neu zugeschnitten werden. */
    const quellName = bild.quelle || name;
    const quelle = existsSync(path.join(SICHERUNG, quellName))
      ? path.join(SICHERUNG, quellName)
      : path.join(DEMO_DIR, quellName);
    const roh = masse(quelle);

    let breite = roh.breite;
    let hoehe = roh.hoehe;
    if (bild.zuschnitt === "3:2") {
      /* Feste Kachelgroesse: doppelte Anzeigebreite fuer scharfe Darstellung
         auf Bildschirmen mit hoher Pixeldichte. */
      breite = 660;
      hoehe = 440;
    }
    const dataUrl = `data:image/jpeg;base64,${readFileSync(quelle).toString("base64")}`;

    await page.setViewportSize({ width: breite, height: hoehe });
    await page.setContent(seite(dataUrl, breite, hoehe, anzeigeBreite, bild.zielSchrift));
    await page.waitForLoadState("networkidle");

    /* Qualitaet 92: Die Demo-Bilder sollen nicht sichtbar schlechter werden als
       das Original — sie laufen anschliessend durch dieselbe KI-Analyse wie
       Nutzerfotos. */
    const puffer = await page.screenshot({ type: "jpeg", quality: 92 });
    /* Sprach-Endung im Dateinamen: demo-selfie.jpg (de) / demo-selfie-en.jpg (en).
       Die Quelle bleibt IMMER das un-gewasserzeichnete Original. */
    const zielName = name.replace(/\.jpg$/, `${L.endung}.jpg`);
    const ziel = path.join(ZIEL_DIR, zielName);
    writeFileSync(ziel, puffer);
    metadatenSetzen(quelle, ziel);
    console.log(`  ${zielName}  ${breite}x${hoehe}  ${(puffer.length / 1024).toFixed(0)} KB`);
  }

  await browser.close();
  console.log(TROCKEN ? `\nProbelauf — Ergebnisse in ${ZIEL_DIR}` : "\nFertig.");
}

main().catch((e) => {
  console.error("Abbruch:", e.message);
  process.exit(1);
});
