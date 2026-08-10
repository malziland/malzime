import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Keine style-Attribute im HTML (Konsolenfund 2026-08-10).

   ANLASS: `stats.html` enthielt `style="width: 0%"` an der Balkenanzeige des
   Stundenlimits. Die eigene Content-Security-Policy erlaubt nur `style-src
   'self'` — ohne `'unsafe-inline'`. Der Browser hat das Attribut daher
   verworfen und bei jedem Aufruf zwei Fehler in die Konsole geschrieben:

     Refused to apply a stylesheet because its hash, its nonce, or
     'unsafe-inline' does not appear in the style-src directive …

   Nachgewiesen mit WebKit (dem Motor von Safari) über die echte Seite.

   WICHTIG zur Abgrenzung: Verboten ist das **Attribut im HTML**. Was
   JavaScript über die CSSOM setzt (`el.style.width = …` in stats.js), ist von
   der Richtlinie ausdrücklich erlaubt und bleibt unangetastet. Die Startbreite
   gehört deshalb in die Stilvorlage, nicht ins Markup.

   Diese Prüfung hält das für alle ausgelieferten HTML-Seiten fest. */

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_ATTRIBUT = /<[^>]+\sstyle\s*=\s*["'][^"']*["']/gi;

const seiten = readdirSync(PUBLIC_DIR).filter((n) => n.endsWith(".html"));

describe("Content-Security-Policy: keine style-Attribute im HTML", () => {
  it("es wurden überhaupt HTML-Seiten gefunden (Positivkontrolle der Suche)", () => {
    expect(seiten.length).toBeGreaterThanOrEqual(5);
  });

  it.each(seiten)("%s kommt ohne style-Attribut aus", (name) => {
    const inhalt = readFileSync(join(PUBLIC_DIR, name), "utf8");
    const treffer = [...inhalt.matchAll(STYLE_ATTRIBUT)].map((m) => m[0].slice(0, 90));
    expect(treffer).toEqual([]);
  });

  /* Gegenprobe: Der Erkenner findet ein style-Attribut auch wirklich. Ohne das
     könnte die Suche stillschweigend an allem vorbeigehen und trotzdem grün
     sein — der häufigste Weg, wie eine Dauerprüfung wertlos wird. */
  it("ein eingebautes style-Attribut würde erkannt (Gegenprobe)", () => {
    const beispiel = '<div class="x" id="limitBar" style="width: 0%"></div>';
    expect([...beispiel.matchAll(STYLE_ATTRIBUT)]).toHaveLength(1);
  });
});
