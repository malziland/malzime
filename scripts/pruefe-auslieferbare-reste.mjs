#!/usr/bin/env node
/**
 * pruefe-auslieferbare-reste.mjs — liegt in einem der beiden
 * Auslieferungsverzeichnisse etwas, das Firebase mitnaehme und das kein Riegel
 * sieht?
 *
 * Der Sauberkeits-Riegel in deploy.sh prueft `git status --porcelain`. Der
 * zeigt IGNORIERTE Dateien nicht. Firebase richtet sich aber nicht nach
 * .gitignore, sondern nach den ignore-Listen in firebase.json:
 *
 *   1. Website (`hosting.public`): Eine von git ignorierte Datei, die
 *      hosting.ignore nicht ausschliesst, wird ausgeliefert — ohne dass sie
 *      irgendwo auftaucht: nicht im Pull-Request, nicht im Riegel, nicht im
 *      Diff (Runde 7, L-5, 01.09.2026).
 *   2. Server-Paket (`functions.source`): Das Werkzeug packt den ganzen Ordner
 *      ausser dem, was functions.ignore nennt. Jede Datei, die danach im Paket
 *      laege und nicht eingecheckt ist, ginge zu Google, ohne im Repository zu
 *      stehen (OPS-2026-10-03-09).
 *
 * Die Dateiliste des Server-Pakets entsteht hier nach den Regeln des Werkzeugs
 * (firebase-tools: deploy/functions/prepareFunctionsUpload.js und fsAsync.js):
 * Fehlt functions.ignore, gelten `node_modules` und `.git`; in jedem Fall
 * kommen die Debug-Protokolle und `.runtimeconfig.json` dazu. Jeder Eintrag —
 * Datei wie Ordner — wird mit seinem VOLLEN Pfad gegen jedes Muster gehalten
 * (minimatch mit matchBase und dot); ein Ordner, der passt, wird nicht
 * betreten.
 *
 * Rueckgabewerte: 0 sauber, 1 Fundstellen, 2 Messung nicht durchfuehrbar.
 *
 * Aufruf:  node scripts/pruefe-auslieferbare-reste.mjs
 *          node scripts/pruefe-auslieferbare-reste.mjs --paketliste
 *            gibt nur die Dateiliste des Server-Pakets aus (eine Zeile je
 *            Datei, relativ zu functions.source) — damit ein Test dieselbe
 *            Liste pruefen kann, statt die Regeln ein zweites Mal nachzubauen.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, "..");
const NUR_PAKETLISTE = process.argv.includes("--paketliste");

/* Im Listen-Modus gehoert die Standardausgabe allein der Liste — eine
   Meldung dazwischen saehe fuer den Aufrufer wie ein Dateiname aus. */
function melde(...zeilen) {
  for (const zeile of zeilen) (NUR_PAKETLISTE ? console.error : console.log)(zeile);
}

function nichtMessbar(...zeilen) {
  melde(...zeilen);
  process.exit(2);
}

/* minimatch steht als EIGENE Abhaengigkeit in der package.json der Wurzel
   (OSS-2026-10-04-13). Kaeme es nur ueber ein anderes Paket herein (eslint,
   jest), verschwaende es mit dessen naechstem Umbau, ohne dass hier jemand
   etwas geaendert haette. Dass der Eintrag bleibt, haelt der Vertrag in
   scripts/pruefe-deploy-riegel.py fest (SKRIPT_PAKETE) — nicht dieses Skript:
   Es laeuft auch dort, wo es keine package.json gibt (Nachbau eines
   ausgelieferten Stands). Fehlt das Paket, heisst das "nicht messbar" — lieber
   das als ein selbstgebauter Muster-Vergleich, der die Faelle halb trifft. */
let passt;
try {
  const require = createRequire(import.meta.url);
  const m = require("minimatch");
  passt = m.minimatch || m;
} catch {
  nichtMessbar(
    "NICHT MESSBAR: minimatch ist nicht installiert.",
    "               Die ignore-Muster aus firebase.json lassen sich",
    "               ohne Matcher nicht zuverlaessig auswerten.",
    "               Abhilfe: npm ci im Wurzelordner."
  );
}

const KONFIG = join(WURZEL, "firebase.json");
if (!existsSync(KONFIG)) {
  nichtMessbar("NICHT MESSBAR: firebase.json fehlt.");
}

