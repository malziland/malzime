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
 *   · mit einem Server-Paket nach `functions.ignore` (Programm, package.json,
 *     package-lock.json, Sprachliste, eine Datei, die kein Programm ist),
 *   · „ausgeliefert" mit dem echten scripts/build-info.mjs (Erzeuger und Prüfer
 *     müssen zusammenpassen),
 *   · eine Attrappe von curl, die Adressen auf ein Verzeichnis abbildet und bei
 *     einer fehlenden Datei wie Firebase Hosting mit der Startseite antwortet.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { curlLiveAttrappeAnlegen } = require("./hilfen/curl-live-attrappe");

const WURZEL = path.join(__dirname, "../../..");
/* Der Erzeuger holt die Liste des Server-Pakets vom Wächter, und der braucht
   minimatch. Das nachgebaute Repository hat keine node_modules; über NODE_PATH
   findet er die Bibliothek trotzdem. */
const MODULE = path.join(WURZEL, "functions", "node_modules");
/* Was im nachgebauten Stand als Server-Paket zu Google ginge (functions.ignore
   unten nimmt Tests, Punkt-Dateien und Protokolle heraus). */
const PAKET = [
  "package-lock.json",
  "package.json",
  "src/config.js",
  "src/hinweis.md",
  "src/index.js",
  "src/locales/de/prompts.js",
  "src/locales/manifest.json",
];
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
let commitAlt; // ein Stand, dessen Erzeuger den Fingerabdruck noch in der älteren Form schrieb

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

const summe = (inhalt) => `sha256:${require("crypto").createHash("sha256").update(inhalt).digest("hex")}`;

/** Prüfsumme einer ausgelieferten Datei, so wie der Fingerabdruck sie schreibt. */
function summeLive(rel) {
  const inhalt = fs.readFileSync(path.join(live, rel));
  return `sha256:${require("crypto").createHash("sha256").update(inhalt).digest("hex")}`;
}

beforeAll(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "pruefe-live-"));

  /* curl-Attrappe: bildet https://…/<pfad> auf $ATTRAPPE_LIVE/<pfad> ab. */
  curlLiveAttrappeAnlegen(path.join(basis, "bin"));

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
      functions: { source: "functions", ignore: ["node_modules", ".git", ".*", "__tests__", "*.log"] },
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
  schreibe(quelle, "functions/src/locales/manifest.json", '{"default":"de"}\n');
  schreibe(quelle, "functions/package.json", '{"main":"src/index.js","dependencies":{"fremdpaket":"1.0.0"}}\n');
  schreibe(quelle, "functions/package-lock.json", '{"lockfileVersion":3,"packages":{}}\n');
  /* Was functions.ignore herausnimmt, darf die Nachprüfung auch nicht verlangen. */
  schreibe(quelle, "functions/.env.local", "NUR_LOKAL=1\n");
  schreibe(quelle, "functions/lasttest.log", "Protokoll\n");
  for (const skript of ["pruefe-live.sh", "build-info.mjs", "pruefe-auslieferbare-reste.mjs"]) {
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
  execFileSync("node", ["scripts/build-info.mjs", "2026020202"], {
    cwd: auslieferung,
    env: { ...GIT_UMGEBUNG, NODE_PATH: MODULE },
  });
  liveVorlage = path.join(basis, "live-vorlage");
  fs.cpSync(path.join(auslieferung, "public"), liveVorlage, { recursive: true });
  for (const nichtAusgeliefert of ["__tests__", ".versteckt", "lib", "img"]) {
    fs.rmSync(path.join(liveVorlage, nichtAusgeliefert), { recursive: true, force: true });
  }

  /* Ein Stand in der Form bis zum 05.10.2026: Sein Erzeuger schrieb das Feld
     `serverDateien` (nur die .js-Dateien unter functions/src/). Für die
     Nachprüfung zählt, was im Commit steht — dieser Erzeuger wird hier nicht
     ausgeführt. */
  const alt = frischerKlon("alt", "main");
  schreibe(
    alt,
    "scripts/build-info.mjs",
    "// Erzeuger der älteren Form.\nconst inhalt = {\n  dateien: {},\n  serverDateien: {},\n};\n"
  );
  git(alt, "commit", "--quiet", "-am", "Stand in der älteren Form");
  commitAlt = git(alt, "rev-parse", "HEAD");
  git(quelle, "fetch", "--quiet", alt, `${commitAlt}:refs/heads/alt`);
});

