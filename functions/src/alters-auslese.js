"use strict";

/**
 * alters-auslese.js — Welches Alter steht in einer Altersangabe des Modells?
 *
 * HERAUSGELOEST AUS alters-lesbarkeit.js am 05.10.2026 (Grenze 400 Zeilen,
 * pruefe-kopplung.py), ohne Aenderung am Verhalten. Hier steht die
 * Zahl-Lesung: Zahlwoerter in Ziffern, Kategoriewoerter, die untere
 * Altersgrenze (fuer den Kinderschutz-Filter) und die obere (nur fuer die
 * Auswertung). Ob ein Altersversuch LESBAR ist, entscheidet
 * alters-lesbarkeit.js; die Woerter stehen in alters-lesbarkeit-woerter.js.
 *
 * Die deutschen Woerter in den Suchmustern sind Erkennungsmerkmale, keine
 * Anzeigetexte.
 */

const {
  ZAHLWOERTER,
  EINER,
  ONES,
  ZEHNER_DE,
  ZEHNER_EN,
  KATEGORIEN,
  KINDWOERTER,
} = require("./alters-lesbarkeit-woerter");

/* Klammern, in die das Modell eine Zahl oder einen Platzhalter setzt. */
const KLAMMER_AUF = "‹<\\[{«(„“\"'‚‘⟨〈";
const KLAMMER_ZU = "›>\\]}»)“”\"'‘’⟩〉";
const ZIFFERN_IN_KLAMMERN = new RegExp(`[${KLAMMER_AUF}]\\s*(\\d{1,3})\\s*[${KLAMMER_ZU}]`, "g");

/* Wortgrenzen ueber Buchstaben (auch Umlaute): "acht" trifft nicht in
   "achtzehn", "zehn" nicht in "dreizehn", "ten" nicht in "often". */
/* Ein Zahlwort darf ein "-jaehrig" oder "einhalb" tragen ("dreizehnjaehrig",
   "dreizehneinhalb"). */
const WORTENDE = "(?=-?j\\u00e4hrig|einhalb(?!\\p{L})|(?!\\p{L}))";
const ZAHLWORT = new RegExp(`(?<!\\p{L})(${Object.keys(ZAHLWOERTER).join("|")})${WORTENDE}`, "giu");

/* Zusammengesetzte Zahlen: "fuenfundzwanzig", "twenty-five". */
const ZUSAMMEN_DE = new RegExp(
  `(?<!\\p{L})(${Object.keys(EINER).join("|")})und(${Object.keys(ZEHNER_DE).join("|")})${WORTENDE}`,
  "giu"
);
const ZUSAMMEN_EN = new RegExp(
  `(?<!\\p{L})(${Object.keys(ZEHNER_EN).join("|")})[- ](${Object.keys(ONES).join("|")})(?!\\p{L})`,
  "giu"
);

/* Die Zwanziger als Mehrzahl oder als Person: "in den Zwanzigern",
   "Zwanzigerin", "Mittzwanziger" → 20, wie "Mitte zwanzig" und "in her
   twenties". Die nackte Form ("ein Zwanziger") ist ein Geldschein und zaehlt
   nicht.
   NUR die Zwanziger: 20 liegt unter der Schutzgrenze, die Form kann den
   Schutz also ausloesen, nie aufheben. Ein hoeheres Jahrzehnt meint oft die
   Zeit und nicht das Alter ("gekleidet wie in den Achtzigern") und wuerde als
   Zahl ein Kindwort daneben verdraengen — "eine Schuelerin, gekleidet wie in
   den Achtzigern" gaelte als 80. Solche Formen werden nicht als Alter gelesen. */
const JAHRZEHNT_PERSON =
  /(?<!\p{L})(?:(?:mitt|end|anfangs)-?zwanziger(?:n|s|in|innen)?|zwanziger(?:n|in|innen))(?!\p{L})/giu;

/* Zahlwoerter in Ziffern. Dazu faellt eine einzelne Stelle hinter Komma oder
   Punkt weg ("12,5 Jahre" → "12 Jahre"): Sie ist kein Alter und wuerde sonst
   als 5 gelesen. "1,80" und "14.30" bleiben, wie sie sind. */
const NACHKOMMASTELLE = /(?<!\d)(\d{1,2})[.,]\d(?!\d)/g;
function mitZiffern(text) {
  return String(text || "")
    .replace(JAHRZEHNT_PERSON, "20")
    .replace(ZUSAMMEN_DE, (_w, e, z) => String(EINER[e.toLowerCase()] + ZEHNER_DE[z.toLowerCase()]))
    .replace(ZUSAMMEN_EN, (_w, z, e) => String(ZEHNER_EN[z.toLowerCase()] + ONES[e.toLowerCase()]))
    .replace(ZAHLWORT, (w) => String(ZAHLWOERTER[w.toLowerCase()]))
    .replace(NACHKOMMASTELLE, "$1");
}

function kategorieAlter(text) {
  const s = String(text || "");
  const werte = KATEGORIEN.filter(([re]) => re.test(s)).map(([, w]) => w);
  if (werte.length) return Math.min(...werte);
  return KINDWOERTER.some((re) => re.test(s)) ? 8 : null;
}

/* Fuer die Anzeige: Ziffern in Klammern auspacken ("~‹14›" → "~14"). */
function ohneZiffernKlammern(text) {
  return String(text || "").replace(ZIFFERN_IN_KLAMMERN, "$1");
}

/* Die UNTERE Altersgrenze aus dem hard-facts-Text lesen — also das jüngste
   Alter, das die Angabe des Modells noch zulässt.

   Beispiele (alle real so vorgekommen):
     "Du bist weiblich, ~14 Jahre alt (Spanne 12-16)."  -> 12
     "Männlich, ~38 — die Krähenfüße verraten dich."     -> 38
     "Du bist männlich, etwa 38. Spanne 35-42."          -> 35
     "weiblich, 16 bis 22"                               -> 16

   Bewusst das MINIMUM aller plausiblen Alterswerte im Text: Streut eine
   Fremdzahl zwischen andere Zahlen, zieht sie das Ergebnis nach unten und
   damit in Richtung MEHR Schutz.

   Eine genannte Zahl ersetzt aber die Kategorie ("~35 Jahre, jugendlich
   wirkend" ist 35, nicht 13). Das gilt für JEDE Zahl, auch für eine, die
   kein Alter ist: Steht neben einem Kindwort nur eine Fremdzahl über der
   Schutzgrenze ("Teenager, Schuhgröße 38"), liest die Auslese 38, und der
   Schutz greift nicht. Bewusst so, als Grenze benannt in
   docs/SECURITY-MODEL.md (Abschnitt 17.09.2026, Punkt 3). */
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
        "Mitte 30", "Mittzwanzigerin") -> null, das obere Ende ist offen;
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
  /(?<!\p{L})(?:anfang|mitte|ende|early|mid|late)[\s-]+(?:zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|[2-8]0)(?!\d|\p{L})|(?<!\p{L})\p{L}*(?:zig|ßig|ssig)er(?:n|s|in|innen)?(?!\p{L})|(?<!\p{L})(?:twenties|thirties|forties|fifties|sixties|seventies)(?!\p{L})|(?<!\d)[2-8]0(?:ern?|s)(?!\p{L})/iu;

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
  KLAMMER_AUF,
  KLAMMER_ZU,
  ZIFFERN_IN_KLAMMERN,
  mitZiffern,
  kategorieAlter,
  ohneZiffernKlammern,
  untereAltersgrenze,
  obereAltersgrenze,
};
