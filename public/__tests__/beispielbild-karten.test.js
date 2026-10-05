// @vitest-environment node
/**
 * beispielbild-karten.test.js — die festen Kartenausschnitte passen zu den
 * Beispielbildern (PRIV-2026-10-03-38).
 *
 * Fuer ein Beispielbild fragt der Browser nichts bei OpenStreetMap an; Adresse
 * und Kartenausschnitt seiner erfundenen Ortsdaten liefert die Seite mit. Damit
 * haengen vier Dinge aneinander, die sich einzeln aendern lassen:
 *
 *   die Ortsdaten in den Bilddateien  ->  der Kartenausschnitt (Bilddatei)
 *                                     ->  die Adresse (Sprachdateien)
 *                                     ->  die Quellenangabe (LICENSE.md)
 *
 * Bekaeme ein Beispielbild andere Ortsdaten, zeigte die Seite weiter die alte
 * Karte und die alte Adresse — ohne dass irgendetwas ausfiele. Diese Pruefung
 * macht die Kopplung sichtbar: Sie liest die Ortsdaten aus den echten Dateien,
 * mit derselben Bibliothek und demselben Aufruf wie die Seite (js/exif.js).
 * Sie laeuft deshalb in Node und nicht in der Browser-Nachbildung — dort liest
 * die Bibliothek die Dateien nicht. Den Abgleich mit dem Programm selbst
 * (welche Dateien es einsetzt) fuehrt beispielbild-ort.test.js.
 *
 * Wofuer jeder Ausschnitt hergestellt ist, steht in
 * fixtures/beispiel-karten.json.
 */
import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "../lib/exifr/lite.esm.mjs";
import { gpsAusTags } from "../js/exif.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(HIER, "../img/demo");
const TABELLE = JSON.parse(readFileSync(join(HIER, "fixtures/beispiel-karten.json"), "utf8"));
const ORTE = Object.keys(TABELLE.orte);
const SPRACHEN = Object.fromEntries(
  ["de", "en"].map((s) => [s, JSON.parse(readFileSync(join(HIER, "..", "locales", `${s}.json`), "utf8"))])
);

/* Welche Bilddateien zu welchem Ort gehoeren, sagt der Dateiname:
   demo-<ort>.jpg, -en, -thumb, -thumb-en. */
const beispielbilder = readdirSync(DEMO_DIR)
  .filter((name) => /^demo-.*\.jpe?g$/i.test(name))
  .sort();
const ortVon = (name) => (/^demo-([a-z]+)/.exec(name) || [])[1];

/* Liest die Ortsdaten so, wie die Seite es tut. */
async function ortsdaten(bytes) {
  const puffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return gpsAusTags(await exifr.parse(puffer, { gps: true, silentErrors: true }));
}

/* Ein Zehntausendstel Grad sind rund zehn Meter — auf der Karte drei
   Bildpunkte. Enger als das muss ein Ausschnitt nicht sitzen, weiter darf er
   nicht danebenliegen. */
const TOLERANZ = 0.0001;
const passtZumOrt = (gps, ort) =>
  Boolean(gps) &&
  Math.abs(gps.latitude - ort.breitengrad) <= TOLERANZ &&
  Math.abs(gps.longitude - ort.laengengrad) <= TOLERANZ;

/* Breite und Hoehe einer WebP-Datei aus ihrem Kopf (erweitertes Format,
   Abschnitt "VP8X": je drei Bytes, Wert minus eins). */
function webpMasse(bytes) {
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  if (bytes.toString("latin1", 12, 16) !== "VP8X") return null;
  return { breite: 1 + bytes.readUIntLE(24, 3), hoehe: 1 + bytes.readUIntLE(27, 3) };
}