/** Macht aus dem ausgelieferten Stand einen in der älteren Form: Er nennt
 *  `commitAlt` und vom Server nur die .js-Dateien unter functions/src/. */
function alsAeltereForm() {
  const lies = (rel) => fs.readFileSync(path.join(quelle, "functions/src", rel));
  fingerabdruckAendern((d) => {
    d.commit = commitAlt;
    delete d.serverPaket;
    d.serverDateien = {};
    for (const rel of ["config.js", "index.js", "locales/de/prompts.js"]) d.serverDateien[rel] = summe(lies(rel));
  });
}

afterAll(() => fs.rmSync(basis, { recursive: true, force: true }));

beforeEach(() => {
  live = path.join(basis, "live");
  fs.rmSync(live, { recursive: true, force: true });
  fs.cpSync(liveVorlage, live, { recursive: true });
});

/** Legt über Stand A einen Commit an, liefert ihn aus (echter Erzeuger) und
 *  macht die Auslieferung zum Live-Stand. Gibt den Klon und den Fingerabdruck
 *  zurück. Das veröffentlichte Repository (`quelle`) erfährt von dem neuen
 *  Commit nichts — ein frischer Klon davon ist dann eine ÄLTERE Kopie. */
function ausliefern(aendere) {
  const ordner = frischerKlon("lieferung", "main");
  aendere(ordner);
  git(ordner, "add", "-A");
  git(ordner, "commit", "--quiet", "-m", "weiterer Stand");
  execFileSync("node", ["scripts/build-info.mjs", "2026030303"], {
    cwd: ordner,
    env: { ...GIT_UMGEBUNG, NODE_PATH: MODULE },
  });
  fs.copyFileSync(path.join(ordner, "public/build-info.json"), path.join(live, "build-info.json"));
  fs.copyFileSync(path.join(ordner, "public/index.html"), path.join(live, "index.html"));
  return { ordner, daten: JSON.parse(fs.readFileSync(path.join(live, "build-info.json"), "utf8")) };
}

