const mistral = require("../mistral");
const { setFetchForTest, runSingleLargeCall, _buildBrandBlocklistBlock, _BRAND_BLOCKLIST_SETS } = mistral;
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

function fullCategories() {
  const out = {};
  for (const k of CARDS) out[k] = { label: k, value: "Du bist X. Beleg Y.", confidence: 0.8 };
  return out;
}

/* Antwort im NEUEN Format: ad_targeting je Modus */
function answerSplit() {
  return JSON.stringify({
    subject: "HUMAN",
    visible_text: "",
    hard_facts: { alter_geschlecht: "weiblich, ~14 Jahre alt", herkunft: "mitteleuropäisch" },
    standard: {
      profileText: "Sachlich.",
      ad_targeting: ["Lego Friends", "Thalia Erstleser"],
      manipulation_triggers: ["Zeitdruck erzeugt Handlungsbereitschaft."],
      categories: fullCategories(),
    },
    beast: {
      profileText: "Zynisch.",
      ad_targeting: ["Temu Sammelkarten", "Netto Quengelware"],
      manipulation_triggers: ["Wir setzen dir eine Frist, dann kaufst du."],
      categories: fullCategories(),
    },
  });
}

/* Antwort im ALTEN Format: eine Liste oben */
function answerLegacy() {
  return JSON.stringify({
    subject: "HUMAN",
    visible_text: "",
    hard_facts: { alter_geschlecht: "weiblich, ~14 Jahre alt", herkunft: "mitteleuropäisch" },
    ad_targeting: ["Alte Marke A", "Alte Marke B"],
    manipulation_triggers: ["FOMO"],
    standard: { profileText: "Sachlich.", categories: fullCategories() },
    beast: { profileText: "Zynisch.", categories: fullCategories() },
  });
}

function mockAnswer(text) {
  const captured = [];
  setFetchForTest(async (_url, opts) => {
    captured.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };
  });
  return captured;
}

describe("Getrennte Werbelisten je Modus (v2.7)", () => {
  test("Standard und Beast bekommen ihre EIGENE Liste", async () => {
    mockAnswer(answerSplit());
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");

    expect(r.normal.ad_targeting).toEqual(["Lego Friends", "Thalia Erstleser"]);
    expect(r.boost.ad_targeting).toEqual(["Temu Sammelkarten", "Netto Quengelware"]);
    /* Der eigentliche Punkt: die Listen sind NICHT mehr identisch */
    expect(r.normal.ad_targeting).not.toEqual(r.boost.ad_targeting);
  });

  test("Rückfall auf die obere Liste, wenn das Modell die alte Form liefert", async () => {
    mockAnswer(answerLegacy());
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");

    /* Lieber wie früher als gar keine Werbung */
    expect(r.normal.ad_targeting).toEqual(["Alte Marke A", "Alte Marke B"]);
    expect(r.boost.ad_targeting).toEqual(["Alte Marke A", "Alte Marke B"]);
  });

  test("manipulation_triggers sind ab v2.8 ebenfalls getrennt", async () => {
    mockAnswer(answerSplit());
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");

    expect(r.normal.manipulation_triggers).toEqual(["Zeitdruck erzeugt Handlungsbereitschaft."]);
    expect(r.boost.manipulation_triggers).toEqual(["Wir setzen dir eine Frist, dann kaufst du."]);
    /* Der Punkt: sie stehen im Frontend direkt neben der Werbung. Gleiche
       Trigger neben unterschiedlicher Werbung wirken widersprüchlich. */
    expect(r.normal.manipulation_triggers).not.toEqual(r.boost.manipulation_triggers);
  });

  test("Rückfall auf die obere Trigger-Liste, wenn das Modell die alte Form liefert", async () => {
    mockAnswer(answerLegacy());
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(r.normal.manipulation_triggers).toEqual(["FOMO"]);
    expect(r.boost.manipulation_triggers).toEqual(["FOMO"]);
  });

  test("Werbung und Trigger fallen unabhängig voneinander zurück", async () => {
    /* Gemischte Antwort: Werbung getrennt, Trigger noch alt oben */
    mockAnswer(
      JSON.stringify({
        subject: "HUMAN",
        visible_text: "",
        hard_facts: { alter_geschlecht: "weiblich, ~14 Jahre alt", herkunft: "mitteleuropäisch" },
        manipulation_triggers: ["Nur oben"],
        standard: { profileText: "S.", ad_targeting: ["A"], categories: fullCategories() },
        beast: { profileText: "B.", ad_targeting: ["B"], categories: fullCategories() },
      })
    );
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(r.normal.ad_targeting).toEqual(["A"]);
    expect(r.boost.ad_targeting).toEqual(["B"]);
    expect(r.normal.manipulation_triggers).toEqual(["Nur oben"]);
    expect(r.boost.manipulation_triggers).toEqual(["Nur oben"]);
  });
});

