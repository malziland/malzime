/**
 * minor-safety-woerter.test.js — Was die Sperrliste des Kinderschutz-Filters
 * hält (SEC-2026-10-03-01).
 *
 * Der Filter ist eine Wortliste. Diese Datei ist ihr Maßstab, und zwar ein
 * Maßstab, der NICHT aus der Liste selbst abgeleitet ist:
 *
 *   1. Je Thema eine feste Reihe „muss gefangen werden“ — deutsch und
 *      englisch, mit den Oberbegriffen der eigenen Verbotsregel im Prompt,
 *      gängigen Alltagswörtern und Marken aus dem mitteleuropäischen Markt.
 *   2. Je Thema eine feste Reihe „darf NICHT gefangen werden“ — harmlose
 *      Wörter, in denen ein Listenwort steckt („Wetter“, „Schwein“, „Insekt“,
 *      „Waffel“, „People-Pleasing“).
 *   3. Eine Tabelle Listenwort → Beispiel. Jedes Wort der Liste braucht dort
 *      ein Beispiel, das ohne dieses Wort anders ausginge. Wer ein Wort
 *      streicht, verschreibt oder ohne Beispiel ergänzt, macht einen Test rot.
 *
 * Stufe 1 (Pornografie, Waffen, Extremismus) gilt für alle; Stufe 2 (Wetten,
 * Kredit, Alkohol, Tabak, Schönheits-OP, Diät, Drogen) nur bei möglicherweise
 * Minderjährigen. Die Entscheidung über Stufen und Altersgrenze prüft
 * minor-safety.test.js; hier geht es nur um die Wörter.
 */
const {
  applyMinorSafety,
  _istImmerVerboten,
  _istBeiMinderjaehrigenVerboten,
  _vereinheitlicht,
  _muster,
  _SPERRLISTEN,
} = require("../minor-safety");
const { loggeMinorSafety } = require("../job-helfer");

const KIND = "Du bist weiblich, ~13 Jahre alt (Spanne 12-14).";
const ERWACHSEN = "Du bist männlich, ~40 Jahre alt (Spanne 38-45).";

function profil(alterText, werbung, extra = {}) {
  const modus = () => ({
    categories: { alter_geschlecht: { value: alterText } },
    ad_targeting: [...werbung],
    manipulation_triggers: [],
    profileText: "",
    ...extra,
  });
  return { normal: modus(), boost: modus() };
}

/* [Thema, Prüffunktion, deutsch, englisch, harmlos] */
const THEMEN = [
  [
    "Stufe 1 — Pornografie und Sexarbeit",
    _istImmerVerboten,
    [
      "Pornografie",
      "pornografische Angebote",
      "Pornographie",
      "Porno",
      "Pornos",
      "Pornoseite",
      "Pornoseiten-Abo",
      "Pornofilm Flatrate",
      "Pornoportal",
      "Kinderpornografie",
      "Erotik",
      "Erotik-Shop",
      "Erotikshop",
      "Erotik-Chat",
      "Erotikfilme",
      "Orion Erotik",
      "Sex-Shop",
      "Sexshop",
      "Sexspielzeug",
      "Sex-Toys",
      "Telefonsex",
      "Sexarbeit",
      "Prostitution",
      "Callgirl",
      "Escort-Dienste",
      "Bordell",
      "Stripclub",
      "Only Fans",
      "Only-Fans",
      "OnlyFans",
      "ONLYFANS",
      "BestFans",
      "Stripchat",
      "Chaturbate",
      "MyDirtyHobby",
      "Joyclub",
      "Amorelie Adventskalender",
      "Eis.de Toys",
      "Beate Uhse",
      "Sugardaddy-Portal",
      "Sexting-App",
      "Hentai Abo",
      "XXX Videos",
      "erotische Massage",
      "erotische Geschichten",
      "Erotisches Hörbuch",
      "Sex-Hotline",
      "Sexhotline",
      "Webcam-Sex",
      "Sexkontakte",
      "Sex Treffen",
      "Sexdating",
      "Laufhaus",
      "Strip-Show",
      "Table Dance",
      "Nacktbilder",
      "Nacktfotos",
      "Dildo",
      "Vibrator",
      "Swingerclub",
      "Peepshow",
      "Playboy",
      "Fetisch-Shop",
      "BDSM",
      "Rotlichtviertel",
      "Lovehoney",
      "Huren",
      "XXX",
      "Food-Porn",
      "Reizwäsche",
      "Erwachsenenunterhaltung",
      "Stripper",
      "Sex-Spielzeug",
      "Sex Spielzeug",
      "Sex-Filme",
      "Sex-Kino",
      "Sex-Puppe",
      "Telefon-Sex",
      "Joy Club",
      "My Dirty Hobby",
      "Strip Chat",
    ],
    [
      "Pornography",
      "Porn Subscription",
      "Porn-Abo",
      "Erotic Massage",
      "Sex Shop",
      "Sex Toys",
      "Sextoys",
      "Sex Work",
      "Phone Sex",
      "Escort Service",
      "Brothel",
      "Strip Club",
      "Adult Webcam",
      "Webcam-Girls",
      "Call Girl",
      "Sugar Daddy Dating",
      "Nudes",
      "Adult Entertainment",
      "Adult Content",
      "NSFW Content",
      "live sex",
      "sex videos",
      "nude photos",
      "adult dating",
      "lap dance",
      "Casual Sex App",
      "adult videos",
      "X-rated movies",
      "strippers",
      "hookers",
    ],
    [
      "Ansporn",
      "anspornen",
      "Unisex",
      "Unisex Hoodie",
      "Unisex Camo Jacke",
      "Unisex Toys",
      "Unisex Shop",
      "Essex",
      "Sussex Camping",
      "Sextett",
      "Sextant",
      "Sexualkunde",
      "sexuelle Orientierung",
      "Sexismus",
      "Sex: female",
      "Sex",
      "Sex Education",
      "sexy Outfit",
      "Dating-App",
      "Tinder",
      "Webcam",
      "Camping",
      "Girls Night",
      "XXXLutz",
      "XXL Pizza",
      "Eisdiele",
      "Eis am Stiel",
      "Streifenshirt",
      "Stripes Hoodie",
      "Ford Escort",
      "Zuckerwatte",
      "Sexualpädagogik",
      "Sex Pistols",
      "Sexismus-Workshop",
      "Unisex-Mode",
      "Puffreis",
      "Puffärmel",
      "Webcam Logitech",
    ],
  ],
  [
    "Stufe 1 — Waffen",
    _istImmerVerboten,
    [
      "Waffen",
      "Waffe",
      "Waffenladen",
      "Waffenshop",
      "Waffen-Zubehör",
      "Waffenschein-Kurs",
      "Schusswaffe",
      "Jagdwaffen",
      "Frankonia Jagdwaffen",
      "Munition",
      "Pistole",
      "Pistolen",
      "Softair-Pistole",
      "Schreckschusspistole",
      "Luftpistole",
      "Gewehr",
      "Luftgewehr",
      "Jagdgewehr",
      "Airsoft Gewehr",
      "Revolver",
      "Kampfmesser",
      "Springmesser",
      "Butterflymesser",
      "Schlagring",
      "Pfefferspray",
      "Armbrust",
      "Glock 19 Zubehör",
      "Walther PPK",
      "Heckler & Koch",
      "Kalaschnikow",
      "AK-47",
      "Jagdmesser",
      "Machete",
      "Dolch",
      "Zielfernrohr",
      "Schießstand",
      "Sprengstoff",
      "Bombenbau",
      "Granaten",
      "Totschläger",
      "Wurfsterne",
      "Nunchaku",
      "Schrotflinte",
      "Flinte",
      "Uzi",
      "Beretta",
      "Soft-Air",
      "Soft Air",
      "Pfeffer-Spray",
      "Elektro-Schocker",
      "Kampf-Messer",
      "Pistolenholster",
      "Gewehrkoffer",
      "Luftgewehrkugeln",
      "Bewaffnung",
      "Schießtraining",
      "Shotgun",
    ],
    [
      "Weapons",
      "Weapon",
      "Gun",
      "Guns",
      "Handgun Accessories",
      "Pistol",
      "Shotgun",
      "Rifle",
      "Firearm",
      "Ammunition",
      "Ammo",
      "Silencer",
      "Airsoft Gun",
      "Combat Knife",
      "Crossbow",
      "Pepper Spray",
      "Brass Knuckles",
      "AR-15",
      "switchblade",
      "grenades",
      "explosives",
      "Uzis",
      "shooting range",
    ],
    [
      "Waffel",
      "Waffeln",
      "Waffeleisen",
      "Wasserpistole",
      "Heißklebepistole",
      "Massagepistole",
      "Wasser-Pistole",
      "Wasser Pistole",
      "Nerf-Pistole",
      "Heißklebe-Pistole",
      "Klebepistole",
      "Spritzpistole",
      "Spritz-Pistole",
      "Massage-Pistole",
      "Spielzeug-Pistole",
      "Wassergewehr",
      "Wasser-Gewehr",
      "Spielzeuggewehr",
      "Gun Metal Grey",
      "Gunmetal",
      "Water Pistol",
      "Pistols",
      "Toy Gun",
      "Messer-Set",
      "Messer-Abo",
      "Taschenmesser",
      "Küchenmesser",
      "Knife",
      "Glocke",
      "Glockenrock",
      "Schulglocke",
      "Glockenspiel",
      "Kirchenglocke",
      "weglocken",
      "Revolverheld",
      "Sex Pistols",
      "Guns N' Roses",
      "Top Gun",
      "Machine Gun Kelly",
      "Massage Gun",
      "Nerf Gun",
      "Water Gun",
      "abgewehrt",
      "Du hast dich gewehrt",
      "Geheimwaffe gegen Pickel",
      "Wunderwaffe",
      "trifle",
      "Laser Tag",
      "Armband",
      "Ammoniak",
      "Kommunikation",
      "Januar 15",
      "Februar-15",
      "Frankonia",
      "Seifenblasen-Pistole",
      "Seifenblasenpistole",
      "Laser-Pistole",
      "Holzgewehr",
      "Bubble Gun",
      "Squirt Gun",
      "Lackier-Pistole",
      "Farbspritz-Pistole",
      "Granatapfel",
      "Lil Uzi Vert Merch",
      "Karabinerhaken",
      "Druckerpatronen",
      "Pokémon Sword",
      "Shotgun-Mikrofon",
      "Rifle Jeans",
      "Baseballschläger",
      "Knarrenkasten",
      "Handy-Holster",
    ],
  ],
  [
    "Stufe 1 — Extremismus",
    _istImmerVerboten,
    [
      "extremistische Inhalte",
      "Extremismus",
      "Rechtsextremismus",
      "rechtsextrem",
      "Rechtsextreme Mode",
      "linksextrem",
      "Rechtsradikal",
      "Nazi",
      "Nazis",
      "Nazi-Devotionalien",
      "Nazi-Symbole",
      "Neonazi",
      "Neo-Nazi",
      "Terror",
      "Terror Merch",
      "Terrorismus",
      "Terroristen",
      "Terroranschläge",
      "Terrorwarnung",
      "Rechtsterrorismus",
      "Linksterroristen",
      "Thor Steinar Kollektion",
      "Reichsbürger-Shop",
      "Identitäre Bewegung",
      "Islamismus",
      "Islamisten",
      "Dschihad-Propaganda",
      "Hakenkreuz",
      "Rechtsrock",
      "Identitäre",
      "IS-Propaganda",
      "Hassprediger",
      "QAnon",
      "KKK",
      "Incel-Foren",
      "Radikalisierung",
      "Hitler",
      "Heil Hitler",
      "Combat 18",
      "Blood & Honour",
      "Wehrmacht-Fanartikel",
      "Faschismus",
      "NS-Devotionalien",
      "Holocaustleugnung",
      "Antisemitismus",
      "Rassenhass",
      "Hassgruppen",
      "ISIS",
      "Al-Qaida",
      "Taliban",
      "Volksverhetzung",
      "Hassrede",
      "Rechte Szene",
    ],
    [
      "Extremist Merch",
      "Neo-Nazi Clothing",
      "White Supremacy",
      "Far-right apparel",
      "Terrorism",
      "Terrorist",
      "Jihad",
      "Swastika",
      "white power",
      "fascist merch",
      "hate groups",
      "radical islam",
    ],
    [
      "Terrorvogel",
      "Terrorvogel-Doku",
      "terrorisiert",
      "Psychoterror",
      "Telefonterror",
      "Konsumterror",
      "Terrorzwerg",
      "terrorize",
      "islamisch",
      "islamische Kunst",
      "Islam",
      "Extremsport",
      "extrem lecker",
      "radikal ehrlich",
      "Radikalisierungsrisiko",
      "Nazim",
      "Ashkenazi",
      "Ignaz",
      "Hooligan-Mode",
      "Hate Merch",
      "Rechtschreibung",
      "Mundpropaganda",
      "Radikal reduziert",
      "Identität stärken",
      "Mini Militia",
      "Anti-Rassismus-Workshop",
      "Verschwörungstheorien erkennen",
      "Ohne Hetze ankommen",
    ],
  ],
  [
    "Stufe 2 — Wetten und Glücksspiel",
    _istBeiMinderjaehrigenVerboten,
    [
      "Glücksspiel",
      "Gluecksspiel",
      "GLÜCKSSPIEL",
      "Sportwetten",
      "Sportwette",
      "Wette",
      "Wetten",
      "Live-Wetten",
      "Wettbüro",
      "Wett-App",
      "Wettschein",
      "Wett-Bonus",
      "Wettanbieter Vergleich",
      "Buchmacher Quoten",
      "Kombiwetten Tipps",
      "Online-Wetten Bonus",
      "Wetten Abo",
      "Interwetten",
      "Admiral",
      "Admiral Sportwetten",
      "win2day",
      "Novomatic",
      "Novoline",
      "Tipico",
      "Lotto",
      "Lotto 6 aus 45",
      "Österreichische Lotterien",
      "EuroMillionen",
      "Rubbellos",
      "Spielautomat",
      "Automatenspiel",
      "Casinos Austria",
      "Online-Casino",
      "Kasino",
      "Roulette",
      "Jackpot",
      "Blackjack",
      "Black Jack",
      "Slot-Spiele",
      "Einarmiger Bandit",
      "Wunderino",
      "Mozzart",
      "Zocken um Geld",
      "Mr Green",
      "LeoVegas",
      "Spiel-Automaten",
      "Brieflos",
      "1xBet",
      "22Bet",
    ],
    [
      "Gambling",
      "Online Gambling",
      "Skin-Gambling",
      "Betting App",
      "Sports Betting App",
      "Bet",
      "Bet365 Live-Wetten Abo",
      "Bookie",
      "Bookmaker",
      "Wager",
      "Poker",
      "Poker-Karten",
      "Pokerkarten",
      "Pokerset",
      "Pokerchips",
      "Pokerstars",
      "Slots",
      "Slot Machines",
      "Lottery",
      "Scratch Cards",
      "Stake",
      "sportsbook",
      "DraftKings",
      "FanDuel",
      "William Hill",
      "Ladbrokes",
      "Rollbit",
    ],
    [
      "Wetter",
      "Wetterstation",
      "Unwetter",
      "Wettbewerb",
      "Wettkampf",
      "Wettlauf",
      "Wettrennen",
      "Lootbox",
      "Lootboxen",
      "Tippspiel Premium",
      "Bingo",
      "Pokerface",
      "abwinken",
      "Betreuung",
      "betörend",
      "betäubt",
      "Betätigung",
      "Bett",
      "Alphabet",
      "Robert",
      "Lotte",
      "Spielplatz",
      "Spielekonsole",
      "Brettspiel",
      "Sammelkarten",
      "Lotto Fußballschuhe",
      "Admiral Trikot",
      "Casino Royale Film",
      "Jackpot-Eis",
      "Wetten dass..? DVD",
      "Mozartkugeln",
      "Glücksrad",
      "Gewinnspiel",
      "loot boxes",
      "Lotto-Trikot",
      "Admiral Sportswear",
      "Wagerl",
      "Einkaufswagerl",
      "Tippspiel",
      "Cashpoint",
    ],
  ],
  [
    "Stufe 2 — Kredit und Raten",
    _istBeiMinderjaehrigenVerboten,
    [
      "Kredit",
      "Sofortkredit",
      "Ratenkredit ohne Schufa",
      "Konsumkredit",
      "Kreditkarte",
      "Darlehen",
      "Konsumentendarlehen",
      "Ratenzahlung",
      "Ratenkauf",
      "Ratenplan",
      "Raten",
      "In 12 Raten",
      "Raten-Abo",
      "Teilzahlung",
      "Finanzierung",
      "0%-Finanzierung",
      "Später bezahlen",
      "PayPal Später zahlen",
      "Jetzt kaufen später zahlen",
      "Kauf auf Rechnung",
      "Dispo",
      "Überziehungsrahmen",
      "Schulden",
      "Leasing",
      "Autoleasing",
      "Klarna",
      "Klarna Ratenkauf",
      "Riverty",
      "Afterpay",
      "Cashper",
      "Inkasso",
      "Pfandhaus",
      "Pfandleihe",
      "Abzahlen",
      "auf Pump kaufen",
      "Bonitätscheck",
      "Geld leihen",
      "Geld borgen",
      "Vorschuss",
      "Zahlpause",
      "Stundung",
      "Klarnas Zahlpause",
      "Klarnas",
      "Scalapay",
      "Zinia",
      "Teil-Zahlung",
      "Mietkauf",
      "Schuldnerberatung",
      "Zahl später",
      "Abzahlung",
    ],
    [
      "Loan",
      "Loans",
      "Instant Loan App",
      "Payday",
      "Credit Card",
      "Buy Now Pay Later",
      "Pay Later",
      "PayPal Pay Later",
      "BNPL",
      "Installment Plan",
      "Instalments",
      "Financing",
      "Mortgage",
      "Debt",
      "Overdraft",
      "Affirm",
      "pay in 4",
      "borrow money",
      "cash advance",
      "lending",
    ],
    [
      "People-Pleasing",
      "Pleasing",
      "releasing",
      "Akkreditierung",
      "diskreditieren",
      "Klarname",
      "Klarnamen",
      "verraten",
      "beraten",
      "Beratung",
      "Ratespiel",
      "Braten",
      "ratepayer",
      "Kreide",
      "Taschengeld",
      "Sparbuch",
      "Gutschein",
      "Schulranzen",
      "Schuldisco",
      "Kreditkartenhülle",
      "Raten-Quiz",
      "Rätsel raten",
      "Flaschenpfand",
      "Store Credit",
      "Extra Credit",
    ],
  ],
  [
    "Stufe 2 — Alkohol",
    _istBeiMinderjaehrigenVerboten,
    [
      "Alkohol",
      "Alkohol-Lieferdienst",
      "Alkoholkonsum",
      "Alkopops",
      "Bier",
      "Biergarten",
      "Bierabo",
      "Bierpong Set",
      "Craft-Bier Abo",
      "Weißbier",
      "Wein",
      "Weinabo",
      "Weinprobe",
      "Weinviertel DAC",
      "Rotwein",
      "Weißwein",
      "Weisswein",
      "Glühwein",
      "Glühweinstand",
      "Rotweinflasche",
      "Süßwein",
      "Hauswein",
      "Krimsekt",
      "Winzersekt",
      "Sekt",
      "Prosecco",
      "Champagner",
      "Wodka",
      "Red Bull Wodka",
      "Whisky",
      "Whiskey",
      "Schnaps",
      "Schnapsbrennerei",
      "Likör",
      "Gin",
      "Rum",
      "Cocktail",
      "Spirituosen",
      "Radler",
      "Spritzer",
      "Hugo Spritz",
      "Almdudler Spritzer",
      "Aperol Spritz Set",
      "Jägermeister",
      "Stiegl",
      "Gösser Radler",
      "Ottakringer",
      "Longdrinks",
      "G'spritzter",
      "Zipfer",
      "Puntigamer",
      "Havana Club",
      "Trinkspiele",
      "Saufen",
      "Komasaufen",
      "Kneipentour",
      "Sangria",
      "Mojito",
      "Caipirinha",
      "Lillet",
      "Ramazzotti",
      "Jägerbomb",
      "Berentzen",
      "Kleiner Feigling",
      "Desperados",
      "Beck's",
      "Krombacher",
      "Zwettler",
      "Schwechater",
      "Wieselburger",
      "Hochprozentiges",
      "Jagermeister",
      "Gosser",
      "Märzen",
      "Pils",
      "Pilsner",
      "Flügerl",
      "Schnäpse",
      "Sektfrühstück",
    ],
    [
      "Alcohol",
      "Alcohol Delivery",
      "Beer",
      "Craft Beer",
      "Heineken Beer Sixpack",
      "Wine",
      "Vodka",
      "Absolut Vodka",
      "Vodka Tasting",
      "Liquor",
      "Booze",
      "Hard Seltzer",
      "Brewery",
      "Cider",
      "Heineken",
      "Corona Extra",
      "Bacardi",
      "Captain Morgan",
      "Smirnoff Ice",
      "Jack Daniel's",
      "White Claw",
      "Pub Crawl",
      "drinking games",
      "hangover cure",
      "Gins",
      "Ciders",
      "pale ale",
    ],
    [
      "Schwein",
      "Sparschwein",
      "Meerschweinchen",
      "Wildschwein",
      "Glücksschwein",
      "Rumäne",
      "weinen",
      "weint",
      "weinrot",
      "Weinrotes Kleid",
      "Weintrauben",
      "Rumänien",
      "herum",
      "Rumpsteak",
      "Original",
      "beginnen",
      "Ginger Ale",
      "Ginseng",
      "Insekt",
      "Insektenhotel",
      "Sektor",
      "Sekte",
      "Kindersekt",
      "bierernst",
      "biereifrig",
      "Schnapsidee",
      "Schnapszahl",
      "Schnapsen",
      "Champagnerfarben",
      "Cocktailkleid",
      "Radlerhose",
      "Absolut",
      "spritzig",
      "probier es aus",
      "Barbier",
      "Mineralwasser",
      "Apfelsaft",
      "Liquorice",
      "Winter",
      "Ginger Beer",
      "Root Beer",
      "Butterbeer",
      "Bierhoff-Trikot",
      "Cocktailtomaten",
      "Rum-Aroma Backen",
      "Aperolfarben",
      "Alkoholfreie Getränke",
      "Eros Ramazzotti Tickets",
      "Roségold",
      "Hugo Boss",
      "Corona-Test",
      "Sturm Graz Trikot",
      "Ingwer-Shots",
      "Gespritzter Apfelsaft",
      "Bierdeckel-Sammlung",
      "Bierschinken",
      "Spritz-Gebäck",
      "Radler-Zubehör",
      "Gin-Rommé",
      "Winery Dogs",
      "Kinderpunsch",
      "Ferienlager",
      "Pilsen-Reise",
      "Mixgetränke",
    ],
  ],
  [
    "Stufe 2 — Tabak und Nikotin",
    _istBeiMinderjaehrigenVerboten,
    [
      "Tabak",
      "Tabak Pouches",
      "Zigaretten",
      "Zigaretten Stange",
      "E-Zigarette",
      "Zigarre",
      "Nikotin",
      "Nikotinbeutel",
      "Nikotinpflaster",
      "Snus Dosen",
      "Shisha",
      "Shisha-Bar",
      "E-Shisha Starterset",
      "Einweg-Vape",
      "Rauchen",
      "Marlboro",
      "Elf Bar",
      "Elfbar",
      "IQOS",
      "Velo",
      "Heets",
      "E-Liquid",
      "Dampfer-Shop",
      "OCB Papers",
      "Trafik",
      "Memphis Blue",
      "Terea",
      "Kippen",
      "Stopfmaschine",
      "SKE Crystal",
      "RandM Tornado",
      "Longpapers",
      "Vaporizer",
      "Wasser-Pfeife",
    ],
    [
      "Tobacco",
      "Cigarette",
      "Cigarettes Carton",
      "Cigar",
      "Nicotine Pouch",
      "Vape",
      "Vapes",
      "Vape Liquids",
      "Vape Shop",
      "Vaping",
      "Hookah",
      "Vuse",
      "Juul",
      "Zyn",
      "e-cig",
      "smoke shop",
      "puff bar",
      "rolling papers",
      "smokes",
    ],
    [
      "Smoking",
      "Rauchmelder",
      "Räucherlachs",
      "Weihrauch",
      "Veloroute",
      "Velours",
      "Vapiano",
      "Verdampfer",
      "Ziegenkäse",
      "Snack",
      "Elfmeter",
      "Elf Freunde",
      "Barhocker",
      "Tabakfrei",
      "Zigarettenfrei",
      "Shisha-freie Zone",
      "Raucherlunge Aufklärung",
      "Velo-Helm",
      "Smoking-Verleih",
      "Vaporwave Musik",
      "Dampfreiniger",
      "AirPods",
      "Feuerzeug",
    ],
  ],
  [
    "Stufe 2 — Schönheitskorrektur",
    _istBeiMinderjaehrigenVerboten,
    [
      "Schönheitskorrektur",
      "Schönheits-OP",
      "Schönheitsoperation",
      "Schönheitschirurgie",
      "Beauty-OP",
      "Beauty-Korrektur",
      "Brustvergrößerung",
      "Brustvergrösserung",
      "Brust-OP",
      "Nasen-OP",
      "Nasenkorrektur Klinik",
      "Lippen aufspritzen",
      "Lippenunterspritzung",
      "Faltenunterspritzung",
      "Fettabsaugung",
      "Fettweg-Spritze",
      "Haartransplantation",
      "Botox Behandlung",
      "Filler",
      "Beauty-Eingriff",
      "ästhetische Medizin",
      "ästhetische Chirurgie",
      "Lippenvergrößerung",
      "Kinn-Implantat",
      "Veneers",
      "Brustimplantate",
      "Po-Implantate",
      "Faltenbehandlung",
      "Beauty-Doc",
      "Ohren anlegen",
      "Bauchdeckenstraffung",
      "Fadenlifting",
      "Fett-weg-Spritze",
      "Kryolipolyse",
      "Lippen machen lassen",
      "Nase machen lassen",
      "Hautaufhellung",
      "Russian Lips",
      "Fett-Absaugung",
      "Brust-Vergrößerung",
      "Haar-Transplantation",
      "Hyaluron-Filler",
      "Hyaluron-Spritze",
      "Hyaluron-Unterspritzung",
      "Kosmetische Eingriffe",
      "Kosmetische Chirurgie",
      "Po-Vergrößerung",
      "Aufgespritzte Lippen",
      "Lippenfiller",
    ],
    [
      "Cosmetic Surgery Clinic",
      "Plastic Surgery",
      "Breast Augmentation",
      "Nose Job",
      "Rhinoplasty",
      "Lip Filler",
      "Liposuction",
      "Tummy Tuck",
      "Facelift",
      "Hair Transplant",
      "Brazilian Butt Lift",
      "butt lift",
      "breast implants",
      "lip augmentation",
      "aesthetic clinic",
      "med spa",
      "injectables",
      "Lip Flip",
      "cosmetic injections",
      "skin bleaching",
      "hyaluronic filler",
    ],
    [
      "Stocking Fillers",
      "Füller",
      "Beauty-Box",
      "Beauty Optionen",
      "Brustschwimmen",
      "Nasenspray",
      "Lippenstift",
      "Lippenpflege",
      "Schönheitsschlaf",
      "Zahnspange",
      "Friseur",
      "Hyaluron-Serum",
      "Hyaluron-Creme",
      "Filler-Episoden",
      "Facelift VW Golf",
      "Wimpernlifting",
      "Powerlifting",
      "Lifting-Gurt",
      "Aesthetic Room Decor",
      "Fox Eyes Make-up",
      "Hyaluron",
      "Hyaluron-Gel",
      "Hyaluron-Maske",
    ],
  ],
  [
    "Stufe 2 — Diät und Abnehmen",
    _istBeiMinderjaehrigenVerboten,
    [
      "Diät",
      "Diaet",
      "Diätmittel",
      "Diätplan",
      "Diät-App",
      "Diät-Shake",
      "Diätpille",
      "Keto Diät",
      "Abnehmen",
      "Abnehm-App",
      "Abnehmprogramm",
      "Abnehmpillen",
      "Abnehmspritze",
      "Wegovy Abnehmen",
      "Ozempic Kur",
      "Schlankheitskur",
      "Schlankheitsmittel",
      "Appetitzügler",
      "Kalorienzähler Premium",
      "Intervallfasten Coaching",
      "Detox-Tee",
      "Detox Kur",
      "Shape Shake",
      "Noom",
      "Yazio",
      "Kalorien zählen",
      "Low Carb",
      "Keto",
      "Mahlzeitenersatz",
      "MyFitnessPal",
      "Lifesum",
      "Bikinifigur",
      "Sommerfigur",
      "Heilfasten",
      "Saftkur",
      "Entschlackung",
      "Fettverbrenner",
      "Stoffwechselkur",
      "Abführtee",
      "Schlankmacher",
      "Abnehmtipps",
      "Abnehmpulver",
      "Abnehmtropfen",
      "Abnehmpflaster",
      "Schlank-Shakes",
      "Kalorientracker",
      "Kaloriendefizit",
      "Fett weg",
      "Bauchfett verlieren",
      "Traumfigur",
      "Wunschgewicht",
      "Magersucht-Foren",
      "Pro-Ana",
      "Appetit-Zügler",
      "Kalorien-Zähler",
      "Kalorien-Tracker",
      "Intervall-Fasten",
      "Slim Fast",
      "Slim-Fast",
      "Schlank im Schlaf",
      "Fettkiller",
    ],
    [
      "Diet",
      "Diet Pills",
      "Slimming Pills",
      "Slimming Tea",
      "Weight Loss",
      "Weight Watchers",
      "Fat Burner",
      "Fatburner",
      "Appetite Suppressant",
      "Intermittent Fasting",
      "low carb",
      "meal replacement",
      "detox tea",
      "skinny tea",
      "waist trainer",
      "weight management",
      "fasting app",
      "Thigh Gap",
      "Size Zero",
      "thinspo",
      "Diets",
    ],
    [
      "diatonische Mundharmonika",
      "Stipendiat",
      "Diatomeen",
      "abnehmbare Kapuze",
      "Abnehmer",
      "Digital Detox",
      "Kalorien",
      "Fastenzeit",
      "Milchshake",
      "Protein Shake",
      "Sporternährung",
      "Gewichtheben",
      "Abnehmbare Zahnspange",
      "Abnehmender Mond",
      "Diätassistenz",
      "Diet Coke",
      "Detox-Smoothie",
      "Kalorienarme Snacks",
      "Skinny Jeans",
      "Shapewear",
      "Diät-Cola",
    ],
  ],
  [
    "Stufe 2 — Drogen",
    _istBeiMinderjaehrigenVerboten,
    [
      "Drogen",
      "Droge",
      "Party-Drogen",
      "Partydrogen",
      "Einstiegsdroge",
      "Rauschgift",
      "Cannabis",
      "Cannabis-Shop",
      "Cannabisöl",
      "CBD-Öl",
      "CBD-Shop",
      "CBD Gummies",
      "Marihuana",
      "Haschisch",
      "Hasch",
      "Hanfblüten",
      "Kiffen",
      "Kiffer-Zubehör",
      "Joint",
      "Bong",
      "Grinder",
      "Headshop",
      "Head-Shop",
      "Growshop",
      "Grow-Shop",
      "Growbox",
      "THC",
      "HHC",
      "HHC-Liquid",
      "Legal Highs",
      "Lachgas",
      "Lachgas-Kartuschen",
      "Ecstasy",
      "MDMA",
      "Kokain",
      "Koks",
      "LSD",
      "Zauberpilze",
      "Heroin",
      "Crystal Meth",
      "Amphetamine",
      "Ketamin",
      "Suchtgift",
      "Suchtmittel",
      "Betäubungsmittel",
      "Narkotika",
      "Psychedelika",
      "Opioide",
      "Opiate",
      "Fentanyl",
      "Kratom",
      "Tilidin",
      "Xanax",
      "Codein",
      "Opium",
      "Meth",
      "Space Cookies",
      "Haschkekse",
      "Benzos",
      "Partypillen",
      "Aufputschmittel",
      "Gras kaufen",
      "high werden",
      "Partydroge",
    ],
    [
      "Drugs",
      "Party Drugs",
      "Weed",
      "Marijuana",
      "Cannabis Dispensary",
      "Hashish",
      "Ganja",
      "Spliff",
      "Bongs",
      "Cocaine",
      "Magic Mushrooms",
      "Shrooms",
      "Laughing Gas",
      "Legal High",
      "Narcotics",
      "Ketamine",
      "Methamphetamine",
      "Psychedelics",
      "Opioids",
      "Opiates",
      "Edibles",
      "drug",
      "stoner merch",
      "Grinders",
      "Stoners",
      "dab pens",
    ],
    [
      "Drogerie",
      "Drogeriemarkt",
      "Drogerieartikel",
      "dm Drogerie",
      "Drogist",
      "Drugstore",
      "Drug Store",
      "Gras",
      "Grasgrün",
      "Rasensamen",
      "Speed",
      "Speedboat",
      "Highspeed-Internet",
      "Speed Cube",
      "Hanfseil",
      "Hanföl",
      "Hanfsamen",
      "Hanfprotein",
      "Kokosnuss",
      "Kokosöl",
      "Joint Venture",
      "Bongos",
      "Bonbon",
      "Kaffee-Grinder",
      "Coffee Grinder",
      "Angle Grinder",
      "Heroine",
      "Heldin",
      "Haschee",
      "Hashtag",
      "Hash Browns",
      "Seaweed",
      "Tweed",
      "Ekstase",
      "Lachgummi",
      "LCD-Fernseher",
      "HTC",
      "Pilzsuppe",
      "Mushroom Pizza",
      "Zauberkasten",
      "Vitamin C",
      "Multivitamin",
      "Black Opium",
      "Badesalz",
      "Skiff",
      "Kokon",
      "Hydrogen",
      "androgen",
      "Psychedelic Rock",
      "Edible Flowers",
      "Narkose",
      "Betäubung",
      "Suchtrupp",
      "Suchmaschine",
      "Drugstore Makeup",
      "Pfeffer-Grinder",
      "Skate-Grinder",
      "Kiffhäuser",
      "Stoner Rock Playlist",
      "Methode",
      "Party Poppers",
      "Kräutermischung",
      "Schmerzmittel",
      "Hasch mich",
      "Koks-Grill",
      "CBD-freies Shampoo",
      "Hanfprodukte",
      "Dispensary",
    ],
  ],
];