describe("pruefe-live.sh am nachgebauten Live-Stand", () => {
  test("Aufbau stimmt: der Fingerabdruck nennt drei Website-Dateien und jede Datei des Server-Pakets", () => {
    const daten = JSON.parse(fs.readFileSync(path.join(live, "build-info.json"), "utf8"));
    expect(Object.keys(daten.dateien).sort()).toEqual(["app.js", "index.html", "js/a.js"]);
    /* Auch package.json, package-lock.json, die Sprachliste und eine Datei, die
       kein Programm ist — alles, was zu Google ginge. Tests, Punkt-Dateien und
       Protokolle nicht. */
    expect(Object.keys(daten.serverPaket).sort()).toEqual(PAKET);
    expect(daten.serverDateien).toBeUndefined();
    expect(daten.commit).toBe(commitA);
  });

  test("Erfolgsweg: unveränderter Stand → 0, und der Commit ist wirklich gegengerechnet", () => {
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain(`Der ausgelieferte Stand entspricht Commit ${commitA}.`);
    expect(r.aus).toContain("Dateien laut Commit: 3");
    expect(r.aus).toContain("der Commit verlangt 3 Website-Dateien, keine fehlt im Fingerabdruck.");
    expect(r.aus).toContain("Davon 1 nur in der Cache-Kennung abweichend");
    expect(r.aus).toContain(`Server-Paket: 7 Datei(en) gegen Commit ${commitA} geprueft.`);
    expect(r.aus).not.toMatch(/FEHLT|NICHT IM COMMIT|ABWEICHUNG/);
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

  test("Fingerabdruck ohne das Feld serverPaket → 1", () => {
    fingerabdruckAendern((d) => delete d.serverPaket);
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(1);
    expect(r.aus).toContain(
      `FEHLT IM FINGERABDRUCK: die Server-Dateien — Commit ${commitA} hat 7, der Server nennt keine`
    );
  });

  test("Fingerabdruck nennt vom Server nur noch die Programmdateien, im älteren Feld → 1", () => {
    /* Der Rückweg in die ältere Form: Mit ihr wären package.json,
       package-lock.json und die Sprachliste wieder ungeprüft. Welche Form ein
       Stand schuldet, sagt deshalb der Commit — sein Erzeuger schreibt
       `serverPaket` —, nicht der Fingerabdruck. */
    fingerabdruckAendern((d) => {
      d.serverDateien = {};
      for (const [pfad, wert] of Object.entries(d.serverPaket)) {
        if (pfad.startsWith("src/") && pfad.endsWith(".js")) d.serverDateien[pfad.slice(4)] = wert;
      }
      delete d.serverPaket;
    });
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK: die Server-Dateien");
    expect(r.aus).toContain("(Feld serverPaket)");
    expect(r.aus).not.toContain("entspricht Commit");
    expect(r.code).toBe(1);
  });

  /* Jede Datei des Pakets, auch die drei, die keine Programmdateien sind: Über
     package.json und package-lock.json entscheidet sich, welche Fremdpakete
     Google beim Bau einsetzt. */
  describe.each(PAKET)("Server-Paket, Datei %s", (datei) => {
    test("fehlt im Fingerabdruck → 1", () => {
      fingerabdruckAendern((d) => delete d.serverPaket[datei]);
      const r = pruefen(frischerKlon("klon"));
      expect(r.aus).toContain(`FEHLT IM FINGERABDRUCK (Server-Paket): functions/${datei}`);
      expect(r.aus).toContain("Dazu 1 Abweichung(en) im Server-Paket.");
      expect(r.aus).toContain("Der ausgelieferte Stand entspricht NICHT dem genannten Commit.");
      expect(r.code).toBe(1);
    });

    test("trägt eine andere Prüfsumme als im Commit → 1", () => {
      /* So sähe es aus, wenn eine andere Fassung dieser Datei zu Google ging. */
      fingerabdruckAendern((d) => (d.serverPaket[datei] = summe(`andere Fassung von ${datei}`)));
      const r = pruefen(frischerKlon("klon"));
      expect(r.aus).toContain(`ABWEICHUNG im Server-Paket: functions/${datei}`);
      expect(r.aus).toContain("Server-Paket: 7 Datei(en) gegen Commit");
      expect(r.aus).toContain("Dazu 1 Abweichung(en) im Server-Paket.");
      expect(r.code).toBe(1);
    });
  });

  test.each([
    ["eine Programmdatei, die der Commit nicht kennt", "src/fremd.js"],
    ["eine Datei, die functions.ignore aus dem Paket nimmt (Test)", "src/__tests__/index.test.js"],
    ["eine Punkt-Datei mit lokalen Einstellungen", ".env.local"],
  ])("Server-Paket: der Fingerabdruck nennt %s → 1", (_was, datei) => {
    fingerabdruckAendern((d) => (d.serverPaket[datei] = "sha256:" + "0".repeat(64)));
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain(`NICHT IM COMMIT (Server-Paket): functions/${datei}`);
    expect(r.code).toBe(1);
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

  /** Legt über Stand A einen Commit mit geändertem Server-Ordner an und lässt
   *  die Seite ihn nennen. */
  function standMit(aendere) {
    const arbeit = frischerKlon("arbeit", "main");
    aendere(arbeit);
    git(arbeit, "add", "-A");
    git(arbeit, "commit", "--quiet", "-m", "geänderter Stand");
    fingerabdruckAendern((d) => (d.commit = git(arbeit, "rev-parse", "HEAD")));
    return arbeit;
  }

  test.each([
    ["mit Schrägstrich", "src/**/*.md"],
    ["mit Ausrufezeichen", "!src"],
    ["mit Klammern", "*.{log,md}"],
  ])("der genannte Commit hat in functions.ignore ein Muster %s, das das Skript nicht kennt → 2", (_form, muster) => {
    const arbeit = standMit((ordner) => {
      const konfig = JSON.parse(fs.readFileSync(path.join(ordner, "firebase.json"), "utf8"));
      konfig.functions.ignore.push(muster);
      fs.writeFileSync(path.join(ordner, "firebase.json"), JSON.stringify(konfig));
    });
    const r = pruefen(arbeit);
    expect(r.aus).toContain(`unbekanntes Muster in functions.ignore der firebase.json: ${muster}`);
    expect(r.aus).not.toContain("entspricht Commit");
    expect(r.code).toBe(2);
  });

  test("der genannte Commit nennt keinen Ordner für das Server-Paket → 2", () => {
    const arbeit = standMit((ordner) => {
      const konfig = JSON.parse(fs.readFileSync(path.join(ordner, "firebase.json"), "utf8"));
      delete konfig.functions.source;
      fs.writeFileSync(path.join(ordner, "firebase.json"), JSON.stringify(konfig));
    });
    const r = pruefen(arbeit);
    expect(r.aus).toContain("nennt kein (einzelnes) functions.source");
    expect(r.code).toBe(2);
  });

  test("im Server-Ordner des Commits liegt ein Verweis statt einer Datei → 2", () => {
    /* Das Werkzeug folgte dem Verweis und packte sein Ziel ein; git kennt nur
       den Namen des Ziels. Die Paketliste lässt sich daraus nicht bilden. */
    const arbeit = standMit((ordner) =>
      fs.symlinkSync("../../public/app.js", path.join(ordner, "functions/src/verweis.js"))
    );
    const r = pruefen(arbeit);
    expect(r.aus).toContain("functions/src/verweis.js");
    expect(r.aus).toContain("ist keine gewoehnliche Datei");
    expect(r.code).toBe(2);
  });

  test("im Server-Ordner des Commits liegt eine Datei mit Tabulator im Namen → 2", () => {
    /* Die Listen des Skripts sind zeilen- und spaltenweise aufgebaut; ein
       solcher Name ließe sich darin nicht eindeutig führen. */
    const arbeit = standMit((ordner) => schreibe(ordner, "functions/src/a\tb.js", "module.exports = 4;\n"));
    const r = pruefen(arbeit);
    expect(r.aus).toContain("enthaelt einen Zeilenumbruch oder Tabulator");
    expect(r.code).toBe(2);
  });

  test("Gegenprobe: ein weiteres Muster in der bekannten Form ist kein Messproblem — die Datei fällt aus der Liste", () => {
    /* Der Fingerabdruck nennt hinweis.md noch; der neue Stand nimmt die Datei
       aus dem Paket. Das ist ein Befund über diese eine Datei, kein Messproblem. */
    const arbeit = standMit((ordner) => {
      const konfig = JSON.parse(fs.readFileSync(path.join(ordner, "firebase.json"), "utf8"));
      konfig.functions.ignore.push("*.md");
      fs.writeFileSync(path.join(ordner, "firebase.json"), JSON.stringify(konfig));
    });
    const r = pruefen(arbeit);
    expect(r.aus).toContain("NICHT IM COMMIT (Server-Paket): functions/src/hinweis.md");
    expect(r.aus).toContain("Server-Paket: 6 Datei(en) gegen Commit");
    expect(r.code).toBe(1);
  });
});

describe("pruefe-live.sh ohne den genannten Commit", () => {
  test("Datei live verändert, Fingerabdruck angepasst UND ein Commit genannt, den es nicht gibt → 2, nie 0", () => {
    /* Wer die Auslieferung in der Hand hat, bestimmt auch das Feld `commit`.
       Nennt es einen Stand, den das Repository nicht kennt, entfällt der
       Vergleich mit dem Quelltext — das darf nie wie eine bestandene Prüfung
       enden. */
    fs.appendFileSync(path.join(live, "app.js"), "/* fremder Code */\n");
    fingerabdruckAendern((d) => {
      d.dateien["app.js"] = summeLive("app.js");
      d.commit = "1234567890abcdef1234567890abcdef12345678";
    });
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).not.toContain("entspricht Commit");
    expect(r.aus).toContain("MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet");
    expect(r.code).toBe(2);
  });

  test("Commit lokal unbekannt, sonst alles deckungsgleich → 2: nicht gegengerechnet ist nicht bestanden", () => {
    fingerabdruckAendern((d) => (d.commit = "0".repeat(40)));
    const r = pruefen(frischerKlon("klon"));
    expect(r.code).toBe(2);
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet");
    expect(r.aus).toContain("'git fetch --all' ausfuehren");
    expect(r.aus).not.toContain("entspricht Commit");
  });

  test("kein git-Repository (entpackte Kopie) → 2, NICHT gegengerechnet, Server-Paket gegen den Ordner", () => {
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.code).toBe(2);
    expect(r.aus).toContain("nicht pruefbar (kein git-Repository)");
    expect(r.aus).toContain("MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet");
    expect(r.aus).toContain("in einer Kopie des Repositories laufen lassen");
    expect(r.aus).not.toContain("entspricht Commit");
    expect(r.aus).toContain("Server-Paket: 7 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
  });

  test("kein git-Repository, eine Server-Datei im Ordner ist eine andere als die ausgewiesene → 2 mit Hinweis, kein Befund", () => {
    /* Ohne git steht nicht fest, ob dieser Ordner überhaupt der ausgelieferte
       Stand ist. Dass er abweicht, sagt deshalb nichts über die Auslieferung. */
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    fs.appendFileSync(path.join(klon, "functions/src/config.js"), "// nicht der ausgelieferte Stand\n");
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.aus).toContain("nicht pruefbar (kein git-Repository)");
    expect(r.aus).toContain("HINWEIS: weicht in diesem Ordner ab: functions/src/config.js");
    expect(r.aus).toContain("Server-Paket: 7 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
    expect(r.aus).toContain("1 Datei(en) in diesem Ordner sind andere als die ausgewiesenen");
    expect(r.aus).toContain("Ohne git steht nicht fest, ob dieser Ordner der ausgelieferte Stand ist");
    expect(r.aus).toContain("MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet");
    expect(r.aus).not.toContain("entspricht NICHT");
    expect(r.aus).not.toMatch(/^\s*ABWEICHUNG/m);
    expect(r.code).toBe(2);
  });

  test("kein git-Repository, eine ausgewiesene Server-Datei fehlt im Ordner → 2 mit Hinweis, kein Befund", () => {
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    fs.rmSync(path.join(klon, "functions/package-lock.json"));
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.aus).toContain("HINWEIS: fehlt in diesem Ordner: functions/package-lock.json");
    expect(r.aus).toContain("Server-Paket: 6 Datei(en) gegen die Dateien in diesem Ordner geprueft.");
    expect(r.aus).toContain("1 Datei(en) in diesem Ordner sind andere als die ausgewiesenen");
    expect(r.aus).not.toContain("entspricht NICHT");
    expect(r.code).toBe(2);
  });

  test("kein git-Repository, aber die Seite widerspricht sich selbst (Datei live verändert) → 1", () => {
    /* Das steht auch ohne Repository fest: Die ausgelieferte Datei passt nicht
       zu dem Wert, den derselbe Server für sie ausweist. */
    fs.appendFileSync(path.join(live, "app.js"), "/* fremder Code */\n");
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, ".git"), { recursive: true, force: true });
    const r = pruefen(klon, { GIT_CEILING_DIRECTORIES: basis });
    expect(r.aus).toContain("ABWEICHUNG: app.js");
    expect(r.aus).toContain("ERGEBNIS: 1 Abweichung(en), 0 fehlend, bei 3 geprueften Dateien.");
    expect(r.code).toBe(1);
  });

  test("ältere Kopie des Repositorys, einwandfreie Auslieferung → 2, nicht 1", () => {
    /* Der häufigste Fall bei Dritten: Die Kopie stammt von vor der letzten
       Auslieferung und kennt deren Commit nicht. Ihre Dateien sind älter —
       an der Auslieferung ist nichts falsch. Das ist ein Messproblem (erst
       `git fetch`), kein Befund. */
    ausliefern((o) => {
      fs.appendFileSync(path.join(o, "functions/src/config.js"), "// neuer als die Kopie des Prüfenden\n");
      schreibe(o, "functions/src/neu.js", "module.exports = 5;\n");
      fs.appendFileSync(path.join(o, "functions/package-lock.json"), "\n");
    });
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("Server-Paket: nicht nachgerechnet — dieses Repository kennt den genannten Commit nicht.");
    expect(r.aus).toContain("MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet");
    expect(r.aus).toContain("'git fetch --all' ausfuehren");
    /* Kein Vergleich mit dem Ordner, also auch keine Zeile dazu. */
    expect(r.aus).not.toMatch(/in diesem Ordner/);
    expect(r.aus).not.toMatch(/ABWEICHUNG|FEHLT/);
    expect(r.aus).not.toContain("entspricht NICHT");
    expect(r.aus).not.toContain("entspricht Commit");
    expect(r.code).toBe(2);
  });

  test("Commit lokal unbekannt, eine ausgewiesene Server-Datei fehlt im Ordner → 2: der Ordner wird gar nicht verglichen", () => {
    fingerabdruckAendern((d) => (d.commit = "0".repeat(40)));
    const klon = frischerKlon("klon");
    fs.rmSync(path.join(klon, "functions/src/config.js"));
    const r = pruefen(klon);
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("Server-Paket: nicht nachgerechnet — dieses Repository kennt den genannten Commit nicht.");
    expect(r.aus).not.toMatch(/in diesem Ordner/);
    expect(r.aus).not.toContain("entspricht NICHT");
    expect(r.code).toBe(2);
  });

  test("ältere Kopie, aber die Seite widerspricht sich selbst (Datei live verändert) → 1", () => {
    ausliefern((o) => fs.appendFileSync(path.join(o, "functions/src/config.js"), "// neuer als die Kopie\n"));
    fs.appendFileSync(path.join(live, "js/a.js"), "/* fremder Code */\n");
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("Commit im Repository: NEIN");
    expect(r.aus).toContain("ABWEICHUNG: js/a.js");
    expect(r.aus).toContain("Der ausgelieferte Stand entspricht NICHT dem genannten Commit.");
    expect(r.code).toBe(1);
  });

  test("ältere Kopie, eine im Fingerabdruck genannte Website-Datei gibt es auf dem Server nicht (404) → 1", () => {
    ausliefern((o) => fs.appendFileSync(path.join(o, "functions/src/config.js"), "// neuer als die Kopie\n"));
    const r = pruefen(frischerKlon("klon"), { ATTRAPPE_NICHT_GEFUNDEN: "app.js" });
    expect(r.aus).toContain("FEHLT auf dem Server: app.js");
    expect(r.code).toBe(1);
  });
});

