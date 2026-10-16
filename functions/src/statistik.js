"use strict";

/**
 * statistik.js — dauerhafte, anonyme Zaehler in der Sammlung `statistik`.
 *
 * WARUM (Auftrag des Inhabers, 16.10.2026): Was im Betrieb hakt, steht bisher
 * nur im technischen Protokoll — und das war nach einem Tag weg. Gezaehlt wird
 * jetzt ohne Ablaufdatum, aber nur als SUMME:
 *
 *   - je 10-Minuten-Fenster (`statistik/fenster-<UTC>`): eingereiht,
 *     abgewiesen je Grund, in der Schlange verworfen, fertig, gescheitert je
 *     Grund, abgeholt, nie abgeholt; Wartezeit, Gesamtzeit und KI-Dauer in
 *     Klassen; Zahl der KI-Wiederholungen.
 *   - je Tag (`statistik/tag-<Wiener Datum>`): Browser-Fehler nach Phase und
 *     Geraetefamilie, Textmenge der KI (Eingabe, davon Zwischenspeicher,
 *     Ausgabe).
 *
 * BEWUSST NICHT (Vorgabe): keine Zeile je Analyse, keine Kennung, kein Alter,
 * keine Werte des Kinderschutzes. Ein Fenster mit einer einzigen Analyse
 * verraet deren Klassen — mehr nicht, und keine Nummer fuehrt zu ihr.
 *
 * WARUM DAS FENSTER IN UTC HEISST, DER TAG ABER NACH WIENER DATUM:
 * Ein 10-Minuten-Fenster in Wiener Ortszeit waere in der Nacht der
 * Zeitumstellung im Oktober doppelt da (02:00 bis 03:00 gibt es zweimal) —
 * zwei Fenster mit demselben Namen wuerden still zusammengezaehlt. UTC hat
 * keine Luecke und keine Doppelung; das Auswertungswerkzeug zeigt Wiener Zeit.
 * Der Tag ist dagegen ein menschlicher Begriff ("der Workshop am 16.10."):
 * Er laeuft von Wiener Mitternacht bis Wiener Mitternacht. Weil Wien immer um
 * ganze Stunden von UTC abweicht, liegt jedes 10-Minuten-Fenster vollstaendig
 * in genau einem Wiener Tag.
 *
 * ZU WELCHEM FENSTER EIN AUFTRAG GEHOERT: zu dem seines Einreihens
 * (`createdAt`) — auch wenn er erst zwei Stunden spaeter gezaehlt wird. So
 * gehoeren "eingereiht" und sein Ausgang immer zum selben Fenster. Folge: Die
 * juengsten zwei Stunden sind noch unvollstaendig (Hinweis im Werkzeug).
 *
 * WER ZAEHLT:
 *   - Auftraege zaehlt der Aufraeumdienst (handle-reap.js), unmittelbar bevor
 *     er sie loescht (zaehleVorDemLoeschen) — keine Last im Analyseweg.
 *   - Abweisungen zaehlt die Annahmestelle (handle-enqueue.js), Browser-Fehler
 *     die Fehler-Annahme (handle-errors.js), beide ueber den Sammler unten.
 */

const { FieldValue } = require("firebase-admin/firestore");
const { datenbank } = require("./db");
const { fehlerGrund } = require("./analyse-ausgang");

const SAMMLUNG = "statistik";

/* BLEIBT IM CODE — Zaehlformat, keine Betriebseinstellung: Wer die
   Fensterbreite aendert, macht alle bisherigen Fenster unvergleichbar. Vorgabe
   des Inhabers (16.10.2026): 10 Minuten. */
const FENSTER_MS = 10 * 60 * 1000;

/* BLEIBT IM CODE — Zaehlformat (Vorgabe 16.10.2026): die Obergrenzen der
   Dauer-Klassen, jeweils AUSSCHLIESSLICH ("unter 30 s": 29,999 s ja, genau
   30 s nicht — die zaehlen zur naechsten Klasse). Alles ab 8 Minuten ist
   "laenger". Geaendert werden darf das nur mit neuen Feldnamen. */
const KLASSEN = Object.freeze([
  ["unter30s", 30 * 1000],
  ["unter1min", 60 * 1000],
  ["unter2min", 2 * 60 * 1000],
  ["unter4min", 4 * 60 * 1000],
  ["unter8min", 8 * 60 * 1000],
]);
const KLASSE_LAENGER = "laenger";

