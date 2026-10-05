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
   "Lehrlingsausbilder" zaehlen nicht. "vorpubertaer" und "prepubescent" sind
   juenger als "pubertaer"; "postpubertaer" ist kein Kind. Eine Schulklasse
   als Wort ("dritte Klasse", "third grade") zaehlt wie "Drittklaessler".
   Orte der Betreuung ("Kita", "Kinderkrippe", "Vorschule") zaehlen wie
   "Kindergarten" nur als ganzes Wort — "Kitaleiterin" und "preschool
   teacher" nicht. */
const KATEGORIEN = [
  [
    /(?<!\p{L})(?:teen\p{L}*|jugendlich\p{L}*|jugendalter\p{L}*|adolescent\p{L}*|heranwachsend\p{L}*|halbw(?:ü|ue)chsig\p{L}*|halbstark\p{L}*|konfirmand(?:en|in|innen)?|youngsters?|juveniles?|youths|bursch(?:e|en|i|is|erl|erln)?)(?!\p{L})|(?<!\p{L})a\s+youth(?!\p{L})/iu,
    13,
  ],
  [/(?<!\p{L})(?:lehrling(?:e|en|s)?|azubis?|auszubildende[rn]?|apprentices?)(?!\p{L})/iu, 15],
  [/(?<!\p{L})(?:maturant(?:en|in|innen)?|abiturient(?:en|in|innen)?)(?!\p{L})/iu, 17],
  [
    /(?<!\p{L})(?:high[ -]?school\p{L}*|oberstufe(?!n?lehr))(?![ -]+(?:teacher|coach|principal|staff|reunion|diploma|lehrer|abschluss))|(?<!\p{L})(?:freshm[ae]n|sophomores?)(?!\p{L})/iu,
    14,
  ],
  [/(?<!\p{L})(?:pubert\p{L}*|pubescen\p{L}*|firmling(?:e|en|s)?(?!\p{L}))/iu, 12],
  [/(?<!\p{L})(?:middle[ -]?school\p{L}*|junior[ -]high)(?![ -]+(?:teacher|coach|principal|staff|lehrer))/iu, 11],
  [
    /(?<!\p{L})(?:school(?:girl|boy|child|kid)\p{L}*|pupil|pre-?teen\p{L}*|tween\p{L}*)(?!\p{L})|sch(?:ü|ue)ler|gymnasiast|unterstufe(?!n?lehr)|(?<!\p{L})(?:mittel|haupt|real|gesamt)sch(?:u|ü|ue)l(?!\p{L}*lehr)\p{L}*/iu,
    10,
  ],
  [/(?<!\p{L})(?:schul|klein|vorschul)kind\p{L}*|(?:grund|volks)sch(?:u|ü|ue)l\p{L}*/iu, 8],
  [/(?<!\p{L})(?:elementary|primary|grade)[ -]school/iu, 8],
  [
    /(?<!\p{L})(?:(?:vor|pr(?:ä|ae)|pre|fr(?:ü|ue)h)-?pubert\p{L}*|pre-?pubescen\p{L}*|(?:erst)?kommunions?kind\p{L}*|erstkommunion\p{L}*|ministrant(?:en|in|innen)?(?!\p{L})|kiddos?(?!\p{L})|kiddies?(?!\p{L})|little\s+ones?(?!\p{L}))/iu,
    8,
  ],
  [
    /(?<!\p{L})(?:(?:erst|zweit|dritt|viert|f(?:ü|ue)nft|sechst|siebt|acht|neunt|zehnt|elft|zw(?:ö|oe)lft)kl(?:ä|ae|a)ssler\p{L}*|taferlkl(?:ä|ae|a)ssler\p{L}*|schulanf(?:ä|ae)nger\p{L}*|abc-?sch(?:ü|ue)tze\p{L}*|schulpflichtig\p{L}*|schulalter\p{L}*|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[ -]grade(?:rs?)?(?!\p{L})|(?:erste|zweite|dritte|vierte|f(?:ü|ue)nfte|sechste|siebte|achte|neunte|zehnte)[nr]?\s+(?:klasse|schulstufe)(?!\p{L}))/iu,
    6,
  ],
  [/(?<!\p{L})Kind(?:er)?(?!\p{L})|(?<!\p{L})(?:child\p{L}*|kids?)(?!\p{L})/u, 8],
  [
    /(?<!\p{L})(?:kindergarten(?:kind\p{L}*|alter\p{L}*)?(?!\p{L})|(?:kindes|kleinkind|vorschul)alter\p{L}*|kindergarte?ners?(?!\p{L})|pre-?school(?:ers?)?(?!\p{L})(?![ -]+(?:teacher|staff))|vorschulen?(?!\p{L})|kitas?(?!\p{L})|kitakind\p{L}*|kindertagesst(?:ä|ae)tten?(?!\p{L}))/iu,
    3,
  ],
  [/(?<!\p{L})toddlers?(?!\p{L})/iu, 2],
  [
    /(?<!\p{L})(?:bab(?:y|ys|ies)|infants?|newborns?)(?!\p{L})|s(?:ä|ae)ugling|(?<!\p{L})(?:neugeboren\p{L}*|krabbel(?:kind\p{L}*|alter\p{L}*|gruppen?(?!\p{L}))|kinderkrippen?(?!\p{L})|krippenkind\p{L}*)/iu,
    1,
  ],
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
   Dirndl", nicht in "traegst ein Dirndl". Mundart und Koseformen ("Maedl",
   "Madl", "Bua", "Buam", "Buebchen", "Knirps") nur gross geschrieben. */