describe.each(THEMEN)("%s", (_thema, ist, deutsch, englisch, harmlos) => {
  test.each(deutsch)("deutsch, muss gefangen werden: %s", (eintrag) => {
    expect(ist(eintrag)).toBe(true);
  });
  test.each(englisch)("englisch, muss gefangen werden: %s", (eintrag) => {
    expect(ist(eintrag)).toBe(true);
  });
  test.each(harmlos)("darf NICHT gefangen werden: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
  });
});

describe("Deutsch und Englisch je Begriff", () => {
  /* Die Analyse läuft deutsch oder englisch: Jeder Begriff muss in beiden
     Sprachen gefangen werden. */
  test.each([
    [_istBeiMinderjaehrigenVerboten, "Alkohol", "Alcohol"],
    [_istBeiMinderjaehrigenVerboten, "Bier", "Beer"],
    [_istBeiMinderjaehrigenVerboten, "Wein", "Wine"],
    [_istBeiMinderjaehrigenVerboten, "Wodka", "Vodka"],
    [_istBeiMinderjaehrigenVerboten, "Whisky", "Whiskey"],
    [_istBeiMinderjaehrigenVerboten, "Likör", "Liqueur"],
    [_istBeiMinderjaehrigenVerboten, "Tabak", "Tobacco"],
    [_istBeiMinderjaehrigenVerboten, "Zigarette", "Cigarette"],
    [_istBeiMinderjaehrigenVerboten, "Nikotin", "Nicotine"],
    [_istBeiMinderjaehrigenVerboten, "Wette", "Bet"],
    [_istBeiMinderjaehrigenVerboten, "Glücksspiel", "Gambling"],
    [_istBeiMinderjaehrigenVerboten, "Lotterie", "Lottery"],
    [_istBeiMinderjaehrigenVerboten, "Darlehen", "Loan"],
    [_istBeiMinderjaehrigenVerboten, "Schulden", "Debt"],
    [_istBeiMinderjaehrigenVerboten, "Diät", "Diet"],
    [_istBeiMinderjaehrigenVerboten, "Fettabsaugung", "Liposuction"],
    [_istBeiMinderjaehrigenVerboten, "Drogen", "Drugs"],
    [_istBeiMinderjaehrigenVerboten, "Marihuana", "Marijuana"],
    [_istBeiMinderjaehrigenVerboten, "Kokain", "Cocaine"],
    [_istBeiMinderjaehrigenVerboten, "Haschisch", "Hashish"],
    [_istBeiMinderjaehrigenVerboten, "Lachgas", "Laughing Gas"],
    [_istBeiMinderjaehrigenVerboten, "Opioide", "Opioids"],
    [_istBeiMinderjaehrigenVerboten, "Psychedelika", "Psychedelics"],
    [_istBeiMinderjaehrigenVerboten, "Zauberpilze", "Magic Mushrooms"],
    [_istImmerVerboten, "Pornografie", "Pornography"],
    [_istImmerVerboten, "Bordell", "Brothel"],
    [_istImmerVerboten, "Waffe", "Weapon"],
    [_istImmerVerboten, "Pistole", "Pistol"],
    [_istImmerVerboten, "Gewehr", "Rifle"],
    [_istImmerVerboten, "Munition", "Ammunition"],
    [_istImmerVerboten, "Armbrust", "Crossbow"],
    [_istImmerVerboten, "Extremismus", "Extremism"],
    [_istImmerVerboten, "Terrorismus", "Terrorism"],
    [_istImmerVerboten, "Hakenkreuz", "Swastika"],
  ])("%p: %s und %s", (ist, deutsch, englisch) => {
    expect(ist(deutsch)).toBe(true);
    expect(ist(englisch)).toBe(true);
  });
});

