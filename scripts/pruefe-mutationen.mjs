#!/usr/bin/env node
/**
 * pruefe-mutationen.mjs — merken die Tests es, wenn der Code kaputtgeht?
 *
 * ANLASS (Pruefrunde 7, 01.09.2026): Sechs von achtzehn P3-Befunden waren
 * ueberlebende Mutationen — Stellen, an denen sich der Code kaputtmachen
 * laesst, ohne dass ein einziger Test rot wird. Gefunden hat sie ein Pruefer
 * von Hand. Kein Werkzeug im Projekt misst das, also war es Zufall, ob jemand
 * hinsieht. Eine gruene Suite belegt ohne diese Messung nur, dass die Tests
 * durchlaufen — nicht, dass sie etwas pruefen.
 *
 * SO GEHT ES VOR
 *   1. Fuer jede Datei werden Standard-Mutationen gesetzt: Vergleiche
 *      umgedreht, Grenzwerte verschoben, Bedingungen aufgeweicht.
 *   2. Je Mutation laufen ZUERST nur die verwandten Tests (`--findRelatedTests`,
 *      rund 1,3 s statt 141 s fuer die volle Suite).
 *   3. Ueberlebt eine Mutation das, laeuft die VOLLE Suite zur Bestaetigung.
 *      Ohne diesen zweiten Schritt wuerden Luecken gemeldet, die ein
 *      entfernter Test doch faengt.
 *
 * NICHT in Kommentaren und Zeichenketten mutieren. Das ist keine Feinheit:
 * In diesem Projekt stehen die Begruendungen ueber dem Code und nennen genau
 * die Operatoren, um die es geht. Wer das uebersieht, misst seine eigenen
 * Kommentare — derselbe Fehler ist am 01.09. dreimal an anderer Stelle
 * passiert.
 *
 * Rueckgabewerte: 0 alles gedeckt, 1 Mutationen ueberleben, 2 nicht messbar.
 *
 * Aufruf:  node scripts/pruefe-mutationen.mjs [datei ...]
 *          ohne Argumente: die im Zweig geaenderten Produktivdateien
 *          --eichung   nur die Selbstpruefung des Werkzeugs
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, "..");
const FUNCTIONS = join(WURZEL, "functions");

/* ─── Die Mutationen ───────────────────────────────────────────────────────
   Jede beschreibt einen realistischen Fehlgriff, nicht eine beliebige
   Textersetzung. `pruefe` haelt fest, WORAN ein Test sie merken muesste. */
const MUTATIONEN = [
  { name: "Grenze einschliessend", suche: /([^<>=!])>=/g, ersatz: "$1>", pruefe: "Wert genau auf der Grenze" },
  { name: "Grenze ausschliessend", suche: /([^<>=!])>([^=>])/g, ersatz: "$1>=$2", pruefe: "Wert genau auf der Grenze" },
  { name: "Grenze einschliessend (<)", suche: /([^<>=!])<=/g, ersatz: "$1<", pruefe: "Wert genau auf der Grenze" },
  { name: "Grenze ausschliessend (<)", suche: /([^<>=!])<([^=<])/g, ersatz: "$1<=$2", pruefe: "Wert genau auf der Grenze" },
  { name: "Und statt Oder", suche: /&&/g, ersatz: "||", pruefe: "Fall, in dem nur EINE Bedingung gilt" },
  { name: "Oder statt Und", suche: /\|\|/g, ersatz: "&&", pruefe: "Fall, in dem nur EINE Bedingung gilt" },
  { name: "Gleichheit umgedreht", suche: /===/g, ersatz: "!==", pruefe: "beide Zweige der Bedingung" },
  { name: "Ungleichheit umgedreht", suche: /!==/g, ersatz: "===", pruefe: "beide Zweige der Bedingung" },
  { name: "Wahrheitswert gekippt", suche: /\btrue\b/g, ersatz: "false", pruefe: "die Wirkung des Wertes" },
  { name: "Wahrheitswert gekippt", suche: /\bfalse\b/g, ersatz: "true", pruefe: "die Wirkung des Wertes" },
];

