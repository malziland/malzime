const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für scripts/pruefstand.sh (Befund OPS-2026-08-13-32).
 *
 * Der Stempler starb wortlos: Ein leeres grep beendet unter `set -e` +
 * `pipefail` das ganze Skript sofort — die Plausibilitätsprüfung, die genau
 * diesen Fall melden soll, wurde nie erreicht. Ausgelöst, als ein bewusst
 * übersprungener Test die Jest-Ausgabe auf "1 skipped, 795 passed" änderte.
 *
 * Dazu die zweite Hälfte des Befunds: Die Plausibilitätsprüfung lag HINTER
 * sechs Minuten Suitenlauf — sie war praktisch nicht auslösbar, und die erste
 * Negativprobe starb unterwegs an einer flackernden Suite, ohne dass es
 * auffiel. Deshalb die Einspeisepunkte PRUEFSTAND_PROBE_*: vorbereitete
 * Suiten-Ausgaben statt echter Läufe, der ganze Rest (Zahlen lesen,
 * Plausibilität, Stempeln) unverändert. Diese Tests laufen dadurch in
 * Sekunden statt Minuten.
 */

const SKRIPT = path.join(__dirname, "../../../scripts/pruefstand.sh");

let basis;

beforeEach(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "pruefstand-"));
});

afterEach(() => {
  fs.rmSync(basis, { recursive: true, force: true });
});

function datei(name, inhalt) {
  const p = path.join(basis, name);
  fs.writeFileSync(p, inhalt);
  return p;
}

/* Eine Matrix mit genau den drei Zeilen, die der Stempler ersetzt. */
function matrix() {
  return datei(
    "matrix.md",
    [
      "| Backend-Unit-Tests | lokal `npm test` | alt |",
      "| Frontend-Unit-Tests | lokal `npm run test:frontend` | alt |",
      "| E2E kritischster Nutzerfluss (Demo) | lokal `npm run test:e2e` | alt |",
      "",
    ].join("\n")
  );
}

function lauf(umgebung) {
  try {
    const aus = execFileSync("bash", [SKRIPT], {
      encoding: "utf8",
      env: { ...process.env, ...umgebung },
    });
    return { code: 0, aus, fehler: "" };
  } catch (e) {
    return { code: e.status, aus: e.stdout || "", fehler: e.stderr || "" };
  }
}

/* Suiten-Ausgaben, wie die drei Werkzeuge sie wirklich drucken. */
const BACKEND_MIT_SKIP = "Test Suites: 45 passed, 45 total\nTests:       1 skipped, 796 passed, 797 total\n";
const BACKEND_OHNE_SKIP = "Test Suites: 45 passed, 45 total\nTests:       797 passed, 797 total\n";
const FRONTEND = "      Tests  315 passed (315)\n";
const E2E = "  18 passed (2.4m)\n";

describe("pruefstand.sh", () => {
  test("übersprungener Test: stempelt und weist ihn aus, statt ihn wegzurechnen", () => {
    const m = matrix();
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: datei("b.log", BACKEND_MIT_SKIP),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(0);
    const inhalt = fs.readFileSync(m, "utf8");
    /* Der Kern von OPS-32: "796/797 grün (1 übersprungen)" — nicht "796/796". */
    expect(inhalt).toContain("796/797 grün (1 übersprungen)");
    expect(inhalt).not.toContain("796/796");
    expect(inhalt).toContain("315/315 grün");
    expect(inhalt).toContain("18/18 grün");
  });

  test("ohne übersprungene Tests bleibt der Stempel schlicht", () => {
    const m = matrix();
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: datei("b.log", BACKEND_OHNE_SKIP),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(m, "utf8")).toContain("797/797 grün");
  });

  test("unlesbares Ausgabeformat: SAGT es und stempelt nichts (der wortlose Tod von OPS-32)", () => {
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: datei("b.log", "Suite lief, aber ohne die Zeile, die er sucht\n"),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(1);
    /* Vorher: Exit 1 ohne ein Wort. Jetzt: die Meldung der Plausibilitätsprüfung. */
    expect(r.aus).toMatch(/Testanzahl nicht lesbar/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("rote Suite: Abbruch mit Meldung, Matrix unberührt", () => {
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    /* probe_oder_lauf liest die Datei mit cat — eine fehlende Datei lässt cat
       (und damit die Suite-Stufe) scheitern, wie eine rote Suite. */
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: path.join(basis, "gibt-es-nicht.log"),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(1);
    expect(r.aus).toMatch(/Backend-Suite rot/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("veränderter Tabellenaufbau: Abbruch mit Meldung statt halbem Stempel", () => {
    const m = datei("matrix.md", "| Ganz andere Tabelle | x | y |\n");
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: datei("b.log", BACKEND_MIT_SKIP),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(1);
    expect(r.aus).toMatch(/Tabellenaufbau geändert/);
  });

  test("im Betrieb (ohne Einspeisung) bleibt der Aufrufweg unverändert", () => {
    /* Die Einspeisepunkte dürfen den Normalbetrieb nicht verändern: ohne
       gesetzte Variablen müssen die echten npm-Kommandos im Skript stehen. */
    const skript = fs.readFileSync(SKRIPT, "utf8");
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_BACKEND npm test --prefix functions/);
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_FRONTEND npm run test:frontend/);
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_E2E npm run test:e2e/);
  });
});
