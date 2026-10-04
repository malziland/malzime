"use strict";

/**
 * alters-lesbarkeit-woerter.js — die Woerter der Alterslesung.
 *
 * REINE DATEN: Zahlwoerter, Kategorien ("Teenager", "Schulkind"), Kindwoerter
 * ("Maedchen", "Bub") und die Abkuerzungen, an denen ein Satz nicht endet.
 * Wie sie angewandt werden, steht in alters-lesbarkeit.js. Herausgeloest am
 * 04.10.2026: Die Listen wachsen, die Regeln nicht.
 */

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

/* Zusammengesetzte Zahlen: "fuenfundzwanzig", "twenty-five". */
const EINER = { ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const ZEHNER_DE = { zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80 };
const ZEHNER_EN = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80 };

/* Kategorien ("Teenager", "jugendlich", "Schulkind") — zaehlen NUR, wenn
   keine Zahl dasteht: "~35 Jahre, jugendlich wirkend" ist 35, nicht 13.
   "Kind" nur gross geschrieben — das englische "kind" (freundlich) ist kein
   Alter. Der Wert ist das juengste Alter, das die Kategorie zulaesst; er
   dient der Auswertung, geschuetzt wird bei jedem.
   Gegenproben gegen Erwachsenen-Formen: Lehrkraefte ("Unterstufenlehrerin",
   "high school teacher"), "Burschenschaft", "burschikos", "youthful",
   "Kindergaertnerin", "Kindergartenpaedagogin", "Kindesmutter" und
   "Lehrlingsausbilder" zaehlen nicht. */
const KATEGORIEN = [
  [
    /(?<!\p{L})(?:teen\p{L}*|jugendlich\p{L}*|jugendalter\p{L}*|adolescent\p{L}*|heranwachsend\p{L}*|youngsters?|juveniles?|youths|bursch(?:e|en)?)(?!\p{L})|(?<!\p{L})a\s+youth(?!\p{L})/iu,
    13,
  ],
  [/(?<!\p{L})(?:lehrling(?:e|en|s)?|azubis?|auszubildende[rn]?|apprentices?)(?!\p{L})/iu, 15],
  [
    /(?<!\p{L})(?:high[ -]?school\p{L}*|oberstufe(?!n?lehr))(?![ -]+(?:teacher|coach|principal|staff|reunion|diploma|lehrer|abschluss))/iu,
    14,
  ],
  [/(?<!\p{L})pubert\p{L}*/iu, 12],
  [/(?<!\p{L})(?:middle[ -]?school\p{L}*|junior[ -]high)(?![ -]+(?:teacher|coach|principal|staff|lehrer))/iu, 11],
  [
    /(?<!\p{L})(?:school(?:girl|boy|child|kid)\p{L}*|pupil|pre-?teen\p{L}*|tween\p{L}*)(?!\p{L})|sch(?:ü|ue)ler|gymnasiast|unterstufe(?!n?lehr)/iu,
    10,
  ],
  [/(?<!\p{L})(?:schul|klein|vorschul)kind\p{L}*|(?:grund|volks)sch(?:u|ü|ue)l\p{L}*/iu, 8],
  [/(?<!\p{L})(?:elementary|primary|grade)[ -]school/iu, 8],
  [
    /(?<!\p{L})(?:(?:erst|zweit|dritt|viert|f(?:ü|ue)nft|sechst|siebt|acht|neunt|zehnt|elft|zw(?:ö|oe)lft)kl(?:ä|ae)ssler\p{L}*|schulalter\p{L}*|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[ -]graders?(?!\p{L}))/iu,
    6,
  ],
  [/(?<!\p{L})Kind(?:er)?(?!\p{L})|(?<!\p{L})(?:child\p{L}*|kids?)(?!\p{L})/u, 8],
  [
    /(?<!\p{L})(?:kindergarten(?:kind\p{L}*|alter\p{L}*)?(?!\p{L})|(?:kindes|kleinkind|vorschul)alter\p{L}*|kindergarte?ners?(?!\p{L})|preschoolers?(?!\p{L}))/iu,
    3,
  ],
  [/(?<!\p{L})toddlers?(?!\p{L})/iu, 2],
  [/(?<!\p{L})(?:bab(?:y|ys|ies)|infants?)(?!\p{L})|s(?:ä|ae)ugling/iu, 1],
];
/* Maedchen, Bub, Junge, Knabe, girl, boy: ein Kind, aber ohne Altersstufe —
   zaehlt deshalb nur, wenn keine Kategorie oben greift ("teenage girl" bleibt
   13).
   "Junge" nur als Hauptwort: gross geschrieben, nach einem Wort oder Komma
   und nicht vor einem Hauptwort — "Junge Frau" ist kein Kind. Klein
   geschrieben nur hinter "ein": "ein junge" kann kein Eigenschaftswort sein
   (das hiesse "ein junger", "eine junge").
   "girl" und "boy" nicht in festen Verbindungen ("Girl Boss", "Boy Band",
   "Game Boy", "It-Girl"). "Dirndl" ist auch ein Kleid: Kind nur in "bist ein
   Dirndl", nicht in "traegst ein Dirndl". */