const KINDWOERTER = [
  /m(?:ä|ae)dchen|m(?:ä|ae)dels?(?!\p{L})|(?<!\p{L})knaben?(?!\p{L})|(?<!\p{L})kindlich\p{L}*/iu,
  /(?<!\p{L})(?<!(?<!\p{L})(?:game|bad|golden|it|cover|oh)[ -])(?:girls?|boys?)(?!\p{L})(?![ -]+(?:boss|power|bands?|groups?|next door|clubs?)(?!\p{L}))/iu,
  /(?<!\p{L})(?:Schulb|Lausb|B)ub(?:en)?(?!\p{L})|(?<=[\p{L},:]\s)(?:Jung(?:e|en|s)|Schuljungen?)(?!\p{L})(?!\s+\p{Lu})/u,
  /(?<=(?<!\p{L})ein\s)junge(?!\p{L})/iu,
  /(?<=(?<!\p{L})(?:bist|ist)\s+ein\s+(?:\p{L}+\s+)?)Dirndl(?!\p{L})/u,
  /(?<!\p{L})(?:M(?:ä|ae|a)d(?:l|ln|ls|le|li|erl|erln)|Bu(?:a|am|ama|berl|bi)|B(?:ü|ue)b(?:chen|lein|le|li)|Madels?|Knirps(?:e|en)?|G(?:ö|oe)r(?:e|en)?|Bengel[ns]?|Dreik(?:ä|ae)sehoch|Spr(?:ö|oe)ssling(?:e|en|s)?)(?!\p{L})/u,
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

/* Woerter, die ein junges Alter andeuten, ohne eines zu nennen: ein
   Altersversuch ohne lesbares Alter.
   "sehr jung", "very young": immer. "jung" allein ungebeugt ("Du bist
   jung", "weiblich, jung"); gebeugt nur vor einem Wort fuer die Person
   selbst ("junger Mensch", "junges Gesicht"). "junge Frau", "junger Mann",
   "junge Katze" und "juenger als" zaehlen nicht, "jung geblieben" und "Jung
   und Alt" auch nicht. "young" nicht vor einem Erwachsenen-Wort ("young
   woman", "young adult", "young at heart").
   "noch im Wachstum", "noch nicht ausgewachsen", "Wachstumsschub": nur mit
   "noch", "mitten" oder als festes Wort — "im Wachstum" allein steht auch
   bei Firmen. "noch nicht erwachsen", "noch kein Erwachsener", "not yet an
   adult": sagt wie "minderjaehrig" unter 18, ohne Zahl.
   "zwei", "drei", "vier" (und englisch): Die Altersauslese liest Zahlwoerter
   erst ab fuenf als Alter. Als Altersversuch zaehlen auch die kleineren,
   wie jede kleine Zahl ("Du bist drei"). "ein" und "one" nicht — sie sind
   Artikel und Fuerwort.
   Merkmale, die nur Kinder und Jugendliche haben ("Milchzaehne",
   "Zahnwechsel", "Stimmbruch", "Babyspeck"): Die KI nennt sie als Beleg fuer
   das Alter. "Zahnspange" und "Zahnluecke" gibt es auch bei Erwachsenen —
   sie zaehlen nicht. */
const VERSUCHSWOERTER = [
  /(?<!\p{L})(?:zwei|drei|vier|two|three|four)(?=-?j(?:ä|ae)hrig|einhalb(?!\p{L})|(?!\p{L}))/iu,
  /(?<!\p{L})(?:sehr|ganz|extrem|very|really|quite)\s+(?:jung|young)(?!\p{L})/iu,
  /(?<!\p{L})jung(?!\p{L})(?!\s+(?:geblieben\p{L}*|verheiratet|im\s+herzen|und\s+alt)(?!\p{L}))/iu,
  /(?<!\p{L})jung(?:e|er|es|en|em)\s+(?:person(?:en)?|mensch(?:en)?|leute|gesicht(?:er|sz(?:ü|ue)ge)?|z(?:ü|ue)ge|erscheinung|aussehen)(?!\p{L})/iu,
  /(?<!\p{L})young(?!\p{L})(?!\s+(?:wom[ae]n|m[ae]n|adults?|lad(?:y|ies)|gentlem[ae]n|mothers?|fathers?|moms?|dads?|parents?|professionals?|couples?|at\s+heart|and\s+old)(?!\p{L}))/iu,
  /(?<!\p{L})(?:noch\s+(?:nicht\s+(?:ganz\s+)?ausgewachsen|im\s+wachstum|in\s+der\s+entwicklung)|mitten\s+im\s+wachstum)(?!\p{L})|(?<!\p{L})wachstumsschub\p{L}*|(?<!\p{L})(?:still\s+growing|not\s+(?:yet\s+)?fully\s+grown|growth\s+spurt)(?!\p{L})/iu,
  /(?<!\p{L})noch\s+(?:nicht\s+(?:ganz\s+)?erwachsen|kein\p{L}*\s+erwachsene[rn]?)(?!\p{L})|(?<!\p{L})not\s+(?:yet\s+)?(?:an\s+adult|grown[- ]up)(?!\p{L})/iu,
  /(?<!\p{L})(?:milchz(?:a|ä|ae)hn\p{L}*|milchgebiss\p{L}*|zahnwechsel\p{L}*|wechselgebiss\p{L}*|stimmbruch\p{L}*|babyspeck\p{L}*)|(?<!\p{L})(?:milk\s+(?:teeth|tooth)|puppy\s+fat|voice\s+(?:is\s+)?(?:breaking|cracking))(?!\p{L})/iu,
];

/* Weitere Alterswoerter und Abkuerzungen (05.10.2026). Sie zeigen einen
   Altersversuch an, auch wenn keine Zahl dasteht ("Alter: unklar").
   "Jahr" in der Einzahl ("ein Jahr alt", "1 Jahr"; wie englisch "year"),
   "Lebensjahr", "Lj.". "J." nur hinter einer Zahl ("13 J."). "Alter:",
   "age:", "im Alter von", "Alter 13", "age 13", "aged 13". "yo", "y/o",
   "y.o." nur hinter einer Zahl. */
const ALTERSWORT_KURZ =
  /(?<!\p{L})jahr(?!\p{L})|(?<!\p{L})lebensjahr\p{L}*|(?<!\p{L})lj\.|(?<=\d\s?)j\.?(?!\p{L})|(?<!\p{L})(?:alter|age)\s*:|(?<!\p{L})(?:im\s+alter\s+von|at\s+the\s+age\s+of)(?!\p{L})|(?<!\p{L})(?:alter|age|aged)\s+(?:(?:ca\.?|circa|etwa|about|around)\s+)?~?\s*\d|(?<=\d\s?)(?:yo|y\/o|y\.\s?o\.?)(?!\p{L})/iu;

/* Naeherungswoerter vor einer Zahl ("etwa 13", "ca. 13", "around 12"), fuer
   das Alter direkt hinter einem Geschlechtskuerzel ("W., ca. 13 J."). Die
   Tilde ("~13") zaehlt ebenfalls, sie steht in der Regel selbst. */
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
  VERSUCHSWOERTER,
  ALTERSWORT_KURZ,
};
