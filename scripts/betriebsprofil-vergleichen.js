/**
 * Vergleicht den Einstellungssatz in der ECHTEN Datenbank feldweise mit
 * functions/src/produktiv-satz.js — nur lesend.
 *
 * WARUM ES DIESES SKRIPT GIBT (OPS-2026-09-01-02, Audit vom 01.09.2026):
 * Die Wahrheit ueber die Betriebswerte liegt in `config/betriebsprofil`. Die
 * Datei im Repo ist nur die Kopie, die das Anlege-Skript dorthin schreibt.
 * Der Test `satz-gegen-doku.test.js` hielt die Doku gegen die Kopie — niemand
 * hielt die Kopie gegen die Wahrheit. Am 30.08. wurde das Repo geaendert,
 * die Datenbank danach mit einem aelteren Stand beschrieben, und zwei Tage
 * lang wich sie in acht Feldern ab: sieben davon in den beiden Ersatz-Profilen
 * fuer den Ernstfall. Kein Signal. Dasselbe Muster wie der Befund vom 30.08.
 * („zwei gleichlautende Irrtuemer"), eine Ebene hoeher.
 *
 * Seitdem laeuft dieser Vergleich in `verify-infrastructure.sh` vor jedem
 * Deploy. Eine Abweichung stoppt die Auslieferung — bis jemand entweder das
 * Repo oder die Datenbank bewusst nachzieht (`betriebsprofil-anlegen.js
 * --ausfuehren --ueberschreiben` schreibt den Repo-Stand).
 *
 * Aufruf:
 *   node scripts/betriebsprofil-vergleichen.js                 gegen die echte Datenbank
 *   node scripts/betriebsprofil-vergleichen.js --datei x.json  gegen eine vorbereitete
 *                                                              Antwort (Negativprobe)
 *
 * Rueckgabewerte: 0 = stimmt ueberein · 1 = mindestens eine Abweichung ·
 * 2 = nicht messbar (Datenbank nicht lesbar, Datei fehlt). Ungeprueft ist
 * kein Freibrief — der Aufrufer behandelt 2 wie 1.
 */
const pfad = require("path");
const fs = require("fs");
const wurzel = pfad.resolve(__dirname, "..");
const { createRequire } = require("module");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { PROFILE, AKTIV } = require(pfad.join(wurzel, "functions", "src", "produktiv-satz.js"));

/* Dokumentdaten holen: aus der Datei (Probe) oder aus der echten Datenbank. */
async function dokumentLesen() {
  const i = process.argv.indexOf("--datei");
  if (i !== -1) {
    const datei = process.argv[i + 1];
    if (!datei || !fs.existsSync(datei)) throw new Error(`Probedatei fehlt: ${datei || "(kein Pfad)"}`);
    return JSON.parse(fs.readFileSync(datei, "utf8"));
  }
  /* Derselbe Riegel wie im Anlege-Skript: Dieser Vergleich gilt der ECHTEN
     Datenbank. Ein Emulator im Spiel hiesse, dass hier der falsche Stand
     verglichen wuerde — und das Ergebnis gruen aussaehe. */
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST ist gesetzt — der Vergleich gilt der echten Datenbank.");
  }
  const { Firestore } = req("@google-cloud/firestore");
  const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
  const snap = await new Firestore({ projectId: "malzime", databaseId: FIRESTORE_DATABASE_ID })
    .doc("config/betriebsprofil")
    .get();
  if (!snap.exists) throw new Error("config/betriebsprofil existiert nicht");
  return snap.data();
}

/* Reine Rechnung, ohne Netz: Liste der Abweichungen. Exportiert, damit ein
   Test sie ohne Datenbank pruefen kann. */
function abweichungen(daten) {
  const liste = [];
  if (!daten || typeof daten !== "object") return ["Dokument leer oder kein Objekt"];
  if (daten.aktiv !== AKTIV) liste.push(`aktiv: DB=${daten.aktiv} Repo=${AKTIV}`);
  const dbProfile = daten.profile && typeof daten.profile === "object" ? daten.profile : {};
  for (const [name, repo] of Object.entries(PROFILE)) {
    const db = dbProfile[name];
    if (!db) {
      liste.push(`${name}: fehlt in der Datenbank`);
      continue;
    }
    for (const feld of Object.keys(repo)) {
      if (db[feld] !== repo[feld]) liste.push(`${name}.${feld}: DB=${db[feld]} Repo=${repo[feld]}`);
    }
    for (const feld of Object.keys(db)) {
      if (!(feld in repo)) liste.push(`${name}.${feld}: nur in der Datenbank (DB=${db[feld]})`);
    }
  }
  for (const name of Object.keys(dbProfile)) {
    if (!(name in PROFILE)) liste.push(`${name}: nur in der Datenbank`);
  }
  return liste;
}

if (require.main === module) {
  dokumentLesen()
    .then((daten) => {
      const liste = abweichungen(daten);
      const felder = Object.values(PROFILE).reduce((n, p) => n + Object.keys(p).length, 0);
      if (liste.length === 0) {
        console.log(
          `Einstellungssatz: Datenbank und Repo stimmen ueberein ` +
            `(${felder} Felder in ${Object.keys(PROFILE).length} Profilen, aktiv "${AKTIV}")`
        );
        process.exit(0);
      }
      console.log(`Einstellungssatz weicht vom Repo ab (${liste.length}):`);
      for (const z of liste) console.log(`  ${z}`);
      console.log(`Nachziehen: node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`);
      process.exit(1);
    })
    .catch((f) => {
      console.log(`NICHT MESSBAR: ${f.message}`);
      process.exit(2);
    });
}

module.exports = { abweichungen };
