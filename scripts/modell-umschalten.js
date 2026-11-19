/**
 * Schaltet das Mistral-Modell im Betrieb um — ein Feld, keine Auslieferung.
 *
 * Seit 19.11.2026 waehlt das Feld `modell` im Dokument config/betriebsprofil,
 * welches Modell rechnet (functions/src/betriebsprofil.js). Zeitgrenze,
 * Textmenge und Werbe-Aufruf haengen am Modell (config.js,
 * MODELL_EINSTELLUNGEN) und wechseln mit. Wirkung nach hoechstens rund
 * 30 Sekunden (Zwischenspeicher je Instanz); eine laufende Analyse bleibt bei
 * ihrem Modell. Anleitung: docs/RUNBOOK.md, Abschnitt 3c.
 *
 * SICHERUNGEN, weil dieses Skript in die Produktionsdatenbank schreibt:
 *   · nur Modelle aus ERLAUBTE_MODELLE (config.js);
 *   · der aktive Satz muss zum Modell passen — mit derselben Pruefung, die im
 *     Betrieb entscheidet; sonst liefe danach keine Analyse;
 *   · ohne --ausfuehren wird nur angezeigt;
 *   · es schreibt NUR das Feld modell (update) und misst danach nach;
 *   · es weigert sich, wenn FIRESTORE_EMULATOR_HOST gesetzt ist.
 *
 * Aufruf:
 *   node scripts/modell-umschalten.js mistral-large-2512               nur anzeigen
 *   node scripts/modell-umschalten.js mistral-large-2512 --ausfuehren  wirklich schreiben
 *   … --projekt <projekt-id>                                           anderes Projekt als "malzime"
 */
const pfad = require("path");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("ABBRUCH: FIRESTORE_EMULATOR_HOST ist gesetzt — dieses Skript gilt der echten Datenbank.");
  process.exit(1);
}

const { FIRESTORE_DATABASE_ID, ERLAUBTE_MODELLE, MISTRAL_MODEL } = require(
  pfad.join(wurzel, "functions", "src", "config.js")
);
const { _pruefe } = require(pfad.join(wurzel, "functions", "src", "betriebsprofil.js"));

const modell = process.argv[2];
const ausfuehren = process.argv.includes("--ausfuehren");
const projektStelle = process.argv.indexOf("--projekt");
const PROJEKT = projektStelle === -1 ? "malzime" : process.argv[projektStelle + 1];

if (!ERLAUBTE_MODELLE.includes(modell)) {
  console.error(`ABBRUCH: "${modell || ""}" ist nicht erlaubt. Erlaubt: ${ERLAUBTE_MODELLE.join(", ")}`);
  process.exit(2);
}
if (!PROJEKT || PROJEKT.startsWith("--")) {
  console.error("ABBRUCH: --projekt braucht eine Projekt-ID");
  process.exit(2);
}

const { initializeApp, applicationDefault } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJEKT });
const ref = getFirestore(FIRESTORE_DATABASE_ID).doc("config/betriebsprofil");

(async () => {
  const vorher = await ref.get();
  if (!vorher.exists) throw new Error("config/betriebsprofil existiert nicht");
  const daten = vorher.data();
  const satz = daten.profile && daten.profile[daten.aktiv];
  if (!satz) throw new Error(`aktiver Satz "${daten.aktiv}" fehlt`);
  const jetzt = daten.modell === undefined ? `${MISTRAL_MODEL} (Vorgabe aus config.js)` : daten.modell;
  console.log(`Datenbank:  ${FIRESTORE_DATABASE_ID} (Projekt ${PROJEKT})`);
  console.log(`aktiv:      ${daten.aktiv}`);
  console.log(`Modell:     ${jetzt}  ->  ${modell}`);

  /* Dieselbe Pruefung wie im Betrieb: passt der aktive Satz zum Modell? */
  const grund = _pruefe(satz, modell);
  if (grund) {
    console.error(`ABBRUCH: Der aktive Satz passt nicht zu ${modell}: ${grund}`);
    process.exit(1);
  }
  console.log(`Pruefung:   Satz "${daten.aktiv}" passt zu ${modell}`);

  if (!ausfuehren) {
    console.log(`\nNur angezeigt. Zum Umschalten: node scripts/modell-umschalten.js ${modell} --ausfuehren`);
    process.exit(0);
  }

  await ref.update({ modell });
  const zurueck = (await ref.get()).data();
  if (zurueck.modell !== modell) {
    console.error(`FEHLER: zurueckgelesen "${zurueck.modell}", erwartet "${modell}"`);
    process.exit(1);
  }
  console.log(`\nGESCHRIEBEN und nachgemessen: modell = ${zurueck.modell}`);
  console.log(`Wirkt nach hoechstens rund 30 s. Pruefen: docs/RUNBOOK.md, Abschnitt 3c.`);
  process.exit(0);
})().catch((f) => {
  console.error(`FEHLER: ${f.message}`);
  process.exit(1);
});
