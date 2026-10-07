/* pipeline-vertrag-script.test.js — faellt es auf, wenn aus der Pipeline etwas verschwindet?
 *
 * Der Zweigschutz und `scripts/deploy.sh` verlangen sechs gruene Pflicht-Checks.
 * Beide sehen nur NAME und ERGEBNIS eines Jobs — nicht, was er getan hat. Ein
 * Job, aus dem der Testlauf gestrichen wurde, bleibt gruen (OPS-2026-10-03-12).
 *
 * `scripts/pruefe-deploy-riegel.py` haelt deshalb fest, wie die Pipeline-Dateien
 * aussehen muessen: alle fuenf Workflows und `dependabot.yml` per Pruefsumme,
 * dazu fuer `ci.yml` je Pflicht-Job die Pruefbefehle, die ihn ausmachen — und
 * unter welchen Umstaenden sie laufen (keine Bedingung am Schritt, festgelegter
 * Arbeitsordner, festgelegte Umgebung) — sowie seine ganze Schrittfolge im
 * Wortlaut (OPS-2026-10-04-27).
 *
 * Der Wortlaut `npm test` sagt nicht, was dahinter geschieht. Festgelegt ist
 * deshalb auch der Inhalt der npm-Skripte in beiden `package.json`, die
 * Einstellung von Jest und — per Pruefsumme — die Einstellungsdateien der
 * uebrigen Pruefwerkzeuge.
 *
 * Diese Tests fuehren den Waechter AUS — gegen einen Nachbau des Repositorys in
 * einem Wegwerf-Ordner (die Skripte, `.github`, die Waechter-Uebersicht, beide
 * `package.json` und die Einstellungsdateien, alle aus dem Arbeitsbaum kopiert).
 * Dort wird eine Datei veraendert, und der Waechter muss anhalten. Im
 * Repository selbst wird nichts angefasst.
 *
 * Zwei Sorten von Faellen:
 *   · Pruefsumme — die Aenderung allein macht den Waechter rot.
 *   · Inhalt — die Aenderung PLUS nachgetragene Pruefsumme. Das ist die Lage,
 *     in der jemand `ci.yml` bewusst ueberarbeitet und die Summe mitzieht: Dann
 *     duerfen die Pruefbefehle trotzdem nicht verloren gehen.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const WAECHTER = "scripts/pruefe-deploy-riegel.py";
const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/release.yml";
const AUTOMERGE = ".github/workflows/dependabot-automerge.yml";
const DEPENDABOT = ".github/dependabot.yml";
const DEPLOY = "scripts/deploy.sh";
const PAKET = "package.json";
const PAKET_SERVER = "functions/package.json";
const VITEST = "vitest.config.js";
const PLAYWRIGHT = "playwright.config.js";
const ESLINT = "eslint.config.mjs";
const ESLINT_SERVER = "functions/eslint.config.js";
const PRETTIER_AUSNAHMEN = ".prettierignore";
const JEST_VORBEREITUNG = "functions/jest.setup.js";
/* Was der Waechter ausserhalb von scripts/, .github und docs/ liest. */
const EINZELDATEIEN = [
  PAKET,
  PAKET_SERVER,
  VITEST,
  PLAYWRIGHT,
  ESLINT,
  ESLINT_SERVER,
  PRETTIER_AUSNAHMEN,
  JEST_VORBEREITUNG,
];

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const GITLEAKS = "gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0";
const METADATEN = "dependabot/fetch-metadata@25dd0e34f4fe68f24cc83900b1fe3fe149efef98 # v3.1.0";

let nachbau;

