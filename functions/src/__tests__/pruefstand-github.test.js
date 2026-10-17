const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

/**
 * Waechter fuer `scripts/pruefstand.sh --aus-github` und seinen Helfer
 * `scripts/pruefstand-github.py` (17.10.2026, Konzept „schnellere
 * Auslieferung“, Schritt 3).
 *
 * Nach dem Live-Gang stempelt die Auslieferkette die Testzahlen jetzt aus den
 * Protokollen der GitHub-Jobs des ausgelieferten Commits, statt die drei
 * Suiten ein drittes Mal auf dem Rechner zu fahren. Ein Stempel ist ein
 * Beweis — also muss jede Luecke zum Abbruch fuehren, nie zu einer halben
 * oder geschaetzten Zahl: ein Job, der fehlt, laeuft, rot ist, zu einem
 * anderen Lauf oder Commit gehoert; ein fehlender Teil der verteilten
 * Browser-Tests; ein Protokoll, in dem die Zeile mit den Zahlen nicht genau
 * einmal steht.
 *
 * `gh` ist eine Attrappe, die Pruefergebnisse und Protokolle aus Dateien
 * liefert — geschnitten wie die echten (Zeitstempel vor jeder Zeile,
 * Farbcodes von Vitest). Der Commit ist HEAD dieses Repositorys: Der Helfer
 * liest die Zahl der Browser-Teile aus `ci.yml` GENAU DIESES Commits.
 */

const WURZEL = path.join(__dirname, "../../..");
const HELFER = path.join(WURZEL, "scripts/pruefstand-github.py");
const PRUEFSTAND = path.join(WURZEL, "scripts/pruefstand.sh");
const SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WURZEL, encoding: "utf8" }).trim();
const LAUF = "39050148942";

/* Die Teile, wie ci.yml an HEAD sie festlegt — derselbe Ausdruck wie im Helfer. */
const CI_TEXT = execFileSync("git", ["show", `${SHA}:.github/workflows/ci.yml`], { cwd: WURZEL, encoding: "utf8" });
const TEILE = CI_TEXT.match(/^\s+teil:\s*\[([0-9,\s]+)\]\s*$/m)[1]
  .split(",")
  .map((t) => Number(t.trim()));

const GH_ATTRAPPE = `#!/bin/sh
# ATTRAPPE (Testlauf) — beruehrt keinen echten Dienst.
[ "$1" = "api" ] || { echo "ATTRAPPE gh: unbekannter Aufruf: $*" >&2; exit 97; }
case "$2" in
  */check-runs\\?*page=1) cat "$ATTRAPPE_LAEUFE" ;;
  */check-runs\\?*) echo '{"total_count":0,"check_runs":[]}' ;;
  */actions/jobs/*/logs)
    JOB=$(echo "$2" | sed -n 's|.*/actions/jobs/\\([0-9]*\\)/logs$|\\1|p')
    [ -f "$ATTRAPPE_PROTOKOLLE/$JOB.log" ] || { echo "HTTP 404" >&2; exit 1; }
    cat "$ATTRAPPE_PROTOKOLLE/$JOB.log" ;;
  *) echo "ATTRAPPE gh: unbekannte Adresse: $2" >&2; exit 97 ;;
esac
`;

let ordner;
beforeEach(() => {
  ordner = fs.mkdtempSync(path.join(os.tmpdir(), "pruefstand-github-"));
  fs.mkdirSync(path.join(ordner, "bin"));
  fs.mkdirSync(path.join(ordner, "protokolle"));
  fs.writeFileSync(path.join(ordner, "bin", "gh"), GH_ATTRAPPE, { mode: 0o755 });
});
afterEach(() => fs.rmSync(ordner, { recursive: true, force: true }));

/* Ein Pruefergebnis, wie die Schnittstelle es liefert (nur die benutzten Felder). */
function lauf(
  name,
  id,
  { conclusion = "success", status = "completed", lauf = LAUF, sha = SHA, app = "github-actions" } = {}
) {
  return {
    id,
    name,
    status,
    conclusion: status === "completed" ? conclusion : null,
    started_at: "2026-10-17T16:36:32Z",
    head_sha: sha,
    details_url: `https://github.com/malziland/malzime/actions/runs/${lauf}/job/${id}`,
    app: { slug: app },
  };
}

