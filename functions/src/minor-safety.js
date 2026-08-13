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
 *      erkennbar Minderjährigen. Bei Erwachsenen sind sie legitimer
 *      Lerninhalt — wie diese Branchen Menschen adressieren, IST das Thema.
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

   VEREINBARTE REGEL (bewusste Entscheidung, 2026-08-11): Stufe 2 greift,
   wenn die UNTERGRENZE der geschaetzten Spanne 18 oder darunter ist. Nicht
   der Punktwert zaehlt, sondern das juengste Alter, das die Angabe zulaesst —
   wer laut Modell "17-24" sein koennte, wird geschuetzt; wer laut Modell
   fruehestens 19 ist, nicht.

   Die beiden Beispiele aus der Entscheidung:
     Spanne 17-24, Schaetzwert 21  →  Filter greift       (Untergrenze 17)
     Spanne 19-21, Schaetzwert 20  →  Filter greift nicht (Untergrenze 19)

   Bis zum 2026-08-11 lag auf der Untergrenze zusaetzlich ein Abstand von
   3 Jahren (Schutz bis unter 21). Das entsprach nicht der Vereinbarung und
   ist entfernt. Bewusst getragene Folge: Ein real minderjaehriges Kind,
   dessen Spanne komplett ueber 18 geschaetzt wird, faellt aus Stufe 2.
   Stufe 1 (Pornografie, Waffen, Extremismus) bleibt davon unberuehrt und
   gilt altersunabhaengig fuer alle. */
const VOLLJAEHRIG_AB = 18;
/* „Untergrenze ≤ 18" als strikter Vergleich geschrieben: untergrenze < 19. */
const SCHUTZ_BIS = VOLLJAEHRIG_AB + 1;

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

/* Stufe 2 gilt nur fuer WERBUNG (ad_targeting) und nur bei Minderjaehrigen.
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

function istImmerVerboten(eintrag) {
  const s = String(eintrag || "");
  return IMMER_VERBOTEN.some((re) => re.test(s));
}

function istBeiMinderjaehrigenVerboten(eintrag) {
  const s = String(eintrag || "");
  return NUR_MINDERJAEHRIG.some((re) => re.test(s));
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
  const s = String(text || "").toLowerCase();
  const plausibel = (n) => Number.isFinite(n) && n >= 1 && n <= 100;
  const kandidaten = [];

  /* Spannen zuerst — "12-16", "12–16", "12 bis 16". Die Untergrenze zählt. */
  for (const m of s.matchAll(/\b(\d{1,2})\s*(?:[-–—]|bis)\s*(\d{1,2})\b/g)) {
    const von = Number(m[1]);
    const nach = Number(m[2]);
    if (plausibel(von) && plausibel(nach) && nach >= von) kandidaten.push(von);
  }

  /* Dazu jede freistehende Zahl — deckt Punktwerte wie "~14" und "40 Jahre"
     ab. Bei einer Spanne findet das ohnehin dieselbe Untergrenze noch einmal. */
  for (const roh of s.match(/\b\d{1,2}\b/g) || []) {
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
  const bericht = { applied: false, alter: null, entfernt: [], durchgerutscht: [], lang: opts.lang || null };
  if (!profiles || typeof profiles !== "object") return bericht;

  /* Alter aus dem Profil selbst holen — die Karte alter_geschlecht wird
     server-seitig aus hard_facts überschrieben und ist deshalb verlässlich. */
  const quelle =
    opts.alterText ||
    profiles.normal?.categories?.alter_geschlecht?.value ||
    profiles.boost?.categories?.alter_geschlecht?.value ||
    "";
  const untergrenze = untereAltersgrenze(quelle);
  bericht.alter = untergrenze;

  /* "Koennte minderjaehrig sein", nicht "ist es wahrscheinlich". Siehe die
     Begruendung bei SCHUTZ_BIS oben. */
  const minderjaehrig = untergrenze !== null && untergrenze < SCHUTZ_BIS;
  bericht.minderjaehrig = minderjaehrig;

  /* Ist kein Alter erkennbar, wird NICHT als minderjaehrig behandelt — sonst
     verloere man bei Erwachsenen legitime Inhalte (Kredit, Wein, Wellness sind
     dort Teil der Aufklaerung). Die harte Liste greift trotzdem. */
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
        if (istImmerVerboten(e)) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "immer", eintrag: String(e).slice(0, 80) });
          continue;
        }
        if (mitAltersstufe && minderjaehrig && istBeiMinderjaehrigenVerboten(e)) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "minor", eintrag: String(e).slice(0, 80) });
          continue;
        }
        nachher.push(e);
      }
      if (nachher.length !== vorher.length) p[feld] = nachher;
    }

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
      const grund = istImmerVerboten(text)
        ? "immer"
        : minderjaehrig && istBeiMinderjaehrigenVerboten(text)
          ? "minor"
          : null;
      if (grund) bericht.durchgerutscht.push({ modus, feld, grund });
    }
  }

  return bericht;
}

module.exports = {
  applyMinorSafety,
  /* Für Tests */
  _istImmerVerboten: istImmerVerboten,
  _istBeiMinderjaehrigenVerboten: istBeiMinderjaehrigenVerboten,
  _untereAltersgrenze: untereAltersgrenze,
  _VOLLJAEHRIG_AB: VOLLJAEHRIG_AB,
  _SCHUTZ_BIS: SCHUTZ_BIS,
};
