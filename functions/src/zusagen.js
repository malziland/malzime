"use strict";

/**
 * zusagen.js — gemeinsame Logik für datierte oeffentliche Zusagen.
 *
 * Die Datenschutzerklaerung nennt ein Pruefdatum fuer die EU-/Zero-Data-
 * Retention-Zusage und verspricht oeffentlich eine Nachpruefung „spaetestens
 * halbjaehrlich". Zwei Stellen wachen darueber — und beide benutzen bewusst
 * DIESE Datei, damit die Frist nur an einer Stelle definiert ist:
 *
 *  1. `__tests__/zusagen-frische.test.js` — harte Bremse: die CI wird rot,
 *     sobald das Datum im Quelltext der Seite zu alt ist.
 *  2. `handle-erinnerung.js` — freundliche Vorwarnung: eine Woche vorher
 *     kommt ein ntfy-Push mit der Handlungsanleitung.
 *
 * Die Seite selbst ist die einzige Quelle des Datums (das ist es, was die
 * Oeffentlichkeit liest) — es wird nirgends zusaetzlich gespeichert.
 */

/* Oeffentliches Versprechen: „spaetestens halbjaehrlich". */
const FRIST_TAGE = 183;

/* Wie lange vorher der Push kommt. */
const VORWARNUNG_TAGE = 7;

const MONATE = {
  Januar: 0,
  Februar: 1,
  März: 2,
  April: 3,
  Mai: 4,
  Juni: 5,
  Juli: 6,
  August: 7,
  September: 8,
  Oktober: 9,
  November: 10,
  Dezember: 11,
};

/* „11.&nbsp;August&nbsp;2026" oder „11. August 2026" nach „zuletzt am". */
const PRUEFDATUM_MUSTER = /zuletzt am (\d{1,2})\.(?:&nbsp;|\s)([A-Za-zÄÖÜäöü]+)(?:&nbsp;|\s)(\d{4})/;

/**
 * Liest das ZDR-Pruefdatum aus dem HTML der Datenschutzerklaerung.
 * Gibt `null` zurueck, wenn es fehlt oder die Formulierung geaendert wurde —
 * beide Waechter behandeln das als Fehlerfall, nicht als „alles in Ordnung".
 */
function leseZdrPruefdatum(html) {
  const treffer = String(html || "").match(PRUEFDATUM_MUSTER);
  if (!treffer) return null;
  const [, tag, monat, jahr] = treffer;
  const monatIndex = MONATE[monat];
  if (monatIndex === undefined) return null;
  const datum = new Date(Number(jahr), monatIndex, Number(tag));
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/**
 * Bewertet ein Pruefdatum gegen die Frist.
 * `jetzt` ist injizierbar, damit Tests nicht von der echten Uhr abhaengen.
 */
function bewerteFrist(datum, jetzt = Date.now()) {
  const tageAlt = Math.floor((jetzt - datum.getTime()) / 86400000);
  const tageBisFrist = FRIST_TAGE - tageAlt;
  return {
    tageAlt,
    tageBisFrist,
    /* faellig = Vorwarnzeit erreicht ODER schon ueberschritten */
    faellig: tageBisFrist <= VORWARNUNG_TAGE,
    ueberfaellig: tageBisFrist < 0,
  };
}

/** Formatiert ein Datum als „11. August 2026" fuer Meldungstexte. */
function formatiereDatum(datum) {
  const monat = Object.keys(MONATE).find((m) => MONATE[m] === datum.getMonth());
  return `${datum.getDate()}. ${monat} ${datum.getFullYear()}`;
}

module.exports = {
  FRIST_TAGE,
  VORWARNUNG_TAGE,
  PRUEFDATUM_MUSTER,
  leseZdrPruefdatum,
  bewerteFrist,
  formatiereDatum,
};
