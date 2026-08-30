/** Ruft die Aufraeum-Logik direkt — der Reaper ist eine Zeitplan-Function und
 *  im Emulator nicht per HTTP erreichbar. Geprueft wird, dass die Abfragen
 *  durchlaufen und frisch Wartende NICHT erwischen. */
const pfad = require("path");
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("   ABBRUCH: FIRESTORE_EMULATOR_HOST fehlt — nur fuer den Emulator.");
  process.exit(1);
}
const wurzel = pfad.resolve(__dirname, "..");

/* Die Firebase-App MUSS vor dem ersten Datenbankzugriff stehen. Ohne das
   stuerzt jeder Aufruf mit "The default Firebase app does not exist" ab — und
   Schritt 7 des Simulators lief ins Leere, ohne dass es auffiel: Das Skript
   brach ab, bevor es etwas ausgeben konnte. */
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp, getApps } = req("firebase-admin/app");
if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
}

const jobs = require(pfad.join(wurzel, "functions", "src", "jobs.js"));

(async () => {
  const listen = [
    ["verlassene", jobs.findAbandonedJobs],
    ["haengende", jobs.findStaleProcessingJobs],
    ["ueberfaellige", jobs.findUeberfaelligeJobs],
    ["zugestellte", jobs.findZugestellteJobs],
    ["abgelaufene", jobs.findExpiredJobs],
  ];
  for (const [name, fn] of listen) {
    const treffer = await fn();
    console.log(`   ${name.padEnd(14)} ${treffer.length} Auftraege zum Aufraeumen`);
  }
  console.log("   alle fuenf Abfragen durchgelaufen");
  process.exit(0);
})().catch((f) => {
  console.error("   ABSTURZ: " + f.message);
  process.exit(1);
});