let hosting;
let server;
try {
  const konfig = JSON.parse(readFileSync(KONFIG, "utf8"));
  hosting = Array.isArray(konfig.hosting) ? konfig.hosting[0] : konfig.hosting;
  /* Mehrere Server-Pakete (Codebases) kennt dieses Projekt nicht. Kaemen sie
     dazu, waere "das erste" eine stille Auswahl — dann lieber nicht messen. */
  server = Array.isArray(konfig.functions)
    ? konfig.functions.length === 1
      ? konfig.functions[0]
      : null
    : konfig.functions;
} catch (fehler) {
  nichtMessbar(`NICHT MESSBAR: firebase.json nicht lesbar (${fehler.message}).`);
}

/* -z liefert NUL-getrennte Namen: Leerzeichen und Umlaute in Dateinamen
   zerlegen die Liste sonst genau dort, wo es niemand nachprueft. */
function git(...argumente) {
  try {
    return execFileSync("git", argumente, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  } catch (fehler) {
    nichtMessbar(`NICHT MESSBAR: git ${argumente[0]} ist gescheitert (${fehler.message}).`);
  }
}

/* ── Teil 2 zuerst als Funktion: die Dateiliste des Server-Pakets ───────── */

/* Was das Werkzeug ausschliesst, wenn functions.ignore fehlt … */
const WERKZEUG_VORGABE = ["node_modules", ".git"];
/* … und was es in jedem Fall anhaengt. */
const WERKZEUG_IMMER = ["firebase-debug.log", "firebase-debug.*.log", ".runtimeconfig.json"];

function serverPaket() {
  if (!server?.source || typeof server.source !== "string") {
    nichtMessbar("NICHT MESSBAR: firebase.json nennt kein (einzelnes) functions.source.");
  }
  if (server.ignore !== undefined && !Array.isArray(server.ignore)) {
    nichtMessbar("NICHT MESSBAR: functions.ignore in firebase.json ist keine Liste.");
  }
  const quelle = join(WURZEL, server.source);
  const muster = [...(server.ignore || WERKZEUG_VORGABE), ...WERKZEUG_IMMER];
  const dateien = [];
  const lauf = (ordner) => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const voll = join(ordner, eintrag.name);
      if (muster.some((m) => passt(voll, m, { matchBase: true, dot: true }))) continue;
      /* statSync folgt Verweisen (Symlinks) — wie das Werkzeug. */
      const art = statSync(voll);
      if (art.isFile()) dateien.push(relative(quelle, voll).split(sep).join("/"));
      else if (art.isDirectory()) lauf(voll);
    }
  };
  try {
    lauf(quelle);
  } catch (fehler) {
    nichtMessbar(`NICHT MESSBAR: ${server.source}/ nicht lesbar (${fehler.message}).`);
  }
  if (dateien.length === 0) {
    /* Null Dateien ist kein leeres Paket, sondern ein Messfehler. */
    nichtMessbar(`NICHT MESSBAR: Unter ${server.source}/ bliebe keine einzige Datei im Paket — das kann nicht stimmen.`);
  }
  return { quelle: server.source, muster, dateien: dateien.sort() };
}

if (NUR_PAKETLISTE) {
  process.stdout.write(serverPaket().dateien.join("\n") + "\n");
  process.exit(0);
}

/* ── Teil 1: Website ────────────────────────────────────────────────────── */

if (!hosting?.public || !Array.isArray(hosting.ignore)) {
  nichtMessbar("NICHT MESSBAR: firebase.json nennt kein hosting.public oder keine ignore-Liste.");
}

const VERZEICHNIS = hosting.public;
const MUSTER = hosting.ignore;

const ignoriert = git("status", "--porcelain", "--ignored", "-z", "--", VERZEICHNIS)
  .filter((z) => z.startsWith("!! "))
  .map((z) => z.slice(3));

const durchgerutscht = [];
for (const pfad of ignoriert) {
  /* Die Muster in firebase.json gelten RELATIV zum public-Verzeichnis. */
  const relativ = pfad.startsWith(`${VERZEICHNIS}/`) ? pfad.slice(VERZEICHNIS.length + 1) : pfad;
  const ausgeschlossen = MUSTER.some((m) => passt(relativ, m, { dot: true }));
  if (!ausgeschlossen) durchgerutscht.push(relativ);
}