/** Kopiert alles, was der Waechter liest, aus dem Arbeitsbaum in den Nachbau. */
function aufbauen() {
  fs.rmSync(nachbau, { recursive: true, force: true });
  fs.mkdirSync(path.join(nachbau, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(nachbau, "docs"), { recursive: true });
  /* Die Skripte der obersten Ebene: der Waechter selbst, deploy.sh,
     vor-dem-push.sh und alle pruefe-*. Unterordner liest er nicht. */
  for (const eintrag of fs.readdirSync(path.join(WURZEL, "scripts"), { withFileTypes: true })) {
    if (!eintrag.isFile()) continue;
    fs.copyFileSync(path.join(WURZEL, "scripts", eintrag.name), path.join(nachbau, "scripts", eintrag.name));
  }
  fs.cpSync(path.join(WURZEL, ".github"), path.join(nachbau, ".github"), { recursive: true });
  fs.copyFileSync(path.join(WURZEL, "docs", "WAECHTER.md"), path.join(nachbau, "docs", "WAECHTER.md"));
  fs.mkdirSync(path.join(nachbau, "functions"), { recursive: true });
  for (const datei of EINZELDATEIEN) fs.copyFileSync(path.join(WURZEL, datei), path.join(nachbau, datei));
}

beforeAll(() => {
  nachbau = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-pipeline-vertrag-"));
  aufbauen();
});

afterEach(aufbauen);

afterAll(() => {
  if (nachbau) fs.rmSync(nachbau, { recursive: true, force: true });
});

/** Fuehrt den Waechter im genannten Verzeichnis aus. */
function waechter(wurzel = nachbau, ...argumente) {
  try {
    const ausgabe = execFileSync("python3", [path.join(wurzel, WAECHTER), ...argumente], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, ausgabe };
  } catch (e) {
    return { code: e.status, ausgabe: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

/** Ersetzt GENAU EIN Vorkommen. Kommt `alt` nicht genau einmal vor, scheitert
 *  der Test laut — eine Sabotage, die nichts trifft, belegte nichts. */
function einmal(text, alt, neu) {
  const teile = text.split(alt);
  if (teile.length !== 2) throw new Error(`erwartet genau ein Vorkommen, gefunden ${teile.length - 1}: ${alt}`);
  return teile.join(neu);
}

/** Ersetzt JEDES Vorkommen; mindestens eines muss es geben. */
function alle(text, alt, neu) {
  const teile = text.split(alt);
  if (teile.length < 2) throw new Error(`kein Vorkommen: ${alt}`);
  return teile.join(neu);
}

/** Veraendert eine Datei im Nachbau. */
function aendern(datei, umbau) {
  const pfad = path.join(nachbau, datei);
  const vorher = fs.readFileSync(pfad, "utf8");
  const nachher = umbau(vorher);
  if (nachher === vorher) throw new Error(`Sabotage nicht angewendet: ${datei}`);
  fs.writeFileSync(pfad, nachher);
}

/* `--vertrag-summen` nennt beide Tabellen mit ihrem Namen. */
const RAHMEN_DER_SUMMEN = ["VERTRAG_SUMMEN = {", "EINSTELLUNG_SUMMEN = {", "}"];

/** Traegt im Nachbau die Pruefsummen nach, wie es bei einer bewussten Aenderung
 *  geschieht: Ausgabe von `--vertrag-summen` in die Liste des Waechters. */
function summenNachtragen() {
  const zeilen = waechter(nachbau, "--vertrag-summen").ausgabe.split("\n").filter(Boolean);
  if (zeilen.length === 0) throw new Error("--vertrag-summen lieferte nichts");
  const pfad = path.join(nachbau, WAECHTER);
  let text = fs.readFileSync(pfad, "utf8");
  for (const zeile of zeilen) {
    if (RAHMEN_DER_SUMMEN.includes(zeile)) continue;
    const m = zeile.match(/^\s*"([^"]+)": "([0-9a-f]{16})",$/);
    if (!m) throw new Error(`unerwartete Zeile von --vertrag-summen: ${zeile}`);
    const eintrag = new RegExp(`("${m[1].replace(/\./g, "\\.")}": ")[0-9a-f]{16}(",)`);
    if (!eintrag.test(text)) throw new Error(`kein Eintrag fuer ${m[1]} in den Tabellen der Pruefsummen`);
    text = text.replace(eintrag, `$1${m[2]}$2`);
  }
  fs.writeFileSync(pfad, text);
}

/** Macht aus dem Nachbau ein git-Repository, in dem alles eingecheckt ist. */
function alsGitRepository() {
  const umgebung = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete umgebung[name];
  const git = (...argumente) => execFileSync("git", argumente, { cwd: nachbau, env: umgebung, stdio: "pipe" });
  git("-c", "init.defaultBranch=main", "init", "--quiet");
  git("add", "-A");
}

const zeileWeg = (zeile) => (t) => einmal(t, `${zeile}\n`, "");
const ABWEICHUNG = /weicht vom festgeschriebenen Stand ab/;

describe("Vertrag der Pipeline-Dateien — der Erfolgsweg", () => {
  test("die unveraenderte Pipeline besteht — im Repository selbst", () => {
    const r = waechter(WURZEL);
    expect(r.ausgabe).not.toMatch(/FEHLT/);
    expect(r.code).toBe(0);
    /* Und der Vertrag ist wirklich gemessen worden, nicht nur verschwiegen. */
    expect(r.ausgabe).toMatch(/6 Dateien entsprechen dem festgeschriebenen Stand/);
    expect(r.ausgabe).toMatch(/jeder der 6 Pflicht-Jobs fuehrt seine Pruefbefehle aus/);
    expect(r.ausgabe).toMatch(/11 npm-Skripte hinter den Pflicht-Schritten, die Jest-Einstellung/);
    expect(r.ausgabe).toMatch(/und 6 Einstellungsdateien der Pruefwerkzeuge lauten wie festgelegt/);
    expect(r.ausgabe).toMatch(/keine eingecheckte Datei ist von \.gitignore erfasst/);
  });

  test("der Nachbau verhaelt sich wie das Repository (Messmittel-Probe)", () => {
    /* Fehlte im Nachbau eine Datei, die der Waechter braucht, waeren alle
       folgenden Faelle aus dem falschen Grund rot. */
    const r = waechter();
    expect(r.ausgabe).not.toMatch(/FEHLT|NICHT MESSBAR/);
    expect(r.code).toBe(0);
    /* Der Nachbau ist kein git-Repository. Die eine Frage, die git braucht,
       gilt dort ausdruecklich als nicht gemessen — nicht als bestanden. */
    expect(r.ausgabe).toMatch(/NICHT GEMESSEN: ob \.gitignore eingecheckte Dateien erfasst/);
    expect(r.ausgabe).not.toMatch(/keine eingecheckte Datei ist von \.gitignore erfasst/);
  });

  test("als git-Repository: der Nachbau besteht, und die Frage nach .gitignore ist gemessen", () => {
    alsGitRepository();
    const r = waechter();
    expect(r.ausgabe).toMatch(/keine eingecheckte Datei ist von \.gitignore erfasst/);
    expect(r.code).toBe(0);
  });

  test("eine angehobene Action (neue Commit-Kennung, neue Versionsangabe) bleibt frei", () => {
    /* So sehen die Aenderungen von Dependabot aus. Der Vertrag darf sie nicht
       anhalten — sonst liefe jedes Update der Actions ueber eine Handkorrektur. */
    aendern(CI, (t) => alle(t, CHECKOUT, "actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.0.2"));
    aendern(RELEASE, (t) => alle(t, CHECKOUT, "actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.0.2"));
    const r = waechter();
    expect(r.ausgabe).not.toMatch(/FEHLT/);
    expect(r.code).toBe(0);
  });

  test("Kommentar- und Leerzeilen ausserhalb mehrzeiliger Befehle bleiben frei", () => {
    aendern(CI, (t) => einmal(t, "jobs:\n", "# Ein neuer Kommentar.\n\njobs:\n"));
    aendern(DEPENDABOT, (t) => einmal(t, "updates:\n", "# Ein neuer Kommentar.\nupdates:\n"));
    expect(waechter().code).toBe(0);
  });

  test("`--vertrag-summen` nennt genau die eingetragenen Werte", () => {
    const ausgabe = waechter(nachbau, "--vertrag-summen").ausgabe.split("\n").filter(Boolean);
    const skript = fs.readFileSync(path.join(nachbau, WAECHTER), "utf8");
    /* Sechs Pipeline-Dateien und sechs Einstellungsdateien, jede Tabelle mit Kopf- und Schlusszeile. */
    const summen = ausgabe.filter((zeile) => !RAHMEN_DER_SUMMEN.includes(zeile));
    expect(summen).toHaveLength(12);
    expect(ausgabe).toHaveLength(16);
    for (const zeile of summen) {
      expect(zeile).toMatch(/^ {4}"[^"]+": "[0-9a-f]{16}",$/);
      expect(skript).toContain(zeile);
    }
  });

  test("eine bewusst geaenderte Einstellungsdatei besteht wieder, sobald ihre Pruefsumme nachgetragen ist", () => {
    /* Der vorgesehene Weg fuer eine gewollte Aenderung. Er zeigt auch die Grenze:
       Fuer diese Dateien gibt es nur die Pruefsumme, keinen inhaltlichen Teil. */
    aendern(PLAYWRIGHT, (t) => einmal(t, "  timeout: 30000,\n", "  timeout: 45000,\n"));
    expect(waechter().ausgabe).toContain("playwright.config.js weicht vom festgeschriebenen Stand ab");
    summenNachtragen();
    const r = waechter();
    expect(r.ausgabe).not.toMatch(/FEHLT/);
    expect(r.code).toBe(0);
  });
});

describe("Vertrag der Pipeline-Dateien — die Pruefsumme haelt jede Datei fest", () => {
  const FAELLE = [
    ["a", "ci.yml: Action per Etikett statt Commit-Kennung", CI, (t) => alle(t, CHECKOUT, "actions/checkout@v7")],
    [
      "b",
      "ci.yml: Geheimnis-Suche von einem beweglichen Zweig",
      CI,
      (t) => einmal(t, GITLEAKS, "gitleaks/gitleaks-action@master"),
    ],
    ["c", "release.yml: Action per Etikett", RELEASE, (t) => einmal(t, CHECKOUT, "actions/checkout@v7")],
    [
      "d",
      "dependabot-automerge.yml: Action per Etikett",
      AUTOMERGE,
      (t) => einmal(t, METADATEN, "dependabot/fetch-metadata@v3"),
    ],
    [
      "e",
      "ci.yml: Schreibrechte fuer das Pipeline-Token",
      CI,
      (t) => einmal(t, "\n  contents: read\n", "\n  contents: write\n"),
    ],
    [
      "f",
      "dependabot-automerge.yml: Ausloeser pull_request_target",
      AUTOMERGE,
      (t) => einmal(t, "\non: pull_request\n", "\non: pull_request_target\n"),
    ],
    [
      "g",
      "dependabot-automerge.yml: Ausschluss von functions/ entfernt",
      AUTOMERGE,
      (t) => einmal(t, "          !contains(steps.meta.outputs.directory, '/functions') &&\n", ""),
    ],
    [
      "h",
      "dependabot-automerge.yml: Sperre fuer Aenderungen unter .github/ entfernt",
      AUTOMERGE,
      (t) => einmal(t, "steps.flaechen.outputs.kette == 'nein'", "true"),
    ],
    [
      "i",
      "dependabot-automerge.yml: jede Versionsstufe wird zusammengefuehrt",
      AUTOMERGE,
      (t) => einmal(t, "(steps.meta.outputs.update-type == 'version-update:semver-patch' ||", "(true ||"),
    ],
    [
      "j",
      "dependabot-automerge.yml: Bedingung 'nur Dependabot' entfernt",
      AUTOMERGE,
      (t) => einmal(t, "    if: github.actor == 'dependabot[bot]'\n", "    if: true\n"),
    ],
    [
      "k",
      "ci.yml: Browser-Durchlaeufe dauerhaft uebersprungen",
      CI,
      (t) => einmal(t, "    if: needs.playwright-version.outputs.nur_nachtrag != 'ja'\n", "    if: false\n"),
    ],
    [
      "m",
      "ci.yml: Browser-Durchlaeufe durch echo ersetzt",
      CI,
      (t) => einmal(t, "      - run: npm run test:e2e\n", "      - run: echo uebersprungen\n"),
    ],
    [
      "q",
      "ci.yml: Nachtrag-Erkennung sagt immer ja",
      CI,
      (t) => einmal(t, "run: sh scripts/nur-nachtrag.sh", 'run: echo "nur_nachtrag=ja" >> "$GITHUB_OUTPUT"'),
    ],
    [
      "t",
      "ci.yml: woechentlicher Zeitplan auf einmal im Jahr",
      CI,
      (t) => einmal(t, '- cron: "17 6 * * 1"', '- cron: "17 6 1 1 *"'),
    ],
    [
      "u",
      "ci.yml: ueberall flacher Checkout",
      CI,
      (t) => alle(t, "          fetch-depth: 0\n", "          fetch-depth: 1\n"),
    ],
    [
      "v",
      "dependabot.yml: taeglich statt monatlich",
      DEPENDABOT,
      (t) => alle(t, 'interval: "monthly"', 'interval: "daily"'),
    ],
    ["x1", "ci.yml: die Server-Tests geloescht", CI, zeileWeg("      - run: npm test")],
    [
      "x16",
      "ci.yml: die Server-Tests auskommentiert",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      # - run: npm test\n"),
    ],
    ["x2", "ci.yml: die Browser-Modul-Tests geloescht", CI, zeileWeg("      - run: npm run test:frontend")],
    ["x3", "ci.yml: die Browser-Durchlaeufe geloescht", CI, zeileWeg("      - run: npm run test:e2e")],
    ["x5", "ci.yml: der Server-Lint geloescht", CI, zeileWeg("      - run: npm run lint")],
    [
      "x7",
      "ci.yml: das Abhaengigkeits-Gate geloescht",
      CI,
      zeileWeg("      - run: node ../scripts/audit-gate.mjs functions ."),
    ],
    [
      "x9",
      "ci.yml: die Formatpruefung der Website geloescht",
      CI,
      zeileWeg("      - run: npm run format:frontend:check"),
    ],
    [
      "x10",
      "ci.yml: Server-Tests mit continue-on-error",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n"),
    ],
    [
      "x15",
      "release.yml: Rechte erweitert",
      RELEASE,
      (t) => einmal(t, "permissions:\n  contents: write\n", "permissions:\n  contents: write\n  actions: write\n"),
    ],
    /* Die Einstellungsdateien der Pruefwerkzeuge: Skript und Schritt bleiben
       wortgleich, das Werkzeug sieht aber keine oder weniger Dateien an. */
    [
      "e1",
      "vitest.config.js: keine Testdatei mehr, und das gilt als bestanden",
      VITEST,
      (t) => einmal(t, 'include: ["public/__tests__/**/*.test.js"],', "include: [],\n    passWithNoTests: true,"),
    ],
    [
      "e2",
      "playwright.config.js: nur noch eine Testdatei",
      PLAYWRIGHT,
      (t) => einmal(t, '  testDir: "./e2e",\n', '  testDir: "./e2e",\n  testMatch: /smoke\\.test\\.js/,\n'),
    ],
    [
      "e3",
      "playwright.config.js: ohne den Durchlauf in Chromium",
      PLAYWRIGHT,
      (t) => einmal(t, '    { name: "chromium", use: { browserName: "chromium" } },\n', ""),
    ],
    [
      "e4",
      "playwright.config.js: ein roter Test wird wiederholt, bis er gruen ist",
      PLAYWRIGHT,
      (t) => einmal(t, "  retries: 0,\n", "  retries: 5,\n"),
    ],
    [
      "e5",
      "functions/eslint.config.js: eine Datei aus dem Lint genommen",
      ESLINT_SERVER,
      (t) =>
        einmal(
          t,
          'ignores: ["node_modules/", "coverage/"]',
          'ignores: ["node_modules/", "coverage/", "src/config.js"]'
        ),
    ],
    [
      "e6",
      "eslint.config.mjs: der Lint der Website sieht public/js nicht mehr an",
      ESLINT,
      (t) => einmal(t, '"public/lib/", "public/fonts/"]', '"public/lib/", "public/fonts/", "public/js/"]'),
    ],
    ["e7", ".prettierignore: die Formatpruefung laesst public/ aus", PRETTIER_AUSNAHMEN, (t) => `${t}public/\n`],
    [
      "e8",
      "functions/jest.setup.js: eine Zeile ersetzt `test` durch eine Fassung, die jeden Test ueberspringt",
      JEST_VORBEREITUNG,
      (t) => `${t}\nglobal.test = Object.assign((name, fn, zeit) => global.it.skip(name, fn, zeit), global.test);\n`,
    ],
    [
      "e9",
      "functions/jest.setup.js: der Riegel gegen die echte Datenbank ist auskommentiert",
      JEST_VORBEREITUNG,
      (t) =>
        einmal(t, 'jest.mock("firebase-admin/firestore", () => {', '/* jest.mock("firebase-admin/firestore", () => {') +
        "*/\n",
    ],
  ];

  test.each(FAELLE)("%s — %s: der Waechter haelt an", (_kuerzel, _was, datei, umbau) => {
    aendern(datei, umbau);
    const r = waechter();
    expect(r.code).toBe(1);
    /* Die Meldung DIESES Vertrags, mit dem Namen der veraenderten Datei — ein
       abgestuerzter Waechter liefert ebenfalls einen Rueckgabewert ungleich 0. */
    expect(r.ausgabe).toContain(`${path.basename(datei)} weicht vom festgeschriebenen Stand ab`);
    expect(r.ausgabe).toMatch(/--vertrag-summen/);
  });

  test("eine geloeschte Pipeline-Datei faellt auf", () => {
    fs.rmSync(path.join(nachbau, AUTOMERGE));
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/dependabot-automerge\.yml fehlt/);
  });
});

describe("Vertrag der Pipeline-Dateien — der Inhalt bleibt rot, auch mit nachgetragener Pruefsumme", () => {
  const FAELLE = [
    [
      "die Server-Tests geloescht",
      CI,
      zeileWeg("      - run: npm test"),
      /Job test-backend fuehrt 'npm test' nicht mehr/,
    ],
    [
      "die Server-Tests auskommentiert — der haeufigste Weg, auf dem ein Lauf 'voruebergehend' verschwindet",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      # - run: npm test\n"),
      /Job test-backend fuehrt 'npm test' nicht mehr/,
    ],
    [
      "der Server-Lint geloescht",
      CI,
      zeileWeg("      - run: npm run lint"),
      /Job test-backend fuehrt 'npm run lint' nicht mehr/,
    ],
    [
      "die Formatpruefung des Servers geloescht",
      CI,
      zeileWeg("      - run: npm run format:check"),
      /Job test-backend fuehrt 'npm run format:check' nicht mehr/,
    ],
    [
      "das Abhaengigkeits-Gate geloescht (der Kommentar darueber nennt es weiter)",
      CI,
      zeileWeg("      - run: node ../scripts/audit-gate.mjs functions ."),
      /Job test-backend fuehrt 'node \.\.\/scripts\/audit-gate\.mjs functions \.' nicht mehr/,
    ],
    [
      "die Zeitzuender-Pruefung des Servers geloescht (die der Website steht weiter da)",
      CI,
      (t) =>
        einmal(t, "      - run: sh scripts/pruefe-zeitzuender.sh . --nur backend\n        working-directory: .\n", ""),
      /Job test-backend fuehrt 'sh scripts\/pruefe-zeitzuender\.sh \. --nur backend' nicht mehr/,
    ],
    [
      "die Browser-Modul-Tests geloescht",
      CI,
      zeileWeg("      - run: npm run test:frontend"),
      /Job test-frontend fuehrt 'npm run test:frontend' nicht mehr/,
    ],
    [
      "der Lint der Website geloescht",
      CI,
      zeileWeg("      - run: npm run lint:frontend"),
      /Job test-frontend fuehrt 'npm run lint:frontend' nicht mehr/,
    ],
    [
      "die Formatpruefung der Website geloescht",
      CI,
      zeileWeg("      - run: npm run format:frontend:check"),
      /Job test-frontend fuehrt 'npm run format:frontend:check' nicht mehr/,
    ],
    [
      "die Browser-Durchlaeufe geloescht",
      CI,
      zeileWeg("      - run: npm run test:e2e"),
      /Job test-e2e fuehrt 'npm run test:e2e' nicht mehr/,
    ],
    [
      "die Browser-Durchlaeufe durch echo ersetzt",
      CI,
      (t) => einmal(t, "      - run: npm run test:e2e\n", "      - run: echo uebersprungen\n"),
      /Job test-e2e fuehrt 'npm run test:e2e' nicht mehr/,
    ],
    [
      "die Server-Tests laufen mit einem Filter, der nichts trifft",
      CI,
      (t) =>
        einmal(t, "      - run: npm test\n", "      - run: npm test -- --passWithNoTests --testPathPattern=nichts\n"),
      /Job test-backend fuehrt 'npm test' nicht mehr/,
    ],
    [
      "die Geheimnis-Suche durch echo ersetzt",
      CI,
      (t) =>
        einmal(
          t,
          `      - uses: ${GITLEAKS}\n        env:\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n`,
          "      - run: echo uebersprungen\n"
        ),
      /Job secret-scan fuehrt 'uses: gitleaks\/gitleaks-action' nicht mehr/,
    ],
    [
      "die Nachtrag-Erkennung sagt immer ja",
      CI,
      (t) => einmal(t, "run: sh scripts/nur-nachtrag.sh", 'run: echo "nur_nachtrag=ja" >> "$GITHUB_OUTPUT"'),
      /Job playwright-version fuehrt 'sh scripts\/nur-nachtrag\.sh' nicht mehr/,
    ],
    [
      "die Selbstpruefung der Pruefungen geloescht",
      CI,
      zeileWeg("      - run: sh scripts/pruefungen/selbstpruefung.sh"),
      /Job pruefungen fuehrt 'sh scripts\/pruefungen\/selbstpruefung\.sh' nicht mehr/,
    ],
    [
      "der Blick des Waechters fuer verschluckte Fehler auf .github geloescht",
      CI,
      zeileWeg("      - run: python3 scripts/pruefungen/checks/stiller-fehlschlag.py .github"),
      /Job pruefungen fuehrt 'python3 scripts\/pruefungen\/checks\/stiller-fehlschlag\.py \.github' nicht mehr/,
    ],
    [
      "ein Pflicht-Job umbenannt",
      CI,
      (t) => einmal(t, "\n  test-e2e:\n", "\n  browser:\n"),
      /Pflicht-Job test-e2e fehlt/,
    ],
    [
      "die Browser-Durchlaeufe dauerhaft uebersprungen (if: false)",
      CI,
      (t) => einmal(t, "    if: needs.playwright-version.outputs.nur_nachtrag != 'ja'\n", "    if: false\n"),
      /Job test-e2e traegt die Bedingung \['false'\]/,
    ],
    [
      "ein anderer Pflicht-Job bekommt eine Bedingung",
      CI,
      (t) =>
        einmal(
          t,
          "  secret-scan:\n    runs-on: ubuntu-latest\n",
          "  secret-scan:\n    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n"
        ),
      /Job secret-scan traegt die Bedingung/,
    ],
    [
      "dieselbe Bedingung am Job mit dem Schluessel in Anfuehrungszeichen",
      CI,
      (t) =>
        einmal(
          t,
          "  secret-scan:\n    runs-on: ubuntu-latest\n",
          '  secret-scan:\n    "if": false\n    runs-on: ubuntu-latest\n'
        ),
      /Job secret-scan traegt die Bedingung \['false'\]/,
    ],
    [
      "ein roter Schritt zaehlt als gruen (continue-on-error am Schritt)",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n"),
      /Job test-backend traegt 'continue-on-error'/,
    ],
    [
      "ein roter Job zaehlt als gruen (continue-on-error am Job)",
      CI,
      (t) =>
        einmal(t, "    needs: playwright-version\n", "    needs: playwright-version\n    continue-on-error: true\n"),
      /Job test-e2e traegt 'continue-on-error'/,
    ],
    [
      "continue-on-error mit dem Schluessel in Anfuehrungszeichen",
      CI,
      (t) => einmal(t, "      - run: npm test\n", '      - run: npm test\n        "continue-on-error": true\n'),
      /Job test-backend traegt 'continue-on-error'/,
    ],
    [
      "Schreibrechte fuer das Pipeline-Token",
      CI,
      (t) => einmal(t, "\n  contents: read\n", "\n  contents: write\n"),
      /Rechte des Pipeline-Tokens sind nicht genau/,
    ],
    [
      "ein Job setzt sich eigene Rechte",
      CI,
      (t) =>
        einmal(
          t,
          "  secret-scan:\n    runs-on: ubuntu-latest\n",
          "  secret-scan:\n    permissions: write-all\n    runs-on: ubuntu-latest\n"
        ),
      /Job secret-scan setzt eigene Rechte/,
    ],
    [
      "eigene Rechte am Job mit dem Schluessel in Anfuehrungszeichen",
      CI,
      (t) =>
        einmal(
          t,
          "  secret-scan:\n    runs-on: ubuntu-latest\n",
          "  secret-scan:\n    'permissions': write-all\n    runs-on: ubuntu-latest\n"
        ),
      /Job secret-scan setzt eigene Rechte/,
    ],
    [
      "ci.yml: Action per Etikett",
      CI,
      (t) => alle(t, CHECKOUT, "actions/checkout@v7"),
      /ci\.yml: Action 'actions\/checkout@v7' ist nicht per Commit-Kennung/,
    ],
    [
      "ci.yml: Geheimnis-Suche von einem beweglichen Zweig",
      CI,
      (t) => einmal(t, GITLEAKS, "gitleaks/gitleaks-action@master"),
      /ci\.yml: Action 'gitleaks\/gitleaks-action@master' ist nicht per Commit-Kennung/,
    ],
    [
      "release.yml (Schreibrechte): Action per Etikett",
      RELEASE,
      (t) => einmal(t, CHECKOUT, "actions/checkout@v7"),
      /release\.yml: Action 'actions\/checkout@v7' ist nicht per Commit-Kennung/,
    ],
    [
      "dependabot-automerge.yml (Schreibrechte): Action per Etikett",
      AUTOMERGE,
      (t) => einmal(t, METADATEN, "dependabot/fetch-metadata@v3"),
      /dependabot-automerge\.yml: Action 'dependabot\/fetch-metadata@v3' ist nicht per Commit-Kennung/,
    ],
    [
      "ueberall flacher Checkout — der Job mit den Vergleichs-Waechtern bekommt keine Historie",
      CI,
      (t) => alle(t, "          fetch-depth: 0\n", "          fetch-depth: 1\n"),
      /Job `pruefungen` braucht die Historie, checkt aber flach aus/,
    ],
    /* Der Schritt behaelt seinen Wortlaut — und laeuft nicht, oder anders. */
    [
      "die Server-Tests laufen nie (if: false am Schritt)",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - run: npm test\n        if: false\n"),
      /Job test-backend: der Schritt 'npm test' traegt 'if' \['false'\] — er koennte still entfallen/,
    ],
    [
      "dieselbe Bedingung als erste Zeile des Schritts",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - if: false\n        run: npm test\n"),
      /Job test-backend: der Schritt 'npm test' traegt 'if' \['false'\]/,
    ],
    [
      "dieselbe Bedingung mit dem Schluessel in Anfuehrungszeichen",
      CI,
      (t) => einmal(t, "      - run: npm test\n", '      - run: npm test\n        "if": false\n'),
      /Job test-backend: der Schritt 'npm test' traegt 'if' \['false'\]/,
    ],
    [
      "die Browser-Durchlaeufe laufen nur noch bei einem Push (Bedingung am Schritt)",
      CI,
      (t) =>
        einmal(
          t,
          "      - run: npm run test:e2e\n",
          "      - run: npm run test:e2e\n        if: github.event_name == 'push'\n"
        ),
      /Job test-e2e: der Schritt 'npm run test:e2e' traegt 'if' \["github\.event_name == 'push'"\]/,
    ],
    [
      "die Geheimnis-Suche laeuft nie (Bedingung an einer Action)",
      CI,
      (t) => einmal(t, `      - uses: ${GITLEAKS}\n`, `      - uses: ${GITLEAKS}\n        if: false\n`),
      /Job secret-scan: der Schritt 'uses: gitleaks\/gitleaks-action' traegt 'if' \['false'\]/,
    ],
    [
      "ein Waechter-Schritt laeuft nie (if: false im Job pruefungen)",
      CI,
      (t) =>
        einmal(
          t,
          "      - run: bash scripts/selbstpruefung-waechter.sh\n",
          "      - run: bash scripts/selbstpruefung-waechter.sh\n        if: false\n"
        ),
      /Job pruefungen: der Schritt 'bash scripts\/selbstpruefung-waechter\.sh' traegt 'if' \['false'\]/,
    ],
    [
      "die Server-Tests laufen in einer Shell, die nichts ausfuehrt",
      CI,
      (t) => einmal(t, "      - run: npm test\n", '      - run: npm test\n        shell: "true {0}"\n'),
      /Job test-backend: der Schritt 'npm test' traegt 'shell'/,
    ],
    [
      "die Server-Tests laufen in einem anderen Ordner",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - run: npm test\n        working-directory: scripts\n"),
      /Job test-backend: der Schritt 'npm test' traegt 'working-directory' \['scripts'\] — derselbe Wortlaut liefe/,
    ],
    [
      "der festgelegte Ordner eines Schritts ist ein anderer",
      CI,
      (t) =>
        einmal(
          t,
          "      - run: sh scripts/pruefe-zeitzuender.sh . --nur backend\n        working-directory: .\n",
          "      - run: sh scripts/pruefe-zeitzuender.sh . --nur backend\n        working-directory: ..\n"
        ),
      /der Schritt 'sh scripts\/pruefe-zeitzuender\.sh \. --nur backend' traegt 'working-directory' \['\.\.'\] statt \['\.'\]/,
    ],
    [
      "die Server-Tests bekommen eine Umgebung, die die Shell umlenkt",
      CI,
      (t) =>
        einmal(
          t,
          "      - run: npm test\n",
          "      - run: npm test\n        env:\n          BASH_ENV: scripts/ende.sh\n"
        ),
      /Job test-backend: der Schritt 'npm test' traegt 'env' \['BASH_ENV: scripts\/ende\.sh'\]/,
    ],
    [
      "die Geheimnis-Suche bekommt eine zusaetzliche Umgebungsvariable",
      CI,
      (t) =>
        einmal(
          t,
          "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n",
          "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          GITLEAKS_CONFIG: leer.toml\n"
        ),
      /der Schritt 'uses: gitleaks\/gitleaks-action' traegt 'env' .* statt \['GITHUB_TOKEN: /,
    ],
    [
      "alle Schritte eines Jobs laufen in einer Shell, die nichts ausfuehrt (defaults am Job)",
      CI,
      (t) =>
        einmal(
          t,
          "  test-frontend:\n    runs-on: ubuntu-latest\n",
          '  test-frontend:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        shell: "true {0}"\n'
        ),
      /Job test-frontend traegt 'defaults' \['run:', 'shell: "true \{0\}"'\] statt None/,
    ],
    [
      "der Server-Job laeuft in einem anderen Ordner (defaults am Job)",
      CI,
      (t) => einmal(t, "        working-directory: functions\n", "        working-directory: scripts\n"),
      /Job test-backend traegt 'defaults' \['run:', 'working-directory: scripts'\] statt \['run:', 'working-directory: functions'\]/,
    ],
    [
      "ein Job setzt eine Umgebung, die jedes npm-Skript ins Leere laufen laesst",
      CI,
      (t) =>
        einmal(
          t,
          "  test-frontend:\n    runs-on: ubuntu-latest\n",
          "  test-frontend:\n    runs-on: ubuntu-latest\n    env:\n      npm_config_script_shell: /usr/bin/true\n"
        ),
      /Job test-frontend setzt die Umgebung \['npm_config_script_shell: \/usr\/bin\/true'\] statt None/,
    ],
    [
      "dieselbe Umgebung ganz oben in der Datei — sie gilt fuer jeden Job",
      CI,
      (t) => einmal(t, "\njobs:\n", "\nenv:\n  npm_config_script_shell: /usr/bin/true\n\njobs:\n"),
      /ci\.yml: env\/defaults auf oberster Ebene/,
    ],
    [
      "eine Shell fuer alle Jobs ganz oben in der Datei, Schluessel in Anfuehrungszeichen",
      CI,
      (t) => einmal(t, "\njobs:\n", '\n"defaults":\n  run:\n    shell: "true {0}"\n\njobs:\n'),
      /ci\.yml: env\/defaults auf oberster Ebene/,
    ],
    [
      "die Schritte eines Jobs sind anders eingerueckt — eine Bedingung darin waere nicht lesbar",
      CI,
      (t) =>
        einmal(
          t,
          `      - uses: ${GITLEAKS}\n        env:\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n`,
          `      -   uses: ${GITLEAKS}\n          if: false\n          env:\n            GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n`
        ),
      /Job secret-scan steht nicht in der ueblichen Schreibweise — der Vertrag kann seine Schluessel nicht lesen/,
    ],
    [
      "der Wortlaut der Server-Tests steht nur noch als Umgebungswert eines anderen Schritts da",
      CI,
      (t) => einmal(t, "      - run: npm test\n", "      - run: echo ok\n        env:\n          run: npm test\n"),
      /Job test-backend: 'npm test' steht im Job, aber nicht als Befehl eines eigenen Schritts/,
    ],
    [
      "der Wortlaut der Browser-Durchlaeufe steht nur noch als Textzeile in einem mehrzeiligen Befehl",
      CI,
      (t) =>
        einmal(
          t,
          "      - run: npm run test:e2e\n",
          "      - run: |\n          cat <<'ENDE'\n          run: npm run test:e2e\n          ENDE\n"
        ),
      /Job test-e2e: 'npm run test:e2e' steht im Job, aber nicht als Befehl eines eigenen Schritts/,
    ],
    [
      "die Geheimnis-Suche steht nur noch als Eingabewert eines anderen Schritts da",
      CI,
      (t) =>
        einmal(
          t,
          `      - uses: ${GITLEAKS}\n        env:\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n`,
          `      - run: echo ok\n        env:\n          uses: ${GITLEAKS}\n`
        ),
      /Job secret-scan: 'uses: gitleaks\/gitleaks-action' steht im Job, aber nicht als Befehl eines eigenen Schritts/,
    ],
  ];

  test.each(FAELLE)("%s", (_was, datei, umbau, meldung) => {
    aendern(datei, umbau);
    summenNachtragen();
    const r = waechter();
    /* Messmittel-Probe: Die Summe ist nachgetragen. Sonst waere der Fall schon
       wegen der Pruefsumme rot und belegte die inhaltliche Regel nicht. */
    expect(r.ausgabe).not.toMatch(ABWEICHUNG);
    expect(r.ausgabe).toMatch(meldung);
    expect(r.code).toBe(1);
  });

  /* OPS-2026-10-04-27: Der Vertrag haelt je Pflicht-Job die GANZE Schrittfolge
     fest, nicht nur die Pflichtbefehle. Ein Schritt, der dazukommt, laeuft im
     selben Job vor oder zwischen den Pruefungen — und kann die Arbeitskopie
     erst im Lauf umbauen: `package.json` und alle Pflichtbefehle lauten dann
     weiter wie festgelegt, und geprueft wird trotzdem nichts mehr. */
  const SCHRITT_FAELLE = [
    [
      "ein eingefuegter Schritt ueberschreibt das npm-Skript der Server-Tests erst im Lauf",
      (t) =>
        einmal(
          t,
          "      - run: npm test\n",
          '      - run: npm pkg set scripts.test="echo ok"\n      - run: npm test\n'
        ),
      /Job test-backend enthaelt einen Schritt, den der Vertrag nicht kennt: 'run: npm pkg set scripts\.test="echo ok"'/,
    ],
    [
      "ein eingefuegter Schritt mit Namen baut die Tests der Website um",
      (t) =>
        einmal(
          t,
          "      - run: npm run test:frontend\n",
          "      - name: Vorbereitung\n        run: rm -rf public/__tests__\n      - run: npm run test:frontend\n"
        ),
      /Job test-frontend enthaelt einen Schritt, den der Vertrag nicht kennt: 'name: Vorbereitung \| run: rm -rf public\/__tests__'/,
    ],
    [
      "die Installation bekommt einen zweiten Befehl angehaengt",
      (t) =>
        einmal(
          t,
          "      - run: npm ci\n      - run: npm run test:e2e\n",
          "      - run: npm ci && rm -rf e2e\n      - run: npm run test:e2e\n"
        ),
      /Job test-e2e enthaelt einen Schritt, den der Vertrag nicht kennt: 'run: npm ci && rm -rf e2e'/,
    ],
    [
      "die Installation bekommt eine eigene Shell, die vorher etwas anderes ausfuehrt",
      (t) =>
        einmal(
          t,
          "      - run: npm ci\n      - run: npm run lint:frontend\n",
          '      - run: npm ci\n        shell: sh -c "rm -rf public/__tests__; sh {0}"\n      - run: npm run lint:frontend\n'
        ),
      /Job test-frontend enthaelt einen Schritt, den der Vertrag nicht kennt: 'run: npm ci \| shell: sh -c/,
    ],
    [
      "das Auschecken holt einen anderen Stand",
      (t) =>
        einmal(
          t,
          `  test-frontend:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${CHECKOUT}\n`,
          `  test-frontend:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${CHECKOUT}\n        with:\n          ref: main\n`
        ),
      /Job test-frontend enthaelt einen Schritt, den der Vertrag nicht kennt: 'uses: actions\/checkout \| with: ref: main'/,
    ],
    [
      "ein mehrzeiliger Befehl der Versions-Ermittlung bekommt eine Zeile dazu",
      (t) =>
        einmal(
          t,
          '          echo "version=$VERSION" >> "$GITHUB_OUTPUT"\n',
          '          echo "version=$VERSION" >> "$GITHUB_OUTPUT"\n          rm -rf e2e\n'
        ),
      /Job playwright-version enthaelt einen Schritt, den der Vertrag nicht kennt: 'id: lesen \| run: \|/,
    ],
    [
      "ein Waechter-Schritt im Job der Pruefungen wird durch einen anderen Befehl ersetzt",
      (t) =>
        einmal(
          t,
          "      - run: python3 scripts/pruefe-mitzieher.py\n",
          "      - run: python3 scripts/pruefe-mitzieher.py || true\n"
        ),
      /Job pruefungen enthaelt einen Schritt, den der Vertrag nicht kennt: 'run: python3 scripts\/pruefe-mitzieher\.py \|\| true'/,
    ],
    [
      "zwei Schritte tauschen den Platz: die Installation laeuft erst nach den Browser-Durchlaeufen",
      (t) =>
        einmal(
          t,
          "      - run: npm ci\n      - run: npm run test:e2e\n",
          "      - run: npm run test:e2e\n      - run: npm ci\n"
        ),
      /Job test-e2e: die Schritte stehen in anderer Reihenfolge oder Anzahl als im Vertrag/,
    ],
    [
      "ein bekannter Schritt steht doppelt da",
      (t) =>
        einmal(
          t,
          "      - run: npm ci\n      - run: npm run test:e2e\n",
          "      - run: npm ci\n      - run: npm ci\n      - run: npm run test:e2e\n"
        ),
      /Job test-e2e: die Schritte stehen in anderer Reihenfolge oder Anzahl als im Vertrag/,
    ],
  ];

  test.each(SCHRITT_FAELLE)("Schrittfolge: %s", (_was, umbau, meldung) => {
    aendern(CI, umbau);
    summenNachtragen();
    const r = waechter();
    expect(r.ausgabe).not.toMatch(ABWEICHUNG);
    expect(r.ausgabe).toMatch(meldung);
    expect(r.code).toBe(1);
  });

  test("Schrittfolge: `--vertrag-schritte` nennt genau die festgelegte Folge", () => {
    /* Der Erfolgsweg der Messung: Was der Waechter aus der unveraenderten
       Datei liest, ist Wort fuer Wort das, was im Vertrag steht — sonst waere
       jeder Fall oben aus dem falschen Grund rot. */
    const ausgabe = waechter(nachbau, "--vertrag-schritte").ausgabe;
    const quelltext = fs.readFileSync(path.join(nachbau, WAECHTER), "utf8");
    expect(ausgabe).toMatch(/^SCHRITTFOLGE_CI = \{\n {4}"test-backend": \[\n/);
    expect(ausgabe.split("\n").length).toBeGreaterThan(40);
    expect(quelltext).toContain(ausgabe);
  });

  test("deploy.sh verlangt einen Pflicht-Check weniger: die beiden Listen laufen auseinander", () => {
    aendern(DEPLOY, (t) =>
      einmal(
        t,
        'PFLICHT="test-backend test-frontend test-e2e secret-scan playwright-version pruefungen"',
        'PFLICHT="test-backend test-frontend test-e2e playwright-version pruefungen"'
      )
    );
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/deploy\.sh verlangt die Pflicht-Checks .* beide Listen muessen gleich sein/);
  });

  test("deploy.sh nennt gar keine Pflicht-Checks mehr", () => {
    aendern(DEPLOY, (t) => einmal(t, '    PFLICHT="test-backend', '    PFLICHTEN="test-backend'));
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/deploy\.sh nennt keine Liste PFLICHT/);
  });
});

describe("Vertrag der npm-Skripte — was hinter einem Pflicht-Schritt steht", () => {
  /* Der Schritt in ci.yml bleibt in jedem dieser Faelle wortgleich; an ci.yml
     aendert sich nichts, keine Pruefsumme schlaegt an. Gemessen am 04.10.2026:
     Vor dieser Festlegung blieb jeder Waechter und jeder Test gruen. */
  const json = (umbau) => (t) => {
    const daten = JSON.parse(t);
    umbau(daten);
    return `${JSON.stringify(daten, null, 2)}\n`;
  };

  const FAELLE = [
    [
      "die Browser-Modul-Tests sind nur noch ein echo",
      PAKET,
      json((d) => (d.scripts["test:frontend"] = "echo ok")),
      /^.*package\.json: npm-Skript 'test:frontend' lautet 'echo ok' statt 'vitest run'/m,
    ],
    [
      "die Browser-Durchlaeufe sind nur noch ein echo",
      PAKET,
      json((d) => (d.scripts["test:e2e"] = "echo ok")),
      /package\.json: npm-Skript 'test:e2e' lautet 'echo ok' statt 'playwright test'/,
    ],
    [
      "die Server-Tests sind nur noch ein echo",
      PAKET_SERVER,
      json((d) => (d.scripts.test = "echo ok")),
      /functions\/package\.json: npm-Skript 'test' lautet 'echo ok' statt 'jest --forceExit --detectOpenHandles'/,
    ],
    [
      "die Server-Tests laufen mit einem Filter, der nichts trifft",
      PAKET_SERVER,
      json((d) => (d.scripts.test += " --passWithNoTests --testPathPattern=nichts")),
      /functions\/package\.json: npm-Skript 'test' lautet/,
    ],
    [
      "der Server-Lint darf scheitern",
      PAKET_SERVER,
      json((d) => (d.scripts.lint += " || true")),
      /functions\/package\.json: npm-Skript 'lint' lautet 'eslint --max-warnings=0 src\/ \|\| true'/,
    ],
    [
      "die Formatpruefung des Servers schreibt, statt zu pruefen",
      PAKET_SERVER,
      json((d) => (d.scripts["format:check"] = "prettier --write src/")),
      /functions\/package\.json: npm-Skript 'format:check' lautet/,
    ],
    [
      "der Lint der Website sieht nur noch eine Datei an",
      PAKET,
      json((d) => (d.scripts["lint:frontend"] = "eslint --max-warnings=0 public/app.js")),
      /package\.json: npm-Skript 'lint:frontend' lautet/,
    ],
    [
      "die Formatpruefung der Website laesst die Tests aus",
      PAKET,
      json((d) => (d.scripts["format:frontend:check"] = "prettier --check public/js/ public/app.js")),
      /package\.json: npm-Skript 'format:frontend:check' lautet/,
    ],
    [
      "ein Skript hinter einem Pflicht-Schritt ist geloescht",
      PAKET,
      json((d) => delete d.scripts["test:e2e"]),
      /package\.json: npm-Skript 'test:e2e' lautet None statt 'playwright test'/,
    ],
    [
      "der Sammelbefehl fuer den Lint laesst den Server aus (ihn ruft der Ersatzlauf der Auslieferung)",
      PAKET,
      json((d) => (d.scripts.lint = "npm run lint:frontend")),
      /package\.json: npm-Skript 'lint' lautet 'npm run lint:frontend' statt/,
    ],
    [
      "der Sammelbefehl fuer die Tests laesst den Server aus",
      PAKET,
      json((d) => (d.scripts.test = "npm run test:frontend")),
      /package\.json: npm-Skript 'test' lautet/,
    ],
    [
      "der Weiterreicher an die Server-Tests ist nur noch ein echo",
      PAKET,
      json((d) => (d.scripts["test:backend"] = "echo ok")),
      /package\.json: npm-Skript 'test:backend' lautet 'echo ok'/,
    ],
    [
      "ein Skript, das npm ungefragt VOR den Server-Tests ausfuehrt",
      PAKET_SERVER,
      json((d) => (d.scripts.pretest = "rm -rf src/__tests__")),
      /functions\/package\.json: npm-Skript 'pretest' — npm fuehrt es ungefragt mit 'test' aus/,
    ],
    [
      "ein Skript, das npm ungefragt NACH den Browser-Durchlaeufen ausfuehrt",
      PAKET,
      json((d) => (d.scripts["posttest:e2e"] = "exit 0")),
      /package\.json: npm-Skript 'posttest:e2e' — npm fuehrt es ungefragt mit 'test:e2e' aus/,
    ],
    [
      "Jest nimmt per Einstellung alle Testdateien heraus, und das gilt als bestanden",
      PAKET_SERVER,
      json((d) => {
        d.jest.testPathIgnorePatterns.push("/src/__tests__/");
        d.jest.passWithNoTests = true;
      }),
      /functions\/package\.json: die Jest-Einstellung lautet .*passWithNoTests/,
    ],
    [
      "Jest fuehrt per Einstellung nur noch eine Testdatei aus",
      PAKET_SERVER,
      json((d) => (d.jest.testMatch = ["**/doku-drift.test.js"])),
      /functions\/package\.json: die Jest-Einstellung lautet .*testMatch/,
    ],
    [
      "Jest nimmt eine einzelne Testdatei heraus",
      PAKET_SERVER,
      json((d) => d.jest.testPathIgnorePatterns.push("/deploy-verhalten")),
      /functions\/package\.json: die Jest-Einstellung lautet/,
    ],
    [
      "Jest verliert den Riegel gegen die echte Datenbank (Vorbereitungsdatei ausgetragen)",
      PAKET_SERVER,
      json((d) => delete d.jest.setupFilesAfterEnv),
      /functions\/package\.json: die Jest-Einstellung lautet/,
    ],
    [
      "die Jest-Einstellung steht nicht mehr in package.json",
      PAKET_SERVER,
      json((d) => delete d.jest),
      /functions\/package\.json: die Jest-Einstellung lautet None statt/,
    ],
    [
      "package.json ist kein gueltiges JSON mehr",
      PAKET,
      (t) => t.replace(/\}\s*$/, ""),
      /^.*package\.json ist nicht lesbar oder nennt keine npm-Skripte/m,
    ],
    [
      "package.json nennt gar keine Skripte mehr",
      PAKET_SERVER,
      json((d) => delete d.scripts),
      /functions\/package\.json ist nicht lesbar oder nennt keine npm-Skripte/,
    ],
  ];

  test.each(FAELLE)("%s", (_was, datei, umbau, meldung) => {
    aendern(datei, umbau);
    const r = waechter();
    expect(r.ausgabe).toMatch(meldung);
    /* Kein anderer Teil des Vertrags schlaegt an: Rot wird es wegen dieser Regel. */
    expect(r.ausgabe).not.toMatch(ABWEICHUNG);
    expect(r.code).toBe(1);
  });

  test("Messmittel-Probe: eine neu geschriebene, inhaltlich gleiche package.json besteht", () => {
    /* Die Faelle oben schreiben die Datei neu. Laege es an der Schreibweise
       statt am Inhalt, waeren sie aus dem falschen Grund rot. */
    aendern(PAKET, (t) => `${JSON.stringify(JSON.parse(t), null, 4)}\n`);
    aendern(PAKET_SERVER, (t) => `${JSON.stringify(JSON.parse(t), null, 4)}\n`);
    const r = waechter();
    expect(r.ausgabe).not.toMatch(/FEHLT/);
    expect(r.code).toBe(0);
  });

  test("ein weiteres Skript und eine angehobene Paketversion bleiben frei", () => {
    /* So sehen Updates von Dependabot aus, und so ein neues Hilfsskript. */
    aendern(
      PAKET,
      json((d) => {
        d.scripts["test:frontend:ui"] = "vitest --ui";
        d.devDependencies.vitest = "^99.0.0";
      })
    );
    expect(waechter().code).toBe(0);
  });

  test("eine geloeschte package.json faellt auf", () => {
    fs.rmSync(path.join(nachbau, PAKET_SERVER));
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/functions\/package\.json fehlt/);
  });

  test("ein Pflichtbefehl mit npm braucht seine Festlegung: fehlt sie im Waechter, haelt er an", () => {
    /* Sonst kaeme mit einem neuen `npm run …` in ci.yml wieder ein Schritt
       dazu, dessen Inhalt niemand festhaelt. */
    aendern(WAECHTER, (t) => einmal(t, '        "test:e2e": "playwright test",\n', ""));
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(
      /Job test-e2e ruft das npm-Skript 'test:e2e' aus package\.json auf — was es tut, ist nicht festgelegt/
    );
  });

  test("der Server-Job meint die package.json unter functions/, nicht die der Wurzel", () => {
    /* `npm test` steht in beiden Dateien. Fuer den Job test-backend zaehlt die
       Festlegung dort, wo er laeuft. */
    aendern(WAECHTER, (t) => einmal(t, '        "test": "jest --forceExit --detectOpenHandles",\n', ""));
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/Job test-backend ruft das npm-Skript 'test' aus functions\/package\.json auf/);
  });
});

