/**
 * alters-platzhalter.test.js — Der abgeschriebene Platzhalter beim Alter.
 *
 * HINTERGRUND (17.09.2026): Das Formatbeispiel im Prompt zeigt das Alter nur
 * noch als "~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)", weil eine Beispielzahl
 * die Schätzungen anzog. Schreibt das Modell die Vorlage ab, darf das Kind
 * "‹Zahl›" weder auf der fertigen Karte noch in der Live-Anzeige sehen, und
 * der Kinderschutz-Filter muss den unveränderten Anker bekommen (dann greift
 * Stufe 2, siehe minor-safety.test.js).
 */

/* Der Einstellungssatz als Kulisse, wie in mistral.test.js — sonst bricht
   jeder Aufruf mit "Betriebswerte fehlen" ab, was hier nicht Thema ist. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { hatAltersPlatzhalter, ohneAltersPlatzhalter } = require("../mistral-antwort");
const { runSingleLargeCall, setFetchForTest, _extrahiereLiveText } = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

describe("Erkennen und Entfernen", () => {
  test.each([
    ["männlich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)", "männlich"],
    ["female, ~‹number› years old (range ‹number›-‹number›)", "female"],
    ["männlich, ~Zahl Jahre alt (Spanne Zahl-Zahl)", "männlich"],
    [
      "Du bist weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›). Deine Wangen sind noch rund.",
      "Du bist weiblich. Deine Wangen sind noch rund.",
    ],
  ])("%s → %s", (roh, erwartet) => {
    expect(hatAltersPlatzhalter(roh)).toBe(true);
    const sauber = ohneAltersPlatzhalter(roh);
    expect(sauber).toBe(erwartet);
    expect(hatAltersPlatzhalter(sauber)).toBe(false);
  });

  test.each([
    ["weiblich, ~14 Jahre alt (Spanne 12-16)"],
    ["male, ~44 years old (range 40-48). A number of fine lines show it."],
    ["Die Anzahl der Linien verrät dich."],
    [""],
  ])("unverändert: %s", (text) => {
    expect(hatAltersPlatzhalter(text)).toBe(false);
    expect(ohneAltersPlatzhalter(text)).toBe(text);
  });

  test("Ziffern in spitzen Klammern werden nur ausgepackt", () => {
    expect(hatAltersPlatzhalter("~‹40› Jahre (Spanne ‹35›-‹45›)")).toBe(false);
    expect(ohneAltersPlatzhalter("~‹40› Jahre (Spanne ‹35›-‹45›)")).toBe("~40 Jahre (Spanne 35-45)");
  });
});

describe("Fertige Karte und Anker für den Filter", () => {
  const KARTEN = [
    "alter_geschlecht",
    "herkunft",
    "einkommen",
    "bildung",
    "beziehungsstatus",
    "interessen",
    "persoenlichkeit",
    "charakterzuege",
    "politisch",
    "gesundheit",
    "kaufkraft",
    "verletzlichkeit",
    "werbeprofil",
  ];
  const kategorien = (prefix) =>
    Object.fromEntries(KARTEN.map((k) => [k, { label: k, value: `${prefix} ${k}`, confidence: 0.8 }]));

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

  function antwortMit(anker, kartenwert) {
    const body = {
      hard_facts: { alter_geschlecht: anker, herkunft: "mitteleuropäisch" },
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      standard: { profileText: "Text.", categories: kategorien("Standard") },
      beast: { profileText: "Text.", categories: kategorien("Beast") },
    };
    body.standard.categories.alter_geschlecht.value = kartenwert;
    body.beast.categories.alter_geschlecht.value = kartenwert;
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
  }

  test("abgeschriebener Platzhalter erscheint nicht auf der Karte, der Filter bekommt ihn", async () => {
    antwortMit(
      "weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)",
      "Du bist weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›). Deine Wangen sind noch rund."
    );
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    for (const profil of [r.normal, r.boost]) {
      expect(profil.categories.alter_geschlecht.value).toBe("weiblich. Deine Wangen sind noch rund.");
    }
    expect(r.alterAnker).toBe("weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)");
  });

  test("Platzhalter nur im Kartenwert, Anker sauber: Anker steht vorn, kein Platzhalter", async () => {
    antwortMit("weiblich, ~14 Jahre alt (Spanne 12-16)", "Du bist weiblich, ~‹Zahl›. Deine Wangen sind noch rund.");
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "weiblich, ~14 Jahre alt (Spanne 12-16). Deine Wangen sind noch rund."
    );
  });

  test("ohne Platzhalter bleibt alles wie bisher", async () => {
    antwortMit("männlich, ~38 (Spanne 35-42)", "Du bist männlich, etwa 38. Die Linien bleiben sichtbar.");
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "männlich, ~38 (Spanne 35-42). Die Linien bleiben sichtbar."
    );
    expect(r.alterAnker).toBe("männlich, ~38 (Spanne 35-42)");
  });
});

describe("Live-Anzeige", () => {
  test("die Alterskarte zeigt den Platzhalter auch während des Schreibens nicht", () => {
    const strom = JSON.stringify({
      standard: {
        profileText: "Text.",
        categories: {
          alter_geschlecht: {
            label: "Alter & Geschlecht",
            value: "weiblich, ~‹Zahl› Jahre alt. Runde Wangen.",
            confidence: 0.8,
          },
          herkunft: { label: "Herkunft", value: "Text ‹nicht Alter›", confidence: 0.7 },
        },
      },
    });
    const { kartenStandard } = _extrahiereLiveText(strom);
    expect(kartenStandard[0].wert).toBe("weiblich. Runde Wangen.");
    /* Nur die Alterskarte wird bereinigt. */
    expect(kartenStandard[1].wert).toBe("Text ‹nicht Alter›");
  });
});
