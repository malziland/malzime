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

const PIPEFAIL = /^\s*set\s+-[a-z]*o\s+pipefail\b|^\s*shell:\s*bash\s*$/m;

/** Shell-Skripte unter scripts/ und GitHub-Ablaeufe, in denen `pipefail` gilt
    (`set -o pipefail`, oder `shell: bash`, das GitHub mit pipefail startet). */
function dateienMitPipefail() {
  const aus = (ordner, endung) =>
    fs
      .readdirSync(path.join(WURZEL, ordner))
      .filter((n) => n.endsWith(endung))
      .map((n) => path.join(ordner, n));
  return [...aus("scripts", ".sh"), ...aus(path.join(".github", "workflows"), ".yml")].filter((datei) =>
    PIPEFAIL.test(fs.readFileSync(path.join(WURZEL, datei), "utf8"))
  );
}

/* Eine Pipe (nicht `||`), deren Glied ein grep ist, das vorzeitig aufhoert zu
   lesen: -q, -m, -l/-L als Kurzoption (auch gebuendelt oder einzeln
   hinter -E), --quiet, --silent, --max-count, --files-with(out)-match(es);
   auch egrep/fgrep, mit Umgebungsvariable, `command` oder Pfad davor. */
const PIPE_GREP = /(?<!\|)\|(?!\|)\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:command\s+)?(?:\S*\/)?[ef]?grep(?=\s|$)((?:\s+-\S+)*)/g;
function istGefahr(zeile) {
  for (const treffer of zeile.matchAll(PIPE_GREP)) {
    const optionen = treffer[1].trim().split(/\s+/).filter(Boolean);
    if (
      optionen.some(
        (o) =>
          /^--(quiet|silent|max-count|files-with(out)?-match(es)?)\b/.test(o) || /^-(?!-)[A-Za-z0-9]*[qmlL]/.test(o)
      )
    )
      return true;
  }
  return false;
}

/** Fundstellen einer Datei; Zeilen mit `\` am Ende werden mit der naechsten
    zusammengelesen, Kommentarzeilen zaehlen nicht. */
function fundstellen(datei) {
  const logisch = [];
  let offen = "";
  for (const zeile of fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\n")) {
    if (/\\\s*$/.test(zeile)) {
      offen += zeile.replace(/\\\s*$/, " ");
      continue;
    }
    logisch.push(offen + zeile);
    offen = "";
  }
  return logisch
    .filter((zeile) => !/^\s*#/.test(zeile) && istGefahr(zeile))
    .map((zeile) => `${datei}: ${zeile.trim()}`);
}

/* BEWUSSTE AUSNAHME (14.10.2026), wortgleich festgehalten — jede weitere
   Fundstelle, auch in dieser Datei, macht den Test rot.
   scripts/libheif-bauen.sh ist das Bau-Rezept des HEIC-Dekoders. Jede Aenderung
   daran loest den Nachbau samt Kontrollbau aus (Workflow libheif-bau.yml), und
   deploy.sh verlangt danach einen neuen gruenen Herkunftsnachweis. Die Stelle
   kann nur faelschlich ROT melden ("Version nicht nachweisbar", der Bau
   scheitert), nie faelschlich gruen. Umstellen mit dem naechsten Eingriff ins
   Rezept. */
const AUSNAHMEN = ['scripts/libheif-bauen.sh: if ! versionen_im_wasm "$QUELLE/libheif.wasm" | grep -qxF "$v"; then'];

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

  test("es gibt Dateien mit pipefail, darunter deploy.sh und die Dependabot-Automatik", () => {
    /* Sonst waere die Suche unten trivial leer. */
    const dateien = dateienMitPipefail();
    expect(dateien).toContain(path.join("scripts", "deploy.sh"));
    expect(dateien).toContain(path.join(".github", "workflows", "dependabot-automerge.yml"));
  });

  test.each([
    [`if ! printf '%s\\n' "$LAGE" | grep -qx "\${CHECK}=success"; then`, true],
    [`if printf '%s\\n' "$DATEIEN" | grep -q '^\\.github/'; then`, true],
    [`x | egrep -q a`, true],
    [`x | fgrep -q a`, true],
    [`x | grep -E -q a`, true],
    [`x | grep --quiet a`, true],
    [`x | grep --silent a`, true],
    [`x | grep -m1 a`, true],
    [`x | grep -m 1 a`, true],
    [`x | grep -l a`, true],
    [`x | LC_ALL=C grep -q a`, true],
    [`x | command grep -q a`, true],
    [`x | /usr/bin/grep -q a`, true],
    [`if grep -aqF "$A" "$f" || grep -aqF "$B" "$f"; then`, false],
    [`x | grep -c a`, false],
    [`x | grep -oE '[0-9]+' | head -1 || true`, false],
    [`grep -q a <<<"$T"`, false],
  ])("Suche: %s -> %s", (zeile, erwartet) => {
    expect(istGefahr(zeile)).toBe(erwartet);
  });

  test("keine Datei mit pipefail fuehrt Text per Pipe in ein vorzeitig endendes grep (ausser der einen festgehaltenen Ausnahme)", () => {
    const funde = dateienMitPipefail().flatMap(fundstellen);
    expect(funde.filter((f) => !AUSNAHMEN.includes(f))).toEqual([]);
    /* Die Ausnahme muss noch dastehen — ist sie behoben, faellt sie hier auf
       und wird aus der Liste gestrichen. */
    expect(AUSNAHMEN.filter((a) => !funde.includes(a))).toEqual([]);
  });
});
