#!/usr/bin/env node
/**
 * pruefe-auslieferbare-reste.mjs — liegt unter `public/` etwas, das Firebase
 * ausliefern wuerde und das kein Riegel sieht?
 *
 * BEFUND 01.09.2026 (Runde 7, L-5): Der Sauberkeits-Riegel in deploy.sh prueft
 * `git status --porcelain`. Der zeigt IGNORIERTE Dateien nicht. Eine Datei, die
 * in .gitignore steht, aber nicht in der ignore-Liste von firebase.json, wird
 * also ausgeliefert, ohne dass sie irgendwo auftaucht — nicht im Pull-Request,
 * nicht im Riegel, nicht im Diff. Heute liegen dort nur .DS_Store-Dateien, die
 * das Punktdatei-Muster ausschliesst; die Luecke bleibt aber offen, und wer sie
 * trifft, merkt es nicht.
 *
 * Rueckgabewerte: 0 sauber, 1 Fundstellen, 2 Messung nicht durchfuehrbar.
 *
 * Aufruf:  node scripts/pruefe-auslieferbare-reste.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, "..");

/* minimatch liegt hier nur als Abhaengigkeit einer Abhaengigkeit. Sich darauf
   zu verlassen hiesse, die Messung von etwas abhaengig zu machen, das ohne
   Ankuendigung verschwinden kann — dann lieber "nicht messbar" als ein
   selbstgebauter Muster-Vergleich, der die Faelle halb trifft. */
let passt;
try {
  const require = createRequire(import.meta.url);
  const m = require("minimatch");
  passt = m.minimatch || m;
} catch {
  console.log("NICHT MESSBAR: minimatch ist nicht installiert.");
  console.log("               Die ignore-Muster aus firebase.json lassen sich");
  console.log("               ohne Matcher nicht zuverlaessig auswerten.");
  process.exit(2);
}

const KONFIG = join(WURZEL, "firebase.json");
if (!existsSync(KONFIG)) {
  console.log("NICHT MESSBAR: firebase.json fehlt.");
  process.exit(2);
}

let hosting;
try {
  const konfig = JSON.parse(readFileSync(KONFIG, "utf8"));
  hosting = Array.isArray(konfig.hosting) ? konfig.hosting[0] : konfig.hosting;
} catch (fehler) {
  console.log(`NICHT MESSBAR: firebase.json nicht lesbar (${fehler.message}).`);
  process.exit(2);
}
if (!hosting?.public || !Array.isArray(hosting.ignore)) {
  console.log("NICHT MESSBAR: firebase.json nennt kein hosting.public oder keine ignore-Liste.");
  process.exit(2);
}

const VERZEICHNIS = hosting.public;
const MUSTER = hosting.ignore;

/* -z liefert NUL-getrennte Namen: Leerzeichen und Umlaute in Dateinamen
   zerlegen die Liste sonst genau dort, wo es niemand nachprueft. */
let roh;
try {
  roh = execFileSync("git", ["status", "--porcelain", "--ignored", "-z", "--", VERZEICHNIS], {
    cwd: WURZEL,
    encoding: "utf8",
  });
} catch (fehler) {
  console.log(`NICHT MESSBAR: git status ist gescheitert (${fehler.message}).`);
  process.exit(2);
}

const ignoriert = roh
  .split("\0")
  .filter(Boolean)
  .filter((z) => z.startsWith("!! "))
  .map((z) => z.slice(3));

const durchgerutscht = [];
for (const pfad of ignoriert) {
  /* Die Muster in firebase.json gelten RELATIV zum public-Verzeichnis. */
  const relativ = pfad.startsWith(`${VERZEICHNIS}/`) ? pfad.slice(VERZEICHNIS.length + 1) : pfad;
  const ausgeschlossen = MUSTER.some((m) => passt(relativ, m, { dot: true }));
  if (!ausgeschlossen) durchgerutscht.push(relativ);
}

console.log("AUSLIEFERBARE RESTE");
console.log(`Geprueft: ${VERZEICHNIS}/ gegen ${MUSTER.length} ignore-Muster aus firebase.json`);
console.log(`Ignorierte Dateien dort: ${ignoriert.length}`);
console.log("-".repeat(60));

if (durchgerutscht.length === 0) {
  console.log("ERGEBNIS: keine. Jede ignorierte Datei unter dem Auslieferungs-");
  console.log("          verzeichnis wird von firebase.json ausgeschlossen.");
  process.exit(0);
}

for (const p of durchgerutscht) console.log(`  ${VERZEICHNIS}/${p}`);
console.log("-".repeat(60));
console.log(`ERGEBNIS: ${durchgerutscht.length} Datei(en) wuerden ausgeliefert, ohne dass`);
console.log("          git sie zeigt. Entweder in die ignore-Liste von");
console.log("          firebase.json aufnehmen oder aus dem Verzeichnis entfernen.");
process.exit(1);
