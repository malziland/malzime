/* BUG-2026-08-20-26: Der Anker aus `hard_facts` wird dem Kartenwert NACH
   applyBounds vorangestellt und umging damit die Laengengrenze. Ein praepariertes
   Foto (Prompt-Injection ueber sichtbaren Bildtext) oder ein durchdrehendes Modell
   konnte so einen fuenfstellig langen Wert auf die Karte bringen — die Zusage
   "max. 800 Zeichen je Kategorie" stimmte nicht mehr. Kein XSS (das Frontend
   maskiert), aber eine Anzeige, die die Seite sprengt.

   Der Test misst BEIDE Richtungen. Die zweite ist die wichtigere: Ein normal
   langer Profiltext darf NICHT verkuerzt werden — sonst schneidet der Fix Texte
   ab, die heute vollstaendig bei den Nutzern ankommen. */
/* Betriebswerte kommen seit 30.08.2026 ausschliesslich aus Firestore. Fuer
   Tests, die eine Analyse durchspielen, wird hier ein gueltiger Satz gestellt —
   sonst bricht jeder Aufruf mit "Betriebswerte fehlen" ab, was diese Tests
   nicht pruefen wollen. Wer das Verhalten OHNE Satz prueft, tut das in
   betriebsprofil*.test.js. */
jest.mock("../betriebsprofil", () => ({
  geltendeWerte: async () => ({
    werte: {
      mistralTimeoutMs: 90000,
      singleLargeTimeoutMs: 300000,
      singleLargeMaxTokens: 5000,
      requestBudgetMs: 480000,
      parallelitaet: 7,
      stundenlimit: 500,
      adressLimit: 500,
    },
    quelle: "firestore",
    profil: "test",
    grund: null,
  }),
  PFLICHTFELDER: ["mistralTimeoutMs", "singleLargeTimeoutMs", "singleLargeMaxTokens", "requestBudgetMs"],
}));

const mistral = require("../mistral");
const { setFetchForTest, runSingleLargeCall } = mistral;
const { STRING_BOUND_CATEGORY } = require("../json-repair");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  setFetchForTest(null);
});

afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

const CARDS = [
  "alter_geschlecht",
  "herkunft",
  "einkommen",
  "bildung",
  "beruf",
  "wohnort",
  "beziehung",
  "interessen",
  "persoenlichkeit",
  "charakterzuege",
  "politisch",
  "gesundheit",
  "kaufkraft",
  "verletzlichkeit",
  "werbeprofil",
];

function karten(alterWert) {
  const out = {};
  for (const k of CARDS) out[k] = { label: k, value: "Du bist X. Beleg Y.", confidence: 0.8 };
  out.alter_geschlecht = { label: "alter_geschlecht", value: alterWert, confidence: 0.8 };
  return out;
}

function antwortMit(hardFacts, alterWert) {
  const body = {
    subject: "HUMAN",
    visible_text: "",
    hard_facts: hardFacts,
    standard: {
      profileText: "Sachlich.",
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      categories: karten(alterWert),
    },
    beast: {
      profileText: "Zynisch.",
      ad_targeting: ["B"],
      manipulation_triggers: ["T"],
      categories: karten(alterWert),
    },
  };
  setFetchForTest(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }], usage: {} }),
  }));
}

async function alterWertAusPipeline() {
  /* Signatur: (imageBuffer, mimeType, remainingBudget, lang, opts) — das dritte
     Argument ist eine FUNKTION, die das Restbudget liefert. */
  const ergebnis = await runSingleLargeCall("BASE64", "image/jpeg", () => 90000, "de");
  const profil = ergebnis.normal || ergebnis.standard;
  return profil.categories.alter_geschlecht.value;
}

describe("Anker-Voranstellung haelt die Laengengrenze (BUG-2026-08-20-26)", () => {
  test("ein ueberlanger Anker wird geklemmt", async () => {
    antwortMit({ alter_geschlecht: "A".repeat(5000) }, "Du bist Mitte dreissig. Beleg.");
    const wert = await alterWertAusPipeline();
    expect(wert.length).toBeLessThanOrEqual(STRING_BOUND_CATEGORY);
  });

  test("ein ueberlanger Kartenwert wird geklemmt, auch mit Anker davor", async () => {
    antwortMit({ alter_geschlecht: "34, weiblich" }, "Erster Satz. " + "B".repeat(5000));
    const wert = await alterWertAusPipeline();
    expect(wert.length).toBeLessThanOrEqual(STRING_BOUND_CATEGORY);
  });

  test("WICHTIG: ein normal langer Wert bleibt unveraendert — kein Abschneiden im Alltag", async () => {
    const normal =
      "Sie ist Mitte dreissig, das Gesicht wirkt erwachsen. Der Hintergrund zeigt eine belebte Innenstadt am Nachmittag.";
    antwortMit({ alter_geschlecht: "34, weiblich" }, normal);
    const wert = await alterWertAusPipeline();

    /* Der Anker ersetzt den ersten Satz, alles danach bleibt WOERTLICH stehen. */
    expect(wert).toBe("34, weiblich. Der Hintergrund zeigt eine belebte Innenstadt am Nachmittag.");
    expect(wert.length).toBeLessThan(STRING_BOUND_CATEGORY);
  });

  test("ohne Anker bleibt der Modellwert unangetastet", async () => {
    const normal = "Sie ist Mitte dreissig. Der Hintergrund zeigt eine Innenstadt.";
    antwortMit({}, normal);
    const wert = await alterWertAusPipeline();
    expect(wert).toBe(normal);
  });
});
