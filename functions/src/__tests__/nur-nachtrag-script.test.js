"use strict";

/**
 * Wächter für scripts/nur-nachtrag.sh — entscheidet, ob ein Pull-Request ein
 * reiner Auslieferungs-Nachtrag ist und der Browser-Test entfallen darf.
 *
 * ANLASS (16.09.2026): Der Nachtrag nach jeder Auslieferung (Cache-Kennung,
 * build-info.json, Versionszeile, Prüfstand-Stempel) wartete jedes Mal gut
 * zehn Minuten auf den vollen Browser-Test, obwohl sein Stand zu diesem
 * Zeitpunkt schon live und nachgerechnet ist.
 *
 * Die Gefahr liegt in der anderen Richtung: Sagt das Skript fälschlich "ja",
 * fehlt einem echten Code-Stand der Browser-Test. Deshalb prüft diese Datei
 * vor allem die "nein"-Fälle. Jeder Fall baut ein eigenes Wegwerf-Repository
 * — die Pipeline klont flach, auf Historie ist kein Verlass.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const WURZEL = path.join(__dirname, "../../..");
const SKRIPT = path.join(WURZEL, "scripts/nur-nachtrag.sh");
const DEPLOY = path.join(WURZEL, "scripts/deploy.sh");

const FINGERABDRUCK_ALT = JSON.stringify({ commit: "aaaaaaa0000", dateien: { "index.html": "sha256:1" } }, null, 2);
const FINGERABDRUCK_NEU = JSON.stringify({ commit: "bbbbbbb1111", dateien: { "index.html": "sha256:2" } }, null, 2);

function git(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function schreiben(repo, datei, inhalt) {
  const ziel = path.join(repo, datei);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt);
}

/* Baut ein Repository mit einer Basis wie nach einer Auslieferung und gibt
   den Basis-Commit zurück. */
function basisRepo(extra = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "nur-nachtrag-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  const dateien = {
    "CHANGELOG.md": "# Changelog\n\n## [Unveröffentlicht]\n\n- Etwas\n",
    "docs/VERIFICATION.md": "| Backend | ✅ 1/1 grün — Commit aaaaaaa |\n",
    "public/build-info.json": FINGERABDRUCK_ALT,
    "public/index.html":
      '<link href="styles.css?v=2026091501"><script src="app.js?v=2026091501"></script>\n<p>Text</p>\n',
    "public/en/privacy.html": '<link href="../styles.css?v=2026091501">\n<p>Privacy</p>\n',
    "public/js/demo.js": 'const DEMO_BUSTER = "?v=2026091501";\nexport function demo() { return 1; }\n',
    "functions/src/x.js": "module.exports = 1;\n",
    ...extra,
  };
  for (const [datei, inhalt] of Object.entries(dateien)) schreiben(repo, datei, inhalt);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "basis");
  return { repo, basis: git(repo, "rev-parse", "HEAD").trim() };
}

function nachtragSchreiben(repo) {
  schreiben(repo, "CHANGELOG.md", "# Changelog\n\n## [4.10.0] — 2026-09-16\n\n- Etwas, neu formuliert\n");
  schreiben(repo, "docs/VERIFICATION.md", "| Backend | ✅ 2/2 grün — Commit bbbbbbb |\n");
  schreiben(repo, "public/build-info.json", FINGERABDRUCK_NEU);
  for (const datei of ["public/index.html", "public/en/privacy.html", "public/js/demo.js"]) {
    const alt = fs.readFileSync(path.join(repo, datei), "utf8");
    schreiben(repo, datei, alt.replace(/\?v=2026091501/g, "?v=2026091601"));
  }
}

function pruefen(repo, basis, { mitAusgabe = false } = {}) {
  const env = { ...process.env, BASIS: basis };
  delete env.GITHUB_OUTPUT;
  let ausgabeDatei = null;
  if (mitAusgabe) {
    ausgabeDatei = path.join(repo, "..", `ausgabe-${path.basename(repo)}.txt`);
    fs.writeFileSync(ausgabeDatei, "");
    env.GITHUB_OUTPUT = ausgabeDatei;
  }
  const lauf = spawnSync("sh", [SKRIPT], { cwd: repo, env, encoding: "utf8" });
  const stdout = lauf.stdout;
  const ergebnis = /nur_nachtrag=(ja|nein)/.exec(stdout);
  return {
    ergebnis: ergebnis ? ergebnis[1] : null,
    status: lauf.status,
    stderr: lauf.stderr,
    stdout,
    github: ausgabeDatei ? fs.readFileSync(ausgabeDatei, "utf8") : null,
  };
}

function committen(repo) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "pr");
}

const aufraeumen = [];
afterAll(() => {
  for (const d of aufraeumen) fs.rmSync(d, { recursive: true, force: true });
});
function neu(extra) {
  const r = basisRepo(extra);
  aufraeumen.push(r.repo);
  return r;
}

