/**
 * firestore-umzug-sync.mjs — kopiert die dauerhaften Dokumente von der alten
 * Datenbank `(default)` (Standort nam5, USA) in die neue `malzime-eu`
 * (europe-west1).
 *
 * Hintergrund: Audit 2026-08-10, PRIV-001. Der Standort einer Firestore-
 * Datenbank ist unveränderlich; der Umzug läuft über eine zweite Datenbank,
 * ausgewählt durch `FIRESTORE_DATABASE_ID` in functions/src/config.js.
 *
 * NUR DREI DOKUMENTE sind dauerhaft. Alles andere verfällt von selbst:
 *   - `jobs/*`       laufende Aufträge, Lebensdauer 2 h, der Reaper räumt ab
 *   - `usedNonces/*` Einmal-Kennungen der Admin-Links, ebenfalls kurzlebig
 * Die werden bewusst NICHT kopiert — ein Auftrag von vor dem Umschalten wäre
 * beim Weiterpollen ohnehin wertlos, weil das zugehörige Bild schon gelöscht ist.
 *
 * Das Skript ist absichtlich WIEDERHOLBAR: Es wird einmal zur Vorbereitung
 * gefahren und ein zweites Mal unmittelbar vor dem Umschalten, damit die
 * Zählerstände stimmen. Es überschreibt das Ziel vollständig (kein Merge) —
 * die alte Datenbank ist bis zum Umschalten die einzige Wahrheit.
 *
 * Nutzung:
 *   node scripts/firestore-umzug-sync.mjs            # alt  → neu (Vorbereitung)
 *   node scripts/firestore-umzug-sync.mjs --pruefen  # nur vergleichen
 *   node scripts/firestore-umzug-sync.mjs --zurueck  # neu  → alt (Rueckweg)
 *
 * Der Rueckweg wird gebraucht, wenn nach dem Umschalten zurueckgeschaltet
 * werden muss: Dann sind in der neuen Datenbank bereits Zaehler hochgelaufen,
 * die sonst verloren gingen. Erst `--zurueck`, dann den Schalter umlegen.
 */

/* firebase-admin liegt in functions/node_modules, nicht im Projektstamm — die
   Wurzel hat nur die Frontend- und Test-Abhängigkeiten. Deshalb wird der Pfad
   hier ausdrücklich aufgelöst, statt sich auf die normale Modulsuche zu
   verlassen (die würde vom Ort dieser Datei aus nur den Stamm durchsuchen). */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* Verankert in functions/package.json, NICHT in dieser Datei: Nur so sucht
   Node in functions/node_modules und beachtet dabei die exports-Zuordnung des
   Pakets. Ein direkter Dateipfad auf `firebase-admin/app` scheitert, weil
   dieser Unterpfad gar keine Datei ist, sondern ein Eintrag in exports. */
const benoetige = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "functions", "package.json"));
const { initializeApp, applicationDefault } = benoetige("firebase-admin/app");
const { getFirestore } = benoetige("firebase-admin/firestore");

const PROJEKT = "malzime";
const ZIEL_DATENBANK = "malzime-eu";
const NUR_PRUEFEN = process.argv.includes("--pruefen");
const RUECKWAERTS = process.argv.includes("--zurueck");

/* Die dauerhaften Dokumente. Reihenfolge ist egal, sie hängen nicht zusammen. */
const DOKUMENTE = ["featureFlags/current", "stats/current", "stats/totals"];

initializeApp({ credential: applicationDefault(), projectId: PROJEKT });

/* Richtung erst hier festlegen, damit der restliche Ablauf identisch bleibt —
   ein zweiter Codepfad waere die Stelle, an der sich ein Fehler versteckt. */
const alt = getFirestore();
const neu = getFirestore(ZIEL_DATENBANK);
const quelle = RUECKWAERTS ? neu : alt;
const ziel = RUECKWAERTS ? alt : neu;
const NAME_QUELLE = RUECKWAERTS ? `${ZIEL_DATENBANK}, europe-west1` : "default, nam5";
const NAME_ZIEL = RUECKWAERTS ? "default, nam5" : `${ZIEL_DATENBANK}, europe-west1`;

console.log(`Richtung: ${NAME_QUELLE}  →  ${NAME_ZIEL}${NUR_PRUEFEN ? "   (nur vergleichen)" : ""}`);

/* Werte für die Anzeige kürzen — recentAnalyses ist eine lange Zahlenliste,
   die die Ausgabe sonst unlesbar macht. */
function kurz(wert) {
  if (Array.isArray(wert)) return `[${wert.length} Einträge]`;
  /* Firestore-Zeitstempel lesbar machen — sonst steht hier "[object Object]"
     und man sieht nicht, ob der Wert übernommen wurde. */
  if (wert && typeof wert.toDate === "function") return wert.toDate().toISOString();
  const s = String(wert);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

function zeige(titel, daten) {
  console.log(`  ${titel}`);
  if (!daten) {
    console.log("    (nicht vorhanden)");
    return;
  }
  for (const [k, v] of Object.entries(daten)) console.log(`    ${k} = ${kurz(v)}`);
}

let abweichungen = 0;

for (const pfad of DOKUMENTE) {
  console.log(`\n── ${pfad} ─────────────────────────────────────`);
  const q = await quelle.doc(pfad).get();

  if (!q.exists) {
    console.log("  in der Quelle nicht vorhanden — übersprungen");
    continue;
  }

  const daten = q.data();
  zeige(`von (${NAME_QUELLE}):`, daten);

  if (!NUR_PRUEFEN) {
    await ziel.doc(pfad).set(daten);
  }

  const z = await ziel.doc(pfad).get();
  zeige(`nach (${NAME_ZIEL}):`, z.exists ? z.data() : null);

  /* Vergleich über die JSON-Darstellung. Die drei Dokumente enthalten Zahlen,
     Zeichenketten, Wahrheitswerte, eine Zahlenliste und EINEN Zeitstempel
     (`stats/current.hourlyStartedAt`). Zeitstempel serialisieren als
     `{_seconds, _nanoseconds}` und lassen sich damit exakt vergleichen — der
     Vergleich ist hier also scharf, nicht bloss ungefähr. */
  const gleich = z.exists && JSON.stringify(z.data()) === JSON.stringify(daten);
  console.log(`  → ${gleich ? "identisch ✓" : "ABWEICHUNG ✗"}`);
  if (!gleich) abweichungen++;
}

console.log(
  `\n${NUR_PRUEFEN ? "Prüfung" : "Kopie"} abgeschlossen — ` +
    (abweichungen === 0 ? "alle Dokumente identisch." : `${abweichungen} Abweichung(en)!`)
);
process.exit(abweichungen === 0 ? 0 : 1);
