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
 * einer SHA-256-Pruefsumme jeder ausgelieferten Datei — der Website (Feld
 * `dateien`) und des Server-Pakets, das zu Google geht (Feld `serverPaket`).
 * Wer wissen will, ob malzi.me wirklich diesen Stand ausliefert, rechnet es
 * mit scripts/pruefe-live.sh nach.
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

/* ── Server-Paket ──────────────────────────────────────────────────────────
   Der Fingerabdruck nennt JEDE Datei, die als Server-Paket zu Google geht —
   das Programm unter functions/src/ ebenso wie package.json und
   package-lock.json (sie legen fest, welche Fremdpakete Google beim Bau
   einsetzt) und die Sprachliste, die das Programm beim Start liest.

   Welche Dateien das sind, bestimmt `functions.ignore` in firebase.json. Die
   Liste dazu bildet der Waechter des Server-Pakets nach den Regeln des
   Werkzeugs; hier wird sie von ihm GEHOLT, nicht ein zweites Mal aufgezaehlt.
   Zwei Aufzaehlungen laufen auseinander: Bis zum 05.10.2026 stand hier eine
   eigene (nur .js-Dateien unter functions/src/) — drei Dateien des Pakets
   fehlten im Fingerabdruck, und keine Pruefung sah eine Aenderung an ihnen.

   Die Pfade sind relativ zum Quellordner des Pakets (functions/).
   scripts/pruefe-live.sh rechnet jede Datei gegen den Inhalt des genannten
   Commits nach und bildet die Liste dafuer selbst aus dem Commit.

   Was das WEITERHIN nicht beweist: dass Google genau diesen Code ausfuehrt.
   Diese Grenze bleibt und wird auch so benannt. */
function serverQuelle() {
  let konfig;
  try {
    konfig = JSON.parse(readFileSync(join(WURZEL, "firebase.json"), "utf8"));
  } catch (err) {
    fehler(`firebase.json nicht lesbar: ${err.message}`);
  }
  const server =
    Array.isArray(konfig.functions) && konfig.functions.length === 1 ? konfig.functions[0] : konfig.functions;
  if (!server || Array.isArray(server) || typeof server.source !== "string" || !server.source) {
    fehler("firebase.json nennt kein (einzelnes) functions.source — der Ordner des Server-Pakets ist unbekannt.");
  }
  return server.source;
}

function serverPaketliste() {
  let ausgabe;
  try {
    ausgabe = execFileSync(
      process.execPath,
      [join(WURZEL, "scripts", "pruefe-auslieferbare-reste.mjs"), "--paketliste"],
      { cwd: WURZEL, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    fehler(
      "Die Dateiliste des Server-Pakets liess sich nicht bilden " +
        `(scripts/pruefe-auslieferbare-reste.mjs --paketliste): ${String(err.stderr || err.message).trim()}`
    );
  }
  return ausgabe.split("\n").filter(Boolean);
}

const SERVER = join(WURZEL, serverQuelle());
const paketDateien = serverPaketliste();
if (paketDateien.length === 0) {
  fehler("Das Server-Paket enthielte keine einzige Datei — das kann nicht stimmen.");
}
const paketSummen = {};
for (const rel of paketDateien) {
  paketSummen[rel] = pruefsumme(join(SERVER, rel));
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
  serverPaket: paketSummen,
};

writeFileSync(ZIEL, JSON.stringify(inhalt, null, 2) + "\n", "utf8");
console.log(
  `  build-info.json geschrieben: ${Object.keys(summen).length} Website-Dateien + ` +
    `${Object.keys(paketSummen).length} Dateien des Server-Pakets, Commit ${inhalt.commitKurz}`
);
