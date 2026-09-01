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

/* OPS-2026-08-31-06: NUR gegen den Emulator. Ohne FIRESTORE_EMULATOR_HOST
   schreibt dieses Skript `config/betriebsprofil` in die ECHTE Datenbank — das
   ist der Satz, der die laufende Produktion steuert (Zeitgrenzen, Kapazitaet,
   Modellwahl). Am 31.08. hat sich gezeigt, wohin dieselbe Nachlaessigkeit
   fuehrt: 4.056 Testbilder lagen im Produktions-Bildspeicher, weil ein
   Lasttest ohne QUEUE_LOCAL=1 lief. */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "   ABBRUCH: FIRESTORE_EMULATOR_HOST ist nicht gesetzt.\n" +
      "   Dieses Skript wuerde den Einstellungssatz der PRODUKTION umstellen.\n" +
      "   Aufruf mit: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/lasttest-umstellen.js <satz>"
  );
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
