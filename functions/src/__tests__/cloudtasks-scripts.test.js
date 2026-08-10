const fs = require("fs");
const path = require("path");
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

  if (!gcloudDa) {
    test("Hinweis: gcloud fehlt, Parameter-Abgleich übersprungen", () => {
      /* Kein Fehlschlag — in der CI ist gcloud nicht installiert. Der Abgleich
         läuft dann lokal vor einem Deploy. */
      expect(true).toBe(true);
    });
  }
});
