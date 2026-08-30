/** Zaehlt die wartenden Auftraege — der einzige belastbare Nachweis dafuer,
 *  ob die Einlassgrenze gehalten hat. Antworten des Servers taugen dafuer
 *  nicht: Eine abgerissene Verbindung sieht aus wie eine Absage. */
const pfad = require("path");
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("ABBRUCH: FIRESTORE_EMULATOR_HOST fehlt — nur fuer den Emulator.");
  process.exit(1);
}
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
getFirestore(FIRESTORE_DATABASE_ID)
  .collection("jobs")
  .where("status", "==", "queued")
  .count()
  .get()
  .then((s) => {
    console.log(s.data().count);
    process.exit(0);
  })
  .catch((f) => {
    console.error(f.message);
    process.exit(1);
  });
