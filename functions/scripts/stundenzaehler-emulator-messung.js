"use strict";

/**
 * stundenzaehler-emulator-messung.js — Steht jeder eingelassene Auftrag GENAU
 * EINMAL im Stundenfenster (stats/current.recentAnalyses)?
 *
 * ANLASS (11.09.2026): Nach einem Lasttest mit 30 gleichzeitigen Analysen
 * zeigte die Statusseite 35 in der letzten Stunde bei 36 fertigen Analysen.
 * Unter Andrang weicht der Zaehler aufs Netz aus; ein Eintrag fehlte danach
 * fuer immer (functions/src/counter.js, "GENAU EINMAL IM FENSTER").
 *
 * Die Messung reiht N Auftraege gleichzeitig ein, fragt ihren Status ab wie ein
 * wartender Browser (sonst gelten sie nach der Karenz als verlassen), wartet,
 * bis alle durch sind, und vergleicht dann Auftrag fuer Auftrag: Steht seine
 * Marke im Fenster, genau einmal? Verlassene Auftraege geben ihren Platz
 * zurueck und duerfen NICHT drinstehen. Kostet nichts — Mistral ist im
 * Emulator eine Attrappe.
 *
 * NUR gegen den Emulator (Riegel unten). Aufruf aus der Repo-Wurzel:
 *   firebase emulators:exec --only functions,firestore \
 *     "node functions/scripts/stundenzaehler-emulator-messung.js 30"
 * Rueckgabewert 0 nur, wenn jeder Auftrag genau einmal gezaehlt ist.
 */

const pfad = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const wurzel = pfad.resolve(__dirname, "..", "..");
const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
const { SATZ } = require(pfad.join(wurzel, "functions", "src", "test-satz.js"));

/* Ohne diese Variable schriebe das Skript Einstellungssatz und Zaehler der
   PRODUKTION um (vgl. OPS-2026-08-31-14 in scripts/lasttest-satz-anlegen.js). */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("ABBRUCH: FIRESTORE_EMULATOR_HOST fehlt — dieses Skript laeuft nur gegen den Emulator.");
  process.exit(2);
}

const N = Number(process.argv[2]) || 30;
const BASE = process.env.BASE_URL || "http://127.0.0.1:5001/malzime/europe-west1";
const HOECHSTDAUER_MS = 25 * 60 * 1000;
const zeit = () => new Date().toISOString().slice(11, 19) + " UTC";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
const db = getFirestore(FIRESTORE_DATABASE_ID);

async function fensterStand() {
  const snap = await db.doc("stats/current").get();
  const arr = (snap.exists && snap.data().recentAnalyses) || [];
  const jetzt = Date.now();
  const imFenster = arr.filter((t) => jetzt - t < SATZ.stundenfensterMinuten * 60000);
  return { eintraege: imFenster, verschieden: new Set(imFenster).size };
}

