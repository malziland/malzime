"use strict";

/**
 * werbe-wache.js — Push, wenn die Beast-Werbung zu lange am Stueck ausfaellt.
 *
 * WARUM (Vorgabe vom 21.10.2026): Am 21.10.2026 zwischen 10:25 und 10:40
 * Wien antwortete Mistral auf den Werbe-Aufruf 14-mal "503" und blieb 4-mal
 * ueber der Zeitgrenze. Jede dieser Zeilen war eine Fehlerzeile, und die
 * Nachricht "Fehler im Server" kam wiederholt — dabei waren alle 81 Analysen des Tages
 * fertig, und die Kinder sahen die Werbung aus der Hauptanalyse (Rueckfall in
 * job-pipelines.js). Seitdem ist ein kurzer Aussetzer des Werbe-Aufrufs nur
 * noch eine Warnung (mistral.js, istKurzerAussetzer). Damit ein LANGER
 * Ausfall trotzdem auffaellt, gibt es diese Wache.
 *
 * DIE REGEL (Vorgabe 21.10.2026, beide Grenzen in werbe-wache.test.js von
 * beiden Seiten geprueft):
 *   - Ein Ausfall "am Stueck" beginnt mit dem ersten Aussetzer nach dem
 *     letzten gelungenen Werbe-Aufruf und reicht bis zum juengsten Aussetzer —
 *     auch ueber eine Pause hinweg: Scheitert die Werbung am Ende eines
 *     Workshops und am Anfang des naechsten, ohne Erfolg dazwischen, ist das
 *     EIN Ausfall.
 *   - Gemeldet wird, wenn er LAENGER als 30 Minuten dauert (30:00 nein,
 *     30:01 ja) UND mindestens 10 Aussetzer hat (9 nein, 10 ja).
 *   - Hoechstens eine Nachricht je Ausfall; ein gelungener Aufruf beendet ihn,
 *     danach zaehlt alles neu.
 *   - "leer" (Antwort ohne Eintraege) und "fehler" (jeder andere Fehlschlag)
 *     aendern nichts: Fehler alarmieren schon selbst (Fehlerzeile in
 *     mistral.js), eine leere Antwort ist kein Aussetzer.
 *
 * WOHER SIE ES WEISS: Der Werbe-Aufruf vermerkt sein Ergebnis in den
 * Kennzahlen des Auftrags (`kennzahlen.werbeAufruf`, job-pipelines.js). Die
 * Wache liest die Auftraege, die seit ihrem letzten Lauf fertig wurden — nur
 * Fertigzeit und dieses eine Feld, keine Kennung, kein Inhalt. Was sie daraus
 * behaelt, sind vier Zahlen im Dokument `stats/werbe-wache` (damit es fuer
 * alle Instanzen gilt): bis wann gezaehlt ist, Beginn und juengster Aussetzer
 * des laufenden Ausfalls, die Zahl der Aussetzer — plus die Marke, fuer
 * welchen Ausfall schon gemeldet wurde.
 *
 * WO SIE LAEUFT — im Aufraeumdienst (handle-reap.js), wie die Wartezeit-
 * Wache: Er laeuft jede Minute ohnehin und belastet keinen Analyseweg.
 */

const { datenbank } = require("./db");

const ZUSTAND_DOKUMENT = "stats/werbe-wache";

/* BLEIBT IM CODE — Schwelle der Alarmierung, keine Betriebseinstellung (wie
   die Schwellen der Wartezeit-Wache): Vorgabe vom 21.10.2026, 30 Minuten,
   AUSSCHLIESSLICH (erst darueber wird gemeldet). Gemessen vom ersten bis zum
   juengsten Aussetzer des Ausfalls. */
const GRENZE_MS = 30 * 60 * 1000;
/* BLEIBT IM CODE — Schwelle der Alarmierung: Vorgabe vom 21.10.2026,
   mindestens 10 Aussetzer im Ausfall, EINSCHLIESSLICH (10 meldet, 9 nicht).
   Sie haelt zwei vereinzelte Aussetzer ueber eine lange Pause hinweg davon ab,
   als "langer Ausfall" zu gelten. */
const MINDEST_AUSSETZER = 10;
/* BLEIBT IM CODE — Schutzgrenze der Messung: So weit schaut die Wache
   hoechstens zurueck. Ein zugestellter Auftrag wird 15 Minuten nach der
   Zustellung geloescht; zehn Minuten reichen, damit ein paar ausgefallene
   Laeufe des Aufraeumdienstes keine Luecke lassen. */
const BLICK_ZURUECK_MS = 10 * 60 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Messung: Gezaehlt wird nur bis 30 s vor
   dem Lauf. Ein Auftrag traegt seine Fertigzeit schon, bevor die Datenbank
   den Abschluss bestaetigt; ohne den Abstand koennte er nach dem Lauf
   auftauchen, aber vor dem neuen Zaehlstand liegen — und fiele durch. */
