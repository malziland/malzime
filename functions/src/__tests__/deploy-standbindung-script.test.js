const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für die Stand-Bindung in scripts/deploy.sh.
 *
 * Befund OPS-2026-08-20-03: Die Bindung prüfte, ob IRGENDWO in der Liste der
 * Check-Läufe ein `<name>=success` steht. Derselbe Commit trägt aber mehrere
 * Läufe, sobald der wöchentliche Zeitplan ihn erneut prüft — am 2026-08-17 real
 * geschehen. Wird der spätere Lauf rot (ablaufende Ausnahme im
 * Abhängigkeits-Gate, neu gemeldete Lücke — beides ohne Code-Änderung), meldete
 * die Bindung weiterhin "alle sechs Pflicht-Checks grün" und ließ den Deploy zu.
 *
 * Befund OPS-2026-08-20-12: Fehlte `gh`, gab es nur eine Warnung, und der Deploy
 * lief ohne CI-Freigabe weiter — der Riegel fiel still aus.
 *
 * Der Test holt den jq-Ausdruck AUS DER ECHTEN DATEI und wendet ihn auf
 * konstruierte Lagen an. Eine Kopie des Ausdrucks im Test wäre wertlos: Sie
 * bliebe grün, während deploy.sh auseinanderdriftet. Kein Netz, keine
 * Schreibzugriffe, kein gh.
 */

const DEPLOY = path.join(__dirname, "../../../scripts/deploy.sh");
const skript = fs.readFileSync(DEPLOY, "utf8");

/** Holt den mehrzeiligen jq-Ausdruck der Stand-Bindung aus deploy.sh. */
function jqAusdruckAusSkript() {
  const start = skript.indexOf("--jq '[.check_runs[]]");
  if (start === -1) throw new Error("jq-Ausdruck der Stand-Bindung nicht gefunden");
  const ende = skript.indexOf("'", start + 7);
  return skript.slice(start + 6, ende).replace(/^'|'$/g, "");
}

function lageAuswerten(lage) {
  const jqVorhanden = (() => {
    try {
      execFileSync("jq", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (!jqVorhanden) return null; // Werkzeug fehlt -> Test meldet das, statt still zu bestehen.
  const ausgabe = execFileSync("jq", ["-r", jqAusdruckAusSkript()], {
    input: JSON.stringify(lage),
    encoding: "utf8",
  });
  return ausgabe.trim().split("\n").filter(Boolean);
}

/* Bildet die Prüfschleife aus deploy.sh nach: jeder Pflicht-Check muss als
   `<name>=success` in der ausgewerteten Lage stehen. */
function bindungLaesstDurch(zeilen, pflicht = ["test-backend"]) {
  return pflicht.every((check) => zeilen.includes(`${check}=success`));
}

describe("Stand-Bindung in deploy.sh", () => {
  test("das Werkzeug jq steht zur Verfügung (sonst ist dieser Test blind)", () => {
    expect(lageAuswerten({ check_runs: [] })).not.toBeNull();
  });

  test("OPS-03: bei zwei Läufen desselben Checks zählt der jüngste — rot blockiert", () => {
    const zeilen = lageAuswerten({
      check_runs: [
        { name: "test-backend", conclusion: "success", started_at: "2026-08-17T07:15:00Z" },
        { name: "test-backend", conclusion: "failure", started_at: "2026-08-17T07:17:00Z" },
      ],
    });
    expect(zeilen).toEqual(["test-backend=failure"]);
    expect(bindungLaesstDurch(zeilen)).toBe(false);
  });

  test("umgekehrte Reihenfolge in der Antwort ändert nichts (sortiert wird nach Zeit)", () => {
    const zeilen = lageAuswerten({
      check_runs: [
        { name: "test-backend", conclusion: "failure", started_at: "2026-08-17T07:17:00Z" },
        { name: "test-backend", conclusion: "success", started_at: "2026-08-17T07:15:00Z" },
      ],
    });
    expect(zeilen).toEqual(["test-backend=failure"]);
  });

  test("jüngster Lauf grün, älterer rot: der Deploy darf laufen", () => {
    const zeilen = lageAuswerten({
      check_runs: [
        { name: "test-backend", conclusion: "failure", started_at: "2026-08-17T07:15:00Z" },
        { name: "test-backend", conclusion: "success", started_at: "2026-08-17T07:17:00Z" },
      ],
    });
    expect(zeilen).toEqual(["test-backend=success"]);
    expect(bindungLaesstDurch(zeilen)).toBe(true);
  });

  test("ein noch laufender Check gilt als pending, nicht als Freibrief", () => {
    const zeilen = lageAuswerten({
      check_runs: [{ name: "test-backend", conclusion: null, started_at: "2026-08-17T07:17:00Z" }],
    });
    expect(zeilen).toEqual(["test-backend=pending"]);
    expect(bindungLaesstDurch(zeilen)).toBe(false);
  });

  test("OPS-12: fehlendes gh bricht ab, statt nur zu warnen", () => {
    const stelle = skript.slice(skript.indexOf("if ! command -v gh"), skript.indexOf("PFLICHT="));
    expect(stelle).toContain("FEHLER: gh nicht verfügbar");
    expect(stelle).toContain("exit 1");
    /* Die alte Fassung ließ den Deploy mit einer bloßen Warnung weiterlaufen. */
    expect(skript).not.toContain("WARNUNG: gh nicht verfügbar");
  });
});
