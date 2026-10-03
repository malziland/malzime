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
   Sie faengt, was in ihr steht, nicht jede Werbung zu einem Thema. Was sie
   haelt, zeigt die Pruefreihe in __tests__/minor-safety-woerter.test.js: je
   Thema deutsche und englische Woerter, die gefangen werden muessen, und
   harmlose, die nicht gefangen werden duerfen. Jedes Listenwort braucht dort
   ein Beispiel, sonst wird der Test rot.

   SCHREIBWEISE: klein, durch Komma getrennt.
     wort    nur als ganzes Wort           ("gin" trifft nicht "beginnen")
     wort*   Wortanfang, darf weitergehen  ("porn*" trifft "Pornoseite")
     *wort   Wortende                      ("*wetten" trifft "Pferdewetten")
     *wort*  ueberall im Wort              ("*kredit*" trifft "Sofortkredit")
   Ein Leerzeichen passt auf zusammen, getrennt und mit Bindestrich ("sex
   shop*" trifft "Sexshop", "Sex Shop", "Sex-Shop"), ein Umlaut auch auf
   ae/oe/ue. Kurze Woerter stehen als ganzes Wort da: "Wetter" ist keine
   Wette, "Schwein" kein Wein, "Insekt" kein Sekt, "Waffel" keine Waffe.

   NUR ALS WERBUNG: Woerter, die als Werbe-Eintrag (ein bis drei Woerter)
   eindeutig sind, im ganzen Satz aber meist etwas anderes heissen ("deine
   staerkste Waffe", "wir raten dir", "on the far right"). Sie gelten nur
   fuer ad_targeting, nicht fuer Erklaersaetze und Fliesstext. */
const PORNOGRAFIE = `*onlyfans*, *fansly*, *bestfans*, *xhamster*, *youporn*, *xvideos*, xnxx, *brazzers*,
  *stripchat*, *chaturbate*, *mydirtyhobby*, *joyclub*, *amorelie*, beate uhse, eis.de, porn*, *porno*, *erotik*,
  erotic*, *cam girl*, adult webcam*, *sexcam*, sex cam*, *sexshop*, sex shop*, sex toy*, *sexspielzeug*,
  *telefonsex*, phone sex, *cybersex*, *sexarbeit*, sex work*, *sexfilm*, *sexkino*, *sexdate*, *sexpuppe*, sex doll*,
  sex chat*, *prostitu*, call girl*, *escort*, *bordell*, *brothel*, strip club*, striptease*, *hentai*, xxx video*,
  xxx film*, sugar daddy*, sugar babe*, sugar baby*, sugar dating`;
const WAFFEN = `*schusswaffe*, *feuerwaffe*, *jagdwaffe*, *kriegswaffe*, *stichwaffe*, *hiebwaffe*, *gaswaffe*,
  *luftdruckwaffe*, *waffenhandel*, waffenladen*, waffenshop*, waffengeschäft*, waffenhändler*, waffenschein*,
  waffenbörse*, waffenzubehör*, waffenbesitz*, waffenschrank*, waffensammlung*, *munition*, pistole, pistolen,
  luftpistole*, gaspistole*, maschinenpistole*, *softair*, *airsoft*, *schreckschuss*, *gewehr, *gewehre, *gewehren,
  *gewehrs, revolver, revolvers, shotgun*, pistol, gun, guns, *handgun*, rifle*, *firearm*, ammo, *silencer*,
  schalldämpfer*, *kampfmesser*, *springmesser*, butterfly messer*, *wurfmesser*, *einhandmesser*, combat knife*,
  *schlagring*, brass knuckle*, knuckle duster*, *schlagstock*, *elektroschocker*, taser*, *pfefferspray*,
  pepper spray*, armbrust*, crossbow*, *handgranate*, hand grenade*, *kalaschnikow*, ak 47, ar 15, glock, glocks,
  heckler koch, sig sauer, smith wesson, walther ppk`;
const EXTREMISMUS = `*extremis*, *rechtsextrem*, *linksextrem*, *rechtsradikal*, nazi, nazis, nazism*, nazisymbol*,
  naziparole*, nazipropaganda*, *neonazi*, terror*, *terrorism*, *terrorist*, white supremac*, thor steinar,
  *reichsbürger*, identitäre bewegung, islamism*, islamist*, *dschihad*, jihad*, salafis*, *hakenkreuz*, swastika*,
  ku klux klan`;
const IMMER_NUR_ALS_WERBUNG = `only fans, sexting*, waffen*, *waffen, *waffe, weapon*, far right, alt right`;

/* Stufe 2 gilt nur fuer WERBUNG (ad_targeting) und nur bei moeglicherweise
   Minderjaehrigen (Untergrenze bis SCHUTZ_BIS, siehe oben).
   Fuer die Manipulations-Trigger wird sie bewusst NICHT angewandt — siehe
   applyMinorSafety. */
const WETTEN = `*bet365*, *tipico*, bwin, *betano*, *winamax*, *tipp3*, win2day, novomatic, novoline, pokerstars,
  betway, unibet, *casino*, *kasino*, *jackpot*, *sportwetten*, *glücksspiel*, *wettanbieter*, *buchmacher*,
  *kombiwette*, sportwette, livewette, wettbüro*, wettschein*, wettbonus*, wettquote*, wetteinsatz*, wettkonto*,
  wettportal*, wettlokal*, wetttipp*, wettapp*, wett, *wetten, *gambling*, *betting*, *bookmaker*, bookie*,
  slot machine*, poker, bet, bets, wager*, lotto*, *lotterie*, lottery*, euromillionen, euromillions, rubbellos*,
  scratch card*, roulette, *spielautomat*, automatenspiel*, spielbank*, spielhalle*, spielothek*`;
const KREDIT = `*kredit*, *darlehen*, *ratenkauf*, *ratenzahlung*, ratenplan*, monatsrate*, *teilzahlung*,
  *finanzierung*, *financing*, klarna, *riverty*, *afterpay*, *cashper*, ratepay, *auxmoney*, *smava*, *vexcash*,
  *schufa*, *inkasso*, *leasing*, *mikrofinanz*, dispo, *überziehung*, overdraft*, schulden*, *umschuldung*, debt,
  debts, *hypothek*, *mortgage*, kauf auf rechnung, rechnungskauf*, loan, loans, *payday*, installment*, instalment*,
  buy now pay later, pay later, bnpl, credit card*`;
const ALKOHOL = `*alkohol*, *alcohol*, *alkopop*, *alcopop*, bier*, weißbier*, weizenbier*, dosenbier*, flaschenbier*,
  fassbier*, freibier*, starkbier*, bockbier*, altbier*, craftbier*, kellerbier*, lagerbier*, weinabo*, weinprobe*,
  weinverkostung*, weinhandel*, weinhandlung*, weinkeller*, weingut*, weinflasche*, weinshop*, weinladen*, weinbar*,
  weinpaket*, weinclub*, weinfest*, weinschorle*, weinkühlschrank*, weinregal*, weinkenner*, weinliebhaber*,
  weinreise*, weinlieferung*, weinversand*, weintasting*, weinkarte*, weinglas*, weingläser*, weinviertel dac,
  winzer*, vinothek*, *wein, *rotwein*, *weißwein*, *glühwein*, *sekt, sektflasche*, sektglas*, sektempfang*,
  sektkellerei*, *prosecco*, champagner*, champagne, *aperol*, spritz, campari, gin, *tequila*, *cocktail*,
  *spirituose*, *vodka*, *wodka*, *whisky*, *whiskey*, schnaps*, *schnaps, *likör*, liqueur*, weinbrand*, obstler,
  grappa, ouzo, sambuca, absinth*, cider, hard seltzer, brauerei*, brewery*, brennerei*, distillery*, destillerie*,
  winery*, beer, beers, wine, wines, liquor, liquors, booze, *jägermeister*, stiegl, gösser, heineken, corona extra,
  bacardi, captain morgan, smirnoff*, jack daniel*, jim beam, johnnie walker, baileys`;
const TABAK = `*zigarett*, *zigarre*, *zigarillo*, *tabak*, *tobacco*, *cigarette*, cigar, cigars, *nikotin*,
  *nicotine*, snus, vape*, vaping, *shisha*, wasserpfeife*, hookah*, rauchen, raucher*, marlboro, lucky strike,
  gauloises, pall mall, elf bar, lost mary, iqos, vuse, juul, heets, zyn`;
const SCHOENHEIT = `*botox*, *hyaluron*, filler, fillers, lip filler*, lip injection*, schönheits op*,
  schönheitschirurg*, schönheitskorrektur*, schönheitsklinik*, schönheitseingriff*, beauty op, beauty ops,
  beauty operation*, beauty korrektur*, plastische chirurgie, plastic surgery, cosmetic surgery, cosmetic procedure*,
  *fettabsaug*, fettweg spritze*, *brustvergrößer*, brustverkleinerung*, bruststraffung*, brust op, brustoperation*,
  nasen op, nasenoperation*, *nasenkorrektur*, lippen aufspritz*, *unterspritzung*, facelift*, lidstraffung*,
  *haartransplantation*, hair transplant*, breast augmentation, breast enlargement*, boob job*, nose job*,
  rhinoplast*, tummy tuck*, *liposuction*`;
const DIAET = `diät*, *diät, dieting, diet pill*, abnehm, abnehmspritze*, abnehmcoaching*, abnehmkur*, abnehmpille*,
  abnehmprogramm*, abnehmapp*, abnehmshake*, abnehmtablette*, abnehmtee*, abnehmplan*, abnehmprodukt*, abnehmmittel*,
  *ozempic*, *wegovy*, *mounjaro*, *almased*, *slimfast*, weight watchers, noom, yazio, shape shake*, kalorienzähler*,
  calorie count*, intervallfasten*, intermittent fasting, detox kur*, detox tee*, *appetitzügler*, fat burner*,
  schlankheits*, slimming*, weight loss*, lose weight, appetite suppressant*, gewichtsverlust*, gewichtsabnahme*,
  gewichtsreduktion*`;
const MINOR_NUR_ALS_WERBUNG = `*wette, admiral, stake, slots, raten*, später bezahlen, später zahlen, weine, rum,
  radler, spritzer, ottakringer, spirits, velo, diet, abnehmen`;

/* Harmlose Wendungen, in denen ein Listenwort steckt. Sie werden vor dem
   Vergleich aus dem Text genommen. */
const HARMLOS_WOERTER = `guns n roses, top gun, machine gun kelly, massage gun*, nerf gun*, water gun*, glue gun*,
  ford escort, terrorvogel*, terrorvögel*, terrorzwerg*, terrorisier*, terroriz*, terrorise, terrorised, terrorises,
  terrorising, geheimwaffe*, wunderwaffe*, allzweckwaffe*, *pleasing*, *releasing*, cocktailkleid*, schnapsidee*,
  schnapszahl*, schnapsen, schnapskarte*, bierernst*, biereif*, *schwein, *insekt, kindersekt*, champagnerfarb*,
  akkreditier*, *diskreditier*, stocking filler*`;

/* Text vor dem Vergleich vereinheitlichen: Gross/Klein, Umlaute und ß,
   zerlegte und Vollbreite-Zeichen, unsichtbare Trennzeichen (Cf), Akzente;
   Bindestriche (Pd), Schraegstrich, "&" und Leerraum werden ein Leerzeichen. */
const UMLAUT = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
function vereinheitlicht(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Cf}'`´‘’]/gu, "")
    .replace(/[äöüß]/g, (z) => UMLAUT[z])
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[\s\p{Pd}_/&]+/gu, " ");
}

