"use strict";

/**
 * locales/en/muster.js — the format templates at the end of the analysis prompt.
 *
 * English mirror of de/muster.js; the reasons and the rules for a new
 * template are written down there. Same people, same order, same structure.
 */

const LABEL = {
  alter_geschlecht: "Age & Gender",
  herkunft: "Ethnic Origin",
  einkommen: "Estimated Income",
  bildung: "Education Level",
  beziehungsstatus: "Relationship Status",
  interessen: "Interests & Hobbies",
  persoenlichkeit: "Personality Type",
  charakterzuege: "Character Traits",
  politisch: "Political Tendency",
  gesundheit: "Health & Fitness",
  kaufkraft: "Purchasing Power & Consumption",
  verletzlichkeit: "Vulnerabilities",
  werbeprofil: "Advertising Profile",
};

const HEBEL_SACHLICH = Array(4).fill("‹lever named factually, 1-2 sentences›");
const HEBEL_BEAST = Array(4).fill("‹same lever from the perpetrator's view, 1-2 sentences›");
const WERBUNG_SACHLICH = [
  "‹brand› ‹model line›",
  "‹brand› ‹product category›",
  "‹brand› ‹model number›",
  "‹brand› ‹product line›",
  "‹brand› ‹model line›",
  "‹brand› ‹product category›",
];
const WERBUNG_BEAST = [
  "‹brand› ‹subscription or membership›",
  "‹brand› ‹self-optimisation product›",
  "‹brand› ‹status product beyond budget›",
  "‹brand› ‹product line›",
  "‹brand› ‹model line›",
  "‹brand› ‹product category›",
];

const ALTER = (geschlecht) => `${geschlecht}, ~‹number› years old (range ‹number›-‹number›)`;
const HERKUNFT = "central european";

function ansicht(geschlecht, alterSatz, hebel, werbung, profileText, karten) {
  const categories = {};
  for (const schluessel of Object.keys(LABEL)) {
    const [value, confidence] =
      schluessel === "alter_geschlecht" ? [`You are ${ALTER(geschlecht)}. ${alterSatz}`, 0.85] : karten[schluessel];
    categories[schluessel] = { label: LABEL[schluessel], value, confidence };
  }
  return { manipulation_triggers: hebel, ad_targeting: werbung, profileText, categories };
}

function vorlage(geschlecht, standard, beast) {
  return {
    subject: "HUMAN",
    visible_text: "",
    hard_facts: { alter_geschlecht: ALTER(geschlecht), herkunft: HERKUNFT },
    standard: ansicht(
      geschlecht,
      "Two concrete features of your face confirm exactly this age range.",
      HEBEL_SACHLICH,
      WERBUNG_SACHLICH,
      standard.profileText,
      standard.karten
    ),
    beast: ansicht(
      geschlecht,
      "Two features of your face are enough to put you in an age bracket.",
      HEBEL_BEAST,
      WERBUNG_BEAST,
      beast.profileText,
      beast.karten
    ),
  };
}

