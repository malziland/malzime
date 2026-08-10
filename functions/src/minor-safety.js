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
 * ZWEI STUFEN (Entscheidung des Inhabers, 2026-08-10):
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

/* Altersgrenze. Bezieht sich auf die Schätzung des Modells, nicht auf Wahrheit. */
const VOLLJAEHRIG_AB = 18;

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

const IMMER_VERBOTEN = [
  /* Pornografie und Sexarbeit */
  /onlyfans|fansly|pornhub|xhamster|camgirl|cam-?girl|escort|bordell|erotikportal|sexshop|sexcam/i,
  /* Gewaltverherrlichung, Waffen, Extremismus */
  /schusswaffe|munition|waffenhandel|glock|kalaschnikow|ar-?15|schlagring|butterflymesser/i,
  /extremis|rechtsradikal|neonazi|terror/i,
];

const NUR_MINDERJAEHRIG = [
  /* Gluecksspiel und Sportwetten */
  /bet365|tipico|bwin|betano|winamax|lottoland|casino|jackpot|sportwetten|gl[uü]cksspiel/i,
  /* Kredit und Ratenfinanzierung */
  /\bkredit|darlehen|ratenkauf|ratenzahlung|klarna|schufa|inkasso|leasing/i,
  /* Alkohol und Tabak */
  /\bbier\b|\bwein\b|vodka|whisky|spirituose|zigarett|vape|e-?shisha|nikotin/i,
  /* Schoenheitskorrektur */
  /botox|filler|sch[oö]nheits-?op|fettabsaug|brustvergr[oö]ss|lippenaufspritz/i,
  /* Diaet- und Abnehmindustrie */
  /di[aä]tpille|abnehmspritze|ozempic|appetitz[uü]gler|fatburner|schlankheitsmittel/i,
];

function istImmerVerboten(eintrag) {
  const s = String(eintrag || "");
  return IMMER_VERBOTEN.some((re) => re.test(s));
}

function istBeiMinderjaehrigenVerboten(eintrag) {
  const s = String(eintrag || "");
  return NUR_MINDERJAEHRIG.some((re) => re.test(s));
}

/* Alter aus dem hard-facts-Text lesen. Gleiche Heuristik wie in den
   Messwerkzeugen: bevorzugt den Punktwert ("~14"), sonst die erste Zahl. */
function geschaetztesAlter(text) {
  const s = String(text || "").toLowerCase();
  const punkt = s.match(/~\s*(\d{1,2})/);
  if (punkt) return Number(punkt[1]);
  const zahlen = (s.match(/\b(\d{1,2})\b/g) || []).map(Number).filter((n) => n >= 1 && n <= 100);
  return zahlen.length ? zahlen[0] : null;
}

/**
 * Prüft ein fertiges Profil-Paar und entfernt unzulässige Werbe- und
 * Trigger-Einträge, wenn die Person als minderjährig eingestuft wurde.
 *
 * Verändert `profiles` in-place und gibt einen Bericht zurück — der Aufrufer
 * kann daraus loggen, ohne dass hier Log-Abhängigkeiten entstehen.
 */
function applyMinorSafety(profiles, opts = {}) {
  const bericht = { applied: false, alter: null, entfernt: [] };
  if (!profiles || typeof profiles !== "object") return bericht;

  /* Alter aus dem Profil selbst holen — die Karte alter_geschlecht wird
     server-seitig aus hard_facts überschrieben und ist deshalb verlässlich. */
  const quelle =
    opts.alterText ||
    profiles.normal?.categories?.alter_geschlecht?.value ||
    profiles.boost?.categories?.alter_geschlecht?.value ||
    "";
  const alter = geschaetztesAlter(quelle);
  bericht.alter = alter;

  const minderjaehrig = alter !== null && alter < VOLLJAEHRIG_AB;
  bericht.minderjaehrig = minderjaehrig;

  /* Ist kein Alter erkennbar, wird NICHT als minderjaehrig behandelt — sonst
     verloere man bei Erwachsenen legitime Inhalte (Kredit, Wein, Wellness sind
     dort Teil der Aufklaerung). Die harte Liste greift trotzdem. */
  for (const modus of ["normal", "boost"]) {
    const p = profiles[modus];
    if (!p) continue;
    for (const feld of ["ad_targeting", "manipulation_triggers"]) {
      if (!Array.isArray(p[feld])) continue;
      const vorher = p[feld];
      const nachher = [];
      for (const e of vorher) {
        if (istImmerVerboten(e)) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "immer", eintrag: String(e).slice(0, 80) });
          continue;
        }
        if (minderjaehrig && istBeiMinderjaehrigenVerboten(e)) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "minor", eintrag: String(e).slice(0, 80) });
          continue;
        }
        nachher.push(e);
      }
      if (nachher.length !== vorher.length) p[feld] = nachher;
    }
  }

  return bericht;
}

module.exports = {
  applyMinorSafety,
  /* Für Tests */
  _istImmerVerboten: istImmerVerboten,
  _istBeiMinderjaehrigenVerboten: istBeiMinderjaehrigenVerboten,
  _geschaetztesAlter: geschaetztesAlter,
  _VOLLJAEHRIG_AB: VOLLJAEHRIG_AB,
};