describe("Wetten und Tabak: Listenwörter in der Hauptsprache, einzeln gehalten", () => {
  const ELF = [
    "Wettanbieter Vergleich",
    "Buchmacher Quoten",
    "Kombiwetten Tipps",
    "Online-Wetten Bonus",
    "Wetten Abo",
    "Zigaretten Stange",
    "Tabak Pouches",
    "Vape Liquids",
    "E-Shisha Starterset",
    "Nikotinpflaster",
    "Snus Dosen",
  ];

  test.each(ELF)("%s", (eintrag) => {
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(true);
  });

  test("bei einer 13-Jährigen bleibt von zwölf Einträgen nur der harmlose", () => {
    const p = profil(KIND, [...ELF, "Lego Set"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Lego Set"]);
    expect(b.entfernt.filter((e) => e.modus === "normal")).toHaveLength(11);
  });
});

describe("Text wird vor dem Vergleich vereinheitlicht", () => {
  test.each([
    ["Only Fans", "only fans"],
    ["Only-Fans", "only fans"],
    ["Gin - Tonic", "gin tonic"],
    ["Wein-/Sektempfang", "wein sektempfang"],
    ["ONLYFANS", "onlyfans"],
    ["Glücksspiel", "gluecksspiel"],
    ["Brustvergrößerung", "brustvergroesserung"],
    ["Brustvergrösserung", "brustvergroesserung"],
    ["Roséwein", "rosewein"],
    ["Jack Daniel's", "jack daniels"],
    ["Heckler & Koch", "heckler koch"],
    ["Schönheits-OP / Beauty_OP", "schoenheits op beauty op"],
    ["0%-Finanzierung", "0% finanzierung"],
  ])("%s → %s", (roh, erwartet) => {
    expect(_vereinheitlicht(roh)).toBe(erwartet);
  });

  test("zerlegte Umlaute, Vollbreite-Zeichen und unsichtbare Trennzeichen", () => {
    /* Sonderzeichen ueber ihre Nummer gebaut, damit im Quelltext nichts
       Unsichtbares steht: 0x308 = Trema zum Anhaengen, 0xff41 ff. = Vollbreite,
       0xad = weiches Trennzeichen, 0x200b = Leerzeichen ohne Breite. */
    const zeichen = (nummer) => String.fromCodePoint(nummer);
    const zerlegt = `Glu${zeichen(0x308)}cksspiel`;
    const vollbreite = [..."onlyfans"].map((b) => zeichen(b.codePointAt(0) + 0xfee0)).join("");
    const weichesTrennzeichen = `Only${zeichen(0xad)}Fans`;
    const nullbreite = `Kre${zeichen(0x200b)}dit`;
    /* Positivkontrolle: Die Eingaben sind wirklich die Sonderformen. */
    expect(zerlegt).toHaveLength("Glücksspiel".length + 1);
    expect(weichesTrennzeichen).toHaveLength("OnlyFans".length + 1);
    expect(_vereinheitlicht(zerlegt)).toBe("gluecksspiel");
    expect(_vereinheitlicht(vollbreite)).toBe("onlyfans");
    expect(_istBeiMinderjaehrigenVerboten(zerlegt)).toBe(true);
    expect(_istImmerVerboten(vollbreite)).toBe(true);
    expect(_istImmerVerboten(weichesTrennzeichen)).toBe(true);
    expect(_istBeiMinderjaehrigenVerboten(nullbreite)).toBe(true);
  });

  test("verträgt alles, was kein Text ist", () => {
    for (const wert of [null, undefined, 0, 42, {}, [], ""]) {
      expect(() => _istImmerVerboten(wert)).not.toThrow();
      expect(_istImmerVerboten(wert)).toBe(false);
      expect(_istBeiMinderjaehrigenVerboten(wert)).toBe(false);
    }
  });
});

describe("Wörter, die nur als Werbe-Eintrag gelten", () => {
  /* Als Werbe-Eintrag eindeutig, im ganzen Satz meist etwas anderes. In
     Erklärsätzen und Fließtext zählen sie nicht — sonst flöge Aufklärung
     hinaus und harmlose Sprachbilder lösten einen Alarm aus. */
  const SAETZE_STUFE_1 = [
    "Dein Lächeln ist deine stärkste Waffe gegen Zweifel.",
    "Marken kämpfen mit allen Waffen um deine Aufmerksamkeit.",
    "Your smile is your secret weapon.",
    "The person on the far right of the picture is smiling.",
    "Not only fans of the brand buy this.",
    "Sexting-Druck im Klassenchat ist ein bekanntes Risiko.",
  ];
  const SAETZE_STUFE_2 = [
    "Wir raten dir, weniger zu scrollen.",
    "Ich wette, du scrollst nachts.",
    "Du hängst viel rum und wirkst entspannt.",
    "Als Radler bist du viel draußen.",
    "Du würdest gern abnehmen, sagen die Anzeigen.",
    "A balanced diet matters to you.",
    "You are in high spirits.",
    "Dafür wirst du später bezahlen.",
    "Es steht viel auf dem Spiel: a lot is at stake.",
  ];

  test.each(SAETZE_STUFE_1)("Stufe 1 trifft den Satz nicht: %s", (satz) => {
    expect(_istImmerVerboten(satz, false)).toBe(false);
  });
  test.each(SAETZE_STUFE_2)("Stufe 2 trifft den Satz nicht: %s", (satz) => {
    expect(_istBeiMinderjaehrigenVerboten(satz, false)).toBe(false);
  });

  test.each([["Waffe"], ["Waffen"], ["Weapons"], ["Only Fans"], ["Far-right apparel"], ["Sexting-App"]])(
    "als Werbe-Eintrag fliegt es bei allen: %s",
    (eintrag) => {
      expect(_istImmerVerboten(eintrag)).toBe(true);
      const p = profil(ERWACHSEN, [eintrag, "Nike"]);
      applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual(["Nike"]);
    }
  );

  test.each([["In 12 Raten"], ["Wette"], ["Rum"], ["Radler"], ["Abnehmen"], ["Diet"], ["Velo"], ["Stake"]])(
    "als Werbe-Eintrag fliegt es bei einem Kind: %s",
    (eintrag) => {
      const p = profil(KIND, [eintrag, "Nike"]);
      applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual(["Nike"]);
    }
  );

  test("Erklärsätze und Fließtext mit diesen Wörtern bleiben stehen und werden nicht gezählt", () => {
    const p = profil(KIND, ["Nike"], {
      manipulation_triggers: [...SAETZE_STUFE_1],
      profileText: [...SAETZE_STUFE_1, ...SAETZE_STUFE_2].join(" "),
    });
    const b = applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual(SAETZE_STUFE_1);
    expect(b.entfernt).toEqual([]);
    expect(b.durchgerutscht).toEqual([]);
  });

  /* Gegenprobe: Was überall gilt, greift auch im Erklärsatz und im Fließtext. */
  test("ein Wort, das überall gilt, greift auch im Satz", () => {
    const trigger = "Wir verkaufen dir eine Softair-Pistole.";
    const p = profil(ERWACHSEN, ["Nike"], { manipulation_triggers: [trigger], profileText: "Du magst Pornoseiten." });
    const b = applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual([]);
    expect(b.durchgerutscht.map((d) => d.stichwort)).toEqual(["porn", "porn"]);
  });
});

describe("Pistole, Gewehr, Revolver gelten nur als Werbe-Eintrag", () => {
  /* Im Satz stehen sie in Redewendungen und Bildbeschreibungen; als
     Werbe-Kärtchen sind sie eindeutig. Softair, Schreckschuss, Munition und
     die übrigen eindeutigen Waffenwörter gelten weiter überall. */
  const SAETZE = [
    "Du lachst wie aus der Pistole geschossen los.",
    "Auf dem Bild ist ein Soldat mit Gewehr zu sehen.",
    "Du trägst ein Kostüm mit Spielzeuggewehr.",
    "Das Kind hält eine Wasser-Pistole in der Hand.",
    "Im Western-Kostüm steckt ein Revolver im Gürtel.",
    "She answers quick as a pistol.",
  ];

  let zeilen;
  beforeEach(() => {
    zeilen = [];
    jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(z));
    jest.spyOn(console, "error").mockImplementation((z) => zeilen.push(z));
  });
  afterEach(() => jest.restoreAllMocks());

  test.each(SAETZE)("im Satz kein Treffer: %s", (satz) => {
    expect(_istImmerVerboten(satz, false)).toBe(false);
  });

  test("Erklärsätze und Fließtext bleiben stehen, werden nicht gezählt und lösen keinen Alarm aus", () => {
    const p = profil(ERWACHSEN, ["Nike"], { manipulation_triggers: [...SAETZE], profileText: SAETZE.join(" ") });
    p.normal.categories.interessen = { value: SAETZE.join(" ") };
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(p.normal.manipulation_triggers).toEqual(SAETZE);
    expect(b.entfernt).toEqual([]);
    expect(b.durchgerutscht).toEqual([]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(false);
    /* Positivkontrolle: Die Protokollzeile selbst wurde geschrieben. */
    expect(zeilen.some((z) => z.includes('"minor-safety"'))).toBe(true);
  });

  /* Gegenprobe: Ein eindeutiges Waffenwort im Fließtext wird weiter gezählt
     und löst den Alarm aus. */
  test("Softair-Pistole im Fließtext: gezählt, Alarmzeile geschrieben", () => {
    const p = profil(ERWACHSEN, ["Nike"], { profileText: "Du wünschst dir eine Softair-Pistole." });
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(b.durchgerutscht.map((d) => d.grund)).toEqual(["immer", "immer"]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(true);
  });

  test.each([
    ["Pistole"],
    ["Pistolen"],
    ["Pistol"],
    ["Gewehr"],
    ["Luftgewehr"],
    ["Jagdgewehre"],
    ["Revolver"],
    ["Softair-Pistole"],
    ["Schreckschusspistole"],
    ["Luft-Pistole"],
  ])("als Werbe-Eintrag fliegt es bei allen: %s", (eintrag) => {
    const p = profil(ERWACHSEN, [eintrag, "Nike"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike"]);
  });

  /* Zusammen, getrennt und mit Bindestrich geschrieben gilt dasselbe. Beim
     Kind geprüft, damit auch Stufe 2 nicht zugreift ("Spritz" ist dort ein
     Listenwort). */
  test.each([
    ["Wasserpistole"],
    ["Wasser-Pistole"],
    ["Wasser Pistole"],
    ["Nerf-Pistole"],
    ["Nerfpistole"],
    ["Heißklebe-Pistole"],
    ["Heißklebepistole"],
    ["Klebepistole"],
    ["Spritzpistole"],
    ["Spritz-Pistole"],
    ["Massage-Pistole"],
    ["Spielzeug-Pistole"],
    ["Wassergewehr"],
    ["Wasser-Gewehr"],
    ["Spielzeuggewehr"],
    ["Gun Metal Grey"],
    ["Gunmetal"],
    ["Gun-Metal"],
    ["Water Pistol"],
    ["Toy Gun"],
  ])("Spielzeug und Bastelbedarf bleiben als Werbe-Eintrag stehen: %s", (eintrag) => {
    const p = profil(KIND, [eintrag, "Nike"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual([eintrag, "Nike"]);
    expect(b.applied).toBe(false);
  });

  /* Die harmlose Form verdeckt kein Waffenwort daneben. */
  test.each([["Wasser-Pistole und Softair-Pistole"], ["Gun Metal Grey Guns"], ["Wassergewehr mit Munition"]])(
    "daneben wird weiter gefangen: %s",
    (eintrag) => {
      expect(_istImmerVerboten(eintrag)).toBe(true);
    }
  );
});

describe("Nachschärfung nach der fremden Prüfreihe", () => {
  /* Was überall gilt, löst im Fließtext den Alarm aus. Dorthin gehören nur
     Wörter, die in einem Profiltext nichts verloren haben: Namen, Symbole,
     Organisationen, eindeutige Waren. Abstrakte Begriffe, die in einem
     Aufklärungs- oder Erklärsatz stehen können, gelten nur als
     Werbe-Eintrag. */
  let zeilen;
  beforeEach(() => {
    zeilen = [];
    jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(z));
    jest.spyOn(console, "error").mockImplementation((z) => zeilen.push(z));
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ["Hitler"],
    ["KKK"],
    ["ISIS"],
    ["Taliban"],
    ["QAnon"],
    ["Sprengstoff"],
    ["Schrotflinte"],
    ["Machete"],
    ["Zielfernrohr"],
    ["Dildo"],
  ])("gilt überall, auch im Satz: %s", (wort) => {
    expect(_istImmerVerboten(wort)).toBe(true);
    expect(_istImmerVerboten(`Im Text steht ${wort} und mehr.`, false)).toBe(true);
  });

  test.each([
    ["Faschismus"],
    ["Antisemitismus"],
    ["Radikalisierung"],
    ["Rassenhass"],
    ["Volksverhetzung"],
    ["Hassgruppen"],
    ["Propaganda"],
    ["Erotik"],
    ["Erotische Dessous"],
    ["Striptease"],
    ["Nacktbilder"],
    ["Nudes"],
    ["Sexkontakte"],
    ["Granate"],
    ["Dolch"],
    ["Flinte"],
    ["Shotgun"],
    ["Shotguns"],
  ])("gilt nur als Werbe-Eintrag: %s", (wort) => {
    expect(_istImmerVerboten(wort)).toBe(true);
    expect(_istImmerVerboten(`Im Text steht ${wort} und mehr.`, false)).toBe(false);
    const p = profil(ERWACHSEN, [wort, "Nike"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike"]);
  });

  const SAETZE_STUFE_1 = [
    "Erotik spielt in deinem Feed keine Rolle.",
    "Dein Feed könnte bald erotische Inhalte zeigen.",
    "Your feed could turn erotic soon.",
    "Du betreibst hier einen kleinen Seelen-Striptease.",
    "You are riding shotgun in your own life.",
    "Faschismus und Antisemitismus kennst du aus dem Geschichtsunterricht.",
    "Radikalisierung beginnt oft mit harmlosen Memes.",
    "Dein Radikalisierungsrisiko ist gering.",
    "Propaganda erreicht dich über kurze Videos.",
    "Sex: female",
    "Deine sexuelle Orientierung geht Werbetreibende nichts an.",
    "Sexismus in der Werbung trifft auch dich.",
    "Jemand könnte dich zu Nacktbildern überreden wollen.",
    "Du bist eine Granate im Tor.",
    "Du wirfst nicht gleich die Flinte ins Korn.",
    "Auf deinem Shirt ist das Playboy-Logo zu sehen.",
  ];
  const SAETZE_STUFE_2 = [
    "Das macht deine Zurückhaltung wieder wett.",
    "Du trinkst ein alkoholfreies Getränk.",
    "Du scheinst nicht zu rauchen.",
    "Deine Eltern schulden dir noch ein neues Handy.",
    "Das wäre wie ein Lottogewinn für dich.",
    "Dein Handy ist deine Droge.",
    "Social Media ist für dich wie eine Droge.",
    "Likes are your drugs.",
    "You are hooked on likes like a drug.",
    "You are in debt to your friends.",
    "I bet you spend hours on your phone.",
    "You are a safe bet for sneaker brands.",
    "Für Werbetreibende bist du ein Jackpot.",
    "You hit the jackpot with this outfit.",
    "Ich könnte wetten, dass du viel Zeit am Handy verbringst.",
    "Du siehst aus, als würdest du gleich weinen. Wein nicht.",
    "Das Foto ist vor einer Trafik entstanden.",
    "Du würdest Freunden jederzeit Geld leihen.",
    "Die Stimmung könnte schnell kippen.",
    "Du würdest für gute Noten sogar die Ohren anlegen.",
  ];

  test.each(SAETZE_STUFE_1)("Stufe 1 trifft den Satz nicht: %s", (satz) => {
    expect(_istImmerVerboten(satz, false)).toBe(false);
  });
  test.each(SAETZE_STUFE_2)("Stufe 2 trifft den Satz nicht: %s", (satz) => {
    expect(_istBeiMinderjaehrigenVerboten(satz, false)).toBe(false);
  });

  test("Kind: Erklärsätze und Fließtext mit diesen Sätzen bleiben stehen, nichts gezählt, kein Alarm", () => {
    const alle = [...SAETZE_STUFE_1, ...SAETZE_STUFE_2];
    const p = profil(KIND, ["Nike"], { manipulation_triggers: [...alle], profileText: alle.join(" ") });
    p.normal.categories.interessen = { value: alle.join(" ") };
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(p.normal.manipulation_triggers).toEqual(alle);
    expect(b.entfernt).toEqual([]);
    expect(b.durchgerutscht).toEqual([]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(false);
    /* Positivkontrolle: Die Protokollzeile selbst wurde geschrieben. */
    expect(zeilen.some((z) => z.includes('"minor-safety"'))).toBe(true);
  });

  /* Gegenproben: Ein Name löst den Alarm aus; ein Satz, der wirklich vom
     Thema handelt, wird weiter gezählt. */
  test("ein Name im Fließtext: gezählt, Alarmzeile geschrieben", () => {
    const p = profil(ERWACHSEN, ["Nike"], { profileText: "Auf dem Poster hinter dir steht Hitler." });
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(b.durchgerutscht.map((d) => [d.grund, d.stichwort])).toEqual([
      ["immer", "hitler"],
      ["immer", "hitler"],
    ]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(true);
  });

  test("Kind: „Auf dem Tisch steht ein Glas Wein.“ wird weiter gezählt, ohne Alarm", () => {
    const p = profil(KIND, ["Nike"], { profileText: "Auf dem Tisch steht ein Glas Wein." });
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(b.durchgerutscht.map((d) => [d.grund, d.stichwort])).toEqual([
      ["minor", "wein"],
      ["minor", "wein"],
    ]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(false);
  });

  test.each([
    ["Wett"],
    ["Lotto"],
    ["Lottoschein"],
    ["Jackpot"],
    ["Bet"],
    ["Schulden"],
    ["Debt"],
    ["Rauchen"],
    ["Droge"],
    ["Drug"],
    ["Drugs"],
    ["Abnehmtipps"],
    ["Abnehmspritze"],
    ["Trafik"],
    ["Kippen"],
    ["Geld leihen"],
  ])("als Werbe-Eintrag fliegt es bei einem Kind: %s", (eintrag) => {
    const p = profil(KIND, [eintrag, "Nike"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike"]);
  });

  /* Die harmlose Wendung verdeckt kein Sperrwort daneben. */
  test.each([
    ["Seifenblasen-Pistole", false],
    ["Seifenblasen-Pistole und Softair-Pistole", true],
    ["Bubble Gun", false],
    ["Bubble Gun und Shotgun", true],
    ["Sexualkunde", false],
    ["Sexualkunde und Sexkontakte", true],
    ["Lil Uzi Vert Merch", false],
    ["Uzi", true],
    ["Mundpropaganda", false],
    ["NS-Propaganda", true],
    ["Shotgun-Mikrofon", false],
    ["Shotgun-Mikrofon und Shotgun", true],
    ["Rifle Jeans", false],
    ["Rifle Jeans und Rifles", true],
  ])("Stufe 1: %s → %p", (eintrag, erwartet) => {
    expect(_istImmerVerboten(eintrag)).toBe(erwartet);
  });

  test.each([
    ["Alkoholfreie Getränke", false],
    ["Alkoholfreies Bier", true],
    ["Nikotinfrei", false],
    ["Nikotinfreie Vapes", true],
    ["Casino Royale Film", false],
    ["Casino Royale Online Casino", true],
    ["Lotto Fußballschuhe", false],
    ["Lotto Sportwetten", true],
    ["Hyaluron-Creme", false],
    ["Hyaluron-Creme mit Botox-Effekt", true],
    ["Hyaluron", false],
    ["Hyaluron-Filler", true],
    ["Drugstore Makeup", false],
    ["Drug Store und Drugs", true],
    ["Abnehmbare Zahnspange", false],
    ["Abnehmbare Zahnspange zum Abnehmen", true],
    ["Klarname", false],
    ["Klarna", true],
    ["Klarnas", true],
    ["Diet Coke", false],
    ["Diet Coke Diet Plan", true],
    ["Filler-Episoden", false],
    ["Lip Filler", true],
    ["Wetten dass..? DVD", false],
    ["Wetten dass und Sportwetten", true],
    ["Velo-Helm", false],
    ["Velo", true],
  ])("Stufe 2: %s → %p", (eintrag, erwartet) => {
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(erwartet);
  });

  /* Entscheidung vom 16.09.2026 (prompt-sprachregeln.test.js): Slang mit
     „Porn“ soll im Fließtext den Alarm auslösen — auch „Food-Porn“. Keine
     harmlose Wendung. */
  test.each([
    ["Der Teller sieht nach Food-Porn für Instagram aus."],
    ["Der Teller sieht nach Foodporn für Instagram aus."],
    ["This plate is pure food porn."],
  ])("„Food-Porn“ im Fließtext: gezählt, Alarmzeile geschrieben: %s", (satz) => {
    const p = profil(ERWACHSEN, ["Nike"], { profileText: satz });
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(b.durchgerutscht.map((d) => d.grund)).toEqual(["immer", "immer"]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(true);
  });

  /* „gun“, „guns“ und „rifle“ galten schon vor dem 04.10.2026 überall und
     bleiben es. „shotgun“ kam neu dazu und gilt deshalb nur als
     Werbe-Eintrag — wie Gewehr. */
  test.each([
    ["A man with a gun stands next to you.", true],
    ["Two guns hang on the wall.", true],
    ["A hunting rifle leans on the wall.", true],
    ["A man with a shotgun stands next to you.", false],
    ["You are riding shotgun in your own life.", false],
  ])("englische Waffenwörter im Satz: %s → %p", (satz, erwartet) => {
    expect(_istImmerVerboten(satz, false)).toBe(erwartet);
  });

  /* „Sex“ als ganzes Wort und „Pistols“ bleiben frei: „Sex: female“ ist eine
     Angabe, „Sex Pistols“ eine Band. Gefangen werden die Zusammensetzungen,
     in jeder Schreibweise. */
  test.each([
    ["Sex: female"],
    ["Sex"],
    ["Sexualkunde"],
    ["Unisex Toys"],
    ["Sex Pistols"],
    ["Pistols"],
    ["Sextett"],
    ["Sex Education"],
    ["Sex and the City"],
    ["sexy Outfit"],
    ["Sex-Appeal"],
  ])("bleibt als Werbe-Eintrag stehen, auch bei einem Kind: %s", (eintrag) => {
    const p = profil(KIND, [eintrag, "Nike"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual([eintrag, "Nike"]);
    expect(b.applied).toBe(false);
  });

  test.each([
    ["Sexspielzeug"],
    ["Sex-Spielzeug"],
    ["Sex Spielzeug"],
    ["Sexfilme"],
    ["Sex-Filme"],
    ["Sex Filme"],
    ["Sexvideos"],
    ["Sex-Videos"],
    ["Sex Videos"],
    ["Sex-Hotline"],
    ["Sexkontakte"],
    ["Sex Dating"],
    ["Telefon Sex"],
    ["Cyber-Sex"],
    ["erotisch"],
    ["Erotische Massage"],
  ])("wird bei allen gestrichen: %s", (eintrag) => {
    const p = profil(ERWACHSEN, [eintrag, "Nike"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike"]);
  });

  /* Die Ersatz-Angebote, die der Prompt bei Minderjährigen ausdrücklich
     nennt (locales/de/prompts.js, Regel zu beast.ad_targeting), sind
     Lerninhalt: Kein Listenwort darf sie treffen. */
  test("die Ersatz-Angebote des Prompts für Minderjährige bleiben stehen", () => {
    const ersatz = [
      "In-App-Käufe",
      "Lootboxen",
      "Lootbox",
      "Gaming-Abos",
      "Influencer-Merch",
      "Sammelkarten",
      "Sammelkarten-Mechaniken",
      "Statuskleidung",
      "in-app purchases",
      "lootboxes",
      "loot boxes",
      "gaming subscriptions",
      "influencer merch",
      "trading cards",
      "trading-card mechanics",
      "status clothing",
    ];
    for (const teil of [ersatz.slice(0, 8), ersatz.slice(8)]) {
      const p = profil(KIND, teil);
      const b = applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual(teil);
      expect(b.applied).toBe(false);
    }
  });
});

describe("Drogen werden bei möglicherweise Minderjährigen wie Alkohol behandelt", () => {
  /* Entscheidung vom 04.10.2026. Stufe 2: nur Werbe-Einträge, nur bis zur
     Schutzgrenze; bei Erwachsenen bleiben sie; im Fließtext wird gezählt,
     ohne Alarm; Erklärsätze bleiben stehen. */
  const WERBUNG = ["Cannabis-Shop", "CBD-Öl", "Lachgas-Kartuschen", "Weed", "Bong", "Legal Highs", "Nike"];

  let zeilen;
  beforeEach(() => {
    zeilen = [];
    jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(z));
    jest.spyOn(console, "error").mockImplementation((z) => zeilen.push(z));
  });
  afterEach(() => jest.restoreAllMocks());

  test("Kind: die Werbe-Einträge fliegen, als Grund steht die Altersstufe", () => {
    const p = profil(KIND, WERBUNG);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike"]);
    expect([...new Set(b.entfernt.map((e) => e.grund))]).toEqual(["minor"]);
  });

  test("Untergrenze 25: fliegen; Untergrenze 26: bleiben", () => {
    const grenze = profil("Du bist weiblich, ~27 Jahre alt (Spanne 25-30).", WERBUNG);
    applyMinorSafety(grenze);
    expect(grenze.normal.ad_targeting).toEqual(["Nike"]);
    const darueber = profil("Du bist weiblich, ~28 Jahre alt (Spanne 26-32).", WERBUNG);
    applyMinorSafety(darueber);
    expect(darueber.normal.ad_targeting).toEqual(WERBUNG);
  });

  test("Erwachsener: alles bleibt, nichts wird gezählt", () => {
    const p = profil(ERWACHSEN, WERBUNG, { profileText: "Du kiffst vermutlich am Wochenende." });
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(WERBUNG);
    expect(b.applied).toBe(false);
    expect(b.durchgerutscht).toEqual([]);
  });

  test("Kind, Fließtext: gezählt mit Grund „minor“, kein Alarm; der Erklärsatz bleibt", () => {
    const satz = "Algorithmen können dir früh Werbung für Cannabis zeigen.";
    const p = profil(KIND, ["Nike"], {
      manipulation_triggers: [satz],
      profileText: "Drogen sind in deinem Umfeld ein Thema.",
    });
    const b = applyMinorSafety(p);
    loggeMinorSafety(b, "de");
    expect(p.normal.manipulation_triggers).toEqual([satz]);
    expect(b.durchgerutscht.map((d) => d.grund)).toEqual(["minor", "minor"]);
    expect(zeilen.some((z) => z.includes("minor-safety-durchbruch"))).toBe(false);
    expect(zeilen.some((z) => z.includes('"minor-safety"'))).toBe(true);
  });

  /* Als Werbe-Eintrag eindeutig, im Satz meist etwas anderes. */
  test.each([
    ["The garden is full of weed."],
    ["It was a joint effort of the whole class."],
    ["Pure ecstasy on your face after the goal."],
    ["Sie mahlt den Kaffee mit einem alten Grinder."],
  ])("im Satz kein Treffer: %s", (satz) => {
    expect(_istBeiMinderjaehrigenVerboten(satz, false)).toBe(false);
  });

  test.each([["Weed"], ["Joint"], ["Joints"], ["Ecstasy"], ["Grinder"]])(
    "als Werbe-Eintrag fliegt es bei einem Kind: %s",
    (eintrag) => {
      const p = profil(KIND, [eintrag, "Nike"]);
      applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual(["Nike"]);
    }
  );

  /* Die Fallen: Drogerie ist keine Droge, Gras meist Rasen, Speed meist
     Geschwindigkeit, Hanf steckt in Lebensmitteln und Bastelbedarf. */
  test("ein Kind behält Drogerie-, Garten- und Bastelwerbung vollständig", () => {
    const harmlos = [
      "dm Drogerie",
      "Drogeriemarkt Müller",
      "Drugstore Favorites",
      "Rasensamen",
      "Speed Cube",
      "Highspeed-Internet",
      "Hanfseil",
      "Hanfsamen-Müsli",
      "Coffee Grinder",
      "Black Opium",
    ];
    const p = profil(KIND, harmlos);
    const b = applyMinorSafety(p);
    /* Zehn Einträge werden auf acht gekappt; gestrichen wird keiner. */
    expect(p.normal.ad_targeting).toEqual(harmlos.slice(0, 8));
    expect(b.entfernt).toEqual([]);
  });
});

describe("Harmlose Wendungen werden vor dem Vergleich herausgenommen", () => {
  test("jede harmlose Wendung steht in der Schreibweise der Liste da", () => {
    expect(_SPERRLISTEN.harmlos.length).toBeGreaterThan(10);
    expect(_SPERRLISTEN.harmlos.filter((w) => !/^\*?[a-zäöüß0-9.][a-zäöüß0-9. ]*\*?$/.test(w))).toEqual([]);
  });

  /* Das Wort daneben wird trotzdem gefangen: Die harmlose Wendung verdeckt
     nichts. */
  test.each([
    ["Top Gun Shirt", false],
    ["Top Gun Shirt und Guns", true],
    ["Massage Gun", false],
    ["Massage Gun und Schusswaffe", true],
    ["Ford Escort Oldtimer", false],
    ["Ford Escort und Escort Service", true],
  ])("Stufe 1: %s → %p", (eintrag, erwartet) => {
    expect(_istImmerVerboten(eintrag)).toBe(erwartet);
  });

  test.each([
    ["People-Pleasing", false],
    ["People-Pleasing auf Leasing", true],
    ["Cocktailkleid", false],
    ["Cocktailkleid und Cocktail", true],
    ["Schnapsidee", false],
    ["Schnapsidee: Schnaps", true],
  ])("Stufe 2: %s → %p", (eintrag, erwartet) => {
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(erwartet);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Harmlose Wendungen stehen als ganze Wörter da (05.10.2026).
   Eine links offene Wendung nimmt auch das Ende eines fremden Wortes mit:
   „*schwein“ machte aus „Tischwein“ ein „Ti“ — der Wein war weg. Was ein
   Schwein, ein Sporn oder ein Insekt ist, steht deshalb aufgezählt in der
   Liste; „Pleasing“ und „Releasing“ stehen als Wortanfang da.
   ══════════════════════════════════════════════════════════════════════ */
describe("Harmlose Wendungen stehen als ganze Wörter da", () => {
  /* Ein Emoji belegt im Text zwei Plätze — jeder Fall auch mit einem davor. */
  const EMOJI = String.fromCodePoint(0x1f525);
  const mitEmoji = (liste) => [...liste, ...liste.map((e) => `${EMOJI} ${e}`)].map((e) => [e]);

  test.each(
    mitEmoji([
      "Tischwein",
      "Kirschwein",
      "Fischwein",
      "Frischwein",
      "Tischwein-Abo",
      "Rheinsekt",
      "Weinsekt",
      "Laptopleasing",
      "Shopleasing",
      "Hardwareleasing",
      "Softwareleasing",
    ])
  )("Stufe 2 fängt: %s", (eintrag) => {
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(true);
  });

  test.each(mitEmoji(["Teensporn", "Girlsporn", "Kidsporn", "Studentsporn"]))("Stufe 1 fängt: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(true);
    expect(_istImmerVerboten(`Auf dem Bildschirm steht ${eintrag}.`, false)).toBe(true);
  });

  test.each(
    mitEmoji([
      "Schwein",
      "Spar-Schwein",
      "Sparschwein",
      "Meerschwein",
      "Meerschweinchen",
      "Wildschwein",
      "Glücksschwein",
      "Marzipanschwein",
      "Hängebauchschwein",
      "Schweinebraten",
      "Sporn",
      "Ansporn",
      "anspornen",
      "Rittersporn",
      "Heißsporn",
      "Fersensporn-Einlagen",
      "Insekt",
      "Nutzinsekt",
      "Insekten",
      "Insektenhotel",
      "Insektenschutz",
      "Pleasing",
      "People-Pleasing",
      "Peoplepleasing",
      "People Pleasing Ratgeber",
      "Crowd-Pleasing Snacks",
      "releasing",
      "Releasing Stress",
    ])
  )("bleibt stehen: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(`Auf dem Tisch liegt ${eintrag}.`, false)).toBe(false);
  });

  /* Der Wächter gegen diese Fehlerart: Eine links offene Wendung darf den
     Kern eines links offenen Listenworts nicht hinter anderem Text enthalten
     („*schwein“ enthält „*wein“ hinter „sch“) — sie verdeckte sonst jedes
     Wort, dessen vorderer Teil so endet. Bewusste Ausnahme: „*diskreditier*“;
     dort müsste hinter „kredit“ auch „ier“ folgen, und kein Kredit-Wort ist
     so gebaut. */
  test("keine links offene harmlose Wendung verdeckt ein links offenes Listenwort", () => {
    const kern = (w) => w.replace(/[*+]/g, "");
    const listen = [_SPERRLISTEN.immer, _SPERRLISTEN.minor].flatMap((l) => [...l.ueberall, ...l.nurAlsWerbung]);
    const offen = listen.filter((w) => w.startsWith("*"));
    expect(offen.length).toBeGreaterThan(100);
    const verdeckt = [];
    for (const wendung of _SPERRLISTEN.harmlos.filter((w) => w.startsWith("*")))
      for (const wort of offen) if (kern(wendung).indexOf(kern(wort)) > 0) verdeckt.push(`${wendung} verdeckt ${wort}`);
    expect(verdeckt).toEqual(["*diskreditier* verdeckt *kredit*"]);
  });

  test("die Ausnahme verdeckt nichts daneben", () => {
    expect(_istBeiMinderjaehrigenVerboten("Diskreditierung")).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten("Diskreditierung auf Kredit")).toBe(true);
  });

  /* Bewusste Grenze: Was nicht aufgezählt ist, liest der Filter als Wein,
     Porn oder Sekt. Als Werbe-Eintrag wird es bei möglicherweise
     Minderjährigen gestrichen. */
  test.each([["Wollschwein"], ["Mastschwein"], ["Stechinsekt"]])(
    "nicht aufgezählt, wird als Alkohol gelesen: %s",
    (eintrag) => {
      expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(true);
    }
  );

  test("nicht aufgezählt, wird als Pornografie gelesen: Hahnensporn", () => {
    expect(_istImmerVerboten("Hahnensporn")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Spiele-Käufe: „Skin“ ist keine Waffe (05.10.2026). Skins sind die Art
   Angebot, die der Prompt bei Minderjährigen als Ersatz nennt (In-App-Käufe).
   Anderes mit „Waffen“ bleibt gestrichen — ein Bauplan kann auch eine echte
   Waffe meinen.
   ══════════════════════════════════════════════════════════════════════ */
describe("Waffen-Skins sind harmlos, andere Waffen-Angebote nicht", () => {
  const EMOJI = String.fromCodePoint(0x1f525);

  test.each([
    ["Fortnite Waffen-Skins"],
    ["Waffenskins"],
    ["Waffen Skins"],
    ["Waffen-Skin-Paket"],
    ["Weapon Skins"],
    ["Weapon-Skins"],
    ["Weaponskins"],
    ["Gun Skins"],
    ["Gun-Skins"],
    ["Gunskin"],
    ["Valorant Weapon Skins"],
    [`${EMOJI} Fortnite Waffen-Skins`],
    [`${EMOJI} Weapon Skins`],
  ])("bleibt stehen: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
  });

  test.each([
    ["Call of Duty Waffen-Baupläne"],
    ["Waffen-Pack"],
    ["Waffenkiste"],
    ["Weapon Pack"],
    ["Waffen-Skins und Waffen"],
    ["Weapon Skins and Guns"],
    [`${EMOJI} Call of Duty Waffen-Baupläne`],
  ])("wird weiter gestrichen: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(true);
  });

  test("ein Kind behält die Skins, der Bauplan fliegt", () => {
    const p = profil(KIND, ["Fortnite Waffen-Skins", "Weapon Skins", "Call of Duty Waffen-Baupläne", "Lego Set"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Fortnite Waffen-Skins", "Weapon Skins", "Lego Set"]);
  });

  test("Glücksspiel mit Skins bleibt Glücksspiel", () => {
    expect(_istBeiMinderjaehrigenVerboten("Weapon Skin Gambling")).toBe(true);
    expect(_istBeiMinderjaehrigenVerboten("Skin-Gambling")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Zwei feste Fälle (05.10.2026).
   ══════════════════════════════════════════════════════════════════════ */
describe("Feste Fälle", () => {
  /* Über die Nummer gebaut: Das Zeichen belegt im Text zwei Plätze. Der
     Bindestrich dahinter darf deshalb nicht an der falschen Stelle
     weggelassen werden — „Bass-Drum“ wurde sonst als „rum“ gelesen. */
  const TROMMEL = String.fromCodePoint(0x1f941);

  test.each([[`${TROMMEL} Bass-Drum Set`], [`${TROMMEL}${TROMMEL} Bass-Drum Set`], ["Bass-Drum Set"]])(
    "bleibt stehen: %s",
    (eintrag) => {
      expect(_istImmerVerboten(eintrag)).toBe(false);
      expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
      const p = profil(KIND, [eintrag, "Lego Set"]);
      applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual([eintrag, "Lego Set"]);
    }
  );

  test("das Wort daneben wird trotzdem gefangen", () => {
    expect(_istBeiMinderjaehrigenVerboten(`${TROMMEL} Bass-Drum Set mit Rum`)).toBe(true);
  });

  /* Bewusst nicht: Ein Umlaut passt auf „ä“ und „ae“, nicht auf den nackten
     Vokal. Die KI schreibt keine kaputten Umlaute (SECURITY-MODEL, Abschnitt
     04.10.2026, „Was sie nicht leistet“). */
  test.each([["Glucksspiel"], ["Schonheits-OP"], ["Brustvergrosserung"], ["Diatpille"], ["Appetitzugler"]])(
    "Umlaut als nackter Vokal, bewusst nicht gefangen: %s",
    (eintrag) => {
      expect(_istImmerVerboten(eintrag)).toBe(false);
      expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
    }
  );

  test.each([
    ["Glücksspiel"],
    ["Gluecksspiel"],
    ["Schönheits-OP"],
    ["Schoenheits-OP"],
    ["Brustvergrößerung"],
    ["Diätpille"],
    ["Appetitzügler"],
  ])("mit Umlaut oder „e“ wird gefangen: %s", (eintrag) => {
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Schreibweisen: zusammen, mit Bindestrich, getrennt (A-01). Ein Bindestrich
   zwischen zwei Buchstaben ändert nichts — das Listenwort muss die Wortfuge
   dafür nicht kennen. Ein Leerzeichen an der Wortfuge trifft nur, wenn das
   Listenwort es notiert.
   ══════════════════════════════════════════════════════════════════════ */
describe("Schreibweisen mit Bindestrich und Leerzeichen", () => {
  const stufe = (text) =>
    _istImmerVerboten(text) ? "immer" : _istBeiMinderjaehrigenVerboten(text) ? "minor" : "DURCH";

  /* Die Paare der fremden Prüfreihe: jede Schreibweise wird gefangen, und
     zwar in derselben Stufe wie die zusammengeschriebene. */
  test.each([
    [["Sexspielzeug", "Sex-Spielzeug", "Sex Spielzeug"]],
    [["Sexfilme", "Sex-Filme"]],
    [["Sexkino", "Sex-Kino"]],
    [["Sexpuppe", "Sex-Puppe"]],
    [["Telefonsex", "Telefon-Sex"]],
    [["Softair", "Soft-Air", "Soft Air"]],
    [["Pfefferspray", "Pfeffer-Spray"]],
    [["Elektroschocker", "Elektro-Schocker"]],
    [["Kampfmesser", "Kampf-Messer"]],
    [["Spielautomaten", "Spiel-Automaten"]],
    [["Teilzahlung", "Teil-Zahlung"]],
    [["Fettabsaugung", "Fett-Absaugung"]],
    [["Brustvergrößerung", "Brust-Vergrößerung"]],
    [["Haartransplantation", "Haar-Transplantation"]],
    [["Appetitzügler", "Appetit-Zügler"]],
    [["Kalorienzähler", "Kalorien-Zähler"]],
    [["Intervallfasten", "Intervall-Fasten"]],
    [["Wasserpfeife", "Wasser-Pfeife"]],
    [["SlimFast", "Slim Fast", "Slim-Fast"]],
    [["JOYclub", "Joy Club"]],
    [["MyDirtyHobby", "My Dirty Hobby"]],
    [["Stripchat", "Strip Chat"]],
    [["Sexshop", "Sex-Shop", "Sex Shop"]],
    [["Schönheitsop", "Schönheits-OP", "Schönheits OP"]],
    [["Jägermeister", "Jaegermeister", "Jagermeister"]],
    [["Gösser", "Goesser", "Gosser"]],
  ])("%p", (schreibweisen) => {
    const stufen = schreibweisen.map(stufe);
    expect(stufen[0]).not.toBe("DURCH");
    expect(stufen).toEqual(schreibweisen.map(() => stufen[0]));
  });

  /* Dauerhaft gehalten, für jedes Listenwort: Das Beispiel der Tabelle wird
     mit einem Bindestrich an JEDER Stelle zwischen zwei Buchstaben weiter
     gefangen — als Werbe-Eintrag, und bei Wörtern, die überall gelten, auch
     im Satz. */
  const mitBindestrich = (text) => {
    const formen = [];
    for (let i = 1; i < text.length; i++) {
      if (/[\p{L}\p{N}]/u.test(text[i - 1]) && /[\p{L}\p{N}]/u.test(text[i]))
        formen.push(`${text.slice(0, i)}-${text.slice(i)}`);
    }
    return formen;
  };

  test.each([
    ["immer", _istImmerVerboten],
    ["minor", _istBeiMinderjaehrigenVerboten],
  ])("Stufe „%s“: ein Bindestrich im Beispiel eines Listenworts ändert nichts", (name, ist) => {
    const liste = _SPERRLISTEN[name];
    const durch = [];
    let geprueft = 0;
    for (const [wort, beispiel] of Object.entries(BEISPIEL_JE_WORT[name])) {
      for (const form of mitBindestrich(beispiel)) {
        geprueft++;
        if (!ist(form, true)) durch.push(`${wort}: ${form}`);
        if (liste.ueberall.includes(wort) && !ist(form, false)) durch.push(`${wort} (im Satz): ${form}`);
      }
    }
    /* Positivkontrolle der Messung: Es wurden wirklich Formen geprüft. */
    expect(geprueft).toBeGreaterThan(1000);
    expect(durch).toEqual([]);
  });

  /* Dasselbe hinter einem Emoji. Ein Emoji belegt im Text zwei Plätze; die
     Stelle des Bindestrichs darf sich dadurch nicht verschieben — sonst
     bliebe der Bindestrich stehen, und das Wort ginge durch. Gebaut über die
     Nummer des Zeichens: 0x1f525 = Flamme. */
  const EMOJI = String.fromCodePoint(0x1f525);

  test.each([
    ["immer", _istImmerVerboten],
    ["minor", _istBeiMinderjaehrigenVerboten],
  ])("Stufe „%s“: auch hinter einem Emoji ändert ein Bindestrich nichts", (name, ist) => {
    /* Positivkontrolle: Das Zeichen belegt wirklich zwei Plätze. */
    expect(EMOJI).toHaveLength(2);
    const liste = _SPERRLISTEN[name];
    const durch = [];
    let geprueft = 0;
    for (const [wort, beispiel] of Object.entries(BEISPIEL_JE_WORT[name])) {
      for (const form of mitBindestrich(beispiel)) {
        geprueft++;
        if (!ist(`${EMOJI} ${form}`, true)) durch.push(`${wort}: ${form}`);
        if (liste.ueberall.includes(wort) && !ist(`${EMOJI} ${form}`, false)) durch.push(`${wort} (im Satz): ${form}`);
      }
    }
    expect(geprueft).toBeGreaterThan(1000);
    expect(durch).toEqual([]);
  });

  /* Im Satz, auch mit mehr als drei Bindestrichen davor (dann gibt es nur
     die zwei Sichten „alle als Leerzeichen“ und „alle weggelassen“). */
  const VIELE_BINDESTRICHE = "Erst E-Mail, Know-how und Do-it-yourself.";

  test.each([
    ["Du spielst Soft-Air.", _istImmerVerboten],
    ["Du hast ein Pfeffer-Spray dabei.", _istImmerVerboten],
    ["Zum Fest gibt es Wod-ka.", _istBeiMinderjaehrigenVerboten],
  ])("im Satz hinter einem Emoji: „%s“ wird gelesen wie ohne", (satz, ist) => {
    expect(ist(satz, false)).toBe(true);
    expect(ist(`${VIELE_BINDESTRICHE} ${satz}`, false)).toBe(true);
    expect(ist(`${EMOJI} ${satz}`, false)).toBe(true);
    expect(ist(`${EMOJI}${EMOJI} ${VIELE_BINDESTRICHE} ${satz}`, false)).toBe(true);
  });

  /* Benannte Grenze (SECURITY-MODEL, „Zusammen, mit Bindestrich, getrennt“):
     Ab dem vierten Bindestrich im Text liest der Filter nur noch zwei
     Fassungen — alle Bindestriche als Leerzeichen, alle weggelassen. Ein Wort,
     das eine gemischte Lesart braucht (ein Bindestrich fällt weg, der andere
     trennt), wird im langen Text nicht gelesen. Als Werbe-Eintrag trägt die
     notierte Wortfuge weiter. Wer die Grenze verschiebt, ändert diesen Test
     und den Absatz im SECURITY-MODEL. */
  test("Grenze: gemischte Lesart nur bis drei Bindestriche im Text", () => {
    for (const satz of ["Du trägst ein Na-zi-Shirt.", "Du suchst einen Online-Waffen-Laden."]) {
      expect(_istImmerVerboten(satz, false)).toBe(true);
      expect(_istImmerVerboten(`${EMOJI} ${satz}`, false)).toBe(true);
      expect(_istImmerVerboten(`${VIELE_BINDESTRICHE} ${satz}`, false)).toBe(false);
    }
    expect(_istImmerVerboten("Top-Online-Waffen-Laden-Set", true)).toBe(true);
    expect(_istImmerVerboten(`${EMOJI} Top-Online-Waffen-Laden-Set`, true)).toBe(true);
  });

  /* Einträge mit notierter Wortfuge („+“ oder Leerzeichen) treffen als
     Werbe-Eintrag alle drei Schreibweisen: zusammen, mit Bindestrich,
     getrennt. Ausgenommen ist nur, was eine harmlose Wendung bewusst
     freistellt („auf Pump“ gegen „Aufpump-Service“). */
  const harmloseWendung = new RegExp(_SPERRLISTEN.harmlos.map(_muster).join("|"));
  const dreiSchreibweisen = (fuge) => [fuge.replace(/[ +]/g, ""), fuge.replace(/[ +]/g, "-"), fuge.replace(/\+/g, " ")];

  test.each([
    ["immer", _istImmerVerboten],
    ["minor", _istBeiMinderjaehrigenVerboten],
  ])("Stufe „%s“: Einträge mit Wortfuge treffen zusammen, Bindestrich und getrennt", (name, ist) => {
    const liste = _SPERRLISTEN[name];
    const mitFuge = [...liste.ueberall, ...liste.nurAlsWerbung].filter((w) => /[ +]/.test(w));
    const durch = [];
    for (const wort of mitFuge) {
      for (const form of dreiSchreibweisen(wort.replace(/\*/g, ""))) {
        if (!ist(form, true) && !harmloseWendung.test(_vereinheitlicht(form))) durch.push(`${wort}: ${form}`);
      }
    }
    expect(mitFuge.length).toBeGreaterThan(100);
    expect(durch).toEqual([]);
  });

  /* Die Wortfuge „+“ einer Zusammensetzung gilt im Fließtext nur zusammen
     und mit Bindestrich: Getrennt stehen dieselben zwei Wörter dort oft
     zufällig nebeneinander. Ein Leerzeichen im Eintrag (feste Fügung aus
     mehreren Wörtern) gilt in jeder Sicht getrennt. */
  test.each([
    ["Rotlichtviertel", true, true],
    ["Rotlicht-Viertel", true, true],
    ["Rotlicht Viertel", true, false],
    ["Schalldämpfer", true, true],
    ["Schall-Dämpfer", true, true],
    ["Schall Dämpfer", true, false],
    ["Pfefferspray", true, true],
    ["Pfeffer-Spray", true, true],
    ["Pfeffer Spray", true, false],
    ["Sex Shop", true, true],
    ["Ku Klux Klan", true, true],
  ])("Stufe 1: „%s“ — als Werbe-Eintrag %p, im Satz %p", (text, alsWerbung, imSatz) => {
    expect(_istImmerVerboten(text, true)).toBe(alsWerbung);
    expect(_istImmerVerboten(`Im Text steht ${text} und mehr.`, false)).toBe(imSatz);
  });

  test.each([
    ["Mietkauf", true, true],
    ["Miet-Kauf", true, true],
    ["Miet Kauf", true, false],
    ["Pall Mall", true, true],
  ])("Stufe 2: „%s“ — als Werbe-Eintrag %p, im Satz %p", (text, alsWerbung, imSatz) => {
    expect(_istBeiMinderjaehrigenVerboten(text, true)).toBe(alsWerbung);
    expect(_istBeiMinderjaehrigenVerboten(`Im Text steht ${text} und mehr.`, false)).toBe(imSatz);
  });

  /* Zwei Wörter, die im Satz zufällig nebeneinanderstehen, sind keine
     Zusammensetzung: kein Treffer, kein Alarm. */
  test.each([
    ["Sex spielt in deinem Feed keine Rolle."],
    ["Mit einem Schlag Stockwerke höher."],
    ["Das Spiel automatisch zu speichern, ist praktisch."],
    ["Der Islam ist eine Weltreligion."],
    ["Du trägst einen Hoodie in Mode Drogerie-Blau."],
  ])("zufällige Nachbarn im Satz zählen nicht: %s", (satz) => {
    expect(_istImmerVerboten(satz, false)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(satz, false)).toBe(false);
  });

  /* Harmlose Nachbarn als Werbe-Eintrag: Die getrennte Schreibweise steht
     bei kurzen zweiten Wortteilen als ganzes Wort in der Liste. */
  test.each([
    ["Soft AirPods Case"],
    ["Nike Air Softshell"],
    ["Saft Kurkuma Ingwer"],
    ["Mode Drogerie"],
    ["Islam ist Frieden"],
    ["Die T-Shirts"],
    ["Win E-Bike"],
    ["Unisex Camping"],
    ["Xbox Videos"],
  ])("bleibt als Werbe-Eintrag stehen: %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(eintrag)).toBe(false);
  });

  /* Dauerhaft gehalten: Ein langes Listenwort ohne notierte Wortfuge braucht
     eine Entscheidung — es steht in genau einer der zwei Prüflisten, sonst
     wird der Test rot.
       FUGE_ANDERSWO: Zusammensetzung, deren getrennte Schreibweise ein
         anderes Listenwort fängt („Wein Probe“ über „Wein“). Die drei
         Schreibweisen werden hier geprüft.
       OHNE_WORTFUGE: kein zusammengesetztes Wort („Kalaschnikow“) oder
         getrennte Schreibweise bewusst frei („Arm Brust“, „Pay Day“). */
  const FUGE_ANDERSWO =
    `you porn, schuss waffe, feuer waffe, jagd waffe, kriegs waffe, stich waffe, hieb waffe, gas waffe,
    luftdruck waffe, waffen handel, waffen laden, waffen shop, waffen geschäft, waffen händler,
    waffen schein, waffen börse, waffen zubehör, waffen besitz, waffen schrank, waffen sammlung,
    luft pistole, gas pistole, maschinen pistole, hand gun, hand granate, schrot flinte, nazi symbol,
    nazi parole, nazi propaganda, neo nazi, shot gun, luft gewehr, jagd gewehr, sturm gewehr,
    maschinen gewehr, poker stars, bet way, uni bet, sport wetten, wett anbieter, kombi wette,
    sport wette, live wette, wett büro, wett schein, wett bonus, wett quote, wett einsatz, wett konto,
    wett portal, wett lokal, wett tipp, wett app, raten kauf, raten zahlung, raten plan, weiß bier,
    weizen bier, dosen bier, flaschen bier, fass bier, frei bier, stark bier, bock bier, alt bier,
    craft bier, keller bier, lager bier, wein abo, wein probe, wein verkostung, wein handel,
    wein handlung, wein keller, wein gut, wein flasche, wein shop, wein laden, wein bar, wein paket,
    wein club, wein fest, wein schorle, wein kühlschrank, wein regal, wein kenner, wein liebhaber,
    wein reise, wein lieferung, wein versand, wein tasting, wein karte, wein glas, wein gläser,
    rot wein, weiß wein, glüh wein, sekt flasche, sekt glas, sekt empfang, sekt kellerei, wein brand,
    märzen bier, sekt frühstück, lippen filler, party droge, designer droge, einstiegs droge, mode droge`
      .split(/\s*,\s*/)
      .filter(Boolean);
  const OHNE_WORTFUGE =
    `*fansly*, *brazzers*, *chaturbate*, *amorelie*, eis.de, *prostitu*, *escort*, *bordell*, *brothel*,
    *hentai*, *munition*, *silencer*, *kalaschnikow*, glocks, machete*, nunchaku*, explosives,
    *extremis*, nazism*, terror*, *terrorism*, *terrorist*, islamism*, islamist*, *dschihad*, salafis*,
    swastika*, hitler*, taliban*, waffen*, *waffen, weapon*, pistol, *gewehr, *gewehre, *gewehren,
    *gewehrs, revolver, revolvers, *erotik*, erotic*, erotisch*, vibrator*, dolche, flinte, flinten,
    granate, granaten, grenades, beretta, faschis*, fascis*, identitäre, identitären, *propaganda*,
    pistole*, gewehr*, bewaffnung*, stripper*, hookers, sexting*, radikalisierung, radikalisierungen,
    radicalization, radicalisation, *tipico*, *betano*, *winamax*, novomatic, novoline, *casino*,
    *kasino*, *gambling*, *betting*, bookie*, *lotterie*, lottery*, roulette, spielothek*, rollbit,
    ladbrokes, wunderino, mozzart*, wagers, wagering, wagered, *kredit*, *darlehen*, *finanzierung*,
    *financing*, *riverty*, *cashper*, *schufa*, *inkasso*, *leasing*, *überziehung*, *umschuldung*,
    *hypothek*, *mortgage*, installment*, instalment*, klarna*, bonität*, stundung*, *alkohol*,
    *alcohol*, winzer*, vinothek*, *prosecco*, champagner*, champagne, *aperol*, spritz, campari,
    *tequila*, *cocktail*, *spirituose*, *whisky*, *whiskey*, schnaps*, *schnaps, *likör*, liqueur*,
    obstler, grappa, sambuca, absinth*, ciders, brauerei*, brewery*, brennerei*, distillery*,
    destillerie*, winery*, liquor, liquors, stiegl, gösser, heineken, bacardi, smirnoff*, baileys,
    sangria*, mojito*, caipirinha*, lillet, gosser, pilsner*, pilsener*, flügerl*, schnäpse*, *schnäpse,
    *zigarett*, *zigarre*, *zigarillo*, *tobacco*, *cigarette*, cigars, *nikotin*, *nicotine*, vaping,
    *shisha*, hookah*, raucher*, marlboro, gauloises, vaporizer*, vaporiser*, filler, fillers,
    *unterspritzung*, rhinoplast*, *liposuction*, injectables, kryolipolyse*, dieting, *ozempic*,
    *wegovy*, *mounjaro*, *almased*, schlankheits*, slimming*, ketogen*, lifesum, thinspo*, entschlack*,
    drogen*, narkotik*, narcotic*, *cannabis*, marihuana*, marijuana*, haschisch*, hashish*, spliff*,
    bekifft*, kokain*, cocaine*, koksen, kokser*, psilocybin*, shrooms, heroin, methamphetamin*,
    amphetamin*, ketamin*, opioid*, fentanyl*, kratom, psychedelika, psychedelics, tilidin*, codein*,
    benzos, benzodiazepin*, admiral, radler, spritzer, ottakringer, spirits, joints, ecstasy, grinder,
    grinders, edibles, *wetten, *jackpot*, schulden*, rauchen, abnehm*, affirm, abbezahlen, vorschuss,
    zipfer, puntigamer, schwechater, wieselburger, zwettler, krombacher, berentzen, desperados,
    ramazzotti, saufen, gspritzter, gspritzten, gspritzte, trafik*, kippen, veneer*, stoner, stoners,
    abzahl*, schuldner*, lending, märzen, smokes, armbrust*, laufhaus*, wehrmacht*, *bet365*,
    sportsbook*, *payday*, hangover*`
      .split(/\s*,\s*/)
      .filter(Boolean);
  const kernOhneFuge = (wort) => wort.replace(/[*+ ]/g, "");
  const alleSperrwoerter = [
    ..._SPERRLISTEN.immer.ueberall,
    ..._SPERRLISTEN.immer.nurAlsWerbung,
    ..._SPERRLISTEN.minor.ueberall,
    ..._SPERRLISTEN.minor.nurAlsWerbung,
  ];

  test("jedes lange Listenwort ohne Wortfuge steht in genau einer Prüfliste", () => {
    const mitFuge = new Set(alleSperrwoerter.filter((w) => /[ +]/.test(w)).map(kernOhneFuge));
    const anderswo = new Set(FUGE_ANDERSWO.map(kernOhneFuge));
    const ohne = new Set(OHNE_WORTFUGE);
    const offen = alleSperrwoerter.filter(
      (w) =>
        !/[ +]/.test(w) &&
        kernOhneFuge(w).length >= 6 &&
        !mitFuge.has(kernOhneFuge(w)) &&
        !anderswo.has(kernOhneFuge(w)) &&
        !ohne.has(w)
    );
    expect(offen).toEqual([]);
    /* Kein Eintrag der Prüflisten ist übrig: Jeder gehört zu einem Listenwort. */
    const kerne = new Set(alleSperrwoerter.map(kernOhneFuge));
    expect(FUGE_ANDERSWO.filter((f) => !kerne.has(kernOhneFuge(f)))).toEqual([]);
    expect(OHNE_WORTFUGE.filter((w) => !alleSperrwoerter.includes(w))).toEqual([]);
    expect(OHNE_WORTFUGE.filter((w) => anderswo.has(kernOhneFuge(w)) || mitFuge.has(kernOhneFuge(w)))).toEqual([]);
  });

  test("FUGE_ANDERSWO: zusammen, mit Bindestrich und getrennt wird gefangen", () => {
    const durch = [];
    for (const fuge of FUGE_ANDERSWO) {
      for (const form of dreiSchreibweisen(fuge)) {
        if (!_istImmerVerboten(form) && !_istBeiMinderjaehrigenVerboten(form)) durch.push(`${fuge}: ${form}`);
      }
    }
    expect(FUGE_ANDERSWO.length).toBeGreaterThan(50);
    expect(durch).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Harmlose Wendungen: Tabelle Wendung → Beispiel. Für JEDE Wendung der
   Liste: Das Beispiel bleibt als Werbe-Eintrag bei einem Kind stehen — und
   ohne diese eine Wendung würde es gestrichen. Eine Wendung ohne Beispiel
   macht den Test rot; ebenso ein Beispiel ohne Wendung.
   ══════════════════════════════════════════════════════════════════════ */
const BEISPIEL_JE_WENDUNG = {
  "guns n roses": "Guns N' Roses",
  "top gun": "Top Gun",
  "machine gun kelly": "Machine Gun Kelly",
  "massage gun*": "Massage Gun",
  "nerf gun*": "Nerf Gun",
  "water gun*": "Water Gun",
  "glue gun*": "Glue Gun",
  "toy gun*": "Toy Gun",
  "gun metal*": "Gun Metal Grey",
  "wasser pistole*": "Wasser-Pistole",
  "nerf pistole*": "Nerf-Pistole",
  "*klebe pistole*": "Heißklebe-Pistole",
  "massage pistole*": "Massage-Pistole",
  "spielzeug pistole*": "Spielzeug-Pistole",
  "water pistol*": "Water Pistol",
  "toy pistol*": "Toy Pistol",
  "wasser gewehr*": "Wassergewehr",
  "nerf gewehr*": "Nerf-Gewehr",
  "spielzeug gewehr*": "Spielzeuggewehr",
  "ford escort": "Ford Escort",
  "terrorvogel*": "Terrorvogel-Doku",
  "terrorvögel*": "Terrorvögel der Urzeit",
  "terrorzwerg*": "Terrorzwerg-Shirt",
  "terrorisier*": "Terrorisiert vom Wecker",
  "terroriz*": "Terrorized by Mondays",
  terrorise: "Cats terrorise dogs",
  terrorised: "Terrorised by alarm clocks",
  terrorises: "The cat terrorises the dog",
  terrorising: "Terrorising the neighbours",
  "geheimwaffe*": "Geheimwaffe gegen Langeweile",
  "wunderwaffe*": "Wunderwaffe im Haushalt",
  "allzweckwaffe*": "Allzweckwaffe Backpulver",
  "pleasing*": "Pleasing",
  "people pleasing*": "People-Pleasing-Ratgeber",
  "crowd pleasing*": "Crowd-Pleasing Snacks",
  "displeasing*": "Displeasing",
  "unpleasing*": "Unpleasing",
  "releasing*": "Releasing Stress",
  "unreleasing*": "Unreleasing",
  "cocktailkleid*": "Cocktailkleid",
  "schnapsidee*": "Schnapsidee",
  "schnapszahl*": "Schnapszahl",
  schnapsen: "Schnapsen",
  "schnapskarte*": "Schnapskarten",
  "bierernst*": "Bierernst",
  "biereif*": "Biereifer",
  schwein: "Schwein",
  meerschwein: "Meerschwein",
  sparschwein: "Sparschwein",
  wildschwein: "Wildschwein",
  glücksschwein: "Glücksschwein",
  hausschwein: "Hausschwein",
  warzenschwein: "Warzenschwein",
  stachelschwein: "Stachelschwein",
  minischwein: "Minischwein",
  marzipanschwein: "Marzipanschwein",
  plüschschwein: "Plüschschwein",
  kuschelschwein: "Kuschel-Schwein",
  stoffschwein: "Stoffschwein",
  spielzeugschwein: "Spielzeugschwein",
  hängebauchschwein: "Hängebauchschwein",
  trüffelschwein: "Trüffelschwein",
  pinselohrschwein: "Pinselohrschwein",
  phrasenschwein: "Phrasenschwein",
  bullenschwein: "Bullenschwein",
  frontschwein: "Frontschwein",
  kapitalistenschwein: "Kapitalistenschwein",
  bilgenschwein: "Bilgenschwein",
  kielschwein: "Kielschwein",
  insekt: "Insekt",
  nutzinsekt: "Nutzinsekt",
  fluginsekt: "Fluginsekt",
  schadinsekt: "Schadinsekt",
  urinsekt: "Urinsekt",
  aasinsekt: "Aasinsekt",
  "kindersekt*": "Kindersekt",
  "champagnerfarb*": "Champagnerfarbenes Kleid",
  "akkreditier*": "Akkreditierung",
  "*diskreditier*": "Diskreditierung",
  "stocking filler*": "Stocking Filler",
  "joint venture*": "Joint Venture",
  "coffee grinder*": "Coffee Grinder",
  "kaffee grinder*": "Kaffee Grinder",
  "angle grinder*": "Angle Grinder",
  "*spritz pistole*": "Farbspritz-Pistole",
  "seifenblasen pistole*": "Seifenblasen-Pistole",
  "laser pistole*": "Laser-Pistole",
  "bubble gun*": "Bubble Gun",
  "squirt gun*": "Squirt Gun",
  "holz gewehr*": "Holzgewehr",
  "lackier pistole*": "Lackier-Pistole",
  "silikon pistole*": "Silikon-Pistole",
  "kartuschen pistole*": "Kartuschen-Pistole",
  "löt pistole*": "Löt-Pistole",
  "heißluft pistole*": "Heißluft-Pistole",
  "zapf pistole*": "Zapf-Pistole",
  "lil uzi*": "Lil Uzi Vert Merch",
  "mundpropaganda*": "Mundpropaganda",
  "alkoholfrei*": "Alkoholfrei",
  "ginger beer*": "Ginger Beer",
  "root beer*": "Root Beer",
  "butter beer*": "Butter Beer",
  "bierhoff*": "Bierhoff-Trikot",
  "cocktailtomate*": "Cocktailtomaten",
  "cocktailsauce*": "Cocktailsauce",
  "cocktailsoße*": "Cocktailsoße",
  "cocktailwürstchen*": "Cocktailwürstchen",
  "krabbencocktail*": "Krabbencocktail",
  "shrimp cocktail*": "Shrimp Cocktail",
  "obstcocktail*": "Obstcocktail",
  "fruchtcocktail*": "Fruchtcocktail",
  "cocktailkirsche*": "Cocktailkirschen",
  "wein nicht": "Wein nicht",
  "rum aroma*": "Rum-Aroma",
  "aperolfarb*": "Aperolfarbenes Kleid",
  "eros ramazzotti": "Eros Ramazzotti",
  "tabakfrei*": "Tabakfrei",
  "zigarettenfrei*": "Zigarettenfrei",
  "nikotinfrei*": "Nikotinfrei",
  "shisha frei*": "Shishafreie Zone",
  "raucherlunge*": "Raucherlunge",
  "raucherentwöhn*": "Raucherentwöhnung",
  "velo helm*": "Velo-Helm",
  "velo tour*": "Velo-Tour",
  "drogenfrei*": "Drogenfrei",
  "drug store*": "Drug Store Makeup",
  "black opium*": "Black Opium",
  "stoner rock*": "Stoner Rock",
  "kiffhäuser*": "Kiffhäuser",
  "pfeffer grinder*": "Pfeffer-Grinder",
  "salz grinder*": "Salz-Grinder",
  "gewürz grinder*": "Gewürz-Grinder",
  "skate grinder*": "Skate-Grinder",
  "pepper grinder*": "Pepper Grinder",
  "meat grinder*": "Meat Grinder",
  "klarname*": "Klarnamen",
  "kreditkartenhülle*": "Kreditkartenhülle",
  "kreditkarten etui*": "Kreditkarten-Etui",
  "kreditkartenhalter*": "Kreditkartenhalter",
  "raten quiz*": "Raten-Quiz",
  "rätsel raten*": "Rätsel raten",
  "lotto fußball*": "Lotto Fußballschuhe",
  "lotto sport*": "Lotto Sport Italia",
  "poker face*": "Poker Face",
  "admiral trikot*": "Admiral-Trikot",
  "admiral bundesliga*": "Admiral Bundesliga",
  "casino royale*": "Casino Royale",
  "jackpot eis*": "Jackpot-Eis",
  "wetten dass*": "Wetten dass Fanartikel",
  "facelift vw*": "Facelift VW Golf",
  "facelift audi*": "Facelift Audi A3",
  "facelift bmw*": "Facelift BMW 3er",
  "facelift mercedes*": "Facelift Mercedes A-Klasse",
  "facelift modell*": "Facelift-Modell",
  "auto facelift*": "Auto-Facelift",
  "filler episode*": "Filler-Episoden",
  "filler folge*": "Filler-Folgen",
  "filler arc*": "Filler Arc",
  "aufpump*": "Aufpump-Service",
  "abnehmbar*": "Abnehmbare Kapuze",
  "abnehmend*": "Abnehmender Mond",
  "abnehmerschaft*": "Abnehmerschaft",
  "abnehmerländer*": "Abnehmerländer",
  "abnehmerland*": "Abnehmerland",
  "abnehmerkreis*": "Abnehmerkreis",
  "abnehmerin*": "Abnehmerin",
  abnehmers: "Abnehmers",
  abnehmern: "Abnehmern",
  abnehmer: "Abnehmer",
  "diätassisten*": "Diätassistentin",
  "diätolog*": "Diätologin",
  "diet coke*": "Diet Coke",
  "diet cola*": "Diet Cola",
  "diet pepsi*": "Diet Pepsi",
  "diet soda*": "Diet Soda",
  "shotgun mikrofon*": "Shotgun-Mikrofon",
  "shotgun mic*": "Shotgun Mic",
  "rifle jeans*": "Rifle Jeans",
  "pistolengriff*": "Pistolengriff-Gießkanne",
  gewehrt: "Gewehrt",
  gewehrte: "Gewehrte Angriffe",
  gewehrten: "Die gewehrten Schüsse",
  "wire stripper*": "Wire Stripper",
  "paint stripper*": "Paint Stripper",
  "kabel stripper*": "Kabel-Stripper",
  "bierdeckel*": "Bierdeckel-Sammlung",
  "bierschinken*": "Bierschinken",
  "bierwurst*": "Bierwurst",
  "spritz gebäck*": "Spritz-Gebäck",
  "spritz beutel*": "Spritz-Beutel",
  "spritz tülle*": "Spritz-Tülle",
  "gin romme*": "Gin-Rommé",
  "gin rummy*": "Gin Rummy",
  "winery dogs": "The Winery Dogs",
  "ginger ale*": "Ginger Ale",
  "radler zubehör*": "Radler-Zubehör",
  "radler hose*": "Radler-Hose",
  "radler trikot*": "Radler-Trikot",
  "radler helm*": "Radler-Helm",
  "lotto trikot*": "Lotto-Trikot",
  "lotto schuh*": "Lotto-Schuhe",
  "admiral sportswear*": "Admiral Sportswear",
  "koks grill*": "Koks-Grill",
  "hasch mich*": "Hasch mich",
  "cbd frei*": "CBD-freies Shampoo",
  "thc frei*": "THC-freies Hanföl",
  "diät cola*": "Diät-Cola",
  "diät limo*": "Diät-Limo",
  "unisex*": "Unisex-Spielzeug",
  "essex*": "Essex-Shop",
  "sussex*": "Sussex-Camping",
  "middlesex*": "Middlesex-Shop",
  "wessex*": "Wessex-Shop",
  "*waffel*": "Las-Vegas-Waffeln",
  sporn: "Sporn",
  ansporn: "Ansporn",
  rittersporn: "Rittersporn",
  heißsporn: "Heißsporn",
  fersensporn: "Fersensporn",
  bergsporn: "Bergsporn",
  felssporn: "Felssporn",
  lerchensporn: "Lerchensporn",
  rammsporn: "Rammsporn",
  reitsporn: "Reitsporn",
  "waffen skin*": "Fortnite Waffen-Skins",
  "weapon skin*": "Weapon Skins",
  "gun skin*": "Gun Skins",
};

describe("Tabelle harmlose Wendung → Beispiel", () => {
  /* Der Filter, wie er ohne eine einzelne Wendung arbeiten würde: mit
     ausgetauschter Datendatei frisch geladen. */
  function filterOhne(wendung) {
    let filter;
    jest.isolateModules(() => {
      jest.doMock("../minor-safety-woerter", () => {
        const echt = jest.requireActual("../minor-safety-woerter");
        const rest = echt.HARMLOS.split(/\s*,\s*/).filter((w) => w && w !== wendung);
        return { ...echt, HARMLOS: rest.join(", ") };
      });
      filter = require("../minor-safety");
    });
    jest.dontMock("../minor-safety-woerter");
    return filter;
  }
  const gefangen = (filter, text) => filter._istImmerVerboten(text) || filter._istBeiMinderjaehrigenVerboten(text);

  test("die Tabelle nennt genau die Wendungen der Liste", () => {
    expect(Object.keys(BEISPIEL_JE_WENDUNG).sort()).toEqual([..._SPERRLISTEN.harmlos].sort());
  });

  test("keine Wendung steht doppelt in der Liste", () => {
    const alle = _SPERRLISTEN.harmlos;
    expect(alle.filter((w, i) => alle.indexOf(w) !== i)).toEqual([]);
  });

  /* Positivkontrolle der Messung: Ohne alle Wendungen fängt der
     nachgeladene Filter „Top Gun“. */
  test("der nachgeladene Filter arbeitet mit der ausgetauschten Liste", () => {
    expect(gefangen(filterOhne("top gun"), "Top Gun")).toBe(true);
    expect(_istImmerVerboten("Top Gun")).toBe(false);
  });

  test.each(Object.entries(BEISPIEL_JE_WENDUNG))("%s hält „%s“", (wendung, beispiel) => {
    expect(_istImmerVerboten(beispiel)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(beispiel)).toBe(false);
    expect(gefangen(filterOhne(wendung), beispiel)).toBe(true);
  });

  /* Wendungen mit notierter Wortfuge bleiben in allen drei Schreibweisen
     frei. */
  test("Wendungen mit Leerzeichen bleiben zusammen, mit Bindestrich und getrennt frei", () => {
    const gestrichen = [];
    for (const wendung of _SPERRLISTEN.harmlos.filter((w) => w.includes(" "))) {
      const kern = wendung.replace(/\*/g, "");
      for (const form of [kern.replace(/ /g, ""), kern.replace(/ /g, "-"), kern]) {
        if (_istImmerVerboten(form) || _istBeiMinderjaehrigenVerboten(form)) gestrichen.push(`${wendung}: ${form}`);
      }
    }
    expect(gestrichen).toEqual([]);
  });
});

describe("Die ganze Kette: Werbe-Einträge quer durch die Themen", () => {
  const NORMAL = ["Only Fans", "Teilzahlung", "Interwetten", "Jägermeister", "Pokémon Karten"];
  const BOOST = ["Softair-Pistole", "0%-Finanzierung", "Elf Bar", "Abnehm-App", "Fortnite V-Bucks"];

  let zeilen;
  beforeEach(() => {
    zeilen = [];
    jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(z));
    jest.spyOn(console, "error").mockImplementation((z) => zeilen.push(z));
  });
  afterEach(() => jest.restoreAllMocks());

  function lauf(alterText) {
    const p = profil(alterText, []);
    p.normal.ad_targeting = [...NORMAL];
    p.boost.ad_targeting = [...BOOST];
    const b = applyMinorSafety(p, { lang: "de", alterText });
    loggeMinorSafety(b, "de");
    return { p, b, zeile: JSON.parse(zeilen.find((z) => z.includes('"minor-safety"'))) };
  }

  test("Kind: alle acht fliegen, das Protokoll zählt sie", () => {
    const { p, zeile } = lauf(KIND);
    expect(p.normal.ad_targeting).toEqual(["Pokémon Karten"]);
    expect(p.boost.ad_targeting).toEqual(["Fortnite V-Bucks"]);
    expect(zeile).toMatchObject({ entfernt: 8, gruende: ["immer", "minor"], werbung: { normal: 1, boost: 1 } });
  });

  test("Erwachsener: Stufe 1 fliegt, Stufe 2 bleibt als Lerninhalt", () => {
    const { p, zeile } = lauf(ERWACHSEN);
    expect(p.normal.ad_targeting).toEqual(NORMAL.filter((e) => e !== "Only Fans"));
    expect(p.boost.ad_targeting).toEqual(BOOST.filter((e) => e !== "Softair-Pistole"));
    expect(zeile).toMatchObject({ entfernt: 2, gruende: ["immer"] });
  });

  test("harmlose Werbung für ein Kind bleibt vollständig", () => {
    const harmlos = [
      "Lego Friends",
      "Pokémon Karten",
      "Fortnite V-Bucks",
      "Nike Air Max",
      "Spotify Premium",
      "Unisex Hoodie",
      "Waffeleisen",
      "Wetterstation",
    ];
    const p = profil(KIND, harmlos);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(harmlos);
    expect(b.applied).toBe(false);
  });
});

describe("Stichwort im Bericht", () => {
  test("nennt das erste Sperrwort im Text, nicht den Rest der Zusammensetzung", () => {
    const b = applyMinorSafety(profil(KIND, ["Waffenladen Müller am Hauptplatz", "Sofortkreditangebot Meier"]));
    expect(b.entfernt.filter((e) => e.modus === "normal").map((e) => e.stichwort)).toEqual(["waffenladen", "kredit"]);
  });

  test("bei zwei Sperrwörtern zählt das, das im Text zuerst steht", () => {
    const b = applyMinorSafety(profil(KIND, ["Klarna Ratenkauf", "Ratenkauf mit Klarna"]));
    expect(b.entfernt.filter((e) => e.modus === "normal").map((e) => e.stichwort)).toEqual(["klarna", "ratenkauf"]);
  });
});

describe("Laufzeit", () => {
  test("ein sehr langer Text ohne Treffer ist schnell geprüft", () => {
    const lang = "Du magst Musik und triffst dich gern mit Freundinnen. ".repeat(600);
    expect(lang.length).toBeGreaterThan(30000);
    const start = Date.now();
    expect(_istImmerVerboten(lang, false)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(lang, false)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1500);
  });

  /* Viele Bindestriche vervielfachen die Sichten nicht: Ab dem vierten gibt
     es nur noch zwei (alle als Leerzeichen, alle weggelassen). */
  test("ein langer Text mit vielen Bindestrichen ist schnell geprüft", () => {
    const lang = "Deine Social-Media-Nutzung im Klassen-Chat fällt auf, auch dein Lieblings-Hoodie. ".repeat(400);
    expect(lang.length).toBeGreaterThan(30000);
    const start = Date.now();
    expect(_istImmerVerboten(lang, false)).toBe(false);
    expect(_istBeiMinderjaehrigenVerboten(lang, false)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1500);
    /* Positivkontrolle: Auch im langen Text wird ein Listenwort mit Bindestrich gefunden. */
    expect(_istImmerVerboten(`${lang} Soft-Air.`, false)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Tabelle Listenwort → Beispiel.

   Jedes Wort der Liste steht hier mit einem Beispiel. Geprüft wird:
     - Die Tabelle nennt genau die Wörter der Liste (keins fehlt, keins ist
       übrig).
     - Die echte Filterfunktion fängt das Beispiel.
     - Ohne dieses eine Wort ginge das Beispiel anders aus (nicht gefangen
       oder mit anderem Stichwort) — das Wort ist also wirklich gehalten.
     - Ein Wort „nur als Werbung“ greift im Satz nicht.
   ══════════════════════════════════════════════════════════════════════ */
const BEISPIEL_JE_WORT = {
  immer: {
    "*onlyfans*": "OnlyFans Merch Drops",
    "*fansly*": "Fansly",
    "*bestfans*": "Bestfans",
    "*xhamster*": "Xhamster",
    "*youporn*": "Youporn",
    "*xvideos*": "Xvideos",
    xnxx: "Xnxx",
    "*brazzers*": "Brazzers",
    "*stripchat*": "Stripchat",
    "*chaturbate*": "Chaturbate",
    "*mydirtyhobby*": "Mydirtyhobby",
    "*amorelie*": "Amorelie",
    "beate uhse": "Beate Uhse",
    "eis.de": "Eis.de Toys",
    "porn*": "Pornoseite",
    "*porno*": "Softporno",
    "*cam girl*": "Webcam-Girls",
    "adult webcam*": "Adult Webcam",
    "*sexcam*": "Livesexcam",
    "sex cam*": "Sex Cam",
    "*sexshop*": "Onlinesexshop",
    "sex shop*": "Sex Shop",
    "sex toy*": "Sex-Toys",
    "*sexspielzeug*": "Sexspielzeug",
    "*telefonsex*": "Telefonsex",
    "phone sex": "Phone Sex",
    "*cybersex*": "Cybersex",
    "*sexarbeit*": "Sexarbeit",
    "sex work*": "Sex Work",
    "*sexfilm*": "Sexfilm",
    "*sexkino*": "Sexkino",
    "*sexdate*": "Sexdate",
    "*sexpuppe*": "Sexpuppe",
    "sex doll*": "Sex Doll",
    "sex chat*": "Sex Chat",
    "*prostitu*": "Prostitution",
    "call girl*": "Callgirl",
    "*escort*": "Escort Service Wien",
    "*bordell*": "Bordell",
    "*brothel*": "Brothel",
    "strip club*": "Stripclub",
    "*hentai*": "Hentai",
    "xxx video*": "XXX Videos",
    "xxx film*": "XXX Filme",
    "sugar daddy*": "Sugardaddy-Portal",
    "sugar babe*": "Sugar Babe",
    "sugar baby*": "Sugar Baby",
    "sugar dating": "Sugar Dating",
    "dildo*": "Dildo",
    lovehoney: "Lovehoney",
    bdsm: "Bdsm",
    "peep show*": "Peep Show",
    "swinger club*": "Swinger Club",
    "table dance*": "Table Dance",
    "lap dance*": "Lap Dance",
    "strip show*": "Strip Show",
    hure: "Hure",
    huren: "Huren",
    "rotlicht+viertel*": "Rotlichtviertel",
    "rotlicht+milieu*": "Rotlichtmilieu",
    "red light district*": "Red Light District",
    "joyclub*": "Joyclub",
    "*porn": "Foodporn",
    "*schusswaffe*": "Schusswaffe",
    "*feuerwaffe*": "Feuerwaffe",
    "*jagdwaffe*": "Jagdwaffe",
    "*kriegswaffe*": "Kriegswaffe",
    "*stichwaffe*": "Stichwaffe",
    "*hiebwaffe*": "Hiebwaffe",
    "*gaswaffe*": "Gaswaffe",
    "*luftdruckwaffe*": "Luftdruckwaffe",
    "*waffenhandel*": "Waffenhandel",
    "waffenladen*": "Waffenladen",
    "waffenshop*": "Waffenshop",
    "waffengeschäft*": "Waffengeschäft",
    "waffenhändler*": "Waffenhändler",
    "waffenschein*": "Waffenschein",
    "waffenbörse*": "Waffenbörse",
    "waffenzubehör*": "Waffenzubehör",
    "waffenbesitz*": "Waffenbesitz",
    "waffenschrank*": "Waffenschrank",
    "waffensammlung*": "Waffensammlung",
    "*munition*": "Munition Großhandel",
    "luftpistole*": "Luftpistole",
    "gaspistole*": "Gaspistole",
    "maschinenpistole*": "Maschinenpistole",
    "*softair*": "Softair-Zubehör",
    "*airsoft*": "Airsoft Zubehör",
    "*schreckschuss*": "Schreckschusspistole",
    gun: "BB Gun",
    guns: "Guns kaufen",
    "*handgun*": "Handgun",
    "rifle*": "Rifle",
    "*firearm*": "Firearm",
    ammo: "Ammo",
    "*silencer*": "Silencer",
    "schall+dämpfer*": "Schalldämpfer",
    "*kampfmesser*": "Kampfmesser",
    "*springmesser*": "Springmesser",
    "butterfly messer*": "Butterflymesser",
    "*wurfmesser*": "Wurfmesser",
    "*einhandmesser*": "Einhandmesser",
    "combat knife*": "Combat Knife",
    "*schlagring*": "Schlagring",
    "brass knuckle*": "Brass Knuckle",
    "knuckle duster*": "Knuckle Duster",
    "*schlagstock*": "Schlagstock",
    "*elektroschocker*": "Elektroschocker",
    "taser*": "Taser",
    "*pfefferspray*": "Pfefferspray",
    "pepper spray*": "Pepper Spray",
    "armbrust*": "Armbrust",
    "crossbow*": "Crossbow",
    "*handgranate*": "Handgranate",
    "hand grenade*": "Hand Grenade",
    "*kalaschnikow*": "Kalaschnikow",
    "ak 47": "AK-47",
    "ar 15": "AR-15",
    glock: "Glock 19 Zubehör",
    glocks: "Glocks",
    "heckler koch": "Heckler & Koch",
    "sig sauer": "Sig Sauer",
    "smith wesson": "Smith & Wesson",
    "walther ppk": "Walther Ppk",
    "machete*": "Machete",
    "ziel+fernrohr*": "Zielfernrohr",
    "*sprengstoff*": "Sprengstoff",
    "bombenbau*": "Bombenbau",
    "schrotflinte*": "Schrotflinte",
    "switchblade*": "Switchblade",
    "tot+schläger*": "Totschläger",
    "wurfstern*": "Wurfstern",
    "nunchaku*": "Nunchaku",
    "jagd+messer*": "Jagdmesser",
    explosives: "Explosives",
    "*extremis*": "Extremismus",
    "*rechtsextrem*": "Rechtsextreme Mode",
    "*linksextrem*": "linksextreme Szene",
    "*rechtsradikal*": "Rechtsradikal",
    nazi: "Nazi-Devotionalien",
    nazis: "Nazis",
    "nazism*": "Nazismus",
    "nazisymbol*": "Nazisymbol",
    "naziparole*": "Naziparole",
    "nazipropaganda*": "Nazipropaganda",
    "*neonazi*": "Neonazi",
    "terror*": "Terror Merch",
    "*terrorism*": "Rechtsterrorismus",
    "*terrorist*": "Linksterroristen",
    "white supremac*": "White Supremacy",
    "thor steinar": "Thor Steinar",
    "*reichsbürger*": "Reichsbürger-Shop",
    "identitäre bewegung": "Identitäre Bewegung",
    "islamism*": "Islamismus",
    "islamist*": "Islamisten",
    "*dschihad*": "Dschihad-Propaganda",
    "jihad*": "Jihad",
    "salafis*": "Salafisten",
    "*hakenkreuz*": "Hakenkreuz",
    "swastika*": "Swastika",
    "ku klux klan": "Ku Klux Klan",
    "hitler*": "Hitler",
    kkk: "Kkk",
    isis: "Isis",
    "islamischer staat": "Islamischer Staat",
    "islamic state": "Islamic State",
    "al qaida": "Al Qaida",
    "al qaeda": "Al Qaeda",
    "al kaida": "Al Kaida",
    "taliban*": "Taliban",
    "qanon*": "Qanon",
    "white power": "White Power",
    "combat 18": "Combat 18",
    "blood honour": "Blood Honour",
    "blood honor": "Blood Honor",
    "rechts+rock*": "Rechtsrock",
    "ns devotionalien*": "Ns Devotionalien",
    "only fans": "Only Fans",
    "waffen*": "Waffenkammer",
    "*waffen": "Dienstwaffen",
    "*waffe": "Dienstwaffe",
    "weapon*": "Weapons",
    pistol: "Pistol",
    "*gewehr": "Präzisionsgewehr",
    "*gewehre": "Kleinkalibergewehre",
    "*gewehren": "Handel mit Gewehren",
    "*gewehrs": "des Präzisionsgewehrs",
    revolver: "Revolver",
    revolvers: "Revolvers",
    "far right": "Far-right apparel",
    "alt right": "Alt-Right Merch",
    "*erotik*": "Erotik-Shop",
    "erotic*": "Erotic Massage",
    "erotisch*": "Erotisch",
    "strip+tease*": "Striptease",
    nudes: "Nudes",
    "nacktbild*": "Handel mit Nacktbildern",
    "nackt+foto*": "Nacktfoto",
    "nude photo*": "Nude Photo",
    "nude pic*": "Nude Pic",
    "vibrator*": "Vibrator",
    "play+boy*": "Playboy",
    nsfw: "Nsfw",
    xxx: "Xxx",
    "adult content*": "Adult Content",
    "adult entertainment*": "Adult Entertainment",
    "adult dating*": "Adult Dating",
    "laufhaus*": "Laufhaus",
    "fetisch shop*": "Fetisch Shop",
    "fetish shop*": "Fetish Shop",
    dolch: "Dolch",
    dolche: "Dolche",
    flinte: "Flinte",
    flinten: "Flinten",
    granate: "Granate",
    granaten: "Granaten",
    grenades: "Grenades",
    beretta: "Beretta",
    uzi: "Uzi",
    uzis: "Uzis",
    "schießstand*": "Besuch des Schießstands",
    "faschis*": "Faschis",
    "fascis*": "Fascis",
    "anti+semit*": "Antisemit",
    "rassen+hass*": "Rassenhass",
    "volks+verhetz*": "Volksverhetz",
    "hass+gruppe*": "Hassgruppe",
    "hate group*": "Hate Group",
    "hass+prediger*": "Hassprediger",
    "hate preacher*": "Hate Preacher",
    "incel*": "Incel",
    "holocaust+leugn*": "Holocaustleugn",
    "holocaust denial*": "Holocaust Denial",
    identitäre: "Identitäre",
    identitären: "Identitären",
    "*propaganda*": "Propaganda",
    "wehrmacht*": "Wehrmacht",
    "radical islam*": "Radical Islam",
    "radikaler islam*": "Radikaler Islam",
    "shotgun*": "Shotgun",
    "pistole*": "Pistolenholster",
    "gewehr*": "Gewehrkoffer",
    "luftgewehr*": "Luftgewehrkugeln",
    "jagdgewehr*": "Jagdgewehr",
    "sturmgewehr*": "Sturmgewehr",
    "maschinengewehr*": "Maschinengewehr",
    "fire arm": "Fire Arm",
    "fire arms": "Fire Arms",
    "switch blade*": "Switch Blade",
    "bewaffnung*": "Bewaffnung",
    "schieß+training*": "Schießtraining",
    "shooting range*": "Shooting Range",
    "strip chat*": "Strip Chat",
    "my dirty hobby*": "My Dirty Hobby",
    "joy club*": "Joy Club",
    "best fans": "Best Fans",
    "love honey": "Love Honey",
    "x hamster": "X Hamster",
    "x videos": "X Videos",
    "adult video*": "Adult Videos",
    "x rated*": "X-Rated Movies",
    "reiz+wäsche*": "Reizwäsche",
    "erwachsenen+unterhaltung*": "Erwachsenenunterhaltung",
    "stripper*": "Stripper",
    "webcam models": "Webcam Models",
    hookers: "Hookers",
    "hassrede*": "Hassredekanal",
    "hate speech*": "Hate Speech",
    "rechte szene": "Rechte Szene",
    "rechten szene": "Mode der rechten Szene",
    "sexting*": "Sexting-App",
    "sex spielzeug*": "Sex Spielzeug",
    "sex spiele": "Sex Spiele",
    "sex arbeit*": "Sex Arbeit",
    "sex film*": "Sex Film",
    "sex kino*": "Sex Kino",
    "sex date": "Sex Date",
    "sex dates": "Sex Dates",
    "sex dating*": "Sex Dating",
    "sex puppe*": "Sex Puppe",
    "sex video*": "Sex Video",
    "sex tape*": "Sex Tape",
    "sex hotline*": "Sex Hotline",
    "sex kontakt*": "Sex Kontakt",
    "sex treffen*": "Sex Treffen",
    "sex abo*": "Sex Abo",
    "sex seite*": "Sex Seite",
    "sex portal*": "Sex Portal",
    "sex clip*": "Sex Clip",
    "sex stream*": "Sex Stream",
    "sex club*": "Sex Club",
    "sex party*": "Sex Party",
    "sex messe*": "Sex Messe",
    "sex tourismus*": "Sex Tourismus",
    "sex geschichte*": "Sex Geschichte",
    "sex story*": "Sex Story",
    "sex stories": "Sex Stories",
    "sex game*": "Sex Game",
    "sex app": "Sex App",
    "sex apps": "Sex Apps",
    "sex anzeige*": "Sex Anzeige",
    "sex bilder*": "Sex Bilder",
    "sex kauf*": "Sex Kauf",
    "sex massage*": "Sex Massage",
    "live sex*": "Live Sex",
    "webcam sex*": "Webcam Sex",
    "soft air": "Soft Air",
    "air soft": "Air Soft",
    radikalisierung: "Radikalisierung",
    radikalisierungen: "Radikalisierungen",
    radicalization: "Radicalization",
    radicalisation: "Radicalisation",
    "telefon sex": "Telefon Sex",
    "cyber sex": "Cyber Sex",
    "schreck schuss*": "Schreck Schuss",
    "kampf messer*": "Kampf Messer",
    "spring messer*": "Spring Messer",
    "wurf messer*": "Wurf Messer",
    "einhand messer*": "Einhand Messer",
    "schlag ring": "Schlag Ring",
    "schlag ringe": "Schlag Ringe",
    "schlag stock": "Schlag Stock",
    "schlag stöcke": "Schlag Stöcke",
    "elektro schocker*": "Elektro Schocker",
    "pfeffer spray*": "Pfeffer Spray",
    "cross bow": "Cross Bow",
    "cross bows": "Cross Bows",
    "spreng stoff*": "Spreng Stoff",
    "bomben bau": "Bomben Bau",
    "wurf stern": "Wurf Stern",
    "wurf sterne": "Wurf Sterne",
    "rechts extrem*": "Rechts Extrem",
    "links extrem*": "Links Extrem",
    "rechts radikal*": "Rechts Radikal",
    "reichs bürger*": "Reichs Bürger",
    "haken kreuz": "Haken Kreuz",
    "haken kreuze": "Haken Kreuze",
    "nackt bild": "Nackt Bild",
    "nackt bilder": "Nackt Bilder",
    "schieß stand": "Schieß Stand",
    "schieß stände": "Schieß Stände",
    "hass rede": "Hass Rede",
    "hass reden": "Hass Reden",
  },
  minor: {
    "*bet365*": "Bet365 Live",
    "*tipico*": "Tipico",
    bwin: "Bwin",
    "*betano*": "Betano",
    "*winamax*": "Winamax",
    "*tipp3*": "Tipp3",
    novomatic: "Novomatic",
    novoline: "Novoline",
    pokerstars: "Pokerstars",
    betway: "Betway",
    unibet: "Unibet",
    "*casino*": "Online-Casino",
    "*kasino*": "Kasino",
    "*sportwetten*": "Sportwetten",
    "*glücksspiel*": "Glücksspiel",
    "*wettanbieter*": "Wettanbieter",
    "*buchmacher*": "Buchmacher",
    "*kombiwette*": "Kombiwette",
    sportwette: "Sportwette",
    livewette: "Livewette",
    "wettbüro*": "Wettbüro",
    "wettschein*": "Wettschein",
    "wettbonus*": "Wettbonus",
    "wettquote*": "Wettquote",
    "wetteinsatz*": "Wetteinsatz",
    "wettkonto*": "Wettkonto",
    "wettportal*": "Wettportal",
    "wettlokal*": "Wettlokal",
    "wetttipp*": "Wetttipp",
    "wettapp*": "Wettapp",
    "*gambling*": "Gambling",
    "*betting*": "Betting",
    "*bookmaker*": "Bookmaker",
    "bookie*": "Bookie",
    "slot machine*": "Slot Machines",
    "poker*": "Pokerkarten-Set",
    "*lotterie*": "Österreichische Lotterien",
    "lottery*": "Lottery",
    euromillionen: "Euromillionen",
    euromillions: "Euromillions",
    "rubbellos*": "Rubbellos",
    "scratch card*": "Scratch Card",
    roulette: "Roulette",
    "*spielautomat*": "Spielautomat",
    "automaten+spiel*": "Automatenspiel",
    "spielbank*": "Spielbank",
    "spielhalle*": "Spielhalle",
    "spielothek*": "Spielothek",
    "black jack*": "Black Jack",
    "slot spiel*": "Slot Spiel",
    "slot game*": "Slot Game",
    "einarmiger bandit*": "Einarmiger Bandit",
    "einarmige banditen": "Einarmige Banditen",
    "sportsbook*": "Sportsbook",
    rollbit: "Rollbit",
    draftkings: "Draftkings",
    fanduel: "Fanduel",
    "william hill": "William Hill",
    ladbrokes: "Ladbrokes",
    "leo vegas": "Leo Vegas",
    wunderino: "Wunderino",
    "mozzart*": "Mozzart",
    wager: "Wager",
    wagers: "Wagers",
    wagering: "Wagering",
    wagered: "Wagered",
    "win 2 day": "win2day",
    "brieflos*": "Brieflos",
    "1xbet*": "1xBet",
    "22bet*": "22Bet",
    "*kredit*": "Sofortkredit",
    "*darlehen*": "Konsumentendarlehen",
    "*ratenkauf*": "Ratenkauf",
    "*ratenzahlung*": "Ratenzahlung",
    "ratenplan*": "Ratenplan",
    "monats+rate*": "Monatsrate",
    "*teilzahlung*": "Teilzahlung",
    "*finanzierung*": "0%-Finanzierung",
    "*financing*": "Financing",
    "*riverty*": "Riverty",
    "*afterpay*": "Afterpay",
    "*cashper*": "Cashper",
    ratepay: "Ratepay",
    "*auxmoney*": "Auxmoney",
    "*smava*": "Smava",
    "*vexcash*": "Vexcash",
    "*schufa*": "Schufa",
    "*inkasso*": "Inkasso",
    "*leasing*": "Autoleasing",
    "*mikrofinanz*": "Mikrofinanz",
    dispo: "Dispo",
    "*überziehung*": "Überziehungsrahmen",
    "over+draft*": "Overdraft",
    "*umschuldung*": "Umschuldung",
    "*hypothek*": "Hypothek",
    "*mortgage*": "Mortgage",
    "kauf auf rechnung": "Kauf auf Rechnung",
    "rechnungs+kauf*": "Rechnungskauf",
    loan: "Loan",
    loans: "Loans",
    "*payday*": "Payday",
    "installment*": "Installment",
    "instalment*": "Instalment",
    "buy now pay later": "Buy Now Pay Later",
    "pay later": "PayPal Pay Later",
    bnpl: "Bnpl",
    "credit card*": "Credit Card",
    "klarna*": "Klarna",
    "pfandhaus*": "Pfandhaus",
    "pfand+leih*": "Pfandleih",
    "pay in 4": "Pay In 4",
    "pay in 3": "Pay In 3",
    "borrow money": "Borrow Money",
    "cash advance*": "Cash Advance",
    "bonität*": "Bonität",
    "zahl+pause*": "Zahlpause",
    "zahlungs+pause*": "Zahlungspause",
    "stundung*": "Stundung",
    scalapay: "Scalapay",
    zinia: "Zinia",
    "miet+kauf*": "Mietkauf",
    "zahl später*": "Zahl später",
    "*alkohol*": "Alkohol-Lieferdienst",
    "*alcohol*": "Alcohol Delivery",
    "bier*": "Bierpong Set",
    "weißbier*": "Weißbier",
    "weizenbier*": "Weizenbier",
    "dosenbier*": "Dosenbier",
    "flaschenbier*": "Flaschenbier",
    "fassbier*": "Fassbier",
    "freibier*": "Freibier",
    "starkbier*": "Starkbier",
    "bockbier*": "Bockbier",
    "altbier*": "Altbier",
    "craftbier*": "Craftbier",
    "kellerbier*": "Kellerbier",
    "lagerbier*": "Lagerbier",
    "weinabo*": "Weinabo",
    "weinprobe*": "Weinprobe",
    "weinverkostung*": "Weinverkostung",
    "weinhandel*": "Weinhandel",
    "weinhandlung*": "Weinhandlung",
    "weinkeller*": "Weinkeller",
    "weingut*": "Weingut",
    "weinflasche*": "Weinflasche",
    "weinshop*": "Weinshop",
    "weinladen*": "Weinladen",
    "weinbar*": "Weinbar",
    "weinpaket*": "Weinpaket",
    "weinclub*": "Weinclub",
    "weinfest*": "Weinfest",
    "weinschorle*": "Weinschorle",
    "weinkühlschrank*": "Weinkühlschrank",
    "weinregal*": "Weinregal",
    "weinkenner*": "Weinkenner",
    "weinliebhaber*": "Weinliebhaber",
    "weinreise*": "Weinreise",
    "weinlieferung*": "Weinlieferung",
    "weinversand*": "Weinversand",
    "weintasting*": "Weintasting",
    "weinkarte*": "Weinkarte",
    "weinglas*": "Weinglas",
    "weingläser*": "Weingläser",
    "weinviertel dac": "Weinviertel DAC",
    "winzer*": "Winzer",
    "vinothek*": "Vinothek",
    "*wein": "Hauswein",
    "*rotwein*": "Rotweinflasche",
    "*weißwein*": "Weißweinschorle",
    "*glühwein*": "Glühweinstand",
    "*sekt": "Krimsekt",
    "sektflasche*": "Sektflasche",
    "sektglas*": "Sektglas",
    "sektempfang*": "Sektempfang",
    "sektkellerei*": "Sektkellerei",
    "*prosecco*": "Prosecco",
    "champagner*": "Champagner",
    champagne: "Champagne",
    "*aperol*": "Aperol",
    spritz: "Hugo Spritz",
    campari: "Campari",
    gin: "Gin Tonic",
    gins: "Gins",
    "*tequila*": "Tequila",
    "*cocktail*": "Cocktail-Bar",
    "*spirituose*": "Spirituose",
    "*vodka*": "Vodka Tasting",
    "*wodka*": "Red Bull Wodka",
    "*whisky*": "Whisky",
    "*whiskey*": "Whiskey",
    "schnaps*": "Schnapsglas",
    "*schnaps": "Obstschnaps",
    "*likör*": "Eierlikör",
    "liqueur*": "Liqueur",
    "weinbrand*": "Weinbrand",
    obstler: "Obstler",
    grappa: "Grappa",
    ouzo: "Ouzo",
    sambuca: "Sambuca",
    "absinth*": "Absinth",
    cider: "Cider",
    ciders: "Ciders",
    "hard seltzer": "Hard Seltzer",
    "brauerei*": "Brauerei",
    "brewery*": "Brewery",
    "brennerei*": "Brennerei",
    "distillery*": "Distillery",
    "destillerie*": "Destillerie",
    "winery*": "Winery",
    beer: "Craft Beer",
    beers: "Beers",
    wine: "Wine",
    wines: "Wines",
    liquor: "Liquor",
    liquors: "Liquors",
    booze: "Booze",
    "*jägermeister*": "Jägermeister",
    stiegl: "Stiegl",
    gösser: "Gösser",
    heineken: "Heineken",
    "corona extra": "Corona Extra",
    bacardi: "Bacardi",
    "captain morgan": "Captain Morgan",
    "smirnoff*": "Smirnoff Ice",
    "jack daniel*": "Jack Daniel's",
    "jim beam": "Jim Beam",
    "johnnie walker": "Johnnie Walker",
    baileys: "Baileys",
    "long drink*": "Long Drink",
    "havana club": "Havana Club",
    "white claw": "White Claw",
    "trink+spiel*": "Trinkspiel",
    "drinking game*": "Drinking Game",
    "koma+sauf*": "Komasauf",
    "kneipen+tour*": "Kneipentour",
    "pub crawl*": "Pub Crawl",
    "sangria*": "Sangria",
    "mojito*": "Mojito",
    "caipirinha*": "Caipirinha",
    lillet: "Lillet",
    "jäger+bomb*": "Jägerbomb",
    "jagermeister*": "Jagermeister",
    gosser: "Gosser",
    "märzenbier*": "Märzenbier",
    pils: "Pils",
    "pilsner*": "Pilsner Urquell",
    "pilsener*": "Pilsener",
    "flügerl*": "Flügerl",
    "schnäpse*": "Schnäpsen",
    "*schnäpse": "Obstschnäpse",
    "sektfrühstück*": "Sektfrühstück",
    "pale ale*": "Pale Ale",
    "alko+pop*": "Alkopop",
    "alco+pop*": "Alcopop",
    "*zigarett*": "E-Zigarette",
    "*zigarre*": "Zigarre",
    "*zigarillo*": "Zigarillo",
    "*tabak*": "Tabak Pouches",
    "*tobacco*": "Tobacco",
    "*cigarette*": "Cigarette",
    cigar: "Cigar",
    cigars: "Cigars",
    "*nikotin*": "Nikotinbeutel",
    "*nicotine*": "Nicotine Pouch",
    snus: "Snus",
    "vape*": "Vapes",
    vaping: "Vaping",
    "*shisha*": "Shisha Bar",
    "wasser+pfeife*": "Wasserpfeife",
    "hookah*": "Hookah",
    "raucher*": "Raucher",
    marlboro: "Marlboro",
    "lucky strike": "Lucky Strike",
    gauloises: "Gauloises",
    "pall mall": "Pall Mall",
    "elf bar": "Elf Bar",
    "lost mary": "Lost Mary",
    iqos: "Iqos",
    vuse: "Vuse",
    juul: "Juul",
    heets: "Heets",
    zyn: "Zyn",
    "e liquid*": "E Liquid",
    "dampfer shop*": "Dampfer Shop",
    "long paper*": "Long Paper",
    "memphis blue": "Memphis Blue",
    "e cig*": "E Cig",
    "smoke shop*": "Smoke Shop",
    "puff bar*": "Puff Bar",
    terea: "Terea",
    "ske crystal*": "Ske Crystal",
    "randm tornado*": "Randm Tornado",
    "vaporizer*": "Vaporizer",
    "vaporiser*": "Vaporiser",
    "rolling paper*": "Rolling Papers",
    "*botox*": "Botox",
    filler: "Filler",
    fillers: "Fillers",
    "lip filler*": "Lipfiller",
    "lip injection*": "Lip Injection",
    "schönheits op*": "Schönheits-OP",
    "schönheits+chirurg*": "Schönheitschirurgie",
    "schönheits+korrektur*": "Schönheitskorrektur",
    "schönheits+klinik*": "Schönheitsklinik",
    "schönheits+eingriff*": "Schönheitseingriff",
    "beauty op": "Beauty-OP",
    "beauty ops": "Beauty-OPs",
    "beauty operation*": "Beauty Operation",
    "beauty korrektur*": "Beauty-Korrektur",
    "plastische chirurgie": "Plastische Chirurgie",
    "plastic surgery": "Plastic Surgery",
    "cosmetic surgery": "Cosmetic Surgery",
    "cosmetic procedure*": "Cosmetic Procedure",
    "*fettabsaug*": "Fettabsaugung",
    "*brustvergrößer*": "Brustvergrößerung",
    "brust+verkleinerung*": "Brustverkleinerung",
    "brust+straffung*": "Bruststraffung",
    "brust op": "Brust-OP",
    "brust+operation*": "Brustoperation",
    "nasen op": "Nasen-OP",
    "nasen+operation*": "Nasenoperation",
    "*nasenkorrektur*": "Nasenkorrektur",
    "lippen aufspritz*": "Lippen aufspritzen",
    "*unterspritzung*": "Lippenunterspritzung",
    "face+lift*": "Facelift",
    "lid+straffung*": "Lidstraffung",
    "*haartransplantation*": "Haartransplantation",
    "hair transplant*": "Hair Transplant",
    "breast augmentation": "Breast Augmentation",
    "breast enlargement*": "Breast Enlargement",
    "boob job*": "Boob Job",
    "nose job*": "Nose Job",
    "rhinoplast*": "Rhinoplast",
    "tummy tuck*": "Tummy Tuck",
    "*liposuction*": "Liposuction",
    "fett weg spritze*": "Fett Weg Spritze",
    "beauty eingriff*": "Beauty Eingriff",
    "ästhetische medizin": "Ästhetische Medizin",
    "ästhetische chirurgie": "Ästhetische Chirurgie",
    "aesthetic surgery": "Aesthetic Surgery",
    "aesthetic medicine": "Aesthetic Medicine",
    "aesthetic clinic*": "Aesthetic Clinic",
    "butt lift*": "Butt Lift",
    "lippen+vergrößer*": "Lippenvergrößer",
    "lip augmentation*": "Lip Augmentation",
    "lip flip*": "Lip Flip",
    "russian lips": "Russian Lips",
    "lippen machen lassen": "Lippen Machen Lassen",
    "nase machen lassen": "Nase Machen Lassen",
    "brust+implantat*": "Brustimplantat",
    "po implantat*": "Po Implantat",
    "kinn implantat*": "Kinn Implantat",
    "breast implant*": "Breast Implant",
    "butt implant*": "Butt Implant",
    "med spa": "Med Spa",
    "med spas": "Med Spas",
    injectables: "Injectables",
    "cosmetic injection*": "Cosmetic Injection",
    "falten+behandlung*": "Faltenbehandlung",
    "beauty doc*": "Beauty Doc",
    "bauchdecken+straffung*": "Bauchdeckenstraffung",
    "faden+lifting*": "Fadenlifting",
    "kryolipolyse*": "Kryolipolyse",
    "skin bleaching*": "Skin Bleaching",
    "skin whitening*": "Skin Whitening",
    "haut+aufhell*": "Hautaufhell",
    "hyaluron filler*": "Hyaluron-Filler",
    "hyaluron spritze*": "Hyaluron-Spritze",
    "hyaluron unterspritz*": "Hyaluron unterspritzen",
    "hyaluron injektion*": "Hyaluron-Injektion",
    "hyaluron behandlung*": "Hyaluron-Behandlung",
    "hyaluron lippen*": "Hyaluron-Lippen",
    "hyaluron pen*": "Hyaluron-Pen",
    "hyaluronsäure filler*": "Hyaluronsäure-Filler",
    "hyaluronsäure spritze*": "Hyaluronsäure-Spritze",
    "hyaluronsäure injektion*": "Hyaluronsäure-Injektion",
    "hyaluronsäure behandlung*": "Hyaluronsäure-Behandlung",
    "hyaluronic filler*": "Hyaluronic Filler",
    "hyaluronic acid filler*": "Hyaluronic Acid Filler",
    "hyaluronic acid injection*": "Hyaluronic Acid Injections",
    "kosmetische eingriff*": "Kosmetische Eingriffe",
    "kosmetischer eingriff*": "Kosmetischer Eingriff",
    "kosmetischen eingriff*": "Angebote zum kosmetischen Eingriff",
    "kosmetische chirurgie*": "Kosmetische Chirurgie",
    "po vergrößer*": "Po-Vergrößerung",
    "lippenfiller*": "Lippenfiller",
    "aufgespritzte lippen*": "Aufgespritzte Lippen",
    "diät*": "Diätplan",
    "*diät": "Nulldiät",
    dieting: "Dieting",
    "diet pill*": "Diet Pills",
    "*ozempic*": "Ozempic",
    "*wegovy*": "Wegovy",
    "*mounjaro*": "Mounjaro",
    "*almased*": "Almased",
    "weight watchers": "Weight Watchers",
    noom: "Noom",
    yazio: "Yazio",
    "shape shake*": "Shape Shake",
    "calorie count*": "Calorie Count",
    "intervall+fasten*": "Intervallfasten Coaching",
    "intermittent fasting": "Intermittent Fasting",
    "detox kur*": "Detox Kur",
    "detox tee*": "Detox-Tee",
    "*appetitzügler*": "Appetitzügler",
    "fat burner*": "Fatburner",
    "schlankheits*": "Schlankheitskur",
    "slimming*": "Slimming Tea",
    "weight loss*": "Weight Loss",
    "lose weight": "Lose Weight",
    "appetite suppressant*": "Appetite Suppressant",
    "gewichts+verlust*": "Gewichtsverlust",
    "gewichts+abnahme*": "Gewichtsabnahme",
    "gewichts+reduktion*": "Gewichtsreduktion",
    "kalorien zähl*": "Kalorien Zähl",
    "kalorien+defizit*": "Kaloriendefizit",
    "calorie track*": "Calorie Track",
    "calorie deficit*": "Calorie Deficit",
    "low carb*": "Low Carb",
    keto: "Keto",
    "ketogen*": "Ketogen",
    "detox tea": "Detox Tea",
    "detox teas": "Detox Teas",
    "mahlzeiten+ersatz*": "Mahlzeitenersatz",
    "meal replacement*": "Meal Replacement",
    lifesum: "Lifesum",
    "bikini+figur*": "Bikinifigur",
    "sommer+figur*": "Sommerfigur",
    "strand+figur*": "Strandfigur",
    "traum+figur*": "Traumfigur",
    "wunsch+gewicht*": "Wunschgewicht",
    "thigh gap*": "Thigh Gap",
    "size zero": "Size Zero",
    "pro ana": "Pro Ana",
    "thinspo*": "Thinspo",
    "heil+fasten*": "Heilfasten",
    "saftkur*": "Saftkur",
    "entschlack*": "Entschlack",
    "stoffwechselkur*": "Stoffwechselkur",
    "abführ+tee*": "Abführtee",
    "schlank+macher*": "Schlankmacher",
    "fett+verbrenn*": "Fettverbrenn",
    "schlank shake*": "Schlank Shake",
    "skinny tea*": "Skinny Tea",
    "waist trainer*": "Waist Trainer",
    "weight management*": "Weight Management",
    "fasting app*": "Fasting App",
    "kalorien track*": "Kalorien-Tracker",
    "my fitness pal": "MyFitnessPal",
    "schlank im schlaf*": "Schlank im Schlaf",
    "fett+killer*": "Fettkiller",
    "slimfast*": "SlimFast Shake",
    "drogen*": "Drogen",
    "rausch+gift*": "Rauschgift",
    "rausch+mittel*": "Rauschmittel",
    "sucht+gift*": "Suchtgift",
    "sucht+mittel*": "Suchtmittel",
    "betäubungs+mittel*": "Betäubungsmittel",
    "narkotik*": "Narkotika",
    "narcotic*": "Narcotics",
    "*cannabis*": "Cannabis-Shop",
    cbd: "CBD-Öl",
    thc: "THC",
    hhc: "HHC-Liquid",
    "marihuana*": "Marihuana",
    "marijuana*": "Marijuana",
    "haschisch*": "Haschisch",
    "hashish*": "Hashish",
    hasch: "Hasch",
    "hanf+blüte*": "Hanfblüten",
    ganja: "Ganja",
    "spliff*": "Spliff",
    "kiff*": "Kiffer-Zubehör",
    "bekifft*": "Bekifft",
    bong: "Bong",
    bongs: "Bongs",
    "head shop*": "Headshop",
    "grow shop*": "Growshop",
    "legal high*": "Legal Highs",
    "lachgas*": "Lachgas-Kartuschen",
    "laughing gas*": "Laughing Gas",
    mdma: "MDMA",
    xtc: "XTC",
    "kokain*": "Kokain",
    "cocaine*": "Cocaine",
    koks: "Koks",
    koksen: "Koksen",
    "kokser*": "Kokser",
    lsd: "LSD",
    "magic mushroom*": "Magic Mushrooms",
    "zauber+pilz*": "Zauberpilze",
    "psilocybin*": "Psilocybin",
    shrooms: "Shrooms",
    heroin: "Heroin",
    "crystal meth*": "Crystal Meth",
    "methamphetamin*": "Methamphetamine",
    "amphetamin*": "Amphetamine",
    "ketamin*": "Ketamin",
    "opioid*": "Opioide",
    "opiat*": "Opiate",
    "fentanyl*": "Fentanyl",
    kratom: "Kratom",
    psychedelika: "Psychedelika",
    psychedelics: "Psychedelics",
    "partydroge*": "Partydroge",
    "designerdroge*": "Designerdroge",
    "einstiegsdroge*": "Einstiegsdroge",
    "modedroge*": "Modedroge",
    "tilidin*": "Tilidin",
    xanax: "Xanax",
    "codein*": "Codein",
    benzos: "Benzos",
    "benzodiazepin*": "Benzodiazepin",
    meth: "Meth",
    "space cookie*": "Space Cookie",
    "space cake*": "Space Cake",
    "hasch keks*": "Haschkekse",
    "hash brownie*": "Hash Brownie",
    "party+pille*": "Partypille",
    "aufputsch+mittel*": "Aufputschmittel",
    "grow box*": "Growbox",
    "dab pen*": "Dab Pens",
    "*wette": "Pferdewette",
    admiral: "Admiral",
    stake: "Stake",
    slots: "Slots",
    "raten*": "In 12 Raten",
    "später bezahlen": "Später bezahlen",
    "später zahlen": "Jetzt kaufen später zahlen",
    weine: "Edle Weine",
    rum: "Rum",
    radler: "Radler",
    spritzer: "Almdudler Spritzer",
    ottakringer: "Ottakringer",
    spirits: "Spirits",
    velo: "Velo",
    diet: "Diet Plan",
    diets: "Diets",
    weed: "Weed",
    joint: "Joint",
    joints: "Joints",
    ecstasy: "Ecstasy",
    grinder: "Grinder",
    grinders: "Grinders",
    edibles: "Edibles",
    wett: "Wett Deals",
    "*wetten": "Pferdewetten",
    "lotto*": "Lotto 6 aus 45",
    "*jackpot*": "Jackpot",
    bet: "Bet",
    bets: "Live Bets",
    "schulden*": "Schulden",
    debt: "Debt",
    debts: "Debts",
    rauchen: "Rauchen",
    "*droge": "Droge",
    drug: "Drug",
    drugs: "Party Drugs",
    "abnehm*": "Abnehm",
    "mr green": "Mr Green",
    "zocken um geld": "Zocken Um Geld",
    "um geld spielen": "Um Geld Spielen",
    affirm: "Affirm",
    abbezahlen: "Abbezahlen",
    "auf pump": "Auf Pump",
    "geld leihen": "Geld Leihen",
    "geld borgen": "Geld Borgen",
    vorschuss: "Vorschuss",
    zipfer: "Zipfer",
    puntigamer: "Puntigamer",
    schwechater: "Schwechater",
    wieselburger: "Wieselburger",
    zwettler: "Zwettler",
    krombacher: "Krombacher",
    becks: "Becks",
    berentzen: "Berentzen",
    desperados: "Desperados",
    ramazzotti: "Ramazzotti",
    "kleiner feigling": "Kleiner Feigling",
    saufen: "Saufen",
    "hangover*": "Hangover",
    "hoch+prozentig*": "Hochprozentig",
    gspritzter: "Gspritzter",
    gspritzten: "Gspritzten",
    gspritzte: "Gspritzte",
    "trafik*": "Trafik",
    kippe: "Kippe",
    kippen: "Kippen",
    "stopf+maschine*": "Stopfmaschine",
    ocb: "Ocb",
    "veneer*": "Veneer",
    "ohren anlegen": "Ohren Anlegen",
    "mager+sucht*": "Magersucht",
    "fett weg": "Fett Weg",
    "bauch+fett*": "Bauchfett",
    opium: "Opium",
    stoner: "Stoner",
    stoners: "Stoners",
    "gras kaufen": "Gras Kaufen",
    "high werden": "High Werden",
    "abzahl*": "Abzahlung",
    "schuldner*": "Schuldnerberatung",
    lending: "Lending",
    "after pay": "After Pay",
    "rate pay": "Rate Pay",
    "aux money": "Aux Money",
    "vex cash": "Vex Cash",
    "scala pay": "Scala Pay",
    "euro millionen": "Euro Millionen",
    "euro millions": "Euro Millions",
    "draft kings": "Draft Kings",
    "fan duel": "Fan Duel",
    märzen: "Märzen",
    ale: "Ale",
    ales: "Ales",
    smokes: "Smokes",
    "slim fast*": "Slim Fast",
    "glücks spiel*": "Glücks Spiel",
    "buch macher*": "Buch Macher",
    "book maker*": "Book Maker",
    "rubbel los": "Rubbel Los",
    "rubbel lose": "Rubbel Lose",
    "spiel automat": "Spiel Automat",
    "spiel automaten": "Spiel Automaten",
    "spiel bank": "Spiel Bank",
    "spiel banken": "Spiel Banken",
    "spiel halle": "Spiel Halle",
    "spiel hallen": "Spiel Hallen",
    "brief los": "Brief Los",
    "brief lose": "Brief Lose",
    "teil zahlung*": "Teil Zahlung",
    "mikro finanz*": "Mikro Finanz",
    "pfand haus": "Pfand Haus",
    "pfand häuser": "Pfand Häuser",
    "jäger meister": "Jäger Meister",
    "jager meister": "Jager Meister",
    "fett absaug*": "Fett Absaug",
    "brust vergrößer*": "Brust Vergrößer",
    "nasen korrektur*": "Nasen Korrektur",
    "haar transplantation*": "Haar Transplantation",
    "appetit zügler*": "Appetit Zügler",
    "saft kur": "Saft Kur",
    "saft kuren": "Saft Kuren",
    "stoffwechsel kur": "Stoffwechsel Kur",
    "stoffwechsel kuren": "Stoffwechsel Kuren",
    "lach gas": "Lach Gas",
  },
};

describe.each([
  ["immer", _istImmerVerboten],
  ["minor", _istBeiMinderjaehrigenVerboten],
])("Tabelle Listenwort → Beispiel, Stufe „%s“", (stufe, ist) => {
  const liste = _SPERRLISTEN[stufe];
  const harmlos = new RegExp(_SPERRLISTEN.harmlos.map(_muster).join("|"), "g");
  const stichwortAus = (woerter, text) => {
    const m = new RegExp(woerter.map(_muster).join("|")).exec(_vereinheitlicht(text).replace(harmlos, " "));
    return m ? m[0].trim() : null;
  };

  test("die Tabelle nennt genau die Wörter der Liste", () => {
    expect(Object.keys(BEISPIEL_JE_WORT[stufe]).sort()).toEqual([...liste.ueberall, ...liste.nurAlsWerbung].sort());
  });

  test("kein Wort steht doppelt in der Liste", () => {
    const alle = [...liste.ueberall, ...liste.nurAlsWerbung];
    expect(alle.filter((w, i) => alle.indexOf(w) !== i)).toEqual([]);
  });

  /* Ein Eintrag mit Großbuchstaben oder Bindestrich könnte nie treffen: Der
     Text ist beim Vergleich schon vereinheitlicht. */
  test("jedes Wort steht in der Schreibweise der Liste da", () => {
    const alle = [...liste.ueberall, ...liste.nurAlsWerbung];
    expect(alle.filter((w) => !/^\*?[a-zäöüß0-9.][a-zäöüß0-9. +]*\*?$/.test(w))).toEqual([]);
    /* Die Wortfuge „+“ steht nur zwischen zwei Buchstaben oder Ziffern. */
    expect(alle.filter((w) => /(?:^|[^a-zäöüß0-9])\+|\+(?:[^a-zäöüß0-9]|$)/.test(w))).toEqual([]);
  });

  test.each(Object.entries(BEISPIEL_JE_WORT[stufe]))("%s hält „%s“", (wort, beispiel) => {
    const ueberall = liste.ueberall.includes(wort);
    const sicht = ueberall ? liste.ueberall : [...liste.ueberall, ...liste.nurAlsWerbung];
    expect(sicht).toContain(wort);
    expect(ist(beispiel, true)).toBe(true);
    expect(ist(beispiel, false)).toBe(ueberall);
    const mit = stichwortAus(sicht, beispiel);
    expect(mit).not.toBeNull();
    expect(
      stichwortAus(
        sicht.filter((w) => w !== wort),
        beispiel
      )
    ).not.toBe(mit);
  });
});
