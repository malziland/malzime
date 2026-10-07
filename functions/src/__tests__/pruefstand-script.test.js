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
      /* Die Rueckbauprobe (seit 10.09.2026) wird immer eingespeist — ohne das
         liefe in jedem dieser Tests die echte, drei Minuten lange Probe, und
         sie veraendert voruebergehend Quelldateien. */
      env: { ...process.env, PRUEFSTAND_PROBE_RUECKBAU: datei("r.log", RUECKBAU_GRUEN), ...umgebung },
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
const RUECKBAU_GRUEN = "   Alle 10 Rueckbauten werden bemerkt. Die Fixes sind abgesichert.\n";

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

  test("rote Rückbauprobe: Abbruch mit Meldung, Matrix unberührt", () => {
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    /* Wie bei den Suiten: Eine fehlende Datei laesst cat scheitern — so sieht
       ein unbemerkter Rueckbau oder ein fehlendes Muster fuer den Stempler aus. */
    const r = lauf({
      PRUEFSTAND_PROBE_BACKEND: datei("b.log", BACKEND_OHNE_SKIP),
      PRUEFSTAND_PROBE_FRONTEND: datei("f.log", FRONTEND),
      PRUEFSTAND_PROBE_E2E: datei("e.log", E2E),
      PRUEFSTAND_PROBE_RUECKBAU: path.join(basis, "gibt-es-nicht.log"),
      PRUEFSTAND_MATRIX: m,
    });
    expect(r.code).toBe(1);
    expect(r.aus).toMatch(/Rueckbauprobe rot/);
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

  /* OPS-2026-10-04-25: Der Stempler nahm jede Zahl größer null. Fällt aus einer
     Testreihe der größte Teil heraus (ein Filter, eine Einstellung, ein Ordner),
     läuft der Rest grün — und in der Matrix stand danach „15/15 grün", wo
     vorher 919 standen. Verglichen wird deshalb mit dem letzten Stempel. */
  describe("Rückgang gegenüber dem letzten Stempel", () => {
    /** Eine Matrix, wie der Stempler sie hinterlässt: mit lesbarem letzten Stand. */
    function gestempelteMatrix(backend, frontend, e2e) {
      const stempel = (n) => `✅ ${n}/${n} grün — \`scripts/pruefstand.sh\`, Commit abc1234, 2026-10-01 |`;
      return datei(
        "matrix.md",
        [
          `| Backend-Unit-Tests | lokal \`npm test\` | ${stempel(backend)}`,
          `| Frontend-Unit-Tests | lokal \`npm run test:frontend\` | ${stempel(frontend)}`,
          `| E2E kritischster Nutzerfluss (Demo) | lokal \`npm run test:e2e\` | ${stempel(e2e)}`,
          "",
        ].join("\n")
      );
    }
    const backendMit = (n) => `Test Suites: 45 passed, 45 total\nTests:       ${n} passed, ${n} total\n`;
    const frontendMit = (n) => `      Tests  ${n} passed (${n})\n`;
    const e2eMit = (n) => `  ${n} passed (2.4m)\n`;

    function stempeln(m, backend, frontend, e2e, umgebung = {}) {
      return lauf({
        PRUEFSTAND_PROBE_BACKEND: datei("b.log", backendMit(backend)),
        PRUEFSTAND_PROBE_FRONTEND: datei("f.log", frontendMit(frontend)),
        PRUEFSTAND_PROBE_E2E: datei("e.log", e2eMit(e2e)),
        PRUEFSTAND_MATRIX: m,
        ...umgebung,
      });
    }

    test("15 statt 919 Server-Tests: Abbruch mit beiden Zahlen, Matrix unberührt", () => {
      const m = gestempelteMatrix(919, 315, 18);
      const vorher = fs.readFileSync(m, "utf8");
      const r = stempeln(m, 15, 315, 18);
      expect(r.aus).toMatch(/ABBRUCH: Backend-Unit-Tests: 15 Tests, im letzten Stempel 919/);
      expect(r.code).toBe(1);
      expect(fs.readFileSync(m, "utf8")).toBe(vorher);
    });

    test.each([
      ["Browser-Module", [919, 20, 18], /ABBRUCH: Frontend-Unit-Tests: 20 Tests, im letzten Stempel 315/],
      ["Browser-Durchläufe", [919, 315, 2], /ABBRUCH: E2E kritischster Nutzerfluss: 2 Tests, im letzten Stempel 18/],
    ])("Rückgang nur bei %s: Abbruch, und auch die anderen Zeilen bleiben ungestempelt", (_was, zahlen, meldung) => {
      const m = gestempelteMatrix(919, 315, 18);
      const vorher = fs.readFileSync(m, "utf8");
      const r = stempeln(m, ...zahlen);
      expect(r.aus).toMatch(meldung);
      expect(r.code).toBe(1);
      expect(fs.readFileSync(m, "utf8")).toBe(vorher);
    });

    test("die Grenze: 900 von 1000 wird gestempelt, 899 nicht", () => {
      const knappDrueber = gestempelteMatrix(1000, 315, 18);
      expect(stempeln(knappDrueber, 900, 315, 18).code).toBe(0);
      expect(fs.readFileSync(knappDrueber, "utf8")).toContain("900/900 grün");

      const knappDrunter = gestempelteMatrix(1000, 315, 18);
      const vorher = fs.readFileSync(knappDrunter, "utf8");
      const r = stempeln(knappDrunter, 899, 315, 18);
      expect(r.code).toBe(1);
      expect(r.aus).toMatch(/899 Tests, im letzten Stempel 1000/);
      expect(fs.readFileSync(knappDrunter, "utf8")).toBe(vorher);
    });

    test("mehr Tests als im letzten Stempel und ein kleiner Rückgang: wird gestempelt", () => {
      const m = gestempelteMatrix(919, 315, 18);
      const r = stempeln(m, 940, 310, 18);
      expect(r.code).toBe(0);
      expect(r.aus).not.toMatch(/ABBRUCH/);
      const inhalt = fs.readFileSync(m, "utf8");
      expect(inhalt).toContain("940/940 grün");
      expect(inhalt).toContain("310/310 grün");
    });

    test("ein bewusster Rückgang lässt sich bestätigen — der Lauf nennt ihn dann laut", () => {
      const m = gestempelteMatrix(919, 315, 18);
      const r = stempeln(m, 15, 315, 18, { PRUEFSTAND_RUECKGANG_ERLAUBT: "1" });
      expect(r.code).toBe(0);
      expect(r.aus).toMatch(
        /RÜCKGANG BESTÄTIGT \(PRUEFSTAND_RUECKGANG_ERLAUBT=1\): Backend-Unit-Tests: 15 Tests, im letzten Stempel 919/
      );
      expect(fs.readFileSync(m, "utf8")).toContain("15/15 grün");
    });

    test("ohne lesbaren letzten Stempel: wird gestempelt, mit Hinweis, dass der Vergleich entfällt", () => {
      const m = matrix();
      const r = stempeln(m, 15, 315, 18);
      expect(r.code).toBe(0);
      expect(r.aus).toMatch(/Hinweis: Backend-Unit-Tests: kein früherer Stempel lesbar — der Vergleich entfällt/);
      expect(fs.readFileSync(m, "utf8")).toContain("15/15 grün");
    });
  });

  test("im Betrieb (ohne Einspeisung) bleibt der Aufrufweg unverändert", () => {
    /* Die Einspeisepunkte dürfen den Normalbetrieb nicht verändern: ohne
       gesetzte Variablen müssen die echten npm-Kommandos im Skript stehen. */
    const skript = fs.readFileSync(SKRIPT, "utf8");
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_BACKEND npm test --prefix functions/);
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_FRONTEND npm run test:frontend/);
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_E2E npm run test:e2e/);
    expect(skript).toMatch(/probe_oder_lauf PRUEFSTAND_PROBE_RUECKBAU sh scripts\/rueckbauprobe-betriebswerte\.sh/);
  });
});
