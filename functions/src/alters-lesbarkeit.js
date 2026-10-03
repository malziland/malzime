"use strict";

/**
 * alters-lesbarkeit.js — Laesst sich aus einer Altersangabe des Modells ein
 * Alter lesen?
 *
 * HERAUSGELOEST AUS minor-safety.js am 17.09.2026: Die Datei war mit der neuen
 * Erkennung auf fast 500 Zeilen gewachsen (Grenze 400, pruefe-kopplung.py).
 * Hier stehen nur reine Textpruefungen — kein Filter, keine Listen. Genutzt
 * von minor-safety.js (Stufe 2), mistral.js (Alterskarte) und
 * mistral-antwort.js (Live-Anzeige).
 *
 * Die deutschen Woerter in den Suchmustern sind Erkennungsmerkmale, keine
 * Anzeigetexte; der feste Satz fuer die Karte steht in den Sprachdateien.
 */

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
const KLAMMER_AUF = "‹<\\[{«(„“\"'‚‘⟨〈";
const KLAMMER_ZU = "›>\\]}»)“”\"'‘’⟩〉";
const ZIFFERN_IN_KLAMMERN = new RegExp(`[${KLAMMER_AUF}]\\s*(\\d{1,3})\\s*[${KLAMMER_ZU}]`, "g");
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
   details" ist es kein Alter. Ein Geburtsjahr ("geboren 2012") ist ebenfalls
   ein Altersversuch ohne lesbares Alter; "geboren fuer die Buehne" nicht. */
const ALTERSWORT =
  /(?<!\p{L})(?:jahre|jahren|years?|yrs|spanne|range|under-?age)(?!\p{L})|(?<!\p{L})minors?(?=\s*(?:[.,;:!?)]|$))|(?<!\p{L})(?:geboren|jahrgang|born)(?!\p{L})[^.!?\d]{0,12}(?:19|20)\d\d(?!\d)|j\u00e4hrig/iu;

const ZAHLWOERTER = {
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  dreißig: 30,
  vierzig: 40,
  fünfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  twenties: 20,
  thirties: 30,
  forties: 40,
  fifties: 50,
  sixties: 60,
  seventies: 70,
};
/* Wortgrenzen ueber Buchstaben (auch Umlaute): "acht" trifft nicht in
   "achtzehn", "zehn" nicht in "dreizehn", "ten" nicht in "often". */
/* Ein Zahlwort darf ein "-jaehrig" tragen ("dreizehnjaehrig"). */
const WORTENDE = "(?=-?j\\u00e4hrig|(?!\\p{L}))";
const ZAHLWORT = new RegExp(`(?<!\\p{L})(${Object.keys(ZAHLWOERTER).join("|")})${WORTENDE}`, "giu");

/* Zusammengesetzte Zahlen: "fuenfundzwanzig", "twenty-five". */
const EINER = { ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const ZEHNER_DE = { zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80 };
const ZEHNER_EN = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80 };
const ZUSAMMEN_DE = new RegExp(
  `(?<!\\p{L})(${Object.keys(EINER).join("|")})und(${Object.keys(ZEHNER_DE).join("|")})${WORTENDE}`,
  "giu"
);
const ZUSAMMEN_EN = new RegExp(
  `(?<!\\p{L})(${Object.keys(ZEHNER_EN).join("|")})[- ](${Object.keys(ONES).join("|")})(?!\\p{L})`,
  "giu"
);

function mitZiffern(text) {
  return String(text || "")
    .replace(ZUSAMMEN_DE, (_w, e, z) => String(EINER[e.toLowerCase()] + ZEHNER_DE[z.toLowerCase()]))
    .replace(ZUSAMMEN_EN, (_w, z, e) => String(ZEHNER_EN[z.toLowerCase()] + ONES[e.toLowerCase()]))
    .replace(ZAHLWORT, (w) => String(ZAHLWOERTER[w.toLowerCase()]));
}

/* Kategorien ("Teenager", "jugendlich", "Schulkind") — zaehlen NUR, wenn
   keine Zahl dasteht: "~35 Jahre, jugendlich wirkend" ist 35, nicht 13.
   "Kind" nur gross geschrieben — das englische "kind" (freundlich) ist kein
   Alter. Seit SEC-2026-10-03-02 auch Volksschul..., Schueler..., Baby und
   die englischen Entsprechungen. */
