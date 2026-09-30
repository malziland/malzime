#!/usr/bin/env node
/**
 * pruefe-workflows-gueltig.mjs — kann GitHub jede Workflow-Datei lesen?
 *
 * BEFUND K-01 (Pruefschleife Runde 4, 30.09.2026, bestaetigt als P1): Eine
 * Workflow-Datei, die GitHub nicht lesen kann, bestand jede Pruefung. Ein
 * Kommentar mit zu wenig Einzug mitten in einem mehrzeiligen Ausdruck oder ein
 * geschuetztes Leerzeichen (aus einer kopierten Zeile) genuegte. Die Folge fuer
 * den Nachtlauf `sicherheit-nachts.yml`: Er laeuft nie wieder, der Alarm und
 * die Monatsprobe fallen mit ihm aus — und GitHub legt bei jedem Push einen
 * roten Lauf ohne Jobs an, den der Pull Request nicht anzeigt. Kein Test, kein
 * Waechter hat die Dateien je so gelesen, wie GitHub sie liest.
 *
 * Diese Pruefung liest JEDE Datei unter .github/workflows mit dem YAML-Leser,
 * auf dem GitHubs quelloffener Workflow-Leser aufbaut (`yaml`; die Fehler im
 * Befund stammen woertlich aus ihm). Jeder Lesefehler und jede Warnung ist ein
 * Befund; dazu das Grundgeruest eines Workflows: `on`, mindestens ein Job,
 * jeder Job mit `runs-on` oder `uses`. GitHubs Workflow-Leser selbst
 * (@actions/workflow-parser 0.3.61) laesst sich in der veroeffentlichten
 * Fassung unter Node 24 nicht laden (JSON-Import ohne Attribut).
 * Was sie NICHT sieht: ob GitHubs Server eine Datei strenger liest als dieser
 * Leser. Den Rest faengt deploy.sh ab — es zaehlt nur Nachtlaeufe, die nach
 * der letzten Aenderung am Workflow wirklich gelaufen sind.
 *
 * Positivkontrolle: Vor den echten Dateien muss eine absichtlich kaputte Datei
 * als fehlerhaft erkannt werden. Meldet der Leser dort nichts (andere Version,
 * anderes Verhalten), waere jedes Gruen wertlos — dann Rueckgabe 2.
 *
 * Rueckgabewerte: 0 alle lesbar, 1 mindestens eine Datei unlesbar,
 *                 2 Messung nicht durchfuehrbar.
 *
 * Aufruf:  node scripts/pruefe-workflows-gueltig.mjs [ordner]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORDNER = resolve(REPO, process.argv[2] || ".github/workflows");

let YAML;
try {
  YAML = await import("yaml");
} catch (fehler) {
  console.log(`MESSUNG NICHT DURCHFUEHRBAR: Paket yaml fehlt (${fehler.message.split("\n")[0]}).`);
  console.log("  Erst `npm ci` im Hauptordner.");
  process.exit(2);
}

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

function fehlerIn(inhalt) {
  const dok = YAML.parseDocument(inhalt, { uniqueKeys: true, strict: true });
  const fehler = [...dok.errors, ...dok.warnings].map((e) => e.message.split("\n")[0]);
  if (fehler.length) return { fehler, jobs: 0 };
  const wf = dok.toJS();
  if (!istObjekt(wf)) return { fehler: ["kein Workflow (oberste Ebene ist keine Zuordnung)"], jobs: 0 };
  if (!("on" in wf)) fehler.push("es fehlt `on` (wann der Workflow laeuft)");
  const jobs = istObjekt(wf.jobs) ? Object.entries(wf.jobs) : [];
  if (jobs.length === 0) fehler.push("keine Jobs");
  for (const [name, job] of jobs) {
    if (!istObjekt(job)) fehler.push(`Job ${name}: keine Zuordnung`);
    else if (!("runs-on" in job) && !("uses" in job)) fehler.push(`Job ${name}: weder runs-on noch uses`);
  }
  return { fehler, jobs: jobs.length };
}

/* Positivkontrolle: dieselbe Fehlerart wie im Befund — ein Kommentar mit zu
   wenig Einzug mitten in einem mehrzeiligen Ausdruck. */
const KAPUTT = [
  "on: push",
  "jobs:",
  "  a:",
  "    runs-on: ubuntu-latest",
  "    if: >-",
  "      always() &&",
  "    # Kommentar mit zu wenig Einzug",
  "      true",
  "    steps:",
  "      - run: echo x",
  "",
].join("\n");
const kontrolle = fehlerIn(KAPUTT);
if (kontrolle.fehler.length === 0) {
  console.log("MESSUNG NICHT DURCHFUEHRBAR: Der Leser erkennt eine absichtlich kaputte Datei nicht.");
  console.log("  Ohne diese Positivkontrolle waere jedes Gruen wertlos.");
  process.exit(2);
}

if (!existsSync(ORDNER)) {
  console.log(`MESSUNG NICHT DURCHFUEHRBAR: ${relative(REPO, ORDNER)} fehlt.`);
  process.exit(2);
}
const dateien = readdirSync(ORDNER)
  .filter((n) => /\.ya?ml$/.test(n))
  .sort();
if (dateien.length === 0) {
  console.log(`MESSUNG NICHT DURCHFUEHRBAR: keine Workflow-Datei in ${relative(REPO, ORDNER)}.`);
  process.exit(2);
}

let schlecht = 0;
for (const name of dateien) {
  const pfad = join(ORDNER, name);
  const { fehler, jobs } = fehlerIn(readFileSync(pfad, "utf8"));
  if (fehler.length) {
    schlecht++;
    console.log(`  UNLESBAR ${relative(REPO, pfad)}`);
    for (const f of fehler.slice(0, 5)) console.log(`           ${f}`);
  } else {
    console.log(`  ok       ${relative(REPO, pfad)} (${jobs} Job${jobs === 1 ? "" : "s"})`);
  }
}
if (schlecht) {
  console.log(
    `\nERGEBNIS: ${schlecht} von ${dateien.length} Workflow-Datei(en) kann GitHub nicht lesen — ` +
      "sie wuerden nie laufen, und der Pull Request zeigte es nicht an."
  );
  process.exit(1);
}
console.log(`\nERGEBNIS: alle ${dateien.length} Workflow-Dateien lesbar (Positivkontrolle erkannt).`);
