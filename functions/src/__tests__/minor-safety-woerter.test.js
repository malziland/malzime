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
      "Food-Porn",
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
      "Pokerstars",
      "Slots",
      "Slot Machines",
      "Lottery",
      "Scratch Cards",
      "Stake",
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
      "Hyaluron",
      "Filler",
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
    "*joyclub*": "Joyclub",
    "*amorelie*": "Amorelie",
    "beate uhse": "Beate Uhse",
    "eis.de": "Eis.de Toys",
    "porn*": "Pornoseite",
    "*porno*": "Softporno",
    "*erotik*": "Erotik-Shop",
    "erotic*": "Erotic Massage",
    "*cam girl*": "Webcam-Girls",
    "adult webcam*": "Adult Webcam",
    "*sexcam*": "Livesexcam",
    "sex cam*": "Sex Cam",
    "*sexshop*": "Onlinesexshop",
    "sex shop*": "Sex-Shop",
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
    "striptease*": "Striptease",
    "*hentai*": "Hentai",
    "xxx video*": "XXX Videos",
    "xxx film*": "XXX Filme",
    "sugar daddy*": "Sugardaddy-Portal",
    "sugar babe*": "Sugar Babe",
    "sugar baby*": "Sugar Baby",
    "sugar dating": "Sugar Dating",
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
    "shotgun*": "Shotgun",
    gun: "BB Gun",
    guns: "Guns kaufen",
    "*handgun*": "Handgun",
    "rifle*": "Rifle",
    "*firearm*": "Firearm",
    ammo: "Ammo",
    "*silencer*": "Silencer",
    "schalldämpfer*": "Schalldämpfer",
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
    "only fans": "Only Fans",
    "sexting*": "Sexting-App",
    "waffen*": "Waffenkammer",
    "*waffen": "Dienstwaffen",
    "*waffe": "Dienstwaffe",
    "weapon*": "Weapons",
    pistole: "Pistole",
    pistolen: "Pistolen",
    pistol: "Pistol",
    "*gewehr": "Luftgewehr",
    "*gewehre": "Jagdgewehre",
    "*gewehren": "Handel mit Gewehren",
    "*gewehrs": "des Luftgewehrs",
    revolver: "Revolver",
    revolvers: "Revolvers",
    "far right": "Far-right apparel",
    "alt right": "Alt-Right Merch",
  },
  minor: {
    "*bet365*": "Bet365 Live",
    "*tipico*": "Tipico",
    bwin: "Bwin",
    "*betano*": "Betano",
    "*winamax*": "Winamax",
    "*tipp3*": "Tipp3",
    win2day: "Win2day",
    novomatic: "Novomatic",
    novoline: "Novoline",
    pokerstars: "Pokerstars",
    betway: "Betway",
    unibet: "Unibet",
    "*casino*": "Online-Casino",
    "*kasino*": "Kasino",
    "*jackpot*": "Jackpot",
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
    wett: "Wett-App",
    "*wetten": "Pferdewetten",
    "*gambling*": "Gambling",
    "*betting*": "Betting",
    "*bookmaker*": "Bookmaker",
    "bookie*": "Bookie",
    "slot machine*": "Slot Machines",
    poker: "Poker",
    bet: "Bet",
    bets: "Live Bets",
    "wager*": "Wager",
    "lotto*": "Lotto 6 aus 45",
    "*lotterie*": "Österreichische Lotterien",
    "lottery*": "Lottery",
    euromillionen: "Euromillionen",
    euromillions: "Euromillions",
    "rubbellos*": "Rubbellos",
    "scratch card*": "Scratch Card",
    roulette: "Roulette",
    "*spielautomat*": "Spielautomat",
    "automatenspiel*": "Automatenspiel",
    "spielbank*": "Spielbank",
    "spielhalle*": "Spielhalle",
    "spielothek*": "Spielothek",
    "*kredit*": "Sofortkredit",
    "*darlehen*": "Konsumentendarlehen",
    "*ratenkauf*": "Ratenkauf",
    "*ratenzahlung*": "Ratenzahlung",
    "ratenplan*": "Ratenplan",
    "monatsrate*": "Monatsrate",
    "*teilzahlung*": "Teilzahlung",
    "*finanzierung*": "0%-Finanzierung",
    "*financing*": "Financing",
    klarna: "Klarna",
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
    "overdraft*": "Overdraft",
    "schulden*": "Schulden",
    "*umschuldung*": "Umschuldung",
    debt: "Debt",
    debts: "Debts",
    "*hypothek*": "Hypothek",
    "*mortgage*": "Mortgage",
    "kauf auf rechnung": "Kauf auf Rechnung",
    "rechnungskauf*": "Rechnungskauf",
    loan: "Loan",
    loans: "Loans",
    "*payday*": "Payday",
    "installment*": "Installment",
    "instalment*": "Instalment",
    "buy now pay later": "Buy Now Pay Later",
    "pay later": "PayPal Pay Later",
    bnpl: "Bnpl",
    "credit card*": "Credit Card",
    "*alkohol*": "Alkohol-Lieferdienst",
    "*alcohol*": "Alcohol Delivery",
    "*alkopop*": "Alkopop",
    "*alcopop*": "Alcopop",
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
    "wasserpfeife*": "Wasserpfeife",
    "hookah*": "Hookah",
    rauchen: "Rauchen",
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
    "*botox*": "Botox",
    "*hyaluron*": "Hyaluron",
    filler: "Filler",
    fillers: "Fillers",
    "lip filler*": "Lipfiller",
    "lip injection*": "Lip Injection",
    "schönheits op*": "Schönheits-OP",
    "schönheitschirurg*": "Schönheitschirurgie",
    "schönheitskorrektur*": "Schönheitskorrektur",
    "schönheitsklinik*": "Schönheitsklinik",
    "schönheitseingriff*": "Schönheitseingriff",
    "beauty op": "Beauty-OP",
    "beauty ops": "Beauty-OPs",
    "beauty operation*": "Beauty Operation",
    "beauty korrektur*": "Beauty-Korrektur",
    "plastische chirurgie": "Plastische Chirurgie",
    "plastic surgery": "Plastic Surgery",
    "cosmetic surgery": "Cosmetic Surgery",
    "cosmetic procedure*": "Cosmetic Procedure",
    "*fettabsaug*": "Fettabsaugung",
    "fettweg spritze*": "Fettweg-Spritze",
    "*brustvergrößer*": "Brustvergrößerung",
    "brustverkleinerung*": "Brustverkleinerung",
    "bruststraffung*": "Bruststraffung",
    "brust op": "Brust-OP",
    "brustoperation*": "Brustoperation",
    "nasen op": "Nasen-OP",
    "nasenoperation*": "Nasenoperation",
    "*nasenkorrektur*": "Nasenkorrektur",
    "lippen aufspritz*": "Lippen aufspritzen",
    "*unterspritzung*": "Lippenunterspritzung",
    "facelift*": "Facelift",
    "lidstraffung*": "Lidstraffung",
    "*haartransplantation*": "Haartransplantation",
    "hair transplant*": "Hair Transplant",
    "breast augmentation": "Breast Augmentation",
    "breast enlargement*": "Breast Enlargement",
    "boob job*": "Boob Job",
    "nose job*": "Nose Job",
    "rhinoplast*": "Rhinoplast",
    "tummy tuck*": "Tummy Tuck",
    "*liposuction*": "Liposuction",
    "diät*": "Diätplan",
    "*diät": "Nulldiät",
    dieting: "Dieting",
    "diet pill*": "Diet Pills",
    abnehm: "Abnehm-App",
    "abnehmspritze*": "Abnehmspritze",
    "abnehmcoaching*": "Abnehmcoaching",
    "abnehmkur*": "Abnehmkur",
    "abnehmpille*": "Abnehmpille",
    "abnehmprogramm*": "Abnehmprogramm",
    "abnehmapp*": "Abnehmapp",
    "abnehmshake*": "Abnehmshake",
    "abnehmtablette*": "Abnehmtablette",
    "abnehmtee*": "Abnehmtee",
    "abnehmplan*": "Abnehmplan",
    "abnehmprodukt*": "Abnehmprodukt",
    "abnehmmittel*": "Abnehmmittel",
    "*ozempic*": "Ozempic",
    "*wegovy*": "Wegovy",
    "*mounjaro*": "Mounjaro",
    "*almased*": "Almased",
    "*slimfast*": "Slimfast",
    "weight watchers": "Weight Watchers",
    noom: "Noom",
    yazio: "Yazio",
    "shape shake*": "Shape Shake",
    "kalorienzähler*": "Kalorienzähler Premium",
    "calorie count*": "Calorie Count",
    "intervallfasten*": "Intervallfasten Coaching",
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
    "gewichtsverlust*": "Gewichtsverlust",
    "gewichtsabnahme*": "Gewichtsabnahme",
    "gewichtsreduktion*": "Gewichtsreduktion",
    "drogen*": "Drogen",
    "*droge": "Partydroge",
    "partydrogen*": "Partydrogen",
    "designerdrogen*": "Designerdrogen",
    "einstiegsdrogen*": "Einstiegsdrogen",
    "modedrogen*": "Modedrogen",
    drugs: "Party Drugs",
    "rauschgift*": "Rauschgift",
    "rauschmittel*": "Rauschmittel",
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
    "hanfblüte*": "Hanfblüten",
    ganja: "Ganja",
    "spliff*": "Spliff",
    "kiff*": "Kiffer-Zubehör",
    "bekifft*": "Bekifft",
    bong: "Bong",
    bongs: "Bongs",
    "head shop*": "Headshop",
    "grow shop*": "Growshop",
    "growbox*": "Growbox",
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
    "zauberpilz*": "Zauberpilze",
    "psilocybin*": "Psilocybin",
    shrooms: "Shrooms",
    heroin: "Heroin",
    "crystal meth*": "Crystal Meth",
    "methamphetamin*": "Methamphetamine",
    "amphetamin*": "Amphetamine",
    "ketamin*": "Ketamin",
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
    diet: "Keto Diet",
    abnehmen: "Abnehmen",
    weed: "Weed",
    joint: "Joint",
    joints: "Joints",
    ecstasy: "Ecstasy",
    grinder: "Grinder",
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
    expect(alle.filter((w) => !/^\*?[a-zäöüß0-9.][a-zäöüß0-9. ]*\*?$/.test(w))).toEqual([]);
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