const KATEGORIEN = [
  [/(?<!\p{L})(?:teen\p{L}*|jugendlich\p{L}*|adolescent\p{L}*)/iu, 13],
  [/(?<!\p{L})pubert\p{L}*/iu, 12],
  [/(?<!\p{L})(?:school(?:girl|boy|child|kid)\p{L}*|pupil|pre-?teen\p{L}*|tween\p{L}*)(?!\p{L})|sch(?:ü|ue)ler/iu, 10],
  [/(?<!\p{L})(?:schul|klein|vorschul)kind\p{L}*|(?:grund|volks)sch(?:u|ü|ue)l\p{L}*/iu, 8],
  [/(?<!\p{L})(?:elementary|primary|grade)[ -]school/iu, 8],
  [/(?<!\p{L})Kind(?:er)?(?!\p{L})|(?<!\p{L})(?:child\p{L}*|kids?)(?!\p{L})/u, 8],
  [/(?<!\p{L})toddlers?(?!\p{L})/iu, 2],
  [/(?<!\p{L})(?:bab(?:y|ys|ies)|infants?)(?!\p{L})|s(?:ä|ae)ugling/iu, 1],
];
/* Maedchen, Bub, Junge, girl, boy: ein Kind, aber ohne Altersstufe — zaehlt
   deshalb nur, wenn keine Kategorie oben greift ("teenage girl" bleibt 13).
   "Junge" nur als Hauptwort: gross geschrieben, nach einem Wort oder Komma
   und nicht vor einem Hauptwort — "Junge Frau" ist kein Kind. */
const KINDWOERTER = [
  /m(?:ä|ae)dchen|m(?:ä|ae)dels?(?!\p{L})|(?<!\p{L})(?:girls?|boys?)(?!\p{L})/iu,
  /(?<!\p{L})(?:Schulb|B)ub(?:en)?(?!\p{L})|(?<=[\p{L},:]\s)(?:Jung(?:e|en|s)|Schuljungen?)(?!\p{L})(?!\s+\p{Lu})/u,
];

function kategorieAlter(text) {
  const s = String(text || "");
  const werte = KATEGORIEN.filter(([re]) => re.test(s)).map(([, w]) => w);
  if (werte.length) return Math.min(...werte);
  return KINDWOERTER.some((re) => re.test(s)) ? 8 : null;
}

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

/* Steht irgendwo im Text ein Altersversuch — Platzhalter oder Alterswort?
   Fuer ganze Karten gedacht: Ob der Versuch LESBAR ist, entscheidet allein
   die Stelle, die als Altersangabe zaehlt (Anker, sonst erster Satz). Eine
   Zahl im Beleg-Satz macht ihn nicht lesbar (SEC-2026-10-03-02). */
function hatAltersversuch(text) {
  const s = pruefText(text);
  return hatAltersPlatzhalter(s) || ALTERSWORT.test(s);
}

/* ── Erster Satz einer Karte (SEC-2026-10-03-02) ──────────────────────────
   Als Altersangabe einer Karte zaehlt nur ihr erster Satz. Er endet am
   ersten Satzzeichen — aber nicht am Punkt hinter einer Naeherungs-Abkuerzung
   ("ca. 13 Jahre", "approx. 14") und nicht an einem Punkt zwischen Ziffern
   ("12.–14.", "1.80"): Sonst endete der Satz vor dem Alter. Eine Abkuerzung
   zaehlt nur, wenn danach weder ein Grossbuchstabe noch das Textende kommt
   ("Du bist Max. Deine Wangen ..." bleibt ein Satzende). Bewusst ohne
   i-Schalter: Mit ihm traefe die Grossbuchstaben-Klasse auch Kleinbuchstaben. */
const ABKUERZUNGEN = "ca cca ungef ugf approx appr zw rd mind max min evtl vermutl wahrsch est abt bzw".split(" ");
const KEIN_SATZENDE = new RegExp(
  `(?<!\\p{L})(?:${ABKUERZUNGEN.flatMap((a) => [a, a[0].toUpperCase() + a.slice(1)]).join("|")})\\.(?!\\s*(?:\\p{Lu}|$))` +
    `|(?<=\\d)\\.(?=\\d|\\s*[-–—]\\s*\\d)`,
  "gu"
);

/* [erster Satz, Rest dahinter]. Die Punkte, die kein Satzende sind, werden
   nur fuer die Suche ausgeblendet — gleich lang, damit die Stelle stimmt. */
function satzUndRest(text) {
  const s = String(text || "");
  const m = /[.!?]/.exec(s.replace(KEIN_SATZENDE, (t) => `${t.slice(0, -1)}_`));
  const ende = m ? m.index + 1 : s.length;
  return [s.slice(0, ende).trim(), s.slice(ende).trim()];
}
const ersterSatz = (text) => satzUndRest(text)[0];
const nachErstemSatz = (text) => satzUndRest(text)[1];

