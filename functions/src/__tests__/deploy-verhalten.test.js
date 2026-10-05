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
/* deploy.sh ruft den Waechter `pruefe-auslieferbare-reste.mjs` auf, und der
   braucht minimatch. Der Klon hat keine node_modules; ueber NODE_PATH findet
   der Waechter die Bibliothek trotzdem — in functions/, weil der Pipeline-Job
   dieser Suite nur dort Pakete installiert. */
const MODULE = path.join(WURZEL, "functions", "node_modules");
const { ghSeitenAttrappeAnlegen, lauf, fremdeLaeufe, pflichtLaeufe, PFLICHT } = require("./hilfen/gh-seiten-attrappe");
const { curlFingerabdruckAttrappeAnlegen } = require("./hilfen/curl-fingerabdruck-attrappe");

let klon;
/* Was die "Live-Seite" in diesen Tests ausweist: ein Ordner mit einer
   curl-Attrappe (beantwortet die Abfrage des Fingerabdrucks, sonst nichts) und
   der Fingerabdruck selbst. Er wird einmal aus dem Klon errechnet — so, als
   waere genau dieser Stand zuletzt ausgeliefert worden. */
let fingerabdruckOrdner;
let fingerabdruckLive;

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
  /* Der Stand der "Live-Seite": Der Fingerabdruck, den das echte
     build-info.mjs fuer den Klon errechnet. deploy.sh liest ihn vor einer
     reinen Website-Auslieferung (ARCH-2026-10-03-10, Gegenrichtung). */
  fingerabdruckOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-fingerabdruck-"));
  curlFingerabdruckAttrappeAnlegen(fingerabdruckOrdner);
  fingerabdruckLive = path.join(fingerabdruckOrdner, "live-build-info.json");
  fs.writeFileSync(fingerabdruckLive, fingerabdruckDesKlons());
}, 60000);

afterAll(() => {
  if (klon) fs.rmSync(klon, { recursive: true, force: true });
  if (protokollOrdner) fs.rmSync(protokollOrdner, { recursive: true, force: true });
  if (fingerabdruckOrdner) fs.rmSync(fingerabdruckOrdner, { recursive: true, force: true });
});

/** Der Fingerabdruck des Klons, wie ihn das echte build-info.mjs errechnet —
 *  als Text. Der Arbeitsbaum des Klons bleibt dabei, wie er war. */
function fingerabdruckDesKlons() {
  const datei = path.join(klon, "public", "build-info.json");
  const vorher = fs.readFileSync(datei, "utf8");
  try {
    /* Der Erzeuger holt die Liste des Server-Pakets vom Waechter, und der braucht minimatch. */
    execFileSync("node", ["scripts/build-info-echt.mjs", "2026010101"], {
      cwd: klon,
      stdio: "pipe",
      env: { ...process.env, NODE_PATH: MODULE },
    });
    return fs.readFileSync(datei, "utf8");
  } finally {
    fs.writeFileSync(datei, vorher);
  }
}

