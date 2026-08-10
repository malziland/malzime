import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Source-Map-Verweise auf Dateien, die es nicht gibt (Konsolenfund 2026-08-10).

   ANLASS: Die selbst gehostete Kartenbibliothek endete mit
   `//# sourceMappingURL=leaflet.js.map`. Diese Begleitdatei wurde nie
   mitausgeliefert. Die Entwicklerwerkzeuge fragen sie trotzdem an — und weil
   Firebase Hosting für unbekannte Pfade die Catch-all-Weiterleitung greifen
   lässt, kommt statt "gibt es nicht" die Startseite zurück: HTTP 200,
   text/html, 20 KB. Der Browser will JSON parsen, bekommt HTML und meldet
   `SyntaxError: JSON Parse error: Unrecognized token '<'`.

   Das ist dieselbe Falle, die schon bei `public/img/demo/original/` zu einer
   Fehldeutung geführt hat: Ein HTTP 200 von diesem Hosting beweist NICHT, dass
   die Datei existiert. Deshalb prüft dieser Test am Dateibestand, nicht über
   HTTP.

   Regel: Jeder Source-Map-Verweis im ausgelieferten Verzeichnis muss auf eine
   real vorhandene Datei zeigen — sonst gehört der Verweis entfernt oder die
   Datei mitgeliefert. */

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERWEIS = /\/[/*]#\s*sourceMappingURL\s*=\s*(\S+?)\s*(?:\*\/)?$/gm;

/* Ordner, die nicht ausgeliefert werden bzw. keine Quelldateien enthalten. */
const UEBERSPRINGEN = new Set(["__tests__", "img", "fonts"]);

function ausgelieferteQuelldateien(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (UEBERSPRINGEN.has(e.name)) return [];
    const p = join(dir, e.name);
    if (e.isDirectory()) return ausgelieferteQuelldateien(p);
    return /\.(js|css|mjs)$/i.test(e.name) ? [p] : [];
  });
}

describe("Source-Map-Verweise zeigen auf vorhandene Dateien", () => {
  const dateien = ausgelieferteQuelldateien(PUBLIC_DIR);

  it("es wurden überhaupt Dateien gefunden (Positivkontrolle der Suche)", () => {
    expect(dateien.length).toBeGreaterThan(10);
  });

  it("kein Verweis zeigt ins Leere", () => {
    const tote = [];
    for (const datei of dateien) {
      const inhalt = readFileSync(datei, "utf8");
      for (const treffer of inhalt.matchAll(VERWEIS)) {
        const ziel = treffer[1];
        /* Eingebettete Maps (data:) brauchen keine Datei. */
        if (ziel.startsWith("data:")) continue;
        const zielPfad = join(dirname(datei), ziel);
        if (!existsSync(zielPfad)) {
          tote.push(`${datei.replace(PUBLIC_DIR, "public")} → ${ziel}`);
        }
      }
    }
    expect(tote).toEqual([]);
  });

  /* Gegenprobe: Der Test erkennt einen toten Verweis auch wirklich. Ohne diese
     Prüfung könnte die Suche stillschweigend nichts finden und trotzdem grün
     sein — der häufigste Weg, wie eine Dauerprüfung wertlos wird. */
  it("ein erfundener toter Verweis würde erkannt (Gegenprobe)", () => {
    const beispiel = "//# sourceMappingURL=gibt-es-nicht.js.map";
    const treffer = [...beispiel.matchAll(VERWEIS)];
    expect(treffer).toHaveLength(1);
    expect(existsSync(join(PUBLIC_DIR, "lib/leaflet", treffer[0][1]))).toBe(false);
  });
});
