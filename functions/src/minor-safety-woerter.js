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
 * werden duerfen. Jedes Listenwort und jede harmlose Wendung braucht dort ein
 * Beispiel, sonst wird der Test rot.
 *
 * SCHREIBWEISE: klein, durch Komma getrennt.
 *   wort    nur als ganzes Wort           ("gin" trifft nicht "beginnen")
 *   wort*   Wortanfang, darf weitergehen  ("porn*" trifft "Pornoseite")
 *   *wort   Wortende                      ("*wetten" trifft "Pferdewetten")
 *   *wort*  ueberall im Wort              ("*kredit*" trifft "Sofortkredit")
 *   a b     feste Fuegung aus mehreren Woertern ("pall mall", "sex shop*"):
 *           zusammen, mit Bindestrich oder getrennt, in jeder Sicht
 *   a+b     Wortfuge einer Zusammensetzung ("miet+kauf*"): zusammen und mit
 *           Bindestrich ueberall, getrennt ("Miet Kauf") nur als
 *           Werbe-Eintrag
 * Ein Umlaut passt auch auf ae/oe/ue, nicht auf den nackten Vokal
 * ("Glucksspiel" wird nicht gefangen). Kurze Woerter stehen als ganzes Wort
 * da: "Wetter" ist keine Wette, "Waffel" keine Waffe. "Schwein" ist kein
 * Wein und "Insekt" kein Sekt, weil sie bei den harmlosen Wendungen stehen.
 *
 * ZUSAMMEN, MIT BINDESTRICH, GETRENNT: Jede Zusammensetzung haelt als
 * Werbe-Eintrag alle drei Schreibweisen.
 *   - Den Bindestrich leistet der Filter: Er liest jeden Text auch so, als
 *     stuende der Bindestrich nicht da ("Soft-Air" als "softair"), an jeder
 *     Stelle im Wort. Die Liste muss die Wortfuge dafuer nicht kennen.
 *   - Die getrennte Schreibweise ("Pfeffer Spray") braucht die Wortfuge in
 *     der Liste: als "+" im Eintrag oder als eigener Eintrag mit Leerzeichen
 *     unter "nur als Werbung" — dort als ganzes Wort, wo der zweite Wortteil
 *     kurz ist ("saft kur" trifft nicht "Saft Kurkuma", "soft air" nicht
 *     "Soft AirPods"). Im Fliesstext gilt die getrennte Schreibweise nicht:
 *     Dort stehen dieselben zwei Woerter oft zufaellig nebeneinander ("Sex
 *     spielt keine Rolle", "das Spiel automatisch speichern").
 *   - Leerzeichen an beliebiger Stelle zu ueberbruecken, traefe Alltagstext
 *     ("Islam ist", "Code in").
 * Die Pruefreihe haelt das fest: Ein langes Listenwort ohne Wortfuge steht
 * dort in einer von zwei Listen (ein anderes Listenwort faengt die getrennte
 * Schreibweise; kein zusammengesetztes Wort), sonst wird der Test rot.
 *
 * NUR ALS WERBUNG: Woerter, die als Werbe-Eintrag (ein bis drei Woerter)
 * eindeutig sind, im ganzen Satz aber meist etwas anderes heissen ("deine
 * staerkste Waffe", "wir raten dir", "on the far right"). Sie gelten nur
 * fuer ad_targeting, nicht fuer Erklaersaetze und Fliesstext.
 *
 * WAS UEBERALL GILT, loest in Stufe 1 den Alarm aus, sobald es im Fliesstext
 * steht, und wird in Stufe 2 dort gezaehlt. Ueberall gelten deshalb nur
 * Woerter, die in einem Profiltext nichts verloren haben: Namen, Symbole,
 * Organisationen, eindeutige Waren ("Hitler", "KKK", "Sprengstoff",
 * "Dildo"). Nur als Werbung gelten:
 *   - abstrakte Begriffe, die in einem Aufklaerungs- oder Erklaersatz stehen
 *     koennen ("Faschismus", "Radikalisierung", "Erotik", "Nacktbilder");
 *   - Redewendungen und Tunwoerter ("wieder wett", "I bet", "ein Jackpot",
 *     "rauchen", "schulden", "deine Droge");
 *   - Stammregeln, die im Satz zu viel traefen ("abnehm*": "abnehmende
 *     Tendenz");
 *   - die getrennte Schreibweise einer Zusammensetzung ("sex spielzeug*",
 *     "pfeffer spray*").
 * Ausnahmen, bewusst so gelassen: "Extremismus" und "Terror" gelten weiter
 * ueberall, ebenso englisch "gun", "guns" und "rifle" (sie galten schon vor
 * dem 04.10.2026 ueberall; "shotgun" kam neu dazu und gilt nur als Werbung).
 * Slang mit "Porn" gilt ueberall, auch zusammengeschrieben ("Foodporn"): Er
 * soll im Fliesstext den Alarm ausloesen (Entscheidung vom 16.09.2026, siehe
 * __tests__/prompt-sprachregeln.test.js).
 *
 * HARMLOSE WENDUNGEN nehmen ein Listenwort in einer festen Verbindung aus
 * ("Wasserpistole", "alkoholfrei", "Diet Coke", "Rifle Jeans", "Unisex",
 * "Waffen-Skins"). Sie wirken auf beide Stufen und auf jede Sicht.
 *
 * BEWUSST NICHT GELISTET:
 *   - "Sex" als ganzes Wort und "Pistols": "Sex: female" ist eine Angabe,
 *     "Sex Pistols" eine Band. Gelistet sind die Zusammensetzungen
 *     ("Sexshop", "Sex-Videos", "Sex Spielzeug").
 *   - die Ersatz-Angebote, die der Prompt bei Minderjaehrigen ausdruecklich
 *     nennt (In-App-Kaeufe, Lootboxen, Gaming-Abos, Influencer-Merch,
 *     Sammelkarten, Statuskleidung): Sie sind Lerninhalt.
 *   - mehrdeutige Woerter ("Messer", "Gras", "Hyaluron", "Corona").
 */

/* ── Stufe 1: gilt fuer alle ──────────────────────────────────────────── */
const PORNOGRAFIE = `*onlyfans*, *fansly*, *bestfans*, *xhamster*, *youporn*, *xvideos*, xnxx, *brazzers*,
  *stripchat*, *chaturbate*, *mydirtyhobby*, *amorelie*, beate uhse, eis.de, porn*, *porno*, *cam girl*,
  adult webcam*, *sexcam*, sex cam*, *sexshop*, sex shop*, sex toy*, *sexspielzeug*, *telefonsex*, phone sex,
  *cybersex*, *sexarbeit*, sex work*, *sexfilm*, *sexkino*, *sexdate*, *sexpuppe*, sex doll*, sex chat*, *prostitu*,
  call girl*, *escort*, *bordell*, *brothel*, strip club*, *hentai*, xxx video*, xxx film*, sugar daddy*, sugar babe*,
  sugar baby*, sugar dating, dildo*, lovehoney, bdsm, peep show*, swinger club*, table dance*, lap dance*,
  strip show*, hure, huren, rotlicht+viertel*, rotlicht+milieu*, red light district*, joyclub*, *porn`;
const WAFFEN = `*schusswaffe*, *feuerwaffe*, *jagdwaffe*, *kriegswaffe*, *stichwaffe*, *hiebwaffe*, *gaswaffe*,
  *luftdruckwaffe*, *waffenhandel*, waffenladen*, waffenshop*, waffengeschäft*, waffenhändler*, waffenschein*,
  waffenbörse*, waffenzubehör*, waffenbesitz*, waffenschrank*, waffensammlung*, *munition*, luftpistole*, gaspistole*,
  maschinenpistole*, *softair*, *airsoft*, *schreckschuss*, gun, guns, *handgun*, rifle*, *firearm*, ammo, *silencer*,
  schall+dämpfer*, *kampfmesser*, *springmesser*, butterfly messer*, *wurfmesser*, *einhandmesser*, combat knife*,
  *schlagring*, brass knuckle*, knuckle duster*, *schlagstock*, *elektroschocker*, taser*, *pfefferspray*,
  pepper spray*, armbrust*, crossbow*, *handgranate*, hand grenade*, *kalaschnikow*, ak 47, ar 15, glock, glocks,
  heckler koch, sig sauer, smith wesson, walther ppk, machete*, ziel+fernrohr*, *sprengstoff*, bombenbau*,
  schrotflinte*, switchblade*, tot+schläger*, wurfstern*, nunchaku*, jagd+messer*, explosives`;
const EXTREMISMUS = `*extremis*, *rechtsextrem*, *linksextrem*, *rechtsradikal*, nazi, nazis, nazism*, nazisymbol*,
  naziparole*, nazipropaganda*, *neonazi*, terror*, *terrorism*, *terrorist*, white supremac*, thor steinar,
  *reichsbürger*, identitäre bewegung, islamism*, islamist*, *dschihad*, jihad*, salafis*, *hakenkreuz*, swastika*,
  ku klux klan, hitler*, kkk, isis, islamischer staat, islamic state, al qaida, al qaeda, al kaida, taliban*, qanon*,
  white power, combat 18, blood honour, blood honor, rechts+rock*, ns devotionalien*`;
const IMMER_NUR_ALS_WERBUNG = `only fans, waffen*, *waffen, *waffe, weapon*, pistol, *gewehr, *gewehre, *gewehren,
  *gewehrs, revolver, revolvers, far right, alt right, *erotik*, erotic*, erotisch*, strip+tease*, nudes, nacktbild*,
  nackt+foto*, nude photo*, nude pic*, vibrator*, play+boy*, nsfw, xxx, adult content*, adult entertainment*,
  adult dating*, laufhaus*, fetisch shop*, fetish shop*, dolch, dolche, flinte, flinten, granate, granaten, grenades,
  beretta, uzi, uzis, schießstand*, faschis*, fascis*, anti+semit*, rassen+hass*, volks+verhetz*, hass+gruppe*,
  hate group*, hass+prediger*, hate preacher*, incel*, holocaust+leugn*, holocaust denial*, identitäre, identitären,
  *propaganda*, wehrmacht*, radical islam*, radikaler islam*, shotgun*, pistole*, gewehr*, luftgewehr*, jagdgewehr*,
  sturmgewehr*, maschinengewehr*, fire arm, fire arms, switch blade*, bewaffnung*, schieß+training*, shooting range*,
  strip chat*, my dirty hobby*, joy club*, best fans, love honey, x hamster, x videos, adult video*, x rated*,
  reiz+wäsche*, erwachsenen+unterhaltung*, stripper*, webcam models, hookers, hassrede*, hate speech*, rechte szene,
  rechten szene, sexting*, sex spielzeug*, sex spiele, sex arbeit*, sex film*, sex kino*, sex date, sex dates,
  sex dating*, sex puppe*, sex video*, sex tape*, sex hotline*, sex kontakt*, sex treffen*, sex abo*, sex seite*,
  sex portal*, sex clip*, sex stream*, sex club*, sex party*, sex messe*, sex tourismus*, sex geschichte*, sex story*,
  sex stories, sex game*, sex app, sex apps, sex anzeige*, sex bilder*, sex kauf*, sex massage*, live sex*,
  webcam sex*, soft air, air soft, radikalisierung, radikalisierungen, radicalization, radicalisation, telefon sex,
  cyber sex, schreck schuss*, kampf messer*, spring messer*, wurf messer*, einhand messer*, schlag ring, schlag ringe,
  schlag stock, schlag stöcke, elektro schocker*, pfeffer spray*, cross bow, cross bows, spreng stoff*, bomben bau,
  wurf stern, wurf sterne, rechts extrem*, links extrem*, rechts radikal*, reichs bürger*, haken kreuz, haken kreuze,
  nackt bild, nackt bilder, schieß stand, schieß stände, hass rede, hass reden`;

/* ── Stufe 2: nur bei moeglicherweise Minderjaehrigen ─────────────────── */
const WETTEN = `*bet365*, *tipico*, bwin, *betano*, *winamax*, *tipp3*, novomatic, novoline, pokerstars, betway,
  unibet, *casino*, *kasino*, *sportwetten*, *glücksspiel*, *wettanbieter*, *buchmacher*, *kombiwette*, sportwette,
  livewette, wettbüro*, wettschein*, wettbonus*, wettquote*, wetteinsatz*, wettkonto*, wettportal*, wettlokal*,
  wetttipp*, wettapp*, *gambling*, *betting*, *bookmaker*, bookie*, slot machine*, poker, *lotterie*, lottery*,
  euromillionen, euromillions, rubbellos*, scratch card*, roulette, *spielautomat*, automaten+spiel*, spielbank*,
  spielhalle*, spielothek*, black jack*, slot spiel*, slot game*, einarmiger bandit*, einarmige banditen, sportsbook*,
  rollbit, draftkings, fanduel, william hill, ladbrokes, leo vegas, wunderino, mozzart*, wager, wagers, wagering,
  wagered, win 2 day, brieflos*, 1xbet*, 22bet*`;
const KREDIT = `*kredit*, *darlehen*, *ratenkauf*, *ratenzahlung*, ratenplan*, monats+rate*, *teilzahlung*,
  *finanzierung*, *financing*, *riverty*, *afterpay*, *cashper*, ratepay, *auxmoney*, *smava*, *vexcash*, *schufa*,
  *inkasso*, *leasing*, *mikrofinanz*, dispo, *überziehung*, over+draft*, *umschuldung*, *hypothek*, *mortgage*,
  kauf auf rechnung, rechnungs+kauf*, loan, loans, *payday*, installment*, instalment*, buy now pay later, pay later,
  bnpl, credit card*, klarna*, pfandhaus*, pfand+leih*, pay in 4, pay in 3, borrow money, cash advance*, bonität*,
  zahl+pause*, zahlungs+pause*, stundung*, scalapay, zinia, miet+kauf*, zahl später*`;
const ALKOHOL = `*alkohol*, *alcohol*, bier*, weißbier*, weizenbier*, dosenbier*, flaschenbier*, fassbier*, freibier*,
  starkbier*, bockbier*, altbier*, craftbier*, kellerbier*, lagerbier*, weinabo*, weinprobe*, weinverkostung*,
  weinhandel*, weinhandlung*, weinkeller*, weingut*, weinflasche*, weinshop*, weinladen*, weinbar*, weinpaket*,
  weinclub*, weinfest*, weinschorle*, weinkühlschrank*, weinregal*, weinkenner*, weinliebhaber*, weinreise*,
  weinlieferung*, weinversand*, weintasting*, weinkarte*, weinglas*, weingläser*, weinviertel dac, winzer*, vinothek*,
  *wein, *rotwein*, *weißwein*, *glühwein*, *sekt, sektflasche*, sektglas*, sektempfang*, sektkellerei*, *prosecco*,
  champagner*, champagne, *aperol*, spritz, campari, gin, gins, *tequila*, *cocktail*, *spirituose*, *vodka*, *wodka*,
  *whisky*, *whiskey*, schnaps*, *schnaps, *likör*, liqueur*, weinbrand*, obstler, grappa, ouzo, sambuca, absinth*,
  cider, ciders, hard seltzer, brauerei*, brewery*, brennerei*, distillery*, destillerie*, winery*, beer, beers, wine,
  wines, liquor, liquors, booze, *jägermeister*, stiegl, gösser, heineken, corona extra, bacardi, captain morgan,
  smirnoff*, jack daniel*, jim beam, johnnie walker, baileys, long drink*, havana club, white claw, trink+spiel*,
  drinking game*, koma+sauf*, kneipen+tour*, pub crawl*, sangria*, mojito*, caipirinha*, lillet, jäger+bomb*,
  jagermeister*, gosser, märzenbier*, pils, pilsner*, pilsener*, flügerl*, schnäpse*, *schnäpse, sektfrühstück*,
  pale ale*, alko+pop*, alco+pop*`;
const TABAK = `*zigarett*, *zigarre*, *zigarillo*, *tabak*, *tobacco*, *cigarette*, cigar, cigars, *nikotin*,
  *nicotine*, snus, vape*, vaping, *shisha*, wasser+pfeife*, hookah*, raucher*, marlboro, lucky strike, gauloises,
  pall mall, elf bar, lost mary, iqos, vuse, juul, heets, zyn, e liquid*, dampfer shop*, long paper*, memphis blue,
  e cig*, smoke shop*, puff bar*, terea, ske crystal*, randm tornado*, vaporizer*, vaporiser*, rolling paper*`;
const SCHOENHEIT = `*botox*, filler, fillers, lip filler*, lip injection*, schönheits op*, schönheits+chirurg*,
  schönheits+korrektur*, schönheits+klinik*, schönheits+eingriff*, beauty op, beauty ops, beauty operation*,
  beauty korrektur*, plastische chirurgie, plastic surgery, cosmetic surgery, cosmetic procedure*, *fettabsaug*,
  *brustvergrößer*, brust+verkleinerung*, brust+straffung*, brust op, brust+operation*, nasen op, nasen+operation*,
  *nasenkorrektur*, lippen aufspritz*, *unterspritzung*, face+lift*, lid+straffung*, *haartransplantation*,
  hair transplant*, breast augmentation, breast enlargement*, boob job*, nose job*, rhinoplast*, tummy tuck*,
  *liposuction*, fett weg spritze*, beauty eingriff*, ästhetische medizin, ästhetische chirurgie, aesthetic surgery,
  aesthetic medicine, aesthetic clinic*, butt lift*, lippen+vergrößer*, lip augmentation*, lip flip*, russian lips,
  lippen machen lassen, nase machen lassen, brust+implantat*, po implantat*, kinn implantat*, breast implant*,
  butt implant*, med spa, med spas, injectables, cosmetic injection*, falten+behandlung*, beauty doc*,
  bauchdecken+straffung*, faden+lifting*, kryolipolyse*, skin bleaching*, skin whitening*, haut+aufhell*,
  hyaluron filler*, hyaluron spritze*, hyaluron unterspritz*, hyaluron injektion*, hyaluron behandlung*,
  hyaluron lippen*, hyaluron pen*, hyaluronsäure filler*, hyaluronsäure spritze*, hyaluronsäure injektion*,
  hyaluronsäure behandlung*, hyaluronic filler*, hyaluronic acid filler*, hyaluronic acid injection*,
  kosmetische eingriff*, kosmetischer eingriff*, kosmetischen eingriff*, kosmetische chirurgie*, po vergrößer*,
  lippenfiller*, aufgespritzte lippen*`;
const DIAET = `diät*, *diät, dieting, diet pill*, *ozempic*, *wegovy*, *mounjaro*, *almased*, weight watchers, noom,
  yazio, shape shake*, calorie count*, intervall+fasten*, intermittent fasting, detox kur*, detox tee*,
  *appetitzügler*, fat burner*, schlankheits*, slimming*, weight loss*, lose weight, appetite suppressant*,
  gewichts+verlust*, gewichts+abnahme*, gewichts+reduktion*, kalorien zähl*, kalorien+defizit*, calorie track*,
  calorie deficit*, low carb*, keto, ketogen*, detox tea, detox teas, mahlzeiten+ersatz*, meal replacement*, lifesum,
  bikini+figur*, sommer+figur*, strand+figur*, traum+figur*, wunsch+gewicht*, thigh gap*, size zero, pro ana,
  thinspo*, heil+fasten*, saftkur*, entschlack*, stoffwechselkur*, abführ+tee*, schlank+macher*, fett+verbrenn*,
  schlank shake*, skinny tea*, waist trainer*, weight management*, fasting app*, kalorien track*, my fitness pal,
  schlank im schlaf*, fett+killer*, slimfast*`;
const DROGEN = `drogen*, rausch+gift*, rausch+mittel*, sucht+gift*, sucht+mittel*, betäubungs+mittel*, narkotik*,
  narcotic*, *cannabis*, cbd, thc, hhc, marihuana*, marijuana*, haschisch*, hashish*, hasch, hanf+blüte*, ganja,
  spliff*, kiff*, bekifft*, bong, bongs, head shop*, grow shop*, legal high*, lachgas*, laughing gas*, mdma, xtc,
  kokain*, cocaine*, koks, koksen, kokser*, lsd, magic mushroom*, zauber+pilz*, psilocybin*, shrooms, heroin,
  crystal meth*, methamphetamin*, amphetamin*, ketamin*, opioid*, opiat*, fentanyl*, kratom, psychedelika,
  psychedelics, partydroge*, designerdroge*, einstiegsdroge*, modedroge*, tilidin*, xanax, codein*, benzos,
  benzodiazepin*, meth, space cookie*, space cake*, hasch keks*, hash brownie*, party+pille*, aufputsch+mittel*,
  grow box*, dab pen*`;
const MINOR_NUR_ALS_WERBUNG = `*wette, admiral, stake, slots, raten*, später bezahlen, später zahlen, weine, rum,
  radler, spritzer, ottakringer, spirits, velo, diet, diets, weed, joint, joints, ecstasy, grinder, grinders, edibles,
  wett, *wetten, lotto*, *jackpot*, bet, bets, schulden*, debt, debts, rauchen, *droge, drug, drugs, abnehm*,
  mr green, zocken um geld, um geld spielen, affirm, abbezahlen, auf pump, geld leihen, geld borgen, vorschuss,
  zipfer, puntigamer, schwechater, wieselburger, zwettler, krombacher, becks, berentzen, desperados, ramazzotti,
  kleiner feigling, saufen, hangover*, hoch+prozentig*, gspritzter, gspritzten, gspritzte, trafik*, kippe, kippen,
  stopf+maschine*, ocb, veneer*, ohren anlegen, mager+sucht*, fett weg, bauch+fett*, opium, stoner, stoners,
  gras kaufen, high werden, abzahl*, schuldner*, lending, after pay, rate pay, aux money, vex cash, scala pay,
  euro millionen, euro millions, draft kings, fan duel, märzen, ale, ales, smokes, slim fast*, glücks spiel*,
  buch macher*, book maker*, rubbel los, rubbel lose, spiel automat, spiel automaten, spiel bank, spiel banken,
  spiel halle, spiel hallen, brief los, brief lose, teil zahlung*, mikro finanz*, pfand haus, pfand häuser,
  jäger meister, jager meister, fett absaug*, brust vergrößer*, nasen korrektur*, haar transplantation*,
  appetit zügler*, saft kur, saft kuren, stoffwechsel kur, stoffwechsel kuren, lach gas`;

/* Harmlose Wendungen, in denen ein Listenwort steckt. Sie werden vor dem
   Vergleich aus dem Text genommen.
   Was ein Schwein, ein Sporn oder ein Insekt ist, steht als ganzes Wort
   aufgezaehlt da: Eine links offene Wendung ("*schwein") naehme auch das
   Ende eines fremden Wortes mit — aus "Tischwein" bliebe "Ti", aus
   "Teensporn" "Teen", aus "Rheinsekt" "Rhe". Aus demselben Grund stehen
   "pleasing" und "releasing" als Wortanfang da ("Laptopleasing" ist
   Leasing). Was nicht aufgezaehlt ist ("Wollschwein"), liest der Filter als
   Wein. Die Pruefreihe haelt die Fehlerart fest.
   "Skin": Waffen-Skins sind Spiele-Kaeufe, keine Waffen. Anderes mit
   "Waffen" bleibt gestrichen ("Waffen-Bauplaene", "Waffen-Pack") — ein
   Bauplan kann auch eine echte Waffe meinen. */
const HARMLOS_WOERTER = `guns n roses, top gun, machine gun kelly, massage gun*, nerf gun*, water gun*, glue gun*,
  toy gun*, gun metal*, wasser pistole*, nerf pistole*, *klebe pistole*, massage pistole*, spielzeug pistole*,
  water pistol*, toy pistol*, wasser gewehr*, nerf gewehr*, spielzeug gewehr*, ford escort, terrorvogel*,
  terrorvögel*, terrorzwerg*, terrorisier*, terroriz*, terrorise, terrorised, terrorises, terrorising, geheimwaffe*,
  wunderwaffe*, allzweckwaffe*, pleasing*, people pleasing*, crowd pleasing*, displeasing*, unpleasing*,
  releasing*, unreleasing*, cocktailkleid*, schnapsidee*, schnapszahl*, schnapsen,
  schnapskarte*, bierernst*, biereif*, schwein, meerschwein, sparschwein, wildschwein, glücksschwein,
  hausschwein, warzenschwein, stachelschwein, minischwein, marzipanschwein, hängebauchschwein, trüffelschwein,
  pinselohrschwein, phrasenschwein, bullenschwein, frontschwein, kapitalistenschwein, bilgenschwein, kielschwein,
  insekt, nutzinsekt, fluginsekt, schadinsekt, urinsekt, aasinsekt, kindersekt*, champagnerfarb*,
  akkreditier*, *diskreditier*,
  stocking filler*, joint venture*, coffee grinder*, kaffee grinder*, angle grinder*, *spritz pistole*,
  seifenblasen pistole*, laser pistole*, bubble gun*, squirt gun*, holz gewehr*, lackier pistole*, silikon pistole*,
  kartuschen pistole*, löt pistole*, heißluft pistole*, zapf pistole*, lil uzi*, mundpropaganda*, alkoholfrei*,
  ginger beer*, root beer*, butter beer*, bierhoff*, cocktailtomate*, cocktailsauce*, cocktailsoße*,
  cocktailwürstchen*, krabbencocktail*, shrimp cocktail*, obstcocktail*, fruchtcocktail*, cocktailkirsche*,
  wein nicht, rum aroma*, aperolfarb*, eros ramazzotti, tabakfrei*, zigarettenfrei*, nikotinfrei*, shisha frei*,
  raucherlunge*, raucherentwöhn*, velo helm*, velo tour*, drogenfrei*, drug store*, black opium*, stoner rock*,
  kiffhäuser*, pfeffer grinder*, salz grinder*, gewürz grinder*, skate grinder*, pepper grinder*, meat grinder*,
  klarname*, kreditkartenhülle*, kreditkarten etui*, kreditkartenhalter*, raten quiz*, rätsel raten*, lotto fußball*,
  lotto sport*, poker face*, admiral trikot*, admiral bundesliga*, casino royale*, jackpot eis*,
  wetten dass*, facelift vw*, facelift audi*, facelift bmw*, facelift mercedes*, facelift modell*, auto facelift*,
  filler episode*, filler folge*, filler arc*, aufpump*, abnehmbar*, abnehmend*, abnehmerschaft*, abnehmerländer*,
  abnehmerland*, abnehmerkreis*, abnehmerin*, abnehmers, abnehmern, abnehmer, diätassisten*, diätolog*, diet coke*,
  diet cola*, diet pepsi*, diet soda*, shotgun mikrofon*, shotgun mic*, rifle jeans*, pistolengriff*, gewehrt,
  gewehrte, gewehrten, wire stripper*, paint stripper*, kabel stripper*, bierdeckel*, bierschinken*, bierwurst*,
  spritz gebäck*, spritz beutel*, spritz tülle*, gin romme*, gin rummy*, winery dogs, ginger ale*, radler zubehör*,
  radler hose*, radler trikot*, radler helm*, lotto trikot*, lotto schuh*, admiral sportswear*, koks grill*,
  hasch mich*, cbd frei*, thc frei*, diät cola*, diät limo*, unisex*, essex*, sussex*, middlesex*, wessex*, *waffel*,
  sporn, ansporn, rittersporn, heißsporn, fersensporn, bergsporn, felssporn, lerchensporn, rammsporn,
  waffen skin*, weapon skin*, gun skin*`;

module.exports = {
  IMMER: { ueberall: [PORNOGRAFIE, WAFFEN, EXTREMISMUS], nurAlsWerbung: IMMER_NUR_ALS_WERBUNG },
  MINOR: {
    ueberall: [WETTEN, KREDIT, ALKOHOL, TABAK, SCHOENHEIT, DIAET, DROGEN],
    nurAlsWerbung: MINOR_NUR_ALS_WERBUNG,
  },
  HARMLOS: HARMLOS_WOERTER,
};
