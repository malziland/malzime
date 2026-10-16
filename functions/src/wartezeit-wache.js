"use strict";

/**
 * wartezeit-wache.js — Push, wenn eine Analyse zu lange auf ihren Start wartet.
 *
 * WARUM (Auftrag vom 16.10.2026): Wartet ein Kind im Workshop
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
   die Schwellen der Laufzeit-Wache): Vorgabe vom 16.10.2026,
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
  const wer =
    typeof wartende !== "number"
      ? "Wie viele gerade warten, war nicht lesbar."
      : `Gerade ${wartende === 1 ? "1 Analyse wartet" : `${wartende} Analysen warten`}.`;
  return `malziME: Eine Analyse hat ${alsMinuten(laengsteMs)} auf ihren Start gewartet (Grenze ${alsMinuten(GRENZE_MS)}). ${wer}`;
}

/* Setzt die Marke, wenn die Ruhezeit um ist — in einer Transaktion, damit
   zwei gleichzeitige Laeufe nicht beide melden. Die Marke ist zunaechst nur
   eine Reservierung: Geht die Nachricht nicht hinaus, nimmt markeZuruecknehmen
   sie zurueck (Abnahme-Befund P2, 16.10.2026 — vorher blieb sie stehen, und
   ein Ausfall von ntfy sperrte den Alarm 30 Minuten lang).
   Rueckgabe: { gesetzt, vorher } — vorher = die Marke davor (oder null). */
async function markeSetzen(jetzt) {
  const db = datenbank();
  const ref = db.doc(MARKE_DOKUMENT);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const letzte = snap.exists ? snap.get("letzterAlarm") : null;
    if (typeof letzte === "number" && jetzt - letzte < RUHE_MS) return { gesetzt: false, vorher: letzte };
    tx.set(ref, { letzterAlarm: jetzt }, { merge: true });
    return { gesetzt: true, vorher: typeof letzte === "number" ? letzte : null };
  });
}

/* Nimmt die eigene Reservierung zurueck — nur, wenn sie noch die eigene ist
   (sonst haette eine andere Instanz inzwischen gemeldet). Danach darf der
   naechste Lauf es wieder versuchen. Wirft nicht; scheitert es, bleibt die
   Sperre stehen, und die Warnzeile sagt es. */
async function markeZuruecknehmen(jetzt, vorher) {
  try {
    const db = datenbank();
    const ref = db.doc(MARKE_DOKUMENT);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("letzterAlarm") === jetzt) tx.set(ref, { letzterAlarm: vorher }, { merge: true });
    });
    return true;
  } catch (_) {
    return false;
  }
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

    const marke = await markeSetzen(jetzt);
    if (!marke.gesetzt) {
      console.log(JSON.stringify({ step: "wartezeit-wache", status: "ruhezeit", laengsteMs }));
      return { status: "ruhezeit", laengsteMs };
    }
    const wartende = await countQueuedJobs().catch(() => null);
    const text = baueMeldung(laengsteMs, wartende);
    /* Zugestellt heisst: der Versandweg meldet Erfolg (sendeNtfy: true). false,
       ein Wurf oder gar kein Versandweg heisst: nicht hinausgegangen — dann
       die Marke zuruecknehmen, damit der naechste Lauf es wieder versucht. */
    const zugestellt = melder
      ? await Promise.resolve(melder(text)).then(
          (r) => r === true,
          () => false
        )
      : false;
    /* Auch hier keine Kennung: nur die zwei Zahlen der Nachricht. */
    if (zugestellt) {
      console.warn(
        JSON.stringify({ severity: "WARNING", step: "wartezeit-wache", status: "gemeldet", laengsteMs, wartende })
      );
      return { status: "gemeldet", laengsteMs, wartende };
    }
    const zurueck = await markeZuruecknehmen(jetzt, marke.vorher);
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        step: "wartezeit-wache",
        status: "nicht-zugestellt",
        warning: "wartezeit-wache-nicht-zugestellt",
        markeZurueckgenommen: zurueck,
        laengsteMs,
        wartende,
      })
    );
    return { status: "nicht-zugestellt", laengsteMs, wartende };
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