const NACHLAUF_MS = 30 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Alarmierung wie bei der Wartezeit-Wache:
   so viele Laeufe hintereinander ohne Messung, dann ERROR. */
const FEHLER_BIS_ALARM = 5;

let fehlerInFolge = 0;

const zahlOderNull = (wert) => (typeof wert === "number" && Number.isFinite(wert) ? wert : null);

/** Zustand aus dem Dokument, jedes Feld geprueft (reine Rechnung). */
function normalisiere(daten) {
  const d = daten && typeof daten === "object" ? daten : {};
  const aussetzer = Number.isInteger(d.aussetzer) && d.aussetzer > 0 ? d.aussetzer : 0;
  return {
    geprueftBis: zahlOderNull(d.geprueftBis),
    ausfallSeit: zahlOderNull(d.ausfallSeit),
    letzterAussetzer: zahlOderNull(d.letzterAussetzer),
    aussetzer,
    gemeldetFuer: zahlOderNull(d.gemeldetFuer),
  };
}

/**
 * Schreibt den Zustand mit neuen Ergebnissen des Werbe-Aufrufs fort (reine
 * Rechnung). `ereignisse`: [{ finishedAt, werbeAufruf }] in beliebiger
 * Reihenfolge. Bei gleicher Fertigzeit zaehlt ein gelungener Aufruf zuletzt:
 * Mistral hat in diesem Augenblick wieder geliefert.
 */
function fortschreiben(zustand, ereignisse) {
  const z = { ...normalisiere(zustand) };
  const rang = (e) => (e.werbeAufruf === "ok" ? 1 : 0);
  const sortiert = (ereignisse || [])
    .filter((e) => e && zahlOderNull(e.finishedAt) !== null)
    .sort((a, b) => a.finishedAt - b.finishedAt || rang(a) - rang(b));
  for (const e of sortiert) {
    if (e.werbeAufruf === "ok") {
      z.ausfallSeit = null;
      z.letzterAussetzer = null;
      z.aussetzer = 0;
    } else if (e.werbeAufruf === "aussetzer") {
      if (z.ausfallSeit === null) z.ausfallSeit = e.finishedAt;
      z.aussetzer += 1;
      z.letzterAussetzer = Math.max(z.letzterAussetzer ?? e.finishedAt, e.finishedAt);
    }
    /* "leer", "fehler" und Auftraege ohne Werbe-Aufruf aendern nichts. */
  }
  return z;
}

/** Dauer des laufenden Ausfalls in ms (erster bis juengster Aussetzer), oder 0. */
function ausfallDauer(zustand) {
  const z = normalisiere(zustand);
  return z.ausfallSeit === null || z.letzterAussetzer === null ? 0 : z.letzterAussetzer - z.ausfallSeit;
}

/** Ist der laufende Ausfall lang genug fuer eine Nachricht — ohne Blick auf
 *  die Marke? 30:00 nein, 30:01 ja; 9 Aussetzer nein, 10 ja. */
function langerAusfall(zustand) {
  const z = normalisiere(zustand);
  return z.ausfallSeit !== null && z.aussetzer >= MINDEST_AUSSETZER && ausfallDauer(z) > GRENZE_MS;
}

/** Steht fuer diesen Ausfall noch eine Nachricht aus? */
function meldungFaellig(zustand) {
  const z = normalisiere(zustand);
  return langerAusfall(z) && z.gemeldetFuer !== z.ausfallSeit;
}

