#!/usr/bin/env node
/**
 * Audit-Gate — npm-audit als CI-Pflichtcheck, aber mit begruendeter,
 * ABLAUFENDER Ausnahmeliste (.github/audit-allowlist.json).
 *
 * Warum ueberhaupt ein eigenes Gate statt `npm audit --audit-level=high`?
 * Weil das nackte npm-audit einen Alles-oder-nichts-Schalter hat: sobald
 * irgendwo tief in einer FREMDEN Abhaengigkeitskette ein High-Advisory
 * erscheint, fuer das es upstream noch gar keine reparierte Version gibt,
 * steht das Gate dauerhaft auf rot — und blockiert damit JEDEN Pull Request,
 * auch die voellig unbeteiligten. Genau das ist am 2026-07-01 passiert: alle
 * acht Dependabot-PRs scheiterten an einer Luecke, mit der keiner von ihnen
 * etwas zu tun hatte, und mussten von Hand weggeraeumt werden.
 *
 * Dieses Gate loest das, ohne den Schutz aufzuweichen:
 *   - Jedes High/Critical-Advisory blockiert weiterhin — es sei denn, es steht
 *     mit Begruendung auf der Ausnahmeliste.
 *   - Jede Ausnahme hat ein Ablaufdatum. Danach ist das Gate wieder rot. Eine
 *     Ausnahme kann also nicht still vergammeln.
 *   - Ein NEUES Advisory ist nie automatisch ausgenommen.
 *
 * Aufruf:  node scripts/audit-gate.mjs <verzeichnis> [...]
 * Beispiel: node scripts/audit-gate.mjs functions
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUSNAHMEN_DATEI = resolve(REPO, ".github/audit-allowlist.json");
const BLOCKIEREND = new Set(["high", "critical"]);

const ziele = process.argv.slice(2);
if (ziele.length === 0) {
  console.error("Aufruf: node scripts/audit-gate.mjs <verzeichnis> [...]");
  process.exit(2);
}

/** npm audit im JSON-Modus. Exit-Code 1 heisst nur "Funde", nicht "Fehler". */
function auditLesen(verzeichnis) {
  const optionen = {
    cwd: resolve(REPO, verzeichnis),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  };
  let bericht;
  try {
    bericht = JSON.parse(execFileSync("npm", ["audit", "--json", "--omit=dev"], optionen));
  } catch (fehler) {
    /* Exit 1 heisst "Funde gefunden" — dann liegt der Bericht auf stdout. */
    if (!fehler.stdout) throw fehler;
    bericht = JSON.parse(fehler.stdout);
  }

  /* AUDIT-BEFUND OPS-2026-08-12-01: Bei einer Registry-Stoerung schreibt
     `npm audit --json` ebenfalls auf stdout — aber eine Fehlermeldung ohne den
     Schluessel `vulnerabilities`. Der bisherige Code hat das geparst, `?? {}`
     machte daraus null Advisories, und das Gate meldete GRUEN, ohne gemessen zu
     haben. Ein Fehlschlag darf nie wie ein bestandener Lauf enden (KERN 5c).
     Nachgestellt mit `npm_config_registry=http://127.0.0.1:1/`. */
  if (!bericht || typeof bericht.vulnerabilities !== "object" || bericht.vulnerabilities === null) {
    const grund = bericht?.error?.summary ?? bericht?.message ?? "unbekannter Fehler";
    throw new Error(
      `npm audit hat keinen auswertbaren Bericht geliefert (${verzeichnis}): ${grund}\n` +
        "Das ist ein Fehlschlag, kein Freispruch — ungeprueft gilt als nicht bestanden."
    );
  }
  return bericht;
}

/**
 * Zieht die echten Advisories aus dem Audit-Baum.
 * npm listet jede betroffene Kettenstufe einzeln auf, aber nur die Ursache
 * traegt ein Objekt in `via` — die Zwischenstufen verweisen per String zurueck.
 * Wir sammeln also nur die Objekte: ein Eintrag pro echter Luecke, nicht pro
 * mitgerissenem Paket.
 */
