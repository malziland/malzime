const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Wächter für TEST-2026-10-04-29: Prüfungen, die ein ganzes Verzeichnis lesen,
 * sehen nur, was git kennt.
 *
 * Am Arbeitsrechner liegen im Projektordner Ordner, die `.gitignore` ausnimmt
 * (private Berichte, Sicherungen). In die Pipeline gehen sie nie. Lagen dort
 * Kopien von Tests oder Texte mit alten Werten, wurden der Uhr-Wächter und die
 * Fakten-Prüfung lokal rot — für etwas, das niemand ausliefert.
 *
 * Jeder Fall hat seine Gegenprobe: Derselbe Stoff in einem Ordner, den git
 * kennt, MUSS weiter gefunden werden. Ein Wächter, der nur noch grün meldet,
 * wäre schlechter als der alte.
 *
 * Bis 08.10.2026 setzte eine Hülle (`scripts/nur-git-bekannt.py`) den drei
 * einkopierten Prüfungen einen Spiegel vor. Seither fragen sie git selbst —
 * geändert an ihrer Quelle im Regelwerk. Diese Datei hält das Verhalten am
 * Projekt fest; die Selbstprüfung der Kopie (`scripts/pruefungen/
 * selbstpruefung.sh`, Richtung 7) hält es an der Kopie fest.
 */

const WURZEL = path.join(__dirname, "../../..");
const UHR = path.join(WURZEL, "scripts/pruefe-zeitzuender.py");
const FAKTEN = path.join(WURZEL, "scripts/pruefungen/checks/fakten-drift.py");
const STILL = path.join(WURZEL, "scripts/pruefungen/checks/stiller-fehlschlag.py");
const BLIND = path.join(WURZEL, "scripts/pruefungen/checks/test-blind.py");
const PROBE_KAPUTT = path.join(WURZEL, "scripts/zeitzuender-proben/kaputt");

let basis;
let repo;

beforeEach(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "nur-was-git-kennt-"));
  repo = path.join(basis, "projekt");
  fs.mkdirSync(repo);
});

afterEach(() => {
  fs.rmSync(basis, { recursive: true, force: true });
});

/* git sucht sein Repository auch in den Ordnern darüber. Die Grenze hält die
   Probe in ihrer eigenen Ablage, wo immer der Temp-Ordner liegt. */
function umgebung() {
  return { ...process.env, GIT_CEILING_DIRECTORIES: basis };
}

function starte(befehl, argumente, cwd) {
  const lauf = spawnSync(befehl, argumente, { cwd, encoding: "utf8", env: umgebung() });
  return { rc: lauf.status, aus: `${lauf.stdout}${lauf.stderr}` };
}

function git(...argumente) {
  const lauf = starte("git", argumente, repo);
  if (lauf.rc !== 0) throw new Error(`git ${argumente.join(" ")}: ${lauf.aus}`);
}

function schreibe(relativ, inhalt) {
  const ziel = path.join(repo, relativ);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt);
}

/** Legt den bekannten Zeitzünder (Quelle + Test ohne gestellte Uhr) in einen Ordner. */
function zeitzuenderNach(ordner) {
  fs.cpSync(PROBE_KAPUTT, path.join(repo, ordner), { recursive: true });
}

/** Ein Projekt mit git, einem ausgenommenen Ordner `privat/` und einer harmlosen Quelle. */
function projektMitGit() {
  git("init", "-q");
  schreibe(".gitignore", "privat/\n");
  schreibe("src/harmlos.js", "module.exports = { eins: 1 };\n");
}

describe("pruefe-zeitzuender.py liest nur, was git kennt", () => {
  test("ein Zeitzünder in einem ausgenommenen Ordner ist kein Fund — auch nicht in einem Punkt-Ordner darunter", () => {
    projektMitGit();
    zeitzuenderNach("privat/sicherung");
    zeitzuenderNach("privat/.anhang");

    const lauf = starte("python3", [UHR, repo, "--kandidaten"], basis);
    expect({ rc: lauf.rc, aus: lauf.aus }).toEqual({ rc: 0, aus: "" });
  });

  test("Gegenprobe: derselbe Zeitzünder in einem neuen, nicht ausgenommenen Ordner wird gefunden", () => {
    projektMitGit();
    zeitzuenderNach("privat/sicherung");
    zeitzuenderNach("neu");

    const lauf = starte("python3", [UHR, repo, "--kandidaten"], basis);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus.trim().split("\n")).toEqual([path.join(repo, "neu/tests/quelle.test.js")]);
  });

  test("Gegenprobe: ein eingecheckter Zeitzünder wird gefunden", () => {
    projektMitGit();
    zeitzuenderNach("eingecheckt");
    git("add", ".");

    const lauf = starte("python3", [UHR, repo, "--kandidaten"], basis);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus).toContain(path.join(repo, "eingecheckt/tests/quelle.test.js"));
  });

  test("ohne git-Arbeitsbaum liest die Prüfung das Verzeichnis selbst — der Zeitzünder wird gefunden", () => {
    zeitzuenderNach("irgendwo");

    const lauf = starte("python3", [UHR, repo, "--kandidaten"], basis);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus).toContain(path.join(repo, "irgendwo/tests/quelle.test.js"));
  });
});

