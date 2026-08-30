/**
 * Legt den Einstellungssatz in der ECHTEN Datenbank an.
 *
 * DAS IST DER ERSTE SCHRITT DER AUSLIEFERUNG von v4.4. Reihenfolge:
 *
 *   1. dieses Skript          Satz anlegen und nachmessen
 *   2. sh scripts/deploy.sh   erst danach ausliefern
 *
 * Umgekehrt entstünde ein Zeitraum, in dem die neue Fassung läuft, aber kein
 * Satz da ist — dann läuft keine Analyse. Der Satz kann gefahrlos vorher
 * liegen: Die alte Fassung liest ihn nicht.
 *
 * SICHERUNGEN, weil dieses Skript in die Produktionsdatenbank schreibt:
 *   · Es weigert sich, wenn FIRESTORE_EMULATOR_HOST gesetzt ist (dann wäre
 *     der Emulant gemeint, nicht die echte Datenbank).
 *   · Es zeigt zuerst, WAS es schreiben würde, und verlangt eine ausdrückliche
 *     Bestätigung über --ausfuehren.
 *   · Es überschreibt einen vorhandenen Satz NICHT ohne --ueberschreiben.
 *   · Es misst danach nach, statt Erfolg zu behaupten.
 *
 * Aufruf:
 *   node scripts/betriebsprofil-anlegen.js                 nur anzeigen
 *   node scripts/betriebsprofil-anlegen.js --ausfuehren    wirklich schreiben
 */
const pfad = require("path");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("ABBRUCH: FIRESTORE_EMULATOR_HOST ist gesetzt.");
  console.error("         Dieses Skript ist fuer die ECHTE Datenbank gedacht.");
  console.error("         Fuer den Emulator: scripts/lasttest-satz-anlegen.js");
  process.exit(1);
}

const { initializeApp, applicationDefault } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
const { PFLICHTFELDER, _pruefe, _FELDER } = require(pfad.join(wurzel, "functions", "src", "betriebsprofil.js"));

/* Die Werte des laufenden Betriebs. Sie stehen bewusst HIER und nicht in
   test-satz.js: Der Testsatz darf sich mit den Tests ändern, der
   Produktivsatz nicht. Beide werden gegen dieselbe Prüfung gehalten. */
const T1_NORMAL = {
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  describeMaxTokens: 2048,
  profileMaxTokens: 16000,
  requestBudgetMs: 480000,
  parallelitaet: 7,
  warteschlangeTiefe: 155,
  durchschnittsdauerSekunden: 65,
  stundenlimit: 500,
  stundenfensterMinuten: 60,
  adressLimit: 500,
  adressfensterMs: 600000,
  boostFaktor: 2,
  boostFristMs: 7200000,
  drosselMaxParallel: 6,
  drosselWartelimitMs: 360000,
  tokenAbstandGrossMs: 800,
  tokenAbstandKleinMs: 2500,
  jobAufbewahrungMs: 7200000,
  zustellfensterMs: 900000,
  livenessGnadenfristMs: 480000,
  verarbeitungsZeitlimitMs: 540000,
  wartendesHoechstalterMs: 2100000,
  aufraeumStapel: 200,
  ticketGueltigkeitMs: 1800000,
};

/* Zwei vorbereitete Alternativen, damit im Ernstfall nur EIN Feld umgestellt
   werden muss statt sechsundzwanzig. */
const PROFILE = {
  "t1-normal": T1_NORMAL,
  /* Wenn die KI langsamer wird — der Fall vom 28.08.2026. */
  "t1-langsam": { ...T1_NORMAL, singleLargeTimeoutMs: 450000, durchschnittsdauerSekunden: 110 },
  /* Rollback auf die 3-Call-Pipeline: weniger parallel, laengere Dauer.
     Ersetzt den frueheren Deploy-Schritt aus dem RUNBOOK. */
  "t1-drei-call": { ...T1_NORMAL, parallelitaet: 3, durchschnittsdauerSekunden: 100 },
};

