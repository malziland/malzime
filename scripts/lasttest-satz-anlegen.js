/**
 * Legt den Einstellungssatz im Emulator an — ueber DIESELBE Verbindung wie
 * der Produktivcode.
 *
 * WARUM NICHT EINFACH getFirestore(): Das Projekt schreibt in die BENANNTE
 * Datenbank `malzime-eu`, nicht in die Standarddatenbank. Ein Testwerkzeug
 * mit eigener Verbindung haette in "(default)" geschrieben — der Lasttest
 * haette gemeldet "Satz angelegt", und die Functions haetten ihn nie gesehen.
 * Genau die Art Luecke, wegen der die Zusage "Daten in Europa" drei Audits
 * lang unbemerkt falsch war (siehe functions/src/db.js).
 *
 * Und der Satz selbst kommt aus functions/src/test-satz.js — eine Quelle.
 */
const pfad = require("path");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));

const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
const { SATZ } = require(pfad.join(wurzel, "functions", "src", "test-satz.js"));

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
      "   Aufruf mit: FIRESTORE_EMULATOR_HOST=localhost:8080 node " + "scripts/lasttest-satz-anlegen.js" + " ..."
  );
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);

db.doc("config/betriebsprofil")
  .set({
    aktiv: "t1-normal",
    profile: {
      "t1-normal": SATZ,
      "t2-schnell": { ...SATZ, singleLargeTimeoutMs: 420000, parallelitaet: 14, stundenlimit: 1000 },
    },
  })
  .then(async () => {
    /* NACHMESSEN statt behaupten: zurueckgelesen wird ueber denselben Weg. */
    const zurueck = await db.doc("config/betriebsprofil").get();
    const felder = Object.keys(zurueck.data().profile["t1-normal"]).length;
    console.log(`   angelegt in Datenbank "${FIRESTORE_DATABASE_ID}": t1-normal aktiv, ${felder} Felder`);
    console.log(`   nachgemessen: Dokument existiert = ${zurueck.exists}`);
    process.exit(0);
  })
  .catch((f) => {
    console.error("   " + f.message);
    process.exit(1);
  });
