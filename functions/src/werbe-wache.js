"use strict";

/**
 * werbe-wache.js — Push, wenn die Beast-Werbung zu lange am Stueck ausfaellt.
 *
 * WARUM (Vorgabe vom 21.10.2026): Am 21.10.2026 zwischen 10:25 und 10:40
 * Wien antwortete Mistral auf den Werbe-Aufruf 14-mal "503" und blieb 4-mal
 * ueber der Zeitgrenze. Jede dieser Zeilen war eine Fehlerzeile, und die
 * Nachricht "Fehler im Server" kam wiederholt — dabei waren alle 81 Analysen
 * des Tages fertig, und die Kinder sahen die Werbung aus der Hauptanalyse
 * (Rueckfall in job-pipelines.js). Seitdem ist ein kurzer Aussetzer des
 * Werbe-Aufrufs nur noch eine Warnung (ueberlast.js, istKurzerAussetzer).
 * Damit ein LANGER Ausfall trotzdem auffaellt, gibt es diese Wache.
 *
 * DIE REGEL (Vorgabe Christoph 21.10.2026: "dazwischen klappt die Werbung
 * kein einziges Mal, mindestens 10 gescheiterte Versuche"; beide Grenzen in
 * werbe-wache.test.js von beiden Seiten geprueft):
 *   - Gescheitert ist jeder Werbe-Aufruf ausser "ok": ein kurzer Aussetzer
 *     ("aussetzer"), jeder andere Fehlschlag ("fehler") und eine Antwort ohne
 *     verwertbare Eintraege ("leer"). "leer" schreibt keine Fehlerzeile
 *     (mistral.js) — ohne die Wache bliebe ein dauerhaft unverwertbarer
 *     Werbe-Inhalt ganz still. Ein Auftrag ohne Werbe-Aufruf (Feld fehlt)
 *     aendert nichts.
 *   - Ein Ausfall "am Stueck" reicht vom ersten gescheiterten Versuch nach dem
 *     letzten gelungenen bis zum juengsten — auch ueber eine Pause hinweg:
 *     Scheitert die Werbung am Ende eines Workshops und am Anfang des
 *     naechsten, ohne Erfolg dazwischen, ist das EIN Ausfall.
 *   - Gemeldet wird, wenn er LAENGER als 30 Minuten dauert (30:00 nein,
 *     30:01 ja) UND mindestens 10 gescheiterte Versuche hat (9 nein, 10 ja).
 *   - Eine Nachricht je Ausfall; ein gelungener Aufruf beendet ihn, danach
 *     zaehlt alles neu.
 *
 * ZUSTELLUNG — lieber doppelt als keine: Vor dem Versand reserviert die Wache
 * die Nachricht fuer fuenf Minuten (reserviertFuer, reserviertBis), damit kein
 * zweiter Lauf zugleich sendet. Die Marke gemeldetFuer setzt sie erst, wenn
 * der Versand Erfolg meldet. Geht der Versand nicht hinaus, endet der Lauf
 * zwischen Reservierung und Versand oder scheitert das Setzen der Marke,
 * versucht es nach Ablauf der Reservierung der naechste Lauf — im letzten Fall
 * kommt dieselbe Nachricht ein zweites Mal.
 *
 * WOHER SIE ES WEISS: Der Werbe-Aufruf vermerkt sein Ergebnis in den
 * Kennzahlen des Auftrags (`kennzahlen.werbeAufruf`, job-pipelines.js). Die
 * Wache liest die Auftraege, die seit ihrem letzten Lauf fertig wurden — nur
 * Fertigzeit und dieses eine Feld, keine Kennung, kein Inhalt. Was sie daraus
 * behaelt, steht im Dokument `stats/werbe-wache` (damit es fuer alle
 * Instanzen gilt): bis wann gezaehlt ist, Beginn und juengster Fehlversuch des
 * laufenden Ausfalls, die Zahl der Fehlversuche, Reservierung und Marke —
 * nur Zeitpunkte und eine Anzahl.
 *
 * WO SIE LAEUFT — im Aufraeumdienst (handle-reap.js), VOR dem Loeschen der
 * zugestellten Auftraege: Er laeuft jede Minute ohnehin und belastet keinen
 * Analyseweg.
 */

const { datenbank } = require("./db");

const ZUSTAND_DOKUMENT = "stats/werbe-wache";

