"use strict";

/**
 * alters-lesbarkeit.js — Laesst sich aus einer Altersangabe des Modells ein
 * Alter lesen?
 *
 * HERAUSGELOEST AUS minor-safety.js am 17.09.2026: Die Datei war mit der neuen
 * Erkennung auf fast 500 Zeilen gewachsen (Grenze 400, pruefe-kopplung.py).
 * Hier stehen nur reine Textpruefungen — kein Filter, keine Listen. Genutzt
 * von minor-safety.js (Stufe 2), mistral.js (Alterskarte) und
 * mistral-antwort.js (Live-Anzeige). Die Zahl-Lesung selbst steht seit
 * 05.10.2026 in alters-auslese.js; ihre Funktionen werden hier
 * weitergereicht.
 *
 * Die deutschen Woerter in den Suchmustern sind Erkennungsmerkmale, keine
 * Anzeigetexte; der feste Satz fuer die Karte steht in den Sprachdateien.
 */

/* Abkuerzungen und Naeherungswoerter: reine Daten in
   alters-lesbarkeit-woerter.js. Die Zahl-Lesung (Zahlwoerter, Kategorien,
   untere und obere Altersgrenze) steht in alters-auslese.js. */
const {
  ABKUERZUNGEN,
  ABKUERZUNGEN_IMMER,
  ABKUERZUNGEN_MEHRTEILIG,
  ABKUERZUNG_UND_ANDERE,
  NAEHERUNGSWOERTER,
  SEHR_JUNG,
} = require("./alters-lesbarkeit-woerter");
const {
  KLAMMER_AUF,
  KLAMMER_ZU,
  ZIFFERN_IN_KLAMMERN,
  mitZiffern,
  kategorieAlter,
  ohneZiffernKlammern,
  untereAltersgrenze,
  obereAltersgrenze,
} = require("./alters-auslese");

/* ── Nicht lesbares Alter (17.09.2026) ────────────────────────────────────
   Das Formatbeispiel im Prompt zeigt das Alter nur noch als "~‹Zahl› Jahre
   alt (Spanne ‹Zahl›-‹Zahl›)" — eine Beispielzahl zog die Schaetzungen an.
   Schreibt das Modell die Vorlage ab (in welcher Klammer auch immer) oder
   nennt es ein Alter ohne eine einzige Ziffer ("~dreizehn Jahre"), gilt das
   Alter als NICHT LESBAR:
     - Die Alterskarte zeigt dann einen festen Satz statt eines geflickten
       Textes (alterskarteText in mistral.js, Satz aus alterNichtLesbarText).
     - Der Kinderschutz-Filter laesst Stufe 2 greifen (minor-safety.js).
   Zahlwoerter ("etwa dreizehn", "Mitte vierzig", "in his teens") sind eine
   LESBARE Angabe: Sie werden fuer die Pruefung und fuer die Altersauslese in
   Ziffern uebersetzt (Gegenpruefung 17.09.2026). Nur einfache Woerter von
   fuenf bis achtzig, keine zusammengesetzten Zahlen.
   "Keine klaren Bildsignale." oder ein blosses "weiblich" sind KEIN
   unlesbares Alter — dort steht gar kein Altersversuch, und es bleibt bei der
   Regel "ohne Alter nicht filtern".
   Auch Kategoriewoerter ("Teenager", "jugendlich", "Schulkind") sind eine
   Angabe: Sie zaehlen als junges Alter — aber nur, wenn keine Zahl dasteht.
   Geprueft werden hoechstens die ersten PRUEF_MAX Zeichen — so lang darf eine
   Karte hoechstens sein (json-repair.js); die Suchmuster laufen linear. */
/* BLEIBT IM CODE — Grenze gegen lange Modellausgaben, gleich der
   Kartenlaenge, keine Betriebseinstellung. */
const PRUEF_MAX = 800;
/* "Zahl"/"number" in jeder Klammer oder in Anfuehrungszeichen; "Alter"/"age"
   nur in Vorlagen-Klammern — "Deine Tasse sagt „Alter“" ist kein Platzhalter. */
