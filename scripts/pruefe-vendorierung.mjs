#!/usr/bin/env node
/**
 * pruefe-vendorierung.mjs — bewacht die einkopierten Prüfungen unter
 * `scripts/pruefungen/`.
 *
 * AUDIT-BEFUND TEST-2026-08-12-28: Der Ordner ist eine Kopie des
 * Werkzeugkastens aus der Audit-Familie. Kopien driften — und diese war es
 * bereits: In der Kopie fehlte die Regeldatei einer Beispielprobe, weil beim
 * Kopieren die Punktverzeichnisse untergingen. Die Prüfung hat sich dort beim
 * Lauf still eine Vorlage angelegt. Die Probe war grün, aber sie prüfte etwas
 * anderes als gedacht. Niemandem wäre das aufgefallen.
 *
 * Zwei Richtungen, zwei unterschiedliche Antworten:
 *
 *   1. IMMER prüfbar, auch in der Pipeline: Stimmt die Kopie noch mit den
 *      hinterlegten Prüfsummen überein? Das schlägt an, wenn jemand die KOPIE
 *      bearbeitet statt der Quelle — der häufigere Fehler, weil die Kopie im
 *      Repository liegt und die Quelle nicht.
 *   2. NUR lokal prüfbar: Ist die Quelle inzwischen weitergezogen? Liegt die
 *      Familie auf diesem Rechner, wird zusätzlich verglichen. Fehlt sie, wird
 *      das AUSDRÜCKLICH gesagt — nicht als bestanden gewertet.
 *
 * Rückgabewerte: 0 deckungsgleich, 1 Abweichung, 2 Messung nicht durchführbar.
 *
 * Aufruf:  node scripts/pruefe-vendorierung.mjs [--aktualisieren]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KOPIE = resolve(REPO, "scripts/pruefungen");
const HERKUNFT = resolve(KOPIE, "HERKUNFT.json");
const AKTUALISIEREN = process.argv.includes("--aktualisieren");

/* Was beim Vergleich außen vor bleibt, steht hier — sichtbar, mit Grund.
   Eine Ausnahme, die man nicht liest, ist ein Loch. */
const AUSNAHMEN = {
  "README.md": "trägt hier zusätzlich den Herkunftshinweis; Inhalt sonst identisch",
  "HERKUNFT.json": "beschreibt die Kopie selbst und kann sich nicht mit sich vergleichen",
};
const IGNORIERTE_ORDNER = new Set(["__pycache__", ".git"]);

function dateienUnter(wurzel) {
  const raus = [];
  const stapel = [wurzel];
  while (stapel.length) {
    const jetzt = stapel.pop();
    for (const name of readdirSync(jetzt)) {
      if (IGNORIERTE_ORDNER.has(name) || name === ".DS_Store") continue;
      const voll = join(jetzt, name);
      if (statSync(voll).isDirectory()) stapel.push(voll);
      else raus.push(relative(wurzel, voll));
    }
  }
  return raus.sort();
}

const summe = (pfad) => "sha256:" + createHash("sha256").update(readFileSync(pfad)).digest("hex");

if (!existsSync(KOPIE)) {
  console.error(`FEHLER: ${KOPIE} fehlt. Ohne die Kopie gibt es nichts zu prüfen.`);
  process.exit(2);
}

const ist = {};
for (const rel of dateienUnter(KOPIE)) {
  if (rel in AUSNAHMEN) continue;
  ist[rel] = summe(join(KOPIE, rel));
}

if (AKTUALISIEREN) {
  const alt = existsSync(HERKUNFT) ? JSON.parse(readFileSync(HERKUNFT, "utf8")) : {};
  writeFileSync(
    HERKUNFT,
    JSON.stringify(
      {
        _hinweis:
          "Herkunft und Prüfsummen der einkopierten Prüfungen (TEST-2026-08-12-28). " +
          "Geprüft von scripts/pruefe-vendorierung.mjs im CI-Job 'pruefungen'. " +
          "Bearbeitet wird die QUELLE, danach neu einkopieren und hier neu stempeln.",
        quelle: alt.quelle || "~/.claude/skills/audit-familie/pruefungen",
        familie_version: alt.familie_version || "unbekannt",
        ausnahmen: AUSNAHMEN,
        dateien: ist,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Herkunft neu gestempelt: ${Object.keys(ist).length} Dateien.`);
  process.exit(0);
}

if (!existsSync(HERKUNFT)) {
  console.error(`FEHLER: ${HERKUNFT} fehlt. Ohne Sollwerte keine Aussage — kein bestandener Test.`);
  process.exit(2);
}

let soll;
try {
  soll = JSON.parse(readFileSync(HERKUNFT, "utf8"));
} catch (fehler) {
  console.error(`FEHLER: HERKUNFT.json ist nicht lesbar: ${fehler.message}`);
  process.exit(2);
}
if (!soll.dateien || Object.keys(soll.dateien).length === 0) {
  console.error("FEHLER: keine Prüfsummen hinterlegt. Leer ist nicht dasselbe wie deckungsgleich.");
  process.exit(2);
}

console.log(`VENDORIERUNG — Familie ${soll.familie_version}, Quelle ${soll.quelle}`);

const geaendert = Object.keys(ist).filter((f) => f in soll.dateien && ist[f] !== soll.dateien[f]);
const neu = Object.keys(ist).filter((f) => !(f in soll.dateien));
const weg = Object.keys(soll.dateien).filter((f) => !(f in ist));

for (const f of geaendert) console.error(`\nGEAENDERT in der Kopie: ${f}`);
for (const f of neu) console.error(`\nNEU in der Kopie, nicht gestempelt: ${f}`);
for (const f of weg) console.error(`\nFEHLT in der Kopie: ${f}`);

/* Zweite Richtung — nur wenn die Quelle auf diesem Rechner liegt. */
const quellePfad = (soll.quelle || "").replace(/^~/, process.env.HOME || "~");
let quelleGeprueft = false;
const abweichend = [];
if (existsSync(quellePfad)) {
  quelleGeprueft = true;
  const quellDateien = new Set(dateienUnter(quellePfad));
  for (const rel of quellDateien) {
    if (rel in AUSNAHMEN) continue;
    const hier = join(KOPIE, rel);
    if (!existsSync(hier) || summe(hier) !== summe(join(quellePfad, rel))) abweichend.push(rel);
  }
  for (const rel of Object.keys(ist)) if (!quellDateien.has(rel)) abweichend.push(`${rel} (nur in der Kopie)`);
  for (const f of abweichend) console.error(`\nWEICHT VON DER QUELLE AB: ${f}`);
}

console.log(
  quelleGeprueft
    ? "Quelle lag vor und wurde mitverglichen."
    : `Quelle (${soll.quelle}) liegt hier nicht — nur die Prüfsummen wurden verglichen. ` +
        "Ob die Familie inzwischen weitergezogen ist, sagt dieser Lauf NICHT."
);

if (geaendert.length + neu.length + weg.length + abweichend.length === 0) {
  console.log("ERGEBNIS: Kopie unverändert und deckungsgleich mit dem gestempelten Stand.");
  process.exit(0);
}

console.error(
  "\nERGEBNIS: Die Kopie stimmt nicht mehr.\n" +
    "Bearbeitet wird die QUELLE in der Audit-Familie, nie diese Kopie. Danach:\n" +
    "  rsync -a --delete --exclude __pycache__ <quelle>/ scripts/pruefungen/\n" +
    "  node scripts/pruefe-vendorierung.mjs --aktualisieren"
);
process.exit(1);
