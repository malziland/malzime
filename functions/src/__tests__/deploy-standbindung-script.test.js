const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { ghSeitenAttrappeAnlegen, lauf, fremdeLaeufe, pflichtLaeufe, PFLICHT } = require("./hilfen/gh-seiten-attrappe");

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
 * Befund OPS-2026-10-03-18: Die Abfrage holte nur die erste Seite der Antwort
 * (30 Läufe). Hängen mehr Läufe am Commit — jeder Nachtlauf fügt vier hinzu —,
 * fielen die Pflicht-Checks heraus, und die Bindung meldete "fehlt".
 *
 * Der Test holt die Funktion `check_lage` AUS DER ECHTEN DATEI und führt sie
 * aus: die Abfrage samt Blättern und der Auswahl des jüngsten Laufs je Check.
 * Eine Kopie im Test wäre wertlos: Sie bliebe grün, während deploy.sh
 * auseinanderdriftet. `gh` ist dabei eine Attrappe, die die Läufe seitenweise
 * liefert wie die GitHub-Schnittstelle (hilfen/gh-seiten-attrappe.js). Kein
 * Netz, keine Schreibzugriffe im Projekt.
 */

const DEPLOY = path.join(__dirname, "../../../scripts/deploy.sh");
const skript = fs.readFileSync(DEPLOY, "utf8");

/** Holt die Funktion `check_lage` aus deploy.sh: Abfrage, Blättern, Auswahl. */
function funktionAusSkript() {
  const start = skript.indexOf("check_lage() {");
  if (start === -1) throw new Error("Funktion check_lage in deploy.sh nicht gefunden");
  const ende = skript.indexOf("\n}\n", start);
  if (ende === -1) throw new Error("Ende der Funktion check_lage in deploy.sh nicht gefunden");
  return skript.slice(start, ende + 2);
}

let attrappenOrdner;
let aufrufeDatei;

/** Der Ordner mit der gh-Attrappe; angelegt beim ersten Gebrauch. */
function attrappe() {
  if (!attrappenOrdner) {
    attrappenOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-standbindung-"));
    ghSeitenAttrappeAnlegen(attrappenOrdner);
    aufrufeDatei = path.join(attrappenOrdner, "aufrufe.txt");
  }
  return attrappenOrdner;
}

afterAll(() => {
  if (attrappenOrdner) fs.rmSync(attrappenOrdner, { recursive: true, force: true });
});

/** Führt `check_lage` gegen die genannten Läufe aus und gibt die Zeilen
 *  "name=ergebnis" zurück. `seiteRot` lässt den Abruf dieser Seite scheitern. */
