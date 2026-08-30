/** Leert die Warteschlange im Emulator — damit ein Szenario die Lage
 *  herstellen kann, die es prueft. NUR fuer den Emulator gedacht:
 *  Der Firestore-Host muss gesetzt sein, sonst bricht das Skript ab. */
const pfad = require("path");
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("   ABBRUCH: FIRESTORE_EMULATOR_HOST fehlt — dieses Skript loescht Jobs.");
  console.error("   Es ist ausschliesslich fuer den Emulator gedacht, nie fuer echte Daten.");
  process.exit(1);
}
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);

(async () => {
  let weg = 0;
  for (;;) {
    const schnapp = await db.collection("jobs").limit(400).get();
    if (schnapp.empty) break;
    const stapel = db.batch();
    schnapp.docs.forEach((d) => stapel.delete(d.ref));
    await stapel.commit();
    weg += schnapp.size;
    if (schnapp.size < 400) break;
  }
  console.log(`   Warteschlange geleert: ${weg} Auftraege entfernt`);
  process.exit(0);
})().catch((f) => {
  console.error("   " + f.message);
  process.exit(1);
});