/* BLEIBT IM CODE — Schutzgrenze, keine Betriebseinstellung: So oft schreibt
   eine Instanz Abweisungen und Browser-Fehler hoechstens. Beide kommen von
   oeffentlichen Schnittstellen; wer sie flutet, soll uns nicht je Anfrage
   einen bezahlten Schreibvorgang kosten (Abwaegung: docs/SECURITY-MODEL.md,
   "Dauerhafte Zaehler"). Dazwischen wird im Speicher gesammelt. */
const SAMMEL_ABSTAND_MS = 2000;
/* BLEIBT IM CODE — Schutzgrenze: So lange wartet eine Antwort hoechstens auf
   ihren Zaehler. Ein Schreibvorgang dauert sonst Millisekunden; haengt die
   Datenbank, geht die Antwort trotzdem hinaus. */
const SAMMEL_WARTEN_MS = 1000;
/* BLEIBT IM CODE — Schutzgrenze: So lange wartet der Aufraeumdienst je
   Fenster hoechstens auf das Zaehlen, dann loescht er trotzdem (die
   Loeschfrist geht vor). Weit unter seiner Zeitgrenze von 120 s. */
const ZAEHLEN_WARTEN_MS = 10 * 1000;
/* BLEIBT IM CODE — Grenze von Firestore: hoechstens 500 Schreibvorgaenge je
   Transaktion. Ein Fenster mit mehr Auftraegen in einem Lauf wird geteilt. */
const AUFTRAEGE_JE_TRANSAKTION = 400;
/* BLEIBT IM CODE — Schutzgrenze der Alarmierung wie LAEUFE_BIS_ALARM im
   Aufraeumdienst: Scheitert das Zaehlen so viele Laeufe in Folge, ist es kein
   Ausrutscher mehr, sondern ein Ausfall, den sonst niemand bemerkt. */
const ZAEHL_FEHLER_BIS_ALARM = 5;

/* Die Phasen, die der Browser bei Fehlern meldet (public/js). Jede andere
   zaehlt als "andere": Die Phase kommt von einer oeffentlichen Schnittstelle
   und wird hier zum Feldnamen — freie Werte koennten das Tagesdokument
   beliebig aufblaehen. Eine neue Phase im Browser-Code braucht hier eine
   Zeile; statistik-phasen.test.js haelt beide Listen gleich. */
const PHASEN = Object.freeze([
  "absturz-schleife",
  "analyse-blockiert",
  "auftrag-verworfen",
  "auswahl-leer",
  "auswahl-leer-nach-foto",
  "datei-fehlt",
  "datei-zu-gross",
  "demo-image-load",
  "druck-abbruch-seite-leer",
  "einreihen-ohne-auftrag",
  "ergebnis-leer",
  "gps-karte-aufbau",
  "image-decode",
  "image-read",
  "offline",
  "queue-enqueue",
  "queue-network",
  "queue-poll",
  "queue-resume",
  "resume-aufgegeben",
  "resume-aus-hintergrund",
  "resume-nach-abriss",
  "resume-verbindung",
  "uebergabe-pause",
  "unknown",
]);

/* Die Gruende, mit denen die Annahmestelle ein Foto abweist (handle-enqueue.js).
   Ein Grund, der hier fehlt, zaehlt als "unbekannt" — so faellt ein
   Tippfehler in der Auswertung auf, statt ein neues Feld anzulegen. */
const ABWEISUNGSGRUENDE = Object.freeze([
  "wartung",
  "satzFehlt",
  "adresslimit",
  "zuGross",
  "ungueltig",
  "honeypot",
  "schlangeVoll",
  "stundenlimit",
  "anlegenGescheitert",
  "unerwartet",
]);

/* ── Reine Rechnung ─────────────────────────────────────────────────────── */

/** Beginn des 10-Minuten-Fensters (UTC, ms), in dem `ms` liegt. */
function fensterBeginn(ms) {
  return Math.floor(ms / FENSTER_MS) * FENSTER_MS;
}

/** Dokumentname des Fensters, z. B. "fenster-2026-10-16T06-20Z" (UTC). */
function fensterId(ms) {
  const iso = new Date(fensterBeginn(ms)).toISOString(); // 2026-10-16T06:20:00.000Z
  return `fenster-${iso.slice(0, 13)}-${iso.slice(14, 16)}Z`;
}

