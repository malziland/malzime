import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* KI-Kennzeichnung der Demo-Fotos (v2.9.4) — Dauerprüfung.

   ANLASS (Audit 2026-08-10, PRIV-002): Die Kennzeichnung war auf den drei
   ausgelieferten Bildern korrekt eingebrannt — daneben lag aber ein
   Sicherungsordner `public/img/demo/original/` mit denselben Bildern OHNE
   Kennzeichnung. Der lag innerhalb des Hosting-Verzeichnisses und wurde
   mitausgeliefert: unter malzi.me/img/demo/original/… waren die KI-Bilder
   ungekennzeichnet öffentlich abrufbar (HTTP 200, live nachgewiesen).

   Diese Prüfung deckt beides ab: Jede JPEG unterhalb von public/img/demo/ muss
   die maschinenlesbare Kennzeichnung tragen — ein Unterordner mit rohen
   Originalen fällt damit automatisch auf. */

/* Pfad relativ zur Testdatei auflösen statt über das Arbeitsverzeichnis —
   dadurch ist der Test unabhängig davon, aus welchem Ordner er gestartet wird. */
const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "../img/demo");
const MARKER = "trainedAlgorithmicMedia";

/* Rekursiv, damit auch ein versehentlich wieder angelegter Unterordner erfasst wird. */
function alleBilder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return alleBilder(p);
    return /\.(jpe?g|png|webp)$/i.test(e.name) ? [p] : [];
  });
}

describe("KI-Kennzeichnung der Demo-Fotos", () => {
  const bilder = alleBilder(DEMO_DIR);

  it("es liegen überhaupt Demo-Bilder da (Positivkontrolle der Suche)", () => {
    expect(bilder.length).toBeGreaterThan(0);
  });

  it.each(bilder)("%s trägt die maschinenlesbare KI-Kennzeichnung", (pfad) => {
    const inhalt = readFileSync(pfad, "latin1");
    expect(inhalt).toContain(MARKER);
  });
});
