/** Stellt den aktiven Einstellungssatz um — ueber dieselbe Verbindung wie
 *  der Produktivcode (benannte Datenbank, siehe lasttest-satz-anlegen.js). */
const pfad = require("path");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));

const ziel = process.argv[2];
if (!ziel) {
  console.error("   Aufruf: lasttest-umstellen.js <satzname>");
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);

db.doc("config/betriebsprofil")
  .set({ aktiv: ziel }, { merge: true })
  .then(async () => {
    const zurueck = await db.doc("config/betriebsprofil").get();
    console.log(`   umgestellt auf "${zurueck.data().aktiv}" (nachgemessen)`);
    process.exit(0);
  })
  .catch((f) => {
    console.error("   " + f.message);
    process.exit(1);
  });
