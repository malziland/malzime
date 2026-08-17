const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für den Cache-Buster-Schritt in scripts/deploy.sh.
 *
 * Befund OPS-2026-08-13-01: Das Ersetzungsmuster lautete `\?v=[0-9]*`. Der
 * Stern erlaubt NULL Ziffern, also traf es auch ein nacktes `?v=` in
 * gewöhnlichem Fließtext. Beim Hosting-Deploy vom 2026-08-12 hat es genau das
 * getan und den Kommentar über DEMO_BUSTER in public/js/demo.js in
 * "mit derselben `?v=2026081303`-Ersetzung" verwandelt — ein Satz, der keinen
 * Sinn mehr ergibt. Der Schaden war kosmetisch, die Mechanik ist es nicht: Ein
 * Auslieferungsskript, das unbemerkt Text umschreibt, den es nicht anfassen
 * soll, trifft irgendwann einen Satz, den Menschen lesen.
 *
 * Der Test liest das Muster AUS DER ECHTEN DATEI und wendet es mit sed an.
 * Eine Kopie des Musters im Test wäre wertlos: Sie würde grün bleiben, während
 * deploy.sh auseinanderdriftet. Kein Netz, kein git, keine Schreibzugriffe im
 * Projekt.
 */

const DEPLOY = path.join(__dirname, "../../../scripts/deploy.sh");
const TESTVERSION = "2099010199";

/* Holt beide sed-Ausdrücke (GNU-Zweig und BSD-Zweig) aus deploy.sh. */
function musterAusSkript() {
  const inhalt = fs.readFileSync(DEPLOY, "utf8");
  const treffer = [...inhalt.matchAll(/sed -i(?: '')? "(s\/[^"]+\/g)"/g)].map((m) => m[1]);
  return treffer;
}

/* Wendet einen sed-Ausdruck auf einen Text an — genau so, wie deploy.sh es
   auf die Datei tut, nur gegen stdin statt gegen das Arbeitsverzeichnis. */
function ersetzen(ausdruck, text) {
  const konkret = ausdruck.replace(/\$VERSION/g, TESTVERSION);
  /* sed haengt je nach Plattform einen Zeilenumbruch an oder nicht — der
     Vergleich soll den Text pruefen, nicht das Zeilenende. */
  return execFileSync("sed", [konkret], { input: text, encoding: "utf8" }).replace(/\n$/, "");
}