const WIENER_ZEIT = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "31 min" oder "2 h 05 min" — fuer die Nachricht. */
function alsDauer(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** Text der Nachricht, in klarer Sprache (reine Rechnung). */
function baueMeldung(zustand) {
  const z = normalisiere(zustand);
  const seit = WIENER_ZEIT.format(new Date(z.ausfallSeit)).replace(",", "");
  return (
    `malziME: Die Beast-Werbung klappt seit ${seit} (Wiener Zeit) nicht mehr — ` +
    `${z.aussetzer} Versuche am Stueck, keiner gelungen (ueber ${alsDauer(ausfallDauer(z))}). ` +
    "Die Analysen laufen weiter, die Kinder sehen die Werbung aus der Hauptanalyse. " +
    'Was tun: RUNBOOK, "Beast-Werbung faellt aus".'
  );
}

/* Die Ergebnisse des Werbe-Aufrufs der Auftraege, die in (seit, bis] fertig
   wurden. Automatischer Einzelfeld-Index auf finishedAt; nur zwei Felder. */
async function ergebnisseFertigZwischen(seit, bis) {
  const snap = await datenbank()
    .collection("jobs")
    .where("finishedAt", ">", seit)
    .where("finishedAt", "<=", bis)
    .select("finishedAt", "kennzahlen.werbeAufruf")
    .get();
  return snap.docs.map((d) => {
    const kz = d.get("kennzahlen");
    return {
      finishedAt: d.get("finishedAt"),
      werbeAufruf: kz && typeof kz === "object" && typeof kz.werbeAufruf === "string" ? kz.werbeAufruf : null,
    };
  });
}

/* Nimmt die eigene Reservierung zurueck, wenn die Nachricht nicht hinausging
   — nur, wenn sie noch die eigene ist. Danach versucht es der naechste Lauf
   wieder (wie markeZuruecknehmen in wartezeit-wache.js). Wirft nicht. */
async function reservierungZuruecknehmen(ausfallSeit, vorher) {
  try {
    const db = datenbank();
    const ref = db.doc(ZUSTAND_DOKUMENT);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("gemeldetFuer") === ausfallSeit)
        tx.set(ref, { gemeldetFuer: vorher }, { merge: true });
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
 * @returns {Promise<{status: string, aussetzer?: number, dauerMs?: number}>}
 */
async function pruefeWerbung({ melder = null, jetzt = Date.now() } = {}) {
  try {
    const db = datenbank();
    const ref = db.doc(ZUSTAND_DOKUMENT);
    const vorab = await ref.get();
    const z0 = normalisiere(vorab.exists ? vorab.data() : {});
    const bis = jetzt - NACHLAUF_MS;
    const seit = Math.max(z0.geprueftBis ?? 0, jetzt - BLICK_ZURUECK_MS);
    const ereignisse = bis > seit ? await ergebnisseFertigZwischen(seit, bis) : [];
    fehlerInFolge = 0;

    /* Nichts Neues und nichts mehr zu melden: nichts schreiben. Der naechste
       Lauf liest ab demselben Stand — doppelt sieht er dabei nichts, denn in
       diesem Abschnitt war kein Auftrag. */
    if (ereignisse.length === 0 && !meldungFaellig(z0)) {
      return { status: z0.ausfallSeit === null ? "im-rahmen" : "ausfall-laeuft", aussetzer: z0.aussetzer };
    }

    /* Fortschreiben und, wenn faellig, die Nachricht reservieren — in einer
       Transaktion. Hat inzwischen ein anderer Lauf gezaehlt (Stand verschoben),
       zaehlt dieser nicht noch einmal. */
    const schritt = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const z = normalisiere(snap.exists ? snap.data() : {});
      if (z.geprueftBis !== z0.geprueftBis) return { andererLauf: true };
      const neu = fortschreiben(z, ereignisse);
      if (ereignisse.length > 0) neu.geprueftBis = bis;
      const faellig = meldungFaellig(neu);
      const vorher = neu.gemeldetFuer;
      if (faellig) neu.gemeldetFuer = neu.ausfallSeit;
      tx.set(ref, neu);
      return { neu, faellig, vorher };
    });
    if (schritt.andererLauf) return { status: "anderer-lauf" };

    const { neu, faellig, vorher } = schritt;
    const dauerMs = ausfallDauer(neu);
    if (!faellig) {
      return { status: neu.ausfallSeit === null ? "im-rahmen" : "ausfall-laeuft", aussetzer: neu.aussetzer, dauerMs };
    }

    const text = baueMeldung(neu);
    /* Zugestellt heisst: der Versandweg meldet Erfolg (sendeNtfy: true) — wie
       bei der Wartezeit-Wache. Sonst die Reservierung zuruecknehmen. */
    const zugestellt = melder
      ? await Promise.resolve(melder(text)).then(
          (r) => r === true,
          () => false
        )
      : false;
    /* Keine Kennung: nur die zwei Zahlen der Nachricht. */
    if (zugestellt) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          step: "werbe-wache",
          status: "gemeldet",
          aussetzer: neu.aussetzer,
          dauerMs,
        })
      );
      return { status: "gemeldet", aussetzer: neu.aussetzer, dauerMs };
    }
    const zurueck = await reservierungZuruecknehmen(neu.ausfallSeit, vorher);
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        step: "werbe-wache",
        status: "nicht-zugestellt",
        warning: "werbe-wache-nicht-zugestellt",
        reservierungZurueckgenommen: zurueck,
        aussetzer: neu.aussetzer,
        dauerMs,
      })
    );
    return { status: "nicht-zugestellt", aussetzer: neu.aussetzer, dauerMs };
  } catch (err) {
    fehlerInFolge += 1;
    const zeile = {
      severity: fehlerInFolge >= FEHLER_BIS_ALARM ? "ERROR" : "WARNING",
      step: "werbe-wache",
      warning: "werbe-wache-nicht-messbar",
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

module.exports = {
  pruefeWerbung,
  fortschreiben,
  langerAusfall,
  meldungFaellig,
  baueMeldung,
  _zuruecksetzen,
  GRENZE_MS,
  MINDEST_AUSSETZER,
  FEHLER_BIS_ALARM,
};