function advisoriesSammeln(auditBericht, verzeichnis) {
  const gefunden = new Map();
  for (const eintrag of Object.values(auditBericht.vulnerabilities ?? {})) {
    for (const via of eintrag.via ?? []) {
      if (typeof via !== "object" || !BLOCKIEREND.has(via.severity)) continue;
      const kennung = kennungAus(via.url) ?? `${via.name}@${via.range}`;
      if (!gefunden.has(kennung)) {
        gefunden.set(kennung, {
          kennung,
          paket: via.name,
          schwere: via.severity,
          titel: via.title,
          url: via.url,
          bereich: via.range,
          verzeichnisse: new Set(),
        });
      }
      gefunden.get(kennung).verzeichnisse.add(verzeichnis);
    }
  }
  return gefunden;
}

function kennungAus(url) {
  const treffer = /(GHSA-[0-9a-z-]+)/i.exec(url ?? "");
  return treffer ? treffer[1] : null;
}

function ausnahmenLesen() {
  let roh;
  try {
    roh = readFileSync(AUSNAHMEN_DATEI, "utf8");
  } catch {
    return [];
  }
  const inhalt = JSON.parse(roh);
  return Array.isArray(inhalt.ausnahmen) ? inhalt.ausnahmen : [];
}

/** Heute als reines Datum — Zeitzonen-Rauschen soll das Gate nicht kippen. */
function heute() {
  return new Date().toISOString().slice(0, 10);
}

/* AUDIT-BEFUND OSS-2026-08-12-21: Das Ablaufdatum wurde als Zeichenkette
   verglichen. Ein Eintrag in deutscher Schreibweise ("31.12.2026") ist als Text
   groesser als jedes "20xx-"-Datum — die Ausnahme waere NIE abgelaufen, und
   genau der Ablauf ist die einzige Sicherung dagegen, dass das Ventil zur
   stillen Muellhalde wird. Ebenso wurden die im Dateikopf als Pflicht
   ausgewiesenen Felder nie geprueft.
   Jetzt: Form und Gueltigkeit des Datums pruefen, Pflichtfelder erzwingen. Ein
   fehlerhafter Eintrag ist ein Fehlschlag der Liste, kein stillschweigend
   uebergangener Eintrag. */
const PFLICHTFELDER = ["ghsa", "paket", "schwere", "eingetragen", "kette", "grund", "pruefen_bis"];

function ausnahmenPruefen(ausnahmen) {
  const maengel = [];
  ausnahmen.forEach((a, i) => {
    const name = a && a.ghsa ? a.ghsa : `Eintrag ${i + 1}`;
    for (const feld of PFLICHTFELDER) {
      if (!a || !a[feld]) maengel.push(`${name}: Pflichtfeld "${feld}" fehlt`);
    }
    if (!a || !a.pruefen_bis) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.pruefen_bis)) {
      maengel.push(
        `${name}: pruefen_bis "${a.pruefen_bis}" ist kein Datum der Form JJJJ-MM-TT. ` +
          "Andere Schreibweisen laufen im Zeichenkettenvergleich nie ab."
      );
      return;
    }
    const wert = new Date(`${a.pruefen_bis}T00:00:00Z`);
    if (Number.isNaN(wert.getTime())) {
      maengel.push(`${name}: pruefen_bis "${a.pruefen_bis}" ist kein gueltiges Datum.`);
    }
  });
  return maengel;
}

// --- Ausfuehrung ---------------------------------------------------------

const alleAdvisories = new Map();
for (const verzeichnis of ziele) {
  let bericht;
  try {
    bericht = auditLesen(verzeichnis);
  } catch (fehler) {
    /* Klartext statt Stapelabzug — und Exit 2, damit ein Messfehler von einem
       echten Fund (Exit 1) unterscheidbar bleibt. */
    console.error(`\nGate ROT — die Messung selbst ist gescheitert.\n${fehler.message}`);
    process.exit(2);
  }
  for (const [kennung, advisory] of advisoriesSammeln(bericht, verzeichnis)) {
    const vorhanden = alleAdvisories.get(kennung);
    if (vorhanden) {
      for (const v of advisory.verzeichnisse) vorhanden.verzeichnisse.add(v);
    } else {
      alleAdvisories.set(kennung, advisory);
    }
  }
}

