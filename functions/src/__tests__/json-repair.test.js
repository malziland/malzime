const fs = require("fs");
const path = require("path");
const {
  parseSafely,
  applyBounds,
  cleanHeuristic,
  _tryParseDirect,
  _tryParseHeuristic,
  _tryParseLenient,
  _tryParseTruncated,
} = require("../json-repair");

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

const validProfile = {
  categories: {
    alter_geschlecht: { label: "Alter & Geschlecht", value: "Du bist ...", confidence: 0.9 },
  },
  ad_targeting: ["Marke A", "Marke B"],
  manipulation_triggers: ["Trigger 1"],
  profileText: "Sachlicher Text.",
};

/* ── Stufe 1: Direkter Parse ─────────────────────────────────────── */

describe("tryParseDirect", () => {
  test("returns parsed object for valid JSON", () => {
    const { parsed, stage } = _tryParseDirect(JSON.stringify(validProfile));
    expect(stage).toBe("direct");
    expect(parsed.categories.alter_geschlecht.value).toBe("Du bist ...");
  });

  test("returns null for invalid JSON", () => {
    const { parsed, error } = _tryParseDirect("nicht json");
    expect(parsed).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

/* ── Stufe 2: Heuristische Reparaturen ────────────────────────────── */

describe("cleanHeuristic", () => {
  test("strips markdown ```json fencing", () => {
    const wrapped = '```json\n{"a":1}\n```';
    expect(cleanHeuristic(wrapped)).toBe('{"a":1}');
  });

  test("strips bare ``` fences", () => {
    expect(cleanHeuristic('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("removes content before first { and after last }", () => {
    const messy = 'Sicher, hier ist das JSON: {"a":1} Hoffe das hilft!';
    expect(cleanHeuristic(messy)).toBe('{"a":1}');
  });

  test("removes trailing commas before } and ]", () => {
    expect(cleanHeuristic('{"a":1,}')).toBe('{"a":1}');
    expect(cleanHeuristic('{"arr":[1,2,]}')).toBe('{"arr":[1,2]}');
    expect(cleanHeuristic('{"a":1 ,\n}')).toBe('{"a":1\n}');
  });

  test("converts smart quotes to ASCII", () => {
    expect(cleanHeuristic('{"a":“b”}')).toBe('{"a":"b"}');
    expect(cleanHeuristic("{'a':'b'}")).toBe("{'a':'b'}");
  });
});

describe("tryParseHeuristic", () => {
  test("recovers JSON with markdown fencing", () => {
    const wrapped = "```json\n" + JSON.stringify(validProfile) + "\n```";
    const { parsed, stage } = _tryParseHeuristic(wrapped);
    expect(stage).toBe("heuristic");
    expect(parsed.categories.alter_geschlecht.value).toBe("Du bist ...");
  });

  test("recovers JSON with trailing comma", () => {
    const dirty = '{"a":1,"b":2,}';
    const { parsed, stage } = _tryParseHeuristic(dirty);
    expect(stage).toBe("heuristic");
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  test("returns null for truncated input that heuristic can't fix", () => {
    const truncated = '{"a":1, "b":"incomplete';
    const { parsed, error } = _tryParseHeuristic(truncated);
    expect(parsed).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

/* ── Stufe 3: Toleranter Parser (json5) ───────────────────────────── */

describe("tryParseLenient", () => {
  test("parses JSON5-style trailing commas", () => {
    const { parsed, stage } = _tryParseLenient('{"a":1,"b":2,}');
    expect(stage).toBe("lenient");
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  test("parses JSON5-style single quotes", () => {
    const { parsed, stage } = _tryParseLenient("{'a':'value'}");
    expect(stage).toBe("lenient");
    expect(parsed).toEqual({ a: "value" });
  });

  test("parses unquoted keys", () => {
    const { parsed, stage } = _tryParseLenient('{a:1, b:"x"}');
    expect(stage).toBe("lenient");
    expect(parsed).toEqual({ a: 1, b: "x" });
  });
});

/* ── Stufe 4: Truncation-Recovery ─────────────────────────────────── */

describe("tryParseTruncated", () => {
  test("recovers object where last entry was cut mid-string", () => {
    const truncated =
      '{"categories":{"a":{"label":"A","value":"x","confidence":0.9}},' + '"profileText":"Du bist ein wandelnd';
    const { parsed, stage } = _tryParseTruncated(truncated);
    expect(stage).toBe("truncation-recovery");
    expect(parsed.categories.a.value).toBe("x");
    /* profileText muss WEG sein, weil unvollständig */
    expect(parsed.profileText).toBeUndefined();
  });

  test("recovers when last array entry was cut mid-string", () => {
    const truncated = '{"a":[1,2,3],"b":"abcdef';
    const { parsed } = _tryParseTruncated(truncated);
    expect(parsed.a).toEqual([1, 2, 3]);
    expect(parsed.b).toBeUndefined();
  });

  test("returns null when no safe cut point exists", () => {
    const truncated = '{"a":"unfin';
    const { parsed } = _tryParseTruncated(truncated);
    expect(parsed).toBeNull();
  });

  test("returns null for non-object input", () => {
    const { parsed } = _tryParseTruncated('"string only"');
    expect(parsed).toBeNull();
  });
});

/* ── Output-Bounds (SEC-004 Schutz) ───────────────────────────────── */

describe("applyBounds", () => {
  test("caps category value to 800 chars", () => {
    const longString = "x".repeat(2000);
    const parsed = {
      categories: { test: { label: "Test", value: longString, confidence: 0.5 } },
    };
    const bounded = applyBounds(parsed);
    expect(bounded.categories.test.value.length).toBe(800);
  });

  test("caps confidence to [0, 1]", () => {
    const parsed = {
      categories: {
        a: { label: "A", value: "x", confidence: 2.5 },
        b: { label: "B", value: "x", confidence: -0.5 },
      },
    };
    const bounded = applyBounds(parsed);
    expect(bounded.categories.a.confidence).toBe(1);
    expect(bounded.categories.b.confidence).toBe(0);
  });

  test("caps ad_targeting to 20 entries, each 300 chars", () => {
    const parsed = {
      categories: {},
      ad_targeting: Array.from({ length: 30 }, (_, i) => "x".repeat(500) + i),
    };
    const bounded = applyBounds(parsed);
    expect(bounded.ad_targeting.length).toBe(20);
    expect(bounded.ad_targeting[0].length).toBe(300);
  });

  test("normalizes missing/wrong-type fields to safe defaults", () => {
    const bounded = applyBounds({ categories: {}, ad_targeting: "not-array", profileText: 123 });
    expect(bounded.ad_targeting).toEqual([]);
    expect(bounded.profileText).toBe("");
    expect(bounded.manipulation_triggers).toEqual([]);
  });

  test("returns null for non-object input", () => {
    expect(applyBounds(null)).toBeNull();
    expect(applyBounds("string")).toBeNull();
  });

  test("limits categories to 20 keys", () => {
    const tooMany = {};
    for (let i = 0; i < 30; i++) {
      tooMany[`cat_${i}`] = { label: "X", value: "y", confidence: 0.5 };
    }
    const bounded = applyBounds({ categories: tooMany });
    expect(Object.keys(bounded.categories).length).toBe(20);
  });
});

/* ── parseSafely Hauptfunktion ────────────────────────────────────── */

describe("parseSafely", () => {
  test("returns null for empty input", () => {
    expect(parseSafely("")).toBeNull();
    expect(parseSafely(null)).toBeNull();
    expect(parseSafely(undefined)).toBeNull();
    expect(parseSafely("   ")).toBeNull();
  });

  test("returns null for completely unparseable garbage", () => {
    const result = parseSafely("This is not JSON at all, no braces, nothing.", {
      requireSchema: false,
    });
    expect(result).toBeNull();
  });

  test("succeeds on direct parse path for clean JSON", () => {
    const stages = [];
    const result = parseSafely(JSON.stringify(validProfile), {
      onRepair: (stage) => stages.push(stage),
    });
    expect(result).not.toBeNull();
    expect(result.categories.alter_geschlecht.value).toBe("Du bist ...");
    expect(stages).toEqual(["direct"]);
  });

  test("falls through to heuristic when markdown-wrapped", () => {
    const stages = [];
    const wrapped = "```json\n" + JSON.stringify(validProfile) + "\n```";
    const result = parseSafely(wrapped, {
      onRepair: (stage) => stages.push(stage),
    });
    expect(result).not.toBeNull();
    expect(result.categories.alter_geschlecht.value).toBe("Du bist ...");
    /* direct fällt, dann heuristic greift — direct-failed wird auch geloggt */
    expect(stages).toContain("heuristic");
  });

  test("falls through to lenient for trailing-comma-only", () => {
    const stages = [];
    /* trailing comma — sowohl heuristic als auch json5 sollten heilen,
       heuristic kommt zuerst */
    const dirty = '{"categories":{},"ad_targeting":[],"profileText":"x",}';
    const result = parseSafely(dirty, {
      onRepair: (stage) => stages.push(stage),
    });
    expect(result).not.toBeNull();
    expect(result.profileText).toBe("x");
    /* heuristic löst Trailing-Commas, daher kein lenient nötig */
    expect(stages).toContain("heuristic");
  });

  test("falls through to truncation-recovery on truncated input", () => {
    const stages = [];
    /* Vollständige erste Kategorie, dann mitten in profileText abgeschnitten */
    const truncated =
      '{"categories":{"alter_geschlecht":{"label":"Alter & Geschlecht","value":"Du bist 35","confidence":0.85}},' +
      '"ad_targeting":["Marke A"],' +
      '"profileText":"Du bist ein wandelnde';
    const result = parseSafely(truncated, {
      onRepair: (stage) => stages.push(stage),
    });
    expect(result).not.toBeNull();
    expect(result.categories.alter_geschlecht.value).toBe("Du bist 35");
    expect(result.ad_targeting).toEqual(["Marke A"]);
    expect(stages).toContain("truncation-recovery");
  });

  test("requireSchema=true rejects parse without categories", () => {
    const noCategoriesJson = '{"only":"a value"}';
    const result = parseSafely(noCategoriesJson);
    expect(result).toBeNull();
  });

  test("requireSchema=false accepts any valid JSON", () => {
    const noCategoriesJson = '{"only":"a value"}';
    const result = parseSafely(noCategoriesJson, { requireSchema: false });
    expect(result).not.toBeNull();
  });

  test("onRepair callback receives stage names", () => {
    const stages = [];
    parseSafely("not json at all", {
      requireSchema: false,
      onRepair: (stage) => stages.push(stage),
    });
    /* zumindest direct-failed und am Ende all-failed */
    expect(stages).toContain("all-failed");
  });
});

/* ── Real-World-Fixtures aus Mistral-Failures ─────────────────────── */

describe("real-world fixtures from compare-models failures", () => {
  test("recovers Mistral Large 3 malformed-JSON dump (Position 1937 error)", () => {
    /* Diese Datei enthält normales JSON das aber an Position 1937 einen
       Syntax-Fehler hatte (finishReason: error von Mistral). Heuristik oder
       json5 sollten es heilen. */
    const raw = loadFixture("mistral-large3-malformed-json.txt");
    const stages = [];
    const result = parseSafely(raw, { onRepair: (stage) => stages.push(stage) });

    /* Selbst wenn nicht alle Felder durchkommen — zumindest categories sollte da sein. */
    expect(result).not.toBeNull();
    expect(result.categories).toBeDefined();
    expect(typeof result.categories).toBe("object");
    expect(Object.keys(result.categories).length).toBeGreaterThan(0);
    /* Irgendeine Repair-Stufe muss zum Erfolg geführt haben */
    expect(stages.some((s) => ["direct", "heuristic", "lenient", "truncation-recovery"].includes(s))).toBe(true);
  });

  test("recovers Mistral Large 3 truncated-boost dump (max_tokens=5000 cut)", () => {
    /* Dieses Dump bricht mitten in einem Wert ab (Boost-Profil traf 5000 Tokens). */
    const raw = loadFixture("mistral-large3-truncated-boost.txt");
    const stages = [];
    const result = parseSafely(raw, { onRepair: (stage) => stages.push(stage) });

    expect(result).not.toBeNull();
    expect(result.categories).toBeDefined();
    expect(Object.keys(result.categories).length).toBeGreaterThan(0);
    /* Truncation-Recovery sollte hier greifen (oder eine frühere Stufe schon) */
    expect(stages.some((s) => ["direct", "heuristic", "lenient", "truncation-recovery"].includes(s))).toBe(true);
  });
});
