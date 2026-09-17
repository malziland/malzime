"use strict";

/**
 * minor-safety.js — Serverseitiges Netz gegen unzulässige Werbeinhalte.
 *
 * WARUM ES DAS GIBT:
 * Der Prompt verbietet bei Minderjährigen ausdrücklich sexualisierte
 * Zuschreibungen, Glücksspiel, Kredit, Diät und Schönheitskorrektur. Ein
 * Sprachmodell KANN diese Regel aber ignorieren — im Modellvergleich vom
 * 2026-08-10 schlug mistral-medium-latest bei zwei 14-Jährigen "OnlyFans
 * Merch Drops" und "Bet365 Live-Wetten Abo" vor, mit exakt diesem Prompt.
 * (mistral-large-2512 blieb in 42 Analysen sauber, aber ein Netz gab es
 * bisher gar nicht.)
 *
 * Sicherheit darf nicht allein davon abhängen, dass ein Modell sich an eine
 * Textanweisung hält. Dieses Modul prüft das fertige Ergebnis, bevor es
 * ausgeliefert wird, und entfernt eindeutig unzulässige Einträge.
 *
 * ZWEI STUFEN, bewusst so gewaehlt:
 *   1. Pornografie, Sexarbeit, Waffen und Extremismus fliegen IMMER raus —
 *      unabhängig vom geschätzten Alter. Grund: Die Altersschätzung ist
 *      unzuverlässig (im Testset wurde eine 14-Jährige für 28 gehalten), und
 *      in einem Werkzeug fürs Klassenzimmer haben diese Inhalte ohnehin
 *      nichts verloren. Damit hängt die schwerste Absicherung nicht mehr an
 *      einer Schätzung.
 *   2. Glücksspiel, Kredit, Alkohol, Schönheits-OP und Diätmittel nur bei
 *      möglicherweise Minderjährigen — mit Sicherheitspuffer, siehe
 *      Altersgrenze unten. Bei Erwachsenen sind sie legitimer Lerninhalt —
 *      wie diese Branchen Menschen adressieren, IST das Thema.
 *
 * BEWUSST ENG GEFASST: Gefiltert wird nur, was unzweifelhaft nicht zu Kindern
 * gehört. NICHT gefiltert wird die didaktisch gewollte System-Perspektive —
 * "Dating-Apps zielen auf dich" ist laut Prompt ausdrücklich erwünscht
 * (Werbedruck und Plattform-Mechanik zeigen, statt persönliche Defizite
 * zuzuschreiben). Ein zu scharfer Filter würde genau die Aufklärung
 * wegschneiden, um die es geht.
 */

/* ── Altersgrenze ─────────────────────────────────────────────────────────
   Bezieht sich auf die Schaetzung des Modells, nicht auf Wahrheit.

   REGEL (seit 2026-09-17, loest die Vereinbarung vom 2026-08-11 ab): Stufe 2
   greift, wenn die UNTERGRENZE der geschaetzten Spanne 25 oder darunter ist.
   Nicht der Punktwert zaehlt, sondern das juengste Alter, das die Angabe
   zulaesst.

     Spanne 17-24  →  Filter greift       (Untergrenze 17)
     Spanne 25-30  →  Filter greift       (Untergrenze 25)
     Spanne 26-32  →  Filter greift nicht (Untergrenze 26)

   WARUM DER PUFFER: Bis 2026-09-17 galt "Untergrenze 18 oder darunter" ohne
   Abstand. In zwei Workshops mit Schulklassen (16. und 17.09.2026, jeweils 7
   bis 12 Uhr) hatten 31 von 186 bzw. 50 von 143 Analysen eine Untergrenze von
   19 oder mehr, davon 24 bzw. 40 genau 19 oder 25. Wo darunter Minderjaehrige
   waren, griff Stufe 2 nicht. Die Fachwelt rechnet deshalb mit einem Puffer: NIST nennt fuer die Grenze 18
   einen Puffer von sieben Jahren, also die Schwelle 25, als ueblich (NIST IR
   8525, "Challenge-T"); allgemeine Bild-Sprachmodelle schaetzen 16 bis 29 %
   der Minderjaehrigen als erwachsen (Ren u. a. 2026, arXiv 2602.07815).
   Nachgerechnet an beiden Tagen bei gleichen Schaetzungen: 7 statt 31 und 10
   statt 50 Analysen ohne Stufe 2.

   Bewusst getragene Folge: Erwachsene, deren Spanne bei 25 oder darunter
   beginnt, bekommen keine Kredit-, Wett-, Alkohol-, Schoenheits-OP- und
   Diaet-Ideen. Stufe 1 (Pornografie, Waffen, Extremismus) gilt unveraendert
   fuer alle. */