describe("Vertrag der Einstellungsdateien — nichts stellt ein Pruefwerkzeug nebenher um", () => {
  const FREMD = [
    ["vitest.config.ts", "sie hat Vorrang vor vitest.config.js"],
    ["vite.config.js", "Vitest liest sie, wenn es sie gibt"],
    ["vitest.workspace.js", "sie ersetzt die Auswahl der Testdateien"],
    ["playwright.config.ts", "sie hat Vorrang vor playwright.config.js"],
    ["eslint.config.js", "sie hat Vorrang vor eslint.config.mjs"],
    [".npmrc", "script-shell laesst jedes npm-Skript ins Leere laufen"],
    ["functions/.npmrc", "dasselbe fuer die Skripte des Servers"],
    ["functions/jest.config.js", "eine zweite Jest-Einstellung"],
    ["functions/eslint.config.mjs", "eine zweite Lint-Einstellung fuer den Server"],
    ["functions/.prettierignore", "die Formatpruefung des Servers liesse Ordner aus"],
  ];

  test.each(FREMD)("%s (%s): der Waechter haelt an", (datei) => {
    fs.writeFileSync(path.join(nachbau, datei), "");
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toContain(`Vertrag ${datei} ist nicht vorgesehen`);
  });

  test("Messmittel-Probe: eine Datei mit anderem Namen stoert nicht", () => {
    fs.writeFileSync(path.join(nachbau, "notiz.txt"), "");
    fs.writeFileSync(path.join(nachbau, "functions", "notiz.txt"), "");
    expect(waechter().code).toBe(0);
  });

  test.each([VITEST, PLAYWRIGHT, ESLINT, ESLINT_SERVER, PRETTIER_AUSNAHMEN, JEST_VORBEREITUNG])(
    "eine geloeschte Einstellungsdatei faellt auf: %s",
    (datei) => {
      fs.rmSync(path.join(nachbau, datei));
      const r = waechter();
      expect(r.code).toBe(1);
      expect(r.ausgabe).toContain(`Vertrag ${datei} fehlt`);
    }
  );

  test("selbst ein geaenderter Kommentar zaehlt: bei diesen Dateien ist keine Zeile frei", () => {
    aendern(VITEST, (t) => `// Ein neuer Kommentar.\n${t}`);
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toContain("vitest.config.js weicht vom festgeschriebenen Stand ab");
  });
});

