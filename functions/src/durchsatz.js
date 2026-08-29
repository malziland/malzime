/**
 * durchsatz.js — Wie lange eine Analyse WIRKLICH dauert.
 *
 * WARUM ES DIESES MODUL GIBT (FEATURE-2026-08-29-02):
 *
 * `QUEUE_AVG_JOB_SECONDS = 65` stammt aus einem Lasttest vom 23.05.2026. Am
 * 28.08. lag die reale Dauer bei rund 150 s — die Zahl war drei Monate lang
 * unbemerkt falsch. Sie traegt zwei sichtbare Folgen:
 *
 *   1. Die Wartezeit-Ansage ("noch etwa 8 Minuten") war um mehr als die Haelfte
 *      zu optimistisch.
 *   2. `MAX_QUEUE_DEPTH` wird aus ihr BERECHNET: Mit 65 s ergeben sich 155
 *      Plaetze, bei real 150 s sind in derselben halben Stunde nur 67 zu
 *      schaffen. Wer dahinter einreiht, wartet garantiert umsonst und sieht am
 *      Ende einen Fehler.
 *
 * Die Lehre aus dem Vorfall vom 28.08. lautet: Eine gemessene Eigenschaft der
 * Aussenwelt darf nicht als feste Zahl im Code einfrieren. Also wird sie hier
 * nicht gepflegt, sondern gemessen — jede fertige Analyse schreibt ihre Dauer
 * mit, und die Ansage liest den laufenden Stand.
 *
 * BEWUSST KEIN ZEITFENSTER, SONDERN EINE ANZAHL: malziME ruht wochenlang und
 * hat dann an einem Vormittag tausend Analysen. Ein "letzte 24 Stunden"-Fenster
 * waere nach jedem Wochenende leer. Der Ring haelt die letzten 20 Laeufe, egal
 * wann sie waren; nach drei, vier frischen Analysen ist er wieder aktuell.
 *
 * DREI RIEGEL, alle Pflicht:
 *   - Plausibilitaetsgrenze: Werte ausserhalb 10-400 s sind Messfehler und
 *     werden verworfen, nie angezeigt.
 *   - Untergrenze von 5 Werten: darunter gilt der Code-Wert wie bisher. Der
 *     schlechteste Fall ist damit der heutige Zustand, nie ein schlechterer.
 *   - Abschaltbar ueber das Feature-Flag `useGemesseneDauer`, ohne Deploy.
 *
 * Ausserdem: NICHT der Median, sondern das 80-Perzentil. Wer weniger wartet als
 * angesagt, ist zufrieden; wer laenger wartet, verliert das Vertrauen. Die
 * Ansage soll ueberschaetzen.
 */

const { datenbank } = require("./db");
const { QUEUE_AVG_JOB_SECONDS } = require("./config");

const DOKUMENT = "stats/durchsatz";
/* FEATURE-2026-08-29-03: Tageshistorie fuer die Laufzeit-Wache. Getrennt vom
   Ring oben, weil beide verschiedene Fragen beantworten: Der Ring sagt "wie
   lange dauert es GERADE" (fuer die Ansage), die Historie "wie hat es sich
   ueber Wochen entwickelt" (fuer den Alarm). */
const TAGE_DOKUMENT = "stats/laufzeit-tage";
const TAGE_HISTORIE = 21;
/* Pro Tag genuegt eine Stichprobe — an einem Workshop-Vormittag laufen
   1000 Analysen, fuer einen Median braucht es keine 1000 Zahlen. */
const WERTE_JE_TAG = 50;
const RING_GROESSE = 20;
/* Unter dieser Zahl ist jede Aussage Zufall — dann lieber der Code-Wert. */
const MIN_WERTE = 5;
const PLAUSIBEL_MIN_S = 10;
const PLAUSIBEL_MAX_S = 400;
/* Aelter als eine Woche: Die Werte stimmen vielleicht noch, aber niemand kann
   das behaupten. Dann zeigt der Client die Position statt einer Sekundenzahl. */
const HOECHSTALTER_MS = 7 * 24 * 60 * 60 * 1000;
/* jobStatus wird bei einem Workshop mehr als tausendmal am Tag aufgerufen —
   ohne Zwischenspeicher waere das ein Firestore-Lesevorgang je Poll. */
const CACHE_TTL_MS = 60 * 1000;

let cache = { data: null, expiresAt: 0 };

/** Nur fuer Tests: Zwischenspeicher verwerfen. */
function _cacheLeeren() {
  cache = { data: null, expiresAt: 0 };
}

/**
 * Haengt die Dauer einer abgeschlossenen Analyse an den Ring.
 *
 * Schluckt jeden Fehler: Die Messung ist Komfort, nie Pflicht. Ein Firestore-
 * Ausfall darf keine Analyse kosten, die bereits fertig ist.
 */
async function merkeDauer(sekunden) {
  if (!Number.isFinite(sekunden) || sekunden < PLAUSIBEL_MIN_S || sekunden > PLAUSIBEL_MAX_S) return;
  try {
    const ref = datenbank().doc(DOKUMENT);
    await datenbank().runTransaction(async (t) => {
      const snap = await t.get(ref);
      const bisher = snap.exists && Array.isArray(snap.data().werte) ? snap.data().werte : [];
      const neu = bisher.concat([{ s: Math.round(sekunden), t: Date.now() }]).slice(-RING_GROESSE);
      t.set(ref, { werte: neu, letzterEintrag: Date.now() }, { merge: true });
    });
    /* Der eigene Zwischenspeicher ist jetzt veraltet. */
    cache = { data: null, expiresAt: 0 };
    await merkeTag(sekunden);
  } catch (_) {
    /* still — siehe Funktionskommentar */
  }
}

