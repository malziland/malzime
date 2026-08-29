"use strict";

/**
 * mistral-mock.js — Attrappe der Mistral-Pipeline für kostenlose Tests.
 *
 * Bietet exakt dieselbe Schnittstelle wie mistral.js (`describeImage`,
 * `generateBothProfiles`, `isRateLimitError`), ruft aber NIE die echte API.
 * Stattdessen: konfigurierbare Verzögerung + vorgefertigtes, strukturell
 * gültiges Profil-JSON.
 *
 * Zweck: Queue-Mechanik, Frontend und Lasttests durchspielen, ohne
 * Mistral-Budget zu verbrauchen — Unit-Tests, Emulator-Durchklick,
 * Mock-Lasttest mit bis zu 200 simulierten Jobs.
 *
 * Steuerung über Umgebungsvariablen (zur Laufzeit gelesen, damit Tests
 * sie pro Fall setzen können):
 *
 *   MISTRAL_MOCK_DELAY_MS  Simulierte Bearbeitungszeit pro Stufe in ms.
 *                          Default 1500. In Unit-Tests auf 0 setzen.
 *   MISTRAL_MOCK_FAIL      Erzwingt einen Fehler:
 *                            "describe"        describeImage wirft api_error
 *                            "describe-empty"  describeImage liefert null
 *                                              (simuliert den Safety-Filter)
 *                            "profiles"        generateBothProfiles liefert
 *                                              { normal: null, boost: null }
 *                            "rate_limit"      wirft einen rate_limit-Fehler
 *                                              (wie ein echter 429er)
 *
 * Dieses Modul wird NICHT im synchronen Live-Pfad verwendet. `process-job`
 * wählt es nur, wenn der Mock-Modus aktiv ist (Test-/Emulator-Betrieb).
 */

/* ── Konfiguration ────────────────────────────────────────────────── */