describe("Vertrag: keine eingecheckte Datei ist von .gitignore erfasst", () => {
  /* Prettier laesst aus, was .gitignore nennt. Ein Eintrag dort naehme die
     Dateien aus der Formatpruefung, ohne dass sich Skript oder Einstellung aendern. */
  test("ein Eintrag fuer einen eingecheckten Ordner: der Waechter haelt an", () => {
    alsGitRepository();
    fs.writeFileSync(path.join(nachbau, ".gitignore"), "scripts/\n");
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/Vertrag \.gitignore erfasst \d+ eingecheckte Datei\(en\), zuerst scripts\//);
  });

  test("auch eine neue .gitignore in einem Unterordner zaehlt", () => {
    alsGitRepository();
    fs.writeFileSync(path.join(nachbau, "functions", ".gitignore"), "package.json\n");
    const r = waechter();
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(
      /Vertrag \.gitignore erfasst 1 eingecheckte Datei\(en\), zuerst functions\/package\.json/
    );
  });

  test("ein Eintrag fuer etwas, das nicht eingecheckt ist, stoert nicht", () => {
    alsGitRepository();
    fs.writeFileSync(path.join(nachbau, ".gitignore"), "node_modules/\ncoverage/\n");
    const r = waechter();
    expect(r.ausgabe).toMatch(/keine eingecheckte Datei ist von \.gitignore erfasst/);
    expect(r.code).toBe(0);
  });
});