const VOLLJAEHRIG_AB = 18;
/* BLEIBT IM CODE — Kinderschutz-Regel, keine Betriebseinstellung. Wer den
   Puffer aendert, aendert die Entscheidung vom 17.09.2026; das geht nur mit
   Test und Deploy, nicht per Datenbankeintrag. */
const PUFFER_JAHRE = 7;
/* „Untergrenze ≤ 25" als strikter Vergleich geschrieben: untergrenze < 26. */
const SCHUTZ_BIS = VOLLJAEHRIG_AB + PUFFER_JAHRE + 1;

/* ── Nicht lesbares Alter (17.09.2026) ────────────────────────────────────
   Das Formatbeispiel im Prompt zeigt das Alter nur noch als "~‹Zahl› Jahre
   alt (Spanne ‹Zahl›-‹Zahl›)" — eine Beispielzahl zog die Schaetzungen an.
   Schreibt das Modell die Vorlage ab (in welcher Klammer auch immer) oder
   nennt es ein Alter ohne eine einzige Ziffer ("~dreizehn Jahre"), gilt das
   Alter als NICHT LESBAR:
     - Die Alterskarte zeigt dann einen festen Satz statt eines geflickten
       Textes (alterskarteText in mistral.js, Satz aus alterNichtLesbarText).
     - Der Kinderschutz-Filter laesst Stufe 2 greifen (applyMinorSafety).
   Zahlwoerter ("etwa dreizehn", "Mitte vierzig", "in his teens") sind eine
   LESBARE Angabe: Sie werden fuer die Pruefung und fuer die Altersauslese in
   Ziffern uebersetzt (Gegenpruefung 17.09.2026). Nur einfache Woerter von
   fuenf bis achtzig, keine zusammengesetzten Zahlen.
   "Keine klaren Bildsignale." oder ein blosses "weiblich" sind KEIN
   unlesbares Alter — dort steht gar kein Altersversuch, und es bleibt bei der
   Regel "ohne Alter nicht filtern".
   Auch Kategoriewoerter ("Teenager", "jugendlich", "Kind") sind eine
   Angabe: Sie zaehlen als junges Alter.
   Geprueft werden hoechstens die ersten PRUEF_MAX Zeichen — so lang darf eine
   Karte hoechstens sein (json-repair.js); die Suchmuster laufen linear. */
/* BLEIBT IM CODE — Grenze gegen lange Modellausgaben, gleich der
   Kartenlaenge, keine Betriebseinstellung. */
const PRUEF_MAX = 800;
const KLAMMER_AUF = "‹<\\[{«(„“\"'‚‘⟨〈";
const KLAMMER_ZU = "›>\\]}»)“”\"'‘’⟩〉";
const ZIFFERN_IN_KLAMMERN = new RegExp(`[${KLAMMER_AUF}]\\s*(\\d{1,3})\\s*[${KLAMMER_ZU}]`, "g");
const PLATZHALTER_IN_KLAMMERN = new RegExp(`[${KLAMMER_AUF}]\\s*(?:zahl|number|alter|age)\\s*[${KLAMMER_ZU}]`, "i");
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
  teens: 13,
  teen: 13,
  teenager: 13,
  teenagerin: 13,
  jugendlich: 13,
  jugendliche: 13,
  jugendlicher: 13,
  adolescent: 13,
  twenties: 20,
  thirties: 30,
  forties: 40,
  fifties: 50,
  sixties: 60,
  seventies: 70,
};
/* Wortgrenzen ueber Buchstaben (auch Umlaute): "acht" trifft nicht in
   "achtzehn", "zehn" nicht in "dreizehn", "ten" nicht in "often". */
