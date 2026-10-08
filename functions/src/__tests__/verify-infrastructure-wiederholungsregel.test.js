/**
 * verify-infrastructure-wiederholungsregel.test.js — der Riegel für die
 * Wiederholungsregel der Warteschlange kann rot werden (OPS-2026-10-03-22).
 *
 * Die Regel ist eine Einstellung bei Google, die `firebase deploy` nicht
 * verwaltet. Bis zum 08.10.2026 galt der Google-Standard (bis 100 Versuche,
 * Abstand bis zu einer Stunde); ein Auftrag blieb nach einer kurzen Störung
 * viele Minuten liegen. Seither prüft scripts/verify-infrastructure.sh vor
 * jeder Auslieferung: Abstand höchstens 60 s, Schluss nach 30 Minuten, ab
 * 10 Versuchen.
 *
 * Die Proben laufen über den Einspeisepunkt INFRA_PROBE_WIEDERHOLUNG; gcloud,
 * gsutil und curl sind Attrappen — kein Netz aus einem Test.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "../../../scripts/verify-infrastructure.sh");
const GRUEN = /Wiederholungsregel: Abstand hoechstens 60 s, Schluss nach 30 Minuten \(ab 10 Versuchen\)/;

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-wiederholung-"));
  const attrappen = path.join(dir, "bin");
  fs.mkdirSync(attrappen);
  for (const werkzeug of ["gcloud", "gsutil", "curl"]) {
    const ziel = path.join(attrappen, werkzeug);
    fs.writeFileSync(ziel, "#!/bin/sh\n" + `echo "ATTRAPPE ${werkzeug}: kein Zugriff im Test" >&2\n` + "exit 1\n");
    fs.chmodSync(ziel, 0o755);
  }
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function lauf(umgebung) {
  try {
    return execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, ...umgebung },
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

/** Lauf mit dem, was Google auf die Lese-Abfrage antworten würde. */
function mitAntwort(antwort) {
  const datei = path.join(dir, "wiederholung.txt");
  fs.writeFileSync(datei, antwort);
  return lauf({ INFRA_PROBE_WIEDERHOLUNG: datei });
}

test("die gesetzte Regel → grün (Google trennt die Werte mit Tabulator)", () => {
  const aus = mitAntwort("60s\t1800s\t10\n");
  expect(aus).toMatch(GRUEN);
  expect(aus).not.toMatch(/Wiederholungsregel ist »/);
});

test("der Google-Standard (Abstand bis eine Stunde, 100 Versuche) → rot mit Ist und Soll", () => {
  const aus = mitAntwort("3600s\t\t100\n");
  expect(aus).not.toMatch(GRUEN);
  expect(aus).toContain("Wiederholungsregel ist »3600s  100«, SOLL »60s 1800s 10«");
});

test("nur ein Wert weicht ab (kein Ende nach 30 Minuten) → rot", () => {
  const aus = mitAntwort("60s\t\t10\n");
  expect(aus).not.toMatch(GRUEN);
  expect(aus).toContain("Wiederholungsregel ist »60s  10«");
});

test("nicht ermittelbar → rot, nicht übersprungen", () => {
  const aus = mitAntwort("");
  expect(aus).not.toMatch(GRUEN);
  expect(aus).toMatch(/Wiederholungsregel NICHT ermittelbar — ungeprueft gilt als nicht bestanden/);
});

test("ohne Einspeisepunkt im Probemodus wird die echte Warteschlange nicht gefragt", () => {
  const ttl = path.join(dir, "ttl.txt");
  fs.writeFileSync(ttl, "ACTIVE");
  const aus = lauf({ INFRA_PROBE_TTL: ttl });
  expect(aus).toMatch(/uebersprungen \(Probemodus ohne INFRA_PROBE_WIEDERHOLUNG\)/);
  expect(aus).not.toMatch(GRUEN);
});

test("ein roter Riegel beendet die Prüfung mit einem Fehler", () => {
  const datei = path.join(dir, "standard.txt");
  fs.writeFileSync(datei, "3600s\t\t100\n");
  let rc = 0;
  try {
    execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, INFRA_PROBE_WIEDERHOLUNG: datei },
    });
  } catch (e) {
    rc = e.status;
  }
  expect(rc).not.toBe(0);
});
