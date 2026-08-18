#!/usr/bin/env node
/**
 * build-info.mjs — schreibt den Fingerabdruck des Ausgelieferten.
 *
 * Das Problem, das es loest: Der Quelltext liegt offen, aber daraus folgt
 * nicht, dass das Offene auch das Laufende ist. Besonders wichtig hier, weil
 * die zentrale Datenschutz-Zusage im FRONTEND durchgesetzt wird — also genau
 * in dem Teil, den jeder herunterladen kann.
 *
 * Erzeugt `public/build-info.json` mit Commit, Zeitpunkt, Cache-Buster und
 * einer SHA-256-Pruefsumme jeder ausgelieferten Datei. Wer wissen will, ob
 * malzi.me wirklich diesen Stand ausliefert, rechnet es mit
 * scripts/pruefe-live.sh nach.
 *
 * WICHTIG: Muss NACH der Cache-Buster-Ersetzung laufen. Sonst stehen in der
 * Datei die Pruefsummen des Zustands VOR der Ersetzung, und jede Nachpruefung
 * meldet Abweichungen, wo keine sind.
 *
 * Aufruf:  node scripts/build-info.mjs <cache-buster-version>
 * Rueckgabe: 0 geschrieben, 2 Aufruf- oder Messproblem.
 */
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OEFFENTLICH = join(WURZEL, "public");
const ZIEL = join(OEFFENTLICH, "build-info.json");

/* Die Datei selbst kann sich nicht enthalten — ihre Pruefsumme haenge davon
   ab, was in ihr steht. */
const SELBST = "build-info.json";

/* Was Firebase Hosting NICHT ausliefert, gehoert auch nicht in den
   Fingerabdruck: Sonst behauptet die Datei etwas ueber Dateien, die auf dem
   Server nie existiert haben, und jede Nachpruefung meldet Fehlalarm.
   Die Liste wird aus firebase.json gelesen, NICHT hier abgeschrieben — eine
   Kopie wuerde beim naechsten Eintrag auseinanderlaufen. */
function ausschluesseLesen() {
  let konfig;
  try {
    konfig = JSON.parse(readFileSync(join(WURZEL, "firebase.json"), "utf8"));
  } catch (err) {
    fehler(`firebase.json nicht lesbar: ${err.message}`);
  }
  const hosting = Array.isArray(konfig.hosting) ? konfig.hosting[0] : konfig.hosting;
  if (!hosting || !Array.isArray(hosting.ignore)) {
    fehler("firebase.json enthaelt keine hosting.ignore-Liste — Ausschluesse unbekannt.");
  }
  return hosting.ignore;
}

/* Uebersetzt die Hosting-Muster in Pruefungen. Bewusst nur die Formen, die
   dort wirklich vorkommen — ein halbherziger Glob-Nachbau waere schlimmer als
   keiner, weil er stillschweigend danebengreift. */
function passtAufMuster(rel, muster) {
  if (muster === "firebase.json") return rel === "firebase.json";
  if (muster === "**/.*") return rel.split("/").some((teil) => teil.startsWith("."));
  const ordner = muster.match(/^\*\*\/(.+)\/\*\*$/);
  if (ordner) return rel.split("/").includes(ordner[1]);
  const pfadOrdner = muster.match(/^(.+)\/\*\*$/);
  if (pfadOrdner) return rel === pfadOrdner[1] || rel.startsWith(pfadOrdner[1] + "/");
  if (!muster.includes("*")) return rel === muster;
  fehler(`Unbekanntes Hosting-Muster in firebase.json: ${muster}`);
  return false;
}


function fehler(text) {
  console.error(`FEHLER: ${text}`);
  process.exit(2);
}

/** Alle Dateien unter public/, relativ und sortiert. */
function dateienSammeln(ordner, muster, gesammelt = []) {
  let eintraege;
  try {
    eintraege = readdirSync(ordner, { withFileTypes: true });
  } catch (err) {
    fehler(`Verzeichnis nicht lesbar: ${ordner} (${err.message})`);
  }
  for (const e of eintraege) {
    const voll = join(ordner, e.name);
    if (e.isDirectory()) {
      dateienSammeln(voll, muster, gesammelt);
      continue;
    }
    const rel = relative(OEFFENTLICH, voll);
    if (rel === SELBST) continue;
    if (muster.some((m) => passtAufMuster(rel, m))) continue;
    gesammelt.push(rel);
  }
  return gesammelt.sort();
}

function pruefsumme(pfad) {
  return "sha256:" + createHash("sha256").update(readFileSync(pfad)).digest("hex");
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: WURZEL, encoding: "utf8" }).trim();
  } catch (err) {
    fehler(`git ${args.join(" ")} fehlgeschlagen: ${err.message}`);
  }
}

const version = process.argv[2];
if (!version || !/^\d{10}$/.test(version)) {
  fehler("Aufruf: node scripts/build-info.mjs <cache-buster-version>, z. B. 2026081307");
}

const muster = ausschluesseLesen();
const dateien = dateienSammeln(OEFFENTLICH, muster);
if (dateien.length === 0) {
  /* Null Dateien ist kein leeres Ergebnis, sondern ein Messfehler. */
  fehler("Keine Dateien unter public/ gefunden — das kann nicht stimmen.");
}

const summen = {};
for (const rel of dateien) {
  const voll = join(OEFFENTLICH, rel);
  if (!statSync(voll).isFile()) continue;
  summen[rel] = pruefsumme(voll);
}

const inhalt = {
  hinweis:
    "Fingerabdruck des ausgelieferten Standes. Nachrechnen: scripts/pruefe-live.sh im Repository github.com/malziland/malzime",
  commit: git("rev-parse", "HEAD"),
  commitKurz: git("rev-parse", "--short", "HEAD"),
  zweig: git("rev-parse", "--abbrev-ref", "HEAD"),
  cacheBuster: version,
  ausgeliefertAm: new Date().toISOString(),
  dateien: summen,
};

writeFileSync(ZIEL, JSON.stringify(inhalt, null, 2) + "\n", "utf8");
console.log(
  `  build-info.json geschrieben: ${Object.keys(summen).length} Dateien, Commit ${inhalt.commitKurz}`
);
