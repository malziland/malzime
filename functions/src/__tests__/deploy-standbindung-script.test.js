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

  /* ────────────────────────────────────────────────────────────────────
     Die Abkuerzung ueber die Git-Baum-Kennung (31.08.2026)

     BEFUND aus dem zweiten Review: Diese 48 Zeilen — der sicherheits-
     kritischste Teil des Skripts — waren von KEINEM Test und keiner
     Waechter-Regel erfasst. Der im Kommentar dokumentierte Rueckfall
     (`LAGE="$LAGE_PR"` statt selektivem Nachtragen) liess sich wieder
     einbauen, ohne dass irgendetwas rot wurde. Genau dieser Rueckfall
     haette einen ROTEN Pflicht-Check auf main durch ein gruenes Ergebnis
     des Pull Requests verdraengt.

     Die Tests hier lesen die Logik AUS DER ECHTEN DATEI. Eine Kopie waere
     wertlos: Sie bliebe gruen, waehrend deploy.sh auseinanderdriftet.
     ──────────────────────────────────────────────────────────────────── */
  describe("Abkuerzung ueber die Baum-Kennung", () => {
    /* Der Abschnitt zwischen dem Baum-Vergleich und dem Ende der Ersetzung. */
    function abschnitt() {
      const start = skript.indexOf('if [ "$BAUM_HIER" = "$BAUM_PR" ]');
      const ende = skript.indexOf('if [ -z "$LAGE" ]');
      if (start === -1 || ende === -1) {
        throw new Error("Abkuerzungs-Abschnitt in deploy.sh nicht gefunden");
      }
      return skript.slice(start, ende);
    }

    test("der Abschnitt ist ueberhaupt auffindbar (Messmittel-Probe)", () => {
      /* Ohne diese Zeile wuerden alle folgenden Pruefungen an einem leeren
         Text vorbeilaufen und stillschweigend bestehen. */
      expect(abschnitt().length).toBeGreaterThan(400);
    });

    test("die GESAMTE Lage wird NICHT ersetzt — nur Ausstehendes nachgetragen", () => {
      const a = abschnitt();
      /* Der dokumentierte Rueckfall. Steht er wieder da, ist die
         Sicherheitsluecke zurueck: gruen verdraengt rot. */
      expect(a).not.toMatch(/^\s*LAGE="\$LAGE_PR"\s*$/m);
      /* Stattdessen: eintragsweise, und nur wo nichts entschieden ist. */
      expect(a).toContain("NEUE_LAGE");
      expect(a).toMatch(/WERT.*=.*"pending"/);
    });

    test("ein rotes Ergebnis wird nicht ueberschrieben", () => {
      const a = abschnitt();
      /* Ersetzt wird ausschliesslich bei pending/null/leer — failure kommt
         in keiner Bedingung vor, die eine Ersetzung ausloest. */
      const bedingung = a.slice(a.indexOf("UEBERSPRINGEN"), a.indexOf('NEUE_LAGE="$NEUE_LAGE'));
      expect(bedingung).toContain('"pending"');
      expect(bedingung).not.toContain('"failure"');
    });

    test("zeitabhaengige Pruefungen sind ausgenommen", () => {
      const a = abschnitt();
      /* test-backend fuehrt audit-gate mit ablaufender Ausnahmeliste, die
         Frist-Bremse und npm audit. Ein gruenes Ergebnis von gestern kann
         dort heute falsch sein, ohne dass sich eine Zeile geaendert hat. */
      expect(a).toContain("ZEITABHAENGIG=");
      expect(a).toContain("test-backend");
    });

    test("ohne Baumgleichheit passiert gar nichts", () => {
      /* Der Vergleich ist die einzige Tuer zur Abkuerzung. Faellt er weg,
         gilt wieder ausschliesslich, was main sagt. */
      expect(skript).toContain('if [ "$BAUM_HIER" = "$BAUM_PR" ]');
      expect(skript).toContain('BAUM_HIER=$(git rev-parse "HEAD^{tree}"');
    });

    test("fail-closed, wenn der PR-Kopf nicht holbar ist", () => {
      const stelle = skript.slice(
        skript.indexOf("if git fetch -q origin"),
        skript.indexOf('if [ "$BAUM_HIER" = "$BAUM_PR" ]')
      );
      expect(stelle).toContain("kein-baum-hier");
      expect(stelle).toContain("kein-baum-dort");
      /* Zwei verschiedene Platzhalter — sonst waeren sie gleich und die
         Abkuerfung wuerde ausgerechnet im Fehlerfall greifen. */
      expect(stelle).toMatch(/BAUM_HIER="kein-baum-hier"/);
      expect(stelle).toMatch(/BAUM_PR="kein-baum-dort"/);
    });
  });

  test("OPS-12: fehlendes gh bricht ab, statt nur zu warnen", () => {
    const stelle = skript.slice(skript.indexOf("if ! command -v gh"), skript.indexOf("PFLICHT="));
    expect(stelle).toContain("FEHLER: gh nicht verfügbar");
    expect(stelle).toContain("exit 1");
    /* Die alte Fassung ließ den Deploy mit einer bloßen Warnung weiterlaufen. */
    expect(skript).not.toContain("WARNUNG: gh nicht verfügbar");
  });
});