/* Protokollzeilen mit Zeitstempel davor, wie GitHub sie liefert. */
const mitZeit = (zeilen) => zeilen.map((z) => `2026-10-17T16:39:38.2675499Z ${z}`).join("\n") + "\n";
const JEST = mitZeit([
  "##[group]Run npm test",
  "Test Suites: 162 passed, 162 total",
  "Tests:       7066 passed, 7066 total",
]);
const VITEST = mitZeit([
  "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m63 passed\x1b[39m\x1b[22m\x1b[90m (63)\x1b[39m",
  "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m1116 passed\x1b[39m\x1b[22m\x1b[90m (1116)\x1b[39m",
]);
const playwright = (n, skip) => mitZeit([...(skip ? [`  ${skip} skipped`] : []), `  ${n} passed (3.7m)`]);

/* Die gruene Lage: Server, Website, Sammel-Check und alle Teile, ein Lauf. */
function lage({ aendern = (l) => l, protokolle = {} } = {}) {
  const laeufe = [
    lauf("test-backend", 1001),
    lauf("test-frontend", 1002),
    lauf("test-e2e", 1003),
    ...TEILE.map((t) => lauf(`test-e2e-teil (${t})`, 2000 + t)),
    lauf("lighthouse", 1004),
  ];
  const standard = { 1001: JEST, 1002: VITEST };
  TEILE.forEach((t) => (standard[2000 + t] = playwright(100 + t)));
  const alle = { ...standard, ...protokolle };
  for (const [id, text] of Object.entries(alle)) {
    if (text !== null) fs.writeFileSync(path.join(ordner, "protokolle", `${id}.log`), text);
  }
  fs.writeFileSync(path.join(ordner, "laeufe.json"), JSON.stringify({ total_count: 0, check_runs: aendern(laeufe) }));
}

const umgebung = (mehr = {}) => ({
  ...process.env,
  PATH: `${path.join(ordner, "bin")}:${process.env.PATH}`,
  ATTRAPPE_LAEUFE: path.join(ordner, "laeufe.json"),
  ATTRAPPE_PROTOKOLLE: path.join(ordner, "protokolle"),
  ...mehr,
});

function helfer(sha = SHA) {
  const r = spawnSync("python3", [HELFER, sha], { encoding: "utf8", env: umgebung() });
  return { code: r.status, aus: r.stdout, fehler: r.stderr };
}

const E2E_SUMME = TEILE.reduce((s, t) => s + 100 + t, 0);

describe("pruefstand-github.py — der Erfolgsweg", () => {
  test("die Pipeline legt Teile fest (Messmittel-Probe)", () => {
    expect(TEILE.length).toBeGreaterThan(0);
    expect(TEILE).toEqual(TEILE.map((_, i) => i + 1));
  });

  test("liest Server, Website und die Summe aller Browser-Teile — trotz Zeitstempel und Farbcodes", () => {
    lage();
    const r = helfer();
    expect(r.fehler).toBe("");
    expect(r.code).toBe(0);
    expect(r.aus).toContain(`LAUF=${LAUF}\n`);
    expect(r.aus).toContain("BACKEND=7066\n");
    expect(r.aus).toContain("BACKEND_GESAMT=7066\n");
    expect(r.aus).toContain("FRONTEND=1116\n");
    expect(r.aus).toContain("FRONTEND_SKIP=0\n");
    expect(r.aus).toContain(`E2E=${E2E_SUMME}\n`);
    expect(r.aus).toContain(`E2E_TEILE=${TEILE.length}\n`);
  });

  test("uebersprungene Tests werden gezaehlt, nicht weggerechnet", () => {
    lage({
      protokolle: {
        1001: mitZeit(["Tests:       1 skipped, 7065 passed, 7066 total"]),
        1002: mitZeit(["      Tests  1115 passed | 1 skipped (1116)"]),
        2001: playwright(101, 2),
      },
    });
    const r = helfer();
    expect(r.code).toBe(0);
    expect(r.aus).toContain("BACKEND=7065\n");
    expect(r.aus).toContain("BACKEND_GESAMT=7066\n");
    expect(r.aus).toContain("FRONTEND=1115\n");
    expect(r.aus).toContain("FRONTEND_SKIP=1\n");
    expect(r.aus).toContain("E2E_SKIP=2\n");
  });

  test("ein Lauf einer fremden App gleichen Namens zaehlt nicht", () => {
    lage({
      aendern: (l) => [
        ...l,
        { ...lauf("test-backend", 9999, { conclusion: "failure", app: "fremd" }), started_at: "2026-10-18T00:00:00Z" },
      ],
    });
    expect(helfer().code).toBe(0);
  });
});

