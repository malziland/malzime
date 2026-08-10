"use strict";

/**
 * animal.js — Subject-Klassifikation aus Mistral-Beschreibungstext.
 *
 * Seit v1.6.0 (Pure-Mistral-Architektur) gibt es KEINE Vision-API mehr.
 * Tier-/Personen-Erkennung läuft jetzt über zwei Quellen:
 *
 *  1. SUBJECT-Kopfzeile in Mistrals Bildbeschreibung
 *     (Format "SUBJECT: ANIMAL_ONLY | HUMAN | MIXED | OTHER" — siehe
 *     prompts.js mistralDescribeAddendum).
 *
 *  2. Wenn SUBJECT == ANIMAL_ONLY: Keyword-Match im Beschreibungstext,
 *     um die konkrete Tierart fürs Easter-Egg-Profil zu wählen
 *     (Hund/Katze/Vogel/Fisch/Pferd/Kaninchen/generic).
 *
 * Die deutschen Tier-Profile selbst liegen in locales/de/animals.js.
 */

const { loadAnimals } = require("./i18n");

const VALID_SUBJECTS = new Set(["ANIMAL_ONLY", "HUMAN", "MIXED", "OTHER"]);
const SUBJECT_REGEX = /^SUBJECT:\s*(ANIMAL_ONLY|HUMAN|MIXED|OTHER)\b/im;

/* Tier-Typ-Keywords für Easter-Egg-Auswahl. Pro Typ deutsche UND englische
   Begriffe, damit das System auch in den anderen Locales funktioniert. */
const TYPE_KEYWORDS = Object.freeze({
  dog: ["hund", "hunde", "welpe", "welpen", "dog", "dogs", "puppy", "puppies"],
  cat: ["katze", "katzen", "kätzchen", "kater", "cat", "cats", "kitten", "kittens"],
  bird: [
    "vogel",
    "vögel",
    "papagei",
    "papageien",
    "huhn",
    "ente",
    "eule",
    "bird",
    "birds",
    "parrot",
    "owl",
    "chicken",
    "duck",
    "penguin",
  ],
  fish: ["fisch", "fische", "goldfisch", "goldfische", "fish", "goldfish", "shark"],
  horse: ["pferd", "pferde", "pony", "fohlen", "esel", "horse", "horses", "donkey"],
  rabbit: ["kaninchen", "hase", "hasen", "hamster", "meerschweinchen", "rabbit", "bunny", "hamster", "guinea pig"],
});

