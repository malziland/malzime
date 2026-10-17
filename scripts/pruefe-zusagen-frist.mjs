#!/usr/bin/env node
/**
 * pruefe-zusagen-frist.mjs — die harte Bremse fuer die datierte ZDR-Zusage.
 *
 * Die Datenschutzerklaerung nennt ein Pruefdatum fuer die EU-/Zero-Data-
 * Retention-Zusage und verspricht oeffentlich, spaetestens halbjaehrlich
 * nachzupruefen. Zwei Schichten wachen darueber, beide ueber
 * functions/src/zusagen.js (eine Frist, eine Definition):
 *   - handle-erinnerung.js warnt eine Woche vorher per ntfy-Push.
 *   - DIESE Pruefung macht die Pipeline rot, falls die Vorwarnung untergeht.
 *
 * WARUM EIN EIGENES SKRIPT (17.10.2026): Bis dahin war die Bremse ein Test in
 * der Server-Suite (zusagen-frische.test.js) und machte `test-backend` von der
 * Uhr abhaengig — ein gruenes Ergebnis von gestern konnte heute falsch sein,
 * ohne dass sich eine Zeile geaendert hat. Deshalb durfte die Auslieferung das
 * Ergebnis von test-backend nie aus dem Pull Request uebernehmen und wartete
 * nach dem Zusammenfuehren jedes Mal rund drei Minuten auf die ganze Suite.
 * Jetzt laeuft die Bremse im kurzen Job `datumspruefungen` zusammen mit den
 * anderen Pruefungen, die von der Uhr abhaengen; test-backend sieht nur noch
 * den Inhalt. Geprueft wird dasselbe wie vorher, mit derselben Frist.
 *
 * Aufloesen einer roten Pruefung (5 Minuten):
 *   1. Im Mistral-Dashboard nachsehen, ob Null-Datenspeicherung noch aktiv ist.
 *   2. Screenshot mit Datum in den privaten Nachweisordner legen.
 *   3. Das Datum in public/datenschutz.html an BEIDEN Stellen hochsetzen
 *      (Pruefdatum im Mistral-Absatz + Stand-Zeile im Kopf), Deploy.
 * NIEMALS das Datum ohne echte Pruefung hochsetzen — dann behauptet die
 * Webseite etwas Unbelegtes, und genau das soll diese Pruefung verhindern.
 *
 * Aufruf:  node scripts/pruefe-zusagen-frist.mjs [wurzel] [--jetzt <ms>]
 *   wurzel    Projektordner mit public/datenschutz.html (Vorgabe: .)
 *   --jetzt   NUR fuer die Tests: die Uhr als Millisekunden seit 1970. Die
 *             Pipeline ruft die Pruefung ohne diese Angabe auf (Wortlaut im
 *             Vertrag scripts/pruefe-deploy-riegel.py); ist sie gesetzt, sagt
 *             die Ausgabe es laut.
 *
 * Rueckgabewerte: 0 Frist eingehalten, 1 Frist ueberschritten,
 *                 2 nicht messbar (Seite fehlt, Datum nicht lesbar, Aufruf falsch).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);

let wurzel = ".";
let jetzt = Date.now();
let uhrVorgegeben = false;
const argumente = process.argv.slice(2);
for (let i = 0; i < argumente.length; i++) {
  if (argumente[i] === "--jetzt") {
    const wert = Number(argumente[i + 1]);
    if (!Number.isFinite(wert) || argumente[i + 1] === undefined) {
      console.log("NICHT MESSBAR: --jetzt verlangt eine Zahl (Millisekunden seit 1970).");
      process.exit(2);
    }
    jetzt = wert;
    uhrVorgegeben = true;
    i += 1;
  } else {
    wurzel = argumente[i];
  }
}

const { leseZdrPruefdatum, bewerteFrist, formatiereDatum, FRIST_TAGE } = require("../functions/src/zusagen.js");

const SEITE = join(resolve(wurzel), "public", "datenschutz.html");
let inhalt;
try {
  inhalt = readFileSync(SEITE, "utf8");
} catch (fehler) {
  console.log(`NICHT MESSBAR: ${SEITE} ist nicht lesbar (${fehler.code || fehler.message}).`);
  process.exit(2);
}

const datum = leseZdrPruefdatum(inhalt);
if (!datum) {
  console.log("NICHT MESSBAR: Das ZDR-Pruefdatum steht nicht lesbar in public/datenschutz.html");
  console.log('  (gesucht: "zuletzt am <Tag>. <Monat> <Jahr>"). Wurde die Formulierung geaendert?');
  console.log("  Ein Datum, das niemand lesen kann, ist keine eingehaltene Frist.");
  process.exit(2);
}

if (uhrVorgegeben) {
  console.log(`HINWEIS: Uhr vorgegeben (--jetzt ${jetzt}) — so laufen nur die Tests dieser Pruefung.`);
}

const stand = bewerteFrist(datum, jetzt);
if (stand.tageAlt > FRIST_TAGE) {
  console.log(
    `ROT: Das in der Datenschutzerklaerung genannte Pruefdatum (${formatiereDatum(datum)}) ist ` +
      `${stand.tageAlt} Tage alt (erlaubt: ${FRIST_TAGE}). Die Seite verspricht oeffentlich eine ` +
      "Pruefung mindestens halbjaehrlich."
  );
  console.log(
    "  -> Im Mistral-Dashboard nachsehen, ob Zero Data Retention noch aktiv ist, Screenshot in den " +
      "Nachweisordner legen, DANN das Datum in public/datenschutz.html an beiden Stellen hochsetzen " +
      "(Pruefdatum + Stand-Zeile)."
  );
  console.log("  Das Datum niemals ohne echte Pruefung aendern.");
  process.exit(1);
}

console.log(
  `ok: ZDR-Pruefdatum ${formatiereDatum(datum)} ist ${stand.tageAlt} Tage alt ` +
    `(erlaubt: ${FRIST_TAGE}, noch ${stand.tageBisFrist} Tage).`
);
process.exit(0);
