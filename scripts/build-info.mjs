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

/* ── Server-Code ───────────────────────────────────────────────────────────
   Bis 2026-08-18 nannte der Fingerabdruck den Server-Teil nur ueber den
   Commit. Das genuegt, solange die Auslieferung sauber an einen
   veroeffentlichten Stand gebunden ist — genau diese Bindung laesst sich aber
   mit SKIP_STAND=1 umgehen. Dann waere die Commit-Angabe irrefuehrend, ohne
   dass es jemand sehen koennte.
   Mit Pruefsummen ueber functions/src/ ist auch der Server-Teil Datei fuer
   Datei festgenagelt: Wer das Repository hat, rechnet nach, ob der Code darin
   byte-genau der ist, aus dem ausgeliefert wurde.
   Was das WEITERHIN nicht beweist: dass Google genau diesen Code ausfuehrt.
   Diese Grenze bleibt und wird auch so benannt. */
const SERVER = join(WURZEL, "functions", "src");
function serverDateienSammeln(ordner, gesammelt = []) {
  for (const e of readdirSync(ordner, { withFileTypes: true })) {
    const voll = join(ordner, e.name);
    /* Tests und Testdaten laufen nicht im Betrieb — sie gehoeren nicht in
       eine Aussage darueber, was ausgeliefert wurde. */
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      serverDateienSammeln(voll, gesammelt);
      continue;
    }
    if (!e.name.endsWith(".js")) continue;
    gesammelt.push(relative(SERVER, voll));
  }
  return gesammelt.sort();
}

const serverDateien = serverDateienSammeln(SERVER);
if (serverDateien.length === 0) {
  fehler("Keine Dateien unter functions/src/ gefunden — das kann nicht stimmen.");
}
const serverSummen = {};
for (const rel of serverDateien) {
  serverSummen[rel] = pruefsumme(join(SERVER, rel));
}

const jetzt = new Date();
const commitKurz = git("rev-parse", "--short", "HEAD");
const wann = jetzt.toLocaleString("de-AT", { timeZone: "Europe/Vienna", dateStyle: "long", timeStyle: "short" });

const inhalt = {
  /* Wer hier draufklickt, sieht sonst rohes JSON und weiss nicht, was er vor
     sich hat. Die ersten drei Felder sind deshalb Klartext — sie erklaeren
     die Datei, bevor die Zahlenkolonnen kommen. */
  _1_wasIstDas:
    `Diese Website wurde am ${wann} (Wien) aus dem oeffentlichen Quelltext veroeffentlicht, ` +
    `Fassung ${commitKurz}. Darunter steht fuer jede einzelne Datei eine Pruefsumme: eine ` +
    `Zahlenfolge, die sich aendert, sobald sich auch nur ein Zeichen in der Datei aendert.`,
  _2_wozu:
    "Damit kann jeder nachrechnen, ob das, was hier ausgeliefert wird, wirklich dem offenen " +
    "Quelltext entspricht — ohne uns glauben zu muessen.",
  _3_soGehtsSelbst: "git clone https://github.com/malziland/malzime.git && cd malzime && sh scripts/pruefe-live.sh",
  _4_grenze:
    "Belegt wird die Website, die im Browser ankommt, und der Server-Code in diesem Repository. " +
    "Was auf den Rechnern von Google im Inneren ausgefuehrt wird, kann von aussen niemand " +
    "nachrechnen — bei keinem Anbieter. Dafuer gibt es heute kein Verfahren.",
  commit: git("rev-parse", "HEAD"),
  commitKurz,
  zweig: git("rev-parse", "--abbrev-ref", "HEAD"),
  cacheBuster: version,
  ausgeliefertAm: jetzt.toISOString(),
  dateien: summen,
  serverDateien: serverSummen,
};

writeFileSync(ZIEL, JSON.stringify(inhalt, null, 2) + "\n", "utf8");
console.log(
  `  build-info.json geschrieben: ${Object.keys(summen).length} Website-Dateien + ` +
    `${Object.keys(serverSummen).length} Server-Dateien, Commit ${inhalt.commitKurz}`
);