const PLATZHALTER_IN_KLAMMERN = new RegExp(
  `[${KLAMMER_AUF}]\\s*(?:zahl|number)\\s*[${KLAMMER_ZU}]|[‹<\\[{«]\\s*(?:alter|age)\\s*[›>\\]}»]`,
  "i"
);
const PLATZHALTER_NACKT =
  /~\s*(?:zahl|number)\b|\b(?:zahl|number)\s*(?:[-–]|bis|to)\s*(?:zahl|number)\b|\b(?:zahl|number)[\s-]+(?:jahre|j\u00e4hrig|years?|yrs)\b|\b(?:spanne|range|circa|ca\.|etwa|about|aged|zwischen|between)\s+(?:zahl|number)\b/i;
/* Woerter, die einen Altersversuch anzeigen — mit Wortgrenzen, damit
   "spannend", "Jahreszeit" oder "Altersspanne" nicht zaehlen. "-jaehrig" darf
   angehaengt sein ("dreizehnjaehrig", "minderjaehrig"). "underage" und
   "a minor" sagen dasselbe wie "minderjaehrig": unter 18, aber ohne Zahl.
   "minor" zaehlt nur vor einem Satzzeichen oder am Textende — in "minor
   details" ist es kein Alter. Ein Geburtsjahr ("geboren 2012", "geb. 2012",
   "Jg. 2012") ist ebenfalls ein Altersversuch ohne lesbares Alter; "geboren
   fuer die Buehne" nicht. */
const ALTERSWORT =
  /(?<!\p{L})(?:jahre|jahren|years?|yrs|spanne|range|under-?age)(?!\p{L})|(?<!\p{L})minors?(?=\s*(?:[.,;:!?)]|$))|(?<!\p{L})(?:geboren|jahrgang|born)(?!\p{L})[^.!?\d]{0,12}(?:19|20)\d\d(?!\d)|(?<!\p{L})(?:geb|jg|jhg|jahrg)\.\s*(?:19|20)\d\d(?!\d)|j\u00e4hrig/iu;

function pruefText(text) {
  const roh = String(text || "");
  /* Beim Kuerzen kein angeschnittenes Wort am Ende lassen ("achtzehn" darf
     nicht zu "acht" werden). */
  const kurz = roh.length > PRUEF_MAX ? roh.slice(0, PRUEF_MAX).replace(/\p{L}+$/u, "") : roh;
  return mitZiffern(kurz).replace(ZIFFERN_IN_KLAMMERN, "$1");
}

function hatAltersPlatzhalter(text) {
  const s = pruefText(text);
  return PLATZHALTER_IN_KLAMMERN.test(s) || PLATZHALTER_NACKT.test(s);
}

/* Ein Altersversuch ohne lesbare Zahl: Platzhalter, oder Alterswort, aus dem
   die Altersauslese keine Zahl gewinnt. */
function istAlterUnlesbar(text) {
  const s = pruefText(text);
  return hatAltersPlatzhalter(s) || (ALTERSWORT.test(s) && untereAltersgrenze(s) === null);
}

/* Hat der Text ein lesbares Alter? Dieselbe Auslese wie der Filter — "lesbar"
   heisst: Der Filter findet eine Zahl, und kein Platzhalter steht da. */
function hatLesbaresAlter(text) {
  const s = pruefText(text);
  return !hatAltersPlatzhalter(s) && untereAltersgrenze(s) !== null;
}

/* Naeherungswort und kleine Zahl ohne "Jahre": "etwa 13,", "hoechstens 12.",
   "around 12", "~13,". Zaehlt nur, wenn nach der Zahl kein Wort folgt
   (Satzzeichen, Textende, "oder 13", "bis 14") — "etwa 7 Kopflaengen" und
   "rund 10 Freunde" sind kein Alter, "1,80" und "14:30" auch nicht. */
/* BLEIBT IM CODE — "klein" heisst: bis zur Schutzgrenze des Filters
   (SCHUTZ_ALTER in minor-safety.js; alters-platzhalter.test.js haelt beide
   gleich). Darueber ist niemand zu schuetzen. */