const WIEN = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Wiener Datum als "JJJJ-MM-TT". */
function wienerDatum(ms) {
  return WIEN.format(new Date(ms));
}

/** Dokumentname des Tages, z. B. "tag-2026-10-16" (Wiener Datum). */
function tagId(ms) {
  return `tag-${wienerDatum(ms)}`;
}

/** Klasse einer Dauer in ms; null bei ungueltigem Wert. */
function dauerKlasse(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  for (const [name, grenze] of KLASSEN) {
    if (ms < grenze) return name;
  }
  return KLASSE_LAENGER;
}

/** Feldname eines Fehlgrunds: "blocked.overloaded" -> "overloaded". */
function grundFeld(grund) {
  const kurz = String(grund || "").replace(/^blocked\./, "");
  return /^[A-Za-z0-9_-]{1,40}$/.test(kurz) ? kurz : "unbekannt";
}

/** Geraetefamilie aus den groben Angaben einer Fehlermeldung. */
function geraetefamilie(userAgent, bildschirm) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const system = ua.includes(" / ") ? ua.slice(ua.lastIndexOf(" / ") + 3).trim() : "";
  if (system === "iOS") {
    /* Ein iPad meldet sich meist als Mac; meldet es sich als iOS, verraet es
       der Bildschirm (iPhones liegen unter 1000 Punkten, client-context.js). */
    return bildschirm === "medium" || bildschirm === "large" ? "appleTabletOderMac" : "appleTelefon";
  }
  if (system === "macOS") return "appleTabletOderMac";
  if (system === "Android") return "android";
  if (system === "Windows" || system === "Linux") return "computer";
  return "unbekannt";
}

/** Feldname einer Phase: bekannte Phase oder "andere". */
function phaseFeld(phase) {
  return PHASEN.includes(phase) ? phase : "andere";
}

function zahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) && wert > 0 ? Math.round(wert) : 0;
}

/* Addiert `n` an der Stelle `pfad` in einem verschachtelten Objekt. */
function addiere(ziel, pfad, n) {
  if (!n) return;
  let stelle = ziel;
  for (let i = 0; i < pfad.length - 1; i += 1) {
    stelle[pfad[i]] = stelle[pfad[i]] || {};
    stelle = stelle[pfad[i]];
  }
  const letzter = pfad[pfad.length - 1];
  stelle[letzter] = (stelle[letzter] || 0) + n;
}

/**
 * Was EIN Auftrag zu den Zaehlern beitraegt — reine Rechnung auf seinem
 * Dokument. `null`, wenn er nicht gezaehlt wird: Ein Auftrag, den die
 * Annahmestelle gleich wieder zurueckgenommen hat (`abbruchArt: "einlass"`),
 * ist dort schon als Abweisung gezaehlt.
 *
 * @returns {{fenster: string, beginn: number, tag: string, felder: object, tagFelder: object}|null}
 */
function beitragEinesAuftrags(job) {
  if (!job || typeof job.createdAt !== "number") return null;
  if (job.abbruchArt === "einlass") return null;
  const felder = {};
  const tagFelder = {};
  addiere(felder, ["eingereiht"], 1);

  if (job.status === "abandoned") {
    addiere(felder, ["verworfen"], 1);
  } else if (job.status === "done" || job.status === "failed") {
    const grund = fehlerGrund(job);
    if (grund) addiere(felder, ["gescheitert", grundFeld(grund)], 1);
    else addiere(felder, ["fertig"], 1);
    if (job.status === "done") addiere(felder, [job.deliveredAt ? "abgeholt" : "nieAbgeholt"], 1);
    /* Gesamtzeit nur fuer fertige Analysen: Die Summe ihrer Klassen ist dann
       genau "fertig". */
    if (!grund && typeof job.finishedAt === "number") {
      const k = dauerKlasse(job.finishedAt - job.createdAt);
      if (k) addiere(felder, ["gesamtzeit", k], 1);
    }
  } else {
    /* Noch wartend oder laufend, als die Loeschfrist kam — kein Ausgang. */
    addiere(felder, ["gescheitert", "ohneAbschluss"], 1);
  }

  if (typeof job.startedAt === "number") {
    const k = dauerKlasse(job.startedAt - job.createdAt);
    if (k) addiere(felder, ["wartezeit", k], 1);
  }

  const kz = job.kennzahlen && typeof job.kennzahlen === "object" ? job.kennzahlen : null;
  if (kz) {
    const k = dauerKlasse(kz.kiMs);
    if (k) addiere(felder, ["kiDauer", k], 1);
    addiere(felder, ["kiWiederholungen"], zahl(kz.kiWiederholungen));
    addiere(tagFelder, ["kiText", "eingabe"], zahl(kz.tokenEingabe));
    addiere(tagFelder, ["kiText", "zwischenspeicher"], zahl(kz.tokenZwischenspeicher));
    addiere(tagFelder, ["kiText", "ausgabe"], zahl(kz.tokenAusgabe));
  }

  return {
    fenster: fensterId(job.createdAt),
    beginn: fensterBeginn(job.createdAt),
    tag: tagId(job.createdAt),
    felder,
    tagFelder,
  };
}