describe("pruefe-live.sh rechnet das Server-Paket nach denselben Regeln wie das Werkzeug", () => {
  /* Zwei Stellen bilden die Liste des Pakets: der Wächter (für den Erzeuger,
     mit der Bibliothek des Werkzeugs) und die Nachprüfung (für Dritte, ohne
     Installation). Diese Fälle liefern je einen eigenen Stand mit dem echten
     Erzeuger aus und lassen die Nachprüfung dagegen laufen: Listeten die
     beiden verschieden, meldete sie eine Datei als fehlend oder als fremd. */

  const konfigAendern = (ordner, aendere) => {
    const datei = path.join(ordner, "firebase.json");
    const konfig = JSON.parse(fs.readFileSync(datei, "utf8"));
    aendere(konfig.functions);
    fs.writeFileSync(datei, JSON.stringify(konfig));
  };

  test("ohne functions.ignore gilt die Vorgabe des Werkzeugs: alles außer node_modules und .git — und nie die Debug-Protokolle", () => {
    const { ordner, daten } = ausliefern((o) => {
      konfigAendern(o, (f) => delete f.ignore);
      schreibe(o, "functions/firebase-debug.log", "Protokoll des Werkzeugs\n");
      schreibe(o, "functions/firebase-debug.1.log", "Protokoll des Werkzeugs\n");
      schreibe(o, "functions/.runtimeconfig.json", "{}\n");
      schreibe(o, "functions/node_modules/fremd/index.js", "module.exports = 1;\n");
    });
    /* Jetzt gehen auch der Test, die Punkt-Datei und das Protokoll des Lasttests mit … */
    const erwartet = [...PAKET, ".env.local", "lasttest.log", "src/__tests__/index.test.js"].sort();
    expect(Object.keys(daten.serverPaket).sort()).toEqual(erwartet);
    /* … und die Nachprüfung sieht es genauso. */
    const r = pruefen(ordner);
    expect(r.aus).not.toMatch(/FEHLT|NICHT IM COMMIT|ABWEICHUNG|MESSPROBLEM/);
    expect(r.aus).toContain(`Server-Paket: ${erwartet.length} Datei(en) gegen Commit`);
    expect(r.code).toBe(0);
  });

  test("ein Muster mit Stern gilt auf jeder Ebene, ein Ordnername nimmt den ganzen Ordner heraus", () => {
    const { ordner, daten } = ausliefern((o) => {
      konfigAendern(o, (f) => f.ignore.push("*.md", "locales"));
      schreibe(o, "functions/LIESMICH.md", "oben\n");
      schreibe(o, "functions/src/tief/unten/notiz.md", "unten\n");
      schreibe(o, "functions/src/tief/unten/programm.js", "module.exports = 2;\n");
    });
    const erwartet = [
      "package-lock.json",
      "package.json",
      "src/config.js",
      "src/index.js",
      "src/tief/unten/programm.js",
    ];
    expect(Object.keys(daten.serverPaket).sort()).toEqual(erwartet);
    const r = pruefen(ordner);
    expect(r.aus).not.toMatch(/FEHLT|NICHT IM COMMIT|ABWEICHUNG|MESSPROBLEM/);
    expect(r.aus).toContain("Server-Paket: 5 Datei(en) gegen Commit");
    expect(r.code).toBe(0);
  });

  test("ein Dateiname mit Leerzeichen und Umlaut steht im Fingerabdruck und wird nachgerechnet", () => {
    const { ordner, daten } = ausliefern((o) => schreibe(o, "functions/src/wörter liste.js", "module.exports = 3;\n"));
    expect(Object.keys(daten.serverPaket)).toContain("src/wörter liste.js");
    const r = pruefen(ordner);
    expect(r.aus).not.toMatch(/FEHLT|NICHT IM COMMIT|ABWEICHUNG|MESSPROBLEM/);
    expect(r.aus).toContain("Server-Paket: 8 Datei(en) gegen Commit");
    expect(r.code).toBe(0);
  });
});