describe("pruefstand-github.py — fail-closed: keine Zahlen, wenn etwas fehlt", () => {
  const FAELLE = [
    [
      "ein Teil der Browser-Tests fehlt",
      { aendern: (l) => l.filter((x) => x.name !== `test-e2e-teil (${TEILE.length})`) },
      2,
      /Teile der Browser-Tests am Commit/,
    ],
    ["der Sammel-Check fehlt", { aendern: (l) => l.filter((x) => x.name !== "test-e2e") }, 2, /test-e2e: kein Lauf/],
    [
      "test-backend laeuft noch",
      {
        aendern: (l) =>
          l.map((x) => (x.name === "test-backend" ? lauf("test-backend", 1001, { status: "in_progress" }) : x)),
      },
      2,
      /test-backend: laeuft noch/,
    ],
    [
      "test-backend ist rot",
      {
        aendern: (l) =>
          l.map((x) => (x.name === "test-backend" ? lauf("test-backend", 1001, { conclusion: "failure" }) : x)),
      },
      1,
      /ROT: test-backend: failure/,
    ],
    [
      "der Sammel-Check ist uebersprungen (wie im Nachtrag)",
      { aendern: (l) => l.map((x) => (x.name === "test-e2e" ? lauf("test-e2e", 1003, { conclusion: "skipped" }) : x)) },
      1,
      /ROT: test-e2e: skipped/,
    ],
    [
      "ein Job stammt aus einem anderen Lauf",
      { aendern: (l) => l.map((x) => (x.name === "test-frontend" ? lauf("test-frontend", 1002, { lauf: "1" }) : x)) },
      2,
      /aus mehreren Laeufen/,
    ],
    [
      "ein Lauf gehoert zu einem anderen Commit",
      {
        aendern: (l) =>
          l.map((x) => (x.name === "test-frontend" ? lauf("test-frontend", 1002, { sha: "0".repeat(40) }) : x)),
      },
      2,
      /gehoert zu 0000000/,
    ],
    [
      "das Protokoll des Servers ist nicht abrufbar",
      { protokolle: { 1001: null } },
      2,
      /gh api .*jobs\/1001\/logs scheiterte/,
    ],
    [
      "im Protokoll fehlt die Zeile mit den Zahlen",
      { protokolle: { 1001: mitZeit(["Test Suites: 162 passed, 162 total"]) } },
      2,
      /test-backend: die Zeile mit den Zahlen steht 0-mal/,
    ],
    [
      "die Zeile mit den Zahlen steht zweimal da",
      { protokolle: { 1001: JEST + JEST } },
      2,
      /test-backend: die Zeile mit den Zahlen steht 2-mal/,
    ],
    [
      "die Zahlen der Website passen nicht zusammen",
      { protokolle: { 1002: mitZeit(["      Tests  1115 passed (1116)"]) } },
      2,
      /test-frontend: Zahlen passen nicht zusammen/,
    ],
    [
      "ein Browser-Teil ohne Summenzeile",
      { protokolle: { 2001: mitZeit(["  Running 101 tests using 4 workers"]) } },
      2,
      /test-e2e-teil \(1\): die Zeile mit den Zahlen steht 0-mal/,
    ],
    [
      "ein Browser-Teil meldet rote Tests",
      { protokolle: { 2001: mitZeit(["  1 failed", "  100 passed (3.7m)"]) } },
      1,
      /ROT: test-e2e-teil \(1\): Tests mit Ergebnis 'failed'/,
    ],
  ];

  test.each(FAELLE)("%s", (_was, einstellung, code, meldung) => {
    lage(einstellung);
    const r = helfer();
    expect(r.fehler).toMatch(meldung);
    expect(r.code).toBe(code);
    expect(r.aus).toBe("");
  });

  test("ohne volle Kennung des Commits: nicht messbar", () => {
    lage();
    expect(helfer(SHA.slice(0, 7)).code).toBe(2);
  });
});

