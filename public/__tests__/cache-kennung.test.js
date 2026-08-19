import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ── Jede ausgelieferte Datei braucht eine Kennung ─────────────────────────
 *
 * ANLASS 2026-08-19, gefunden vom Nutzer: "Wenn ich malzime öffne, sehe ich
 * immer noch das alte Favicon. Das aktualisiert sich auch nicht, wenn ich beim
 * Beast-Modus umschalte."
 *
 * Ursache war keine Nachlässigkeit des Browsers, sondern unsere: Die Verweise
 * auf Favicon, App-Kachel und Manifest trugen KEINE Kennung, während das
 * Stilblatt eine bekam. `scripts/deploy.sh` ersetzt vorhandene `?v=NNNN` — wo
 * keine steht, kann es keine hochzählen. Das Zeichen blieb damit auf ewig im
 * Zwischenspeicher, und Browser halten Favicons besonders hartnäckig fest.
 *
 * Der Fehler ist unsichtbar, solange man nur neue Rechner benutzt. Deshalb
 * dieser Wächter: Er prüft die STRUKTUR, nicht das Aussehen.
 */

function alleHtmlSeiten(unter = "") {
  const treffer = [];
  for (const e of fs.readdirSync(path.join(PUBLIC, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["__tests__", "node_modules", "fonts", "img", "js", "locales", "lib"].includes(e.name)) continue;
      treffer.push(...alleHtmlSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push(rel);
    }
  }
  return treffer;
}

/* Verweise, die eine Kennung tragen MÜSSEN: Sie zeigen auf Dateien, die sich
   ändern können und die der Browser sonst behält. */
/* Als FUNKTION, nicht als Konstante: Ein globaler Suchausdruck merkt sich
   seine Position (`lastIndex`). Wird derselbe zweimal mit `test()` benutzt,
   ueberspringt der zweite Aufruf Treffer — mein erster Anlauf ist genau daran
   gescheitert, und zwar an der eigenen Positivkontrolle. Ein frischer
   Ausdruck je Verwendung kann das nicht. */
const pflichtMuster = () =>
  /(?:href|src)="(?:\.?\/)?((?:favicon[^"?]*|apple-touch-icon\.png|site\.webmanifest|og-image\.png))(\?[^"]*)?"/g;

describe("Cache-Kennungen", () => {
  const seiten = alleHtmlSeiten();

  it("Messmittel: es gibt Seiten mit solchen Verweisen", () => {
    /* Positivkontrolle. Fände die Suche nichts, wäre der Test still grün und
       wertlos — genau der Zustand, den er verhindern soll. */
    const mit = seiten.filter((f) => pflichtMuster().test(fs.readFileSync(path.join(PUBLIC, f), "utf8")));
    expect(seiten.length).toBeGreaterThanOrEqual(10);
    expect(mit.length).toBeGreaterThanOrEqual(10);
  });

  it("jeder Verweis auf Favicon, App-Kachel und Manifest trägt eine Kennung", () => {
    const ohne = [];
    for (const datei of seiten) {
      const html = fs.readFileSync(path.join(PUBLIC, datei), "utf8");
      for (const m of html.matchAll(pflichtMuster())) {
        if (!m[2] || !/\?v=\d{6,}/.test(m[2])) ohne.push(`${datei}: ${m[1]}`);
      }
    }
    expect(
      ohne,
      "Ohne Kennung behaelt der Browser die alte Datei — scripts/deploy.sh kann " +
        "nur vorhandene ?v=NNNN hochzaehlen, keine neuen anlegen."
    ).toEqual([]);
  });

  it("Rueckbauprobe: ein Verweis ohne Kennung wird erkannt", () => {
    /* Belegt, dass der Test rot werden KANN — und zwar genau bei dem Muster,
       das der Nutzer gefunden hat. */
    const kaputt = '<link rel="icon" href="./favicon.svg" type="image/svg+xml" />';
    const treffer = [...kaputt.matchAll(pflichtMuster())];
    expect(treffer).toHaveLength(1);
    expect(treffer[0][2]).toBeUndefined();
  });

  it("Gegenprobe: ein Verweis MIT Kennung schlaegt nicht faelschlich an", () => {
    const gut = '<link rel="icon" href="./favicon.svg?v=2026081903" type="image/svg+xml" />';
    const treffer = [...gut.matchAll(pflichtMuster())];
    expect(treffer).toHaveLength(1);
    expect(/\?v=\d{6,}/.test(treffer[0][2])).toBe(true);
  });
});