function lageAuswerten(lage, { seiteRot } = {}) {
  const jqVorhanden = (() => {
    try {
      execFileSync("jq", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (!jqVorhanden) return null; // Werkzeug fehlt -> Test meldet das, statt still zu bestehen.
  const laeufeDatei = path.join(attrappe(), "laeufe.json");
  fs.writeFileSync(laeufeDatei, JSON.stringify(lage.check_runs));
  fs.rmSync(aufrufeDatei, { force: true });
  const ausgabe = execFileSync("bash", ["-c", `set -euo pipefail\n${funktionAusSkript()}\ncheck_lage "abc123"\n`], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${attrappenOrdner}:${process.env.PATH}`,
      ATTRAPPE_CHECK_LAEUFE: laeufeDatei,
      ATTRAPPE_CHECK_AUFRUFE: aufrufeDatei,
      ATTRAPPE_CHECK_SEITE_ROT: seiteRot ? String(seiteRot) : "",
    },
  });
  return ausgabe.trim().split("\n").filter(Boolean);
}

/** Die Abfragen des letzten Laufs von lageAuswerten, eine je Seite. */
function abfragen() {
  return fs.existsSync(aufrufeDatei) ? fs.readFileSync(aufrufeDatei, "utf8").split("\n").filter(Boolean) : [];
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
     Viele Läufe an einem Commit (OPS-2026-10-03-18)

     Die Schnittstelle liefert die Läufe seitenweise: ohne Angabe 30 je Seite,
     höchstens 100. Die Attrappe schneidet die Antwort genauso.
     ──────────────────────────────────────────────────────────────────── */
  describe("viele Läufe an einem Commit: Seitenlänge 100 und blättern", () => {
    test("die Abfrage verlangt die größte Seitenlänge; wenige Läufe brauchen eine Abfrage", () => {
      lageAuswerten({ check_runs: pflichtLaeufe() });
      expect(abfragen()).toHaveLength(1);
      expect(abfragen()[0]).toMatch(/\/check-runs\?per_page=100&page=1$/);
    });

    test("31 Läufe: der Pflicht-Check an Stelle 31 fehlt nicht", () => {
      const laeufe = [...fremdeLaeufe(25), ...pflichtLaeufe()];
      expect(laeufe).toHaveLength(31);
      expect(laeufe[30].name).toBe("pruefungen");
      const zeilen = lageAuswerten({ check_runs: laeufe });
      expect(zeilen).toContain("pruefungen=success");
      expect(bindungLaesstDurch(zeilen, PFLICHT)).toBe(true);
    });

    test("Gegenprobe: 30 je Seite und nur die erste Seite — dann fehlt genau dieser Check", () => {
      /* Belegt, dass die Attrappe die Lücke überhaupt nachbilden kann. Die
         Abfrage unten ist die frühere: ohne Seitenlänge, ohne Blättern, mit
         der Auswertung je Antwort. */
      const laeufe = [...fremdeLaeufe(25), ...pflichtLaeufe()];
      const laeufeDatei = path.join(attrappe(), "laeufe.json");
      fs.writeFileSync(laeufeDatei, JSON.stringify(laeufe));
      const frueher = execFileSync(
        path.join(attrappe(), "gh"),
        [
          "api",
          "repos/malziland/malzime/commits/abc123/check-runs",
          "--jq",
          '[.check_runs[]] | group_by(.name) | map(max_by(.started_at)) | .[] | "\\(.name)=\\(.conclusion // "pending")"',
        ],
        { encoding: "utf8", env: { ...process.env, ATTRAPPE_CHECK_LAEUFE: laeufeDatei, ATTRAPPE_CHECK_AUFRUFE: "" } }
      )
        .trim()
        .split("\n");
      expect(frueher).toContain("test-backend=success");
      expect(frueher).not.toContain("pruefungen=success");
      expect(bindungLaesstDurch(frueher, PFLICHT)).toBe(false);
    });

    test("genau 100 Läufe: eine volle Seite — es wird nach der nächsten gefragt, nichts fehlt", () => {
      const laeufe = [...fremdeLaeufe(94), ...pflichtLaeufe()];
      expect(laeufe).toHaveLength(100);
      const zeilen = lageAuswerten({ check_runs: laeufe });
      expect(abfragen().map((a) => a.replace(/.*&page=/, ""))).toEqual(["1", "2"]);
      expect(bindungLaesstDurch(zeilen, PFLICHT)).toBe(true);
    });

    test("250 Läufe: drei Seiten, und die Pflicht-Checks auf der letzten zählen mit", () => {
      const laeufe = [...fremdeLaeufe(244), ...pflichtLaeufe()];
      const zeilen = lageAuswerten({ check_runs: laeufe });
      expect(abfragen().map((a) => a.replace(/.*&page=/, ""))).toEqual(["1", "2", "3"]);
      expect(bindungLaesstDurch(zeilen, PFLICHT)).toBe(true);
      /* Je Check genau EINE Zeile — auch für die vier Namen, die auf jeder
         Seite vorkommen. */
      expect(zeilen.filter((z) => z.startsWith("alarm="))).toEqual(["alarm=success"]);
    });

    test("ein jüngerer roter Lauf auf Seite 2 schlägt den älteren grünen auf Seite 1", () => {
      /* Je Seite ausgewertet, stünden beide Ergebnisse da, und die Bindung
         fände das grüne. */
      const laeufe = [
        ...pflichtLaeufe("2026-08-17T07:15:00Z"),
        ...fremdeLaeufe(100),
        lauf("test-backend", "failure", "2026-08-24T07:15:00Z"),
      ];
      const zeilen = lageAuswerten({ check_runs: laeufe });
      expect(zeilen.filter((z) => z.startsWith("test-backend="))).toEqual(["test-backend=failure"]);
      expect(bindungLaesstDurch(zeilen, PFLICHT)).toBe(false);
    });

    test("und umgekehrt: ein jüngerer grüner auf Seite 2 hebt den älteren roten auf Seite 1 auf", () => {
      const laeufe = [
        ...pflichtLaeufe("2026-08-17T07:15:00Z").map((l) =>
          l.name === "test-e2e" ? { ...l, conclusion: "failure" } : l
        ),
        ...fremdeLaeufe(100),
        lauf("test-e2e", "success", "2026-08-17T09:00:00Z"),
      ];
      const zeilen = lageAuswerten({ check_runs: laeufe });
      expect(zeilen.filter((z) => z.startsWith("test-e2e="))).toEqual(["test-e2e=success"]);
      expect(bindungLaesstDurch(zeilen, PFLICHT)).toBe(true);
    });

    test("scheitert eine Folgeseite, gibt es KEIN Teilergebnis", () => {
      /* Die erste Seite allein könnte gerade den jüngeren, roten Lauf
         verschweigen. Leer heißt für deploy.sh "nicht abrufbar" — Abbruch. */
      const laeufe = [...pflichtLaeufe(), ...fremdeLaeufe(100)];
      expect(lageAuswerten({ check_runs: laeufe }, { seiteRot: 2 })).toEqual([]);
      /* Gegenrichtung: Ohne den Fehlschlag kommt die Lage vollständig. */
      expect(bindungLaesstDurch(lageAuswerten({ check_runs: laeufe }), PFLICHT)).toBe(true);
    });
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
