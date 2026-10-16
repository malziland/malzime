"use strict";

/**
 * wartezeit-wache.js — Push, wenn eine Analyse zu lange auf ihren Start wartet.
 *
 * WARUM (Auftrag des Inhabers, 16.10.2026): Wartet ein Kind im Workshop
 * minutenlang, bevor seine Analyse ueberhaupt beginnt, soll das Handy es
 * sagen — waehrend es passiert, nicht erst in der Auswertung danach.
 *
 * DIE GRENZE: LAENGER als 5 Minuten vom Einreihen bis zum Start. Genau
 * 5:00 ist kein Alarm, 5:01 schon (wartezeit-wache.test.js prueft beide
 * Seiten). Hoechstens eine Nachricht je 30 Minuten; die Marke dafuer liegt in
 * Firestore (`stats/wartezeit-wache`), damit sie fuer alle Instanzen gilt.
 * Inhalt: die laengste Wartezeit und wie viele gerade warten.
 *
 * KEIN ALARM FUER "NICHT ABGEHOLT" (Vorgabe): Am Ende eines Workshops legen
 * Kinder die Handys weg; ein liegengebliebenes Ergebnis ist dort normal.
 *
 * WO SIE LAEUFT — IM AUFRAEUMDIENST, NICHT IM ARBEITER: Der Arbeiter sieht
 * eine Wartezeit erst, wenn das Warten vorbei ist. Steht die Schlange still
 * (kein Einstellungssatz, Stoerung bei Google), startet nichts, und er saehe
 * nie etwas — genau dann soll die Nachricht aber kommen. Der Aufraeumdienst
 * laeuft jede Minute ohnehin und belastet keinen Analyseweg. Er schaut auf
 * zweierlei: den Auftrag, der JETZT am laengsten wartet, und die Auftraege,
 * die in den letzten zwei Minuten gestartet sind (wer 5:30 wartete und
 * zwischen zwei Laeufen startete, faellt sonst durch).
 */

const { datenbank } = require("./db");
const { countQueuedJobs } = require("./jobs");

const MARKE_DOKUMENT = "stats/wartezeit-wache";

/* BLEIBT IM CODE — Schwelle der Alarmierung, keine Betriebseinstellung (wie
   die Schwellen der Laufzeit-Wache): Vorgabe des Inhabers vom 16.10.2026,
   5 Minuten, AUSSCHLIESSLICH (erst darueber wird gemeldet). Sie aendert
   nichts am Ablauf einer Analyse; ein Wert im Einstellungssatz haette vor der
   Auslieferung einen Schreibvorgang in die echte Datenbank verlangt. */
const GRENZE_MS = 5 * 60 * 1000;
/* BLEIBT IM CODE — Schwelle der Alarmierung (Vorgabe 16.10.2026): hoechstens
   eine Nachricht je 30 Minuten. */
const RUHE_MS = 30 * 60 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Messung: So weit schaut die Wache nach
   gestarteten Auftraegen zurueck. Zwei Minuten bei einem Lauf je Minute: Ein
   verspaeteter Lauf laesst keine Luecke; doppelt gesehene Auftraege schadet
   nichts (die Ruhezeit verhindert eine zweite Nachricht). */
const BLICK_ZURUECK_MS = 2 * 60 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Alarmierung wie LAEUFE_BIS_ALARM im
   Aufraeumdienst: so viele Laeufe hintereinander ohne Messung, dann ERROR. */
const FEHLER_BIS_ALARM = 5;

let fehlerInFolge = 0;

/* Einreihezeitpunkt des Auftrags, der am laengsten wartet, oder null. Ein
   Treffer, nur die eine Angabe; Index (status, createdAt) liegt schon. */
async function aeltesterWartenderSeit() {
  const snap = await datenbank()
    .collection("jobs")
    .where("status", "==", "queued")
    .orderBy("createdAt")
    .limit(1)
    .select("createdAt")
    .get();
  const createdAt = snap.empty ? null : snap.docs[0].get("createdAt");
  return typeof createdAt === "number" ? createdAt : null;
}

/* Wartezeiten (Start minus Einreihen) der Auftraege, die seit `seitMs`
   gestartet sind, gleich welcher Status jetzt. Nur die zwei Zeitstempel;
   automatischer Einzelfeld-Index auf startedAt, ungestartete (null) fallen
   von selbst heraus. */