const ausnahmen = ausnahmenLesen();
const ausnahmeMaengel = ausnahmenPruefen(ausnahmen);
if (ausnahmeMaengel.length > 0) {
  console.error("\nGate ROT — die Ausnahmeliste ist fehlerhaft:");
  for (const m of ausnahmeMaengel) console.error(`  ${m}`);
  console.error(
    "\nEine Ausnahme ohne gueltiges Ablaufdatum laeuft nie ab. Erst die Liste\n" +
      "reparieren, dann messen."
  );
  process.exit(2);
}
const nachKennung = new Map(ausnahmen.map((a) => [a.ghsa, a]));
const stichtag = heute();

const blockierend = [];
const abgelaufen = [];
const gedeckt = [];

for (const advisory of alleAdvisories.values()) {
  const ausnahme = nachKennung.get(advisory.kennung);
  if (!ausnahme) {
    blockierend.push(advisory);
  } else if (!ausnahme.pruefen_bis || ausnahme.pruefen_bis < stichtag) {
    abgelaufen.push({ advisory, ausnahme });
  } else {
    gedeckt.push({ advisory, ausnahme });
  }
}

const verwaist = ausnahmen.filter((a) => !alleAdvisories.has(a.ghsa));

// --- Ausgabe -------------------------------------------------------------

console.log(`Audit-Gate — geprueft: ${ziele.join(", ")} (nur Produktiv-Abhaengigkeiten)`);
console.log(`High/Critical-Advisories gesamt: ${alleAdvisories.size}\n`);

for (const { advisory, ausnahme } of gedeckt) {
  console.log(`  [ausgenommen bis ${ausnahme.pruefen_bis}] ${advisory.schwere} ${advisory.paket}`);
  console.log(`      ${advisory.titel}`);
  console.log(`      Grund: ${ausnahme.grund}`);
}

for (const ausnahme of verwaist) {
  console.log(`  [HINWEIS] Ausnahme ${ausnahme.ghsa} (${ausnahme.paket}) greift nicht mehr —`);
  console.log(`      die Luecke ist weg. Eintrag kann aus der Ausnahmeliste geloescht werden.`);
}

for (const { advisory, ausnahme } of abgelaufen) {
  console.error(`\n  [ABGELAUFEN] ${advisory.paket} — Ausnahme lief am ${ausnahme.pruefen_bis} aus.`);
  console.error(`      ${advisory.titel}`);
  console.error(`      ${advisory.url}`);
  console.error(`      Jetzt pruefen: gibt es inzwischen eine reparierte Version?`);
  console.error(`      Wenn ja -> aktualisieren. Wenn nein -> Ablaufdatum bewusst verlaengern.`);
}

for (const advisory of blockierend) {
  console.error(`\n  [BLOCKIERT] ${advisory.schwere} ${advisory.paket} ${advisory.bereich}`);
  console.error(`      ${advisory.titel}`);
  console.error(`      ${advisory.url}`);
  console.error(`      betroffen: ${[...advisory.verzeichnisse].join(", ")}`);
}

if (blockierend.length === 0 && abgelaufen.length === 0) {
  console.log(`\nGate GRUEN — keine ungedeckten High/Critical-Luecken.`);
  process.exit(0);
}

console.error(
  `\nGate ROT — ${blockierend.length} ungedeckt, ${abgelaufen.length} abgelaufen.` +
    `\nEntweder die Abhaengigkeit aktualisieren, oder — wenn es upstream noch keine` +
    `\nreparierte Version gibt — einen begruendeten Eintrag in .github/audit-allowlist.json` +
    `\nanlegen (mit Ablaufdatum!).`,
);
process.exit(1);
