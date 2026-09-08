/**
 * changelog-oberste-version-script.test.js — das Skript, das der Release-Automatik
 * die oberste CHANGELOG-Version nennt, muss auch mit einer GROSSEN Datei ueber
 * eine Pipe sauber laufen.
 *
 * BEFUND 08.09.2026: "Auto-Release aus CHANGELOG" ging auf main rot mit
 * `printf: I/O error` und `Broken pipe`. Ursache: `grep -m1` beendete nach dem
 * ersten Treffer, waehrend printf den Rest des CHANGELOG (470 KB, mehr als ein
 * Pipe-Puffer) noch schrieb — SIGPIPE. Der Fehler blieb unsichtbar, solange die
 * Datei klein war und kein veroeffentlichter Abschnitt nach dem Tag geaendert
 * wurde (release.yml liest dafuer den Elternstand ueber `git show | sh …`).
 *
 * Der Lauf hier nutzt `sh` — in der Pipeline dash, das den Fehler zeigt; auf dem
 * Mac bash, das ihn verschluckt. Deshalb wird zusaetzlich stderr geprueft: Es
 * muss leer sein, und die Ausgabe muss stimmen.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const SKRIPT = path.join(__dirname, "..", "..", "..", "scripts", "changelog-oberste-version.sh");

/* Ein CHANGELOG, der deutlich groesser ist als ein Pipe-Puffer (64 KB). */
function grosserChangelog(oberste) {
  const kopf = `# Changelog\n\n## [${oberste}] — 2026-09-08\n\n### Behoben\n\n`;
  const rumpf = "- Ein Eintrag mit genug Text, damit die Datei gross wird.\n".repeat(12000);
  return kopf + rumpf + "\n## [1.0.0] — 2026-01-01\n\n- alt\n";
}

/* Unter der Laeufer-Bedingung starten: GitHub-Runner ignorieren SIGPIPE, ein
   abgerissenes Rohr wird dort zum sichtbaren Schreibfehler statt zum stillen
   Ende. Auf dem Mac beendet das Signal den Schreiber lautlos — ohne `trap` bliebe
   der Fehler hier unsichtbar (Rueckbauprobe 08.09.2026: erst mit trap rot). */
function lauf(eingabe, args = []) {
  return spawnSync("sh", ["-c", 'trap "" PIPE; exec sh "$0" "$@"', SKRIPT, ...args], {
    input: eingabe,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe("changelog-oberste-version.sh", () => {
  test("Positivkontrolle: die Eingabe ist groesser als ein Pipe-Puffer", () => {
    expect(Buffer.byteLength(grosserChangelog("4.7.0"))).toBeGreaterThan(64 * 1024 * 4);
  });

  test("ueber stdin, gross: nennt die oberste Version, ohne Fehler auf stderr, RC 0", () => {
    const r = lauf(grosserChangelog("4.7.0"));
    expect(r.stdout.trim()).toBe("4.7.0");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("[Unveroeffentlicht] oben: nennt es und endet mit RC 1 (kein Release), ohne Fehler", () => {
    const r = lauf(grosserChangelog("Unveröffentlicht"));
    expect(r.stdout.trim()).toBe("Unveröffentlicht");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(1);
  });

  test("ein Beispiel im Code-Zaun gewinnt nicht gegen die echte Ueberschrift", () => {
    const r = lauf("# X\n\n```\n## [9.9.9]\n```\n\n## [4.7.0] — 2026-09-08\n");
    expect(r.stdout.trim()).toBe("4.7.0");
    expect(r.status).toBe(0);
  });
});