/* Fuer die Anzeige: Ziffern in Klammern auspacken ("~‹14›" → "~14"). */
function ohneZiffernKlammern(text) {
  return String(text || "").replace(ZIFFERN_IN_KLAMMERN, "$1");
}

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

/* Die UNTERE Altersgrenze aus dem hard-facts-Text lesen — also das jüngste
   Alter, das die Angabe des Modells noch zulässt.

   Beispiele (alle real so vorgekommen):
     "Du bist weiblich, ~14 Jahre alt (Spanne 12-16)."  -> 12
     "Männlich, ~38 — die Krähenfüße verraten dich."     -> 38
     "Du bist männlich, etwa 38. Spanne 35-42."          -> 35
     "weiblich, 16 bis 22"                               -> 16

   Bewusst das MINIMUM aller plausiblen Alterswerte im Text: Streut eine
   Fremdzahl herein, zieht sie das Ergebnis nach unten und damit in Richtung
   MEHR Schutz. Der Fehler geht so immer auf die sichere Seite. Nach oben kann
   ihn keine Zahl verschieben — das wäre die gefährliche Richtung. */
function untereAltersgrenze(text) {
  const s = mitZiffern(text).toLowerCase();
  const plausibel = (n) => Number.isFinite(n) && n >= 1 && n <= 100;
  const kandidaten = [];

  /* Spannen zuerst — "12-16", "12–16", "12 bis 16", "12 to 16". Die
     Untergrenze zählt. */
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s*(?:[-–—]|bis|to)\s*(\d{1,2})(?!\d)/g)) {
    const von = Number(m[1]);
    const nach = Number(m[2]);
    if (plausibel(von) && plausibel(nach) && nach >= von) kandidaten.push(von);
  }

  /* Dazu jede ein- oder zweistellige Zahl — deckt Punktwerte wie "~14",
     "40 Jahre" und seit 17.09.2026 auch "13jährig" oder "13yo" ab. Bei einer
     Spanne findet das ohnehin dieselbe Untergrenze noch einmal. */
  for (const roh of s.match(/(?<!\d)\d{1,2}(?!\d)/g) || []) {
    const n = Number(roh);
    if (plausibel(n)) kandidaten.push(n);
  }

  if (kandidaten.length) return Math.min(...kandidaten);
  return kategorieAlter(text);
}

/* Die OBERE Altersgrenze — das obere Ende der geschaetzten Spanne (seit
   25.09.2026).

     "Du bist weiblich, ~14 Jahre alt (Spanne 12-16)."  -> 16
     "Du bist weiblich, ~14 Jahre alt (± 2)."            -> 16
     "Männlich, ~38 — die Krähenfüße verraten dich."     -> 38
     "Männlich, Ende zwanzig."                           -> null

   NUR FUER DIE AUSWERTUNG, nie fuer eine Schutzentscheidung: Stufe 2 haengt
   an Untergrenze und lesbarem Alter (minor-safety.js), nie an diesem Wert.
   Grund fuer das Feld: Geloggt war bisher nur die Untergrenze. Ob eine
   Schaetzung "8–13" ein 12-jaehriges Kind verfehlt oder trifft, liess sich
   so nicht sagen.

   ANDERS ALS DIE UNTERGRENZE, und zwar mit Absicht: Dort zieht jede
   Fremdzahl ("1,60 m", "14:30") das Ergebnis nach unten, also Richtung mehr
   Schutz. Hier wuerde sie die Spanne kuenstlich breit machen — genau die
   Frage, fuer die das Feld da ist ("schliesst die Spanne das Alter ein?"),
   faende dann zu oft ein Ja. Deshalb in dieser Reihenfolge:
     1. erkannte Spanne ("12-16", "12 bis 16", "zwölf- bis vierzehnjährig",
        "zwischen 12 und 14") oder Plus-Minus-Angabe ("~14 (± 2)") -> ihr
        oberes Ende;
     2. sonst eine Zahl mit Altersbezug ("~14", "etwa 14", "14 Jahre",
        "14-jährig") -> dieser Punktwert;
     3. sonst eine Jahrzehnt-Angabe ("Ende zwanzig", "in his twenties",
        "Mitte 30") -> null, das obere Ende ist offen;
     4. sonst die erste Zahl im Text.
   Kategoriewoerter ("Teenager") nennen kein oberes Ende -> null. Zahlen
   gelten von 1 bis 99. Ist der Anker nicht lesbar, liest der Aufrufer die
   ersten Saetze beider Karten zusammen; dann ist das Ergebnis das obere Ende
   der weiteren Spanne. */