const VERSUCH_BIS = 25;
const NAEHERUNG = new RegExp(
  `(?:~\\s*|(?<!\\p{L})(?:${NAEHERUNGSWOERTER.map((w) => w.replace(/\./g, "\\.")).join("|")})\\s+)` +
    `(\\d{1,2})(?![.,:]?\\d)(?=\\s*(?:[.,;:!?)]|$|(?:oder|or|bis|to|[-–])\\s*\\d))`,
  "giu"
);
function hatNaeherungsAlter(s) {
  for (const m of s.matchAll(NAEHERUNG)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= VERSUCH_BIS) return true;
  }
  return SEHR_JUNG.test(s); /* "sehr jung", "very young": ungefaehr, ohne Zahl */
}

/* Steht irgendwo im Text ein Altersversuch? Platzhalter, Alterswort, Kindwort
   oder Kategorie ("ein Maedchen", "Schuelerin"), Naeherungswort mit kleiner
   Zahl, "sehr jung". Fuer ganze Karten: Ob der Versuch LESBAR ist, entscheidet
   allein die Stelle, die als Altersangabe zaehlt (Anker, sonst erster Satz);
   steht dort kein Alter, gilt es als nicht lesbar, und Stufe 2 greift
   (SEC-2026-10-03-02). Getragene Richtung: Das trifft auch Erwachsene ohne
   lesbares Alter, in deren Karte ein Kind vorkommt. */
function hatAltersversuch(text) {
  const s = pruefText(text);
  return hatAltersPlatzhalter(s) || ALTERSWORT.test(s) || kategorieAlter(s) !== null || hatNaeherungsAlter(s);
}

/* ── Erster Satz einer Karte (SEC-2026-10-03-02) ──────────────────────────
   Als Altersangabe einer Karte zaehlt nur ihr erster Satz. Er endet am
   ersten Satzzeichen — aber nicht am Punkt hinter einer Naeherungs-Abkuerzung
   ("ca. 13 Jahre", "approx. 14") und nicht an einem Punkt zwischen Ziffern
   ("12.–14.", "1.80"): Sonst endete der Satz vor dem Alter. Eine Abkuerzung
   zaehlt nur, wenn danach weder ein Grossbuchstabe noch das Textende kommt
   ("Du bist Max. Deine Wangen ..." bleibt ein Satzende); dasselbe gilt fuer
   "u. a." — dort beendet aber nie der innere Punkt den Satz. "sog.", "geb.",
   "Jg." und die mehrteiligen ("z. B.", "d. h.", "i.e.", "e.g.") stehen nie am
   Satzende. Bewusst ohne i-Schalter: Mit ihm traefe die
   Grossbuchstaben-Klasse auch Kleinbuchstaben. */
const GROSS_UND_KLEIN = (a) => [a, a[0].toUpperCase() + a.slice(1)];
const MIT_PUNKTEN = (a) => a.split(" ").join("\\.\\s?");
const UND_ANDERE = ABKUERZUNG_UND_ANDERE.split(" ");
const KEIN_SATZENDE = new RegExp(
  `(?<!\\p{L})(?:${[...ABKUERZUNGEN, MIT_PUNKTEN(ABKUERZUNG_UND_ANDERE)].flatMap(GROSS_UND_KLEIN).join("|")})\\.(?!\\s*(?:\\p{Lu}|$))` +
    `|(?<!\\p{L})(?:${[...ABKUERZUNGEN_IMMER, ...ABKUERZUNGEN_MEHRTEILIG.map(MIT_PUNKTEN)].flatMap(GROSS_UND_KLEIN).join("|")})\\.` +
    `|(?<!\\p{L})(?:${GROSS_UND_KLEIN(UND_ANDERE[0]).join("|")})\\.(?=\\s?${UND_ANDERE[1]}\\.)` +
    `|(?<=\\d)\\.(?=\\d|\\s*[-–—]\\s*\\d)`,
  "gu"
);

/* Auch vor einem Grossbuchstaben endet der Satz nicht an der Abkuerzung, wenn
   das naechste Wort ein Alter bis zur Schutzgrenze traegt ("ca. Volksschulalter",
   "vermutl. Teenager"). Ein hoeheres koennte ein Kindwort davor verdraengen. */