describe("pruefstand.sh --aus-github — Stempel aus GitHub", () => {
  function matrix() {
    const p = path.join(ordner, "matrix.md");
    fs.writeFileSync(
      p,
      [
        "| Backend-Unit-Tests | lokal `npm test` | ✅ 7000/7000 grün — `scripts/pruefstand.sh`, Commit abc1234, 2026-10-01 |",
        "| Frontend-Unit-Tests | lokal `npm run test:frontend` | ✅ 1100/1100 grün — `scripts/pruefstand.sh`, Commit abc1234, 2026-10-01 |",
        "| E2E kritischster Nutzerfluss (Demo) | lokal `npm run test:e2e` | ✅ 430/430 grün — `scripts/pruefstand.sh`, Commit abc1234, 2026-10-01 |",
        "",
      ].join("\n")
    );
    return p;
  }
  function stempeln(m, mehr = {}) {
    const rueckbau = path.join(ordner, "rueckbau.log");
    fs.writeFileSync(rueckbau, "   Alle 10 Rueckbauten werden bemerkt.\n");
    const r = spawnSync("bash", [PRUEFSTAND, "--aus-github", SHA], {
      encoding: "utf8",
      env: umgebung({ PRUEFSTAND_MATRIX: m, PRUEFSTAND_PROBE_RUECKBAU: rueckbau, ...mehr }),
    });
    return { code: r.status, aus: r.stdout + r.stderr };
  }

  test("stempelt die Zahlen und nennt den GitHub-Lauf als Herkunft (Beweisformat)", () => {
    lage();
    const m = matrix();
    const r = stempeln(m);
    expect(r.code).toBe(0);
    const text = fs.readFileSync(m, "utf8");
    const herkunft = `\`scripts/pruefstand.sh --aus-github\`: Protokolle des GitHub-Laufs ${LAUF}, Commit ${SHA.slice(0, 7)}, `;
    expect(text).toContain(`✅ 7066/7066 grün — ${herkunft}`);
    expect(text).toContain(`✅ 1116/1116 grün — ${herkunft}`);
    expect(text).toContain(`✅ ${E2E_SUMME}/${E2E_SUMME} grün — ${herkunft}`);
    expect(text).not.toContain("Commit abc1234");
  });

  test("sind die Zahlen nicht lesbar, wird nichts gestempelt — mit Grund", () => {
    lage({ aendern: (l) => l.filter((x) => x.name !== "test-e2e-teil (1)") });
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    const r = stempeln(m);
    expect(r.code).toBe(1);
    expect(r.aus).toMatch(/NICHT MESSBAR: Teile der Browser-Tests/);
    expect(r.aus).toMatch(/ABBRUCH: Zahlen aus GitHub .* nicht lesbar .* es wird nichts gestempelt/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("die Rueckbauprobe laeuft weiter und haelt auch hier an", () => {
    lage();
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    /* Der Einspeisepunkt gibt den Inhalt der Datei nur aus; rot wird die Probe
       hier dadurch, dass es die Datei nicht gibt (`cat` scheitert). */
    const r = spawnSync("bash", [PRUEFSTAND, "--aus-github", SHA], {
      encoding: "utf8",
      env: umgebung({ PRUEFSTAND_MATRIX: m, PRUEFSTAND_PROBE_RUECKBAU: path.join(ordner, "gibt-es-nicht.log") }),
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/ABBRUCH: Rueckbauprobe rot/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("die 90-Prozent-Regel gilt auch fuer Zahlen aus GitHub", () => {
    lage({ protokolle: { 1001: mitZeit(["Tests:       100 passed, 100 total"]) } });
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    const r = stempeln(m);
    expect(r.code).toBe(1);
    expect(r.aus).toMatch(/Backend-Unit-Tests: 100 Tests, im letzten Stempel 7000/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("fremder Commit: Abbruch vor jeder Abfrage, die Rueckbauprobe liefe sonst auf einem anderen Stand", () => {
    lage();
    const m = matrix();
    const vorher = fs.readFileSync(m, "utf8");
    const fremd = SHA.startsWith("0") ? "1".repeat(40) : "0".repeat(40);
    const r = spawnSync("bash", [PRUEFSTAND, "--aus-github", fremd], {
      encoding: "utf8",
      env: umgebung({ PRUEFSTAND_MATRIX: m }),
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/ABBRUCH: lokaler Stand .* ist nicht der Commit .* es wird nichts gestempelt/);
    expect(fs.readFileSync(m, "utf8")).toBe(vorher);
  });

  test("ohne volle Kennung: Abbruch vor jeder Abfrage", () => {
    const m = matrix();
    const r = spawnSync("bash", [PRUEFSTAND, "--aus-github", "abc1234"], {
      encoding: "utf8",
      env: umgebung({ PRUEFSTAND_MATRIX: m }),
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/braucht die volle Kennung des Commits/);
  });
});