/* BLEIBT IM CODE — Schwelle der Alarmierung, keine Betriebseinstellung (wie
   die Schwellen der Wartezeit-Wache): Vorgabe vom 21.10.2026, 30 Minuten,
   AUSSCHLIESSLICH (erst darueber wird gemeldet). Gemessen vom ersten bis zum
   juengsten Fehlversuch des Ausfalls. */
const GRENZE_MS = 30 * 60 * 1000;
/* BLEIBT IM CODE — Schwelle der Alarmierung: Vorgabe vom 21.10.2026,
   mindestens 10 gescheiterte Versuche im Ausfall, EINSCHLIESSLICH (10 meldet,
   9 nicht). Sie haelt zwei vereinzelte Fehlversuche ueber eine lange Pause
   hinweg davon ab, als "langer Ausfall" zu gelten. */
const MINDEST_FEHLVERSUCHE = 10;
/* BLEIBT IM CODE — Schutzgrenze der Messung: So weit schaut die Wache
   hoechstens zurueck. Im Minutentakt sieht sie jeden fertigen Auftrag, bevor
   der Aufraeumdienst ihn loescht: Sie laeuft dort vor dem Loeschen der
   zugestellten Auftraege, und deren Zustellfenster (einstellbar ab 60 s)
   beginnt fruehestens mit der Fertigzeit. Bleibt der Aufraeumdienst laenger
   als 9 min 30 s aus (Blick zurueck minus Nachlauf), fehlen ihr die Auftraege
   dieser Zeit. */
const BLICK_ZURUECK_MS = 10 * 60 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Messung: Gezaehlt wird nur bis 30 s vor
   dem Lauf. Ein Auftrag traegt seine Fertigzeit schon, bevor die Datenbank
   den Abschluss bestaetigt; ohne den Abstand koennte er nach dem Lauf
   auftauchen, aber vor dem neuen Zaehlstand liegen — und fiele durch. */
const NACHLAUF_MS = 30 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Zustellung: So lange gilt eine
   Reservierung. Danach versucht es ein neuer Lauf, falls die Marke fehlt. */
const RESERVIERUNG_MS = 5 * 60 * 1000;
/* BLEIBT IM CODE — Schutzgrenze der Alarmierung wie bei der Wartezeit-Wache:
   so viele Laeufe hintereinander ohne Messung, dann ERROR. Gezaehlt je
   Instanz, wie dort. */
const FEHLER_BIS_ALARM = 5;

let fehlerInFolge = 0;

const zahlOderNull = (wert) => (typeof wert === "number" && Number.isFinite(wert) ? wert : null);