describe("pruefe-live.sh an einem Stand in der älteren Form des Fingerabdrucks", () => {
  /* Bis zum 05.10.2026 nannte der Fingerabdruck vom Server nur die .js-Dateien
     unter functions/src/ (Feld `serverDateien`). Ein solcher Stand bleibt
     nachrechenbar, mit der Liste von damals — sonst meldete das Skript für die
     Auslieferung, die gerade live steht, einen Befund, den es nicht gibt. */
  test("unveränderter Stand → 0, gerechnet mit der Liste von damals", () => {
    alsAeltereForm();
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain(`Server-Code: 3 Datei(en) gegen Commit ${commitAlt} geprueft.`);
    expect(r.aus).toContain(`Der ausgelieferte Stand entspricht Commit ${commitAlt}.`);
    expect(r.aus).not.toMatch(/FEHLT|NICHT IM COMMIT|ABWEICHUNG/);
    expect(r.code).toBe(0);
  });

  test("eine Programmdatei mit anderer Prüfsumme → 1", () => {
    alsAeltereForm();
    fingerabdruckAendern((d) => (d.serverDateien["config.js"] = "sha256:" + "0".repeat(64)));
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("ABWEICHUNG im Server-Code: functions/src/config.js");
    expect(r.code).toBe(1);
  });

  test("eine Programmdatei fehlt in der Liste → 1", () => {
    alsAeltereForm();
    fingerabdruckAendern((d) => delete d.serverDateien["config.js"]);
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK (Server-Code): functions/src/config.js");
    expect(r.code).toBe(1);
  });

  test("ganz ohne Server-Dateien → 1", () => {
    alsAeltereForm();
    fingerabdruckAendern((d) => delete d.serverDateien);
    const r = pruefen(frischerKlon("klon"));
    expect(r.aus).toContain("FEHLT IM FINGERABDRUCK: die Server-Dateien");
    expect(r.aus).toContain("(Feld serverDateien)");
    expect(r.code).toBe(1);
  });
});