describe("nur-nachtrag.sh — wann der Browser-Test entfallen darf", () => {
  test("ein echter Nachtrag (Kennung, Fingerabdruck, Version, Stempel) ist 'ja'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    committen(repo);
    const r = pruefen(repo, basis, { mitAusgabe: true });
    expect(r.ergebnis).toBe("ja");
    expect(r.status).toBe(0);
    expect(r.github).toBe("nur_nachtrag=ja\n");
  });

  test("eine Seite mit Kennung UND einer weiteren Änderung ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    const datei = path.join(repo, "public/index.html");
    fs.writeFileSync(datei, fs.readFileSync(datei, "utf8").replace("<p>Text</p>", "<p>Anderer Text</p>"));
    committen(repo);
    const r = pruefen(repo, basis, { mitAusgabe: true });
    expect(r.ergebnis).toBe("nein");
    expect(r.stdout).toContain("public/index.html aendert mehr als die Cache-Kennung");
    expect(r.status).toBe(0);
    expect(r.github).toBe("nur_nachtrag=nein\n");
  });

  test("Code in demo.js neben der Kennung ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    const datei = path.join(repo, "public/js/demo.js");
    fs.writeFileSync(datei, fs.readFileSync(datei, "utf8").replace("return 1", "return 2"));
    committen(repo);
    expect(pruefen(repo, basis).ergebnis).toBe("nein");
  });

  test("eine Kennung ohne Ziffern (nacktes ?v=) zählt nicht als Kennung", () => {
    const { repo, basis } = neu();
    const datei = path.join(repo, "public/index.html");
    fs.writeFileSync(datei, fs.readFileSync(datei, "utf8").replace("<p>Text</p>", "<p>?v=</p>"));
    committen(repo);
    expect(pruefen(repo, basis).ergebnis).toBe("nein");
  });

  test("jede andere Datei ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    schreiben(repo, "functions/src/x.js", "module.exports = 2;\n");
    committen(repo);
    const r = pruefen(repo, basis);
    expect(r.ergebnis).toBe("nein");
    expect(r.stdout).toContain("functions/src/x.js gehoert nicht zu einem Nachtrag");
  });

  test("eine neue Datei ist 'nein', auch wenn sie wie eine Seite heisst", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    schreiben(repo, "public/neu.html", "<p>neu</p>\n");
    committen(repo);
    const r = pruefen(repo, basis);
    expect(r.ergebnis).toBe("nein");
    expect(r.stdout).toContain("public/neu.html hat Status A");
  });

  test("eine gelöschte Datei ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    fs.rmSync(path.join(repo, "docs/VERIFICATION.md"));
    committen(repo);
    expect(pruefen(repo, basis).ergebnis).toBe("nein");
  });

  test("ein kaputter Fingerabdruck ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    schreiben(repo, "public/build-info.json", "{ kein json");
    committen(repo);
    const r = pruefen(repo, basis);
    expect(r.ergebnis).toBe("nein");
    expect(r.stdout).toContain("build-info.json ist kein gueltiger Fingerabdruck");
  });

  test("ein Fingerabdruck ohne Dateiliste ist 'nein'", () => {
    const { repo, basis } = neu();
    nachtragSchreiben(repo);
    schreiben(repo, "public/build-info.json", JSON.stringify({ commit: "bbbbbbb1111", dateien: {} }));
    committen(repo);
    expect(pruefen(repo, basis).ergebnis).toBe("nein");
  });

  test("ohne Basis (Push auf main, Zeitplan) ist es immer 'nein'", () => {
    const { repo } = neu();
    nachtragSchreiben(repo);
    committen(repo);
    const r = pruefen(repo, "");
    expect(r.ergebnis).toBe("nein");
    expect(r.stdout).toContain("kein Pull-Request");
  });

  test("eine unbekannte Basis ist ein technischer Fehler: 'nein' UND Rueckgabewert 1", () => {
    /* Laut statt still: Im Pflicht-Job laesst Rueckgabewert 1 den PR scheitern. */
    const { repo } = neu();
    const r = pruefen(repo, "origin/gibt-es-nicht");
    expect(r.ergebnis).toBe("nein");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Basis origin/gibt-es-nicht nicht auffindbar");
  });

  test("ohne jede Änderung ist es 'nein'", () => {
    const { repo, basis } = neu();
    expect(pruefen(repo, basis).ergebnis).toBe("nein");
  });

  test("jede Datei, deren Kennung deploy.sh setzt, wird als Kennungs-Datei erkannt", () => {
    /* Driftwaechter: deploy.sh entscheidet per Befehl, welche Dateien eine
       Kennung bekommen. Kommt dort eine Datei dazu, die das Skript nicht als
       Kennungs-Datei kennt, waere jeder Nachtrag "nein" — sicher, aber der
       Zweck verfehlt. Dieser Test fuehrt den Befehl aus deploy.sh aus. */
    const inhalt = fs.readFileSync(DEPLOY, "utf8");
    const m = inhalt.match(/^BUSTER_DATEIEN=\$\((.+)\)$/m);
    expect(m).not.toBeNull();
    const liste = execFileSync("sh", ["-c", m[1]], { cwd: WURZEL, encoding: "utf8" })
      .split("\n")
      .map((z) => z.trim())
      .filter(Boolean);
    /* Positivkontrolle: Die Liste ist nicht leer und enthaelt die Startseite. */
    expect(liste).toContain("public/index.html");
    const extra = {};
    for (const datei of liste) extra[datei] = '<a href="x?v=2026091501">x</a>\n';
    const { repo, basis } = neu(extra);
    for (const datei of liste) schreiben(repo, datei, '<a href="x?v=2026091601">x</a>\n');
    committen(repo);
    const r = pruefen(repo, basis);
    expect(r.stdout).not.toContain("gehoert nicht zu einem Nachtrag");
    expect(r.ergebnis).toBe("ja");
  });
});