/**
 * Schreibt die Dauer zusaetzlich in die Tageshistorie.
 *
 * FEATURE-2026-08-29-03: Grundlage der Laufzeit-Wache. Ohne diese Historie
 * bliebe nur der Log-Bucket als Quelle — und der Standard-Bucket haelt bloss
 * einen Tag, was die Ursachensuche am 28.08. fast unmoeglich gemacht hat.
 */
async function merkeTag(sekunden) {
  try {
    const heute = new Date().toISOString().slice(0, 10);
    const ref = datenbank().doc(TAGE_DOKUMENT);
    await datenbank().runTransaction(async (t) => {
      const snap = await t.get(ref);
      const bisher = snap.exists && Array.isArray(snap.data().tage) ? snap.data().tage : [];
      const ohneHeute = bisher.filter((x) => x && x.d !== heute);
      const heutigerStand = bisher.find((x) => x && x.d === heute) || { d: heute, w: [] };
      const werte = Array.isArray(heutigerStand.w) ? heutigerStand.w : [];
      if (werte.length < WERTE_JE_TAG) werte.push(Math.round(sekunden));
      const neu = ohneHeute
        .concat([{ d: heute, w: werte }])
        .sort((a, b) => (a.d < b.d ? -1 : 1))
        .slice(-TAGE_HISTORIE);
      t.set(ref, { tage: neu }, { merge: true });
    });
  } catch (_) {
    /* still — die Historie ist Diagnose, nie Betrieb */
  }
}

/** Liefert die Tageshistorie (aelteste zuerst) oder eine leere Liste. */
async function tagesHistorie() {
  try {
    const snap = await datenbank().doc(TAGE_DOKUMENT).get();
    const tage = snap.exists && Array.isArray(snap.data().tage) ? snap.data().tage : [];
    return tage.filter((x) => x && typeof x.d === "string" && Array.isArray(x.w));
  } catch (_) {
    return [];
  }
}

/** 80-Perzentil einer Zahlenliste (aufgerundet, mindestens ein Element). */
function perzentil80(zahlen) {
  const sortiert = zahlen.slice().sort((a, b) => a - b);
  const idx = Math.min(sortiert.length - 1, Math.ceil(sortiert.length * 0.8) - 1);
  return sortiert[Math.max(0, idx)];
}

/**
 * Liefert die gemessene Dauer je Analyse.
 *
 * Rueckgabe:
 *   { sekunden, anzahl, frisch }  — `frisch` false, wenn der juengste Wert
 *                                   aelter als eine Woche ist
 *   null                          — zu wenige Werte; der Aufrufer nimmt dann
 *                                   den Code-Wert
 */
async function gemesseneDauer() {
  const jetzt = Date.now();
  if (cache.data !== undefined && jetzt < cache.expiresAt) return cache.data;
  let ergebnis = null;
  try {
    const snap = await datenbank().doc(DOKUMENT).get();
    const werte = snap.exists && Array.isArray(snap.data().werte) ? snap.data().werte : [];
    const brauchbar = werte.filter(
      (w) => w && Number.isFinite(w.s) && w.s >= PLAUSIBEL_MIN_S && w.s <= PLAUSIBEL_MAX_S
    );
    if (brauchbar.length >= MIN_WERTE) {
      const juengster = Math.max(...brauchbar.map((w) => (Number.isFinite(w.t) ? w.t : 0)));
      ergebnis = {
        sekunden: perzentil80(brauchbar.map((w) => w.s)),
        anzahl: brauchbar.length,
        frisch: jetzt - juengster <= HOECHSTALTER_MS,
      };
    }
  } catch (_) {
    /* Firestore nicht erreichbar → Code-Wert. Nie ein Fehler nach aussen. */
    ergebnis = null;
  }
  cache = { data: ergebnis, expiresAt: jetzt + CACHE_TTL_MS };
  return ergebnis;
}

/**
 * Die Dauer, mit der gerechnet wird — gemessen, sonst der Code-Wert.
 * Zweiter Rueckgabewert sagt, ob die Zahl belastbar genug fuer eine
 * Sekundenangabe an den Nutzer ist.
 */
async function dauerJeAnalyse(flagAn) {
  if (!flagAn) return { sekunden: QUEUE_AVG_JOB_SECONDS, gemessen: false, frisch: false };
  const gemessen = await gemesseneDauer();
  if (!gemessen) return { sekunden: QUEUE_AVG_JOB_SECONDS, gemessen: false, frisch: false };
  return { sekunden: gemessen.sekunden, gemessen: true, frisch: gemessen.frisch };
}

module.exports = {
  merkeDauer,
  tagesHistorie,
  gemesseneDauer,
  dauerJeAnalyse,
  /* Fuer Tests */
  _cacheLeeren,
  _RING_GROESSE: RING_GROESSE,
  _MIN_WERTE: MIN_WERTE,
  _PLAUSIBEL_MIN_S: PLAUSIBEL_MIN_S,
  _PLAUSIBEL_MAX_S: PLAUSIBEL_MAX_S,
};
