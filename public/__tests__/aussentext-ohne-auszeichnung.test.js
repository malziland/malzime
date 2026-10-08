// @vitest-environment node
/**
 * aussentext-ohne-auszeichnung.test.js — eine gesperrte Formulierung bleibt
 * gesperrt, auch wenn ein Wort darin hervorgehoben ist.
 *
 * Die Kontrolle verbotener Formulierungen (scripts/pruefungen/checks/
 * aussentext.py, Regeln in .pruefungen/aussentext.txt) liest den Quelltext
 * der Seiten. Steht mitten in der Wendung eine Auszeichnung — „verlässt
 * <strong>nie</strong> den Browser“, „verlässt **nie** den Browser“ —, sah
 * sie zwischen den Wörtern Zeichen, die der Leser nicht sieht, und fand
 * nichts (Prüfrunde 07.10.2026). Gerade solche Zusagen werden gern betont.
 * Seit 08.10.2026 liest die Kontrolle jede Zeile zusätzlich ohne Auszeichnung
 * (an ihrer Quelle geändert); sie arbeitet aber weiter am Quelltext.
 *
 * Hier dieselben Regeln von der anderen Seite: gegen den Text, WIE DER
 * BROWSER IHN ZEIGT — je Textblock einer Seite (Absatz, Listenpunkt,
 * Überschrift, Zelle), aus dem aufgebauten Dokument gelesen; in den
 * Markdown-Unterlagen je Absatz ohne Sternchen, Unterstriche und Rückstriche.
 * Über Blockgrenzen hinweg wird nicht gesucht — zwei Listenpunkte sind kein
 * Satz. Zwei Wege zum selben Ziel: Fällt einer aus, hält der andere.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lies = (pfad) => readFileSync(join(WURZEL, pfad), "utf8");
const glatt = (text) => text.replace(/\s+/g, " ").trim();

/* Regeln wie die Kontrolle sie lädt: getrennt am LETZTEN |, ohne Rücksicht
   auf Groß- und Kleinschreibung. */
const REGELN = lies(".pruefungen/aussentext.txt")
  .split("\n")
  .map((zeile) => zeile.trim())
  .filter((zeile) => zeile && !zeile.startsWith("#") && zeile.includes("|"))
  .map((zeile) => {
    const trenner = zeile.lastIndexOf("|");
    return { muster: new RegExp(zeile.slice(0, trenner).trim(), "i"), grund: zeile.slice(trenner + 1).trim() };
  });

const treffer = (text) => REGELN.filter(({ muster }) => muster.test(text)).map(({ muster }) => muster.exec(text)[0]);

/* Geprüft wird, was ins Repository gehört. Was git ignoriert (private
   Prüfberichte unter docs/), geht nicht nach außen — dieselbe Abgrenzung wie
   in der Kontrolle selbst. Ohne git (entpacktes Archiv) gilt alles. */
const IGNORIERT = (() => {
  if (!existsSync(join(WURZEL, ".git"))) return new Set();
  return new Set(
    execFileSync(
      "git",
      ["-C", WURZEL, "ls-files", "--others", "--ignored", "--exclude-standard", "--", "docs", "public"],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }
    )
      .split("\n")
      .filter(Boolean)
  );
})();

/* ── Seiten: je Textblock, wie ihn der Browser zeigt ── */
const BLOECKE =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary, blockquote, caption, label, button";

function textbloecke(html) {
  const dokument = new JSDOM(html).window.document;
  const texte = [...dokument.querySelectorAll(BLOECKE)]
    .filter((element) => !element.querySelector(BLOECKE))
    .map((element) => glatt(element.textContent));
  for (const kopf of dokument.querySelectorAll("title")) texte.push(glatt(kopf.textContent));
  for (const meta of dokument.querySelectorAll("meta[content]")) texte.push(glatt(meta.getAttribute("content")));
  return texte.filter(Boolean);
}