/** Addiert ein verschachteltes Zahlenobjekt in ein anderes. */
function summiereIn(ziel, quelle) {
  for (const [k, v] of Object.entries(quelle || {})) {
    if (typeof v === "number") addiere(ziel, [k], v);
    else if (v && typeof v === "object") {
      ziel[k] = ziel[k] && typeof ziel[k] === "object" ? ziel[k] : {};
      summiereIn(ziel[k], v);
    }
  }
  return ziel;
}

/** Wandelt ein verschachteltes Zahlenobjekt in Firestore-Inkremente. */
function alsInkremente(summe) {
  const aus = {};
  for (const [k, v] of Object.entries(summe || {})) {
    if (typeof v === "number") aus[k] = FieldValue.increment(v);
    else if (v && typeof v === "object") aus[k] = alsInkremente(v);
  }
  return aus;
}

function hatWerte(objekt) {
  return Object.values(objekt || {}).some((v) => (typeof v === "number" ? v !== 0 : hatWerte(v)));
}

/* ── Hilfen fuer Zeitgrenzen und Protokoll ──────────────────────────────── */

const ZU_LANGE = Symbol("zu-lange");

/** Wartet hoechstens `ms` auf `vorgang`; danach kommt ZU_LANGE zurueck. Wirft, wenn der Vorgang wirft. */
async function hoechstens(vorgang, ms) {
  let uhr = null;
  const zuLange = new Promise((fertig) => {
    uhr = setTimeout(() => fertig(ZU_LANGE), ms);
    if (typeof uhr.unref === "function") uhr.unref();
  });
  try {
    return await Promise.race([vorgang, zuLange]);
  } finally {
    clearTimeout(uhr);
  }
}

/* Nur Code und Art (wie im Aufraeumdienst): Ein Firestore-Fehlertext kann den
   Dokumentpfad samt jobId enthalten. */
function warne(warnung, err, zusatz = {}) {
  console.warn(
    JSON.stringify({
      severity: "WARNING",
      step: "statistik",
      warning: warnung,
      code: (err && err.code) || null,
      art: (err && err.name) || null,
      ...zusatz,
    })
  );
}

/* ── Zaehlen vor dem Loeschen (Aufraeumdienst) ──────────────────────────── */

let zaehlFehlerInFolge = 0;

/* Eine Transaktion fuer einen Teil der Auftraege EINES Fensters. Sie liest
   die Auftraege frisch, zaehlt nur die, die es noch gibt und die noch nicht
   gezaehlt sind, und markiert genau diese (`gezaehlt: true`) — im selben
   Schritt wie die Erhoehung. Laeuft ein zweiter Lauf parallel, sieht seine
   Transaktion die Marke und zaehlt nichts doppelt. */
async function zaehleTeil(refs, fensterName, beginn) {
  const db = datenbank();
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const fenster = {};
    const tage = {};
    const zuMarkieren = [];
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const daten = snap.data() || {};
      if (daten.gezaehlt === true) continue;
      zuMarkieren.push(snap.ref);
      const beitrag = beitragEinesAuftrags(daten);
      if (!beitrag) continue;
      summiereIn(fenster, beitrag.felder);
      if (hatWerte(beitrag.tagFelder)) {
        tage[beitrag.tag] = summiereIn(tage[beitrag.tag] || {}, beitrag.tagFelder);
      }
    }
    if (hatWerte(fenster)) {
      tx.set(
        db.collection(SAMMLUNG).doc(fensterName),
        { art: "fenster", beginn, ...alsInkremente(fenster) },
        { merge: true }
      );
    }
    for (const [tag, summe] of Object.entries(tage)) {
      tx.set(
        db.collection(SAMMLUNG).doc(tag),
        { art: "tag", tag: tag.slice(4), ...alsInkremente(summe) },
        { merge: true }
      );
    }
    for (const ref of zuMarkieren) tx.update(ref, { gezaehlt: true });
    return zuMarkieren.length;
  });
}

