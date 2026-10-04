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
 *   2. Glücksspiel, Kredit, Alkohol, Tabak, Schönheits-OP, Diätmittel und
 *      Drogen nur bei möglicherweise Minderjährigen — mit Sicherheitspuffer,
 *      siehe Altersgrenze unten. Bei Erwachsenen sind sie legitimer
 *      Lerninhalt — wie diese Branchen Menschen adressieren, IST das Thema.
 *      (Drogen seit der Entscheidung vom 04.10.2026: wie Alkohol.)
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
   beginnt, bekommen keine Kredit-, Wett-, Alkohol-, Tabak-, Schoenheits-OP-,
   Diaet- und Drogen-Ideen. Stufe 1 (Pornografie, Waffen, Extremismus) gilt
   unveraendert fuer alle. */
const VOLLJAEHRIG_AB = 18;
/* BLEIBT IM CODE — Kinderschutz-Regel, keine Betriebseinstellung. Wer den
   Puffer aendert, aendert die Entscheidung vom 17.09.2026; das geht nur mit
   Test und Deploy, nicht per Datenbankeintrag. */
const PUFFER_JAHRE = 7;
/* „Untergrenze ≤ 25" als strikter Vergleich geschrieben: untergrenze < 26. */
const SCHUTZ_BIS = VOLLJAEHRIG_AB + PUFFER_JAHRE + 1;

/* Nicht lesbares Alter und Altersauslese: alters-lesbarkeit.js (seit
   17.09.2026 eigene Datei — reine Textpruefung, die auch mistral.js und die
   Live-Anzeige brauchen). */
const { untereAltersgrenze, obereAltersgrenze, istAlterUnlesbar } = require("./alters-lesbarkeit");

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

/* ── Die Sperrliste ist eine Wortliste (SEC-2026-10-03-01) ────────────────
   Sie faengt, was in ihr steht, nicht jede Werbung zu einem Thema. Die Listen
   stehen als Daten in minor-safety-woerter.js, dort auch die Schreibweise der
   Eintraege und die Regel "nur als Werbung". Hier steht, wie sie angewandt
   werden.

   Stufe 2 gilt nur fuer WERBUNG (ad_targeting) und nur bei moeglicherweise
   Minderjaehrigen (Untergrenze bis SCHUTZ_BIS, siehe oben).
   Fuer die Manipulations-Trigger wird sie bewusst NICHT angewandt — siehe
   applyMinorSafety. */
const WOERTER = require("./minor-safety-woerter");

/* Text vor dem Vergleich vereinheitlichen: Gross/Klein, Umlaute und ß,
   zerlegte und Vollbreite-Zeichen, unsichtbare Trennzeichen (Cf), Akzente;
   Bindestriche (Pd), Schraegstrich, "&" und Leerraum werden ein Leerzeichen. */
const UMLAUT = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const grundform = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Cf}'`´‘’]/gu, "")
    .replace(/[äöüß]/g, (z) => UMLAUT[z])
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\p{Pd}+/gu, "-");
const trennerAlsLeerzeichen = (s) => s.replace(/[\s\-_/&]+/g, " ");
const vereinheitlicht = (text) => trennerAlsLeerzeichen(grundform(text));

/* Ein Bindestrich im Wort aendert nichts: Jeder Text wird auch so gelesen,
   als stuende der Bindestrich nicht da ("Soft-Air" als "softair"). Die erste
   Sicht ist die gewohnte (Bindestrich als Leerzeichen: "Gin-Tonic" trifft
   "gin"). Bis zu drei Bindestriche werden einzeln durchgespielt, damit auch
   "Soft-Air-Pistole" und "Na-zi-Shirt" treffen; bei mehr gibt es zwei
   Sichten: alle als Leerzeichen, alle weggelassen. */
const BINDESTRICH_IM_WORT = /(?<=[a-z0-9])-(?=[a-z0-9])/g;
/* BLEIBT IM CODE — Teil der Kinderschutz-Regel, kein Betriebswert: Die Zahl
   bestimmt, was der Filter faengt, und begrenzt die Sichten je Text auf acht.
   Sie aendert sich nur mit Test und Deploy. */
const EINZELN_BIS = 3;
function sichten(text) {
  const roh = grundform(text);
  const stellen = [...roh.matchAll(BINDESTRICH_IM_WORT)].map((m) => m.index);
  const anzahl = stellen.length === 0 ? 1 : stellen.length <= EINZELN_BIS ? 2 ** stellen.length : 2;
  const aus = [];
  for (let wahl = 0; wahl < anzahl; wahl++) {
    const zeichen = [...roh];
    stellen.forEach((stelle, i) => {
      if (anzahl === 2 ? wahl === 1 : (wahl >> i) & 1) zeichen[stelle] = "";
    });
    aus.push(trennerAlsLeerzeichen(zeichen.join("")));
  }
  return aus;
}

