/**
 * skript-rechte.test.js — sind die Skripte ausfuehrbar?
 *
 * BEFUND 01.09.2026 (Pruefrunde 8, N-P1-1): `scripts/deploy.sh` hatte sein
 * Ausfuehrungsbit verloren (100755 auf origin/main, 100644 im Zweig). Es war
 * das einzige der zwanzig Skripte ohne. Der Weg, den docs/RUNBOOK.md
 * vorschreibt — `./scripts/deploy.sh` —, waere mit "permission denied"
 * gescheitert.
 *
 * KEIN Test hat es bemerkt, und das ist der eigentliche Punkt: Alle drei
 * deploy-Tests rufen `execFileSync("bash", ["scripts/deploy.sh", …])` und
 * umgehen das Bit damit vollstaendig. Verloren ging es beim Hin- und
 * Zurueckkopieren ueber /tmp waehrend der Rueckbauproben — eine Handbewegung,
 * die keine Spur im Diff hinterlaesst ausser der Modus-Zeile.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WURZEL = path.join(__dirname, "..", "..", "..");
const SKRIPTE = path.join(WURZEL, "scripts");

/** Alle Shell-Skripte im scripts-Verzeichnis. */
function shellSkripte() {
  return fs
    .readdirSync(SKRIPTE)
    .filter((n) => n.endsWith(".sh"))
    .map((n) => path.join("scripts", n));
}

describe("Ausfuehrungsrechte der Skripte", () => {
  test("es gibt ueberhaupt welche", () => {
    /* Sonst waere der Test unten trivial wahr. */
    expect(shellSkripte().length).toBeGreaterThan(10);
  });

  test.each(shellSkripte())("%s ist ausfuehrbar", (datei) => {
    const voll = path.join(WURZEL, datei);
    expect(() => fs.accessSync(voll, fs.constants.X_OK)).not.toThrow();
  });

  test("und git kennt das Bit auch — nicht nur die Arbeitskopie", () => {
    /* Ohne diese Pruefung geht das Recht beim naechsten frischen Klon wieder
       verloren: Die Arbeitskopie kann ausfuehrbar sein, waehrend im Index
       100644 steht. */
    const roh = execFileSync("git", ["ls-files", "-s", "scripts/"], {
      cwd: WURZEL,
      encoding: "utf8",
    });
    const ohneBit = roh
      .split("\n")
      .map((z) => z.split("\t"))
      .filter(([, name]) => name && /^scripts\/[^/]+\.sh$/.test(name))
      /* Nur die Skripte selbst. Unter scripts/pruefungen/negativprobe/ liegt
         BEISPIELMATERIAL fuer die Pruefungen — absichtlich kaputte Skripte,
         die niemand ausfuehrt. Sie brauchen kein Recht dazu. */
      /* `git ls-files -s` liefert "<modus> <hash> <stufe>\t<name>" — der
         Modus ist nur das ERSTE Feld vor dem Leerzeichen, nicht die ganze
         Spalte. */
      .filter(([spalte]) => spalte.split(" ")[0] !== "100755")
      .map(([, name]) => name);
    expect(ohneBit).toEqual([]);
  });
});