/* Was nach dem zweiten Wert einer Spanne NICHT stehen darf: eine Einheit oder
   ein Zaehlwort, das nie ein Alter ist (Uhrzeit, Gewicht, Laenge, Prozent,
   Grad, Geld, Geschwister, Freunde ...). Dann ist das Paar keine
   Altersspanne und zaehlt nicht (27.09.2026: "zwischen 1 und 3 Uhr" ergab
   sonst 3). Bewusst eine Sperrliste und keine Liste erlaubter Woerter: Die
   KI haengt an echte Spannen allerlei an ("y", "y/o", "geschätzt",
   "roughly", "ca.", "ish"), und jede fehlende Form wuerde das obere Ende
   still auf den Punktwert fallen lassen. Jedes Wort der Liste zaehlt nur
   als ganzes Wort ("freundlich", "gradually" lassen die Spanne stehen).
   Ausnahme: Geschlechtskuerzel wie "m/w" oder "m/f" sind keine Einheit,
   "km/h" und "kg/m²" schon. */
const PAAR_ENDE = String.raw`(?!\s*-?\s*(?![mwfd]\/[mwfd](?!\p{L}))(?:(?:uhr|h|pm|kg|kilos?|kilogramm|g|gramm|pfund|lbs?|cm|mm|m|meter|metern|km|zoll|inch|inches|prozent|percent|grad|euro|euros|dollar|dollars|mal|times|x|stunden|std|hours?|minuten|minutes?|geschwistern?|kindern?|kids|children|brüdern?|schwestern|brothers|sisters|freunde|freunden|freundinnen|friends|siblings|personen|people|leute|stück)(?!\p{L})|[%°€$]))`;
const SPANNE_OBEN = new RegExp(
  String.raw`(?<!\d)(\d{1,2})\s*(?:[-–—]\s*)?(?:[-–—]|bis|to)\s*(\d{1,2})(?!\d)` + PAAR_ENDE,
  "gu"
);
/* "zwischen 12 und 14" / "between 12 and 14": ohne das Wort davor waere
   "und" zu weit gefasst ("12 und 3 Geschwister"). */
const ZWISCHEN_OBEN = new RegExp(
  String.raw`(?:zwischen|between)\s+(\d{1,2})\s*(?:jahren?\s*)?(?:und|and)\s*(\d{1,2})(?!\d)` + PAAR_ENDE,
  "gu"
);
const PLUS_MINUS = /(?<!\d)(\d{1,2})[^\d]{0,20}?(?:±|\+\/-|\+-)\s*(\d{1,2})(?!\d)/g;
const ALTERSZAHL =
  /(?:~|\b(?:etwa|circa|ca\.|ungefähr|about|around|approximately|aged))\s*(\d{1,2})(?!\d)|(?<!\d)(\d{1,2})\s*(?:-?\s*jährig|jahre|years?|yrs|yo\b)/;
const JAHRZEHNT_OFFEN =
  /(?<!\p{L})(?:anfang|mitte|ende|early|mid|late)[\s-]+(?:zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|[2-8]0)(?!\d|\p{L})|(?<!\p{L})\p{L}*(?:zigern|ßigern)(?!\p{L})|(?<!\p{L})(?:twenties|thirties|forties|fifties|sixties|seventies)(?!\p{L})|(?<!\d)[2-8]0(?:er|s)(?!\p{L})/iu;

function obereAltersgrenze(text) {
  const roh = String(text || "").toLowerCase();
  const s = mitZiffern(ohneZiffernKlammern(text)).toLowerCase();
  const enden = [];
  for (const m of [...s.matchAll(SPANNE_OBEN), ...s.matchAll(ZWISCHEN_OBEN)]) {
    const von = Number(m[1]);
    const bis = Number(m[2]);
    if (von >= 1 && bis >= von) enden.push(bis);
  }
  for (const m of s.matchAll(PLUS_MINUS)) {
    const mitte = Number(m[1]);
    if (mitte >= 1) enden.push(mitte + Number(m[2]));
  }
  if (enden.length) return Math.max(...enden);
  const punkt = ALTERSZAHL.exec(s);
  if (punkt) {
    const n = Number(punkt[1] || punkt[2]);
    return n >= 1 ? n : null;
  }
  if (JAHRZEHNT_OFFEN.test(roh)) return null;
  const erste = s.match(/(?<!\d)(\d{1,2})(?!\d)/);
  const n = erste ? Number(erste[1]) : 0;
  return n >= 1 ? n : null;
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
  alterNichtLesbarText,
  ohneZiffernKlammern,
};