async function wartezeitenGestartetSeit(seitMs) {
  const snap = await datenbank()
    .collection("jobs")
    .where("startedAt", ">=", seitMs)
    .select("createdAt", "startedAt")
    .get();
  return snap.docs
    .map((d) => [d.get("createdAt"), d.get("startedAt")])
    .filter(([c, s]) => typeof c === "number" && typeof s === "number")
    .map(([c, s]) => s - c);
}

/** Liegt die Wartezeit ueber der Grenze? 300000 ms (5:00) nein, 300001 ja. */
function zuLang(wartezeitMs) {
  return typeof wartezeitMs === "number" && Number.isFinite(wartezeitMs) && wartezeitMs > GRENZE_MS;
}

/** "7 min 05 s" — fuer die Nachricht, in klarer Sprache. */
function alsMinuten(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Text der Nachricht (reine Rechnung). */
function baueMeldung(laengsteMs, wartende) {
  const wer = wartende === 1 ? "1 Analyse wartet" : `${wartende} Analysen warten`;
  return (
    `malziME: Eine Analyse hat ${alsMinuten(laengsteMs)} auf ihren Start gewartet ` +
    `(Grenze ${alsMinuten(GRENZE_MS)}). Gerade ${wer}.`
  );
}

/* Setzt die Marke, wenn die Ruhezeit um ist — in einer Transaktion, damit
   zwei gleichzeitige Laeufe nicht beide melden. true = diese Instanz meldet. */
async function markeSetzen(jetzt) {
  const db = datenbank();
  const ref = db.doc(MARKE_DOKUMENT);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const letzte = snap.exists ? snap.get("letzterAlarm") : null;
    if (typeof letzte === "number" && jetzt - letzte < RUHE_MS) return false;
    tx.set(ref, { letzterAlarm: jetzt }, { merge: true });
    return true;
  });
}

/**
 * Ein Durchgang der Wache. Wirft nie.
 * @param {{melder?: (text: string) => Promise<unknown>, jetzt?: number}} [opts]
 *   melder: schickt die Nachricht (index.js: sendeNtfy); ohne melder nur Protokoll
 * @returns {Promise<{status: string, laengsteMs?: number, wartende?: number}>}
 */
async function pruefeWartezeit({ melder = null, jetzt = Date.now() } = {}) {
  try {
    const [aeltester, gestartet] = await Promise.all([
      aeltesterWartenderSeit(),
      wartezeitenGestartetSeit(jetzt - BLICK_ZURUECK_MS),
    ]);
    fehlerInFolge = 0;
    const kandidaten = [...gestartet];
    if (typeof aeltester === "number") kandidaten.push(jetzt - aeltester);
    const laengsteMs = kandidaten.length ? Math.max(...kandidaten) : 0;
    if (!zuLang(laengsteMs)) return { status: "im-rahmen", laengsteMs };

    if (!(await markeSetzen(jetzt))) {
      console.log(JSON.stringify({ step: "wartezeit-wache", status: "ruhezeit", laengsteMs }));
      return { status: "ruhezeit", laengsteMs };
    }
    const wartende = await countQueuedJobs();
    const text = baueMeldung(laengsteMs, wartende);
    if (melder) await melder(text);
    /* Auch hier keine Kennung: nur die zwei Zahlen der Nachricht. */
    console.warn(
      JSON.stringify({ severity: "WARNING", step: "wartezeit-wache", status: "gemeldet", laengsteMs, wartende })
    );
    return { status: "gemeldet", laengsteMs, wartende };
  } catch (err) {
    fehlerInFolge += 1;
    const zeile = {
      severity: fehlerInFolge >= FEHLER_BIS_ALARM ? "ERROR" : "WARNING",
      step: "wartezeit-wache",
      warning: "wartezeit-wache-nicht-messbar",
      laeufeInFolge: fehlerInFolge,
      code: (err && err.code) || null,
      art: (err && err.name) || null,
    };
    (fehlerInFolge >= FEHLER_BIS_ALARM ? console.error : console.warn)(JSON.stringify(zeile));
    return { status: "nicht-messbar" };
  }
}

/** Nur fuer Tests. */
function _zuruecksetzen() {
  fehlerInFolge = 0;
}

module.exports = { pruefeWartezeit, zuLang, baueMeldung, _zuruecksetzen, GRENZE_MS, RUHE_MS };