describe("Marken-Sperre gegen Wiederholung (v2.7)", () => {
  test("liegt HINTER dem Bild in der user-Message — nicht im gecachten system-Teil", async () => {
    const captured = mockAnswer(answerSplit());
    await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de", {
      usePromptCache: true,
      blocklistIndex: 0,
    });

    const body = captured[0];
    const system = body.messages.find((m) => m.role === "system");
    const user = body.messages.find((m) => m.role === "user");

    /* Der gecachte Anfang darf die Sperre NICHT enthalten — sonst wechselt der
       statische Präfix pro Analyse und die Cache-Trefferquote fällt auf 0. */
    expect(system.content).not.toContain("MARKEN-SPERRE");
    /* Sie steht hinter dem Bild */
    const types = user.content.map((c) => c.type);
    expect(types).toEqual(["image_url", "text"]);
    expect(user.content[1].text).toContain("MARKEN-SPERRE");
  });

  test("der gecachte system-Teil ist über verschiedene Sperrlisten hinweg bitgleich", async () => {
    const captured = mockAnswer(answerSplit());
    await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de", {
      usePromptCache: true,
      blocklistIndex: 0,
    });
    await runSingleLargeCall(Buffer.from("y"), "image/jpeg", () => 60000, "de", {
      usePromptCache: true,
      blocklistIndex: 3,
    });

    const sys0 = captured[0].messages.find((m) => m.role === "system").content;
    const sys1 = captured[1].messages.find((m) => m.role === "system").content;
    expect(sys0).toBe(sys1);

    /* ... die Sperre selbst hat sich aber geändert */
    const u0 = captured[0].messages.find((m) => m.role === "user").content[1].text;
    const u1 = captured[1].messages.find((m) => m.role === "user").content[1].text;
    expect(u0).not.toBe(u1);
  });

  test("ohne Cache-Flag hängt die Sperre ans Ende der user-Message", async () => {
    const captured = mockAnswer(answerSplit());
    await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de", { blocklistIndex: 0 });

    const body = captured[0];
    expect(body.messages).toHaveLength(1);
    const types = body.messages[0].content.map((c) => c.type);
    expect(types).toEqual(["text", "image_url", "text"]);
    expect(body.messages[0].content[2].text).toContain("MARKEN-SPERRE");
  });

  test("rotiert über alle Sets und nennt die verbrannten Dauerbrenner", () => {
    const seen = new Set();
    for (let i = 0; i < _BRAND_BLOCKLIST_SETS.length; i++) {
      seen.add(_buildBrandBlocklistBlock("de", i));
    }
    expect(seen.size).toBe(_BRAND_BLOCKLIST_SETS.length);
    /* Set 0 sind die im alten Prompt verbrannten Marken */
    expect(_buildBrandBlocklistBlock("de", 0)).toContain("Garmin");
    expect(_buildBrandBlocklistBlock("de", 0)).toContain("Rapha");
  });

  test("Index läuft sicher über die Setgrenze hinaus", () => {
    const a = _buildBrandBlocklistBlock("de", 0);
    const b = _buildBrandBlocklistBlock("de", _BRAND_BLOCKLIST_SETS.length);
    expect(b).toBe(a);
    expect(() => _buildBrandBlocklistBlock("de", -5)).not.toThrow();
    expect(() => _buildBrandBlocklistBlock("de", 1.7)).not.toThrow();
  });

  test("englische Fassung ist englisch", () => {
    const en = _buildBrandBlocklistBlock("en", 0);
    expect(en).toContain("BRAND BLOCK FOR THIS ANALYSIS");
    expect(en).not.toContain("MARKEN-SPERRE");
  });

  test("erlaubt ausdrücklich sichtbare Marken trotz Sperre", () => {
    expect(_buildBrandBlocklistBlock("de", 0)).toMatch(/sichtbar/i);
    expect(_buildBrandBlocklistBlock("en", 0)).toMatch(/visible/i);
  });
});
