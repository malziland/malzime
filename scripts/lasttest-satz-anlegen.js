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