const KINDWOERTER = [
  /m(?:ä|ae)dchen|m(?:ä|ae)dels?(?!\p{L})|(?<!\p{L})knaben?(?!\p{L})|(?<!\p{L})kindlich\p{L}*/iu,
  /(?<!\p{L})(?<!(?<!\p{L})(?:game|bad|golden|it|cover|oh)[ -])(?:girls?|boys?)(?!\p{L})(?![ -]+(?:boss|power|bands?|groups?|next door|clubs?)(?!\p{L}))/iu,
  /(?<!\p{L})(?:Schulb|Lausb|B)ub(?:en)?(?!\p{L})|(?<=[\p{L},:]\s)(?:Jung(?:e|en|s)|Schuljungen?)(?!\p{L})(?!\s+\p{Lu})/u,
  /(?<=(?<!\p{L})ein\s)junge(?!\p{L})/iu,
  /(?<=(?<!\p{L})(?:bist|ist)\s+ein\s+(?:\p{L}+\s+)?)Dirndl(?!\p{L})/u,
];

/* Abkuerzungen, an denen der erste Satz nicht endet (KEIN_SATZENDE in
   alters-lesbarkeit.js).
   ABKUERZUNGEN und "u. a.": nur, wenn danach weder ein Grossbuchstabe noch
   das Textende kommt — "Du bist Max. Deine Wangen ..." bleibt ein Satzende.
   ABKUERZUNGEN_IMMER: stehen nicht am Satzende, auch nicht vor einem
   Hauptwort ("im sog. Teenageralter", "geb. 2012", "Jg. 2012", "weibl.
   Teenager").
   ABKUERZUNGEN_MEHRTEILIG: mit Punkt in der Mitte, mit oder ohne Leerzeichen
   ("z. B.", "d.h.", "i.e.", "e.g."). */
const ABKUERZUNGEN = "ca cca ungef ugf approx appr zw rd mind max min evtl vermutl wahrsch est abt bzw".split(" ");
const ABKUERZUNGEN_IMMER = "sog geb jg jhg jahrg weibl männl maennl".split(" ");
const ABKUERZUNGEN_MEHRTEILIG = ["z B", "z b", "d h", "i e", "e g"];
const ABKUERZUNG_UND_ANDERE = "u a";

/* "Sehr jung" nennt kein Alter, ist aber ein Altersversuch. */
const SEHR_JUNG = /(?<!\p{L})(?:sehr|ganz|extrem|very|really|quite)\s+(?:jung|young)(?!\p{L})/iu;

/* Naeherungswoerter vor einer Zahl ("etwa 13", "hoechstens 12", "around
   12"). Die Tilde ("~13") zaehlt ebenfalls, sie steht in der Regel selbst. */
const NAEHERUNGSWOERTER = [
  "etwa",
  "circa",
  "zirka",
  "ca.",
  "ca",
  "ungefähr",
  "ungefaehr",
  "ungef.",
  "höchstens",
  "hoechstens",
  "maximal",
  "max.",
  "knapp",
  "rund",
  "kaum",
  "vielleicht",
  "geschätzt",
  "about",
  "around",
  "approximately",
  "approx.",
  "approx",
  "roughly",
  "at most",
  "maybe",
  "perhaps",
  "barely",
];

module.exports = {
  ZAHLWOERTER,
  EINER,
  ONES,
  ZEHNER_DE,
  ZEHNER_EN,
  KATEGORIEN,
  KINDWOERTER,
  ABKUERZUNGEN,
  ABKUERZUNGEN_IMMER,
  ABKUERZUNGEN_MEHRTEILIG,
  ABKUERZUNG_UND_ANDERE,
  NAEHERUNGSWOERTER,
  SEHR_JUNG,
};
