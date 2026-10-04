"use strict";

/**
 * minor-safety-woerter.js — die Wortlisten des Kinderschutz-Filters.
 *
 * REINE DATEN. Wie die Listen angewandt werden (Stufen, Altersgrenze,
 * Felder), steht in minor-safety.js. Herausgeloest am 04.10.2026: Die Listen
 * wachsen, die Regeln des Filters nicht.
 *
 * Der Filter ist eine Wortliste: Er faengt, was hier steht, nicht jede
 * Werbung zu einem Thema. Was die Listen halten, zeigt die Pruefreihe in
 * __tests__/minor-safety-woerter.test.js: je Thema deutsche und englische
 * Woerter, die gefangen werden muessen, und harmlose, die nicht gefangen
 * werden duerfen. Jedes Listenwort braucht dort ein Beispiel, sonst wird der
 * Test rot.
 *
 * SCHREIBWEISE: klein, durch Komma getrennt.
 *   wort    nur als ganzes Wort           ("gin" trifft nicht "beginnen")
 *   wort*   Wortanfang, darf weitergehen  ("porn*" trifft "Pornoseite")
 *   *wort   Wortende                      ("*wetten" trifft "Pferdewetten")
 *   *wort*  ueberall im Wort              ("*kredit*" trifft "Sofortkredit")
 * Ein Leerzeichen passt auf zusammen, getrennt und mit Bindestrich ("sex
 * shop*" trifft "Sexshop", "Sex Shop", "Sex-Shop"), ein Umlaut auch auf
 * ae/oe/ue. Kurze Woerter stehen als ganzes Wort da: "Wetter" ist keine
 * Wette, "Schwein" kein Wein, "Insekt" kein Sekt, "Waffel" keine Waffe.
 *
 * NUR ALS WERBUNG: Woerter, die als Werbe-Eintrag (ein bis drei Woerter)
 * eindeutig sind, im ganzen Satz aber meist etwas anderes heissen ("deine
 * staerkste Waffe", "wir raten dir", "on the far right"). Sie gelten nur
 * fuer ad_targeting, nicht fuer Erklaersaetze und Fliesstext.
 */

/* ── Stufe 1: gilt fuer alle ──────────────────────────────────────────── */
const PORNOGRAFIE = `*onlyfans*, *fansly*, *bestfans*, *xhamster*, *youporn*, *xvideos*, xnxx, *brazzers*,
  *stripchat*, *chaturbate*, *mydirtyhobby*, *joyclub*, *amorelie*, beate uhse, eis.de, porn*, *porno*, *erotik*,
  erotic*, *cam girl*, adult webcam*, *sexcam*, sex cam*, *sexshop*, sex shop*, sex toy*, *sexspielzeug*,
  *telefonsex*, phone sex, *cybersex*, *sexarbeit*, sex work*, *sexfilm*, *sexkino*, *sexdate*, *sexpuppe*, sex doll*,
  sex chat*, *prostitu*, call girl*, *escort*, *bordell*, *brothel*, strip club*, striptease*, *hentai*, xxx video*,
  xxx film*, sugar daddy*, sugar babe*, sugar baby*, sugar dating`;
const WAFFEN = `*schusswaffe*, *feuerwaffe*, *jagdwaffe*, *kriegswaffe*, *stichwaffe*, *hiebwaffe*, *gaswaffe*,
  *luftdruckwaffe*, *waffenhandel*, waffenladen*, waffenshop*, waffengeschäft*, waffenhändler*, waffenschein*,
  waffenbörse*, waffenzubehör*, waffenbesitz*, waffenschrank*, waffensammlung*, *munition*, luftpistole*, gaspistole*,
  maschinenpistole*, *softair*, *airsoft*, *schreckschuss*, shotgun*, gun, guns, *handgun*, rifle*, *firearm*, ammo,
  *silencer*, schalldämpfer*, *kampfmesser*, *springmesser*, butterfly messer*, *wurfmesser*, *einhandmesser*,
  combat knife*, *schlagring*, brass knuckle*, knuckle duster*, *schlagstock*, *elektroschocker*, taser*,
  *pfefferspray*, pepper spray*, armbrust*, crossbow*, *handgranate*, hand grenade*, *kalaschnikow*, ak 47, ar 15,
  glock, glocks, heckler koch, sig sauer, smith wesson, walther ppk`;
