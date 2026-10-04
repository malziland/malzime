"use strict";

/**
 * Verhaltenstest für die öffentliche Nachprüfung (scripts/pruefe-live.sh).
 *
 * ARCH-2026-08-20-04: Das Skript prüfte nur die Dateien, die der geprüfte
 * Server selbst im Fingerabdruck nannte. Eine veränderte Datei, die dort
 * fehlte, wurde nie angesehen — das Ergebnis lautete „entspricht Commit".
 *
 * Hier läuft das echte Skript gegen eine nachgebaute Auslieferung, ohne Netz:
 *   · ein kleines Repository mit Website- und Server-Dateien,
 *   · „ausgeliefert" mit dem echten scripts/build-info.mjs (Erzeuger und Prüfer
 *     müssen zusammenpassen),
 *   · eine Attrappe von curl, die Adressen auf ein Verzeichnis abbildet und bei
 *     einer fehlenden Datei wie Firebase Hosting mit der Startseite antwortet.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const WURZEL = path.join(__dirname, "../../..");
const GIT_UMGEBUNG = {
  ...process.env,
  GIT_AUTHOR_NAME: "Probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "Probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

let basis; // Arbeitsverzeichnis des ganzen Testlaufs
let quelle; // das "veröffentlichte" Repository
let liveVorlage; // der unveränderte ausgelieferte Stand
let live; // der Stand, gegen den ein Test prüft (frische Kopie je Test)
let commitA;

const git = (ordner, ...args) => execFileSync("git", args, { cwd: ordner, env: GIT_UMGEBUNG, encoding: "utf8" }).trim();

function schreibe(wurzel, rel, inhalt) {
  const ziel = path.join(wurzel, rel);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt);
}

function frischerKlon(name, stand = commitA) {
  const ziel = path.join(basis, name);
  fs.rmSync(ziel, { recursive: true, force: true });
  git(basis, "clone", "--quiet", "--no-hardlinks", quelle, ziel);
  git(ziel, "checkout", "--quiet", stand);
  return ziel;
}

/** Lässt das echte Skript laufen; curl ist die Attrappe. */
function pruefen(ordner, zusatz = {}) {
  try {
    const aus = execFileSync("sh", ["scripts/pruefe-live.sh"], {
      cwd: ordner,
      encoding: "utf8",
      env: { ...GIT_UMGEBUNG, PATH: `${path.join(basis, "bin")}:${process.env.PATH}`, ATTRAPPE_LIVE: live, ...zusatz },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, aus };
  } catch (e) {
    return { code: e.status, aus: (e.stdout || "") + (e.stderr || "") };
  }
}

function fingerabdruckAendern(aendere) {
  const p = path.join(live, "build-info.json");
  const daten = JSON.parse(fs.readFileSync(p, "utf8"));
  aendere(daten);
  fs.writeFileSync(p, JSON.stringify(daten, null, 2) + "\n");
}

/** Prüfsumme einer ausgelieferten Datei, so wie der Fingerabdruck sie schreibt. */
function summeLive(rel) {
  const inhalt = fs.readFileSync(path.join(live, rel));
  return `sha256:${require("crypto").createHash("sha256").update(inhalt).digest("hex")}`;
}

beforeAll(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "pruefe-live-"));

  /* curl-Attrappe: bildet https://…/<pfad> auf $ATTRAPPE_LIVE/<pfad> ab. */
  schreibe(
    basis,
    "bin/curl",
    [
      "#!/bin/sh",
      'URL=""; AUS=""',
      "while [ $# -gt 0 ]; do",
      '  case "$1" in',
      '    -o) AUS="$2"; shift ;;',
      '    http*://*) URL="$1" ;;',
      "  esac",
      "  shift",
      "done",
      "PFAD=$(printf '%s' \"$URL\" | sed 's|^[a-z]*://[^/]*/||')",
      '[ -n "${ATTRAPPE_TRANSPORTFEHLER:-}" ] && [ "$PFAD" = "$ATTRAPPE_TRANSPORTFEHLER" ] && { echo "curl: (7) Verbindung abgelehnt" >&2; exit 7; }',
      /* Eine echte Fehlerantwort des Servers: `curl -f` meldet sie mit Rückgabewert 22. */
      '[ -n "${ATTRAPPE_NICHT_GEFUNDEN:-}" ] && [ "$PFAD" = "$ATTRAPPE_NICHT_GEFUNDEN" ] && { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
      /* Firebase Hosting beantwortet einen unbekannten Pfad mit der Startseite (Status 200). */
      'if [ -f "$ATTRAPPE_LIVE/$PFAD" ]; then QUELLE="$ATTRAPPE_LIVE/$PFAD"; else QUELLE="$ATTRAPPE_LIVE/index.html"; fi',
      'if [ -n "$AUS" ]; then cp "$QUELLE" "$AUS"; else cat "$QUELLE"; fi',
      "exit 0",
      "",
    ].join("\n")
  );
  fs.chmodSync(path.join(basis, "bin/curl"), 0o755);

  /* Das veröffentlichte Repository. */
  quelle = path.join(basis, "quelle");
  fs.mkdirSync(quelle);
  git(quelle, "-c", "init.defaultBranch=main", "init", "--quiet");
  schreibe(
    quelle,
    "firebase.json",
    JSON.stringify({
      hosting: {
        public: "public",
        ignore: [
          "firebase.json",
          "**/.*",
          "**/node_modules/**",
          "**/__tests__/**",
          "img/demo/original/**",
          "lib/PRUEFSUMMEN.json",
        ],
      },
    })
  );
  schreibe(quelle, "public/index.html", '<!doctype html>\n<script type="module" src="app.js?v=2026010101"></script>\n');
  schreibe(quelle, "public/app.js", 'import "./js/a.js";\n');
  schreibe(quelle, "public/js/a.js", "export const a = 1;\n");
  schreibe(quelle, "public/build-info.json", '{"hinweis":"Stand der vorigen Auslieferung"}\n');
  /* Was Hosting nicht ausliefert, darf die Nachprüfung auch nicht verlangen. */
  schreibe(quelle, "public/__tests__/a.test.js", "// Test\n");
  schreibe(quelle, "public/.versteckt", "x\n");
  schreibe(quelle, "public/lib/PRUEFSUMMEN.json", "{}\n");
  schreibe(quelle, "public/img/demo/original/gross.txt", "gross\n");
  schreibe(quelle, "functions/src/index.js", "exports.x = 1;\n");
  schreibe(quelle, "functions/src/config.js", "module.exports = {};\n");
  schreibe(quelle, "functions/src/locales/de/prompts.js", "module.exports = {};\n");
  schreibe(quelle, "functions/src/__tests__/index.test.js", "// Test\n");
  schreibe(quelle, "functions/src/hinweis.md", "kein Programm\n");
  for (const skript of ["pruefe-live.sh", "build-info.mjs"]) {
    schreibe(quelle, `scripts/${skript}`, fs.readFileSync(path.join(WURZEL, "scripts", skript), "utf8"));
  }
  git(quelle, "add", "-A");
  git(quelle, "commit", "--quiet", "-m", "Stand A");
  commitA = git(quelle, "rev-parse", "HEAD");

  /* Ausliefern wie die echte Kette: Cache-Kennung ersetzen (uncommittet),
     dann den Fingerabdruck mit dem echten Erzeuger schreiben. */
  const auslieferung = frischerKlon("auslieferung");
  const start = path.join(auslieferung, "public/index.html");
  fs.writeFileSync(start, fs.readFileSync(start, "utf8").replace("?v=2026010101", "?v=2026020202"));
  execFileSync("node", ["scripts/build-info.mjs", "2026020202"], { cwd: auslieferung, env: GIT_UMGEBUNG });
  liveVorlage = path.join(basis, "live-vorlage");
  fs.cpSync(path.join(auslieferung, "public"), liveVorlage, { recursive: true });
  for (const nichtAusgeliefert of ["__tests__", ".versteckt", "lib", "img"]) {
    fs.rmSync(path.join(liveVorlage, nichtAusgeliefert), { recursive: true, force: true });
  }
});

