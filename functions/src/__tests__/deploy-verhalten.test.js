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
  /* BEFUND 31.08.2026 (Runde 5): Zwei Ursachen machten diese Datei in der
     Pipeline rot — beide hier unsichtbar, weil lokal weder das eine noch das
     andere zutrifft.
     (1) Beim Push auf main hat das Quell-Repo `main` ausgecheckt; der Klon
         uebernimmt den aktiven Zweig, und `git branch -f main` scheitert dann
         mit "cannot force update the branch 'main' used by worktree".
         Deshalb wird im Klon ZUERST ein eigener Zweig ausgecheckt.
     (2) `actions/checkout` holt fuer den Job `test-backend` FLACH (kein
         fetch-depth) — `HEAD~1` gibt es dort nicht. Deshalb legt der Klon
         selbst einen zusaetzlichen Commit an, statt sich auf die Historie des
         Quell-Repos zu verlassen. */
  execSync(
    [
      `git -C "${klon}" checkout -q -B pruefstand`,
      `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "Pruefstand: Vorgaenger"`,
    ].join(" && "),
    { stdio: "pipe" }
  );
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
function deploy(umgebung = {}, ziel = "hosting", ohneGh = false) {
  /* ziel === null: ganz ohne Argument aufrufen — dann greift der Standard
     `hosting,functions` aus deploy.sh:362 (Runde 7, K-13). */
  try {
    /* BEFUND 31.08.2026 (Runde 4): Hier stand "sh". Auf ubuntu-latest — also in
       der Pipeline — ist `sh` gleich `dash`, und deploy.sh nutzt
       `set -o pipefail`, das dash nicht kennt. Gemessen: RC 2, "set: Illegal
       option -o pipefail", vier von acht Tests rot. Lokal faellt es nicht auf,
       weil `sh` auf macOS bash ist.
       Dieselbe Lehre steht im Kopf von selbstpruefung-waechter.sh und ist dort
       mit einem BASH_VERSION-Riegel abgesichert — hier war sie neu entstanden. */
    const argumente = ziel === null ? ["scripts/deploy.sh"] : ["scripts/deploy.sh", ziel];
    const ausgabe = execFileSync("bash", argumente, {
      cwd: klon,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        /* ohneGh: Attrappen-Verzeichnis ohne gh — so laesst sich der Fall
           "Werkzeug fehlt" pruefen, ohne den echten PATH anzutasten. */
        PATH: ohneGh ? ohneGhBin() : `${ATTRAPPEN}:${process.env.PATH}`,
        /* BEFUND 31.08.2026: Ohne diese drei Schalter brach das Skript ab,
           BEVOR es die Cache-Kennung schreibt — an zwei Riegeln, fuer die es
           keine Attrappe gibt. `expect(code).not.toBe(0)` war damit trivial
           wahr, und die Tests belegten nichts.
           Schwerer wiegt: Diese beiden Riegel rufen ECHTE Dienste. Gemessen
           wurden sechs gcloud-Aufrufe gegen das Produktivprojekt je Lauf
           (43 der 47 Sekunden Laufzeit). Und waere ein Riegel ausgebaut, liefe
           das Skript bis live-smoke.sh durch — das POSTet auf
           https://malzi.me/api/enqueue und legte einen ECHTEN Job an.
           Ein Test darf die Produktion nicht anfassen. */
        /* BEFUND 01.09.2026 (Runde 6): Hier stand SKIP_SATZ fest gesetzt —
           damit war der Einstellungssatz-Riegel in JEDEM Test ausgeschaltet
           und von nichts gedeckt. Die Begruendung ("er ruft curl gegen
           malzi.me") traegt nicht: curl laesst sich wie firebase und gh durch
           eine Attrappe ersetzen. Sie liegt jetzt in scripts/test-attrappen/
           und liefert einen gueltigen Satz; ATTRAPPE_STATS steuert sie. */
        ...umgebung,
      },
    });
    return { code: 0, ausgabe };
  } catch (e) {
    return { code: e.status, ausgabe: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

/** Kopiert die zu pruefenden Skripte AUS DEM ARBEITSBAUM in den Klon.
 *
 * BEFUND aus der eigenen Rueckbauprobe (31.08.2026): Das eingespielte Skript
 * gilt im Klon als GEAENDERTE Datei. Der Sauberkeits-Riegel schlaegt dann an,
 * bevor der eigentliche Riegel drankommt — die Tests wurden rot, aber aus dem
 * falschen Grund. Ein Test, der aus dem falschen Grund rot wird, belegt so
 * wenig wie einer, der nie rot wird. Deshalb wird die Datei im Klon committet;
 * dort ist das gefahrlos, der Klon wird nach dem Lauf geloescht. */
function skripteEinspielen() {
  for (const datei of ["scripts/deploy.sh"]) {
    fs.copyFileSync(path.join(WURZEL, datei), path.join(klon, datei));
  }
  /* Drei Riegel rufen eigene Skripte ueber RELATIVEN Pfad — Attrappen im PATH
     greifen dort nicht. Sie werden deshalb im Klon durch Attrappen ersetzt.
     Ohne das blieben sie ungeprueft (die Tests umgehen sie mit SKIP_*), und
     schlimmer: verify-infrastructure.sh ruft echtes gcloud, live-smoke.sh
     POSTet auf malzi.me. Beides hat aus dieser Testdatei heraus nichts zu
     suchen. Steuerung: ATTRAPPE_<NAME>_ROT=1 laesst das jeweilige scheitern. */
  /* BEFUND 31.08.2026 (Runde 5): Hier stand zusaetzlich eine Attrappe fuer
     scripts/warteschlange-pruefen.sh — das ruft deploy.sh nirgends auf. Sie
     suggerierte eine Abdeckung, die es nicht gibt. Der Satz-Riegel nutzt
     stattdessen `curl` gegen malzi.me und ist deshalb per SKIP_SATZ=1 aus. */
  const eigene = {
    "scripts/verify-infrastructure.sh": "INFRA",
    "scripts/live-smoke.sh": "SMOKE",
  };
  /* build-info.mjs ist ein Node-Skript, keine Shell — es braucht eine eigene
     Attrappe. Es erzeugt den Echtheitsbeweis der Auslieferung; scheitert es,
     muss der Deploy anhalten (Befund Runde 6). */
  const bi = path.join(klon, "scripts", "build-info.mjs");
  if (fs.existsSync(bi)) {
    fs.writeFileSync(
      bi,
      'if (process.env.ATTRAPPE_BUILDINFO_ROT === "1") {\n' +
        '  console.error("ATTRAPPE build-info: scheitert (so gewollt)");\n' +
        "  process.exit(1);\n}\n" +
        'import { writeFileSync } from "fs";\n' +
        'writeFileSync("public/build-info.json", JSON.stringify({ attrappe: true, version: process.argv[2] }));\n'
    );
  }
  for (const [datei, name] of Object.entries(eigene)) {
    const ziel = path.join(klon, datei);
    if (!fs.existsSync(path.join(WURZEL, datei))) continue;
    fs.writeFileSync(
      ziel,
      `#!/bin/sh\n# ATTRAPPE (Testlauf) — beruehrt keinen echten Dienst.\n` +
        `if [ "\${ATTRAPPE_${name}_ROT:-0}" = "1" ]; then\n` +
        `  echo "ATTRAPPE ${name}: scheitert (so gewollt)" >&2\n  exit 1\nfi\n` +
        /* Argumente mitschreiben: Ob live-smoke.sh die Buster-Version
           bekommt, haengt am Deploy-Ziel — ohne diese Zeile laesst sich das
           von aussen nicht unterscheiden (Runde 7, K-13). */
        `echo "ATTRAPPE ${name}: ok args=[$*]"\nexit 0\n`
    );
    fs.chmodSync(ziel, 0o755);
  }
  execSync(
    [
      `git -C "${klon}" add -A scripts/`,
      `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
      `git -C "${klon}" branch -f main HEAD`,
      `git -C "${klon}" fetch -q origin main`,
      `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
    ].join(" && "),
    { stdio: "pipe" }
  );
}

/** Ein Attrappen-Verzeichnis OHNE gh — fuer den Fall "Werkzeug fehlt". */
let ohneGhVerzeichnis;
function ohneGhBin() {
  if (!ohneGhVerzeichnis) {
    ohneGhVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-ohne-gh-"));
    /* Die Attrappen uebernehmen, die echten Systemwerkzeuge verlinken — nur
       `gh` fehlt. Ein blosses /usr/bin im PATH genuegt nicht: gh liegt dort
       auf manchen Rechnern. */
    for (const w of fs.readdirSync(ATTRAPPEN)) {
      if (w === "gh") continue;
      fs.copyFileSync(path.join(ATTRAPPEN, w), path.join(ohneGhVerzeichnis, w));
      fs.chmodSync(path.join(ohneGhVerzeichnis, w), 0o755);
    }
    for (const w of [
      "git",
      "node",
      "npx",
      "python3",
      "sed",
      "grep",
      "awk",
      "date",
      "cat",
      "rm",
      "cp",
      "mv",
      "printf",
      "sort",
      "head",
      "tail",
      "wc",
      "mktemp",
      "dirname",
      "basename",
      "tr",
      "find",
      "xargs",
      "curl",
      "sh",
      "bash",
      "env",
      "chmod",
      "ls",
      "test",
    ]) {
      try {
        const echt = execSync(`command -v ${w}`, { encoding: "utf8", shell: "/bin/bash" }).trim();
        if (echt) fs.symlinkSync(echt, path.join(ohneGhVerzeichnis, w));
      } catch {
        /* Werkzeug gibt es hier nicht — dann braucht es der Lauf auch nicht. */
      }
    }
  }
  return ohneGhVerzeichnis;
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

  /* BEFUND 31.08.2026 (Runde 4, F-3): Diese vier Abbrueche erreichte KEIN
     Test — sie liegen vor oder hinter dem, was die uebrigen Faelle abdecken,
     oder werden von den Notschaltern uebersprungen. Alle vier `exit 1`
     gleichzeitig durch `:` ersetzt: 51 von 51 Tests blieben gruen. */

  test("HEAD ungleich origin/main haelt die Auslieferung an", () => {
    /* Der eigentliche Riegel gegen ungeprueffte Staende. Die uebrigen Tests
       koennen ihn nicht messen, weil der Klon per Konstruktion HEAD ==
       origin/main setzt. Hier wird origin/main gezielt verschoben. */
    /* `deploy.sh` holt origin/main per `git fetch` aus dem Klon selbst — eine
       direkt gesetzte Referenz waere danach wieder ueberschrieben. Verschoben
       wird deshalb der LOKALE Zweig main, den der fetch dann holt. */
    execSync(`git -C "${klon}" branch -f main HEAD~1 && git -C "${klon}" fetch -q origin main`, {
      stdio: "pipe",
    });
    try {
      const r = deploy();
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/origin\/main/);
    } finally {
      execSync(`git -C "${klon}" branch -f main HEAD && git -C "${klon}" fetch -q origin main`, {
        stdio: "pipe",
      });
    }
  });

  /* GRENZE, gemessen (31.08.2026): Dieser Fall laesst sich mit dieser Bauart
     nicht vollstaendig absichern. Entfernt man sein `exit`, faengt der naechste
     Riegel den Lauf trotzdem auf — der Test bliebe gruen, obwohl der Riegel
     entwaffnet ist. Was er belegt, ist die richtige Meldung an der richtigen
     Stelle; was er NICHT belegt, ist der Abbruch selbst. Ein vollstaendiger
     Nachweis braeuchte einen Lauf, in dem alle nachfolgenden Riegel gruen sind
     — dann liefert das Skript aus, und der Test waere gefaehrlich. */
  test("nicht abrufbares CI-Ergebnis wird als solches gemeldet", () => {
    /* Nicht "leere Antwort", sondern "gh liefert gar nichts" — das ist der
       Fall, den der Riegel meint. */
    const r = deploy({ ATTRAPPE_GH_ROT: "1" });
    expect(r.code).not.toBe(0);
    /* BEFUND aus der eigenen Rueckbauprobe: "bricht ab" genuegt nicht — wird
       DIESER Riegel entwaffnet, faengt der naechste den Lauf auf, und der Test
       bliebe gruen. Geprueft wird deshalb die Meldung DIESES Riegels. */
    /* Muster eng fassen: "nicht abrufbar" steht auch in einer harmlosen
       Hinweiszeile ueber den PR-Kopf. Nur die Meldung DIESES Riegels zaehlt. */
    expect(r.ausgabe).toMatch(/CI-Ergebnis f[uü]r .* nicht abrufbar/i);
  });

  test("unlesbare Cache-Kennung haelt an, statt auf 01 zurueckzufallen", () => {
    /* Faellt das Skript hier blind auf ...01 zurueck, vergibt es beim zweiten
       Deploy des Tages eine bereits benutzte Nummer — Browser behalten dann
       alte Dateien. */
    const seite = path.join(klon, "public", "index.html");
    const inhalt = fs.readFileSync(seite, "utf8");
    /* Die Seite muss im COMMIT stehen, nicht nur im Arbeitsbaum: Sonst schlaegt
       der Sauberkeits-Riegel an, bevor der Buster-Riegel drankommt. */
    const einspielen = () =>
      execSync(
        [
          `git -C "${klon}" add -A public`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
          `git -C "${klon}" branch -f main HEAD`,
          `git -C "${klon}" fetch -q origin main`,
        ].join(" && "),
        { stdio: "pipe" }
      );
    fs.writeFileSync(seite, inhalt.replace(/styles\.css\?v=\d+/, "styles.css"));
    einspielen();
    try {
      const r = deploy();
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/Cache-Buster|nicht lesbar/i);
    } finally {
      /* BEFUND 31.08.2026 (Rueckbauprobe, ausgefuehrt): Die Reparatur stand
         HINTER den Erwartungen und ohne `finally`. Wird der Riegel in
         `deploy.sh` entwaffnet, schlaegt `expect` fehl — und die Reparatur lief
         dann NIE. Der Klon behielt eine index.html ohne Kennung im Commit, und
         der naechste Fall ("Live-Probe ... Kennung BLEIBT") wurde ebenfalls rot,
         obwohl an SEINEM Riegel nichts fehlte. Gemessen: Sabotage am
         Buster-Riegel machte ZWEI Tests rot statt einen.
         Ein Test, der aus dem falschen Grund rot wird, belegt so wenig wie
         einer, der nie rot wird — deshalb `finally`.
         Zurueckgeschrieben wird aus der gemerkten Fassung statt aus `HEAD~1`:
         Das haelt den Fall unabhaengig von der Historie, die bei einer flachen
         Auscheckung (`actions/checkout` ohne fetch-depth) gar nicht da ist. */
      fs.writeFileSync(seite, inhalt);
      einspielen();
    }
  });

  /* BEFUND 31.08.2026 (Runde 5): Der dokumentierte Sicherheitsbefund — die
     Check-Lage von main durch die des PR zu ERSETZEN statt nur Ausstehendes
     nachzutragen — war nur durch ein Textmuster geschuetzt. Zwei geaenderte
     Klammern, und ein Deploy lief mit rotem test-e2e durch.

     Eine frueher hier notierte Behauptung, das sei "mit dieser Bauart nicht
     pruefbar", war falsch: Die beiden gh-Abfragen tragen ihre SHA in der URL
     und lassen sich daran unterscheiden. Der zweite Kopf entsteht ueber
     `git commit-tree` mit DEMSELBEN Baum — genau die Voraussetzung, unter der
     die Abkuerzung ueberhaupt greift. */
  test("rotes Ergebnis auf main wird nicht durch ein gruenes PR-Ergebnis verdraengt", () => {
    const betreff = execSync(`git -C "${klon}" log -1 --format=%s`, { encoding: "utf8" }).trim();
    /* Die Abkuerzung greift nur bei einer PR-Nummer im Betreff. */
    execSync(
      [
        `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend -m "test: Probe (#235)"`,
        /* Dieselbe Kette wie in skripteEinspielen: main mitfuehren, dann
           holen. `deploy.sh` ruft selbst `git fetch origin main` — ein blosses
           update-ref waere danach wieder ueberschrieben. */
        `git -C "${klon}" branch -f main HEAD`,
        `git -C "${klon}" fetch -q origin main`,
        `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
      ].join(" && "),
      { stdio: "pipe" }
    );
    /* Zweiter Commit, gleicher Baum: der "PR-Kopf". */
    const baum = execSync(`git -C "${klon}" rev-parse "HEAD^{tree}"`, { encoding: "utf8" }).trim();
    const prKopf = execSync(`git -C "${klon}" -c user.email=t@t -c user.name=t commit-tree ${baum} -m "PR-Kopf"`, {
      encoding: "utf8",
    }).trim();
    try {
      const r = deploy({
        ATTRAPPE_PR_KOPF: prKopf,
        /* main: e2e ROT, zwei stehen noch aus — der Fall, in dem die
           Abkuerzung greifen darf. */
        ATTRAPPE_CHECKS:
          "test-backend=success\ntest-frontend=success\ntest-e2e=failure\nsecret-scan=pending\nplaywright-version=pending\npruefungen=success",
        /* Der PR ist vollstaendig gruen. */
        ATTRAPPE_CHECKS_PR:
          "test-backend=success\ntest-frontend=success\ntest-e2e=success\nsecret-scan=success\nplaywright-version=success\npruefungen=success",
      });
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/test-e2e/);
    } finally {
      execSync(
        [
          /* Kein `branch -f`: Der ausgecheckte Zweig folgt dem --amend von
             selbst, und ein erzwungenes Setzen scheitert an der Arbeitskopie. */
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend -m "${betreff}"`,
          `git -C "${klon}" branch -f main HEAD`,
          `git -C "${klon}" fetch -q origin main`,
          `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
    }
  });

  /* BEFUND 31.08.2026 (Runde 5, H-2): Dieselbe Bauart wie beim PR-Rueckfall.
     `ZEITABHAENGIG="test-backend"` nimmt die zeitabhaengige Suite von der
     Abkuerzung aus — ihr Ergebnis von gestern sagt nichts ueber heute. Wer die
     Liste leert, hebt das lautlos auf; abgesichert war es nur durch ein
     Textmuster. */
  test("test-backend wird nicht durch ein PR-Ergebnis ersetzt", () => {
    const betreff = execSync(`git -C "${klon}" log -1 --format=%s`, { encoding: "utf8" }).trim();
    execSync(
      [
        `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend -m "test: Probe (#235)"`,
        `git -C "${klon}" branch -f main HEAD`,
        `git -C "${klon}" fetch -q origin main`,
        `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
      ].join(" && "),
      { stdio: "pipe" }
    );
    const baum = execSync(`git -C "${klon}" rev-parse "HEAD^{tree}"`, { encoding: "utf8" }).trim();
    const prKopf = execSync(`git -C "${klon}" -c user.email=t@t -c user.name=t commit-tree ${baum} -m "PR-Kopf"`, {
      encoding: "utf8",
    }).trim();
    try {
      const r = deploy({
        ATTRAPPE_PR_KOPF: prKopf,
        /* Auf main steht NUR test-backend aus — genau die Suite, die nicht
           uebernommen werden darf. Alles andere ist gruen. */
        ATTRAPPE_CHECKS:
          "test-backend=pending\ntest-frontend=success\ntest-e2e=success\nsecret-scan=success\nplaywright-version=success\npruefungen=success",
        ATTRAPPE_CHECKS_PR:
          "test-backend=success\ntest-frontend=success\ntest-e2e=success\nsecret-scan=success\nplaywright-version=success\npruefungen=success",
      });
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/test-backend/);
    } finally {
      execSync(
        [
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend -m "${betreff}"`,
          `git -C "${klon}" branch -f main HEAD`,
          `git -C "${klon}" fetch -q origin main`,
          `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
    }
  });

  /* BEFUND 31.08.2026 (Runde 5): Diese vier Abbrueche erreichte kein Test.
     Sie sind jetzt geprueft — aber mit einer Grenze, die gemessen wurde und
     benannt gehoert:

     Die Tests belegen, dass der jeweilige Fall die RICHTIGE MELDUNG erzeugt
     und der Lauf endet. Sie belegen NICHT, dass genau dieses `exit` den Lauf
     beendet. Entfernt man es einzeln, bricht der naechste Riegel ab — die
     Kette ist fail-closed gebaut, und ein einzelner Ausfall fuehrt in keinem
     gemessenen Fall zu einer Auslieferung (nachgestellt: gh-Riegel entwaffnet
     und gh aus dem PATH genommen -> Abbruch am naechsten Riegel, RC 1).

     Ein Test, der ein einzelnes `exit` nachweist, muesste alle nachfolgenden
     Riegel gleichzeitig gruen stellen — dann liefe das Skript aus, und der
     Test waere gefaehrlicher als die Luecke, die er schliesst. */

  test("fehlendes gh haelt an, statt die CI-Freigabe zu ueberspringen", () => {
    /* Ein PATH ohne gh — der haeufige Fall auf einem frischen Rechner. */
    const r = deploy({}, "hosting", true);
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/gh nicht verf/i);
  });

  test("nicht ermittelbare CLI-Version haelt an", () => {
    const r = deploy({ ATTRAPPE_FIREBASE_VERSION: "" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/nicht ermittelbar/i);
  });

  test("jeder der beiden Trockenlaeufe haelt fuer sich an", () => {
    const nurFirestore = deploy({ ATTRAPPE_DRYRUN_FIRESTORE_ROT: "1" });
    expect(nurFirestore.code).not.toBe(0);
    expect(nurFirestore.ausgabe).toMatch(/Firestore/i);
    const nurZiel = deploy({ ATTRAPPE_DRYRUN_ZIEL_ROT: "1" });
    expect(nurZiel.code).not.toBe(0);
  });

  test("erschoepfte Cache-Nummer haelt an, statt zu ueberlaufen", () => {
    const seite = path.join(klon, "public", "index.html");
    const inhalt = fs.readFileSync(seite, "utf8");
    /* BEFUND 01.09.2026 (Runde 6, ZEITZUENDER): Hier stand
       `new Date().toISOString()` — das ist UTC. `deploy.sh:424` bildet den Tag
       aber mit `date +"%Y%m%d"`, also in ORTSZEIT. In MESZ laufen beide
       zwischen 00:00 und 02:00 auseinander: Die Kennung im Test traegt dann
       den Vortag, die Ueberlaufbedingung greift nicht, und der Test wird rot.
       Gemessen um 00:29 CEST: 1 von 18 rot; mit TZ=UTC gruen.
       Zwei Stunden lang jede Nacht — und in der CI (UTC) unsichtbar.
       Deshalb kommt der Tag jetzt aus DERSELBEN Quelle wie im Skript. */
    const heute = execSync('date +"%Y%m%d"', { encoding: "utf8" }).trim();
    fs.writeFileSync(seite, inhalt.replace(/styles\.css\?v=\d+/, `styles.css?v=${heute}99`));
    execSync(
      [
        `git -C "${klon}" add -A public`,
        `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
        `git -C "${klon}" branch -f main HEAD`,
        `git -C "${klon}" fetch -q origin main`,
        `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
      ].join(" && "),
      { stdio: "pipe" }
    );
    try {
      const r = deploy();
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/99|ueberl|überl/i);
    } finally {
      fs.writeFileSync(seite, inhalt);
      execSync(
        [
          `git -C "${klon}" add -A public`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
          `git -C "${klon}" branch -f main HEAD`,
          `git -C "${klon}" fetch -q origin main`,
          `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
    }
  });

  test("abgebrochener Pflicht-Lauf gilt nicht als bestanden", () => {
    /* BEFUND aus Runde 1, nie belegt: "cancelled-Fall nicht abgefangen".
       Gemessen ist er es — `grep -qx "=success"` laesst nur exakt success
       durch. Der Test haelt das fest, damit es so bleibt. */
    const r = deploy({
      ATTRAPPE_CHECKS:
        "test-backend=success\ntest-frontend=success\ntest-e2e=cancelled\nsecret-scan=success\nplaywright-version=success\npruefungen=success",
    });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/test-e2e.*cancelled|cancelled/i);
  });

  test("fehlender Einstellungssatz haelt die Auslieferung an", () => {
    /* Ohne gueltigen Satz scheitert nach dem Deploy JEDE Analyse. */
    const r = deploy({ ATTRAPPE_STATS: '{"hourlyLimit":0}' });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Einstellungssatz/i);
  });

  /* BEFUND 01.09.2026 (Runde 7, L-14): Der Test darueber deckt den Fall
     "Satz fehlt". Der Fall "nicht gemessen" — Netz weg, Zeitgrenze — endete
     bis dahin in derselben Meldung, obwohl ueber die Produktion nichts
     bekannt war. Und der Rat darin (SKIP_SATZ=1) haette den Riegel entwaffnet,
     um ein Netzproblem zu umgehen. */
  test("nicht erreichbare Stats melden eine gescheiterte Messung, keinen fehlenden Satz", () => {
    const r = deploy({ ATTRAPPE_CURL_ROT: "1" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/nicht erreichbar/i);
    expect(r.ausgabe).toMatch(/gescheiterte Messung/i);
    /* Und ausdruecklich NICHT die Aussage ueber die Produktion. */
    expect(r.ausgabe).not.toMatch(/kein gueltiger Einstellungssatz erkennbar/i);
  });

  test("gescheiterte build-info haelt an, statt ohne Echtheitsbeweis zu liefern", () => {
    /* build-info.json ist der Echtheitsbeweis der Auslieferung — ohne ihn
       kann niemand nachrechnen, ob das Ausgelieferte dem Quelltext
       entspricht. */
    const r = deploy({ ATTRAPPE_BUILDINFO_ROT: "1" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/build-info/i);
  });

  test("rote Infrastruktur-Pruefung haelt die Auslieferung an", () => {
    const r = deploy({ ATTRAPPE_INFRA_ROT: "1" });
    expect(r.code).not.toBe(0);
  });

  test("zu alte Firebase-CLI haelt die Auslieferung an", () => {
    const r = deploy({ ATTRAPPE_FIREBASE_VERSION: "9.0.0" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/CLI|Version/i);
  });
});

/* ── Die Aufraeumfalle ──────────────────────────────────────────────────
 *
 * Hier hatten am 31.08. zwei Pruefer GEGENSAETZLICHE Ergebnisse: Der eine
 * hielt die Marke `HOCHGELADEN=1` fuer richtig platziert, der andere fuer eine
 * Stufe zu frueh. Beide hatten ausgefuehrt — nur unterschiedliche Faelle. Der
 * entscheidende (Hosting-Upload scheitert) kam bei einem gar nicht vor.
 *
 * Deshalb stehen hier alle drei Faelle nebeneinander. Sie unterscheiden sich
 * nur darin, WANN es schiefgeht.
 * ────────────────────────────────────────────────────────────────────── */
/* ── Der Erfolgsweg ────────────────────────────────────────────────────
 *
 * BEFUND 01.09.2026 (Runde 7): Alle 20 Faelle oben pruefen `code !== 0`. Als
 * eine Reparatur dafuer sorgte, dass das Skript IMMER mit 1 endete — auch bei
 * vollstaendigem Erfolg —, blieben alle 20 gruen, und sechs Riegel liessen
 * sich spurlos ausbauen. Eine Suite, die nur Abbrueche prueft, kann nicht
 * merken, dass gar nichts mehr durchlaeuft.
 *
 * Dieser Fall ist das Gegengewicht: Er verlangt, dass ein Lauf mit lauter
 * gruenen Bedingungen auch WIRKLICH durchlaeuft.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — der Erfolgsweg", () => {
  afterEach(aufraeumen);

  test("mit lauter gruenen Bedingungen laeuft die Auslieferung durch", () => {
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/Deploy abgeschlossen|abgeschlossen/i);
    /* Und der CHANGELOG-Hinweis erscheint, statt still zu verschwinden. */
    expect(r.ausgabe).toMatch(/CHANGELOG|Unver/i);
  });

  /* BEFUND 01.09.2026 (Runde 7, L-13): Die Schlussbilanz listet jeden
     uebersprungenen Riegel — aber nur solche mit SKIP_-Namen. DEPLOY_JA hebt
     die Rueckfrage an den Menschen auf und fehlte darin. */
  test("DEPLOY_JA erscheint in der Schlussbilanz", () => {
    const r = deploy({ DEPLOY_JA: "1" });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/UEBERSPRUNGENE RIEGEL|ÜBERSPRUNGENE RIEGEL/i);
    expect(r.ausgabe).toMatch(/DEPLOY_JA/);
  });

  test("ohne DEPLOY_JA meldet die Bilanz alle Riegel gelaufen", () => {
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/alle Riegel gelaufen/i);
  });
});

/* PROBELAUF (01.09.2026): "Kann man nicht alles durchspielen und vor dem
   letzten Schritt anhalten, statt zu raten?" — genau das tut PROBELAUF=1.
   Der Wert steht und faellt damit, dass er WIRKLICH nichts ausliefert; ein
   Probelauf, der doch etwas anfasst, waere schlimmer als keiner. */
describe("deploy.sh — der Probelauf", () => {
  afterEach(aufraeumen);

  test("laeuft durch und liefert NICHTS aus", () => {
    const r = deploy({ PROBELAUF: "1" });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/PROBELAUF: bis hierher waere alles bereit/);
    /* Die Attrappe meldet jeden Aufruf. Kommt kein `deploy` vor, ist auch
       keines versucht worden. */
    expect(r.ausgabe).not.toMatch(/ATTRAPPE firebase: deploy/);
  });

  test("aber die Riegel und der Trockenlauf laufen wirklich", () => {
    /* Sonst waere der Probelauf ein leeres Versprechen: durchgelaufen, ohne
       etwas geprueft zu haben. */
    const r = deploy({ PROBELAUF: "1" });
    expect(r.ausgabe).toMatch(/Trockenlauf/i);
    expect(r.ausgabe).toMatch(/Einstellungssatz/i);
  });

  test("ein gerissener Riegel haelt auch den Probelauf an", () => {
    const r = deploy({ PROBELAUF: "1", ATTRAPPE_DRYRUN_ROT: "1" });
    expect(r.code).not.toBe(0);
    /* Auf die EIGENE Zeile des Probelaufs pruefen: Die Wendung "nichts wurde
       ausgeliefert" steht auch in der Meldung des Trockenlauf-Riegels — der
       erste Anlauf dieses Tests hat deshalb den falschen Text gemessen. */
    expect(r.ausgabe).not.toMatch(/PROBELAUF: bis hierher waere alles bereit/);
  });

  test("und der Arbeitsbaum bleibt sauber", () => {
    const r = deploy({ PROBELAUF: "1" });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/Arbeitsbaum sauber/i);
    /* Zusaetzlich selbst nachsehen, statt der Meldung zu glauben. */
    const offen = execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" });
    expect(offen.trim()).toBe("");
  });

  test("ohne PROBELAUF wird ausgeliefert — der Schalter ist nicht dauerhaft an", () => {
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/ATTRAPPE firebase: deploy|Deploy abgeschlossen/i);
    expect(r.ausgabe).not.toMatch(/PROBELAUF: bis hierher waere alles bereit/);
  });
});

/* BEFUND 01.09.2026 (Runde 7, K-13): Alle Faelle oben fahren mit Ziel
   `hosting`. Zwei Zweige haengen aber am Ziel — die Cache-Kennung
   (deploy.sh:423) und das Argument fuer den Live-Smoke (deploy.sh:735).
   Ein reiner Functions-Deploy war damit vollstaendig ungeprueft, und der
   haeufigste Aufruf ist der ganz ohne Argument. */
describe("deploy.sh — das Deploy-Ziel", () => {
  afterEach(aufraeumen);

  /** Die Cache-Kennung im Klon, wie sie public/index.html zeigt. */
  function busterImKlon() {
    const html = fs.readFileSync(path.join(klon, "public", "index.html"), "utf8");
    const m = /styles\.css\?v=(\d+)/.exec(html);
    return m ? m[1] : null;
  }

  test("Ziel `functions` laesst die Cache-Kennung unangetastet", () => {
    const vorher = busterImKlon();
    expect(vorher).not.toBeNull();
    const r = deploy({}, "functions");
    expect(r.code).toBe(0);
    expect(busterImKlon()).toBe(vorher);
    expect(r.ausgabe).toMatch(/kein Hosting-Deploy/i);
  });

  test("Ziel `functions` ruft den Live-Smoke OHNE Buster-Version", () => {
    const r = deploy({}, "functions");
    expect(r.code).toBe(0);
    /* Mit Argument waere es `args=[2026…]` — ohne Hosting gibt es keine neue
       Kennung, die der Smoke live zuruecklesen koennte. */
    expect(r.ausgabe).toMatch(/ATTRAPPE SMOKE: ok args=\[\]/);
  });

  test("ohne Argument gilt `hosting,functions` — die Kennung wird gesetzt", () => {
    const vorher = busterImKlon();
    const r = deploy({}, null);
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/Deploy-Ziel: hosting,functions/);
    expect(busterImKlon()).not.toBe(vorher);
    /* Und der Smoke bekommt die neue Kennung mit. */
    expect(r.ausgabe).toMatch(new RegExp(`ATTRAPPE SMOKE: ok args=\\[${busterImKlon()}\\]`));
  });
});

describe("deploy.sh — die Aufraeumfalle", () => {
  afterEach(aufraeumen);

  /** Liest die Cache-Kennung aus public/index.html im Klon. */
  function kennung() {
    const html = fs.readFileSync(path.join(klon, "public", "index.html"), "utf8");
    const t = html.match(/styles\.css\?v=(\d+)/);
    return t ? t[1] : null;
  }

  test("Firestore-Schritt scheitert -> Kennung wird zurueckgenommen", () => {
    const vorher = kennung();
    const r = deploy({ ATTRAPPE_FIRESTORE_ROT: "1" });
    expect(r.code).not.toBe(0);
    expect(kennung()).toBe(vorher);
    const offen = execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" });
    expect(offen.trim()).toBe("");
  });

  test("Live-Probe nach dem Upload rot -> Kennung BLEIBT", () => {
    /* Die Gegenrichtung: Hier IST etwas live. Wer jetzt zurueckbaut, bringt
       den Quelltext aus dem Tritt mit dem, was ausgeliefert wurde. */
    const vorher = kennung();
    const r = deploy({ ATTRAPPE_SMOKE_ROT: "1" });
    expect(r.code).not.toBe(0);
    expect(kennung()).not.toBe(vorher);
    expect(r.ausgabe).toMatch(/NACH dem Hochladen|bleibt/i);
  });

  test("Hosting-Upload scheitert -> Kennung wird zurueckgenommen", () => {
    /* DER FALL, der den Streit entschieden hat: Bis zum 31.08. meldete das
       Skript hier "steht bereits live" und liess 14 Dateien liegen. Live stand
       nichts — Firestore rollt nur Regeln aus. */
    const vorher = kennung();
    const r = deploy({ ATTRAPPE_HOSTING_ROT: "1" });
    expect(r.code).not.toBe(0);
    expect(kennung()).toBe(vorher);
    const offen = execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" });
    expect(offen.trim()).toBe("");
  });
});