describe("Beispielbilder und ihre festen Kartenausschnitte", () => {
  it("Positivkontrolle: zwoelf Beispielbilder, drei Orte, sechs Ausschnitte", () => {
    expect(beispielbilder).toHaveLength(12);
    expect(ORTE.sort()).toEqual(["cafe", "hiker", "selfie"]);
    expect(Object.keys(TABELLE.karten)).toHaveLength(6);
    /* Jedes Beispielbild gehoert zu einem Ort der Tabelle — sonst liefe die
       Pruefung unten fuer ein neues Motiv still ins Leere. */
    expect(beispielbilder.map(ortVon).filter((ort) => !ORTE.includes(ort))).toEqual([]);
  });

  it("die Knoepfe der Startseite und die Tabelle nennen dieselben Beispielbilder", () => {
    /* Ein viertes Beispielbild ohne Kartenausschnitt und Adresse zeigte sonst
       still eine leere Karte. Dass auch das PROGRAMM dieselbe Liste fuehrt,
       prueft beispielbild-ort.test.js (dort laeuft das Programm). */
    const startseite = readFileSync(join(HIER, "..", "index.html"), "utf8");
    const knoepfe = [...startseite.matchAll(/data-demo="([^"]+)"/g)].map((treffer) => treffer[1]);
    expect(knoepfe.length, "keine Beispielbild-Knoepfe in index.html gefunden").toBeGreaterThan(0);
    expect([...knoepfe].sort()).toEqual([...ORTE].sort());
  });

  it("Messmittel-Probe: ein Bild ohne Ortsdaten liefert keine — und eine Abweichung faellt auf", async () => {
    expect(await ortsdaten(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    const ort = TABELLE.orte.selfie;
    expect(passtZumOrt({ latitude: ort.breitengrad, longitude: ort.laengengrad }, ort)).toBe(true);
    /* Hundert Meter daneben: Die Karte saesse sichtbar falsch. */
    expect(passtZumOrt({ latitude: ort.breitengrad + 0.001, longitude: ort.laengengrad }, ort)).toBe(false);
    expect(passtZumOrt(null, ort)).toBe(false);
  });

  it.each(beispielbilder)("%s traegt genau die Ortsdaten, fuer die sein Ausschnitt hergestellt ist", async (name) => {
    const gps = await ortsdaten(readFileSync(join(DEMO_DIR, name)));
    const ort = TABELLE.orte[ortVon(name)];
    expect(gps, `${name} traegt keine lesbaren Ortsdaten`).not.toBeNull();
    expect(
      passtZumOrt(gps, ort),
      `${name}: ${gps.latitude}/${gps.longitude} statt ${ort.breitengrad}/${ort.laengengrad} — ` +
        "Kartenausschnitt und Adresse neu erzeugen (public/img/demo/LICENSE.md)"
    ).toBe(true);
  });

  describe.each(ORTE)("Ort „%s“", (ort) => {
    const dateien = Object.entries(TABELLE.karten).filter(([, eintrag]) => eintrag.ort === ort);

    it("hat einen Ausschnitt in einfacher und einen in doppelter Punktdichte", () => {
      expect(dateien.map(([name]) => name).sort()).toEqual([`karte-${ort}-2x.webp`, `karte-${ort}.webp`]);
      const [einfach] = dateien.filter(([name]) => !name.includes("-2x"));
      const [doppelt] = dateien.filter(([name]) => name.includes("-2x"));
      /* Doppelte Punktdichte heisst: genau doppelt so breit und so hoch. */
      expect(doppelt[1].breite).toBe(einfach[1].breite * 2);
      expect(doppelt[1].hoehe).toBe(einfach[1].hoehe * 2);
    });

    it.each(dateien)("%s liegt da, in den erwarteten Massen und unveraendert", (name, eintrag) => {
      const pfad = join(DEMO_DIR, name);
      expect(existsSync(pfad), `${name} fehlt`).toBe(true);
      const bytes = readFileSync(pfad);
      expect(webpMasse(bytes)).toEqual({ breite: eintrag.breite, hoehe: eintrag.hoehe });
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(eintrag.sha256);
    });

    it.each(["de", "en"])("Adresse und Textalternative stehen in %s.json", (sprache) => {
      const adresse = SPRACHEN[sprache][`demo.place.${ort}`];
      const alt = SPRACHEN[sprache][`demo.mapAlt.${ort}`];
      expect(typeof adresse).toBe("string");
      expect(adresse.length).toBeGreaterThan(20);
      expect(adresse).toMatch(sprache === "de" ? /Österreich$/ : /Austria$/);
      expect(typeof alt).toBe("string");
      expect(alt.length).toBeGreaterThan(20);
    });
  });

  it("im Ordner liegt kein Kartenausschnitt, den die Tabelle nicht kennt", () => {
    const vorhanden = readdirSync(DEMO_DIR).filter((name) => /^karte-/i.test(name));
    expect(vorhanden.sort()).toEqual(Object.keys(TABELLE.karten).sort());
  });

  it("der Hinweis unter dem festen Ausschnitt steht in beiden Sprachen", () => {
    for (const sprache of ["de", "en"]) {
      expect(SPRACHEN[sprache]["gps.fixedHint"], `gps.fixedHint fehlt in ${sprache}.json`).toBeTruthy();
    }
  });

  it("die Lizenzdatei des Ordners nennt Quelle und Lizenz der Kartenausschnitte", () => {
    const lizenz = readFileSync(join(DEMO_DIR, "LICENSE.md"), "utf8");
    expect(lizenz).toContain("OpenStreetMap-Mitwirkende");
    expect(lizenz).toContain("OpenStreetMap contributors");
    expect(lizenz).toContain("Open Database License (ODbL)");
    expect(lizenz).toContain("https://www.openstreetmap.org/copyright");
    for (const ort of ORTE) expect(lizenz).toContain(`karte-${ort}.webp`);
  });
});