/**
 * Zaehlt Auftraege, unmittelbar bevor der Aufraeumdienst sie loescht.
 *
 * Gesammelt: EINE Transaktion je Fenster und Lauf (bei mehr als
 * AUFTRAEGE_JE_TRANSAKTION Auftraegen eines Fensters mehrere). Wirft NIE und
 * wartet je Fenster hoechstens ZAEHLEN_WARTEN_MS: Die Loeschfrist ist eine
 * Datenschutzzusage, das Zaehlen nur Statistik. Scheitert es, steht eine
 * Warnzeile im Protokoll, und der Auftrag fehlt in der Zaehlung (nie doppelt:
 * Die Marke entsteht nur zusammen mit der Erhoehung).
 *
 * @param {Array<{id: string, createdAt?: number, gezaehlt?: boolean}>} auftraege
 *   die Liste aus der Loeschabfrage
 * @returns {Promise<{gezaehlt: number, gescheitert: number}>}
 */
async function zaehleVorDemLoeschen(auftraege) {
  const ergebnis = { gezaehlt: 0, gescheitert: 0 };
  const offen = (auftraege || []).filter(
    (j) => j && typeof j.id === "string" && j.gezaehlt !== true && typeof j.createdAt === "number"
  );
  if (offen.length === 0) return ergebnis;
  const gruppen = new Map();
  for (const job of offen) {
    const name = fensterId(job.createdAt);
    if (!gruppen.has(name)) gruppen.set(name, { beginn: fensterBeginn(job.createdAt), ids: [] });
    gruppen.get(name).ids.push(job.id);
  }
  let db;
  try {
    db = datenbank();
  } catch (err) {
    warne("statistik-zaehlen-fehlgeschlagen", err);
    ergebnis.gescheitert = offen.length;
    return zaehlLaufAbschliessen(ergebnis);
  }
  for (const [name, gruppe] of gruppen) {
    for (let i = 0; i < gruppe.ids.length; i += AUFTRAEGE_JE_TRANSAKTION) {
      const teil = gruppe.ids.slice(i, i + AUFTRAEGE_JE_TRANSAKTION);
      try {
        const refs = teil.map((id) => db.collection("jobs").doc(id));
        const n = await hoechstens(zaehleTeil(refs, name, gruppe.beginn), ZAEHLEN_WARTEN_MS);
        if (n === ZU_LANGE) {
          /* Die Transaktion laeuft vielleicht noch und zaehlt dann richtig —
             oder sie scheitert am inzwischen geloeschten Auftrag. Doppelt
             zaehlt sie in keinem Fall. */
          warne("statistik-zaehlen-nicht-abgewartet", null, { auftraege: teil.length });
          ergebnis.gescheitert += teil.length;
        } else {
          ergebnis.gezaehlt += n;
        }
      } catch (err) {
        warne("statistik-zaehlen-fehlgeschlagen", err, { auftraege: teil.length });
        ergebnis.gescheitert += teil.length;
      }
    }
  }
  return zaehlLaufAbschliessen(ergebnis);
}

/* Ein Lauf mit gescheitertem Zaehlen ist eine Warnung; ZAEHL_FEHLER_BIS_ALARM
   solche Laeufe in Folge sind ein Ausfall (severity ERROR, Alarm). Ein Lauf
   ohne Fehler setzt zurueck. Lebt in der Instanz, wie im Aufraeumdienst. */
function zaehlLaufAbschliessen(ergebnis) {
  if (ergebnis.gescheitert > 0) {
    zaehlFehlerInFolge += 1;
    if (zaehlFehlerInFolge >= ZAEHL_FEHLER_BIS_ALARM) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          step: "statistik",
          error: "statistik-zaehlen-wiederholt-gescheitert",
          laeufeInFolge: zaehlFehlerInFolge,
          hinweis: "Die dauerhaften Zaehler bekommen seit mehreren Laeufen nichts mehr. Geloescht wird trotzdem.",
        })
      );
    }
  } else {
    zaehlFehlerInFolge = 0;
  }
  return ergebnis;
}