const EXTREMISMUS = `*extremis*, *rechtsextrem*, *linksextrem*, *rechtsradikal*, nazi, nazis, nazism*, nazisymbol*,
  naziparole*, nazipropaganda*, *neonazi*, terror*, *terrorism*, *terrorist*, white supremac*, thor steinar,
  *reichsbürger*, identitäre bewegung, islamism*, islamist*, *dschihad*, jihad*, salafis*, *hakenkreuz*, swastika*,
  ku klux klan`;
const IMMER_NUR_ALS_WERBUNG = `only fans, sexting*, waffen*, *waffen, *waffe, weapon*, pistole, pistolen, pistol,
  *gewehr, *gewehre, *gewehren, *gewehrs, revolver, revolvers, far right, alt right`;

/* ── Stufe 2: nur bei moeglicherweise Minderjaehrigen ─────────────────── */
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
const DROGEN = `drogen*, *droge, partydrogen*, designerdrogen*, einstiegsdrogen*, modedrogen*, drugs, rauschgift*,
  rauschmittel*, narcotic*, *cannabis*, cbd, thc, hhc, marihuana*, marijuana*, haschisch*, hashish*, hasch,
  hanfblüte*, ganja, spliff*, kiff*, bekifft*, bong, bongs, head shop*, grow shop*, growbox*, legal high*, lachgas*,
  laughing gas*, mdma, xtc, kokain*, cocaine*, koks, koksen, kokser*, lsd, magic mushroom*, zauberpilz*, psilocybin*,
  shrooms, heroin, crystal meth*, methamphetamin*, amphetamin*, ketamin*`;
const MINOR_NUR_ALS_WERBUNG = `*wette, admiral, stake, slots, raten*, später bezahlen, später zahlen, weine, rum,
  radler, spritzer, ottakringer, spirits, velo, diet, abnehmen, weed, joint, joints, ecstasy, grinder`;

/* Harmlose Wendungen, in denen ein Listenwort steckt. Sie werden vor dem
   Vergleich aus dem Text genommen. */
const HARMLOS_WOERTER = `guns n roses, top gun, machine gun kelly, massage gun*, nerf gun*, water gun*, glue gun*,
  toy gun*, gun metal*, wasser pistole*, nerf pistole*, *klebe pistole*, spritz pistole*, massage pistole*,
  spielzeug pistole*, water pistol*, toy pistol*, wasser gewehr*, nerf gewehr*, spielzeug gewehr*, ford escort,
  terrorvogel*, terrorvögel*, terrorzwerg*, terrorisier*, terroriz*, terrorise, terrorised, terrorises, terrorising,
  geheimwaffe*, wunderwaffe*, allzweckwaffe*, *pleasing*, *releasing*, cocktailkleid*, schnapsidee*, schnapszahl*,
  schnapsen, schnapskarte*, bierernst*, biereif*, *schwein, *insekt, kindersekt*, champagnerfarb*, akkreditier*,
  *diskreditier*, stocking filler*, joint venture*, coffee grinder*, kaffee grinder*, angle grinder*`;

module.exports = {
  IMMER: { ueberall: [PORNOGRAFIE, WAFFEN, EXTREMISMUS], nurAlsWerbung: IMMER_NUR_ALS_WERBUNG },
  MINOR: {
    ueberall: [WETTEN, KREDIT, ALKOHOL, TABAK, SCHOENHEIT, DIAET, DROGEN],
    nurAlsWerbung: MINOR_NUR_ALS_WERBUNG,
  },
  HARMLOS: HARMLOS_WOERTER,
};