describe("die einkopierten Verzeichnis-Prüfungen lesen nur, was git kennt", () => {
  const MUSTER = "Aktives Modell|modell-(\\d{4})\n";

  function faktenDateien() {
    schreibe(".pruefungen/fakten.txt", MUSTER);
    schreibe("README.md", "Die Analyse läuft über modell-2512.\n");
    schreibe("docs/betrieb.md", "Im Betrieb: modell-2512.\n");
  }

  function projektMitFakten() {
    projektMitGit();
    faktenDateien();
  }

  test("ein abweichender Wert in einem ausgenommenen Ordner ist kein Drift", () => {
    projektMitFakten();
    schreibe("privat/bericht.md", "Früher lief die Analyse über modell-2411.\n");

    const lauf = starte("python3", [FAKTEN, "."], repo);
    expect(lauf.aus).toContain("ERGEBNIS: kein Drift gefunden.");
    expect(lauf.aus).not.toContain("privat/");
    expect(lauf.rc).toBe(0);
  });

  test("die Probe ist scharf: Ohne git liest die Prüfung denselben Ordner mit", () => {
    schreibe(".gitignore", "privat/\n");
    faktenDateien();
    schreibe("privat/bericht.md", "Früher lief die Analyse über modell-2411.\n");

    const lauf = starte("python3", [FAKTEN, "."], repo);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus).toContain("privat/bericht.md:1");
  });

  test("Gegenprobe: derselbe Wert in einem Ordner, den git kennt, bleibt ein Drift — mit dem Pfad im Projekt", () => {
    projektMitFakten();
    schreibe("privat/bericht.md", "Früher lief die Analyse über modell-2411.\n");
    schreibe("docs/alt.md", "Früher lief die Analyse über modell-2411.\n");

    const lauf = starte("python3", [FAKTEN, "."], repo);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus).toContain("docs/alt.md:1");
    expect(lauf.aus).not.toContain("privat/");
  });

  test("was eingecheckt ist, wird gelesen — auch in einem Ordner, den .gitignore nennt", () => {
    projektMitFakten();
    schreibe("privat/bericht.md", "Früher lief die Analyse über modell-2411.\n");
    git("add", "-f", "privat/bericht.md");

    const lauf = starte("python3", [FAKTEN, "."], repo);
    expect(lauf.rc).toBe(1);
    expect(lauf.aus).toContain("privat/bericht.md:1");
  });

  test("die eigenen Muster des Projekts gelten weiter", () => {
    projektMitFakten();

    const lauf = starte("python3", [FAKTEN, "."], repo);
    expect(lauf.aus).toContain("Muster: 1 (aus .pruefungen/fakten.txt)");
    expect(lauf.rc).toBe(0);
  });

  /* Dieselbe Ursache bei den zwei anderen Prüfungen, die das ganze Verzeichnis
     lesen: verschluckte Fehler in Skripten und Tests ohne Zusicherung. */
  test.each([
    ["stiller-fehlschlag.py", STILL, "lauf.sh", "#!/bin/sh\nrm -rf /nirgendwo || true\n"],
    ["test-blind.py", BLIND, "tests/blind.test.js", 'test("blind", () => {});\n'],
  ])(
    "%s: ein Fund in einem ausgenommenen Ordner zählt nicht, derselbe in einem bekannten Ordner schon",
    (_name, pruefung, datei, inhalt) => {
      const sauberesProjekt = () => {
        schreibe(".gitignore", "privat/\n");
        schreibe("scripts/sauber.sh", "#!/bin/sh\nset -e\necho ok\n");
        schreibe("tests/sauber.test.js", 'test("prüft", () => { expect(rechne(2)).toBe(4); });\n');
        schreibe(`privat/${datei}`, inhalt);
      };

      /* Die Probe ist scharf: Ohne git liest die Prüfung den Ordner mit. */
      sauberesProjekt();
      const ohneGit = starte("python3", [pruefung, "."], repo);
      expect(ohneGit.rc).toBe(1);
      expect(ohneGit.aus).toContain(`privat/${datei}`);

      git("init", "-q");
      const ausgenommen = starte("python3", [pruefung, "."], repo);
      expect({ rc: ausgenommen.rc, nenntPrivat: ausgenommen.aus.includes("privat/") }).toEqual({
        rc: 0,
        nenntPrivat: false,
      });

      schreibe(`offen/${datei}`, inhalt);
      const bekannt = starte("python3", [pruefung, "."], repo);
      expect(bekannt.rc).toBe(1);
      expect(bekannt.aus).toContain(`offen/${datei}`);
    }
  );
});

describe("vor-dem-push.sh ruft die Verzeichnis-Prüfungen wie die Pipeline auf", () => {
  const skript = fs.readFileSync(path.join(WURZEL, "scripts/vor-dem-push.sh"), "utf8");

  test.each(["fakten-drift", "stiller-fehlschlag", "test-blind"])("%s läuft direkt über das Projekt", (name) => {
    const befehle = skript
      .split("\n")
      .filter((z) => /^\s*lauf /.test(z) && z.includes(`checks/${name}.py`))
      .map((z) => z.replace(/^\s*lauf "[^"]*" "[^"]*" /, ""));
    expect(befehle).toContain(`python3 scripts/pruefungen/checks/${name}.py .`);
  });

  test("die Hülle von früher gibt es nicht mehr — kein Aufruf zeigt ins Leere", () => {
    expect(skript).not.toContain("nur-git-bekannt");
    expect(fs.existsSync(path.join(WURZEL, "scripts/nur-git-bekannt.py"))).toBe(false);
  });
});
