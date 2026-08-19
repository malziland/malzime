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
const WURZEL = path.join(__dirname, "../../..");

/* Fuehrt die Entdeckungszeile aus deploy.sh AUS — nicht eine Kopie davon.
   Seit OPS-2026-08-18-02 hat deploy.sh keine feste Dateiliste mehr, sondern
   fragt das Dateisystem. Damit dieser Waechter nicht wieder eine zweite Liste
   fuehrt, die getrennt abdriftet, holt er sich den Befehl aus dem Skript und
   laesst ihn im Projektwurzel laufen. */
function busterDateienLautSkript() {
  const inhalt = fs.readFileSync(DEPLOY, "utf8");
  const m = inhalt.match(/^BUSTER_DATEIEN=\$\((.+)\)$/m);
  /* Positivkontrolle: Findet die Suche die Zeile nicht, ist der Test blind —
     dann soll er scheitern, nicht still eine leere Liste pruefen. */
  if (!m) throw new Error("BUSTER_DATEIEN-Zeile in scripts/deploy.sh nicht gefunden");
  return execFileSync("sh", ["-c", m[1]], { cwd: WURZEL, encoding: "utf8" })
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean);
}

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
       daran, dass die Nummer unmittelbar von einem Backtick gefolgt wird.

       Die Dateien kommen aus derselben Quelle wie in deploy.sh — eine eigene
       Liste hier waere die dritte, die niemand gegen die Wirklichkeit haelt. */
    for (const rel of busterDateienLautSkript()) {
      const p = path.join(WURZEL, rel);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, "utf8")).not.toMatch(/`\?v=[0-9]+`/);
    }
  });
});

/* ── Vollstaendigkeit: die Entdeckung laesst nichts liegen ────────────────
   OPS-2026-08-17: Die Seite /barrierefreiheit kam neu dazu und stand NICHT in
   der Dateiliste von deploy.sh. Folge: Ihr Verweis auf das Stilblatt waere auf
   der Kennung des Tages ihrer Entstehung eingefroren, waehrend alle anderen
   Seiten weiterzaehlen — nach der naechsten CSS-Aenderung haette sie ein altes
   Stilblatt aus dem Zwischenspeicher gezogen.

   OPS-2026-08-18-02, derselbe Fehler ein zweites Mal: Dieser Waechter fuehrte
   selbst eine Liste — er durchsuchte nur die OBERSTE Ebene von public/. Die
   englischen Seiten liegen in public/en/. Skript und Waechter waeren beide
   blind gewesen, gemeinsam und still.

   Jetzt gibt es auf beiden Seiten keine Liste mehr: deploy.sh fragt das
   Dateisystem, und dieser Test fuehrt genau dessen Zeile aus und haelt sie
   gegen eine EIGENSTAENDIGE, rekursive Suche nach allem, was einen Buster
   traegt. Zwei verschiedene Wege zum selben Ergebnis — driften sie
   auseinander, wird der Test rot. */
describe("Cache-Buster: die Entdeckung laesst nichts liegen", () => {
  /* Unabhaengig von deploy.sh: alles unter public/, das einen Buster traegt. */
  function alleMitBuster(verzeichnis = "public") {
    const treffer = [];
    for (const eintrag of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
      const rel = `${verzeichnis}/${eintrag.name}`;
      if (eintrag.isDirectory()) {
        if (eintrag.name === "__tests__" || eintrag.name === "node_modules") continue;
        treffer.push(...alleMitBuster(rel));
        continue;
      }
      if (!/\.(html|js)$/.test(eintrag.name)) continue;
      if (/\?v=\d{6,}/.test(fs.readFileSync(path.join(WURZEL, rel), "utf8"))) treffer.push(rel);
    }
    return treffer;
  }

  test("jede Datei mit ?v=NNNN wird von deploy.sh tatsaechlich gefunden", () => {
    const gefunden = new Set(busterDateienLautSkript());
    const traegtBuster = alleMitBuster();

    /* POSITIVKONTROLLE: Faende die eigene Suche gar nichts, waere der Test
       still gruen und wertlos. Zehn HTML-Seiten plus demo.js sind der Stand am
       2026-08-18; die Schranke prueft nur, dass ueberhaupt gemessen wurde. */
    expect(traegtBuster.length).toBeGreaterThan(5);

    const fehlend = traegtBuster.filter((rel) => !gefunden.has(rel));
    /* Leer heisst: deploy.sh hebt jede Datei hoch, die einen Buster traegt. */
    expect(fehlend).toEqual([]);
  });

  test("die englischen Seiten sind dabei", () => {
    /* Namentlich, weil genau sie der Anlass waren. Faellt public/en/ weg,
       soll dieser Test es sagen und nicht stillschweigend leer laufen. */
    const gefunden = busterDateienLautSkript();
    for (const seite of [
      "public/en/imprint.html",
      "public/en/privacy.html",
      "public/en/terms.html",
      "public/en/accessibility.html",
    ]) {
      expect(gefunden).toContain(seite);
    }
  });

  test("Rueckbauprobe: die frueher feste Liste haette public/en/ verfehlt", () => {
    /* Belegt, dass der Test rot werden KANN — und dass er genau den Fehler
       faengt, der zweimal beinahe passiert ist. */
    const frueher = [
      "public/index.html",
      "public/datenschutz.html",
      "public/impressum.html",
      "public/nutzungsbedingungen.html",
      "public/barrierefreiheit.html",
      "public/stats.html",
      "public/js/demo.js",
    ];
    const uebersehen = alleMitBuster().filter((rel) => !frueher.includes(rel));
    expect(uebersehen.length).toBeGreaterThan(0);
    expect(uebersehen).toContain("public/en/privacy.html");
  });
});