/** Bereiche einer Zeile, die zu Kommentar oder Zeichenkette gehoeren. */
function tabuBereiche(zeile, imBlockKommentar) {
  const tabu = [];
  let i = 0;
  let block = imBlockKommentar;
  if (block) {
    const ende = zeile.indexOf("*/");
    if (ende === -1) return { tabu: [[0, zeile.length]], block: true };
    tabu.push([0, ende + 2]);
    i = ende + 2;
    block = false;
  }
  let anfuehrung = null;
  let start = 0;
  for (; i < zeile.length; i += 1) {
    const c = zeile[i];
    const naechstes = zeile[i + 1];
    if (anfuehrung) {
      if (c === "\\") { i += 1; continue; }
      if (c === anfuehrung) { tabu.push([start, i + 1]); anfuehrung = null; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { anfuehrung = c; start = i; continue; }
    if (c === "/" && naechstes === "/") { tabu.push([i, zeile.length]); break; }
    if (c === "/" && naechstes === "*") {
      const ende = zeile.indexOf("*/", i + 2);
      if (ende === -1) { tabu.push([i, zeile.length]); block = true; break; }
      tabu.push([i, ende + 2]);
      i = ende + 1;
    }
  }
  if (anfuehrung) tabu.push([start, zeile.length]);
  return { tabu, block };
}

const imTabu = (tabu, pos) => tabu.some(([a, b]) => pos >= a && pos < b);

/* Ein `||` vor einem festen Wert ist ein VORGABEWERT, keine Logik:
   `x || ""`, `port || 5001`, `liste || []`, `err?.message || String(err)`.
   Die Mutation zu `&&` ergibt dort Unsinn, und ein Test dagegen waere
   kuenstlich — er pruefte eine Zeile, die nie anders gemeint war. Solche
   Meldungen sind genau das Rauschen, an dem Waechter sterben: Wer zwanzig
   davon wegklickt, uebersieht die eine echte. */
function istVorgabewert(zeile, pos) {
  const danach = zeile.slice(pos + 2).trimStart();
  return /^(["'`]|-?\d|\[\]|\{\}|null\b|undefined\b|String\(|Number\(|Boolean\()/.test(danach);
}

/** Welche Zeilen dieser Datei hat der Zweig geaendert? (1-basiert)
 *
 * BEFUND aus dem ersten Lauf (01.09.2026): Ganze Dateien zu mutieren dauerte
 * 80 Minuten fuer acht Dateien und meldete 122 Verdachte — die meisten in
 * Code, den seit Monaten niemand angefasst hat. Das ist zweimal falsch: Es
 * kostet Zeit, die keine Kette hat, und es vermischt Altbestand mit dem, was
 * gerade entstanden ist. Geprueft gehoert, was sich AENDERT; der Altbestand
 * ist eine eigene Aufgabe mit eigener Entscheidung.
 */
function geaenderteZeilen(datei) {
  let roh;
  try {
    roh = execFileSync("git", ["diff", "-U0", "origin/main...HEAD", "--", datei], {
      cwd: WURZEL,
      encoding: "utf8",
    });
  } catch {
    return null; // nicht ermittelbar — der Aufrufer entscheidet
  }
  const zeilen = new Set();
  for (const z of roh.split("\n")) {
    /* @@ -alt,n +neu,m @@ — uns interessiert die NEUE Seite. */
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(z);
    if (!m) continue;
    const start = Number(m[1]);
    const anzahl = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < anzahl; i += 1) zeilen.add(start + i);
  }
  return zeilen;
}

/** Alle moeglichen Mutationen einer Datei — Kommentare und Texte ausgenommen. */
function findeMutationen(inhalt) {
  const zeilen = inhalt.split("\n");
  const gefunden = [];
  let block = false;
  zeilen.forEach((zeile, nr) => {
    const { tabu, block: neuerBlock } = tabuBereiche(zeile, block);
    const warBlock = block;
    block = neuerBlock;
    if (warBlock && tabu.length === 1 && tabu[0][1] === zeile.length) return;
    for (const m of MUTATIONEN) {
      m.suche.lastIndex = 0;
      let treffer;
      while ((treffer = m.suche.exec(zeile)) !== null) {
        const pos = treffer.index + (treffer[1] ? treffer[1].length : 0);
        if (imTabu(tabu, pos)) continue;
        if (m.name === "Oder statt Und" && istVorgabewert(zeile, pos)) continue;
        const neu =
          zeile.slice(0, treffer.index) +
          treffer[0].replace(m.suche.source.includes("$1") ? m.suche : new RegExp(m.suche.source), m.ersatz).replace(/\$(\d)/g, (_, n) => treffer[Number(n)] || "") +
          zeile.slice(treffer.index + treffer[0].length);
        if (neu === zeile) continue;
        gefunden.push({ zeileNr: nr, spalte: pos + 1, alt: zeile, neu, name: m.name, pruefe: m.pruefe });
      }
    }
  });
  return gefunden;
}

/** Laesst Tests laufen.
 *
 * Rueckgabe: "rot" | "gruen" | "nicht-gelaufen"
 *
 * BEFUND 01.09.2026 (Pruefrunde 8, M-P1-1 — der schwerste Befund gegen dieses
 * Werkzeug): Hier stand `catch { return true; }` — JEDER Fehlschlag von jest
 * galt als "Mutation bemerkt". Kann jest gar nicht starten, weil die Pakete
 * fehlen, meldete das Werkzeug damit **100 % gruen und Rueckgabewert 0**,
 * ohne einen einzigen Test ausgefuehrt zu haben. Genau dieser Zustand lag im
 * CI-Job `pruefungen` vor: Er fuehrt kein `npm ci` aus.
 *
 * Gemessen am selben Dateisatz: mit Paketen 67 % und zwei echte Luecken
 * (darunter `queue-storage.js:93`, der offene Punkt aus dem Vorfall vom
 * 31.08.), ohne Pakete "keine Luecke, Rueckgabewert 0".
 *
 * Das ist die Fehlerform, gegen die dieses Werkzeug gebaut wurde — ein Gruen
 * ohne Messung, eine Ebene hoeher. Jetzt wird unterschieden: Nur ein Lauf,
 * der Tests AUSGEFUEHRT hat, darf ein Urteil begruenden.
 */
function testsWerdenRot(argumente) {
  /* spawnSync statt execFileSync: Jest schreibt die Zusammenfassung ("Tests:
     N passed") auf STDERR, auch im Erfolgsfall. execFileSync gibt aber nur
     stdout zurueck — die Zeile fehlte dann, und jeder erfolgreiche Lauf waere
     als "nicht-gelaufen" gewertet worden. Aufgefallen ist das erst durch die
     neue Eichprobe, die den Erfolgsfall misst. */
  const lauf = spawnSync("npx", ["jest", ...argumente, "--silent"], {
    cwd: FUNCTIONS,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  if (lauf.error && lauf.error.code === "ENOENT") return "nicht-gelaufen";
  const ausgabe = `${lauf.stdout || ""}${lauf.stderr || ""}`;
  const lief = lauf.status === 0;
  /* Jest meldet die Zahl gelaufener Tests. Steht dort 0 — oder fehlt die
     Zeile ganz —, ist nichts gemessen worden, egal welcher Rueckgabewert
     herauskam. */
  const zahl = /^Tests:\s+(.*)$/m.exec(ausgabe || "");
  if (!zahl) return "nicht-gelaufen";
  if (/^\s*0 total/.test(zahl[1])) return "nicht-gelaufen";
  return lief ? "gruen" : "rot";
}

export { findeMutationen, tabuBereiche, MUTATIONEN };

/* Ein Import darf NICHTS tun. Beim Bauen dieses Werkzeugs hat genau das
   zugeschlagen: Ein `import` zum Nachsehen startete den vollen Lauf, zwei
   Prozesse mutierten gleichzeitig dieselben Dateien, und nach dem Abbruch
   blieb eine Mutation im Arbeitsbaum liegen (cloud-tasks.js, Oder->Und).
   Dieselbe Falle, gegen die dieses Werkzeug schuetzen soll — nur eine Ebene
   hoeher. */
const ISTHAUPTLAUF =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ─── Eichung: erst messen, ob das Messmittel misst ────────────────────── */
function eichung() {
  console.log("EICHUNG — findet das Werkzeug eine bekannte Luecke?");
  const proben = [
    {
      was: "Kommentar wird NICHT mutiert",
      code: "// hier steht a > b und true\nconst x = 1;\n",
      erwartet: 0,
    },
    {
      was: "Zeichenkette wird NICHT mutiert",
      code: 'const s = "a >= b && true";\n',
      erwartet: 0,
    },
    {
      was: "echter Vergleich WIRD mutiert",
      code: "const f = (n) => n >= 3;\n",
      erwartet: 1,
    },
    {
      was: "Blockkommentar ueber mehrere Zeilen wird NICHT mutiert",
      code: "/* a >= b\n   c && d */\nconst y = 2;\n",
      erwartet: 0,
    },
  ];
  /* Der Rauschfilter braucht eine eigene Probe in BEIDE Richtungen. Ein
     Filter, der zu scharf wird, schluckt echte Befunde — und niemand merkt
     es, weil das Ergebnis dann besser aussieht. */
  const filterproben = [
    { was: "Vorgabewert (Zeichenkette) wird uebergangen", code: 'const x = a || "";\n', erwartet: 0 },
    { was: "Vorgabewert (Zahl) wird uebergangen", code: "const p = env.PORT || 5001;\n", erwartet: 0 },
    { was: "Vorgabewert (Funktionswert) wird uebergangen", code: "const g = e?.m || String(e);\n", erwartet: 0 },
    { was: "echte Oder-Logik bleibt messbar", code: "if (a || b) return;\n", erwartet: 1 },
  ];
  /* BEFUND 01.09.2026 (Pruefrunde 8): Die Eichung prueft NUR findeMutationen.
     `testsWerdenRot` — die Funktion, die ueber jedes Urteil entscheidet — kam
     in keiner Probe vor. Genau dort sass der schwerste Befund: Sie hielt einen
     gescheiterten jest-Start fuer ein rotes Testergebnis. Eine Eichung, die
     die entscheidende Funktion auslaesst, ist Zierde.

     Diese Probe faehrt einen echten jest-Lauf in einer Umgebung ohne Pakete
     und verlangt, dass er als "nicht-gelaufen" erkannt wird. */
  let fehler = 0;
  const leer = mkdtempSync(join(tmpdir(), "malzime-eichung-"));
  try {
    const alterOrt = process.env.PATH;
    /* Kein npx auffindbar: muss "nicht-gelaufen" ergeben, nicht "rot". */
    process.env.PATH = leer;
    const ohneWerkzeug = testsWerdenRot(["--findRelatedTests", "src/notify.js"]);
    process.env.PATH = alterOrt;
    const ok = ohneWerkzeug === "nicht-gelaufen";
    if (!ok) fehler += 1;
    console.log(
      `  ${ok ? "ja  " : "NEIN"}  ein gescheiterter Testlauf gilt NICHT als "bemerkt" ` +
        `(${ohneWerkzeug}, erwartet nicht-gelaufen)`
    );
    /* Und die Gegenrichtung: Ein echter Lauf muss ein echtes Urteil liefern. */
    const echt = testsWerdenRot(["--findRelatedTests", "src/notify.js"]);
    const ok2 = echt === "gruen" || echt === "rot";
    if (!ok2) fehler += 1;
    console.log(
      `  ${ok2 ? "ja  " : "NEIN"}  ein echter Testlauf liefert ein Urteil (${echt})`
    );
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }

  for (const p of proben) {
    const n = findeMutationen(p.code).length;
    const ok = n === p.erwartet;
    if (!ok) fehler += 1;
    console.log(`  ${ok ? "ja  " : "NEIN"}  ${p.was} (${n} gefunden, ${p.erwartet} erwartet)`);
  }
  for (const p of filterproben) {
    const n = findeMutationen(p.code).filter((x) => x.name === "Oder statt Und").length;
    const ok = n === p.erwartet;
    if (!ok) fehler += 1;
    console.log(`  ${ok ? "ja  " : "NEIN"}  ${p.was} (${n} gefunden, ${p.erwartet} erwartet)`);
  }
  return fehler;
}

/* ─── Sicherung gegen harten Abbruch ──────────────────────────────────────
   `finally` laeuft bei SIGTERM/SIGINT NICHT. Beim Bauen dieses Werkzeugs ist
   genau das zweimal passiert: Nach dem Abbruch blieb eine Mutation im
   Arbeitsbaum liegen. `selbstpruefung-waechter.sh` loest dasselbe seit dem
   31.08. mit `trap ... EXIT INT TERM`; hier ist das Gegenstueck. */
let inArbeit = null; // { datei, original }

function stelleWiederHer(grund) {
  if (!inArbeit) return;
  const { datei, original } = inArbeit;
  inArbeit = null;
  try {
    writeFileSync(datei, original);
    const heil = readFileSync(datei, "utf8") === original;
    console.log(`\n${grund}: ${relative(WURZEL, datei)} ${heil ? "wiederhergestellt" : "NICHT wiederhergestellt — bitte pruefen!"}`);
  } catch (fehler) {
    console.log(`\n${grund}: Wiederherstellung von ${datei} gescheitert: ${fehler.message}`);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stelleWiederHer(`Abbruch (${signal})`);
    process.exit(130);
  });
}
process.on("uncaughtException", (fehler) => {
  stelleWiederHer("Unerwarteter Fehler");
  console.error(fehler);
  process.exit(2);
});

/* ─── Hauptlauf ───────────────────────────────────────────────────────── */
if (!ISTHAUPTLAUF) {
  /* Als Modul geladen: nur die Funktionen bereitstellen, nichts ausfuehren. */
} else {
const argumente = process.argv.slice(2);
if (argumente.includes("--eichung")) {
  process.exit(eichung() === 0 ? 0 : 1);
}

const eichfehler = eichung();
if (eichfehler > 0) {
  console.log("\nNICHT MESSBAR: Die Eichung ist fehlgeschlagen.");
  console.log("               Ein Messmittel, das sich selbst nicht besteht,");
  console.log("               darf keine Aussage ueber den Code treffen.");
  process.exit(2);
}
console.log();

let dateien = argumente.filter((a) => !a.startsWith("--"));
if (dateien.length === 0) {
  try {
    const roh = execFileSync("git", ["diff", "origin/main...HEAD", "--name-only"], {
      cwd: WURZEL,
      encoding: "utf8",
    });
    dateien = roh
      .split("\n")
      .filter((z) => /^functions\/src\/.*\.js$/.test(z) && !z.includes("__tests__"))
      .map((z) => join(WURZEL, z));
  } catch {
    console.log("NICHT MESSBAR: git diff gegen origin/main ist gescheitert.");
    process.exit(2);
  }
}
dateien = dateien.map((d) => resolve(d)).filter((d) => existsSync(d));
if (dateien.length === 0) {
  /* BEFUND 01.09.2026 (Pruefrunde 8, M-P1-2): Hier stand `exit 2`. Beim Push
     auf `main` — und beim woechentlichen Zeitplan-Lauf — zeigt `origin/main`
     auf denselben Commit, der Diff ist leer, und der Pflicht-Check waere JEDES
     MAL rot geworden. `pruefe-mitzieher.py` und `pruefe-kopplung.py` behandeln
     denselben Fall im selben Job seit jeher als Normalfall.
     Ohne Argumente und ohne Aenderung gibt es nichts zu messen — das ist kein
     Messproblem, sondern ein leerer Auftrag. Wurden dagegen Dateien AUSDRUECK-
     LICH genannt und existieren nicht, bleibt es ein Messproblem. */
  if (argumente.some((a) => !a.startsWith("--"))) {
    console.log("NICHT MESSBAR: die genannten Dateien gibt es nicht.");
    process.exit(2);
  }
  console.log("Keine geaenderten Dateien gegenueber origin/main — nichts zu pruefen.");
  console.log("(Beim Lauf auf main ist das der Normalfall.)");
  process.exit(0);
}

/* Nur auf sauberem Baum messen: Sonst laesst sich hinterher nicht
   unterscheiden, was von diesem Lauf stammt und was schon da war. */
try {
  const offen = execFileSync("git", ["status", "--porcelain", "--", "functions/src"], {
    cwd: WURZEL,
    encoding: "utf8",
  }).trim();
  if (offen) {
    console.log("NICHT MESSBAR: functions/src hat ungespeicherte Aenderungen.");
    console.log("               Dieses Werkzeug aendert Dateien und nimmt die");
    console.log("               Aenderung zurueck — bei offenen Aenderungen");
    console.log("               waere hinterher nicht unterscheidbar, was von");
    console.log("               wem stammt. Erst committen oder aufraeumen.");
    process.exit(2);
  }
} catch {
  console.log("NICHT MESSBAR: git status ist gescheitert.");
  process.exit(2);
}

const BESTAETIGEN = argumente.includes("--bestaetigen");
/* Vorgabe: nur die geaenderten Zeilen. `--alles` nimmt die ganzen Dateien —
   das ist die Bestandsaufnahme und dauert Stunden, nicht Minuten. */
const NURGEAENDERTE = !argumente.includes("--alles");
let nichtMessbar = 0;

/* ZEITGRENZE JE DATEI (Messung 01.09.2026, nach dem ersten langen Lauf):
   Die schnelle Stufe ist nur schnell, wenn wenige Tests die Datei anfassen.
   `notify.js` haengen 7 Testdateien an, `mistral-antwort.js` aber 18 — dort
   dauert ein einzelner "schneller" Lauf 102 s, bei einer vollen Suite von
   141 s. Fuer zentrale Module gibt es also gar keine schnelle Stufe, und
   56 Mutationen bedeuten 95 Minuten fuer EINE Datei.

   Statt so zu tun, als liesse sich alles messen, bekommt jede Datei ein
   Zeitfenster. Was darin nicht geprueft wurde, wird als UNGEMESSEN
   ausgewiesen — nicht als gruen. Das ist derselbe dritte Zustand, den die
   uebrigen Waechter dieses Projekts kennen. */
const zeitArg = argumente.find((a) => a.startsWith("--zeitgrenze="));
const ZEITGRENZE_MS = (zeitArg ? Number(zeitArg.split("=")[1]) : 10) * 60 * 1000;
let ungemessen = 0;
console.log(
  `MUTATIONSPROBE — ${dateien.length} Datei(en), ` +
    `${NURGEAENDERTE ? "nur geaenderte Zeilen" : "GANZE Dateien (Bestandsaufnahme)"}` +
    `${BESTAETIGEN ? ", mit Bestaetigung durch die volle Suite" : ""}`
);
console.log("-".repeat(64));

const ueberlebende = [];
let gesetzt = 0;

for (const datei of dateien) {
  const original = readFileSync(datei, "utf8");
  const kurz = relative(WURZEL, datei);
  let mutationen = findeMutationen(original);
  if (!NURGEAENDERTE) {
    // ganze Datei: Bestandsaufnahme
  } else {
    const zeilen = geaenderteZeilen(kurz);
    if (zeilen === null) {
      console.log(`  ?     ${kurz}: NICHT MESSBAR (git diff gescheitert)`);
      nichtMessbar += 1;
      continue;
    }
    mutationen = mutationen.filter((m) => zeilen.has(m.zeileNr + 1));
    if (mutationen.length === 0) {
      console.log(`  ok    ${kurz}: keine mutierbare Stelle in den geaenderten Zeilen`);
      continue;
    }
  }
  let tot = 0;
  const hier = [];

  process.stdout.write(`  ...   ${kurz}: ${mutationen.length} Mutationen`);
  const beginn = Date.now();
  let geprueft = 0;
  let abgebrochen = false;
  for (const m of mutationen) {
    if (Date.now() - beginn > ZEITGRENZE_MS) {
      abgebrochen = true;
      break;
    }
    geprueft += 1;
    process.stdout.write(".");
    const zeilen = original.split("\n");
    zeilen[m.zeileNr] = m.neu;
    inArbeit = { datei, original };
    writeFileSync(datei, zeilen.join("\n"));
    gesetzt += 1;
    try {
      /* Schnell: nur die Tests, die diese Datei anfassen. */
      const schnell = testsWerdenRot(["--findRelatedTests", relative(FUNCTIONS, datei)]);
      if (schnell === "nicht-gelaufen") {
        stelleWiederHer("Abbruch");
        console.log("\n\nABBRUCH: Die Tests konnten nicht ausgefuehrt werden.");
        console.log("         Ohne einen Testlauf hat dieses Werkzeug nichts zu");
        console.log("         sagen — weder gruen noch rot. Fehlen die Pakete?");
        console.log("         (`npm ci --prefix functions`)");
        process.exit(2);
      }
      if (schnell === "rot") {
        tot += 1;
        continue;
      }
      /* Ueberlebt die verwandten Tests. `--findRelatedTests` sieht nur
         direkte Abhaengigkeiten — ein entfernter Test koennte es doch
         fangen. Ohne Bestaetigung ist das ein VERDACHT, kein Befund. */
      if (BESTAETIGEN) {
        const voll = testsWerdenRot([]);
        if (voll === "nicht-gelaufen") {
          stelleWiederHer("Abbruch");
          console.log("\n\nABBRUCH: Die volle Suite konnte nicht ausgefuehrt werden.");
          process.exit(2);
        }
        if (voll === "rot") {
          tot += 1;
          continue;
        }
      }
      hier.push(m);
    } finally {
      writeFileSync(datei, original);
      inArbeit = null;
      /* WIEDERHERSTELLUNG PRUEFEN, nicht nur ausfuehren (Lehre 31.08.). */
      if (readFileSync(datei, "utf8") !== original) {
        console.log(`\nABBRUCH: ${kurz} konnte nicht wiederhergestellt werden.`);
        process.exit(2);
      }
    }
  }

  const zeichen = abgebrochen ? "TEIL" : hier.length === 0 ? "ok  " : "LUECKE";
  process.stdout.write("\r\x1b[2K");
  if (abgebrochen) {
    const offen = mutationen.length - geprueft;
    ungemessen += offen;
    console.log(
      `  ${zeichen}  ${kurz}: ${tot} von ${geprueft} bemerkt — ${offen} UNGEMESSEN (Zeitfenster von ${ZEITGRENZE_MS / 60000} Min erschoepft)`
    );
  } else {
    console.log(`  ${zeichen}  ${kurz}: ${tot} von ${mutationen.length} bemerkt`);
  }
  for (const m of hier) {
    console.log(`         Zeile ${m.zeileNr + 1}, Spalte ${m.spalte}: ${m.name}`);
    console.log(`           ${m.alt.trim().slice(0, 90)}`);
    console.log(`           Kein Test prueft: ${m.pruefe}`);
    ueberlebende.push({ datei: kurz, ...m });
  }
}

console.log("-".repeat(64));
const quote = gesetzt === 0 ? 0 : Math.round(((gesetzt - ueberlebende.length) / gesetzt) * 100);
console.log(`${gesetzt} Mutationen gesetzt, ${gesetzt - ueberlebende.length} bemerkt (${quote} %).`);
if (nichtMessbar > 0) {
  console.log(`ACHTUNG: ${nichtMessbar} Datei(en) waren nicht messbar — siehe oben.`);
}
if (ungemessen > 0) {
  console.log(`ACHTUNG: ${ungemessen} Mutation(en) blieben UNGEMESSEN (Zeitfenster).`);
  console.log("         Das ist kein Freispruch — nur eine Aussage darueber,");
  console.log("         wie weit gemessen wurde. Mit --zeitgrenze=<Min> mehr.");
}
if (ueberlebende.length === 0) {
  if (nichtMessbar > 0 || ungemessen > 0) {
    console.log("ERGEBNIS: keine Luecke in dem, was gemessen wurde — aber es");
    console.log("          wurde nicht alles gemessen. Das ist kein gruen.");
    process.exit(2);
  }
  console.log("ERGEBNIS: keine Luecke. Jede Aenderung am Code macht Tests rot.");
  process.exit(0);
}
if (BESTAETIGEN) {
  console.log(`ERGEBNIS: ${ueberlebende.length} Mutation(en) ueberleben die VOLLE Suite —`);
  console.log("          an diesen Stellen laesst sich der Code kaputtmachen,");
  console.log("          ohne dass ein einziger Test es merkt.");
} else {
  console.log(`ERGEBNIS: ${ueberlebende.length} VERDACHT(E). Geprueft wurden nur die`);
  console.log("          Tests, die diese Dateien direkt anfassen. Mit");
  console.log("          `--bestaetigen` laeuft je Verdacht die volle Suite —");
  console.log("          erst danach ist es ein Befund.");
}
process.exit(1);
}