/* Ein Listeneintrag als Suchmuster ueber dem vereinheitlichten Text.
   - Ein Leerzeichen im Eintrag steht zwischen zwei Woertern einer festen
     Fuegung ("pall mall"): Dort darf nichts oder ein Leerzeichen stehen — in
     jeder Sicht.
   - Ein "+" im Eintrag ist die Wortfuge einer Zusammensetzung
     ("miet+kauf"): zusammen ueberall, getrennt ("Miet Kauf") nur als
     Werbe-Eintrag. Im Fliesstext stehen dieselben zwei Woerter oft
     zufaellig nebeneinander ("Sex spielt keine Rolle").
   Leerzeichen an beliebiger Stelle zu ueberbruecken, traefe Alltagstext
   ("Islam ist", "Code in"); deshalb notiert die Liste die Wortfugen. */
function musterMitFuge(wort, fuge) {
  const kern = wort
    .replace(/\*/g, "")
    .replace(/[.?^${}()|[\]\\]/g, "\\$&")
    .replace(/[äöüß]/g, (z) => UMLAUT[z])
    .replace(/ /g, " ?")
    .replace(/\+/g, fuge);
  return `${wort.startsWith("*") ? "" : "(?<![a-z0-9])"}${kern}${wort.endsWith("*") ? "" : "(?![a-z0-9])"}`;
}
/* muster: als Werbe-Eintrag (und fuer harmlose Wendungen). musterImSatz: im
   Fliesstext und in Erklaersaetzen. */
const muster = (wort) => musterMitFuge(wort, " ?");
const musterImSatz = (wort) => musterMitFuge(wort, "");
const woerter = (text) => text.split(/\s*,\s*/).filter(Boolean);
const suche = (liste, schalter, alsMuster = muster) => new RegExp(liste.map((w) => alsMuster(w)).join("|"), schalter);
const HARMLOS = suche(woerter(WOERTER.HARMLOS), "g");

/* satz: gilt ueberall. werbung: dazu die Woerter "nur als Werbung". */
function sperrliste(ueberall, nurAlsWerbung) {
  const liste = { ueberall: woerter(ueberall.join(",")), nurAlsWerbung: woerter(nurAlsWerbung) };
  return {
    ...liste,
    satz: suche(liste.ueberall, undefined, musterImSatz),
    werbung: suche([...liste.ueberall, ...liste.nurAlsWerbung]),
  };
}

/* IMMER_VERBOTEN gilt fuer alle, NUR_MINDERJAEHRIG nur bis SCHUTZ_BIS. */
const IMMER_VERBOTEN = sperrliste(WOERTER.IMMER.ueberall, WOERTER.IMMER.nurAlsWerbung);
const NUR_MINDERJAEHRIG = sperrliste(WOERTER.MINOR.ueberall, WOERTER.MINOR.nurAlsWerbung);

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

/* Liefert das erste Wort der Liste, das im Text steht: nur das Wort selbst,
   klein geschrieben, hoechstens 30 Zeichen. Kein Satz, kein Kontext. Das Log
   soll sagen "wetten" oder "cocktail", nicht, was ueber die Person geschrieben
   wurde — so bleibt die Diagnose ohne Personenbezug.
   alsWerbung: Der Text ist ein Werbe-Eintrag; dann gelten auch die Woerter
   "nur als Werbung". */
function stichwort(liste, eintrag, alsWerbung = false) {
  const suchmuster = alsWerbung ? liste.werbung : liste.satz;
  for (const sicht of sichten(eintrag)) {
    const m = suchmuster.exec(sicht.replace(HARMLOS, " "));
    if (m) return m[0].trim().slice(0, 30);
  }
  return null;
}

const istImmerVerboten = (eintrag, alsWerbung = true) => stichwort(IMMER_VERBOTEN, eintrag, alsWerbung) !== null;
const istBeiMinderjaehrigenVerboten = (eintrag, alsWerbung = true) =>
  stichwort(NUR_MINDERJAEHRIG, eintrag, alsWerbung) !== null;

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
    alterBis: null,
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
  /* Nur fuer die Auswertung, siehe obereAltersgrenze — entscheidet nichts. */
  bericht.alterBis = obereAltersgrenze(quelle);
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
        const hart = stichwort(IMMER_VERBOTEN, e, feld === "ad_targeting");
        if (hart !== null) {
          bericht.applied = true;
          bericht.entfernt.push({ modus, feld, grund: "immer", stichwort: hart, eintrag: String(e).slice(0, 80) });
          continue;
        }
        const weich = mitAltersstufe && minderjaehrig ? stichwort(NUR_MINDERJAEHRIG, e, true) : null;
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
  _vereinheitlicht: vereinheitlicht,
  _muster: muster,
  _SPERRLISTEN: { immer: IMMER_VERBOTEN, minor: NUR_MINDERJAEHRIG, harmlos: woerter(WOERTER.HARMLOS) },
  _untereAltersgrenze: untereAltersgrenze,
  _SCHUTZ_BIS: SCHUTZ_BIS,
  SCHUTZ_ALTER: SCHUTZ_BIS - 1,
};
