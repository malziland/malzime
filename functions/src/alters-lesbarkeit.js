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
  VERSUCHSWOERTER,
  ALTERSWORT_KURZ,
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

/* Jede ganze Zahl von 1 bis zur Schutzgrenze ist ein Altersversuch ("Alter:
   13.", "Du bist 13.", "3. Klasse", "Trikot mit der 7") — auch ohne
   Alterswort und ohne Naeherungswort. Zahlwoerter zaehlen wie Ziffern
   ("Du bist dreizehn"; "zwei" bis "vier" stehen bei den Versuchswoertern, sie
   werden nicht als Alter gelesen). Ausgenommen ist nur, was erkennbar keine
   Angabe zu einer Person ist: Dezimalzahl ("1,80"), Uhrzeit ("14:30", "9
   Uhr"), Prozent, Teil einer groesseren Zahl (Jahreszahl, "130 cm"). Eine
   einzelne Stelle hinter dem Komma faellt wie bei der Altersauslese weg
   ("12,5" zaehlt als 12).
   Die Regel wirkt nur, wenn weder der Anker noch ein erster Satz ein
   lesbares Alter hat: dann lieber Schutz als ein uebersehenes Kinderalter. */
/* BLEIBT IM CODE — "klein" heisst: bis zur Schutzgrenze des Filters
   (SCHUTZ_ALTER in minor-safety.js; alters-platzhalter.test.js haelt beide
   gleich). Darueber ist niemand zu schuetzen. */
const VERSUCH_BIS = 25;
const KLEINE_ZAHL =
  /(?<!\d)(?<!\d[.,:])(\d{1,2})(?!\d|[.,:]\d|\s*(?:%|prozent|percent|(?:uhr|o'?clock|a\.m\.|p\.m\.|pm)(?!\p{L})))/giu;
function hatKleineZahl(s) {
  for (const m of s.matchAll(KLEINE_ZAHL)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= VERSUCH_BIS) return true;
  }
  return false;
}

/* Steht irgendwo im Text ein Altersversuch? Platzhalter, Alterswort oder
   -kuerzel ("Jahre", "13 J.", "Alter:"), Kindwort oder Kategorie ("ein
   Maedchen", "Schuelerin"), jede kleine Zahl, "jung", "noch im Wachstum",
   "Milchzaehne".
   Fuer den Anker und fuer ganze Karten: Ob der Versuch LESBAR ist,
   entscheidet allein die Stelle, die als Altersangabe zaehlt (Anker, sonst
   erster Satz); steht dort kein Alter, gilt es als nicht lesbar, und Stufe 2
   greift (SEC-2026-10-03-02). Getragene Richtung: Das trifft auch Erwachsene
   ohne lesbares Alter, in deren Karte ein Kind oder eine kleine Zahl
   vorkommt ("Trikot mit der 7"). */
function hatAltersversuch(text) {
  const s = pruefText(text);
  if (hatAltersPlatzhalter(s) || ALTERSWORT.test(s) || ALTERSWORT_KURZ.test(s) || kategorieAlter(s) !== null)
    return true;
  return hatKleineZahl(s) || VERSUCHSWOERTER.some((re) => re.test(s));
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
   Satzende. "J." fuer Jahre zaehlt wie eine Naeherungs-Abkuerzung, aber nur
   direkt hinter einer Zahl ("13 J. alt") — als Anfangsbuchstabe eines Namens
   beendet es den Satz. Bewusst ohne i-Schalter: Mit ihm traefe die
   Grossbuchstaben-Klasse auch Kleinbuchstaben. */
const GROSS_UND_KLEIN = (a) => [a, a[0].toUpperCase() + a.slice(1)];
const MIT_PUNKTEN = (a) => a.split(" ").join("\\.\\s?");
const UND_ANDERE = ABKUERZUNG_UND_ANDERE.split(" ");
const KEIN_SATZENDE = new RegExp(
  `(?<!\\p{L})(?:${[...ABKUERZUNGEN, MIT_PUNKTEN(ABKUERZUNG_UND_ANDERE)].flatMap(GROSS_UND_KLEIN).join("|")})\\.(?!\\s*(?:\\p{Lu}|$))` +
    `|(?<!\\p{L})(?:${[...ABKUERZUNGEN_IMMER, ...ABKUERZUNGEN_MEHRTEILIG.map(MIT_PUNKTEN)].flatMap(GROSS_UND_KLEIN).join("|")})\\.` +
    `|(?<!\\p{L})(?:${GROSS_UND_KLEIN(UND_ANDERE[0]).join("|")})\\.(?=\\s?${UND_ANDERE[1]}\\.)` +
    `|(?<=\\d)\\.(?=\\d|\\s*[-–—]\\s*\\d)` +
    `|(?<=\\d\\s?)[Jj]\\.(?!\\s*(?:\\p{Lu}|$))`,
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

/* Ein Geschlechtskuerzel ("w.", "m.", "f.") beendet den Satz nicht, wenn
   direkt danach ein junges Alter folgt ("W., ca. 13 J. alt"). Nur bis zur
   Schutzgrenze: Der laengere Satz kann den Schutz dann nur ausloesen, nie
   aufheben — eine hoehere Zahl wuerde ein Kindwort davor verdraengen ("ein
   Maedchen, w. 40 kg"). */
const NAEHER = NAEHERUNGSWOERTER.map((w) => w.replace(/\./g, "\\.")).join("|");
const KUERZEL_VOR_ALTER = new RegExp(
  `(?<!\\p{L})[WwMmFf]\\.(?=\\s*,?\\s*(?:(?:${NAEHER})\\s*|~\\s*)?(\\d{1,2})(?!\\d))`,
  "gu"
);

/* [erster Satz, Rest dahinter]. Die Punkte, die kein Satzende sind, werden
   nur fuer die Suche ausgeblendet — gleich lang, damit die Stelle stimmt. */
function satzUndRest(text) {
  const s = String(text || "");
  const such = s
    .replace(KUERZEL_VOR_ALTER, (t, n) => (Number(n) <= VERSUCH_BIS ? OHNE_PUNKT(t) : t))
    .replace(KEIN_SATZENDE, OHNE_PUNKT)
    .replace(VOR_ALTERSWORT, (t, w) => (JUNG(w) ? OHNE_PUNKT(t) : t));
  const m = /[.!?]/.exec(such);
  const ende = m ? m.index + 1 : s.length;
  return [s.slice(0, ende).trim(), s.slice(ende).trim()];
}
const ersterSatz = (text) => satzUndRest(text)[0];
const nachErstemSatz = (text) => satzUndRest(text)[1];

/* Was in der Anzeige hinter dem Alterssatz einer Karte steht, wenn der Anker
   ihn ersetzt. Der Alterssatz ist der erste Satz. Endet er an einer
   Abkuerzung, die die Liste nicht kennt ("etw. 13"), steht das Alter erst im
   naechsten Stueck. Was der Anker am Ende schon sagt, wird deshalb nicht
   wiederholt. Nur fuer die Anzeige: Gelesen wird weiter der erste Satz. */
const KERN = (t) => t.replace(/[.!?\s]+$/u, "").toLowerCase();
function nachAlterssatz(text, anker = "") {
  const rest = nachErstemSatz(text);
  const [stueck, danach] = satzUndRest(rest);
  const kern = KERN(stueck);
  return kern && KERN(String(anker)).endsWith(kern) ? danach : rest;
}

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
  nachAlterssatz,
  ankerAlsText,
  ankerZusatz,
  alterNichtLesbarText,
  ohneZiffernKlammern,
  /* Für Tests */
  _VERSUCH_BIS: VERSUCH_BIS,
};
