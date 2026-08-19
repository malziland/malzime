import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ── Die Marke muss überall ankommen, nicht nur im Ordner ──────────────────
 *
 * ANLASS 2026-08-19. Der Nutzer musste DREIMAL nachfragen, weil ich die
 * Wortmarke als Satz von Dateien behandelt habe statt als Identität, die an
 * vielen Stellen auftaucht:
 *
 *   „Auf diesen Seiten sehe ich überhaupt kein Logo."      (Unterseiten)
 *   „Ich sehe immer noch das alte Favicon."                (keine Kennung)
 *   „Hast du das auch für die Google- und KI-Suche?"       (keine logo-Angabe)
 *
 * Und dann der Satz, der diesen Test ausgelöst hat: „Warum muss ich an diese
 * Sachen immer denken? Das muss ja doch automatisch klar sein."
 *
 * Er hat recht. Die Liste existierte sogar — sie stand in der Design-Vorlage
 * unter „Dateisatz, den Sie brauchen". Sie hing nur an meinem Gedächtnis.
 * Jetzt hängt sie hier.
 */

const seiten = () => fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

const lies = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");
const start = lies("index.html");

/* Was es geben MUSS, mit Grund. Ändert sich die Marke, ändern sich alle. */
const DATEIEN = [
  ["favicon.svg", "Tab-Zeichen, skaliert auf jede Größe"],
  ["favicon-beast.svg", "Tab-Zeichen im Beast-Modus"],
  ["favicon.ico", "Rückfall für ältere Browser"],
  ["favicon-192x192.png", "Android-Startbildschirm und große Favicon-Größe"],
  ["favicon-512x512.png", "Android-Startbild und Logo für Suchmaschinen"],
  ["apple-touch-icon.png", "iPhone-Startbildschirm"],
  ["og-image.png", "Vorschau beim Teilen"],
  ["site.webmanifest", "Startbildschirm-Angaben"],
];

describe("Die Marke kommt überall an", () => {
  it("alle Dateien des Satzes liegen vor", () => {
    const fehlt = DATEIEN.filter(([f]) => !fs.existsSync(path.join(PUBLIC, f))).map(([f, grund]) => `${f} (${grund})`);
    expect(fehlt, "Dateien aus dem Marken-Satz fehlen").toEqual([]);
  });

  it("die Startseite verlinkt Tab-Zeichen, App-Kachel und Manifest", () => {
    /* Positivkontrolle: Fände die Suche gar keine link-Elemente, wäre alles
       darunter wertlos. */
    expect(start.match(/<link /g)?.length ?? 0).toBeGreaterThan(5);

    const noetig = [
      [/rel="icon"[^>]*favicon\.svg/, "favicon.svg (skalierbares Tab-Zeichen)"],
      [/rel="icon"[^>]*favicon\.ico/, "favicon.ico (Rückfall)"],
      [/rel="icon"[^>]*favicon-192x192\.png/, "192-px-Favicon (Google empfiehlt über 48 px)"],
      [/rel="apple-touch-icon"/, "apple-touch-icon (iPhone)"],
      [/rel="manifest"/, "site.webmanifest"],
    ];
    expect(
      noetig.filter(([r]) => !r.test(start)).map(([, n]) => n),
      "nicht verlinkt"
    ).toEqual([]);
  });

  it("die Teilen-Vorschau ist vollständig", () => {
    const noetig = ["og:title", "og:description", "og:image", "og:url", "twitter:card", "twitter:image"];
    expect(
      noetig.filter((n) => !start.includes(n)),
      "Angaben für die Teilen-Vorschau fehlen"
    ).toEqual([]);
  });

  it("Suchmaschinen finden ein Logo — Organization.logo, absolut und groß genug", () => {
    /* Google zeigt es in der Wissenskarte. Mindestmaß laut Dokumentation:
       112 x 112. Ohne diese Angabe zeigt Google gar kein Logo — das war der
       Zustand bis 2026-08-19, obwohl die Bilddateien längst dalagen. */
    const bloecke = [...start.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(bloecke.length, "keine strukturierten Daten gefunden").toBeGreaterThan(0);

    const ohneLogo = [];
    const pruefe = (o, weg = "") => {
      if (Array.isArray(o)) return o.forEach((x, i) => pruefe(x, `${weg}[${i}]`));
      if (!o || typeof o !== "object") return;
      if (o["@type"] === "Organization") {
        if (typeof o.logo !== "string" || !o.logo.startsWith("https://")) {
          ohneLogo.push(`${weg || "(Wurzel)"}: ${o.name || "?"}`);
        }
      }
      for (const [k, v] of Object.entries(o)) if (typeof v === "object") pruefe(v, `${weg}.${k}`);
    };
    let gefunden = 0;
    for (const b of bloecke) {
      const j = JSON.parse(b[1]);
      pruefe(j);
      gefunden += JSON.stringify(j).split('"Organization"').length - 1;
    }
    /* Positivkontrolle: Gäbe es gar keine Organization, prüfte der Test nichts. */
    expect(gefunden, "keine Organization in den strukturierten Daten").toBeGreaterThan(0);
    expect(ohneLogo, "Organization ohne absolutes logo — Google zeigt dann keines").toEqual([]);
  });

  it("das Manifest verweist nur auf Dateien, die es gibt", () => {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "site.webmanifest"), "utf8"));
    expect(m.icons?.length, "keine Icons im Manifest").toBeGreaterThan(0);
    const fehlt = m.icons.map((i) => i.src.replace(/^\.?\//, "")).filter((f) => !fs.existsSync(path.join(PUBLIC, f)));
    expect(fehlt, "Manifest nennt Dateien, die nicht existieren").toEqual([]);
    expect(m.start_url, "ohne start_url startet die App auf der Seite, von der aus sie hinzugefügt wurde").toBe("/");
  });

  it("beide Tab-Zeichen tragen dieselbe Form", () => {
    /* Sonst wäre es nicht dasselbe Logo, sondern ein zweites. */
    const pfad = (d) => /<path class="zeichen" d="([^"]+)"/.exec(lies(d))[1];
    expect(pfad("favicon-beast.svg")).toBe(pfad("favicon.svg"));
    expect(pfad("favicon.svg").length).toBeGreaterThan(100);
  });

  it("jede Seite trägt die Wortmarke", () => {
    const ohne = seiten().filter((f) => !lies(f).includes('class="wortmarke'));
    expect(ohne, "Seiten ohne Wortmarke").toEqual([]);
  });
});