const ausfuehren = process.argv.includes("--ausfuehren");
const ueberschreiben = process.argv.includes("--ueberschreiben");

/* PRUEFUNG VOR DEM SCHREIBEN — mit derselben Funktion, die auch im Betrieb
   entscheidet. Ein Satz, den das System ablehnen wuerde, darf gar nicht erst
   in die Datenbank. */
let fehlerhaft = 0;
for (const [name, werte] of Object.entries(PROFILE)) {
  const grund = _pruefe(werte);
  const felder = Object.keys(werte).length;
  if (grund) {
    console.error(`  ABGELEHNT  ${name}: ${grund}`);
    fehlerhaft += 1;
  } else {
    console.log(`  geprueft   ${name}  (${felder} Felder, vollstaendig)`);
  }
}
if (fehlerhaft > 0) {
  console.error(`\nABBRUCH: ${fehlerhaft} Satz/Saetze wuerden im Betrieb abgelehnt.`);
  process.exit(1);
}
if (Object.keys(T1_NORMAL).length !== PFLICHTFELDER.length) {
  console.error(
    `\nABBRUCH: t1-normal hat ${Object.keys(T1_NORMAL).length} Felder, ` +
      `erwartet werden ${PFLICHTFELDER.length}. Ein neues Pflichtfeld fehlt hier.`
  );
  process.exit(1);
}

console.log(`\nDatenbank:  ${FIRESTORE_DATABASE_ID}`);
console.log(`Dokument:   config/betriebsprofil`);
console.log(`Aktiv:      t1-normal`);
console.log(`Profile:    ${Object.keys(PROFILE).join(", ")}`);
console.log(`\nVier Obergrenzen sind Datenschutzzusagen und nicht ueberschreitbar:`);
for (const feld of ["jobAufbewahrungMs", "zustellfensterMs", "adressfensterMs", "stundenfensterMinuten"]) {
  console.log(
    `  ${feld.padEnd(24)} eingestellt ${String(T1_NORMAL[feld]).padStart(8)}  ` + `Grenze ${_FELDER[feld].max}`
  );
}

if (!ausfuehren) {
  console.log(`\nNur angezeigt. Zum wirklichen Schreiben:`);
  console.log(`  node scripts/betriebsprofil-anlegen.js --ausfuehren`);
  process.exit(0);
}

initializeApp({ credential: applicationDefault(), projectId: "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);
const ref = db.doc("config/betriebsprofil");

(async () => {
  const vorher = await ref.get();
  if (vorher.exists && !ueberschreiben) {
    console.error(`\nABBRUCH: Es liegt bereits ein Satz. Aktiv: "${vorher.data().aktiv}".`);
    console.error(`         Zum Ersetzen: --ausfuehren --ueberschreiben`);
    process.exit(1);
  }

  await ref.set({ aktiv: "t1-normal", profile: PROFILE });

  /* NACHMESSEN, nicht behaupten: zurueckgelesen und erneut geprueft. */
  const zurueck = await ref.get();
  const daten = zurueck.data();
  const aktiv = daten.profile[daten.aktiv];
  const grund = _pruefe(aktiv);

  console.log(`\nGESCHRIEBEN und nachgemessen:`);
  console.log(`  Dokument existiert:  ${zurueck.exists}`);
  console.log(`  aktiv:               ${daten.aktiv}`);
  console.log(`  Felder im Satz:      ${Object.keys(aktiv).length} von ${PFLICHTFELDER.length}`);
  console.log(`  Pruefung:            ${grund || "bestanden"}`);
  if (grund || Object.keys(aktiv).length !== PFLICHTFELDER.length) {
    console.error(`\nWARNUNG: Der zurueckgelesene Satz stimmt nicht. NICHT deployen.`);
    process.exit(1);
  }
  console.log(`\nBereit fuer den Deploy.`);
  process.exit(0);
})().catch((f) => {
  console.error(`\nFEHLER: ${f.message}`);
  process.exit(1);
});