const ZAHLWORT = new RegExp(`(?<!\\p{L})(${Object.keys(ZAHLWOERTER).join("|")})(?!\\p{L})`, "giu");

/* "Kind" nur gross geschrieben — das englische "kind" (freundlich) ist kein
   Alter. */
const KIND = /(?<!\p{L})(?:Kind|child)(?!\p{L})/gu;

function mitZiffern(text) {
  return String(text || "")
    .replace(ZAHLWORT, (w) => String(ZAHLWOERTER[w.toLowerCase()]))
    .replace(KIND, "8");
}

function pruefText(text) {
  return mitZiffern(String(text || "").slice(0, PRUEF_MAX)).replace(ZIFFERN_IN_KLAMMERN, "$1");
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
  /^(?:du bist |you are )?(?:geschlecht |gender )?(männlich|weiblich|divers|nicht eindeutig erkennbar|male|female|not clearly identifiable)(?!\p{L})/iu;

/* Fester Satz fuer die Alterskarte, wenn das Alter nicht lesbar ist. Die
   Saetze stehen in der Sprachdatei (prompts.js: alterNichtLesbar,
   geschlechtSatz); das Geschlecht wird uebernommen, wenn es am Anfang klar
   dasteht. */
function alterNichtLesbarText(quelle, texte) {
  const m = GESCHLECHT.exec(String(quelle || "").trim());
  const g = m ? m[1].toLowerCase() : "";
  const vorn = g && texte.geschlechtSatz ? `${texte.geschlechtSatz.replace("{geschlecht}", g)} ` : "";
  return `${vorn}${texte.alterNichtLesbar}`;
}

/* ── Zwei Stufen ──────────────────────────────────────────────────────────
   IMMER_VERBOTEN gilt unabhaengig vom geschaetzten Alter. Das ist bewusst so:
   Der Alters-Filter unten greift nur, wenn das Modell die Person als
   minderjaehrig einstuft — im Testset hielt es eine 14-Jaehrige aber fuer 28.
   Fuer die schwersten Kategorien darf die Absicherung nicht an einer
   Schaetzung haengen. Und in einem Werkzeug, das im Klassenzimmer an die Wand
   projiziert wird, haben diese Inhalte auch bei Erwachsenen nichts verloren.

   NUR_MINDERJAEHRIG ist dagegen altersabhaengig, weil es bei Erwachsenen
   legitimer Teil der Aufklaerung ist: Wie Kredit-, Alkohol- oder
   Schoenheitsindustrie Menschen adressieren, IST der Lerninhalt. */

/* ── Warum die Listen zweisprachig sind (Audit 2026-08-10, SEC-001) ───────
   Die Listen waren rein deutsch und markenzentriert. Gemessen an zwoelf
   realistischen englischen Werbephrasen rutschten ZEHN durch — darunter
   "Porn Subscription", "Handgun Accessories" und "Neo-Nazi Clothing", also
   ausgerechnet die Stufe, die altersunabhaengig greifen soll. Erreichbar ist
   die englische Fassung ueber ?lang=en oder ein englisch eingestelltes Geraet.
   Deshalb steht jeder Begriff jetzt in beiden Sprachen.

   Und: Deutsche Komposita brauchen KEINE linke Wortgrenze. `\bkredit` traf
   "Kredit", aber weder "Sofortkredit" noch "Ratenkredit" noch "Autokredit" —
   also genau die Wortbildung, die im Deutschen die Regel ist. */

const IMMER_VERBOTEN = [
  /* Pornografie und Sexarbeit */
  /onlyfans|fansly|pornhub|xhamster|camgirl|cam-?girl|escort|bordell|erotikportal|sexshop|sexcam/i,
  /\bporno?\b|pornografie|pornography|adult ?webcam|strip ?club|brothel|sex ?toys?/i,
  /* Gewaltverherrlichung, Waffen, Extremismus */
  /schusswaffe|munition|waffenhandel|glock|kalaschnikow|ar-?15|schlagring|butterflymesser/i,
  /\bgun\b|\bguns\b|handgun|rifle|firearm|ammunition|\bammo\b|silencer/i,
  /extremis|rechtsradikal|neo-?nazi|terror|white ?supremac/i,
];

/* Stufe 2 gilt nur fuer WERBUNG (ad_targeting) und nur bei moeglicherweise
   Minderjaehrigen (Untergrenze bis SCHUTZ_BIS, siehe oben).
   Fuer die Manipulations-Trigger wird sie bewusst NICHT angewandt — siehe
   applyMinorSafety. */
const NUR_MINDERJAEHRIG = [
  /* Gluecksspiel und Sportwetten */
  /bet365|tipico|bwin|betano|winamax|lottoland|tipp3|casino|jackpot|sportwetten|gl[uü]cksspiel/i,
  /wettanbieter|buchmacher|kombiwette|online-?wetten|\bwetten\b/i,
  /gambling|betting|bookmaker|slot ?machines?|\bpoker\b|\bbet\b/i,
  /* Kredit und Ratenfinanzierung — ohne linke Wortgrenze wegen der Komposita */
  /kredit|darlehen|ratenkauf|ratenzahlung|klarna|schufa|inkasso|leasing|mikrofinanz/i,
  /\bloan\b|\bloans\b|payday|instal?lment ?plan|buy ?now ?pay ?later|credit ?card/i,
  /* Alkohol und Tabak */
  /\bbier\b|bier(?:abo|kasten)|\bwein\b|wein(?:probe|abo)|rotwein|wei[ßs]wein|gl[uü]hwein|sekt\b|prosecco|aperol|\bgin\b|\brum\b|tequila|cocktail|spirituose|vodka|whisky/i,
  /zigarett|tabak|\bvape\b|e-?shisha|nikotin|\bsnus\b/i,
  /\bbeer\b|\bwine\b|liquor|alcohol|cigarettes?|nicotine ?pouch/i,
  /* Schoenheitskorrektur */
  /botox|hyaluron|\bfiller\b|sch[oö]nheits-?(?:op|chirurgie)|beauty-?op|fettabsaug|brustvergr[oö]ss|lippen ?aufspritz|nasenkorrektur/i,
  /cosmetic ?surgery|breast ?augmentation|liposuction|lip ?fillers?/i,
  /* Diaet- und Abnehmindustrie */
  /di[aä]t(?:pille|shake|produkt)|abnehm(?:spritze|coaching|kur)|ozempic|wegovy|mounjaro|almased|slimfast|formula-?di[aä]t|detox ?kur|appetitz[uü]gler|fatburner|schlankheitsmittel/i,
  /slimming ?pills?|diet ?pills?|weight ?loss|appetite ?suppressant|fat ?burner/i,
];

/* ── Werbe-Anzahl (09.09.2026) ────────────────────────────────────────────
   BLEIBT IM CODE — Gestaltung, kein Betriebswert: Die Anzahl der Werbekarten
   ist Teil des Bildschirms, nicht der Last, und der Prompt liest sie von
   hier; ueber Firestore veraenderbar hiesse, Prompt und Kappung koennten
   auseinanderlaufen.
   Der Werbe-Aufruf liefert WERBE_ANFORDERUNG Eintraege, gezeigt werden
   hoechstens WERBE_ANZAHL. Grund: Streicht der Filter bei einem Kind zwei
   Eintraege, sah das Kind vorher sechs Werbeideen, ein Erwachsener acht —
   die Anzahl verriet den Filter. Mit zwei Eintraegen Reserve stimmt die
   Anzahl auch nach dem Streichen. Nachgefuellt wird nichts: Ersatz aus einer
   festen Liste waere keine Analyse mehr. Die Prompt-Dateien unter locales
   lesen WERBE_ANFORDERUNG von hier, damit die Zahl nur einmal steht. */
const WERBE_ANZAHL = 8;
const WERBE_ANFORDERUNG = WERBE_ANZAHL + 2;

/* Liefert das getroffene Wort aus der Liste: nur das Wort selbst, klein
   geschrieben, hoechstens 30 Zeichen. Kein Satz, kein Kontext. Das Log soll
   sagen "wetten" oder "cocktail", nicht, was ueber die Person geschrieben
   wurde — so bleibt die Diagnose ohne Personenbezug. */
function stichwort(liste, eintrag) {
  const s = String(eintrag || "");
  for (const re of liste) {
    const m = re.exec(s);
    if (m) return m[0].trim().toLowerCase().slice(0, 30);
  }
  return null;
}

function istImmerVerboten(eintrag) {
  return stichwort(IMMER_VERBOTEN, eintrag) !== null;
}

function istBeiMinderjaehrigenVerboten(eintrag) {
  return stichwort(NUR_MINDERJAEHRIG, eintrag) !== null;
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

  return kandidaten.length ? Math.min(...kandidaten) : null;
}

/**
 * Prüft ein fertiges Profil-Paar und entfernt unzulässige Werbe- und
 * Trigger-Einträge, wenn die Person als minderjährig eingestuft wurde.
 *
 * Verändert `profiles` in-place und gibt einen Bericht zurück — der Aufrufer
 * kann daraus loggen, ohne dass hier Log-Abhängigkeiten entstehen.
 */
function applyMinorSafety(profiles, opts = {}) {
  const bericht = {
    applied: false,
    alter: null,
    entfernt: [],
    durchgerutscht: [],
    /* Anzahl der Werbeeintraege je Modus, nachdem Filter und Kappung durch
       sind — also das, was das Kind tatsaechlich sieht. */
    werbung: {},
    gekappt: [],
    lang: opts.lang || null,
  };
  if (!profiles || typeof profiles !== "object") return bericht;

  /* Alter zuerst aus dem Anker (hard_facts, vom Aufrufer als alterText
     uebergeben) — unveraendert, also auch mit abgeschriebenem Platzhalter.
     Nur ohne Anker aus der Karte; die ist seit 17.09.2026 vor der Anzeige um
     einen Platzhalter bereinigt (mistral.js). */
  const quelle =
    opts.alterText ||
    profiles.normal?.categories?.alter_geschlecht?.value ||
    profiles.boost?.categories?.alter_geschlecht?.value ||
    "";
  const untergrenze = untereAltersgrenze(quelle);
  bericht.alter = untergrenze;
  const alterUnlesbar = opts.alterUnlesbar === true || istAlterUnlesbar(quelle);
  bericht.alterUnlesbar = alterUnlesbar;

  /* "Koennte minderjaehrig sein", nicht "ist es wahrscheinlich". Siehe die
     Begruendung bei SCHUTZ_BIS und beim nicht lesbaren Alter oben. Das Feld heisst weiter
     `minderjaehrig`, weil die Auswertungen des Diagnose-Speichers es so
     zaehlen; gemeint ist "Stufe 2 greift". */
  const minderjaehrig = alterUnlesbar || (untergrenze !== null && untergrenze < SCHUTZ_BIS);
  bericht.minderjaehrig = minderjaehrig;

  /* Ist gar kein Altersversuch erkennbar ("Keine klaren Bildsignale."), wird NICHT
     als minderjaehrig behandelt — sonst verloere man bei Erwachsenen legitime
     Inhalte (Kredit, Wein, Wellness sind dort Teil der Aufklaerung). Die harte
     Liste greift trotzdem. */
  for (const modus of ["normal", "boost"]) {
    const p = profiles[modus];
    if (!p) continue;

    /* ── Werbung: beide Stufen ──────────────────────────────────────────
       ad_targeting sind Produktanpreisungen von 1-3 Woertern. Hier greift der
       Filter voll. */
    /* ── Manipulations-Trigger: NUR die harte Stufe ─────────────────────
       SEC-001 (Audit 2026-08-10): Trigger sind ganze Erklaersaetze darueber,
       WIE eine Branche Menschen adressiert — genau der Lerninhalt. Mit der
       Werbe-Liste darauf verschwanden bei Minderjaehrigen fuenf von sieben
       prompt-konformen Saetzen, darunter "Lootboxen arbeiten mit denselben
       Mechaniken wie Gluecksspiel — nur ohne Altersgrenze". Das ist die
       Kernaussage des Workshops und darf nicht weggefiltert werden.
       Pornografie, Waffen und Extremismus fliegen weiterhin auch hier raus. */
    for (const [feld, mitAltersstufe] of [
      ["ad_targeting", true],
      ["manipulation_triggers", false],
    ]) {
      if (!Array.isArray(p[feld])) continue;
      const vorher = p[feld];
      const nachher = [];
      for (const e of vorher) {
        const hart = stichwort(IMMER_VERBOTEN, e);
        if (hart !== null) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "immer", stichwort: hart, eintrag: String(e).slice(0, 80) });
          continue;
        }
        const weich = mitAltersstufe && minderjaehrig ? stichwort(NUR_MINDERJAEHRIG, e) : null;
        if (weich !== null) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "minor", stichwort: weich, eintrag: String(e).slice(0, 80) });
          continue;
        }
        nachher.push(e);
      }
      /* Kappen erst NACH dem Filter, nur die Werbung (siehe WERBE_ANZAHL).
         Die Trigger sind Erklaersaetze und bleiben vollstaendig. */
      let ergebnis = nachher;
      if (feld === "ad_targeting" && ergebnis.length > WERBE_ANZAHL) {
        ergebnis = ergebnis.slice(0, WERBE_ANZAHL);
        bericht.gekappt.push({ modus, feld, von: nachher.length, auf: WERBE_ANZAHL });
      }
      if (ergebnis.length !== vorher.length) p[feld] = ergebnis;
    }
    bericht.werbung[modus] = Array.isArray(p.ad_targeting) ? p.ad_targeting.length : null;

    /* ── Fliesstext: nur melden, nicht entfernen ────────────────────────
       SEC-001: Der Filter fasste nur zwei von rund fuenfzehn Textfeldern an.
       Derselbe String "OnlyFans" wurde in ad_targeting entfernt und in
       profileText ausgeliefert — auch die altersunabhaengige Stufe.
       Hier wird bewusst NICHT entfernt: Ein herausgeschnittener Halbsatz macht
       den Text unlesbar, und der Profiltext ist die Stelle, an der die
       Aufklaerung stattfindet. Stattdessen wird der Durchrutscher gemeldet,
       damit er im Log sichtbar wird und man dem Prompt nachgehen kann. */
    const fliesstext = [["profileText", p.profileText]];
    for (const [key, kat] of Object.entries(p.categories || {})) {
      if (kat && typeof kat.value === "string") fliesstext.push([`categories.${key}`, kat.value]);
    }
    for (const [feld, text] of fliesstext) {
      if (typeof text !== "string" || !text) continue;
      const hart = stichwort(IMMER_VERBOTEN, text);
      const weich = hart === null && minderjaehrig ? stichwort(NUR_MINDERJAEHRIG, text) : null;
      if (hart !== null) bericht.durchgerutscht.push({ modus, feld, grund: "immer", stichwort: hart });
      else if (weich !== null) bericht.durchgerutscht.push({ modus, feld, grund: "minor", stichwort: weich });
    }
  }

  return bericht;
}

module.exports = {
  applyMinorSafety,
  WERBE_ANZAHL,
  WERBE_ANFORDERUNG,
  /* Für Tests */
  _istImmerVerboten: istImmerVerboten,
  _istBeiMinderjaehrigenVerboten: istBeiMinderjaehrigenVerboten,
  _untereAltersgrenze: untereAltersgrenze,
  _SCHUTZ_BIS: SCHUTZ_BIS,
  hatAltersPlatzhalter,
  istAlterUnlesbar,
  hatLesbaresAlter,
  alterNichtLesbarText,
  ohneZiffernKlammern,
  SCHUTZ_ALTER: SCHUTZ_BIS - 1,
};
