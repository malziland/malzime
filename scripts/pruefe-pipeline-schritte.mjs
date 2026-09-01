#!/usr/bin/env node
/**
 * pruefe-pipeline-schritte.mjs — fuehrt die GEAENDERTEN Schritte aus ci.yml
 * wirklich aus, bevor gepusht wird.
 *
 * ANLASS (01.09.2026): Sieben Fehler in fuenf Pipeline-Laeufen, keiner davon
 * lokal sichtbar — verrutschte Eingaben, ein verlorenes
 * `working-directory: .`, ein flacher Checkout, ein jest-Aufruf, der in der
 * CI anders antwortet. Jedes Mal war die DATEI geprueft und die UMGEBUNG
 * angenommen. Das kostete rund eine Stunde Wartezeit und fuenf Anlaeufe.
 *
 * Was diese Pruefung tut: Sie liest, welche `- run:`-Schritte sich gegenueber
 * origin/main geaendert haben, und fuehrt sie aus — im Arbeitsverzeichnis des
 * Jobs, so wie GitHub es taete.
 *
 * Was sie NICHT kann, ehrlich benannt:
 *   · Sie ersetzt keinen echten Lauf. Ubuntu ist nicht macOS, und die
 *     Runner-Umgebung bringt eigene Werkzeuge mit.
 *   · Sie prueft `uses:`-Schritte nicht (Actions). Dafuer gibt es die
 *     Eingaben-Pruefung in pruefe-deploy-riegel.py.
 *   · Sie sagt nichts ueber Schritte, die unveraendert sind.
 *
 * Rueckgabewerte: 0 alle geaenderten Schritte liefen, 1 einer scheiterte,
 * 2 nicht messbar.
 */
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(WURZEL, ".github", "workflows", "ci.yml");

/** Die im Zweig geaenderten Zeilen von ci.yml (1-basiert). */
function geaenderteZeilen() {
  let roh;
  try {
    roh = execFileSync("git", ["diff", "-U0", "origin/main...HEAD", "--", ".github/workflows/ci.yml"], {
      cwd: WURZEL,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  const zeilen = new Set();
  for (const z of roh.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(z);
    if (!m) continue;
    const start = Number(m[1]);
    const anzahl = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < anzahl; i += 1) zeilen.add(start + i);
  }
  return zeilen;
}

/** Alle run-Schritte mit Job, Zeile und wirksamem Arbeitsverzeichnis. */
function schritte() {
  const zeilen = readFileSync(WORKFLOW, "utf8").split("\n");
  const gefunden = [];
  let job = null;
  let jobVerzeichnis = ".";
  let letzterSchritt = null;

  zeilen.forEach((zeile, i) => {
    const jobKopf = zeile.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (jobKopf) {
      job = jobKopf[1];
      jobVerzeichnis = ".";
      letzterSchritt = null;
      return;
    }
    if (!job) return;
    /* defaults.run.working-directory des Jobs */
    if (/^\s{8}working-directory:/.test(zeile) && !letzterSchritt) {
      jobVerzeichnis = zeile.split(":")[1].trim();
      return;
    }
    const run = zeile.match(/^\s+- run:\s+(.+?)\s*$/);
    if (run) {
      letzterSchritt = { job, zeile: i + 1, befehl: run[1], verzeichnis: jobVerzeichnis };
      gefunden.push(letzterSchritt);
      return;
    }
    /* working-directory eines einzelnen Schrittes ueberschreibt den Job */
    if (letzterSchritt && /^\s+working-directory:/.test(zeile)) {
      letzterSchritt.verzeichnis = zeile.split(":")[1].trim();
    }
  });
  return gefunden;
}

const geaendert = geaenderteZeilen();
if (geaendert === null) {
  console.log("NICHT MESSBAR: git diff gegen origin/main ist gescheitert.");
  process.exit(2);
}

/* Ein Schritt gilt als geaendert, wenn seine run-Zeile ODER eine der drei
   Zeilen darunter (working-directory, env …) beruehrt wurde. */
const alle = schritte();
const zuPruefen = alle.filter((s) => [0, 1, 2, 3].some((d) => geaendert.has(s.zeile + d)));

if (zuPruefen.length === 0) {
  console.log("Keine geaenderten Pipeline-Schritte — nichts auszufuehren.");
  process.exit(0);
}

console.log(`PIPELINE-SCHRITTE — ${zuPruefen.length} geaendert, werden ausgefuehrt`);
console.log("-".repeat(64));

/* Diese Schritte werden NICHT ausgefuehrt: Sie veraendern den Arbeitsbaum
   oder dauern so lange wie die Pipeline selbst. Der Zweck ist, verrutschte
   Pfade und fehlende Voraussetzungen zu finden — nicht, die CI zu ersetzen. */
const NICHT_AUSFUEHREN = [
  [/^npm ci/, "installiert Pakete — wuerde den lokalen Baum umbauen"],
  [/^npm test\b/, "die volle Suite, laeuft in scripts/pruefstand.sh"],
  [/^npm run test:e2e/, "die E2E-Suite, dito"],
  [/gitleaks/, "eigener Job mit eigener Action"],
  [
    /selbstpruefung-waechter\.sh/,
    "verlangt einen sauberen Arbeitsbaum — vor einem Commit gibt es den nie; " +
      "sie laeuft ohnehin als eigener Schritt in vor-dem-push.sh",
  ],
];

let fehler = 0;
let uebersprungen = 0;

for (const s of zuPruefen) {
  const grund = NICHT_AUSFUEHREN.find(([muster]) => muster.test(s.befehl));
  if (grund) {
    console.log(`  --    ${s.job}: ${s.befehl.slice(0, 46)}`);
    console.log(`        uebersprungen: ${grund[1]}`);
    uebersprungen += 1;
    continue;
  }
  const cwd = resolve(WURZEL, s.verzeichnis);
  const lauf = spawnSync("bash", ["-lc", s.befehl], { cwd, encoding: "utf8" });
  const ok = lauf.status === 0;
  if (!ok) fehler += 1;
  console.log(`  ${ok ? "ok  " : "ROT "}  ${s.job} (in ${s.verzeichnis}): ${s.befehl.slice(0, 46)}`);
  if (!ok) {
    const ausgabe = `${lauf.stdout || ""}${lauf.stderr || ""}`.trim().split("\n").slice(-4);
    for (const z of ausgabe) console.log(`        ${z}`);
  }
}

console.log("-".repeat(64));
if (fehler === 0) {
  console.log(`ERGEBNIS: alle ${zuPruefen.length - uebersprungen} ausgefuehrten Schritte liefen.`);
  if (uebersprungen) console.log(`          ${uebersprungen} uebersprungen (Grund je Zeile oben).`);
  process.exit(0);
}
console.log(`ERGEBNIS: ${fehler} Schritt(e) scheitern — sie wuerden die Pipeline`);
console.log("          rot machen. Hier kostet es Sekunden, dort zehn Minuten.");
process.exit(1);