function seiten(ordner = "public", liste = []) {
  for (const eintrag of readdirSync(join(WURZEL, ordner), { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) {
      if (!["lib", "__tests__", "node_modules"].includes(eintrag.name)) seiten(pfad, liste);
    } else if (eintrag.name.endsWith(".html")) liste.push(relative(WURZEL, join(WURZEL, pfad)));
  }
  return liste.filter((pfad) => !IGNORIERT.has(pfad)).sort();
}

/* ── Unterlagen: je Absatz, ohne Markdown-Auszeichnung ── */
const UNTERLAGEN = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "AGENTS.md",
  "public/llms.txt",
  ...readdirSync(join(WURZEL, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
].filter((pfad) => existsSync(join(WURZEL, pfad)) && !IGNORIERT.has(pfad));

const ohneAuszeichnung = (text) =>
  text
    .replace(/<\/?(?:strong|em|b|i|u|mark|code|span|abbr|small|sub|sup|q|cite|a)\b[^>]*>/gi, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|[\s(„"])[*_](?=\S)/g, "$1")
    .replace(/(?<=\S)[*_](?=[\s).,;:!?“"]|$)/g, "");

/* Ein Absatz endet an Leerzeile, Tabellenzeile, Überschrift und Trennlinie;
   ein Listenpunkt beginnt einen neuen (dieselbe Einteilung wie die Kontrolle). */
function absaetze(markdown) {
  const fertig = [];
  let offen = [];
  const schliessen = () => {
    if (offen.length) fertig.push(glatt(ohneAuszeichnung(offen.join(" "))));
    offen = [];
  };
  for (const roh of markdown.split("\n")) {
    const zeile = roh.trim().replace(/^(?:>+\s*)+/, "");
    if (!zeile || /^(?:[-*_=]{3,}|`{3,}.*|~{3,}.*)$/.test(zeile)) schliessen();
    else if (zeile.startsWith("|") || /^#{1,6}\s/.test(zeile)) {
      schliessen();
      fertig.push(glatt(ohneAuszeichnung(zeile)));
    } else if (/^(?:[-+*]|\d{1,3}[.)])\s+/.test(zeile)) {
      schliessen();
      offen.push(zeile.replace(/^(?:[-+*]|\d{1,3}[.)])\s+/, ""));
    } else offen.push(zeile);
  }
  schliessen();
  return fertig;
}

describe("Messmittel-Kontrolle", () => {
  test("die Regeln sind geladen und schlagen an einem bekannten Verstoß an", () => {
    expect(REGELN.length).toBeGreaterThan(10);
    expect(treffer("Deine Position verlässt nie den Browser.")).toHaveLength(1);
    expect(treffer("GPS erreicht nie unsere Server.")).toEqual([]);
  });

  test("Seiten und Unterlagen sind gelesen", () => {
    expect(seiten()).toEqual(
      expect.arrayContaining(["public/index.html", "public/datenschutz.html", "public/en/privacy.html"])
    );
    expect(textbloecke(lies("public/datenschutz.html")).length).toBeGreaterThan(50);
    expect(UNTERLAGEN).toEqual(expect.arrayContaining(["README.md", "docs/SECURITY-MODEL.md"]));
    expect(absaetze(lies("README.md")).length).toBeGreaterThan(50);
  });
});

describe("Gegenprobe: eine hervorgehobene Wendung wird gefunden", () => {
  test("in einer Seite", () => {
    const html = "<p>Deine Position verlässt <strong>nie</strong>\n   den <a href='#'>Browser</a>.</p>";
    expect(textbloecke(html).flatMap(treffer)).toEqual(["verlässt nie den Browser"]);
  });

  test("in einer Unterlage, auch über einen Zeilenumbruch", () => {
    expect(absaetze("Deine Position verlässt **nie**\nden `Browser`.").flatMap(treffer)).toEqual([
      "verlässt nie den Browser",
    ]);
    expect(absaetze("- Deine Position _verlässt nie_ den Browser.").flatMap(treffer)).toHaveLength(1);
  });

  test("zwei Listenpunkte und zwei Tabellenzeilen sind kein Satz", () => {
    const liste = "<ul><li>Der Hinweis verlässt nie</li><li>den Browser neu laden hilft</li></ul>";
    expect(textbloecke(liste).flatMap(treffer)).toEqual([]);
    expect(absaetze("- Der Hinweis verlässt nie\n- den Browser neu laden hilft").flatMap(treffer)).toEqual([]);
    expect(absaetze("| GPS | read on the phone |\n| preview | stays in the browser |").flatMap(treffer)).toEqual([]);
  });
});

describe("keine gesperrte Formulierung im gelesenen Text", () => {
  test.each(seiten())("%s", (pfad) => {
    const funde = textbloecke(lies(pfad)).flatMap((text) =>
      treffer(text).map((wendung) => `${wendung} — in: ${text.slice(0, 120)}`)
    );
    expect(funde).toEqual([]);
  });

  test.each(UNTERLAGEN)("%s", (pfad) => {
    const funde = absaetze(lies(pfad)).flatMap((text) =>
      treffer(text).map((wendung) => `${wendung} — in: ${text.slice(0, 120)}`)
    );
    expect(funde).toEqual([]);
  });
});