const TYPE_PATTERNS = Object.freeze(
  Object.fromEntries(
    Object.entries(TYPE_KEYWORDS).map(([type, kws]) => [
      type,
      kws.map((kw) => new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`, "i")),
    ])
  )
);

/**
 * Parst die SUBJECT-Kopfzeile aus Mistrals Bildbeschreibung und entscheidet:
 * Mensch im Bild? Tier im Bild? Wenn Tier-only: welche Art?
 *
 * Fail-safe: wenn keine SUBJECT-Zeile vorhanden ist, gilt das Bild als HUMAN
 * (restriktivste Annahme — kein Easter-Egg, normale Profil-Pipeline läuft).
 *
 * @param {string} description — Mistral-Beschreibungstext (mit SUBJECT-Kopfzeile)
 * @returns {{ subject: string, hasPerson: boolean, hasAnimal: boolean, animalType: string|null }}
 */
function classifyDescription(description) {
  if (!description || typeof description !== "string") {
    return { subject: "HUMAN", hasPerson: true, hasAnimal: false, animalType: null };
  }

  const match = description.match(SUBJECT_REGEX);
  const subject = match && VALID_SUBJECTS.has(match[1].toUpperCase()) ? match[1].toUpperCase() : "HUMAN";

  const hasPerson = subject === "HUMAN" || subject === "MIXED";
  const hasAnimal = subject === "ANIMAL_ONLY" || subject === "MIXED";

  let animalType = null;
  if (subject === "ANIMAL_ONLY") {
    animalType = detectAnimalType(description);
  }

  return { subject, hasPerson, hasAnimal, animalType };
}

/* ── Netz gegen Tier-als-Mensch ───────────────────────────────────────────
   ANLASS (Vorfall in einem Workshop, gemeldet 2026-08-10): Ein Schueler hat
   das Bild eines Affen hochgeladen, und das Modell hat daraus ein Profil eines
   afrikanischen Kleinkindes erzeugt. Die Verwechslung Primat/schwarzer Mensch
   ist ein dokumentiertes Muster in Bildmodellen (Google Photos 2015, dort nie
   behoben — nur die Kategorie entfernt), kein Zufall dieses einen Bildes.

   Die vorhandene Tiererkennung hat NICHT versagt: Sie folgt dem Feld `subject`,
   und das Modell hatte HUMAN gemeldet. Eine zusaetzliche Vorpruefung "ist ein
   Mensch im Bild?" wuerde deshalb nichts bringen — sie existiert bereits und
   traefe dieselbe Fehlentscheidung.

   Dieses Netz greift eine Ebene tiefer: Wenn das Modell HUMAN meldet, aber im
   Text Merkmale beschreibt, die es bei Menschen nicht gibt, ist die Antwort in
   sich widerspruechlich — dann wird nicht ausgeliefert.

   GRENZE, ehrlich benannt: Beschreibt das Modell durchgehend einen Menschen,
   findet auch dieses Netz nichts. Es faengt die inkonsistenten Faelle, nicht
   die vollstaendig falschen. Der Haupthebel bleibt die Regel im Prompt. */

/* Begriffe, die es bei einem Menschen NICHT gibt. Bewusst eng gehalten:
   Ein zu scharfer Filter blockiert echte Fotos, und das waere im Workshop
   schlimmer als ein seltener Durchrutscher. */
const TIER_MERKMALE = [
  /\b(?:affe|affen|schimpanse|gorilla|orang-?utan|makake|menschenaffe|primat)\w*\b/i,
  /\b(?:monkey|monkeys|chimpanzee|ape|apes|primate)\w*\b/i,
  /\bschnauze\b|\bmuzzle\b|\bsnout\b/i,
  /\b(?:pfote|pfoten|tatze|tatzen|kralle|krallen)\b/i,
  /\b(?:paw|paws|claw|claws)\b/i,
  /\bschnurrhaar\w*\b|\bwhiskers\b/i,
  /\bfell\b|\bpelz\b|\bfur\b/i,
];

/* Ausnahmen: Woerter, die ein Tier-Merkmal enthalten, aber nichts damit zu tun
   haben. "Pferdeschwanz" ist eine Frisur, "Fellweste" ein Kleidungsstueck,
   "Katzenaugen" ein Make-up. Ohne diese Liste blockiert das Netz Alltagsfotos. */
const KEIN_TIER = [
  /pferdeschwanz|ponytail/i,
  /fell(?:weste|jacke|kragen|imitat|mantel|muetze|mütze)/i,
  /kunstfell|fake ?fur|faux ?fur/i,
  /katzenaugen|cat ?eye/i,
];

/**
 * Widerspruchsprüfung: Meldet das Modell einen Menschen, obwohl es Tier-
 * merkmale beschreibt?
 *
 * @param {string} subject — Wert aus classifyDescription
 * @param {string} description — Beschreibungstext des Modells
 * @returns {{ widerspruch: boolean, treffer: string|null }}
 */
function pruefeTierWiderspruch(subject, description) {
  const leer = { widerspruch: false, treffer: null };
  if (subject !== "HUMAN" || !description || typeof description !== "string") return leer;

  /* Erst die Ausnahmen entfernen, dann suchen — sonst schlägt "Pferdeschwanz"
     über das enthaltene "Schwanz" an. */
  const bereinigt = KEIN_TIER.reduce((text, re) => text.replace(new RegExp(re.source, "gi"), " "), description);

  for (const re of TIER_MERKMALE) {
    const m = bereinigt.match(re);
    if (m) return { widerspruch: true, treffer: m[0] };
  }
  return leer;
}

/**
 * Sucht im Text nach Keywords für die unterstützten Tier-Typen und zählt die
 * Treffer pro Typ. Der Typ mit den MEISTEN Treffern gewinnt — so verliert ein
 * einzeln erwähntes "Hund" gegen eine mehrfach genannte "Katze". Fallback
 * "generic", wenn keine konkrete Art erkannt wird.
 *
 * @param {string} description
 * @returns {string} — einer von "dog" | "cat" | "bird" | "fish" | "horse" | "rabbit" | "generic"
 */
function detectAnimalType(description) {
  let best = "generic";
  let bestCount = 0;
  for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
    let count = 0;
    for (const re of patterns) {
      const matches = description.match(new RegExp(re.source, "gi"));
      if (matches) count += matches.length;
    }
    if (count > bestCount) {
      bestCount = count;
      best = type;
    }
  }
  return best;
}

/* ── Profil-Generierung aus Locale-Daten (unverändert seit v1.5.x) ── */

function resolve(data, type) {
  if (typeof data === "string") return data;
  return data[type] || data._ || "";
}

function fillTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || key);
}

function buildProfile(modeData, labels, typeInfo, type) {
  const categories = {};
  for (const [key, catData] of Object.entries(modeData.categories)) {
    categories[key] = {
      label: labels[key] || key,
      value: catData.values ? resolve(catData.values, type) : catData.value,
      confidence: catData.confidence,
    };
  }
  return {
    categories,
    ad_targeting: modeData.ad_targeting.map((item) => resolve(item, type)),
    manipulation_triggers: modeData.manipulation_triggers.map((item) => {
      const text = resolve(item, type);
      return fillTemplate(text, typeInfo);
    }),
    profileText: fillTemplate(modeData.profileText, typeInfo),
  };
}

/**
 * Erzeugt das Normal- und Boost-Profil für eine erkannte Tierart.
 *
 * @param {string} animalType — aus classifyDescription().animalType (oder "generic")
 * @param {string} lang — Sprachcode
 * @returns {{ normalProfile: object, boostProfile: object }}
 */
function buildAnimalProfiles(animalType, lang) {
  const animalData = loadAnimals(lang || "de");
  const type = animalType && animalData.types[animalType] ? animalType : "generic";
  const typeInfo = animalData.types[type];
  const { labels } = animalData;
  const normalProfile = buildProfile(animalData.normal, labels, typeInfo, type);
  const boostProfile = buildProfile(animalData.boost, labels, typeInfo, type);
  return { normalProfile, boostProfile };
}

module.exports = {
  classifyDescription,
  detectAnimalType,
  pruefeTierWiderspruch,
  buildAnimalProfiles,
  TYPE_KEYWORDS,
  VALID_SUBJECTS,
  SUBJECT_REGEX,
};