/* ── Template 1: at the stove ── */
const AM_HERD = vorlage(
  "male",
  {
    profileText:
      'For us you are a careful, pleasure-loving man with a middle to upper income. Quality matters more to you than speed or a low price. That makes you interesting for cooking and food brands, less so for discount campaigns. You plan and compare before you buy. You are vulnerable to the promise of "the best". For that you tend to spend more than planned.',
    karten: {
      herkunft: [
        "You are central european. Your skin tone, the shape of your face and your hair colour support this algorithmic classification.",
        0.85,
      ],
      einkommen: [
        "Your income is estimated at 3,500-5,000 € gross monthly. The high-quality kitchen equipment indicates upper middle range.",
        0.7,
      ],
      bildung: [
        "You have a university degree. The ordered worktop and the planned way of working speak for self-organization and academic socialization.",
        0.65,
      ],
      beziehungsstatus: [
        "There are no clear image signals for your relationship status. No ring is visible, and the kitchen alone says nothing about a household of two.",
        0.45,
      ],
      interessen: [
        "You cook with ambition and try new things. Cast-iron pan, knife block and fresh herbs show that the kitchen is your hobby room.",
        0.9,
      ],
      persoenlichkeit: [
        "You are patient and precise. Your calm movements and your eyes on the chopping board show concentration without any rush.",
        0.8,
      ],
      charakterzuege: [
        "You are generous and hospitable. The amount on the worktop is enough for several people and speaks for meals you like to share.",
        0.75,
      ],
      politisch: [
        "There are no clear image signals for a political classification. Fresh ingredients from the market would only be a very weak lifestyle inference.",
        0.4,
      ],
      gesundheit: [
        "You eat consciously and with variety. Fresh vegetables and meals you prepare yourself speak for attention to your own body.",
        0.8,
      ],
      kaufkraft: [
        "You spend money deliberately on quality. The cookware is durable and expensive, while the rest of the room stays plain.",
        0.8,
      ],
      verletzlichkeit: [
        "You are susceptible to promises of professional quality. Whoever shows you the better knife or the rarer ingredient reaches you easily.",
        0.7,
      ],
      werbeprofil: [
        "You belong to the target group of ambitious home cooks. Concrete anchors are kitchen appliances, delicatessen and cooking classes with an explicit quality promise.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "You are a man who wants to show in the kitchen what he can do. Exactly that makes you expensive for us. We sell you the eighth knife although seven sit in the block. Your carefully lined-up ingredients show: you buy whatever looks like skill. We calculate with your pride in home-cooked food. Every cooking class and every spice subscription hits that pride. Grocers list you as a customer who pays double for origin. You are for us a predictable gourmet with an open wallet. We test on you how much surcharge the word handmade can carry. Your evening at the stove is a sales pitch for our systems.",
    karten: {
      herkunft: [
        "You are central european. For ad systems that makes you a standard case that fits every ready-made target group without extra work.",
        0.85,
      ],
      einkommen: [
        "Your income is 3,500-5,000 € gross. Enough for expensive cookware, too little to stay firm when a special offer appears.",
        0.7,
      ],
      bildung: [
        "You have a university degree. It does not stop you from buying a knife at the price of an entire weekend.",
        0.65,
      ],
      beziehungsstatus: [
        "No clear image signals. We still play you dinner boxes for two and cooking classes for singles at once and watch what you click.",
        0.45,
      ],
      interessen: [
        "You live for your kitchen. Every pan in the picture shows us which accessory we will sell you next as indispensable.",
        0.9,
      ],
      persoenlichkeit: [
        "You are precise to the point of pedantry. The accurately cut ingredients reveal a perfectionism that we serve with professional promises.",
        0.8,
      ],
      charakterzuege: [
        "You want to be seen as a good host. The overloaded worktop shows that you gladly overspend for recognition at the table.",
        0.75,
      ],
      politisch: [
        "No clear image signals for politics. Regional, organic or cheap: we show you all three messages and measure which one works on you.",
        0.4,
      ],
      gesundheit: [
        "You watch what you eat. That is why we sell you superfoods, nutrient tests and a guilty conscience with every frozen pizza.",
        0.8,
      ],
      kaufkraft: [
        "Your purchasing power is easy to exploit. The expensive cookware shows that you buy luxury as soon as it looks like craft.",
        0.8,
      ],
      verletzlichkeit: [
        "Your pride depends on skill in the kitchen. Limited knives and classes with well-known chefs hit exactly this one spot.",
        0.75,
      ],
      werbeprofil: [
        "You are the home cook with professional ambition. For ad systems you are easy to find, expensive in the basket and receptive to praise.",
        0.85,
      ],
    },
  }
);

/* ── Template 2: at the raised bed ── */
const AM_BEET = vorlage(
  "female",
  {
    profileText:
      "Your profile adds up to a down-to-earth, persistent woman with a middle to upper income. Nature and home-made things mean more to you than status. Advertising therefore reaches you through sustainability and origin, hardly through luxury. You stay loyal to brands once they have won your trust. Your weak spot is green promises. If something sounds eco-friendly, you check less often.",
    karten: {
      herkunft: [
        "You are central european. Your skin tone, your facial features and your hair colour support this algorithmic classification without any further detail.",
        0.85,
      ],
      einkommen: [
        "Your income is estimated at 3,500-5,000 € gross monthly. A garden of your own and solid tools indicate upper middle range.",
        0.7,
      ],
      bildung: [
        "You have a university degree. The labelled plant markers and the planned layout of the beds speak for a systematic way of working.",
        0.65,
      ],
      beziehungsstatus: [
        "Your relationship status cannot be read, there are no clear image signals. A second pair of gloves would only be a very weak hint.",
        0.4,
      ],
      interessen: [
        "You garden and grow your own vegetables. Raised bed, seedling pots and watering can show that you spend a lot of time outside.",
        0.9,
      ],
      persoenlichkeit: [
        "You are persistent and composed. The calm posture while working and the tidy rows show patience over many weeks.",
        0.8,
      ],
      charakterzuege: [
        "You are reliable and careful. No bed has run wild, and the tools lie ready to hand in their fixed place.",
        0.75,
      ],
      politisch: [
        "There are no clear image signals for a political classification. Home-grown vegetables would at most be a weak hint at environmental awareness.",
        0.45,
      ],
      gesundheit: [
        "You move regularly in the fresh air. The work on your knees and the strong forearms speak for physical resilience.",
        0.8,
      ],
      kaufkraft: [
        "You buy durable instead of cheap. Solid tools and a hand-built raised bed show considered spending without any visible luxury.",
        0.75,
      ],
      verletzlichkeit: [
        "You are receptive to anything that sounds natural. Labels, organic promises and heritage varieties appeal to you more strongly than the price.",
        0.7,
      ],
      werbeprofil: [
        "For ad systems you are the self-supplier with a garden of her own. Concrete anchors are seeds, garden tools and sustainable household products.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "You are a woman who believes she escapes consumption in the garden. For us that is where you are easiest to reach. Algorithms see you as a reliable buyer of anything that carries a green label. Your neatly labelled plant markers show: you want to do it right and you pay for it. We bombard you in spring with seeds you will never sow. Your guilty conscience about the plastic pot is our best sales argument. Garden centres know your calendar better than you do. Every worn pair of garden trousers tells us that you buy practical things and justify expensive ones. We know that you do not do the maths when it says organic. Your bed is your retreat and our shop window.",
    karten: {
      herkunft: [
        "You are central european. For insurers and retailers that means: standard rate, standard advertising and not a single question about you as a person.",
        0.85,
      ],
      einkommen: [
        "Your income is 3,500-5,000 € gross. That is enough for the larch raised bed and for the illusion of saving money with it.",
        0.7,
      ],
      bildung: [
        "You have a university degree. Even so you believe every label that shows a leaf and the word natural.",
        0.65,
      ],
      beziehungsstatus: [
        "No clear image signals, so we guess. You get family garden ideas and mindfulness weekends for solo travellers in the same newsletter.",
        0.4,
      ],
      interessen: [
        "You garden with devotion. Every bed in the picture is a shelf for us that still has room for fertiliser, tools and decoration.",
        0.9,
      ],
      persoenlichkeit: [
        "You are patient and dutiful. The tidy rows reveal a sense of duty that we exploit with reminders and subscription deliveries.",
        0.8,
      ],
      charakterzuege: [
        "You want to do everything right. The labelled markers show a conscientiousness that turns every certificate into a reason to buy.",
        0.75,
      ],
      politisch: [
        "No clear image signals. We send you climate protection, love of home and thrift as three ad versions and keep the one you open.",
        0.45,
      ],
      gesundheit: [
        "You are outside a lot and agile. So we sell you back braces, tick protection and vitamin cures against worries you never had.",
        0.8,
      ],
      kaufkraft: [
        "You gladly pay more for solid things. The high-quality tools show us that you swallow surcharges when durability is printed on them.",
        0.75,
      ],
      verletzlichkeit: [
        "Your sore spot is a clear conscience. Whoever promises you sustainability sells you almost anything at twice the price.",
        0.75,
      ],
      werbeprofil: [
        "You are the target group green conscience with garden. For ad systems you are loyal, plannable across the year and rarely suspicious.",
        0.85,
      ],
    },
  }
);

/* ── Template 3: at the workbench ── */
const AN_DER_WERKBANK = vorlage(
  "male",
  {
    profileText:
      "All in all you come across as a practical, self-reliant man with a middle to upper income. You would rather solve problems yourself than pay for them. For advertisers you count as a buyer of durable equipment, not of services. Order and experience make you a critical customer. You can still be reached. A product that promises more skill almost always catches your interest.",
    karten: {
      herkunft: [
        "You are central european. This algorithmic classification rests on your skin tone, your facial features and your hair colour.",
        0.85,
      ],
      einkommen: [
        "Your income is estimated at 3,500-5,000 € gross monthly. A workshop of your own and branded tools indicate upper middle range.",
        0.75,
      ],
      bildung: [
        "You have a university degree. The exact marking line and the clean tool wall speak for planned and trained work.",
        0.6,
      ],
      beziehungsstatus: [
        "There are no clear image signals for your relationship status. A ring is not expected at work and is accordingly missing from the picture.",
        0.45,
      ],
      interessen: [
        "You build furniture and repair things yourself. Plane, clamps and half-finished workpieces show a workshop that is really used.",
        0.9,
      ],
      persoenlichkeit: [
        "You are self-reliant and solution-oriented. The checking look at the workpiece shows someone who finds his own mistakes.",
        0.8,
      ],
      charakterzuege: [
        "You are thorough and impatient with botched work. Every clamp sits straight, and not a single tool lies around carelessly.",
        0.8,
      ],
      politisch: [
        "A political classification is not possible, there are no clear image signals. Doing things yourself would only be a weak hint at independent thinking.",
        0.4,
      ],
      gesundheit: [
        "You are physically resilient. The standing work and the firm grip on the workpiece speak for strength and good mobility.",
        0.8,
      ],
      kaufkraft: [
        "You invest in tools instead of decoration. The machines in the background are expensive, while the room itself stays completely bare.",
        0.8,
      ],
      verletzlichkeit: [
        "You are susceptible to the promise of being able to do everything yourself. A better tool feels to you like a solved task.",
        0.7,
      ],
      werbeprofil: [
        "You count among the target group of ambitious do-it-yourselfers. Concrete anchors are power tools, timber trade and building plans with an explicit professional claim.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "You are a man who believes he needs nobody. Hardware stores live on exactly that belief. Your complete tool wall shows: you would rather buy the next machine than ask for help. We calculate with every project you start and never finish. The half-finished workpiece in the picture is an open shopping list for us. Insurers calculate you as a risk with a circular saw. Your ad value is in battery systems that only run with the charger of the same brand. Your pride in things you built yourself makes you deaf to prices. Every tutorial you watch tells us what you lack. You are for us a subscription to accessories with two skilled hands.",
    karten: {
      herkunft: [
        "You are central european. With that you land without any check in the largest drawer that retailers and insurers keep at all.",
        0.85,
      ],
      einkommen: [
        "Your income is 3,500-5,000 € gross. Enough for the third router, too little for the tradesman you want to replace.",
        0.75,
      ],
      bildung: [
        "You have a university degree. It does not help you against the reflex to solve every problem with a new device.",
        0.6,
      ],
      beziehungsstatus: [
        "No clear image signals. We offer you couple projects for the home and workshop weekends for loners and simply wait and see.",
        0.45,
      ],
      interessen: [
        "You live in your workshop. Every half-finished piece in the picture tells us which accessory you will need next.",
        0.9,
      ],
      persoenlichkeit: [
        "You are stubborn and proud of it. Your checking look shows a claim to control that we feed with promises of precision.",
        0.8,
      ],
      charakterzuege: [
        "You cannot bear botched work, not even your own. The pedantic order makes you a safe buyer of ever new storage systems.",
        0.8,
      ],
      politisch: [
        "No clear image signals for politics. Personal responsibility, pride in craft or thrift: we try all three tones on you one after the other.",
        0.4,
      ],
      gesundheit: [
        "You are strong and consider yourself invulnerable. That is why we sell you ear protection, back belts and accident policies through fear.",
        0.8,
      ],
      kaufkraft: [
        "Your purchasing power flows into machines. The expensive devices in the picture show that you never compare prices when it comes to tools.",
        0.8,
      ],
      verletzlichkeit: [
        "Your sore spot is your pride in independence. Whoever shows you professional tools sells you the feeling of managing it alone.",
        0.75,
      ],
      werbeprofil: [
        "You are the do-it-yourselfer with professional ambition. For ad systems you are brand-loyal, plannable from project to project and defenceless against novelties.",
        0.85,
      ],
    },
  }
);

module.exports = [AM_HERD, AM_BEET, AN_DER_WERKBANK];