afterAll(() => fs.rmSync(basis, { recursive: true, force: true }));

beforeEach(() => {
  live = path.join(basis, "live");
  fs.rmSync(live, { recursive: true, force: true });
  fs.cpSync(liveVorlage, live, { recursive: true });
});

describe("pruefe-live.sh am nachgebauten Live-Stand", () => {
  test("Aufbau stimmt: der Fingerabdruck nennt drei Website- und drei Server-Dateien", () => {
    const daten = JSON.parse(fs.readFileSync(path.join(live, "build-info.json"), "utf8"));
    expect(Object.keys(daten.dateien).sort()).toEqual(["app.js", "index.html", "js/a.js"]);
    expect(Object.keys(daten.serverDateien).sort()).toEqual(["config.js", "index.js", "locales/de/prompts.js"]);
    expect(daten.commit).toBe(commitA);
  });

  test("Erfolgsweg: unveränderter Stand → 0, und der Commit ist wirklich gegengerechnet", () => {
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain(`Der ausgelieferte Stand entspricht Commit ${commitA}.`);
    expect(r.aus).toContain("Dateien laut Commit: 3");
    expect(r.aus).toContain("der Commit verlangt 3 Website-Dateien, keine fehlt im Fingerabdruck.");
    expect(r.aus).toContain("Davon 1 nur in der Cache-Kennung abweichend");
    expect(r.aus).toContain(`Server-Code: 3 Datei(en) gegen Commit ${commitA} geprueft.`);
    expect(r.code).toBe(0);
  });

  test("Datei live verändert, Fingerabdruck unverändert → 1", () => {
    fs.appendFileSync(path.join(live, "app.js"), "/* fremder Code */\n");
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("ABWEICHUNG: app.js");
  });

  test("Datei live verändert UND aus dem Fingerabdruck gestrichen → 1 (vorher: 0)", () => {
    fs.appendFileSync(path.join(live, "app.js"), "/* fremder Code */\n");
    fingerabdruckAendern((d) => delete d.dateien["app.js"]);
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK: app.js");
    expect(r.aus).toContain("ABWEICHUNG zum Commit: app.js");
    expect(r.aus).toContain("entspricht NICHT dem genannten Commit");
  });

  test("Datei live verändert UND ihr Wert im Fingerabdruck angepasst → 1 (das fängt nur der Vergleich mit dem Commit)", () => {
    /* Wer die Auslieferung in der Hand hat, liefert zur veränderten Datei den
       passenden Fingerabdruck gleich mit. Der Server stimmt dann mit sich selbst
       überein: nichts fehlt, keine Prüfsumme weicht ab. */
    fs.appendFileSync(path.join(live, "app.js"), "/* fremder Code */\n");
    fingerabdruckAendern((d) => (d.dateien["app.js"] = summeLive("app.js")));
    const r = pruefen(frischerKlon("klon"));
    /* Messmittel-Probe: Kein anderer Zähler trägt den Rückgabewert. */
    expect(r.aus).not.toMatch(/^\s*ABWEICHUNG: /m);
    expect(r.aus).not.toContain("FEHLT");
    expect(r.aus).not.toContain("NICHT IM COMMIT");
    expect(r.aus).toContain("ERGEBNIS: 0 Abweichung(en), 0 fehlend, bei 3 geprueften Dateien.");
    expect(r.aus).toContain("ABWEICHUNG zum Commit: app.js (Inhalt, nicht nur die Cache-Kennung)");
    expect(r.aus).toContain(`Dazu 1 Abweichung(en) gegenueber dem Inhalt von ${commitA}.`);
    expect(r.aus).toContain("Der ausgelieferte Stand entspricht NICHT dem genannten Commit.");
    expect(r.aus).not.toContain(`entspricht Commit ${commitA}`);
    expect(r.code).toBe(1);
  });

  test("Datei unverändert, aber aus dem Fingerabdruck gestrichen → 1 (die Liste des Commits gilt)", () => {
    fingerabdruckAendern((d) => delete d.dateien["js/a.js"]);
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK: js/a.js");
    expect(r.aus).toContain("Dazu 1 Datei(en) des Commits, die der Fingerabdruck nicht nennt.");
  });

  test("Fingerabdruck nennt nur noch eine Datei → 1 (vorher: 0)", () => {
    fingerabdruckAendern((d) => {
      for (const name of Object.keys(d.dateien).slice(1)) delete d.dateien[name];
    });
    expect(pruefen(frischerKlon("klon")).code).toBe(1);
  });

  test("Fingerabdruck ohne das Feld serverDateien → 1 (vorher: 0)", () => {
    fingerabdruckAendern((d) => delete d.serverDateien);
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK: die Server-Dateien");
  });

  test.each([
    [
      "eine Server-Datei fehlt in der Liste",
      (d) => delete d.serverDateien["config.js"],
      "FEHLT IM FINGERABDRUCK (Server-Code): functions/src/config.js",
    ],
    [
      "eine Server-Datei trägt eine falsche Prüfsumme",
      (d) => (d.serverDateien["config.js"] = "sha256:" + "0".repeat(64)),
      "ABWEICHUNG im Server-Code: functions/src/config.js",
    ],
    [
      "eine Server-Datei steht in der Liste, aber nicht im Commit",
      (d) => (d.serverDateien["fremd.js"] = "sha256:" + "0".repeat(64)),
      "NICHT IM COMMIT (Server-Code): functions/src/fremd.js",
    ],
  ])("Server-Code: %s → 1", (_name, aendere, meldung) => {
    fingerabdruckAendern(aendere);
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain(meldung);
  });

  test("das Repository ist der Auslieferung einen Commit voraus → 0 (vorher: Fehlalarm)", () => {
    const klon = frischerKlon("klon", "main");
    fs.appendFileSync(path.join(klon, "functions/src/config.js"), "// spätere Änderung, noch nicht ausgeliefert\n");
    fs.appendFileSync(path.join(klon, "public/app.js"), "// spätere Änderung, noch nicht ausgeliefert\n");
    git(klon, "commit", "--quiet", "-am", "main läuft der Auslieferung voraus");
    const r = pruefen(klon);
    expect(r.aus).toContain(`Der ausgelieferte Stand entspricht Commit ${commitA}.`);
    expect(r.code).toBe(0);
  });

  test("eine Datei fehlt live (der Server antwortet mit der Startseite) → 1", () => {
    fs.rmSync(path.join(live, "js/a.js"));
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("ABWEICHUNG: js/a.js");
  });

  test("der Server antwortet für eine Datei mit 404 → 1 (sie fehlt wirklich; kein Messproblem)", () => {
    const r = pruefen(frischerKlon("klon"), { ATTRAPPE_NICHT_GEFUNDEN: "js/a.js" });
    expect(r.aus).toContain("FEHLT auf dem Server: js/a.js");
    /* Messmittel-Probe: Kein anderer Zähler trägt den Rückgabewert. */
    expect(r.aus).not.toContain("ABWEICHUNG");
    expect(r.aus).not.toContain("NICHT MESSBAR");
    expect(r.aus).toContain("ERGEBNIS: 0 Abweichung(en), 1 fehlend, bei 2 geprueften Dateien.");
    expect(r.aus).toContain("Der ausgelieferte Stand entspricht NICHT dem genannten Commit.");
    expect(r.code).toBe(1);
  });

  test("eine zusätzliche Datei wird ausgeliefert und genannt, steht aber nicht im Commit → 1", () => {
    fs.writeFileSync(path.join(live, "fremd.js"), "fremd();\n");
    const summe = require("crypto").createHash("sha256").update("fremd();\n").digest("hex");
    fingerabdruckAendern((d) => (d.dateien["fremd.js"] = `sha256:${summe}`));
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("NICHT IM COMMIT: fremd.js");
  });
});