/* ── Teil 2: Server-Paket ───────────────────────────────────────────────── */

const paket = serverPaket();
const eingecheckt = new Set(
  git("ls-files", "-z", "--", paket.quelle).map((p) => p.slice(paket.quelle.length + 1))
);
if (eingecheckt.size === 0) {
  /* Ohne Vergleichsliste gaelte jede Datei als fremd — das waere kein Befund
     ueber das Paket, sondern ueber die Messung. */
  nichtMessbar(`NICHT MESSBAR: git kennt unter ${paket.quelle}/ keine einzige Datei.`);
}
const fremd = paket.dateien.filter((p) => !eingecheckt.has(p));

/* Die Gegenrichtung, damit eine zu breite Liste nicht als "sauber" durchgeht:
   Ohne package.json und ohne die dort genannte Einstiegsdatei liefe das Paket
   bei Google nicht. */
const fehlt = [];
if (!paket.dateien.includes("package.json")) {
  fehlt.push("package.json");
} else {
  let einstieg;
  try {
    einstieg = JSON.parse(readFileSync(join(WURZEL, paket.quelle, "package.json"), "utf8")).main;
  } catch (fehler) {
    nichtMessbar(`NICHT MESSBAR: ${paket.quelle}/package.json nicht lesbar (${fehler.message}).`);
  }
  if (typeof einstieg !== "string" || !einstieg) {
    nichtMessbar(`NICHT MESSBAR: ${paket.quelle}/package.json nennt keine Einstiegsdatei (main).`);
  }
  const einstiegRelativ = einstieg.replace(/^\.\//, "");
  if (!paket.dateien.includes(einstiegRelativ)) fehlt.push(einstiegRelativ);
}

/* ── Ausgabe ────────────────────────────────────────────────────────────── */

console.log("AUSLIEFERBARE RESTE");
console.log("-".repeat(60));
console.log(`1. Website: ${VERZEICHNIS}/ gegen ${MUSTER.length} ignore-Muster aus firebase.json`);
console.log(`   Ignorierte Dateien dort: ${ignoriert.length}`);
if (durchgerutscht.length === 0) {
  console.log("   ERGEBNIS: keine. Jede ignorierte Datei unter dem Auslieferungs-");
  console.log("             verzeichnis wird von firebase.json ausgeschlossen.");
} else {
  for (const p of durchgerutscht) console.log(`     ${VERZEICHNIS}/${p}`);
  console.log(`   ERGEBNIS: ${durchgerutscht.length} Datei(en) wuerden ausgeliefert, ohne dass`);
  console.log("             git sie zeigt. Entweder in die ignore-Liste von");
  console.log("             firebase.json aufnehmen oder aus dem Verzeichnis entfernen.");
}

console.log("-".repeat(60));
const herkunft = server.ignore
  ? `${server.ignore.length} ignore-Muster aus firebase.json`
  : "KEINE functions.ignore-Liste (Vorgabe des Werkzeugs: node_modules, .git)";
console.log(`2. Server-Paket: ${paket.quelle}/ gegen ${herkunft}`);
console.log(`   Dateien im Paket: ${paket.dateien.length}, davon nicht eingecheckt: ${fremd.length}`);
if (fremd.length === 0 && fehlt.length === 0) {
  console.log("   ERGEBNIS: keine. Jede Datei, die ins Server-Paket ginge, steht im");
  console.log("             Repository.");
}
if (fremd.length > 0) {
  for (const p of fremd) console.log(`     ${paket.quelle}/${p}`);
  console.log(`   ERGEBNIS: ${fremd.length} Datei(en) gingen ins Server-Paket, ohne im`);
  console.log("             Repository zu stehen. Aus dem Verzeichnis entfernen oder in");
  console.log("             functions.ignore von firebase.json aufnehmen.");
}
if (fehlt.length > 0) {
  for (const p of fehlt) console.log(`     ${paket.quelle}/${p}`);
  console.log(`   ERGEBNIS: ${fehlt.length} Datei(en), ohne die das Programm nicht startet, fehlten`);
  console.log("             im Server-Paket. functions.ignore in firebase.json schliesst");
  console.log("             zu viel aus.");
}
console.log("-".repeat(60));

process.exit(durchgerutscht.length > 0 || fremd.length > 0 || fehlt.length > 0 ? 1 : 0);
