/**
 * mistral-modell-aus-satz.test.js — Es rechnet das Modell, das der
 * Einstellungssatz waehlt (Feld `modell`, seit 19.11.2026).
 *
 * Geprueft am Aufruf selbst: welches Modell im Request an Mistral steht, ob
 * der Zusatz des Modells mitgeht (Large 4: reasoning_effort) und dass eine
 * Analyse beim Umschalten mitten drin beim Modell ihres ersten Aufrufs bleibt.
 * Reine Mock-Pruefung — kein Netz.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const satz = require("../betriebsprofil");
const { setFetchForTest, runSingleLargeCall, generateBeastAds } = require("../mistral");
const { REQUIRED_CARDS } = require("../mistral-antwort");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setFetchForTest(null);
  satz._setzeModell(null);
  jest.restoreAllMocks();
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
});

function karten(prefix) {
  const out = {};
  for (const k of REQUIRED_CARDS) out[k] = { label: k, value: `${prefix} ${k}`, confidence: 0.8 };
  return out;
}
const VOLL = {
  subject: "HUMAN",
  ad_targeting: ["A", "B"],
  standard: { profileText: "Du bist sachlich beschrieben.", categories: karten("S") },
  beast: { profileText: "Du bist zynisch beschrieben.", categories: karten("B") },
};
const antwort = (inhalt) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(inhalt) }, finish_reason: "stop" }], usage: {} }),
});

describe("das Modell kommt aus dem Einstellungssatz", () => {
  test.each([
    ["mistral-large-2512", undefined],
    ["mistral-large-4", "low"],
  ])("%s steht im Analyse-Aufruf, reasoning_effort: %p", async (modell, aufwand) => {
    satz._setzeModell(modell);
    const bodies = [];
    setFetchForTest(async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return antwort(VOLL);
    });
    await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", null, "de");
    expect(bodies.length).toBe(1);
    expect(bodies[0].model).toBe(modell);
    expect(bodies[0].reasoning_effort).toBe(aufwand);
  });

  test.each([
    ["mistral-large-2512", 600],
    ["mistral-large-4", 8000],
  ])("%s steht im Werbe-Aufruf, mit seiner Textmenge %i", async (modell, maxTokens) => {
    satz._setzeModell(modell);
    let body;
    setFetchForTest(async (_url, opts) => {
      body = JSON.parse(opts.body);
      return antwort({ ad_targeting: ["X", "Y"] });
    });
    await generateBeastAds({ categories: { alter_geschlecht: { value: "40" } }, profileText: "p" }, [], "de", null);
    expect(body.model).toBe(modell);
    expect(body.max_tokens).toBe(maxTokens);
  });

  test("Umschalten mitten in der Analyse: Nachfrage und Werbung bleiben beim ersten Modell", async () => {
    satz._setzeModell("mistral-large-2512");
    const modelle = [];
    const ohneKarte = JSON.parse(JSON.stringify(VOLL));
    delete ohneKarte.standard.categories[REQUIRED_CARDS[0]];
    setFetchForTest(async (_url, opts) => {
      modelle.push(JSON.parse(opts.body).model);
      /* Nach dem ersten Aufruf schaltet jemand um. */
      satz._setzeModell("mistral-large-4");
      return antwort(modelle.length === 1 ? ohneKarte : VOLL);
    });
    const messung = {};
    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", null, "de", { messung });
    await generateBeastAds(ergebnis.boost, [], "de", messung);
    expect(modelle.length).toBeGreaterThanOrEqual(3);
    expect(new Set(modelle)).toEqual(new Set(["mistral-large-2512"]));
  });
});
