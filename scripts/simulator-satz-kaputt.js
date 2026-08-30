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
