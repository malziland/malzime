/** Macht den Einstellungssatz absichtlich kaputt — fuer die Szenarien.
 *  Verbindung wie im Produktivcode (benannte Datenbank). */
const pfad = require("path");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
const { SATZ } = require(pfad.join(wurzel, "functions", "src", "test-satz.js"));

const art = process.argv[2] || "feld-weg";
/* OPS-2026-08-31-14: NUR gegen den Emulator. Ohne FIRESTORE_EMULATOR_HOST
   schreibt dieses Skript auf `config/betriebsprofil` in der PRODUKTION — den
   Satz, der die laufende Anwendung steuert. Genau so entstanden am 30.08. die
   Werte parallelitaet=7 / rate=0.5 im Betrieb; ein Nutzer bekam daraufhin eine
   Ueberlastmeldung. Das Schwesterskript lasttest-umstellen.js hat den Riegel
   bereits; diese beiden waren uebersehen worden. */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "   ABBRUCH: FIRESTORE_EMULATOR_HOST ist nicht gesetzt.\n" +
      "   Dieses Skript wuerde den Einstellungssatz der PRODUKTION ueberschreiben.\n" +
      "   Aufruf mit: FIRESTORE_EMULATOR_HOST=localhost:8080 node " + "scripts/simulator-satz-kaputt.js" + " ..."
  );
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);

const kaputt = { ...SATZ };
if (art === "feld-weg") delete kaputt.singleLargeTimeoutMs;
else if (art === "unmoeglich") kaputt.singleLargeMaxTokens = 99999;
else if (art === "negativ") kaputt.parallelitaet = -1;

db.doc("config/betriebsprofil")
  .set({ aktiv: "t1-normal", profile: { "t1-normal": kaputt } })
  .then(() => {
    console.log(`   Satz kaputt gemacht: ${art}`);
    process.exit(0);
  })
  .catch((f) => {
    console.error("   " + f.message);
    process.exit(1);
  });
