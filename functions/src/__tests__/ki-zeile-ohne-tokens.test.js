/* Zeile zur KI-Dauer im 30-Tage-Speicher: nur, was der Datenschutztext nennt
   (26.09.2026).

   Der Datenschutztext nennt fuer den 30-Tage-Eintrag der KI nur, wie lange
   sie gebraucht hat. Modell, Status und Textmenge (Token) stehen in der
   Tageszeile `mistral-single-large-details`; das technische Protokoll (1 Tag)
   nennt "wie viel Text die KI verarbeitet hat". Die Eingabe-Token verraten
   zudem das Format des Fotos.

   Zusicherungen:
   1. Nach einem echten Durchlauf von runSingleLargeCall traegt keine Zeile,
      deren `step` im Filter des 30-Tage-Speichers steht, ein Token-Feld oder
      den Token-Wert. Der Filter wird aus seiner EINEN Soll-Definition gelesen
      (DIAG_SOLL in scripts/verify-infrastructure.sh).
   2. Die 30-Tage-Zeile hat GENAU die Felder ihrer Gruppe in der
      Deckungstabelle (public/__tests__/fixtures/datenschutz-deckung.json),
      die datenschutz-deckung.test.js gegen den Text prueft.
   3. Genau eine Stelle im Code schreibt diese Zeile.
   Positivkontrolle: Die Token-Zahlen stehen in einer Zeile, deren `step`
   NICHT im Filter steht — die Messung sieht sie also. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const fs = require("fs");
const path = require("path");
const { setFetchForTest, runSingleLargeCall } = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const PROMPT_TOKENS = 14191;

function diagnoseSteps() {
  const skript = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "verify-infrastructure.sh"), "utf8");
  const soll = [...skript.matchAll(/^DIAG_SOLL='([^']*)'$/gm)].map((m) => m[1]);
  expect(soll).toHaveLength(1);
  return [...soll[0].matchAll(/jsonPayload\.step="([a-z0-9-]+)"/g)].map((m) => m[1]);
}

const KARTEN = [
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

function antwort() {
  const karten = {};
  for (const k of KARTEN) karten[k] = { label: k, value: "Du bist X. Beleg Y.", confidence: 0.8 };
  const modus = (text) => ({
    profileText: text,
    ad_targeting: ["A"],
    manipulation_triggers: ["T"],
    categories: karten,
  });
  const body = {
    subject: "HUMAN",
    visible_text: "",
    hard_facts: { alter_geschlecht: "Du bist weiblich, ~14 Jahre alt (Spanne 12-16)." },
    standard: modus("Sachlich."),
    beast: modus("Zynisch."),
  };
  setFetchForTest(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
      usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: 3021, prompt_tokens_details: { cached_tokens: 12000 } },
    }),
  }));
}

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
let zeilen;
beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  zeilen = [];
  for (const art of ["log", "error", "warn", "info"]) {
    jest.spyOn(console, art).mockImplementation((z) => zeilen.push(String(z)));
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  setFetchForTest(null);
});
afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

test("keine Zeile des 30-Tage-Speichers traegt Token-Zahlen; sie stehen in einer eigenen Zeile", async () => {
  const steps = diagnoseSteps();
  expect(steps).toContain("mistral-single-large");
  antwort();
  await runSingleLargeCall("BASE64", "image/jpeg", () => 90000, "de");

  const geparst = zeilen
    .map((z) => {
      try {
        return { roh: z, j: JSON.parse(z) };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  const imSpeicher = geparst.filter((z) => steps.includes(z.j.step));
  expect(imSpeicher.map((z) => z.j.step)).toContain("mistral-single-large");
  for (const z of imSpeicher) {
    expect(Object.keys(z.j).filter((k) => /tokens?/i.test(k))).toEqual([]);
    expect(z.roh).not.toContain(String(PROMPT_TOKENS));
  }

  /* Positivkontrolle: Die Zahlen gibt es, nur eben ausserhalb des Filters. */
  const tokenZeile = geparst.find((z) => z.j.promptTokens === PROMPT_TOKENS);
  expect(tokenZeile).toBeDefined();
  expect(steps).not.toContain(tokenZeile.j.step);
  expect(tokenZeile.j.cachedTokens).toBe(12000);

  /* Feldmenge der 30-Tage-Zeile = Gruppe der Deckungstabelle. */
  const tabelle = require("../../../public/__tests__/fixtures/datenschutz-deckung.json");
  const dauerZeile = imSpeicher.find((z) => z.j.step === "mistral-single-large");
  expect(Object.keys(dauerZeile.j).sort()).toEqual(Object.keys(tabelle.felder["mistral-single-large"]).sort());
});

test("genau eine Stelle im Code schreibt die 30-Tage-Zeile der KI", () => {
  const quellen = fs
    .readdirSync(path.join(__dirname, ".."))
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
  const stellen = quellen.join("\n").match(/step:\s*"mistral-single-large"/g) || [];
  expect(stellen).toHaveLength(1);
});
