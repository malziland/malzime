"use strict";

/* Die Kennzahlen der KI fuer die dauerhaften Zaehler (16.10.2026,
   statistik.js) entstehen ohne zusaetzlichen Zugriff im Analyseweg:

   1. runSingleLargeCall fuellt `opts.messung` mit der Textmenge der Versuche
      mit Antwort — die 30-Tage-Zeile `mistral-single-large` bleibt dabei
      unveraendert (ki-zeile-ohne-tokens.test.js);
   2. der Werbe-Aufruf zaehlt seine Textmenge dazu;
   3. das Speichern des Ergebnisses schreibt die Kennzahlen im SELBEN
      Schreibvorgang in den Auftrag. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const speicher = require("./hilfen/speicher-datenbank");
const { setFetchForTest, runSingleLargeCall, generateBeastAds } = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");
const jobs = require("../jobs");

/* Alle Pflichtkarten: Dann fragt der Server nicht nach. */
const { REQUIRED_CARDS: KARTEN } = require("../mistral-antwort");

function antwortMit(inhalt, usage) {
  setFetchForTest(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(inhalt) }, finish_reason: "stop" }],
      usage,
    }),
  }));
}

function analyseAntwort(kartenListe = KARTEN) {
  const karten = {};
  for (const k of kartenListe) karten[k] = { label: k, value: "Du bist X. Beleg Y.", confidence: 0.8 };
  const modus = (text) => ({
    profileText: text,
    ad_targeting: ["A"],
    manipulation_triggers: ["T"],
    categories: karten,
  });
  antwortMit(
    {
      subject: "HUMAN",
      visible_text: "",
      hard_facts: { alter_geschlecht: "Du bist weiblich, ~30 Jahre alt (Spanne 25-35)." },
      standard: modus("Sachlich."),
      beast: modus("Zynisch."),
    },
    { prompt_tokens: 14191, completion_tokens: 3021, prompt_tokens_details: { cached_tokens: 12000 } }
  );
}

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
beforeEach(() => {
  speicher.leeren();
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  for (const art of ["log", "warn", "error", "info"]) jest.spyOn(console, art).mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  setFetchForTest(null);
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
});
afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

test("runSingleLargeCall fuellt opts.messung mit der Textmenge, ohne zusaetzliche Versuche", async () => {
  analyseAntwort();
  const messung = {};
  await runSingleLargeCall("BASE64", "image/jpeg", () => 90000, "de", { messung });
  expect(messung).toMatchObject({
    tokenEingabe: 14191,
    tokenZwischenspeicher: 12000,
    tokenAusgabe: 3021,
    zusatzversuche: 0,
  });
});

test("fehlt eine Karte, fragt der Server nach: zwei Versuche addiert, ein zusaetzlicher Versuch", async () => {
  analyseAntwort(KARTEN.slice(1));
  const messung = {};
  await runSingleLargeCall("BASE64", "image/jpeg", () => 90000, "de", { messung });
  expect(messung).toMatchObject({
    tokenEingabe: 28382,
    tokenZwischenspeicher: 24000,
    tokenAusgabe: 6042,
    zusatzversuche: 1,
  });
});

test("der Werbe-Aufruf zaehlt seine Textmenge dazu", async () => {
  antwortMit({ ad_targeting: ["W1", "W2"] }, { prompt_tokens: 800, completion_tokens: 90 });
  const messung = { tokenEingabe: 10, tokenZwischenspeicher: 0, tokenAusgabe: 5, zusatzversuche: 1 };
  await generateBeastAds(
    { profileText: "x", categories: { alter_geschlecht: { value: "30" }, verletzlichkeit: { value: "v" } } },
    ["A"],
    "de",
    messung
  );
  expect(messung).toEqual({
    tokenEingabe: 810,
    tokenZwischenspeicher: 0,
    tokenAusgabe: 95,
    zusatzversuche: 1,
    /* Seit 21.10.2026: Ergebnis des Werbe-Aufrufs fuer die Werbe-Wache. */
    werbeAufruf: "ok",
  });
});

test("das Ergebnis traegt die Kennzahlen im selben Schreibvorgang in den Auftrag", async () => {
  speicher.lege("jobs/k1", { status: "processing", createdAt: Date.now(), startedAt: Date.now() });
  const kennzahlen = { kiMs: 61000, kiWiederholungen: 1, tokenEingabe: 5, tokenZwischenspeicher: 2, tokenAusgabe: 3 };
  const ergebnis = {
    profiles: { normal: { profileText: "a" }, boost: { profileText: "b" } },
    meta: { mode: "multimodal" },
  };
  await expect(jobs.ergebnisSpeichern("k1", ergebnis, kennzahlen)).resolves.toBe(true);
  expect(speicher.lies("jobs/k1")).toMatchObject({ status: "done", kennzahlen });
  /* Genau EINE Transaktion, kein zusaetzlicher Schreibvorgang fuer die Kennzahlen. */
  expect(speicher.protokoll.filter((p) => p.art === "transaktion")).toHaveLength(1);
  expect(speicher.protokoll.filter((p) => p.art === "set" || p.art === "update")).toHaveLength(0);
});

test("ohne Kennzahlen bleibt der Auftrag wie bisher (kein leeres Feld)", async () => {
  speicher.lege("jobs/k2", { status: "processing", createdAt: Date.now(), startedAt: Date.now() });
  await jobs.ergebnisSpeichern("k2", { profiles: null, blockedReason: "blocked.apiError", meta: { mode: "blocked" } });
  expect(speicher.lies("jobs/k2")).not.toHaveProperty("kennzahlen");
});
