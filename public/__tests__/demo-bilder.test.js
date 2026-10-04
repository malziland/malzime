import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/* KI-Kennzeichnung der Demo-Fotos (v2.9.4) — Dauerprüfung.

   ANLASS (Audit 2026-08-10, PRIV-002): Die Kennzeichnung war auf den drei
   ausgelieferten Bildern korrekt eingebrannt — daneben lag aber ein
   Sicherungsordner `public/img/demo/original/` mit denselben Bildern OHNE
   Kennzeichnung. Der lag innerhalb des Hosting-Verzeichnisses und wurde
   mitausgeliefert: unter malzi.me/img/demo/original/… waren die KI-Bilder
   ungekennzeichnet öffentlich abrufbar (HTTP 200, live nachgewiesen).

   Diese Prüfung deckt beides ab: Jede Bilddatei unterhalb von public/img/demo/
   muss die maschinenlesbare Kennzeichnung tragen — ein Unterordner mit rohen
   Originalen fällt damit automatisch auf.

   EINZIGE ANDERE ART VON BILD in diesem Ordner (PRIV-2026-10-03-38): die festen
   Kartenausschnitte der drei erfundenen Orte (`karte-*.webp`). Sie sind keine
   KI-Bilder, sondern Ausschnitte aus OpenStreetMap; eine KI-Kennzeichnung wäre
   dort falsch. Damit daraus kein Schlupfloch wird, gilt als Kartenausschnitt
   NUR, was mit Namen UND Prüfsumme in fixtures/beispiel-karten.json steht.
   Alles andere muss gekennzeichnet sein — auch eine Datei, die bloß wie eine
   Karte heißt. */

/* Pfad relativ zur Testdatei auflösen statt über das Arbeitsverzeichnis —
   dadurch ist der Test unabhängig davon, aus welchem Ordner er gestartet wird. */
const HIER = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(HIER, "../img/demo");
const MARKER = "trainedAlgorithmicMedia";
const KARTEN = JSON.parse(readFileSync(join(HIER, "fixtures/beispiel-karten.json"), "utf8")).karten;

/* Rekursiv, damit auch ein versehentlich wieder angelegter Unterordner erfasst wird. */
function alleBilder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return alleBilder(p);
    return /\.(jpe?g|png|webp)$/i.test(e.name) ? [p] : [];
  });
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* Ein Kartenausschnitt ist nur, was direkt im Ordner liegt (nicht in einem
   Unterordner), so heißt wie in der Tabelle und Byte für Byte dieselbe Datei
   ist. */
function istBekannterKartenausschnitt(pfad, bytes) {
  if (dirname(pfad) !== DEMO_DIR) return false;
  const eintrag = Object.hasOwn(KARTEN, basename(pfad)) ? KARTEN[basename(pfad)] : null;
  return Boolean(eintrag) && eintrag.sha256 === sha256(bytes);
}

describe("KI-Kennzeichnung der Demo-Fotos", () => {
  const bilder = alleBilder(DEMO_DIR);
  const karten = bilder.filter((pfad) => istBekannterKartenausschnitt(pfad, readFileSync(pfad)));
  const kiBilder = bilder.filter((pfad) => !karten.includes(pfad));

  it("es liegen überhaupt Demo-Bilder da (Positivkontrolle der Suche)", () => {
    expect(bilder.length).toBeGreaterThan(0);
    /* Zwölf KI-Bilder: drei Motive, je Bild und Vorschau, je zwei Sprachen.
       Sinkt die Zahl, hat die Ausnahme für Kartenausschnitte etwas
       verschluckt, das sie nicht verschlucken darf. */
    expect(kiBilder.length).toBeGreaterThanOrEqual(12);
  });

  it.each(kiBilder)("%s trägt die maschinenlesbare KI-Kennzeichnung", (pfad) => {
    const inhalt = readFileSync(pfad, "latin1");
    expect(inhalt).toContain(MARKER);
  });

  describe("Kartenausschnitte sind die einzige Ausnahme — und nur die bekannten", () => {
    it("genau die Dateien aus der Tabelle gelten als Kartenausschnitt", () => {
      expect(karten.map((pfad) => basename(pfad)).sort()).toEqual(Object.keys(KARTEN).sort());
      /* Positivkontrolle: Eine leere Tabelle ergäbe hier `[] gleich []`. */
      expect(Object.keys(KARTEN).length).toBe(6);
    });

    it.each(karten)("%s ist kein KI-Bild und nennt seine Quelle", (pfad) => {
      const inhalt = readFileSync(pfad, "latin1");
      /* Eine KI-Kennzeichnung auf einer Karte wäre eine falsche Angabe.
         (Mit `includes`, damit ein Fehlschlag nicht die ganze Bilddatei
         ausgibt.) */
      expect(inhalt.includes(MARKER), "Kartenausschnitt trägt eine KI-Kennzeichnung").toBe(false);
      /* Die Quellenangabe reist in den Metadaten mit, falls jemand das Bild
         einzeln speichert. */
      expect(inhalt.includes("OpenStreetMap contributors"), "Quellenangabe fehlt in den Metadaten").toBe(true);
      expect(inhalt.includes("https://www.openstreetmap.org/copyright"), "Verweis auf die Lizenzseite fehlt").toBe(
        true
      );
    });

    it("Gegenprobe: ein Bild, das nur wie eine Karte HEISST, gilt nicht als Karte", () => {
      /* Der Name allein öffnet nichts: andere Bytes, andere Prüfsumme. Ein
         ungekennzeichnetes KI-Bild unter dem Namen `karte-selfie.webp` fiele
         damit unter die Kennzeichnungs-Prüfung oben und machte sie rot. */
      const echte = join(DEMO_DIR, "karte-selfie.webp");
      const andereBytes = Buffer.concat([readFileSync(echte), Buffer.from([0])]);
      expect(istBekannterKartenausschnitt(echte, readFileSync(echte))).toBe(true);
      expect(istBekannterKartenausschnitt(echte, andereBytes)).toBe(false);
    });

    it("Gegenprobe: dieselbe Datei in einem Unterordner gilt nicht als Karte", () => {
      const echte = join(DEMO_DIR, "karte-selfie.webp");
      expect(istBekannterKartenausschnitt(join(DEMO_DIR, "original", "karte-selfie.webp"), readFileSync(echte))).toBe(
        false
      );
    });

    it("Gegenprobe: ein unbekannter Name gilt nicht als Karte, auch kein geerbter", () => {
      const echte = readFileSync(join(DEMO_DIR, "karte-selfie.webp"));
      expect(istBekannterKartenausschnitt(join(DEMO_DIR, "karte-wien.webp"), echte)).toBe(false);
      expect(istBekannterKartenausschnitt(join(DEMO_DIR, "constructor"), echte)).toBe(false);
    });
  });
});