function mockDelayMs() {
  const raw = Number(process.env.MISTRAL_MOCK_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1500;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function rateLimitError() {
  const e = new Error("Mistral rate limit exceeded (mock)");
  e.code = "rate_limit";
  return e;
}

/* Schnittstellen-Parität mit mistral.js. */
function isRateLimitError(err) {
  return !!(err && err.code === "rate_limit");
}

/* ── Vorgefertigte Bildbeschreibung ───────────────────────────────── */

/* Beginnt mit der SUBJECT-Kopfzeile, die animal.js/classifyDescription
   erwartet — so läuft der Mock durch den Personen-Profil-Pfad. */
const DESCRIPTIONS = {
  de:
    "SUBJECT: HUMAN\n" +
    "Eine erwachsene Person, ca. 30 Jahre alt, mit mittellangen braunen Haaren " +
    "und freundlichem Gesichtsausdruck. Sie trägt eine dunkelblaue Jacke und " +
    "steht vor einem unscharfen städtischen Hintergrund. Die Kleidung wirkt " +
    "modern und gepflegt.\n" +
    "Sichtbarer Text: keiner",
  en:
    "SUBJECT: HUMAN\n" +
    "An adult person, approximately 30 years old, with medium-length brown hair " +
    "and a friendly expression. They wear a dark blue jacket and stand in front " +
    "of a blurred urban background. The clothing looks modern and tidy.\n" +
    "Visible text: none",
};

/* ── Vorgefertigtes Profil-JSON ───────────────────────────────────── */

/* Strukturell identisch zu echten Mistral-Profilen: categories als Objekt
   aus { label, value, confidence }, plus ad_targeting, manipulation_triggers
   und profileText. Der "[MOCK-PROFIL]"-Marker macht im Emulator-Durchklick
   sofort sichtbar, dass keine echte KI-Analyse dahintersteckt. */

function profileDe(isBoost) {
  return {
    categories: {
      alter_geschlecht: {
        label: "Alter & Geschlecht",
        value: isBoost
          ? "Männlich, ~30 — die Kieferlinie verrät dich."
          : "Du bist vermutlich männlich, ca. 30 Jahre alt.",
        confidence: 0.78,
      },
      interessen: {
        label: "Interessen & Hobbys",
        value: isBoost
          ? "Stadtleben, Mode, Fotografie. Vorhersehbar."
          : "Die Analyse leitet ab, dass du dich für Stadtleben, Mode und Fotografie interessierst.",
        confidence: 0.61,
      },
      persoenlichkeit: {
        label: "Persönlichkeitstyp",
        value: isBoost
          ? "Selbstdarsteller mit Ordnungsdrang. Leicht zu lesen."
          : "Offen und kontaktfreudig, mit einem Hang zur Selbstdarstellung. Wirkt organisiert und zielstrebig.",
        confidence: 0.55,
      },
      kaufkraft: {
        label: "Kaufkraft & Konsum",
        value: isBoost
          ? "Dein Markenbewusstsein macht dich zur leichten Beute für Premium-Aufpreise — du zahlst für das Logo, nicht für das Produkt."
          : "Mittleres Konsumsegment, markenbewusst, bevorzugt gepflegte Mode im mittleren Preisbereich.",
        confidence: 0.6,
      },
      charakterzuege: {
        label: "Charaktereigenschaften",
        value: isBoost
          ? "Will gefallen. Genau das nutzen wir."
          : "Aufgeschlossen, gepflegt, sozial orientiert und stilbewusst.",
        confidence: 0.5,
      },

      herkunft: {
        label: "Herkunft",
        value: isBoost
          ? "Mitteleuropa — dein Umfeld verrät dich sofort."
          : "Mitteleuropäischer Raum, städtisches Umfeld.",
        confidence: 0.5,
      },
      einkommen: {
        label: "Einkommen",
        value: isBoost
          ? "Mittelschicht mit Anspruch. Wir kennen dein Budget."
          : "Mittleres Einkommen, geregelte Beschäftigung.",
        confidence: 0.5,
      },
      bildung: {
        label: "Bildung",
        value: isBoost
          ? "Genug Bildung, um dich für unbeeinflussbar zu halten."
          : "Weiterführender Abschluss wahrscheinlich.",
        confidence: 0.5,
      },
      beziehungsstatus: {
        label: "Beziehungsstatus",
        value: isBoost ? "Verrätst du nicht — wir raten trotzdem." : "Keine belastbaren Hinweise im Bild.",
        confidence: 0.5,
      },
      politisch: {
        label: "Politische Neigung",
        value: isBoost
          ? "Sagst du nicht. Dein Konsum sagt es für dich."
          : "Keine Anhaltspunkte — bewusst offen gelassen.",
        confidence: 0.5,
      },
      gesundheit: {
        label: "Gesundheit",
        value: isBoost ? "Nichts Auffälliges. Noch nicht." : "Keine Auffälligkeiten erkennbar.",
        confidence: 0.5,
      },
      verletzlichkeit: {
        label: "Angriffsflächen",
        value: isBoost
          ? "Du willst dazugehören. Genau da holen wir dich ab."
          : "Wirkt offen für Empfehlungen und soziale Bestätigung.",
        confidence: 0.5,
      },
      werbeprofil: {
        label: "Werbeprofil",
        value: isBoost
          ? "Ein Datensatz mit klaren Schwächen — leicht zu bespielen."
          : "Gut adressierbar über Lifestyle- und Modekanäle.",
        confidence: 0.5,
      },
    },
    ad_targeting: [
      "Modemarken",
      "Smartphones",
      "Städtereisen",
      "Kaffeespezialitäten",
      "Fitness-Apps",
      "Streaming-Dienste",
    ],
    manipulation_triggers: [
      "Die Angst etwas zu verpassen (FOMO) wird durch zeitlich begrenzte Mode-Angebote getriggert.",
      "Sozialer Vergleich: Werbung zeigt dir Gleichaltrige mit teureren Produkten, um Unzufriedenheit zu erzeugen.",
      "Bequemlichkeit wird ausgenutzt — Ein-Klick-Käufe senken die Hemmschwelle für Spontanausgaben.",
      "Dein gepflegtes Auftreten macht dich empfänglich für Statusprodukte, die Zugehörigkeit versprechen.",
    ],
    profileText: isBoost
      ? "[MOCK-PROFIL] Du bist genau die Sorte Nutzer, auf die Datenbroker warten: sichtbar " +
        "markenbewusst, sozial vergleichend, leicht über Status ansprechbar. Dein gepflegtes " +
        "Auftreten verrät, dass dir zählt, was andere denken — ein Hebel, den jede Kampagne nutzt. " +
        "Du zahlst Aufpreise für Logos und hältst das für Geschmack. Im urbanen Umfeld bist du " +
        "dauernd erreichbar und damit dauernd bewerbbar. Dies ist ein Test-Profil ohne echte KI-Analyse."
      : "[MOCK-PROFIL] Du bist eine aufgeschlossene Person um die 30, die Wert auf ein gepflegtes, " +
        "modernes Erscheinungsbild legt. Dein Stil deutet auf ein mittleres Einkommen und ein " +
        "markenbewusstes Konsumverhalten hin. Du bewegst dich gern im urbanen Umfeld und " +
        "interessierst dich für Mode und Fotografie. Diese Merkmale machen dich für Werbetreibende " +
        "gut adressierbar. Dies ist ein Test-Profil ohne echte KI-Analyse.",
  };
}

function profileEn(isBoost) {
  return {
    categories: {
      alter_geschlecht: {
        label: "Age & Gender",
        value: isBoost
          ? "Male, ~30 — your jawline gives you away."
          : "You are likely male, approximately 30 years old.",
        confidence: 0.78,
      },
      interessen: {
        label: "Interests & Hobbies",
        value: isBoost
          ? "City life, fashion, photography. Predictable."
          : "The analysis infers that you are interested in city life, fashion and photography.",
        confidence: 0.61,
      },
      persoenlichkeit: {
        label: "Personality Type",
        value: isBoost
          ? "Self-presenter with a need for order. Easy to read."
          : "Open and sociable, with a tendency toward self-presentation. Appears organised and driven.",
        confidence: 0.55,
      },
      kaufkraft: {
        label: "Purchasing Power & Consumption",
        value: isBoost
          ? "Your brand awareness makes you easy prey for premium markups — you pay for the logo, not the product."
          : "Mid-range consumer segment, brand-aware, prefers tidy fashion in the mid price range.",
        confidence: 0.6,
      },
      charakterzuege: {
        label: "Character Traits",
        value: isBoost
          ? "Wants to be liked. That is what we use."
          : "Open-minded, well-groomed, socially oriented and style-conscious.",
        confidence: 0.5,
      },

      herkunft: {
        label: "Origin",
        value: isBoost ? "Central Europe — your surroundings give you away." : "Central European, urban environment.",
        confidence: 0.5,
      },
      einkommen: {
        label: "Income",
        value: isBoost ? "Middle class with aspirations. We know your budget." : "Middle income, steady employment.",
        confidence: 0.5,
      },
      bildung: {
        label: "Education",
        value: isBoost ? "Educated enough to think you are immune." : "Higher education likely.",
        confidence: 0.5,
      },
      beziehungsstatus: {
        label: "Relationship status",
        value: isBoost ? "You will not say. We guess anyway." : "No reliable indicators in the image.",
        confidence: 0.5,
      },
      politisch: {
        label: "Political leaning",
        value: isBoost ? "You stay quiet. Your shopping speaks." : "No indicators — deliberately left open.",
        confidence: 0.5,
      },
      gesundheit: {
        label: "Health",
        value: isBoost ? "Nothing remarkable. Not yet." : "No abnormalities detectable.",
        confidence: 0.5,
      },
      verletzlichkeit: {
        label: "Vulnerabilities",
        value: isBoost
          ? "You want to belong. That is where we reach you."
          : "Appears open to recommendations and social approval.",
        confidence: 0.5,
      },
      werbeprofil: {
        label: "Ad profile",
        value: isBoost
          ? "A record with clear weak spots — easy to play."
          : "Easily addressable via lifestyle and fashion channels.",
        confidence: 0.5,
      },
    },
    ad_targeting: [
      "Fashion brands",
      "Smartphones",
      "City breaks",
      "Specialty coffee",
      "Fitness apps",
      "Streaming services",
    ],
    manipulation_triggers: [
      "Fear of missing out (FOMO) is triggered by time-limited fashion offers.",
      "Social comparison: ads show you peers with more expensive products to create dissatisfaction.",
      "Convenience is exploited — one-click purchases lower the barrier for impulse spending.",
      "Your well-groomed appearance makes you receptive to status products that promise belonging.",
    ],
    profileText: isBoost
      ? "[MOCK-PROFILE] You are exactly the kind of user data brokers wait for: visibly " +
        "brand-aware, socially comparing, easily addressed through status. Your tidy appearance " +
        "reveals that you care what others think — a lever every campaign uses. You pay markups " +
        "for logos and call it taste. In the urban environment you are constantly reachable, and " +
        "therefore constantly targetable. This is a test profile with no real AI analysis."
      : "[MOCK-PROFILE] You are an open-minded person around 30 who values a tidy, modern " +
        "appearance. Your style suggests a mid-range income and brand-aware consumer behaviour. " +
        "You enjoy the urban environment and are interested in fashion and photography. These " +
        "traits make you easy to address for advertisers. This is a test profile with no real " +
        "AI analysis.",
  };
}

function mockProfile(mode, lang) {
  const isBoost = mode === "boost";
  return lang === "en" ? profileEn(isBoost) : profileDe(isBoost);
}

/* ── Public: Schnittstellen-kompatibel zu mistral.js ──────────────── */

/**
 * Attrappe für mistral.describeImage. Liefert nach der konfigurierten
 * Verzögerung eine vorgefertigte Bildbeschreibung (Personen-Pfad).
 *
 * Rückgabe / Fehlerverhalten identisch zur echten Funktion:
 *   - String         erfolgreiche Beschreibung
 *   - null           Safety-Filter (MISTRAL_MOCK_FAIL="describe-empty")
 *   - throw api_error / rate_limit  bei den entsprechenden Fail-Flags
 */
async function describeImage(_imageBuffer, _mimeType, _remainingBudget, lang) {
  await sleep(mockDelayMs());
  const fail = process.env.MISTRAL_MOCK_FAIL;
  if (fail === "rate_limit") throw rateLimitError();
  if (fail === "describe") {
    const e = new Error("Mistral describe failed: mock api error");
    e.code = "api_error";
    throw e;
  }
  if (fail === "describe-empty") return null;
  return DESCRIPTIONS[lang === "en" ? "en" : "de"];
}

/**
 * Attrappe für mistral.generateBothProfiles. Liefert nach der konfigurierten
 * Verzögerung ein vorgefertigtes Normal- und Beast-Mode-Profil.
 *
 * Rückgabe / Fehlerverhalten identisch zur echten Funktion:
 *   - { normal, boost }            strukturell gültige Profile
 *   - { normal: null, boost: null} kein Profil (MISTRAL_MOCK_FAIL="profiles")
 *   - throw rate_limit             bei MISTRAL_MOCK_FAIL="rate_limit"
 */
async function generateBothProfiles(_imageDescription, _exifData, _remainingBudget, lang) {
  await sleep(mockDelayMs());
  const fail = process.env.MISTRAL_MOCK_FAIL;
  if (fail === "rate_limit") throw rateLimitError();
  if (fail === "profiles") return { normal: null, boost: null };
  const resolved = lang === "en" ? "en" : "de";
  return {
    normal: mockProfile("normal", resolved),
    boost: mockProfile("boost", resolved),
  };
}

/**
 * Attrappe des Single-Large-Aufrufs — MIT simuliertem Datenstrom.
 *
 * WARUM ES DAS BRAUCHT (2026-08-29): Die Attrappe kannte diesen Aufruf bisher
 * nicht, deshalb steht `useSingleLargeCall` im Lokal-Modus auf `false`. Der
 * Live-Weg war damit im Emulator nicht nur abgeschaltet, sondern gar nicht
 * vorhanden — und die Live-Anzeige ohne echte Mistral-Kosten nicht zu sehen.
 *
 * Der Strom wird in derselben Reihenfolge nachgestellt, in der das Modell
 * schreibt: erst der Profiltext, dann die Karten einzeln. Genau diese
 * Reihenfolge erzeugt im Betrieb die Wartezeit, in der der Bildschirm bisher
 * stillstand.
 */
async function runSingleLargeCall(_buffer, _mimeType, _remainingBudget, lang, opts = {}) {
  const resolved = lang === "en" ? "en" : "de";
  const normal = mockProfile("normal", resolved);
  const boost = mockProfile("boost", resolved);
  const onLiveText = typeof opts.onLiveText === "function" ? opts.onLiveText : null;

  /* Ohne Callback verhaelt sich die Attrappe wie der Nicht-Stream-Pfad. */
  if (!onLiveText) {
    await sleep(mockDelayMs());
    return { normal, boost, subject: "HUMAN", visibleText: "" };
  }

  /* Zeitverhaeltnis wie im Betrieb: Der Profiltext ist FRUEH fertig, die Karten
     brauchen danach das Vielfache. Am 28.08. gemessen: Text nach 34,6 s
     komplett, Karten bis ~85 s. Eine Attrappe, die den Text ueber die ganze
     Laufzeit streckt, stellt genau die Reihenfolge nicht her, um die es geht. */
  /* MISTRAL_MOCK_DELAY_MS ist die Dauer je PROFIL, nicht je Schritt — sonst
     verlaengert jede zusaetzliche Karte den Durchlauf still. Der Text bekommt
     ein Zehntel davon (er ist im Betrieb frueh fertig), die Karten teilen sich
     den Rest. */
  const gesamt = mockDelayMs();
  const textSchritt = Math.max(80, Math.round(gesamt / 30));
  const kartenAnzahl = Math.max(1, Object.keys(normal.categories || {}).length);
  const kartenSchritt = Math.max(150, Math.round((gesamt * 0.9) / kartenAnzahl));
  const karten = (profil) =>
    Object.entries(profil.categories || {}).map(([schluessel, k]) => ({
      schluessel,
      bezeichnung: k.label,
      wert: k.value,
    }));
  const alleStandard = karten(normal);
  const alleBeast = karten(boost);
  const stand = { standard: "", beast: "", kartenStandard: [], kartenBeast: [] };

  /* 1. Profiltext waechst zeichenweise (wie der echte Strom). */
  for (const [feld, text] of [
    ["standard", normal.profileText || ""],
    ["beast", boost.profileText || ""],
  ]) {
    for (let i = 1; i <= 3; i += 1) {
      stand[feld] = text.slice(0, Math.ceil((text.length * i) / 3));
      await sleep(textSchritt);
      onLiveText({ ...stand });
    }
    /* 2. Danach die Karten — einzeln, genau wie im Betrieb. */
    const ziel = feld === "standard" ? "kartenStandard" : "kartenBeast";
    const quelle = feld === "standard" ? alleStandard : alleBeast;
    for (let i = 1; i <= quelle.length; i += 1) {
      stand[ziel] = quelle.slice(0, i);
      await sleep(kartenSchritt);
      onLiveText({ ...stand });
    }
  }

  return { normal, boost, subject: "HUMAN", visibleText: "" };
}

module.exports = {
  describeImage,
  generateBothProfiles,
  runSingleLargeCall,
  isRateLimitError,
};
