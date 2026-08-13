#!/usr/bin/env node
/**
 * pruefe-fremddateien.mjs — vergleicht die selbst gehosteten Fremddateien gegen
 * ihre hinterlegten Pruefsummen.
 *
 * AUDIT-BEFUND OSS-2026-08-12-22: Fuer `public/lib/**` und `public/fonts/**` gab es
 * keinen Unveraendertheits-Nachweis. Eine Aenderung an minifiziertem Fremdcode
 * haette niemandem auffallen koennen — der Pull-Request zeigt eine Diff-Zeile in
 * 147 KB Einzeiler. Ausgerechnet `exifr` liest die GPS-Daten, deren Nichtweitergabe
 * die Kernzusage des Projekts ist.
 *
 * Rueckgabewerte: 0 alles unveraendert, 1 Abweichung, 2 Messung nicht durchfuehrbar.
 * Der Wert 2 ist ausdruecklich kein Erfolg (KERN 5c).
 *
 * Aufruf:  node scripts/pruefe-fremddateien.mjs [--aktualisieren]
 * `--aktualisieren` schreibt die Pruefsummen neu — bewusst ein eigener Schalter,
 * damit ein Austausch eine sichtbare Entscheidung bleibt und nicht nebenbei passiert.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/* Einspeisepunkte fuer Tests. Ohne sie liesse sich nur der Gutfall pruefen —
   und eine Pruefung, von der niemand weiss, ob sie ueberhaupt rot werden kann,
   ist keine Pruefung. Im Betrieb sind beide Variablen nicht gesetzt. */
const REPO = resolve(process.env.PRUEFSUMMEN_BASIS || dirname(fileURLToPath(import.meta.url)) + "/..");
const LISTE = process.env.PRUEFSUMMEN_DATEI
  ? resolve(process.env.PRUEFSUMMEN_DATEI)
  : resolve(REPO, "public/lib/PRUEFSUMMEN.json");
const AKTUALISIEREN = process.argv.includes("--aktualisieren");

if (!existsSync(LISTE)) {
  console.error(`FEHLER: ${LISTE} fehlt. Ohne Sollwerte keine Aussage — das ist kein bestandener Test.`);
  process.exit(2);
}

let liste;
try {
  liste = JSON.parse(readFileSync(LISTE, "utf8"));
} catch (fehler) {
  console.error(`FEHLER: ${LISTE} ist nicht lesbar: ${fehler.message}`);
  process.exit(2);
}

const soll = liste.dateien;
if (!soll || typeof soll !== "object" || Object.keys(soll).length === 0) {
  console.error("FEHLER: keine Pruefsummen hinterlegt. Leer ist nicht dasselbe wie sauber.");
  process.exit(2);
}

function summe(pfad) {
  return "sha256:" + createHash("sha256").update(readFileSync(pfad)).digest("hex");
}

const abweichungen = [];
const fehlend = [];
const neu = [];
const ist = {};

for (const [rel, erwartet] of Object.entries(soll)) {
  const pfad = resolve(REPO, rel);
  if (!existsSync(pfad)) {
    fehlend.push(rel);
    continue;
  }
  const gemessen = summe(pfad);
  ist[rel] = gemessen;
  if (gemessen !== erwartet) abweichungen.push({ rel, erwartet, gemessen });
}

/* TEST-2026-08-13-49: Die Schleife oben prüft nur, was in der Liste STEHT.
   Eine neu hinzugefügte Datei unter public/lib/** oder public/fonts/** taucht
   darin nie auf und würde nie geprüft — bei script-src 'self' ist sie
   ausführbar. Genau dieselbe Liste-statt-Fläche-Lücke, die pruefe-vendorierung
   über den Vergleich der verfolgten Dateien schließt. Hier ebenso: git fragen,
   nicht den Dateibaum (geschützt wird, was ausgeliefert wird). Nicht anwendbar,
   wenn über die Einspeisepunkte gegen ein Wegwerf-Verzeichnis gelaufen wird. */
if (!process.env.PRUEFSUMMEN_BASIS) {
  let verfolgt = [];
  try {
    // --cached UND --others --exclude-standard: verfolgte plus neue, aber nicht
    // die von .gitignore ausgeschlossenen. Sonst bleibt eine frisch angelegte,
    // noch nicht committete Fremddatei unsichtbar — genau der gefährliche Fall.
    verfolgt = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "public/lib", "public/fonts"],
      { cwd: REPO, encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      .filter((p) => !p.endsWith("PRUEFSUMMEN.json"));
  } catch {
    console.error("FEHLER: git ls-files nicht ausführbar — Fläche nicht bestimmbar, kein bestandener Lauf.");
    process.exit(2);
  }
  for (const rel of verfolgt) {
    if (!(rel in soll)) neu.push(rel);
  }
}

if (AKTUALISIEREN) {
  liste.dateien = ist;
  liste._erstellt = new Date().toISOString().slice(0, 10);
  writeFileSync(LISTE, JSON.stringify(liste, null, 2) + "\n");
  console.log(`Pruefsummen neu geschrieben: ${Object.keys(ist).length} Dateien.`);
  console.log("Bitte im Pull-Request begruenden, WARUM eine Fremddatei ausgetauscht wurde.");
  process.exit(0);
}

console.log(`FREMDDATEIEN — ${Object.keys(soll).length} hinterlegte Pruefsummen`);

if (fehlend.length > 0) {
  console.error("\nFEHLEN im Arbeitsbaum:");
  for (const f of fehlend) console.error(`  ${f}`);
}
for (const f of neu) {
  console.error(`\nNEU, nicht gestempelt: ${f} (unter public/lib/** oder public/fonts/**, aber ohne Pruefsumme)`);
}
for (const a of abweichungen) {
  console.error(`\nABWEICHUNG: ${a.rel}`);
  console.error(`  erwartet:  ${a.erwartet}`);
  console.error(`  gemessen:  ${a.gemessen}`);
}

if (abweichungen.length === 0 && fehlend.length === 0 && neu.length === 0) {
  console.log("ERGEBNIS: alle Fremddateien unveraendert, keine neue ungestempelte Datei.");
  process.exit(0);
}

console.error(
  `\nERGEBNIS: ${abweichungen.length} Abweichung(en), ${fehlend.length} fehlend, ${neu.length} neu ungestempelt.\n` +
    "Wurde eine Bibliothek bewusst ausgetauscht, dann mit\n" +
    "  node scripts/pruefe-fremddateien.mjs --aktualisieren\n" +
    "neu stempeln UND im Pull-Request begruenden. Sonst ist das ein Befund."
);
process.exit(1);