describe("pruefe-live.sh: Messproblem ist kein Befund und kein Erfolg", () => {
  test("build-info.json fehlt live (Startseite statt JSON) → 2", () => {
    fs.rmSync(path.join(live, "build-info.json"));
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(2);
    expect(r.aus).toContain("liefert HTML statt JSON");
  });

  test("eine Datei ist wegen eines Netzfehlers nicht abrufbar → 2", () => {
    const r = pruefen(frischerKlon("klon"), { ATTRAPPE_TRANSPORTFEHLER: "js/a.js" });
    expect(r.code).toBe(2);
    expect(r.aus).toContain("NICHT MESSBAR: js/a.js");
  });

  test("der genannte Commit hat ein Hosting-Muster, das das Skript nicht kennt → 2", () => {
    const arbeit = frischerKlon("arbeit", "main");
    const konfig = JSON.parse(fs.readFileSync(path.join(arbeit, "firebase.json"), "utf8"));
    konfig.hosting.ignore.push("**/*.md");
    fs.writeFileSync(path.join(arbeit, "firebase.json"), JSON.stringify(konfig));
    git(arbeit, "commit", "--quiet", "-am", "neues Muster");
    const commitB = git(arbeit, "rev-parse", "HEAD");
    fingerabdruckAendern((d) => (d.commit = commitB));
    const r = pruefen(arbeit);
    expect(r.code).toBe(2);
    expect(r.aus).toContain("unbekanntes Hosting-Muster in firebase.json: **/*.md");
  });
});

