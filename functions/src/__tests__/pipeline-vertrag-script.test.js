/* pipeline-vertrag-script.test.js — faellt es auf, wenn aus der Pipeline etwas verschwindet?
 *
 * Der Zweigschutz und `scripts/deploy.sh` verlangen sechs gruene Pflicht-Checks.
 * Beide sehen nur NAME und ERGEBNIS eines Jobs — nicht, was er getan hat. Ein
 * Job, aus dem der Testlauf gestrichen wurde, bleibt gruen (OPS-2026-10-03-12).
 *
 * `scripts/pruefe-deploy-riegel.py` haelt deshalb fest, wie die Pipeline-Dateien
 * aussehen muessen: alle fuenf Workflows und `dependabot.yml` per Pruefsumme,
 * dazu fuer `ci.yml` je Pflicht-Job die Pruefbefehle, die ihn ausmachen.
 *
 * Diese Tests fuehren den Waechter AUS — gegen einen Nachbau des Repositorys in
 * einem Wegwerf-Ordner (die Skripte, `.github` und die Waechter-Uebersicht, alle
 * aus dem Arbeitsbaum kopiert). Dort wird eine Datei veraendert, und der
 * Waechter muss anhalten. Im Repository selbst wird nichts angefasst.
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

/** Traegt im Nachbau die Pruefsummen nach, wie es bei einer bewussten Aenderung
 *  geschieht: Ausgabe von `--vertrag-summen` in die Liste des Waechters. */
function summenNachtragen() {
  const zeilen = waechter(nachbau, "--vertrag-summen").ausgabe.split("\n").filter(Boolean);
  if (zeilen.length === 0) throw new Error("--vertrag-summen lieferte nichts");
  const pfad = path.join(nachbau, WAECHTER);
  let text = fs.readFileSync(pfad, "utf8");
  for (const zeile of zeilen) {
    const m = zeile.match(/^\s*"([^"]+)": "([0-9a-f]{16})",$/);
    if (!m) throw new Error(`unerwartete Zeile von --vertrag-summen: ${zeile}`);
    const eintrag = new RegExp(`("${m[1].replace(/\./g, "\\.")}": ")[0-9a-f]{16}(",)`);
    if (!eintrag.test(text)) throw new Error(`kein Eintrag fuer ${m[1]} in VERTRAG_SUMMEN`);
    text = text.replace(eintrag, `$1${m[2]}$2`);
  }
  fs.writeFileSync(pfad, text);
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
  });

  test("der Nachbau verhaelt sich wie das Repository (Messmittel-Probe)", () => {
    /* Fehlte im Nachbau eine Datei, die der Waechter braucht, waeren alle
       folgenden Faelle aus dem falschen Grund rot. */
    const r = waechter();
    expect(r.ausgabe).not.toMatch(/FEHLT|NICHT MESSBAR/);
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
    expect(ausgabe).toHaveLength(6);
    for (const zeile of ausgabe) expect(skript).toContain(zeile.trim());
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