/* ── Sammler fuer oeffentliche Schnittstellen ───────────────────────────── */

/* Vorgemerkte Erhoehungen dieser Instanz: Dokumentname -> { kopf, summe }. */
let vorgemerkt = new Map();
let letzterSchreibversuch = 0;

function vormerken(dokument, kopf, pfad, n = 1) {
  if (!vorgemerkt.has(dokument)) vorgemerkt.set(dokument, { kopf, summe: {} });
  addiere(vorgemerkt.get(dokument).summe, pfad, n);
}

/* Schreibt alles Vorgemerkte: ein Schreibvorgang je Dokument. Was dabei
   scheitert oder nicht abgewartet wird, wird NICHT wieder vorgemerkt — es
   koennte ja doch angekommen sein; lieber eins zu wenig als doppelt. */
async function schreibeVorgemerktes() {
  const jetzt = vorgemerkt;
  vorgemerkt = new Map();
  if (jetzt.size === 0) return;
  const db = datenbank();
  const vorgaenge = [...jetzt.entries()].map(([name, { kopf, summe }]) =>
    db
      .collection(SAMMLUNG)
      .doc(name)
      .set({ ...kopf, ...alsInkremente(summe) }, { merge: true })
  );
  const ergebnis = await hoechstens(Promise.all(vorgaenge), SAMMEL_WARTEN_MS);
  if (ergebnis === ZU_LANGE) warne("statistik-sammler-nicht-abgewartet", null, { dokumente: jetzt.size });
}

/* Merkt vor und schreibt, wenn der letzte Schreibversuch dieser Instanz
   mindestens SAMMEL_ABSTAND_MS zurueckliegt. Wirft nie. */
async function zaehleBestmoeglich(dokument, kopf, pfad, jetzt) {
  try {
    vormerken(dokument, kopf, pfad);
    if (jetzt - letzterSchreibversuch < SAMMEL_ABSTAND_MS) return;
    letzterSchreibversuch = jetzt;
    await schreibeVorgemerktes();
  } catch (err) {
    warne("statistik-sammler-fehlgeschlagen", err);
  }
}

/**
 * Zaehlt eine Abweisung der Annahmestelle im Fenster von `jetzt`. Wirft nie,
 * wartet hoechstens SAMMEL_WARTEN_MS (meist gar nicht: siehe Sammler).
 * @param {string} grund einer aus ABWEISUNGSGRUENDE
 */
async function zaehleAbweisung(grund, jetzt = Date.now()) {
  const feld = ABWEISUNGSGRUENDE.includes(grund) ? grund : "unbekannt";
  await zaehleBestmoeglich(
    fensterId(jetzt),
    { art: "fenster", beginn: fensterBeginn(jetzt) },
    ["abgewiesen", feld],
    jetzt
  );
}

/**
 * Zaehlt eine Fehlermeldung des Browsers im Tag von `jetzt`, nach Phase und
 * Geraetefamilie. Wirft nie, wartet hoechstens SAMMEL_WARTEN_MS.
 */
async function zaehleBrowserFehler({ phase, userAgent, bildschirm }, jetzt = Date.now()) {
  await zaehleBestmoeglich(
    tagId(jetzt),
    { art: "tag", tag: wienerDatum(jetzt) },
    ["browserFehler", phaseFeld(phase), geraetefamilie(userAgent, bildschirm)],
    jetzt
  );
}

/** Nur fuer Tests: Sammler und Fehlerfolge zuruecksetzen. */
function _zuruecksetzen() {
  vorgemerkt = new Map();
  letzterSchreibversuch = 0;
  zaehlFehlerInFolge = 0;
}

module.exports = {
  SAMMLUNG,
  FENSTER_MS,
  KLASSEN,
  PHASEN,
  ABWEISUNGSGRUENDE,
  fensterBeginn,
  fensterId,
  wienerDatum,
  tagId,
  dauerKlasse,
  grundFeld,
  geraetefamilie,
  phaseFeld,
  beitragEinesAuftrags,
  summiereIn,
  zaehleVorDemLoeschen,
  zaehleAbweisung,
  zaehleBrowserFehler,
  _zuruecksetzen,
  _SAMMEL_ABSTAND_MS: SAMMEL_ABSTAND_MS,
};