/** Zustand aus dem Dokument, jedes Feld geprueft (reine Rechnung). */
function normalisiere(daten) {
  const d = daten && typeof daten === "object" ? daten : {};
  const fehlversuche = Number.isInteger(d.fehlversuche) && d.fehlversuche > 0 ? d.fehlversuche : 0;
  return {
    geprueftBis: zahlOderNull(d.geprueftBis),
    ausfallSeit: zahlOderNull(d.ausfallSeit),
    letzterFehlversuch: zahlOderNull(d.letzterFehlversuch),
    fehlversuche,
    gemeldetFuer: zahlOderNull(d.gemeldetFuer),
    reserviertFuer: zahlOderNull(d.reserviertFuer),
    reserviertBis: zahlOderNull(d.reserviertBis),
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
    .filter((e) => e && zahlOderNull(e.finishedAt) !== null && typeof e.werbeAufruf === "string")
    .sort((a, b) => a.finishedAt - b.finishedAt || rang(a) - rang(b));
  for (const e of sortiert) {
    if (e.werbeAufruf === "ok") {
      z.ausfallSeit = null;
      z.letzterFehlversuch = null;
      z.fehlversuche = 0;
    } else {
      if (z.ausfallSeit === null) z.ausfallSeit = e.finishedAt;
      z.fehlversuche += 1;
      z.letzterFehlversuch = Math.max(z.letzterFehlversuch ?? e.finishedAt, e.finishedAt);
    }
  }
  return z;
}

/** Dauer des laufenden Ausfalls in ms (erster bis juengster Fehlversuch), oder 0. */
function ausfallDauer(zustand) {
  const z = normalisiere(zustand);
  return z.ausfallSeit === null || z.letzterFehlversuch === null ? 0 : z.letzterFehlversuch - z.ausfallSeit;
}

/** Ist der laufende Ausfall lang genug fuer eine Nachricht — ohne Blick auf
 *  Marke und Reservierung? 30:00 nein, 30:01 ja; 9 Fehlversuche nein, 10 ja. */
function langerAusfall(zustand) {
  const z = normalisiere(zustand);
  return z.ausfallSeit !== null && z.fehlversuche >= MINDEST_FEHLVERSUCHE && ausfallDauer(z) > GRENZE_MS;
}

/** Darf dieser Lauf die Nachricht fuer den laufenden Ausfall jetzt versuchen?
 *  Nein, wenn sie zugestellt ist (Marke) oder ein Lauf sie gerade versucht
 *  (Reservierung fuer diesen Ausfall, noch nicht abgelaufen). */
function meldungFaellig(zustand, jetzt) {
  const z = normalisiere(zustand);
  if (!langerAusfall(z) || z.gemeldetFuer === z.ausfallSeit) return false;
  return !(z.reserviertFuer === z.ausfallSeit && z.reserviertBis !== null && jetzt < z.reserviertBis);
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
    `${z.fehlversuche} Versuche am Stueck, keiner gelungen (ueber ${alsDauer(ausfallDauer(z))}). ` +
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

/* Marke nach bestaetigtem Versand. Scheitert sie, kommt nach Ablauf der
   Reservierung eine zweite Nachricht — lieber doppelt als keine. Wirft nicht. */
async function markeSetzen(ref, ausfallSeit) {
  try {
    await ref.set({ gemeldetFuer: ausfallSeit }, { merge: true });
    return true;
  } catch (_) {
    return false;
  }
}

const laufStatus = (z) => (z.ausfallSeit === null ? "im-rahmen" : "ausfall-laeuft");

/**
 * Ein Durchgang der Wache. Wirft nie.
 * @param {{melder?: (text: string) => Promise<unknown>, jetzt?: number}} [opts]
 *   melder: schickt die Nachricht (index.js: sendeNtfy); ohne melder nur Protokoll
 * @returns {Promise<{status: string, fehlversuche?: number, dauerMs?: number}>}
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

    /* Nichts Neues und keine Nachricht zu versuchen: nichts schreiben. Der
       naechste Lauf liest ab demselben Stand — doppelt sieht er dabei nichts,
       denn in diesem Abschnitt war kein Auftrag. */
    if (ereignisse.length === 0 && !meldungFaellig(z0, jetzt)) {
      return { status: laufStatus(z0), fehlversuche: z0.fehlversuche };
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
      const faellig = meldungFaellig(neu, jetzt);
      if (faellig) {
        neu.reserviertFuer = neu.ausfallSeit;
        neu.reserviertBis = jetzt + RESERVIERUNG_MS;
      }
      tx.set(ref, neu);
      return { neu, faellig };
    });
    if (schritt.andererLauf) return { status: "anderer-lauf" };

    const { neu, faellig } = schritt;
    const dauerMs = ausfallDauer(neu);
    const zahlen = { fehlversuche: neu.fehlversuche, dauerMs };
    if (!faellig) return { status: laufStatus(neu), ...zahlen };

    /* Zugestellt heisst: der Versandweg meldet Erfolg (sendeNtfy: true) — wie
       bei der Wartezeit-Wache. Auch ein Melder, der sofort wirft, gilt als
       nicht zugestellt. */
    const text = baueMeldung(neu);
    const zugestellt = melder
      ? await Promise.resolve()
          .then(() => melder(text))
          .then(
            (r) => r === true,
            () => false
          )
      : false;
    /* Keine Kennung im Protokoll: nur die zwei Zahlen der Nachricht. */
    if (!zugestellt) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          step: "werbe-wache",
          status: "nicht-zugestellt",
          warning: "werbe-wache-nicht-zugestellt",
          ...zahlen,
        })
      );
      return { status: "nicht-zugestellt", ...zahlen };
    }
    const markeGesetzt = await markeSetzen(ref, neu.ausfallSeit);
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        step: "werbe-wache",
        status: "gemeldet",
        ...zahlen,
        ...(markeGesetzt ? {} : { warning: "werbe-wache-marke-nicht-gesetzt" }),
      })
    );
    return { status: "gemeldet", ...zahlen };
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
  MINDEST_FEHLVERSUCHE,
  RESERVIERUNG_MS,
  FEHLER_BIS_ALARM,
};