describe("pruefe-live.sh ohne den genannten Commit", () => {
  test("Commit lokal unbekannt → 0, aber ausdrücklich NICHT gegengerechnet", () => {
    fingerabdruckAendern((d) => (d.commit = "0".repeat(40)));
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(0);
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("Dieser Commit wurde NICHT gegengerechnet");
    expect(r.aus).not.toContain("entspricht Commit");
  });

  test("kein git-Repository (entpackte Kopie) → 0, NICHT gegengerechnet, Server-Code gegen den Ordner", () => {
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.code).toBe(0);
    expect(r.aus).toContain("nicht pruefbar (kein git-Repository)");
    expect(r.aus).toContain("Dieser Commit wurde NICHT gegengerechnet");
    expect(r.aus).toContain("Server-Code: 3 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
  });

  test("kein git-Repository, eine Server-Datei im Ordner ist eine andere als die ausgewiesene → 1", () => {
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    fs.appendFileSync(path.join(klon, "functions/src/config.js"), "// nicht der ausgelieferte Stand\n");
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.aus).toContain("nicht pruefbar (kein git-Repository)");
    expect(r.aus).toContain("ABWEICHUNG im Server-Code: functions/src/config.js");
    expect(r.aus).toContain("Server-Code: 3 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
    expect(r.aus).toContain("ERGEBNIS: 0 Abweichung(en), 0 fehlend, bei 3 geprueften Dateien.");
    expect(r.aus).toContain("Dazu 1 Abweichung(en) im Server-Code.");
    expect(r.code).toBe(1);
  });

  test("Commit lokal unbekannt, eine ausgewiesene Server-Datei fehlt im Ordner → 1", () => {
    fingerabdruckAendern((d) => (d.commit = "0".repeat(40)));
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, "functions/src/config.js"));
    const r = pruefen(klon);
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("FEHLT in diesem Ordner: functions/src/config.js");
    expect(r.aus).toContain("Server-Code: 2 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
    expect(r.aus).toContain("Dazu 1 Abweichung(en) im Server-Code.");
    expect(r.code).toBe(1);
  });
});
