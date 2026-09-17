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
   angehaengt sein ("dreizehnjaehrig"). */
const ALTERSWORT = /(?<!\p{L})(?:jahre|jahren|years?|yrs|spanne|range)(?!\p{L})|j\u00e4hrig/iu;

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
   Alter. */
const KATEGORIEN = [
  [/(?<!\p{L})(?:teen\p{L}*|jugendlich\p{L}*|adolescent\p{L}*)/iu, 13],
  [/(?<!\p{L})pubert\p{L}*/iu, 12],
  [/(?<!\p{L})(?:schoolgirl|schoolboy)(?!\p{L})/iu, 10],
  [/(?<!\p{L})(?:schul|klein|vorschul|grundschul)kind\p{L}*|(?<!\p{L})grundschulalter(?!\p{L})/iu, 8],
  [/(?<!\p{L})Kind(?:er)?(?!\p{L})|(?<!\p{L})(?:child\p{L}*|kids?)(?!\p{L})/u, 8],
];

function kategorieAlter(text) {
  const werte = KATEGORIEN.filter(([re]) => re.test(String(text || ""))).map(([, w]) => w);
  return werte.length ? Math.min(...werte) : null;
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

module.exports = {
  untereAltersgrenze,
  hatAltersPlatzhalter,
  istAlterUnlesbar,
  hatLesbaresAlter,
  alterNichtLesbarText,
  ohneZiffernKlammern,
};
