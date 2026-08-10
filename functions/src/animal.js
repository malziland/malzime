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

/* ── ENTFERNT mit dem Audit vom 2026-08-10: pruefeTierWiderspruch ─────────
   Hier stand ein "Netz gegen Tier-als-Mensch": Meldet das Modell HUMAN,
   beschreibt aber Fell, Schnauze oder einen Primaten, sollte statt des
   Menschenprofils das Tier-Easter-Egg ausgeliefert werden. Anlass war ein
   Affenbild, aus dem ein Profil eines afrikanischen Kleinkindes wurde.

   WARUM ES WIEDER RAUS IST — zwei Gruende, der zweite wiegt schwerer:

   1. Zu weite Wortsuche. Hinter kurzen Wortstaemmen stand ein `\w*`, also fing
      "ape" das x von "Apex" und "affe" das kt von "Affekt". Ein Jugendlicher
      mit "Apex Legends" in den Interessen bekam ein Tier-Profil.

   2. Konstruktionsfehler. Geprueft werden sollte die BILDBESCHREIBUNG des
      Modells. Im aktiven Single-Large-Pfad gibt es die aber nicht mehr —
      handle-process-job.js baut sie aus dem FERTIGEN PROFIL zusammen. Geprueft
      wurde damit ein Text ueber einen Menschen.

   Folge: Beim echten Affenbild griff das Netz NICHT (das Modell schreibt dort
   ein Kinderprofil ohne Tierwoerter). Es schlug ausschliesslich bei harmlosen
   Woertern an. Es hat seinen Anlassfall nie gefangen und nur Schaden gemacht —
   deshalb ersatzlos entfernt statt die Wortliste zu entschaerfen.

   Der Schutz liegt jetzt allein in der Prompt-Regel "Primaten sind immer
   ANIMAL_ONLY" (in den prompts.js beider Locales, in BEIDEN Pfaden und BEIDEN
   Sprachen). Dort faellt die Entscheidung tatsaechlich. Nicht wieder aufbauen, ohne
   das Grundproblem zu loesen: Ein Netz braucht die echte Bildbeschreibung als
   Eingabe, nicht das erzeugte Profil. */

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
  buildAnimalProfiles,
  TYPE_KEYWORDS,
  VALID_SUBJECTS,
  SUBJECT_REGEX,
};