async function auftraege() {
  const snap = await db.collection("jobs").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function nachStatus(jobs) {
  const stati = {};
  for (const j of jobs) stati[j.status] = (stati[j.status] || 0) + 1;
  return stati;
}

async function main() {
  console.log(`${zeit()} Messung: ${N} gleichzeitige Auftraege, Datenbank "${FIRESTORE_DATABASE_ID}"`);
  await db.doc("config/betriebsprofil").set({ aktiv: "t1-normal", profile: { "t1-normal": SATZ } });
  await db.doc("stats/current").set({ recentAnalyses: [], limit: SATZ.stundenlimit, limitBis: null });
  console.log(
    `${zeit()} Satz angelegt (stundenlimit ${SATZ.stundenlimit}, warteschlangeTiefe ${SATZ.warteschlangeTiefe}), Fenster geleert`
  );

  /* Ein echtes JPEG — die Magic-Byte-Pruefung des Einlasses soll bestehen. */
  const bild = fs.readFileSync(pfad.join(wurzel, "public/img/demo/demo-cafe-thumb.jpg")).toString("base64");
  const t0 = Date.now();
  const antworten = await Promise.all(
    Array.from({ length: N }, async () => {
      try {
        const r = await fetch(`${BASE}/enqueue`, {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://localhost:5050" },
          body: JSON.stringify({ imageBase64: bild, mimeType: "image/jpeg", lang: "de" }),
        });
        const d = await r.json().catch(() => ({}));
        return { status: r.status, jobId: d.jobId, token: d.resultToken };
      } catch (f) {
        return { status: "netzfehler:" + f.message };
      }
    })
  );
  const angenommen = antworten.filter((a) => a.jobId);
  const codes = {};
  for (const a of antworten) codes[a.status] = (codes[a.status] || 0) + 1;
  console.log(
    `${zeit()} Einlass nach ${Date.now() - t0} ms: angenommen ${angenommen.length}, Antworten ${JSON.stringify(codes)}`
  );
  console.log(`${zeit()} Fenster direkt nach dem Einlass: ${(await fensterStand()).eintraege.length} Eintraege`);

  /* Bis alle Auftraege durch sind: Status abfragen (haelt sie am Leben) und
     jede Aenderung des Stands mitschreiben. */
  const ende = Date.now() + HOECHSTDAUER_MS;
  let letzte = "";
  while (Date.now() < ende) {
    await Promise.all(
      angenommen.map((a) =>
        fetch(`${BASE}/jobStatus?jobId=${encodeURIComponent(a.jobId)}&token=${encodeURIComponent(a.token)}`).catch(
          () => null
        )
      )
    );
    const jobs = await auftraege();
    const f = await fensterStand();
    const zeile = `Auftraege ${JSON.stringify(nachStatus(jobs))} | Fenster ${f.eintraege.length}`;
    if (zeile !== letzte) console.log(`${zeit()} ${zeile}`);
    letzte = zeile;
    const offen = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
    if (offen === 0 && jobs.length > 0) break;
    await warte(5000);
  }

  const jobs = await auftraege();
  const f = await fensterStand();
  const markenImFenster = new Set(f.eintraege);
  const verlassen = jobs.filter((j) => j.status === "abandoned");
  const zaehlend = jobs.filter((j) => j.status !== "abandoned");
  const fehlend = zaehlend.filter((j) => !markenImFenster.has(j.zaehlerStempel));
  const verlassenDrin = verlassen.filter((j) => markenImFenster.has(j.zaehlerStempel));
  const offen = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
  const doppelt = f.eintraege.length - f.verschieden;
  const soll = angenommen.length - verlassen.length;

  console.log("────────────────────────────────────────────");
  console.log(`${zeit()} ERGEBNIS`);
  console.log(`  angenommen (HTTP 200):            ${angenommen.length}`);
  console.log(`  Auftraege nach Status:            ${JSON.stringify(nachStatus(jobs))}`);
  console.log(`  davon mit Nachtrag (Netz-Fall):   ${jobs.filter((j) => j.zaehlerNachtrag === true).length}`);
  console.log(`  Soll im Fenster (ohne verlassene): ${soll}`);
  console.log(
    `  Ist im Fenster:                   ${f.eintraege.length} (verschieden ${f.verschieden}, doppelt ${doppelt})`
  );
  console.log(`  Auftraege ohne eigenen Eintrag:   ${fehlend.length}`);
  console.log(`  verlassene, trotzdem im Fenster:  ${verlassenDrin.length}`);
  const ok =
    offen === 0 && f.eintraege.length === soll && doppelt === 0 && fehlend.length === 0 && verlassenDrin.length === 0;
  console.log(ok ? "  GENAU EINMAL: ja" : `  GENAU EINMAL: NEIN${offen ? ` (${offen} Auftraege nicht fertig)` : ""}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((f) => {
  console.error("Messung gescheitert:", f.message);
  process.exitCode = 1;
});
