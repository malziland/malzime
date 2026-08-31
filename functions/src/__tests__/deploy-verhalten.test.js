/* deploy-verhalten.test.js — was `scripts/deploy.sh` TUT, nicht was drinsteht.
 *
 * ANLASS (Pruefschleife, 31.08.2026): `scripts/pruefe-deploy-riegel.py` prueft
 * TEXTMUSTER im Skript. Drei Pruefer haben ihn unabhaengig ausgehebelt: `exit 1`
 * durch `:` ersetzt, `echo` stehen gelassen — der Waechter meldete weiter "Alle
 * Riegel vorhanden". Zehn realistische Rueckbauten blieben unbemerkt. Ein
 * Textmuster belegt kein Verhalten.
 *
 * Diese Tests fuehren das Skript in einem Wegwerf-Klon aus, mit Attrappen fuer
 * `firebase` und `gh` (scripts/test-attrappen/). Nichts davon beruehrt einen
 * echten Dienst: Die Attrappen tun nur so und scheitern auf Kommando.
 *
 * Jeder Test prueft ein VERHALTEN. Wer einen Riegel ausbaut, macht ihn rot —
 * unabhaengig davon, wie die Meldung formuliert ist.
 */

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const ATTRAPPEN = path.join(WURZEL, "scripts", "test-attrappen");

let klon;

/* Ein Klon je Testdatei: Das Anlegen dauert, die Faelle sind unabhaengig, und
   jeder Fall raeumt seine Aenderungen selbst wieder weg. */
beforeAll(() => {
  klon = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-deploy-"));
  execSync(`git clone --quiet --local --no-hardlinks "${WURZEL}" "${klon}"`, { stdio: "pipe" });
  /* Der Klon braucht ein origin/main, das AUF HEAD zeigt — sonst schlaegt die
     Stand-Bindung schon an "HEAD != origin/main" an, und jeder Test wuerde
     denselben Riegel messen statt den, um den es geht.
     `deploy.sh` ruft `git fetch origin main` auf; zeigte `origin` auf das
     Original, holte das dessen main und ueberschriebe die Setzung. Deshalb
     zeigt der Klon auf SICH SELBST: ein lokaler Zweig `main` auf HEAD, und
     origin ist das eigene Verzeichnis. */
  execSync(
    [
      `git -C "${klon}" branch -f main HEAD`,
      `git -C "${klon}" remote set-url origin "${klon}"`,
      `git -C "${klon}" fetch -q origin main`,
    ].join(" && "),
    { stdio: "pipe" }
  );
  /* BEFUND aus der eigenen Rueckbauprobe (31.08.2026): `git clone` uebernimmt
     den COMMITTETEN Stand. Eine Aenderung im Arbeitsbaum — genau das, was eine
     Rueckbauprobe macht — kam im Klon nie an, und alle drei Proben blieben
     gruen. Der Test haette nichts gemessen, in neuer Bauart derselbe Fehler
     wie beim Textmuster-Waechter.
     Deshalb wird das Skript, um das es geht, AUS DEM ARBEITSBAUM kopiert. */
  skripteEinspielen();
}, 60000);

afterAll(() => {
  if (klon) fs.rmSync(klon, { recursive: true, force: true });
});

/** Fuehrt deploy.sh im Klon aus und gibt Rueckgabewert und Ausgabe zurueck. */
function deploy(umgebung = {}, ziel = "hosting") {
  try {
    const ausgabe = execFileSync("sh", ["scripts/deploy.sh", ziel], {
      cwd: klon,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${ATTRAPPEN}:${process.env.PATH}`,
        ...umgebung,
      },
    });
    return { code: 0, ausgabe };
  } catch (e) {
    return { code: e.status, ausgabe: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

/** Kopiert die zu pruefenden Skripte AUS DEM ARBEITSBAUM in den Klon. */
function skripteEinspielen() {
  for (const datei of ["scripts/deploy.sh"]) {
    fs.copyFileSync(path.join(WURZEL, datei), path.join(klon, datei));
  }
}

/** Setzt den Klon auf einen sauberen Stand zurueck.
 *
 * BEFUND aus der eigenen Rueckbauprobe: `git checkout -- .` holt die
 * COMMITTETE Fassung zurueck und ueberschreibt damit das eingespielte Skript.
 * Drei Sabotagen blieben deshalb gruen — der Test mass die alte Datei. Nach
 * dem Aufraeumen wird deshalb neu eingespielt. */
function aufraeumen() {
  execSync(`git -C "${klon}" checkout -- . && git -C "${klon}" clean -fdq`, { stdio: "pipe" });
  skripteEinspielen();
}

describe("deploy.sh — Verhalten der Riegel", () => {
  afterEach(aufraeumen);

  test("roter Pflicht-Check haelt die Auslieferung an", () => {
    const r = deploy({ ATTRAPPE_CHECKS: "test-backend=failure\ntest-frontend=success" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/test-backend/);
  });

  test("unsauberer Arbeitsbaum haelt die Auslieferung an", () => {
    fs.appendFileSync(path.join(klon, "public", "index.html"), "\n<!-- Probe -->\n");
    const r = deploy();
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/sauber/i);
  });

  test("gescheiterter Trockenlauf haelt an UND laesst den Baum sauber", () => {
    const r = deploy({ ATTRAPPE_DRYRUN_ROT: "1" });
    expect(r.code).not.toBe(0);
    const offen = execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" });
    expect(offen.trim()).toBe("");
  });
});
