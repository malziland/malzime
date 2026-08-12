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
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KOPIE = resolve(REPO, "scripts/pruefungen");
/* Bewusst NEBEN dem kopierten Baum, nicht darin: Ein `rsync --delete` beim
   Neu-Einkopieren wuerde eine Datei im Baum loeschen — der Waechter haette
   sich selbst die Sollwerte weggeraeumt. Genau das ist beim ersten Versuch
   passiert. */
const HERKUNFT = resolve(REPO, "scripts/pruefungen-herkunft.json");
const AKTUALISIEREN = process.argv.includes("--aktualisieren");

/* Was beim Vergleich außen vor bleibt, steht hier — sichtbar, mit Grund.
   Eine Ausnahme, die man nicht liest, ist ein Loch. */
const AUSNAHMEN = {
  "README.md": "trägt hier zusätzlich den Herkunftshinweis; Inhalt sonst identisch",
};
const IGNORIERTE_ORDNER = new Set(["__pycache__", ".git"]);

/* Verglichen wird, was das REPOSITORY enthält — nicht, was auf der Platte liegt.
   Der erste Anlauf las den Dateibaum und stempelte damit auch eine
   Beispieldatei, die absichtlich per .gitignore ausgeschlossen ist: lokal
   vorhanden, in der Pipeline nie. Der Wächter war lokal grün und in der CI rot,
   also nutzlos. Dieselbe Lehre wie bei TEST-2026-08-12-29, einen Tag später
   noch einmal gelernt. */
function verfolgteDateien(wurzel) {
  const roh = execFileSync("git", ["ls-files", "-z", "--", wurzel], {
    cwd: REPO,
    encoding: "utf8",
  });
  return roh
    .split("\0")
    .filter(Boolean)
    .map((p) => relative(wurzel, resolve(REPO, p)))
    .filter((p) => !p.split("/").some((teil) => IGNORIERTE_ORDNER.has(teil)))
    .sort();
}

/* Für die QUELLE gibt es kein git — sie liegt außerhalb des Repositorys. Dort
   wird der Dateibaum gelesen, aber nur zum Vergleich mit den verfolgten
   Dateien; Ungleichgewichte in dieser Richtung sind unten ausdrücklich
   behandelt. */
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
const nurInGit = [];
for (const rel of verfolgteDateien(KOPIE)) {
  if (rel in AUSNAHMEN) continue;
  /* Git kennt die Datei, die Platte nicht: gelöscht, aber nicht eingetragen.
     Beim ersten Anlauf stürzte der Wächter hier mit einem Node-Stacktrace ab —
     ein Werkzeug, das beim Melden eines Mangels selbst zerbricht, meldet nichts.
     Gefunden im frischen Klon, nicht im gewachsenen Arbeitsbaum. */
  if (!existsSync(join(KOPIE, rel))) {
    nurInGit.push(rel);
    continue;
  }
  ist[rel] = summe(join(KOPIE, rel));
}
if (nurInGit.length > 0) {
  for (const f of nurInGit) console.error(`IM REPOSITORY, ABER NICHT AUF DER PLATTE: ${f}`);
  console.error("Gelöscht, aber die Löschung nicht eingetragen. Kein bestandener Lauf.");
  process.exit(1);
}

if (AKTUALISIEREN) {
  const alt = existsSync(HERKUNFT) ? JSON.parse(readFileSync(HERKUNFT, "utf8")) : {};
  /* Eine Herkunft ohne Versionsangabe ist keine Herkunft. Beim ersten Mal wird
     sie von Hand eingetragen; danach bleibt sie stehen, bis jemand sie bewusst
     hebt. Still auf "unbekannt" zu fallen hiesse, den Nachweis zu verlieren und
     trotzdem gruen zu melden. */
  if (!alt.familie_version || !alt.quelle) {
    console.error(
      `FEHLER: ${HERKUNFT} braucht 'quelle' und 'familie_version'. ` +
        "Beides von Hand eintragen, dann erneut stempeln."
    );
    process.exit(2);
  }
  writeFileSync(
    HERKUNFT,
    JSON.stringify(
      {
        _hinweis:
          "Herkunft und Prüfsummen der einkopierten Prüfungen (TEST-2026-08-12-28). " +
          "Geprüft von scripts/pruefe-vendorierung.mjs im CI-Job 'pruefungen'. " +
          "Bearbeitet wird die QUELLE, danach neu einkopieren und hier neu stempeln.",
        quelle: alt.quelle || "~/.claude/skills/audit-familie/pruefungen",
        familie_version: alt.familie_version,
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
  console.error(`FEHLER: ${HERKUNFT} ist nicht lesbar: ${fehler.message}`);
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
  /* Verglichen wird ueber die VEREINIGUNG beider Seiten, nicht nur ueber die
     Schluessel der Kopie. KURZAUDIT-Befund TEST-2026-08-13-33: Die erste
     Fassung lief nur ueber die Kopie-Schluessel — eine in der QUELLE neu
     angelegte Datei tauchte darin nie auf, und die erklaerte Richtung "Quelle
     weitergezogen" war damit nur fuer geaenderte, nicht fuer neue Dateien
     umgesetzt. Eine neue Pruefung der Familie haette die CI nie erreicht,
     ohne dass etwas rot wird.

     Was .gitignore der Kopie ausschliesst, bleibt dabei aussen vor: Es kann im
     Repository gar nicht ankommen und ist keine Abweichung, sondern Absicht.
     Massgeblich dafuer ist check-ignore am Zielpfad der Kopie. */
  const alleSeiten = new Set([...Object.keys(ist), ...quellDateien]);
  for (const rel of alleSeiten) {
    if (rel in AUSNAHMEN) continue;
    const inKopie = rel in ist;
    const inQuelle = quellDateien.has(rel);
    if (inKopie && !inQuelle) {
      abweichend.push(`${rel} (nur in der Kopie)`);
    } else if (!inKopie && inQuelle) {
      let ignoriert = false;
      try {
        execFileSync("git", ["check-ignore", "-q", join(KOPIE, rel)], { cwd: REPO });
        ignoriert = true; // Exit 0 = ignoriert, gehoert nicht in die Kopie
      } catch {
        ignoriert = false;
      }
      if (!ignoriert) abweichend.push(`${rel} (NEU in der Quelle, fehlt in der Kopie)`);
    } else if (summe(join(KOPIE, rel)) !== summe(join(quellePfad, rel))) {
      abweichend.push(rel);
    }
  }
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