describe("deploy.sh — Cache-Buster-Ersetzung", () => {
  test("das Muster steht überhaupt in der Datei, und in beiden sed-Zweigen", () => {
    const muster = musterAusSkript();
    /* Positivkontrolle für die Messung selbst: Findet die Suche nichts, ist
       nicht das Skript in Ordnung, sondern der Test blind. */
    expect(muster.length).toBe(2);
    expect(muster[0]).toBe(muster[1]);
  });

  test("OPS-2026-08-13-01: ein nacktes ?v= im Fließtext bleibt unangetastet", () => {
    const [ausdruck] = musterAusSkript();
    const satz = "scripts/deploy.sh hebt ihn mit derselben `?v=`-Ersetzung hoch.";
    expect(ersetzen(ausdruck, satz)).toBe(satz);
  });

  test("echte Verweise mit Nummer werden weiterhin hochgezählt", () => {
    const [ausdruck] = musterAusSkript();
    const zeile = '<link rel="stylesheet" href="./styles.css?v=2026081303" />';
    expect(ersetzen(ausdruck, zeile)).toBe('<link rel="stylesheet" href="./styles.css?v=' + TESTVERSION + '" />');
  });

  test("mehrere Verweise in einer Zeile werden alle ersetzt (/g)", () => {
    const [ausdruck] = musterAusSkript();
    const zeile = "a.js?v=2026010101 und b.js?v=2026010102";
    expect(ersetzen(ausdruck, zeile)).toBe("a.js?v=" + TESTVERSION + " und b.js?v=" + TESTVERSION);
  });

  test("Rückbauprobe: das alte, zu gierige Muster fällt bei genau diesem Satz durch", () => {
    /* Belegt, dass der Test rot werden KANN — und dass er genau den Fehler
       fängt, der eingetreten ist. */
    const alt = "s/\\?v=[0-9]*/\\?v=" + TESTVERSION + "/g";
    const satz = "scripts/deploy.sh hebt ihn mit derselben `?v=`-Ersetzung hoch.";
    expect(ersetzen(alt, satz)).not.toBe(satz);
    expect(ersetzen(alt, satz)).toContain("`?v=" + TESTVERSION + "`-Ersetzung");
  });

  test("die vom Skript behandelten Dateien enthalten keinen umgeschriebenen Fließtext mehr", () => {
    /* Nachlauf über die echten Dateien: Nirgends darf `?v=<Nummer>` in einem
       Kommentar oder Satz stehen, wo ein nacktes ?v= gemeint war. Erkennbar
       daran, dass die Nummer unmittelbar von einem Backtick gefolgt wird. */
    const wurzel = path.join(__dirname, "../../..");
    const dateien = [
      "public/index.html",
      "public/datenschutz.html",
      "public/impressum.html",
      "public/nutzungsbedingungen.html",
      "public/barrierefreiheit.html",
      "public/stats.html",
      "public/js/demo.js",
    ];
    for (const rel of dateien) {
      const p = path.join(wurzel, rel);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, "utf8")).not.toMatch(/`\?v=[0-9]+`/);
    }
  });
});

/* ── Vollstaendigkeit der Liste ────────────────────────────────────────────
   OPS-2026-08-17: Die Seite /barrierefreiheit kam neu dazu und stand NICHT in
   der Dateiliste von deploy.sh. Folge: Ihr Verweis auf das Stilblatt waere auf
   der Kennung des Tages ihrer Entstehung eingefroren, waehrend alle anderen
   Seiten weiterzaehlen — nach der naechsten CSS-Aenderung haette sie ein altes
   Stilblatt aus dem Zwischenspeicher gezogen.

   Aufgefallen ist es dem Nutzer, nicht diesem Test: Er fuehrte bis dahin eine
   eigene feste Liste und verglich sie mit nichts. Zwei feste Listen, die
   niemand gegen die Wirklichkeit haelt, driften gemeinsam ab.

   Jetzt wird die Wirklichkeit gefragt: Jede Datei unter public/, die einen
   Cache-Buster traegt, MUSS im Skript stehen. */
describe("Cache-Buster: die Dateiliste ist vollstaendig", () => {
  const { readdirSync, readFileSync } = require("node:fs");
  const { join } = require("node:path");

  test("jede Datei mit ?v=NNNN steht in der Liste von deploy.sh", () => {
    const wurzel = join(__dirname, "..", "..", "..");
    const skript = readFileSync(join(wurzel, "scripts", "deploy.sh"), "utf8");

    const kandidaten = readdirSync(join(wurzel, "public"))
      .filter((f) => f.endsWith(".html"))
      .map((f) => "public/" + f)
      .concat(["public/js/demo.js"]);

    const traegtBuster = kandidaten.filter((rel) => /\?v=\d{6,}/.test(readFileSync(join(wurzel, rel), "utf8")));

    /* POSITIVKONTROLLE: Faende die Suche gar nichts, waere der Test still
       gruen und wertlos. */
    /* Jest kennt keine Botschaft als zweites Argument — anders als Playwright.
       Der erste Anlauf nutzte sie und scheiterte an sich selbst, nicht an der
       Sache. */
    expect(traegtBuster.length).toBeGreaterThan(3);

    const fehlend = traegtBuster.filter((rel) => !skript.includes(rel));
    /* Leer heisst: deploy.sh kennt jede Datei, die einen Buster traegt. */
    expect(fehlend).toEqual([]);
  });
});
