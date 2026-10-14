/**
 * pipefail-suche.test.js — keine vorzeitig endende Suche hinter einer Pipe,
 * wo `pipefail` gilt.
 *
 * BEFUND 14.10.2026 (PR #324, test-backend rot auf GitHub, lokal nie): Der
 * Riegel in scripts/deploy.sh meldete "Pflicht-Check test-e2e ist nicht gruen
 * (Ist: test-e2e=success)". Die Daten der Attrappe waren dieselben wie in
 * tausenden gruenen Laeufen — nur das Ergebnis nicht.
 *
 * Mechanismus: `printf '%s\n' "$TEXT" | grep -q MUSTER`. `grep -q` beendet
 * sich beim ersten Treffer. Schreibt printf danach noch (die bash auf GitHub
 * schreibt zeilenweise), trifft es auf eine geschlossene Pipe und stirbt an
 * SIGPIPE. Unter `pipefail` meldet die Pipe dann 141 statt 0 — der Treffer
 * zaehlt als keiner. Ob printf vorher fertig ist, entscheidet der Zufall der
 * Prozessverteilung; seit die Testdateien nebeneinander laufen (5.2.2) oefter.
 *
 * Abhilfe: Der Text geht als Here-String hinein (`grep -q MUSTER <<<"$TEXT"`)
 * und ist fertig geschrieben, bevor grep liest.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WURZEL = path.join(__dirname, "..", "..", "..");
const SKRIPTE = path.join(WURZEL, "scripts");

/** Shell-Skripte unter scripts/, in denen `pipefail` eingeschaltet wird. */
function skripteMitPipefail() {
  return fs
    .readdirSync(SKRIPTE)
    .filter((n) => n.endsWith(".sh"))
    .filter((n) => /^\s*set\s+-[a-z]*o\s+pipefail\b/m.test(fs.readFileSync(path.join(SKRIPTE, n), "utf8")))
    .map((n) => path.join("scripts", n));
}

/* Eine Pipe, deren letztes Glied ein `grep -q…` ist — die gefaehrliche Form.
   `||` ist keine Pipe, sondern "oder". Kommentarzeilen zaehlen nicht. */
const GEFAHR = /(?<!\|)\|(?!\|)\s*grep\s+-[A-Za-z]*q/;

/* BEWUSSTE AUSNAHME (14.10.2026), wortgleich festgehalten — jede weitere
   Fundstelle, auch in dieser Datei, macht den Test rot.
   scripts/libheif-bauen.sh ist das Bau-Rezept des HEIC-Dekoders. Jede Aenderung
   daran loest den Nachbau samt Kontrollbau aus (Workflow libheif-bau.yml), und
   deploy.sh verlangt danach einen neuen gruenen Herkunftsnachweis. Die Stelle
   kann nur faelschlich ROT melden ("Version nicht nachweisbar", der Bau
   scheitert), nie faelschlich gruen. Umstellen mit dem naechsten Eingriff ins
   Rezept. */
const AUSNAHMEN = ['scripts/libheif-bauen.sh: if ! versionen_im_wasm "$QUELLE/libheif.wasm" | grep -qxF "$v"; then'];

function fundstellen(datei) {
  return fs
    .readFileSync(path.join(WURZEL, datei), "utf8")
    .split("\n")
    .map((zeile, i) => ({ zeile, nr: i + 1 }))
    .filter(({ zeile }) => !/^\s*#/.test(zeile) && GEFAHR.test(zeile))
    .map(({ zeile }) => `${datei}: ${zeile.trim()}`);
}

function bash(befehl) {
  return spawnSync("bash", ["-c", befehl], { encoding: "utf8" }).status;
}

describe("pipefail und vorzeitig endende Suche", () => {
  test("der Mechanismus ist echt: Schreiber in zwei Teilen, Suche endet nach dem ersten -> 141", () => {
    /* Die Pause erzwingt, was auf GitHub der Zufall tat: grep ist fertig,
       bevor printf seine zweite Zeile schreibt. */
    const alt = bash("set -o pipefail; { printf 'a=success\\n'; sleep 0.3; printf 'b=x\\n'; } | grep -qx a=success");
    expect(alt).toBe(141);
  });

  test("die Abhilfe haelt: derselbe Text als Here-String -> 0", () => {
    const neu = bash(
      "set -o pipefail; T=\"$({ printf 'a=success\\n'; sleep 0.3; printf 'b=x\\n'; })\"; grep -qx a=success <<<\"$T\""
    );
    expect(neu).toBe(0);
  });

  test("es gibt Skripte mit pipefail, darunter deploy.sh", () => {
    /* Sonst waere die Suche unten trivial leer. */
    expect(skripteMitPipefail()).toContain(path.join("scripts", "deploy.sh"));
  });

  test("die Suche erkennt die alte Form aus deploy.sh und laesst `||` in Ruhe", () => {
    expect(GEFAHR.test(`if ! printf '%s\\n' "$LAGE" | grep -qx "\${CHECK}=success"; then`)).toBe(true);
    expect(GEFAHR.test(`if grep -aqF "$A" "$f" || grep -aqF "$B" "$f"; then`)).toBe(false);
  });

  test("kein Skript mit pipefail fuehrt Text per Pipe in `grep -q` (ausser der einen festgehaltenen Ausnahme)", () => {
    const funde = skripteMitPipefail().flatMap(fundstellen);
    expect(funde.filter((f) => !AUSNAHMEN.includes(f))).toEqual([]);
    /* Die Ausnahme muss noch dastehen — ist sie behoben, faellt sie hier auf
       und wird aus der Liste gestrichen. */
    expect(AUSNAHMEN.filter((a) => !funde.includes(a))).toEqual([]);
  });
});