const VOR_ALTERSWORT = new RegExp(
  `(?<!\\p{L})(?:${ABKUERZUNGEN.flatMap(GROSS_UND_KLEIN).join("|")})\\.(?=\\s*((?:(?:Anfang|Mitte|Ende)\\s+)?[\\p{L}\\d]+))`,
  "gu"
);
const OHNE_PUNKT = (t) => t.replace(/\./g, "_");
const JUNG = (wort) => (untereAltersgrenze(wort) ?? VERSUCH_BIS + 1) <= VERSUCH_BIS;

/* [erster Satz, Rest dahinter]. Die Punkte, die kein Satzende sind, werden
   nur fuer die Suche ausgeblendet — gleich lang, damit die Stelle stimmt. */
function satzUndRest(text) {
  const s = String(text || "");
  const such = s.replace(KEIN_SATZENDE, OHNE_PUNKT).replace(VOR_ALTERSWORT, (t, w) => (JUNG(w) ? OHNE_PUNKT(t) : t));
  const m = /[.!?]/.exec(such);
  const ende = m ? m.index + 1 : s.length;
  return [s.slice(0, ende).trim(), s.slice(ende).trim()];
}
const ersterSatz = (text) => satzUndRest(text)[0];
const nachErstemSatz = (text) => satzUndRest(text)[1];

/* Der Altersanker als Text: Liefert das Modell statt eines Textes eine Zahl,
   eine Liste oder ein Objekt, wird der Inhalt gelesen statt verworfen. */
function ankerAlsText(wert, tiefe = 0) {
  if (typeof wert === "string") return wert;
  if (typeof wert === "number") return Number.isFinite(wert) ? String(wert) : "";
  if (!wert || typeof wert !== "object" || tiefe > 2) return "";
  const name = (k) => (Array.isArray(wert) ? "" : k);
  const teile = Object.entries(wert).map(([k, w]) => `${name(k)} ${ankerAlsText(w, tiefe + 1)}`.trim());
  return teile.filter(Boolean).join(", ").slice(0, 200);
}
/* Mitgelesen wird er nur, wenn er die Altersauslese der Karten nicht anhebt. */
const ankerZusatz = (wert, saetze, z = ankerAlsText(wert)) =>
  (untereAltersgrenze(z) ?? 0) > (untereAltersgrenze(saetze) ?? 999) ? "" : z;

const GESCHLECHT =
  /^(?:du bist |you are )?(?:geschlecht|gender)?[:\s]*(männlich|weiblich|divers|nicht eindeutig erkennbar|male|female|not clearly identifiable)(?!\p{L})/iu;
const GESCHLECHT_UNKLAR = /nicht eindeutig|not clearly/i;

/* Fester Satz fuer die Alterskarte, wenn das Alter nicht lesbar ist. Die
   Saetze stehen in der Sprachdatei (prompts.js: alterNichtLesbar,
   geschlechtSatz, geschlechtUnklarSatz). Das Geschlecht wird aus der ersten
   Quelle uebernommen, die es am Anfang klar nennt (Anker, sonst Karte). */
function alterNichtLesbarText(quellen, texte) {
  let g = "";
  for (const q of [].concat(quellen)) {
    const m = GESCHLECHT.exec(String(q || "").trim());
    if (m) {
      g = m[1].toLowerCase();
      break;
    }
  }
  let vorn = "";
  if (g && GESCHLECHT_UNKLAR.test(g)) vorn = texte.geschlechtUnklarSatz || "";
  else if (g && texte.geschlechtSatz) vorn = texte.geschlechtSatz.replace("{geschlecht}", g);
  return vorn ? `${vorn} ${texte.alterNichtLesbar}` : texte.alterNichtLesbar;
}

module.exports = {
  untereAltersgrenze,
  obereAltersgrenze,
  hatAltersPlatzhalter,
  istAlterUnlesbar,
  hatLesbaresAlter,
  hatAltersversuch,
  ersterSatz,
  nachErstemSatz,
  ankerAlsText,
  ankerZusatz,
  alterNichtLesbarText,
  ohneZiffernKlammern,
  /* Für Tests */
  _VERSUCH_BIS: VERSUCH_BIS,
};
