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
function deploy(umgebung = {}, ziel = "hosting") {
  try {
    /* BEFUND 31.08.2026 (Runde 4): Hier stand "sh". Auf ubuntu-latest — also in
       der Pipeline — ist `sh` gleich `dash`, und deploy.sh nutzt
       `set -o pipefail`, das dash nicht kennt. Gemessen: RC 2, "set: Illegal
       option -o pipefail", vier von acht Tests rot. Lokal faellt es nicht auf,
       weil `sh` auf macOS bash ist.
       Dieselbe Lehre steht im Kopf von selbstpruefung-waechter.sh und ist dort
       mit einem BASH_VERSION-Riegel abgesichert — hier war sie neu entstanden. */
    const ausgabe = execFileSync("bash", ["scripts/deploy.sh", ziel], {
      cwd: klon,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${ATTRAPPEN}:${process.env.PATH}`,
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
        SKIP_SATZ: "1",
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
  const eigene = {
    "scripts/verify-infrastructure.sh": "INFRA",
    "scripts/live-smoke.sh": "SMOKE",
    "scripts/warteschlange-pruefen.sh": "SATZ",
  };
  for (const [datei, name] of Object.entries(eigene)) {
    const ziel = path.join(klon, datei);
    if (!fs.existsSync(path.join(WURZEL, datei))) continue;
    fs.writeFileSync(
      ziel,
      `#!/bin/sh\n# ATTRAPPE (Testlauf) — beruehrt keinen echten Dienst.\n` +
        `if [ "\${ATTRAPPE_${name}_ROT:-0}" = "1" ]; then\n` +
        `  echo "ATTRAPPE ${name}: scheitert (so gewollt)" >&2\n  exit 1\nfi\n` +
        `echo "ATTRAPPE ${name}: ok"\nexit 0\n`
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
    fs.writeFileSync(seite, inhalt.replace(/styles\.css\?v=\d+/, "styles.css"));
    execSync(
      [
        `git -C "${klon}" add -A public`,
        `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
        `git -C "${klon}" branch -f main HEAD`,
        `git -C "${klon}" fetch -q origin main`,
      ].join(" && "),
      { stdio: "pipe" }
    );
    const r = deploy();
    expect(r.code).not.toBe(0);
    expect(r.ausgabe).toMatch(/Cache-Buster|nicht lesbar/i);
    /* Der Klon traegt jetzt eine kaputte index.html im COMMIT — die folgenden
       Faelle brauchen wieder eine lesbare Kennung. */
    execSync(
      [
        `git -C "${klon}" checkout -q HEAD~1 -- public/index.html`,
        `git -C "${klon}" add -A public`,
        `git -C "${klon}" -c user.email=t@t -c user.name=t commit -q --amend --no-edit`,
        `git -C "${klon}" branch -f main HEAD`,
        `git -C "${klon}" fetch -q origin main`,
      ].join(" && "),
      { stdio: "pipe" }
    );
  });

  /* NICHT PRUEFBAR mit dieser Bauart, gemessen am 31.08.2026 (Befund E-2):
     Der dokumentierte Sicherheitsbefund — die Check-Lage von main durch die des
     PR zu ERSETZEN statt nur Ausstehendes nachzutragen — braucht einen Klon, in
     dem main und PR-Kopf VERSCHIEDENE Ergebnisse tragen, aber denselben Baum.
     Beides zugleich laesst sich hier nicht herstellen: Der Klon hat nur einen
     Kopf, und die gh-Attrappe kann die beiden Abfragen dann nicht mehr
     auseinanderhalten. Ein Testversuch war im Normalfall rot und bei der
     Sabotage ebenfalls — er mass nichts.

     Was stattdessen gilt: Der Gegenpruefer hat den Fall am 31.08. in einem
     eigenen Wegwerf-Klon nachgestellt und belegt, dass das AUSGELIEFERTE
     Verhalten korrekt ist (Original bricht bei `test-e2e=failure` ab, nur die
     manipulierte Fassung liefert aus). Offen bleibt die Absicherung gegen
     kuenftige Aenderungen — bewusst als Restrisiko benannt, statt sie durch
     einen Test vorzutaeuschen. */

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