/* Ein Listeneintrag als Suchmuster ueber dem vereinheitlichten Text. */
function muster(wort) {
  const kern = wort
    .replace(/\*/g, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[äöüß]/g, (z) => UMLAUT[z])
    .replace(/ /g, " ?");
  return `${wort.startsWith("*") ? "" : "(?<![a-z0-9])"}${kern}${wort.endsWith("*") ? "" : "(?![a-z0-9])"}`;
}
const woerter = (text) => text.split(/\s*,\s*/).filter(Boolean);
const suche = (liste, schalter) => new RegExp(liste.map(muster).join("|"), schalter);
const HARMLOS = suche(woerter(HARMLOS_WOERTER), "g");

/* satz: gilt ueberall. werbung: dazu die Woerter "nur als Werbung". */
function sperrliste(ueberall, nurAlsWerbung) {
  const liste = { ueberall: woerter(ueberall.join(",")), nurAlsWerbung: woerter(nurAlsWerbung) };
  return { ...liste, satz: suche(liste.ueberall), werbung: suche([...liste.ueberall, ...liste.nurAlsWerbung]) };
}

/* IMMER_VERBOTEN gilt fuer alle, NUR_MINDERJAEHRIG nur bis SCHUTZ_BIS. */
const IMMER_VERBOTEN = sperrliste([PORNOGRAFIE, WAFFEN, EXTREMISMUS], IMMER_NUR_ALS_WERBUNG);
const NUR_MINDERJAEHRIG = sperrliste([WETTEN, KREDIT, ALKOHOL, TABAK, SCHOENHEIT, DIAET], MINOR_NUR_ALS_WERBUNG);

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
  const m = (alsWerbung ? liste.werbung : liste.satz).exec(vereinheitlicht(eintrag).replace(HARMLOS, " "));
  return m ? m[0].trim().slice(0, 30) : null;
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
  _SPERRLISTEN: { immer: IMMER_VERBOTEN, minor: NUR_MINDERJAEHRIG, harmlos: woerter(HARMLOS_WOERTER) },
  _untereAltersgrenze: untereAltersgrenze,
  _SCHUTZ_BIS: SCHUTZ_BIS,
  SCHUTZ_ALTER: SCHUTZ_BIS - 1,
};
