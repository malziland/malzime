const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

/**
 * Prüft die Cloud-Tasks-Scripts gegen die tatsächlich verfügbaren
 * gcloud-Parameter.
 *
 * WARUM ES DIESEN TEST GIBT (2026-08-10):
 * Alle drei Scripts übergaben `--max-burst-size`. Diesen Parameter kennt die
 * aktuelle gcloud-CLI nicht mehr — die Scripts brachen mit einem Fehler ab.
 * Betroffen waren auch die Rollback-Scripts aus dem RUNBOOK: Der Notfall-Hebel
 * hätte im Ernstfall nicht funktioniert.
 *
 * Aufgefallen ist es erst beim Ausführen. Frühere Audits haben die Scripts
 * gelesen und `bash -n` laufen lassen — beides meldet nichts, weil die Syntax
 * ja korrekt ist. Es war kein Fehler im Script, sondern eine Annahme über die
 * Außenwelt, die still veraltet ist.
 *
 * Dieser Test fängt genau diese Art von Drift: Er liest die verwendeten
 * Parameter aus den Scripts und gleicht sie gegen `gcloud ... --help` ab.
 * Verändert nichts, ruft keine kostenpflichtige API auf.
 */

const SCRIPTS_DIR = path.join(__dirname, "../../../scripts");

function hatGcloud() {
  try {
    execSync("gcloud --version", { stdio: "ignore", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function queueScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /^cloudtasks-concurrency-\d+\.sh$/.test(f))
    .map((f) => ({ name: f, code: fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8") }));
}

/* Nur echte Befehlszeilen auswerten, keine Kommentarzeilen — im Kopf der
   Scripts steht bewusst erklärt, WARUM --max-burst-size entfernt wurde. */
function benutzteParameter(code) {
  const params = new Set();
  for (const zeile of code.split("\n")) {
    if (zeile.trim().startsWith("#")) continue;
    for (const m of zeile.matchAll(/(--[a-z][a-z0-9-]+)/g)) params.add(m[1]);
  }
  return [...params];
}

describe("Cloud-Tasks-Scripts", () => {
  const scripts = queueScripts();

  test("es gibt überhaupt welche", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test.each(scripts.map((s) => [s.name, s.code]))("%s nennt eine Queue und ein Projekt", (_name, code) => {
    expect(code).toMatch(/gcloud tasks queues update/);
    expect(code).toMatch(/--project=/);
    expect(code).toMatch(/--location=/);
  });

  test.each(scripts.map((s) => [s.name, s.code]))(
    "%s hat keinen abgehängten Zeilenumbruch vor dem nächsten Befehl",
    (_name, code) => {
      /* Ein übrig gebliebenes "\\" am Ende der letzten Parameterzeile schluckt
         die Folgezeile — genau so ist das Script beim Reparieren einmal
         kaputtgegangen. */
      expect(code).not.toMatch(/--max-dispatches-per-second=[\d.]+ \\\s*\necho/);
    }
  );

  const gcloudDa = hatGcloud();
  const testWennGcloud = gcloudDa ? test : test.skip;

  testWennGcloud(
    "alle verwendeten gcloud-Parameter existieren noch",
    () => {
      const hilfe = execSync("gcloud tasks queues update --help 2>&1", {
        encoding: "utf8",
        timeout: 60000,
      });
      const fehlend = [];
      for (const { name, code } of scripts) {
        for (const p of benutzteParameter(code)) {
          if (!hilfe.includes(p)) fehlend.push(`${name}: ${p}`);
        }
      }
      expect(fehlend).toEqual([]);
    },
    90000
  );

  /* Fehlt gcloud, wird der Abgleich als uebersprungen AUSGEWIESEN statt einen
     immer wahren Test zu erfinden. Ein `expect(true)` stand hier einmal: Er
     zaehlte als bestanden und behauptete eine Abdeckung, die es nicht gab.
     Uebersprungen ist ehrlicher als gruen.

     KORREKTUR 2026-08-19: Hier stand `test.skip.each(gcloudDa ? [] : [...])`.
     Jest registriert aus einer LEEREN Liste trotzdem einen wartenden Eintrag —
     erkennbar am unaufgeloesten `%s` im Namen. Folge: Jeder Lauf meldete
     "1 skipped", auch wenn gcloud da war und der Abgleich lief. Eine Zahl, die
     immer eine fehlende Abdeckung behauptet, wo keine fehlt, ist genau so
     wertlos wie eine, die immer Abdeckung behauptet, wo keine ist.

     Ausserdem war die Begruendung falsch: Der Ubuntu-Laeufer von GitHub
     enthaelt die Google Cloud CLI. Der Abgleich lief die ganze Zeit auch in der
     CI — belegt mit `jest --json` und im CI-Protokoll. Der Platzhalter greift
     jetzt nur noch dort, wo gcloud wirklich fehlt. */
  if (!gcloudDa) {
    // pruefungen:uebersprungen-weil der Abgleich braucht das Werkzeug gcloud, das in dieser Umgebung fehlt — die Alternative waere eine Schein-Zusicherung
    test.skip("Parameter-Abgleich gegen die gcloud-Hilfe (gcloud nicht installiert)", () => {});
  }

  /* BEFUND 01.09.2026 (Runde 7, K-11): Datei "7" setzte `4` und meldete
     "Concurrency: 7". Alles darueber liest den Quelltext — kein Test hat je
     verglichen, WAS gesetzt wird mit dem, was gemeldet wird. Diese Pruefung
     fuehrt das Script wirklich aus, mit einer gcloud-Attrappe im PATH, und
     liest beide Seiten aus dem Lauf statt aus dem Text. */
  describe("was gesetzt wird, wird auch gemeldet", () => {
    let attrappen;

    beforeAll(() => {
      attrappen = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-gcloud-"));
      /* Die Attrappe schreibt ihre Argumente in eine Datei, deren Namen sie
         aus der Umgebung bekommt — so kann jeder Fall seine eigene lesen. */
      fs.writeFileSync(path.join(attrappen, "gcloud"), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$MITSCHRIFT"\nexit 0\n');
      fs.chmodSync(path.join(attrappen, "gcloud"), 0o755);
    });

    afterAll(() => {
      if (attrappen) fs.rmSync(attrappen, { recursive: true, force: true });
    });

    test.each(scripts.map((s) => [s.name]))("%s", (name) => {
      const mitschrift = path.join(attrappen, `${name}.txt`);
      const ausgabe = execSync(`bash ${JSON.stringify(path.join(SCRIPTS_DIR, name))}`, {
        encoding: "utf8",
        env: { ...process.env, PATH: `${attrappen}:${process.env.PATH}`, MITSCHRIFT: mitschrift },
      });
      const argumente = fs.readFileSync(mitschrift, "utf8");

      const gesetztParallel = /--max-concurrent-dispatches=(\S+)/.exec(argumente);
      const gesetztRate = /--max-dispatches-per-second=(\S+)/.exec(argumente);
      expect(gesetztParallel).not.toBeNull();
      expect(gesetztRate).not.toBeNull();

      const gemeldet = /Gesetzt: Parallelitaet (\S+), Rate (\S+)\/s/.exec(ausgabe);
      expect(gemeldet).not.toBeNull();

      expect(gemeldet[1]).toBe(gesetztParallel[1]);
      expect(gemeldet[2]).toBe(gesetztRate[1]);
    });
  });
});