/** Fuehrt deploy.sh im Klon aus und gibt Rueckgabewert und Ausgabe zurueck. */
function deploy(umgebung = {}, ziel = "hosting", ohneGh = false) {
  /* ziel === null: ganz ohne Argument aufrufen — dann greift der Standard
     `hosting,functions` aus deploy.sh:362 (Runde 7, K-13). */
  /* PFAD_DAVOR: Ordner mit weiteren Attrappen, die VOR den Standard-Attrappen
     im Suchpfad stehen sollen (etwa eine gh-Attrappe mit Seiten oder eine
     npm-Attrappe). Ein eigener PATH in `umgebung` wuerfe die curl-Attrappe
     fuer den Fingerabdruck mit hinaus. */
  const { PFAD_DAVOR = [], ...weitere } = umgebung;
  /* ohneGh: Attrappen-Verzeichnis ohne gh — so laesst sich der Fall
     "Werkzeug fehlt" pruefen, ohne den echten PATH anzutasten. */
  const standard = ohneGh ? ohneGhBin() : `${ATTRAPPEN}:${process.env.PATH}`;
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
        PATH: [...PFAD_DAVOR, fingerabdruckOrdner, standard].join(":"),
        NODE_PATH: MODULE,
        /* Die curl-Attrappe fuer den Fingerabdruck beantwortet nur diese eine
           Abfrage; alles andere (der Einstellungssatz) geht an die
           Standard-Attrappe weiter. */
        ATTRAPPE_CURL_WEITER: path.join(ATTRAPPEN, "curl"),
        ATTRAPPE_FINGERABDRUCK_LIVE: fingerabdruckLive,
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
        ...weitere,
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
  /* Neben deploy.sh auch der Waechter, den es aufruft, und die Datei mit den
     Ausschlusslisten, die er liest — sonst liefe im Klon deren committete
     Fassung, und eine Rueckbauprobe daran bliebe unbemerkt. */
  for (const datei of ["scripts/deploy.sh", "scripts/pruefe-auslieferbare-reste.mjs", "firebase.json"]) {
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
  /* build-info.mjs erzeugt den Echtheitsbeweis der Auslieferung; scheitert
     es, muss der Deploy anhalten (Befund Runde 6). Im Klon laeuft das ECHTE
     Skript — es liest nur Dateien und git, keinen Dienst —, und zwar hinter
     einer Huelle, die auf Kommando scheitert. Eine Attrappe, die irgendetwas
     in die Datei schreibt, genuegte nicht mehr: deploy.sh vergleicht das
     Server-Paket des neuen Fingerabdrucks mit dem, das die Seite ausweist
     (ARCH-2026-10-03-10, Gegenrichtung). */
  const bi = path.join(klon, "scripts", "build-info.mjs");
  if (fs.existsSync(bi)) {
    fs.copyFileSync(path.join(WURZEL, "scripts", "build-info.mjs"), path.join(klon, "scripts", "build-info-echt.mjs"));
    fs.writeFileSync(
      bi,
      'if (process.env.ATTRAPPE_BUILDINFO_ROT === "1") {\n' +
        '  console.error("ATTRAPPE build-info: scheitert (so gewollt)");\n' +
        "  process.exit(1);\n}\n" +
        'await import("./build-info-echt.mjs");\n' +
        /* Fuer den Fall "der neue Fingerabdruck nennt keine Server-Dateien". */
        'if (process.env.ATTRAPPE_BUILDINFO_OHNE_SERVER === "1") {\n' +
        '  const { readFileSync, writeFileSync } = await import("fs");\n' +
        '  const f = JSON.parse(readFileSync("public/build-info.json", "utf8"));\n' +
        "  delete f.serverPaket;\n" +
        '  writeFileSync("public/build-info.json", JSON.stringify(f, null, 2) + "\\n");\n}\n'
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
      `git -C "${klon}" add -A scripts/ firebase.json`,
      `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
      `git -C "${klon}" branch -f main HEAD`,
      `git -C "${klon}" fetch -q origin main`,
      `git -C "${klon}" update-ref refs/remotes/origin/main HEAD`,
    ].join(" && "),
    { stdio: "pipe" }
  );
}

/** Wie deploy(), schreibt aber jeden Aufruf von firebase, gh und curl mit.
 *
 * Daran laesst sich pruefen, ob etwas hochgeladen wurde — am Aufruf selbst,
 * nicht am Wortlaut einer Meldung. `uploads` sind die Aufrufe von
 * `firebase deploy` ohne `--dry-run`. */
let protokollOrdner;
function deployMitProtokoll(umgebung = {}, ziel = "hosting") {
  if (!protokollOrdner) protokollOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-deploy-protokoll-"));
  /* Ausserhalb des Klons: Im Klon machte die Datei den Arbeitsbaum unsauber. */
  const protokoll = path.join(protokollOrdner, "aufrufe.txt");
  fs.rmSync(protokoll, { force: true });
  const r = deploy({ ...umgebung, ATTRAPPE_PROTOKOLL: protokoll }, ziel);
  const aufrufe = fs.existsSync(protokoll) ? fs.readFileSync(protokoll, "utf8").split("\n").filter(Boolean) : [];
  return {
    ...r,
    aufrufe,
    uploads: aufrufe.filter((zeile) => zeile.startsWith("firebase deploy") && !zeile.includes("--dry-run")),
  };
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

  /* Befunde G-02/H-04 (30.09.2026): Der Herkunftsnachweis des HEIC-Dekoders
     (Workflow libheif-Bau: Nachbau + Kontrollbau) ist kein Pflicht-Check —
     ohne diesen Riegel liess sich ein Stand ausliefern, dessen Dekoder nicht
     als Bau aus dem Rezept belegt ist. Die Attrappe wendet den jq-Ausdruck aus
     deploy.sh mit echtem jq auf API-JSON an (Befund H-17). */
  const libheifLaeufe = (...laeufe) => JSON.stringify({ workflow_runs: laeufe });
  const laufHeif = (created_at, status, conclusion) => ({ created_at, status, conclusion });

  test("roter Herkunftsnachweis des HEIC-Dekoders haelt die Auslieferung an", () => {
    const r = deploy({
      ATTRAPPE_LIBHEIF_LAEUFE: libheifLaeufe(laufHeif("2026-09-30T10:00:00Z", "completed", "failure")),
    });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Herkunftsnachweis des HEIC-Dekoders.*Ist: failure/);
  });

  test("fehlender Lauf des Herkunftsnachweises haelt ebenfalls an", () => {
    const r = deploy({ ATTRAPPE_LIBHEIF_LAEUFE: libheifLaeufe() });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Herkunftsnachweis des HEIC-Dekoders.*Ist: fehlt/);
  });

  test("noch laufender Herkunftsnachweis haelt an, statt zu warten oder durchzuwinken", () => {
    const r = deploy({ ATTRAPPE_LIBHEIF_LAEUFE: libheifLaeufe(laufHeif("2026-09-30T10:00:00Z", "in_progress", null)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Herkunftsnachweis des HEIC-Dekoders.*Ist: laeuft/);
  });

  test("es zaehlt der juengste Lauf: alter gruen, neuer rot -> rot", () => {
    const r = deploy({
      ATTRAPPE_LIBHEIF_LAEUFE: libheifLaeufe(
        laufHeif("2026-09-30T10:00:00Z", "completed", "success"),
        laufHeif("2026-09-30T11:00:00Z", "completed", "failure")
      ),
    });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Ist: failure/);
  });

  /* Befund K-01 (Runde 4): Ist sicherheit-nachts.yml unlesbar, legt GitHub bei
     jedem Push einen roten Lauf ohne Jobs an (Ereignis push, Name = Dateipfad).
     Der darf nicht als frischer Nachtlauf zaehlen — ebenso wenig ein
     abgebrochener Lauf. */
  test("ein Fehllauf einer unlesbaren Workflow-Datei zaehlt nicht als Nachtlauf", () => {
    const r = deploy({
      ATTRAPPE_NACHT_LAEUFE: nacht(
        nachtLauf(10, { event: "push", conclusion: "failure", name: ".github/workflows/sicherheit-nachts.yml" }),
        nachtLauf(40 * 60)
      ),
    });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
  });

  test("ein abgebrochener Lauf zaehlt nicht als Nachtlauf", () => {
    const r = deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(10, { conclusion: "cancelled" }), nachtLauf(40 * 60)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
  });

  test("ein roter, aber gelaufener Nachtlauf haelt den Deploy nicht an", () => {
    expect(deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(10, { conclusion: "failure" })) }).code).toBe(0);
  });

  test("ein Nachtlauf mit der vorigen Fassung von sicherheit-nachts.yml haelt an", () => {
    const vorher = execSync(`git -C "${klon}" rev-parse HEAD`, { encoding: "utf8" }).trim();
    try {
      execSync(
        [
          `printf '\n# Probe\n' >> "${klon}/.github/workflows/sicherheit-nachts.yml"`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q -am "Nachtlauf geaendert"`,
          `git -C "${klon}" branch -f main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
      const r = deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(10, { head_sha: vorher })) });
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/lief nicht mit der Fassung/);
    } finally {
      execSync(`git -C "${klon}" reset -q --hard ${vorher} && git -C "${klon}" branch -f main ${vorher}`, {
        stdio: "pipe",
      });
    }
  });

  /* Befund J-05: Aendert der juengste Commit nur das Rezept, muss genau DIESER
     Commit abgefragt werden — die Attrappe prueft die Abfrage und scheitert
     laut, wenn deploy.sh einen anderen Commit nennt (etwa bei gekuerzter
     Pfadliste). */
  test("ein Commit, der nur das Rezept aendert, wird als Herkunfts-Commit abgefragt", () => {
    const vorher = execSync(`git -C "${klon}" rev-parse HEAD`, { encoding: "utf8" }).trim();
    try {
      execSync(
        [
          `printf '\n# Probe\n' >> "${klon}/scripts/libheif-bauen.sh"`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q -am "nur Rezept"`,
          `git -C "${klon}" branch -f main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
      const r = deploy();
      expect(r.ausgabe).not.toMatch(/ATTRAPPE gh: libheif-Abfrage ohne head_sha/);
      expect(r.ausgabe).toMatch(/Herkunft HEIC-Dekoder: Workflow libheif-Bau gruen fuer [0-9a-f]{40}/);
    } finally {
      execSync(`git -C "${klon}" reset -q --hard ${vorher} && git -C "${klon}" branch -f main ${vorher}`, {
        stdio: "pipe",
      });
    }
  });

  /* Befund H-10: Der dokumentierte Rueckweg (Dekoder entfernen) darf nicht am
     Herkunftsriegel scheitern — ohne Dekoder gibt es nichts nachzuweisen. */
  test("ohne Dekoder-Ordner (Rueckweg) gibt es nur einen Hinweis, keinen Abbruch", () => {
    const vorher = execSync(`git -C "${klon}" rev-parse HEAD`, { encoding: "utf8" }).trim();
    try {
      execSync(
        [
          `git -C "${klon}" rm -r -q public/lib/libheif`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q -m "Rueckweg: Dekoder entfernt"`,
          `git -C "${klon}" branch -f main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
      /* Selbst ein roter Nachbau darf hier nicht mehr zaehlen. */
      const r = deploy({
        ATTRAPPE_LIBHEIF_LAEUFE: libheifLaeufe(laufHeif("2026-09-30T10:00:00Z", "completed", "failure")),
      });
      expect(r.ausgabe).toMatch(/public\/lib\/libheif fehlt \(Dekoder entfernt\)/);
      expect(r.ausgabe).not.toMatch(/Herkunftsnachweis des HEIC-Dekoders.*Ist:/);
    } finally {
      execSync(`git -C "${klon}" reset -q --hard ${vorher} && git -C "${klon}" branch -f main ${vorher}`, {
        stdio: "pipe",
      });
    }
  });

  /* Befund H-03: Ein ausbleibender Nachtlauf alarmiert niemanden — der
     Deploy prueft deshalb das ALTER des juengsten Laufs auf main. */
  const nachtLauf = (minutenAlt, weiteres = {}) => ({
    created_at: new Date(Date.now() - minutenAlt * 60000).toISOString(),
    event: "schedule",
    conclusion: "success",
    head_sha: "HEAD",
    head_repository: { full_name: "malziland/malzime" },
    ...weiteres,
  });
  const nacht = (...laeufe) => JSON.stringify({ workflow_runs: laeufe });

  test("zu alter Nachtlauf haelt die Auslieferung an", () => {
    const r = deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(30 * 60)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Nachtlauf .*aelter als 1560 min/);
  });

  /* Befund J-08: knapp unter und knapp ueber der Grenze (zwei Tests, weil ein
     durchlaufender Deploy den Testklon veraendert). */
  test("Nachtlauf 25 h 50 min alt: geht durch", () => {
    expect(deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(1550)) }).code).toBe(0);
  });

  test("Nachtlauf 26 h 10 min alt: haelt an", () => {
    const r = deploy({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(1570)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
  });

  /* Befund J-03: ein frischer Lauf aus einem Fork (Zweig "main") zaehlt nicht. */
  test("ein frischer Fork-Lauf verdeckt keinen fehlenden eigenen Nachtlauf", () => {
    const r = deploy({
      ATTRAPPE_NACHT_LAEUFE: nacht(
        nachtLauf(10, { event: "pull_request", head_repository: { full_name: "jemand/fork" } }),
        nachtLauf(40 * 60)
      ),
    });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
  });

  /* OPS-2026-10-03-12: Der Fall darueber traegt ZWEI Merkmale eines fremden
     Laufs — das Ereignis `pull_request` und das fremde Repository. Den Filter
     auf die Herkunft allein misst er nicht: Den Lauf verwirft schon der Filter
     auf das Ereignis. Ein Lauf NACH ZEITPLAN in einer fremden Kopie sieht bis
     auf das Repository genauso aus wie der eigene (`branch=main` liefert auch
     Laeufe aus Kopien, deren Zweig "main" heisst). */
  const fremderZeitplanLauf = (minutenAlt) =>
    nachtLauf(minutenAlt, { head_repository: { full_name: "jemand/malzime" } });

  test("ein frischer Lauf nach Zeitplan aus einer fremden Kopie zaehlt nicht als Nachtlauf", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(fremderZeitplanLauf(10)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Nachtlauf .*fehlt/);
    expect(r.uploads).toEqual([]);
  });

  test("... und er verdeckt auch keinen zu alten eigenen", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(fremderZeitplanLauf(10), nachtLauf(40 * 60)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
    expect(r.uploads).toEqual([]);
  });

  test("fehlender Nachtlauf haelt die Auslieferung an", () => {
    const r = deploy({ ATTRAPPE_NACHT_LAEUFE: JSON.stringify({ workflow_runs: [] }) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Nachtlauf .*fehlt/);
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
    /* Der Herkunftsriegel hat wirklich gefragt, nicht nur geschwiegen. */
    expect(r.ausgabe).toMatch(/Herkunft HEIC-Dekoder: Workflow libheif-Bau gruen/);
    expect(r.ausgabe).toMatch(
      /Nachtlauf: juengster gelaufener Lauf auf main vor \d+ min \(Grenze 1560 min\), mit der ausgelieferten Fassung/
    );
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
    const r = deployMitProtokoll({ PROBELAUF: "1" });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/PROBELAUF: bis hierher waere alles bereit/);
    /* Gemessen am Aufruf selbst: Die Attrappe schreibt jeden Aufruf von
       `firebase` mit. Ohne `--dry-run` darf keiner dabei sein — weder die
       Firestore-Regeln noch Website oder Server. */
    expect(r.uploads).toEqual([]);
    /* Messmittel-Probe: Das Protokoll schreibt wirklich mit — die beiden
       Trockenlaeufe stehen darin. Ein leeres Protokoll hiesse sonst auch
       "nichts hochgeladen". */
    expect(r.aufrufe.filter((zeile) => zeile.startsWith("firebase deploy") && zeile.includes("--dry-run"))).toEqual([
      "firebase deploy --only firestore:malzime-eu --dry-run",
      "firebase deploy --only hosting --dry-run",
    ]);
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
    const r = deployMitProtokoll();
    expect(r.code).toBe(0);
    /* Am Aufruf gemessen, wie im ersten Fall dieses Blocks. */
    expect(r.uploads).toEqual(["firebase deploy --only firestore:malzime-eu", "firebase deploy --only hosting"]);
    expect(r.ausgabe).toMatch(/Deploy abgeschlossen/);
    expect(r.ausgabe).not.toMatch(/PROBELAUF: bis hierher waere alles bereit/);
  });
});

/* BEFUND 01.09.2026 (Runde 7, K-13): Alle Faelle oben fahren mit Ziel
   `hosting`. Der haeufigste Aufruf ist aber der ganz ohne Argument, und am
   Ziel haengt, was ueberhaupt hinausgeht.

   ARCH-2026-10-03-10: Ein Ziel OHNE Website liefert das Skript nicht aus. Der
   Fingerabdruck des Server-Codes (public/build-info.json) geht mit der Website
   hinaus; ein reiner Server-Deploy liesse die Seite weiter den vorigen
   Server-Stand ausweisen. */
describe("deploy.sh — das Deploy-Ziel", () => {
  afterEach(aufraeumen);

  /** Die Cache-Kennung im Klon, wie sie public/index.html zeigt. */
  function busterImKlon() {
    const html = fs.readFileSync(path.join(klon, "public", "index.html"), "utf8");
    const m = /styles\.css\?v=(\d+)/.exec(html);
    return m ? m[1] : null;
  }

  test.each(["functions", "functions:enqueue", "firestore", "hosting:malzime"])(
    "Ziel `%s` enthaelt die Website nicht: abgelehnt, nichts gefragt, nichts ausgeliefert",
    (ziel) => {
      const vorher = busterImKlon();
      expect(vorher).not.toBeNull();
      const r = deployMitProtokoll({}, ziel);
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(/Deploy-Ziel ".+" enthaelt die Website nicht/);
      /* Ein Aufruffehler wird abgelehnt, BEVOR etwas laeuft: kein Aufruf von
         firebase, gh oder curl — also weder Trockenlauf noch Upload —, keine
         Infrastruktur-Pruefung, keine Live-Probe. */
      expect(r.aufrufe).toEqual([]);
      expect(r.ausgabe).not.toMatch(/ATTRAPPE (INFRA|SMOKE)/);
      /* Und der Arbeitsbaum bleibt, wie er war. */
      expect(busterImKlon()).toBe(vorher);
      expect(execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" }).trim()).toBe("");
    }
  );

  test("ohne Argument gilt `hosting,functions` — die Kennung wird gesetzt", () => {
    const vorher = busterImKlon();
    const r = deployMitProtokoll({}, null);
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/Deploy-Ziel: hosting,functions/);
    expect(r.uploads).toContain("firebase deploy --only hosting,functions");
    expect(busterImKlon()).not.toBe(vorher);
    /* Und der Smoke bekommt die neue Kennung mit. */
    expect(r.ausgabe).toMatch(new RegExp(`ATTRAPPE SMOKE: ok args=\\[${busterImKlon()}\\]`));
  });

  test("die Reihenfolge im Ziel ist gleich: `functions,hosting` laeuft durch", () => {
    /* Der Riegel fragt, OB die Website dabei ist — nicht, an welcher Stelle
       sie steht. Sonst schluege er auch bei einem vollstaendigen Ziel zu. */
    const vorher = busterImKlon();
    const r = deployMitProtokoll({}, "functions,hosting");
    expect(r.code).toBe(0);
    expect(r.uploads).toContain("firebase deploy --only functions,hosting");
    expect(busterImKlon()).not.toBe(vorher);
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

/* ── Was der Sauberkeits-Riegel nicht sieht (OPS-2026-10-03-09) ──────────
 *
 * `git status` zeigt keine Dateien, die .gitignore nennt. Die Firebase-CLI
 * richtet sich nicht nach .gitignore: Eine Datei `functions/.env` setzt sie als
 * Einstellung an jede Function, und was `functions.ignore` in firebase.json
 * nicht ausschliesst, packt sie ins Server-Paket.
 *
 * Geprueft wird am Aufruf-Protokoll der Attrappen: Haelt ein Riegel an, darf
 * `firebase deploy` gar nicht erst aufgerufen worden sein — auch nicht als
 * Trockenlauf, denn schon der laedt die Umgebungsdateien.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — Umgebungsdateien und Reste, die git nicht zeigt", () => {
  /* `aufraeumen()` entfernt nur, was git als unversioniert kennt (git clean
     ohne -x). Die Dateien dieser Faelle sind zum Teil IGNORIERT — sie blieben
     im Klon liegen und hielten jeden folgenden Fall an. Deshalb merkt sich
     jeder Fall, was er angelegt hat. */
  const gestreut = [];
  function streue(rel, inhalt) {
    const ziel = path.join(klon, "functions", rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    gestreut.push(ziel);
  }
  afterEach(() => {
    aufraeumen();
    for (const ziel of gestreut.splice(0)) fs.rmSync(ziel, { force: true });
  });

  const firebaseDeploy = (aufrufe) => aufrufe.filter((zeile) => zeile.startsWith("firebase deploy"));

  test("functions/.env haelt die Auslieferung an — obwohl git sie nicht zeigt", () => {
    streue(".env", "MISTRAL_MOCK=1\n");
    /* Messmittel-Probe: Fuer git ist der Baum sauber. Sonst haette der
       Sauberkeits-Riegel angehalten, und dieser Fall waere aus dem falschen
       Grund gruen. */
    expect(execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" }).trim()).toBe("");
    const r = deployMitProtokoll();
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Umgebungsdatei im Server-Ordner: functions\/\.env\b/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test.each([".env.malzime", ".env.default", ".env.production", ".env.example"])(
    "functions/%s haelt die Auslieferung an",
    (name) => {
      streue(name, "NTFY_STUMM=1\n");
      const r = deployMitProtokoll();
      expect(r.code).not.toBe(0);
      /* Die Meldung DIESES Riegels: Diese Namen kennt .gitignore nicht, der
         Sauberkeits-Riegel hielte also auch an — nur spaeter und ohne zu
         sagen, worum es geht. */
      expect(r.ausgabe).toMatch(new RegExp(`Umgebungsdatei im Server-Ordner: functions/${name.replace(/\./g, "\\.")}`));
      expect(firebaseDeploy(r.aufrufe)).toEqual([]);
    }
  );

  test("auch bei SKIP_STAND=1 haelt functions/.env an", () => {
    /* Der Notschalter hebt die Bindung an die CI-Freigabe auf, nicht diesen
       Riegel. SKIP_TESTS=1, damit ein entwaffneter Riegel nicht erst an den
       Ersatzlaeufen (npm) haengen bleibt. */
    streue(".env", "MISTRAL_MOCK=1\n");
    const r = deployMitProtokoll({ SKIP_STAND: "1", SKIP_TESTS: "1" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Umgebungsdatei im Server-Ordner/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("functions/.env.local und ihre Vorlage halten nicht an — der Riegel schlaegt nicht immer zu", () => {
    /* .env.local liest die Firebase-CLI nur im Emulator; die Vorlage ist
       eingecheckt. */
    streue(".env.local", "QUEUE_LOCAL=1\n");
    expect(fs.existsSync(path.join(klon, "functions", ".env.local.example"))).toBe(true);
    expect(fs.existsSync(path.join(klon, "functions", ".env.example"))).toBe(false);
    const r = deployMitProtokoll();
    expect(r.code).toBe(0);
    expect(r.uploads).toContain("firebase deploy --only hosting");
    /* Und der Riegel hat wirklich gemessen, nicht nur geschwiegen. */
    expect(r.ausgabe).toMatch(/Server-Paket: \d{2,} Dateien, jede steht im Repository; keine Umgebungsdatei/);
  });

  test("eine ignorierte Datei, die ins Server-Paket ginge, haelt an", () => {
    /* `loadtest-results-*.json` steht in .gitignore, aber nicht in
       functions.ignore: git zeigt die Datei nicht, die CLI naehme sie mit. */
    streue("loadtest-results-2026.json", "{}\n");
    expect(execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" }).trim()).toBe("");
    const r = deployMitProtokoll();
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/functions\/loadtest-results-2026\.json/);
    expect(r.ausgabe).toMatch(/gingen ins Server-Paket/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("bei SKIP_STAND=1 haelt ein Arbeitsordner unter functions/ an, den git nicht kennt", () => {
    /* Ohne Stand-Bindung prueft niemand den Arbeitsbaum — der Ordner ginge
       sonst ungesehen ins Paket. */
    streue("w1/arbeit.js", "// Probe\n");
    const r = deployMitProtokoll({ SKIP_STAND: "1", SKIP_TESTS: "1" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/functions\/w1\/arbeit\.js/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("laesst sich das Paket nicht messen, haelt die Auslieferung an, statt durchzuwinken", () => {
    /* Ohne minimatch kann der Waechter die Muster nicht auswerten und meldet
       "nicht messbar" (Rueckgabewert 2). */
    const r = deployMitProtokoll({ NODE_PATH: "" });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/NICHT MESSBAR: minimatch/);
    expect(r.ausgabe).toMatch(/liess sich nicht messen/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });
});

/* ── Der Versionsriegel der Firebase-CLI (OPS-2026-10-03-16) ─────────────
 *
 * "Eine nicht ermittelbare Version bricht ab" galt nur fuer eine LEERE
 * Ausgabe. Jede andere Zeile — eine Warnung, eine Fehlermeldung — ging durch,
 * weil Text im Versionsvergleich hinter Ziffern sortiert.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — die Version der Firebase-CLI muss eine Versionsnummer sein", () => {
  afterEach(aufraeumen);

  test.each(["kaputt", "Error: could not load", "v15.1.0", "15.1", "15.1.0-rc.1", "15.1.0.4"])(
    '`firebase --version` liefert "%s": haelt an, ohne Upload',
    (ausgabe) => {
      const r = deployMitProtokoll({ ATTRAPPE_FIREBASE_VERSION: ausgabe });
      expect(r.code).not.toBe(0);
      /* Die Meldung DIESES Riegels, mit dem, was die CLI wirklich sagte. */
      expect(r.ausgabe).toMatch(/lieferte keine\s+Versionsnummer aus drei Zahlen/);
      expect(r.ausgabe).toContain(`sondern: ${ausgabe}`);
      /* Das Protokoll haelt keinen Fremdtext als Version fest. */
      expect(r.ausgabe).not.toMatch(/Firebase-CLI: .* \(Untergrenze/);
      expect(r.aufrufe.filter((zeile) => zeile.startsWith("firebase deploy"))).toEqual([]);
    }
  );

  test.each(["15.1.0", "15.32.0", "16.0.3"])("Version %s geht durch und steht im Protokoll", (version) => {
    /* Gegenrichtung: Der Riegel haelt nicht jede Ausgabe an. */
    const r = deployMitProtokoll({ ATTRAPPE_FIREBASE_VERSION: version });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toContain(`Firebase-CLI: ${version} (Untergrenze 15.1.0)`);
    expect(r.uploads).toContain("firebase deploy --only hosting");
  });
});

/* ── Viele Pruefergebnisse an einem Commit (OPS-2026-10-03-18) ───────────
 *
 * Die Schnittstelle liefert die Laeufe eines Commits seitenweise, ohne Angabe
 * 30 je Seite. Jeder Nachtlauf haengt vier weitere an; bleibt main einige Tage
 * unveraendert, fielen die sechs Pflicht-Checks aus der ersten Seite — die
 * Auslieferung desselben Standes (etwa beim Rueckweg) brach dann mit
 * "Pflicht-Check fehlt" ab.
 *
 * Die uebrigen Faelle dieser Datei bekommen die Pruefergebnisse von einer
 * Attrappe, die keine Seiten kennt. Hier steht davor eine, die die Antwort
 * schneidet wie die echte Schnittstelle.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — viele Pruefergebnisse an einem Commit", () => {
  afterEach(aufraeumen);

  let seitenOrdner;
  afterAll(() => {
    if (seitenOrdner) fs.rmSync(seitenOrdner, { recursive: true, force: true });
  });

  /** deploy.sh mit einer gh-Attrappe, die `laeufe` seitenweise liefert. */
  function deployMitLaeufen(laeufe) {
    if (!seitenOrdner) {
      seitenOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-gh-seiten-"));
      ghSeitenAttrappeAnlegen(seitenOrdner);
    }
    const laeufeDatei = path.join(seitenOrdner, "laeufe.json");
    const abfragenDatei = path.join(seitenOrdner, "abfragen.txt");
    fs.writeFileSync(laeufeDatei, JSON.stringify(laeufe));
    fs.rmSync(abfragenDatei, { force: true });
    const r = deployMitProtokoll({
      PFAD_DAVOR: [seitenOrdner],
      ATTRAPPE_WEITER: path.join(ATTRAPPEN, "gh"),
      ATTRAPPE_CHECK_LAEUFE: laeufeDatei,
      ATTRAPPE_CHECK_AUFRUFE: abfragenDatei,
    });
    const abfragen = fs.existsSync(abfragenDatei)
      ? fs.readFileSync(abfragenDatei, "utf8").split("\n").filter(Boolean)
      : [];
    return { ...r, abfragen };
  }

  test("31 Pruefergebnisse, alle sechs Pflicht-Checks gruen: die Auslieferung laeuft durch", () => {
    /* 25 Laeufe aus Nachtlaeufen, dahinter die sechs Pflicht-Checks — der
       letzte steht an Stelle 31 und laege bei 30 je Seite auf der zweiten. */
    const laeufe = [...fremdeLaeufe(25), ...pflichtLaeufe()];
    expect(laeufe).toHaveLength(31);
    const r = deployMitLaeufen(laeufe);
    expect(r.ausgabe).not.toMatch(/Pflicht-Check .* nicht grün/);
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/alle sechs Pflicht-Checks grün/);
    expect(r.uploads).toContain("firebase deploy --only hosting");
    /* Messmittel-Probe: Die Abfrage ging wirklich an die Seiten-Attrappe. */
    expect(r.abfragen.length).toBeGreaterThan(0);
    expect(r.abfragen[0]).toMatch(/\/check-runs\?per_page=100&page=1$/);
  });

  test("ein roter Pflicht-Check an Stelle 31 haelt die Auslieferung an", () => {
    /* Die Gegenrichtung: Mehr Seiten duerfen nicht heissen, dass ein rotes
       Ergebnis untergeht. */
    const laeufe = [...fremdeLaeufe(25), ...pflichtLaeufe()];
    laeufe[30] = lauf("pruefungen", "failure", "2026-08-31T10:00:00Z");
    const r = deployMitLaeufen(laeufe);
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Pflicht-Check pruefungen .* nicht grün \(Ist: pruefungen=failure\)/);
    expect(r.uploads).toEqual([]);
  });

  test("ueber 100 Laeufe: ein juengerer roter Lauf auf der zweiten Seite haelt an", () => {
    /* Auf der ersten Seite stehen alle sechs gruen; der juengere, rote Lauf
       von test-backend steht als Nummer 107 auf der zweiten. */
    const laeufe = [
      ...pflichtLaeufe("2026-08-17T07:15:00Z"),
      ...fremdeLaeufe(100),
      lauf("test-backend", "failure", "2026-08-24T07:15:00Z"),
    ];
    const r = deployMitLaeufen(laeufe);
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Pflicht-Check test-backend .* nicht grün \(Ist: test-backend=failure\)/);
    expect(r.uploads).toEqual([]);
    expect(r.abfragen.map((a) => a.replace(/.*&page=/, ""))).toEqual(["1", "2"]);
  });
});

/* ── Laeuft der Nachtlauf noch NACH ZEITPLAN? (OPS-2026-10-03-13) ────────
 *
 * Der Riegel weiter oben verlangt einen frischen Nachtlauf — nach Zeitplan
 * oder von Hand gestartet (bewusst so: docs/SECURITY-MODEL.md). Die
 * Auslieferkette startet einen fehlenden Lauf selbst von Hand. Ein Zeitplan,
 * der gar nicht mehr laeuft, fiele damit bei keiner Auslieferung auf.
 *
 * Deshalb trennt das Skript zwei Faelle: "die Fassung des Nachtlaufs hat sich
 * geaendert" (der Handstart ist richtig) und "der Lauf nach Zeitplan fehlt
 * oder ist alt" (dann wird es gemeldet — vor dem Upload und noch einmal am
 * Ende). Ausgeliefert wird in beiden Faellen.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — laeuft der Nachtlauf noch nach Zeitplan", () => {
  afterEach(aufraeumen);

  const nachtLauf = (minutenAlt, weiteres = {}) => ({
    created_at: new Date(Date.now() - minutenAlt * 60000).toISOString(),
    event: "schedule",
    conclusion: "success",
    head_sha: "HEAD",
    head_repository: { full_name: "malziland/malzime" },
    ...weiteres,
  });
  const nacht = (...laeufe) => JSON.stringify({ workflow_runs: laeufe });
  const vonHand = (minutenAlt, weiteres = {}) => nachtLauf(minutenAlt, { event: "workflow_dispatch", ...weiteres });
  const DREI_TAGE = 3 * 24 * 60;
  const MELDUNG = /ACHTUNG: Der Nachtlauf "Sicherheit nachts" laeuft nicht nach Zeitplan/;

  test("juengster Lauf nach Zeitplan drei Tage alt, daneben ein frischer Handstart: unuebersehbar gemeldet", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(vonHand(5), nachtLauf(DREI_TAGE)) });
    expect(r.ausgabe).toMatch(MELDUNG);
    /* Mit dem Alter des Zeitplan-Laufs, nicht dem des Handstarts. */
    expect(r.ausgabe).toMatch(/Juengster Lauf NACH ZEITPLAN auf main: \S+ \(vor 432\d min\)/);
    /* Zweimal: an der Stelle des Riegels, also VOR dem Upload, und noch einmal
       ganz am Ende — dort, wo ein Mensch zuletzt hinsieht. */
    const stellen = [...r.ausgabe.matchAll(/laeuft nicht nach Zeitplan/g)].map((m) => m.index);
    expect(stellen.length).toBeGreaterThanOrEqual(2);
    const upload = r.ausgabe.indexOf("ATTRAPPE: Deploy abgeschlossen");
    expect(upload).toBeGreaterThan(-1);
    expect(stellen[0]).toBeLessThan(upload);
    expect(stellen[stellen.length - 1]).toBeGreaterThan(upload);
    /* Ausgeliefert wird trotzdem: Ein von Hand gestarteter Lauf genuegt dem
       Riegel — so ist es entschieden. */
    expect(r.code).toBe(0);
    expect(r.uploads).toContain("firebase deploy --only hosting");
  });

  test("nur Handstarts, gar kein Lauf nach Zeitplan: ebenso gemeldet", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(vonHand(5), vonHand(1500), vonHand(3000)) });
    expect(r.ausgabe).toMatch(MELDUNG);
    expect(r.ausgabe).toMatch(/kein einziger nach Zeitplan/);
    expect(r.code).toBe(0);
  });

  test("ein frischer Lauf nach Zeitplan: keine Meldung — sie erscheint nicht bei jeder Auslieferung", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(120)) });
    expect(r.code).toBe(0);
    expect(r.ausgabe).not.toMatch(/laeuft nicht nach Zeitplan/);
    expect(r.ausgabe).toMatch(/juengster Lauf nach Zeitplan vor 12\d min/);
  });

  test("Fassung geaendert, Handstart mit der neuen Fassung, Zeitplan-Lauf von heute Nacht: keine Meldung", () => {
    /* Der Fall, in dem der Handstart RICHTIG ist. Der Zeitplan-Lauf lief noch
       mit der vorigen Fassung — er belegt nur, dass der Zeitplan lebt. */
    const vorher = execSync(`git -C "${klon}" rev-parse HEAD`, { encoding: "utf8" }).trim();
    try {
      execSync(
        [
          `printf '\n# Probe\n' >> "${klon}/.github/workflows/sicherheit-nachts.yml"`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q -am "Nachtlauf geaendert"`,
          `git -C "${klon}" branch -f main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
      const r = deployMitProtokoll({
        ATTRAPPE_NACHT_LAEUFE: nacht(vonHand(5), nachtLauf(600, { head_sha: vorher })),
      });
      expect(r.code).toBe(0);
      expect(r.ausgabe).not.toMatch(/laeuft nicht nach Zeitplan/);
      expect(r.ausgabe).toMatch(/mit der ausgelieferten Fassung/);
    } finally {
      execSync(`git -C "${klon}" reset -q --hard ${vorher} && git -C "${klon}" branch -f main ${vorher}`, {
        stdio: "pipe",
      });
    }
  });

  /* Die Grenze steht nur in deploy.sh (NACHT_ZEITPLAN_GRENZE_MINUTEN, zwei
     Tage). Knapp darunter und knapp darueber — zwei Faelle, weil ein
     durchlaufender Deploy den Testklon veraendert. */
  test("Zeitplan-Lauf 47 h 50 min alt, Handstart frisch: keine Meldung", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(vonHand(5), nachtLauf(2870)) });
    expect(r.code).toBe(0);
    expect(r.ausgabe).not.toMatch(/laeuft nicht nach Zeitplan/);
  });

  test("Zeitplan-Lauf 48 h 10 min alt, Handstart frisch: Meldung", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(vonHand(5), nachtLauf(2890)) });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(MELDUNG);
  });

  test("kein frischer Lauf und der Zeitplan steht: der Abbruch sagt, dass ein Handstart die Ursache nicht behebt", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(DREI_TAGE)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
    expect(r.ausgabe).toMatch(/Der Zeitplan selbst laeuft nicht/);
    expect(r.uploads).toEqual([]);
  });

  test("kein frischer Lauf, der Zeitplan ist nur verspaetet: Abbruch ohne diesen Zusatz", () => {
    const r = deployMitProtokoll({ ATTRAPPE_NACHT_LAEUFE: nacht(nachtLauf(30 * 60)) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/aelter als 1560 min/);
    expect(r.ausgabe).not.toMatch(/Der Zeitplan selbst laeuft nicht/);
  });
});

/* ── Jeder der sechs Pflicht-Checks, einzeln (OPS-2026-10-03-12) ─────────
 *
 * Die Faelle weiter oben machen `test-backend`, `test-e2e` und `pruefungen`
 * rot. Die uebrigen Namen liessen sich aus der Liste PFLICHT in deploy.sh
 * nehmen, ohne dass ein Test es merkte — und ein roter Check dieses Namens
 * hielte die Auslieferung dann nicht mehr an.
 *
 * Die sechs Namen stehen fuer die Tests an EINER Stelle
 * (hilfen/gh-seiten-attrappe.js). Dass deploy.sh genau diese sechs verlangt,
 * haelt der erste Fall fest; dass die Pipeline sie unter diesen Namen fuehrt,
 * der Vertrag in scripts/pruefe-deploy-riegel.py.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — jeder der sechs Pflicht-Checks haelt fuer sich an", () => {
  afterEach(aufraeumen);

  /** Alle sechs gruen, nur `name` traegt `ergebnis` (null: der Check fehlt ganz). */
  const lage = (name, ergebnis) =>
    PFLICHT.filter((n) => n !== name || ergebnis !== null)
      .map((n) => `${n}=${n === name ? ergebnis : "success"}`)
      .join("\n");
  const firebaseDeploy = (aufrufe) => aufrufe.filter((zeile) => zeile.startsWith("firebase deploy"));

  test("deploy.sh verlangt genau diese sechs", () => {
    const skript = fs.readFileSync(path.join(WURZEL, "scripts", "deploy.sh"), "utf8");
    const liste = skript.match(/^\s*PFLICHT="([^"]+)"$/m);
    expect(liste).not.toBeNull();
    expect(liste[1].split(" ").sort()).toEqual([...PFLICHT].sort());
    expect(PFLICHT).toHaveLength(6);
  });

  test.each(PFLICHT)("%s rot, die anderen fuenf gruen: Abbruch mit seinem Namen, nichts ausgeliefert", (name) => {
    const r = deployMitProtokoll({ ATTRAPPE_CHECKS: lage(name, "failure") });
    expect(r.code).not.toBe(0);
    /* Die Meldung DIESES Riegels mit DIESEM Namen — ein Abbruch an anderer
       Stelle belegte nichts. */
    expect(r.ausgabe).toMatch(
      new RegExp(`Pflicht-Check ${name} ist fuer [0-9a-f]{40} nicht grün \\(Ist: ${name}=failure\\)`)
    );
    /* Nicht einmal der Trockenlauf beginnt. */
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test.each(PFLICHT)("%s ohne Ergebnis (der Lauf fehlt): Abbruch, nichts ausgeliefert", (name) => {
    const r = deployMitProtokoll({ ATTRAPPE_CHECKS: lage(name, null) });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(new RegExp(`Pflicht-Check ${name} ist fuer [0-9a-f]{40} nicht grün \\(Ist: fehlt\\)`));
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("ein uebersprungener Browser-Test (skipped) gilt nicht als bestanden", () => {
    /* So steht `test-e2e` nach einem reinen Auslieferungs-Nachtrag da: Der
       Zweigschutz laesst das durch, die Auslieferung nicht
       (docs/SECURITY-MODEL.md, "Nachtrag ohne Browser-Test"). */
    const r = deployMitProtokoll({ ATTRAPPE_CHECKS: lage("test-e2e", "skipped") });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Pflicht-Check test-e2e ist fuer [0-9a-f]{40} nicht grün \(Ist: test-e2e=skipped\)/);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("alle sechs gruen: die Auslieferung laeuft durch — der Riegel schlaegt nicht immer zu", () => {
    const r = deployMitProtokoll({ ATTRAPPE_CHECKS: lage(null, null) });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/alle sechs Pflicht-Checks grün/);
    expect(r.uploads).toContain("firebase deploy --only hosting");
  });
});

/* ── Die Ersatzlaeufe des Notschalters SKIP_STAND (OPS-2026-10-03-12) ────
 *
 * Mit SKIP_STAND=1 faellt die Bindung an die Pipeline weg. Dann sind Lint,
 * Server-Tests und Browser-Modul-Tests das Einzige, was zwischen ungepruefte
 * Aenderungen und die Produktion tritt — sie laufen in diesem Fall im
 * Auslieferskript selbst (docs/RUNBOOK.md: "Faellt sie aus, laufen sie
 * vollstaendig").
 *
 * `npm` ist hier eine Attrappe, die jeden Aufruf mitschreibt und auf Kommando
 * scheitert. Die echten Suiten startet dieser Test nicht.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — die Ersatzlaeufe, wenn die Stand-Bindung abgeschaltet ist", () => {
  afterEach(aufraeumen);

  const ERSATZLAEUFE = ["npm run lint", "npm test --prefix functions", "npm run test:frontend"];
  const npmAufrufe = (aufrufe) => aufrufe.filter((zeile) => zeile.startsWith("npm "));
  const firebaseDeploy = (aufrufe) => aufrufe.filter((zeile) => zeile.startsWith("firebase deploy"));

  let npmOrdner;
  afterAll(() => {
    if (npmOrdner) fs.rmSync(npmOrdner, { recursive: true, force: true });
  });

  /** deploy.sh mit einer npm-Attrappe vorn im Suchpfad. */
  function deployMitNpmAttrappe(umgebung = {}) {
    if (!npmOrdner) {
      npmOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-npm-attrappe-"));
      fs.writeFileSync(
        path.join(npmOrdner, "npm"),
        "#!/bin/sh\n# ATTRAPPE (Testlauf) — startet keine echte Suite.\n" +
          '[ -n "${ATTRAPPE_PROTOKOLL:-}" ] && echo "npm $*" >> "$ATTRAPPE_PROTOKOLL"\n' +
          'if [ -n "${ATTRAPPE_NPM_ROT:-}" ] && [ "npm $*" = "$ATTRAPPE_NPM_ROT" ]; then\n' +
          '  echo "ATTRAPPE npm: [$*] scheitert (so gewollt)" >&2\n  exit 1\nfi\n' +
          'echo "ATTRAPPE npm: ok [$*]"\nexit 0\n'
      );
      fs.chmodSync(path.join(npmOrdner, "npm"), 0o755);
    }
    return deployMitProtokoll({ PFAD_DAVOR: [npmOrdner], ...umgebung });
  }

  test("Lint, Server-Tests und Browser-Modul-Tests laufen dann hier — alle drei, vor dem ersten Schritt zu Firebase", () => {
    const r = deployMitNpmAttrappe({ SKIP_STAND: "1" });
    expect(r.code).toBe(0);
    expect(npmAufrufe(r.aufrufe)).toEqual(ERSATZLAEUFE);
    /* Vor dem Trockenlauf, erst recht vor dem Upload: Ein roter Lauf soll
       anhalten, bevor irgendetwas bei Firebase ankommt. */
    const ersterSchritt = r.aufrufe.findIndex((zeile) => zeile.startsWith("firebase deploy"));
    expect(ersterSchritt).toBeGreaterThan(-1);
    expect(r.aufrufe.lastIndexOf(ERSATZLAEUFE[2])).toBeLessThan(ersterSchritt);
    expect(r.uploads).toContain("firebase deploy --only hosting");
    /* Und der Notschalter steht in der Schlussbilanz. */
    expect(r.ausgabe).toMatch(/ÜBERSPRUNGENE RIEGEL:.*SKIP_STAND/);
  });

  test.each(ERSATZLAEUFE)("scheitert `%s`, wird nichts ausgeliefert", (befehl) => {
    const r = deployMitNpmAttrappe({ SKIP_STAND: "1", ATTRAPPE_NPM_ROT: befehl });
    expect(r.code).not.toBe(0);
    /* Messmittel-Probe: Gescheitert ist wirklich dieser Lauf. */
    expect(r.ausgabe).toContain(`ATTRAPPE npm: [${befehl.replace(/^npm /, "")}] scheitert`);
    expect(firebaseDeploy(r.aufrufe)).toEqual([]);
  });

  test("mit Stand-Bindung laeuft keiner der drei hier — die Pipeline hat sie belegt", () => {
    /* Gegenrichtung: Die Ersatzlaeufe gehoeren zum Notschalter, nicht zu
       jeder Auslieferung. */
    const r = deployMitNpmAttrappe();
    expect(r.code).toBe(0);
    expect(npmAufrufe(r.aufrufe)).toEqual([]);
    expect(r.ausgabe).toMatch(/Lint und Tests uebersprungen: Die Stand-Bindung hat sie bereits belegt/);
  });

  test("SKIP_TESTS=1 schaltet auch sie ab — und beide Schalter stehen in der Schlussbilanz", () => {
    const r = deployMitNpmAttrappe({ SKIP_STAND: "1", SKIP_TESTS: "1" });
    expect(r.code).toBe(0);
    expect(npmAufrufe(r.aufrufe)).toEqual([]);
    expect(r.ausgabe).toMatch(/ÜBERSPRUNGENE RIEGEL:.*SKIP_STAND.*SKIP_TESTS/);
  });
});

/* ── Die Website allein: nur mit unveraendertem Server-Code ──────────────
 * (ARCH-2026-10-03-10, Gegenrichtung)
 *
 * Der Fingerabdruck der Website weist auch den Server-Code aus, Datei fuer
 * Datei. `deploy.sh hosting` liefert den Server nicht aus. Hat sich der
 * Server-Code seit der letzten Auslieferung geaendert, wiese die Seite danach
 * ein Server-Programm aus, das nie hinausging.
 *
 * Verglichen wird mit dem, was die Seite heute ausweist. In diesen Tests ist
 * das der Fingerabdruck des Klons, wie er beim Aufbau errechnet wurde (so, als
 * waere genau dieser Stand zuletzt ausgeliefert worden); eine curl-Attrappe
 * liefert ihn. Im Klon laeuft dafuer das echte build-info.mjs.
 * ──────────────────────────────────────────────────────────────────────── */
describe("deploy.sh — die Website geht nur allein hinaus, wenn der Server-Code unveraendert ist", () => {
  afterEach(aufraeumen);

  const MELDUNG = /Server-Code hat sich seit dem ausgewiesenen Stand geaendert — ohne Argument ausliefern/;
  const fingerabdruckAbfragen = (aufrufe) =>
    aufrufe.filter((zeile) => zeile.startsWith("curl ") && zeile.includes("build-info.json"));
  const baumOffen = () => execSync(`git -C "${klon}" status --porcelain`, { encoding: "utf8" }).trim();
  const serverDatei = (name) => path.join(klon, "functions", "src", name);
  const serverCodeAendern = () => fs.appendFileSync(serverDatei("config.js"), "\n// Probe: geaenderter Server-Code\n");

  /** Die Cache-Kennung im Klon, wie sie public/index.html zeigt. */
  function kennung() {
    const html = fs.readFileSync(path.join(klon, "public", "index.html"), "utf8");
    const m = /styles\.css\?v=(\d+)/.exec(html);
    return m ? m[1] : null;
  }

  /** Bringt den Klon einen Commit weiter (`aenderung` veraendert Dateien; der
   *  Commit ist danach HEAD und main), fuehrt `tun` aus und stellt den Stand
   *  davor wieder her. */
  function mitNeuemStand(aenderung, tun) {
    const vorher = execSync(`git -C "${klon}" rev-parse HEAD`, { encoding: "utf8" }).trim();
    try {
      aenderung();
      execSync(
        [
          `git -C "${klon}" add -A`,
          `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q -m "Probe: neuer Stand"`,
          `git -C "${klon}" branch -f main HEAD`,
        ].join(" && "),
        { stdio: "pipe" }
      );
      return tun();
    } finally {
      execSync(`git -C "${klon}" reset -q --hard ${vorher} && git -C "${klon}" branch -f main ${vorher}`, {
        stdio: "pipe",
      });
    }
  }

  test("Server-Code geaendert, Ziel `hosting`: Abbruch vor jedem Upload — mit dem Namen der Datei", () => {
    mitNeuemStand(serverCodeAendern, () => {
      const vorher = kennung();
      const r = deployMitProtokoll();
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(MELDUNG);
      expect(r.ausgabe).toMatch(/^\s+src\/config\.js \(geaendert\)$/m);
      /* Genau diese eine Meldung — nicht zusaetzlich die einer gescheiterten
         Messung. Gemessen ist hier ja etwas: eine Abweichung. */
      expect(r.ausgabe).not.toMatch(/nicht gemessen|liess sich nicht ausfuehren/);
      expect(r.uploads).toEqual([]);
      /* Messmittel-Probe: Der Lauf kam bis zu diesem Riegel — die Seite wurde
         gefragt. Ein Abbruch weiter vorn belegte nichts. */
      expect(fingerabdruckAbfragen(r.aufrufe)).toHaveLength(1);
      /* Und der Arbeitsbaum ist, wie er war: Kennung und Fingerabdruck sind
         zurueckgenommen, der naechste Versuch bleibt nicht am Sauberkeits-Riegel haengen. */
      expect(kennung()).toBe(vorher);
      expect(baumOffen()).toBe("");
    });
  });

  test("derselbe Stand ohne Argument (Website und Server zusammen): laeuft durch — die Seite wird gar nicht gefragt", () => {
    /* Der Ausweg, den die Meldung nennt. Der Riegel gilt nur, wenn der Server
       NICHT mit ausgeliefert wird. */
    mitNeuemStand(serverCodeAendern, () => {
      const r = deployMitProtokoll({}, null);
      expect(r.code).toBe(0);
      expect(r.uploads).toContain("firebase deploy --only hosting,functions");
      expect(fingerabdruckAbfragen(r.aufrufe)).toEqual([]);
      expect(r.ausgabe).not.toMatch(MELDUNG);
    });
  });

  test("Server-Code unveraendert, nur die Website geaendert: `hosting` laeuft durch — der Website-Weg bleibt offen", () => {
    /* Der Fall von Hebel 5a im Betriebshandbuch: eine Datei der Website, kein
       Server-Code. Ein Riegel, der immer zuschlaegt, waere so schlecht wie keiner. */
    mitNeuemStand(
      () => fs.appendFileSync(path.join(klon, "public", "js", "api-basis.js"), "\n// Probe: geaenderte Website\n"),
      () => {
        const r = deployMitProtokoll();
        expect(r.code).toBe(0);
        expect(r.uploads).toContain("firebase deploy --only hosting");
        /* Der Riegel hat wirklich verglichen, nicht nur geschwiegen. */
        expect(r.ausgabe).toMatch(
          /Server-Code unveraendert gegenueber dem ausgewiesenen Stand \(\d{2,} Dateien, live Commit [0-9a-f]{7,40}\)/
        );
        expect(fingerabdruckAbfragen(r.aufrufe)).toHaveLength(1);
      }
    );
  });

  test("Aenderungen an den Tests des Servers zaehlen nicht — sie werden nicht ausgeliefert", () => {
    mitNeuemStand(
      () => fs.writeFileSync(serverDatei(path.join("__tests__", "probe-nur-test.test.js")), "// Probe\n"),
      () => {
        const r = deployMitProtokoll();
        expect(r.code).toBe(0);
        expect(r.uploads).toContain("firebase deploy --only hosting");
      }
    );
  });

  test("eine neue und eine entfallene Server-Datei zaehlen wie eine geaenderte", () => {
    mitNeuemStand(
      () => {
        fs.writeFileSync(serverDatei("probe-neu.js"), "module.exports = {};\n");
        fs.rmSync(serverDatei("animal.js"));
      },
      () => {
        const r = deployMitProtokoll();
        expect(r.code).not.toBe(0);
        expect(r.ausgabe).toMatch(MELDUNG);
        expect(r.ausgabe).toMatch(/^\s+src\/animal\.js \(entfaellt\)$/m);
        expect(r.ausgabe).toMatch(/^\s+src\/probe-neu\.js \(neu\)$/m);
        expect(r.uploads).toEqual([]);
      }
    );
  });

  test.each([
    ["package.json (welche Fremdpakete Google beim Bau einsetzt)", "package.json"],
    ["package-lock.json (in welcher Fassung)", "package-lock.json"],
    ["die Sprachliste, die das Programm beim Start liest", "src/locales/manifest.json"],
  ])("auch %s gehoert zum Server-Paket: geaendert, Ziel `hosting` → Abbruch", (_was, datei) => {
    /* Keine dieser drei ist eine Programmdatei unter functions/src/*.js — und
       jede geht zu Google. Aendert sich eine, ohne dass der Server mit
       ausgeliefert wird, wiese die Seite ein Paket aus, das nie hinausging. */
    mitNeuemStand(
      () => fs.appendFileSync(path.join(klon, "functions", datei), "\n"),
      () => {
        const r = deployMitProtokoll();
        expect(r.code).not.toBe(0);
        expect(r.ausgabe).toMatch(MELDUNG);
        expect(r.ausgabe).toContain(`${datei} (geaendert)`);
        expect(r.ausgabe).not.toMatch(/nicht gemessen|liess sich nicht ausfuehren|aelteren Form/);
        expect(r.uploads).toEqual([]);
        expect(fingerabdruckAbfragen(r.aufrufe)).toHaveLength(1);
        expect(baumOffen()).toBe("");
      }
    );
  });

  test("die Seite weist ihren Server noch in der aelteren Form aus: das Paket gilt als geaendert — Abbruch", () => {
    /* Bis zum 05.10.2026 nannte der Fingerabdruck nur die Programmdateien
       (Feld serverDateien). Daran laesst sich nicht messen, ob package.json,
       package-lock.json oder die Sprachliste seither anders sind. "Nicht
       vergleichbar" darf nicht wie "unveraendert" enden. */
    const vorher = kennung();
    const aeltereForm = JSON.stringify({
      commitKurz: "abc1234",
      dateien: { "app.js": "sha256:00" },
      serverDateien: { "index.js": "sha256:00", "config.js": "sha256:00" },
    });
    const r = deployMitProtokoll({ ATTRAPPE_FINGERABDRUCK_ANTWORT: aeltereForm });
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Server-Paket gilt als geaendert — ohne Argument ausliefern/);
    expect(r.ausgabe).toMatch(/noch in der aelteren Form/);
    /* Genau diese Meldung: weder "gemessen und abweichend" noch "nicht messbar". */
    expect(r.ausgabe).not.toMatch(MELDUNG);
    expect(r.ausgabe).not.toMatch(/ist kein Fingerabdruck|war nicht erreichbar/);
    expect(r.uploads).toEqual([]);
    expect(fingerabdruckAbfragen(r.aufrufe)).toHaveLength(1);
    expect(kennung()).toBe(vorher);
    expect(baumOffen()).toBe("");
  });

  test("eine einzelne Function im Ziel zaehlt nicht als Auslieferung des Servers", () => {
    /* `hosting,functions:enqueue` lieferte nur eine der Functions aus — der
       Fingerabdruck wiese trotzdem den ganzen Server-Code aus. */
    mitNeuemStand(serverCodeAendern, () => {
      const r = deployMitProtokoll({}, "hosting,functions:enqueue");
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(MELDUNG);
      expect(r.uploads).toEqual([]);
    });
  });

  test("auch der Probelauf haelt an — er sagt, ob die Auslieferung durchginge", () => {
    mitNeuemStand(serverCodeAendern, () => {
      const r = deployMitProtokoll({ PROBELAUF: "1" });
      expect(r.code).not.toBe(0);
      expect(r.ausgabe).toMatch(MELDUNG);
      expect(r.ausgabe).not.toMatch(/PROBELAUF: bis hierher waere alles bereit/);
    });
  });

  /* Fehlt die Vergleichsgrundlage oder laesst sie sich nicht lesen, ist nichts
     gemessen — und ungeprueft gilt als nicht bestanden. Der Server-Code ist in
     diesen Faellen UNVERAENDERT: Mit lesbarer Grundlage ginge der Lauf durch
     (das belegt jeder durchlaufende Fall dieser Datei). */
  test.each([
    [
      "der Abruf scheitert",
      { ATTRAPPE_FINGERABDRUCK_ROT: "1" },
      /build-info\.json war nicht erreichbar \(curl-Rueckgabewert 7\)/,
      /ist kein Fingerabdruck/,
    ],
    [
      "die Antwort ist die Startseite, kein Fingerabdruck",
      { ATTRAPPE_FINGERABDRUCK_ANTWORT: "<!doctype html><html><body>malziME</body></html>" },
      /build-info\.json ist kein Fingerabdruck mit Server-Dateien/,
      /war nicht erreichbar/,
    ],
    [
      "die Antwort ist leer",
      { ATTRAPPE_FINGERABDRUCK_ANTWORT: "" },
      /build-info\.json ist kein Fingerabdruck mit Server-Dateien/,
      /war nicht erreichbar/,
    ],
    [
      "der Fingerabdruck der Seite nennt keine Server-Dateien",
      { ATTRAPPE_FINGERABDRUCK_ANTWORT: '{"commitKurz":"abc1234","dateien":{"app.js":"sha256:00"}}' },
      /build-info\.json ist kein Fingerabdruck mit Server-Dateien/,
      /war nicht erreichbar/,
    ],
    [
      "die Liste der Server-Dateien der Seite ist leer",
      { ATTRAPPE_FINGERABDRUCK_ANTWORT: '{"commitKurz":"abc1234","serverPaket":{}}' },
      /build-info\.json ist kein Fingerabdruck mit Server-Dateien/,
      /war nicht erreichbar/,
    ],
    [
      "der eben erzeugte Fingerabdruck nennt keine Server-Dateien",
      { ATTRAPPE_BUILDINFO_OHNE_SERVER: "1" },
      /Der eben erzeugte Fingerabdruck \(public\/build-info\.json\) nennt keine Server-Dateien/,
      /war nicht erreichbar|ist kein Fingerabdruck/,
    ],
  ])("die Vergleichsgrundlage fehlt — %s: Abbruch, nichts ausgeliefert", (_was, umgebung, meldung, andereMeldung) => {
    const vorher = kennung();
    const r = deployMitProtokoll(umgebung);
    expect(r.code).not.toBe(0);
    /* Die Meldung, die zu DIESER Ursache gehoert — und nur sie. */
    expect(r.ausgabe).toMatch(meldung);
    expect(r.ausgabe).not.toMatch(andereMeldung);
    expect(r.ausgabe).toMatch(/Ohne diesen\s+Vergleich geht die Website nicht allein hinaus/);
    /* Eine gescheiterte Messung ist keine Aussage ueber den Server-Code. */
    expect(r.ausgabe).not.toMatch(MELDUNG);
    expect(r.uploads).toEqual([]);
    expect(kennung()).toBe(vorher);
    expect(baumOffen()).toBe("");
  });
});
