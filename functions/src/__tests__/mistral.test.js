const mistral = require("../mistral");
const { isRateLimitError, setFetchForTest, _callMistralRaw } = mistral;

/* Speichert ursprüngliche env, restored in afterEach */
const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  setFetchForTest(null);
});

/* ── isRateLimitError ──────────────────────────────────────────── */

describe("isRateLimitError", () => {
  test("detects status 429", () => {
    const err = new Error("anything");
    err.status = 429;
    expect(isRateLimitError(err)).toBe(true);
  });

  test("detects 429 in message", () => {
    expect(isRateLimitError(new Error("Mistral HTTP 429: Rate limit exceeded"))).toBe(true);
  });

  test("detects rate_limited code", () => {
    expect(isRateLimitError(new Error("error type rate_limited"))).toBe(true);
  });

  test("does not match other errors", () => {
    expect(isRateLimitError(new Error("Network timeout"))).toBe(false);
    expect(isRateLimitError(new Error("500 Internal Server Error"))).toBe(false);
  });
});

/* ── callMistralRaw: API-Key fehlt ─────────────────────────────── */

describe("callMistralRaw without API key", () => {
  test("throws no_api_key when MISTRAL_API_KEY env var missing", async () => {
    delete process.env.MISTRAL_API_KEY;
    await expect(_callMistralRaw({ model: "x", messages: [], maxTokens: 100, temperature: 0 })).rejects.toMatchObject({
      code: "no_api_key",
    });
  });
});

/* ── callMistralRaw: Erfolgs-Pfad ──────────────────────────────── */

describe("callMistralRaw success path", () => {
  test("returns text + tokens from a valid response", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello world" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    }));

    const result = await _callMistralRaw({
      model: "mistral-small-2603",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      temperature: 0.5,
    });

    expect(result.text).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.promptTokens).toBe(12);
    expect(result.outputTokens).toBe(5);
  });

  test("handles array-shape content (multimodal style response)", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "Part one. " },
                { type: "text", text: "Part two." },
              ],
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      }),
    }));

    const result = await _callMistralRaw({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 100,
      temperature: 0,
    });

    expect(result.text).toBe("Part one. Part two.");
  });

  test("sets response_format json_object when forceJSON is true", async () => {
    let capturedBody = null;
    setFetchForTest(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: {},
        }),
      };
    });

    await _callMistralRaw({
      model: "x",
      messages: [],
      maxTokens: 100,
      temperature: 0,
      forceJSON: true,
    });

    expect(capturedBody.response_format).toEqual({ type: "json_object" });
  });

  test("Bearer token is set in Authorization header", async () => {
    let capturedAuth = null;
    setFetchForTest(async (_url, opts) => {
      capturedAuth = opts.headers.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }),
      };
    });

    await _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 });
    expect(capturedAuth).toBe("Bearer test-key-not-real");
  });
});

/* ── callMistralRaw: 429-Retry ──────────────────────────────────── */

describe("callMistralRaw 429 retry behavior", () => {
  test("retries once on 429 with backoff, then succeeds", async () => {
    let attempts = 0;
    setFetchForTest(async () => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, status: 429, text: async () => "rate limited" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
      };
    });

    const result = await _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 });
    expect(attempts).toBe(2);
    expect(result.text).toBe("ok");
  }, 10000);

  test("gives up after exhausting retries on persistent 429", async () => {
    let attempts = 0;
    setFetchForTest(async () => {
      attempts++;
      return { ok: false, status: 429, text: async () => "rate limited" };
    });

    await expect(_callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 })).rejects.toMatchObject({
      status: 429,
    });
    /* 3 Versuche total: initial + 2 retries */
    expect(attempts).toBe(3);
  }, 15000);
});

/* ── callMistralRaw: Fehler-Behandlung ─────────────────────────── */

describe("callMistralRaw error paths", () => {
  test("throws on non-2xx non-429 response", async () => {
    setFetchForTest(async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }));

    await expect(_callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 })).rejects.toMatchObject({
      status: 500,
    });
  });

  test("throws timeout error on AbortController abort", async () => {
    setFetchForTest(async (_url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });

    await expect(
      _callMistralRaw({
        model: "x",
        messages: [],
        maxTokens: 1,
        temperature: 0,
        timeoutMs: 50 /* sehr kurz für den Test */,
      })
    ).rejects.toMatchObject({ code: "timeout" });
  }, 5000);
});

/* ── describeImage: erfolgreicher Lauf ─────────────────────────── */

describe("describeImage", () => {
  test("returns description text from successful Mistral call", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: "Ein Bild zeigt eine Person mit ÖFB-Trikot." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    }));

    const result = await mistral.describeImage(Buffer.from("fake-image-data"), "image/jpeg", undefined, "de");
    expect(result).toBe("Ein Bild zeigt eine Person mit ÖFB-Trikot.");
  });

  test("returns null when both primary and fallback Mistral describe fail", async () => {
    let callCount = 0;
    setFetchForTest(async () => {
      callCount++;
      /* Beide Versuche liefern leeren Text */
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "" }, finish_reason: "content_filter" }],
          usage: {},
        }),
      };
    });

    const result = await mistral.describeImage(Buffer.from("img"), "image/jpeg", undefined, "de");
    expect(result).toBeNull();
    expect(callCount).toBe(2); /* Primary + fallback */
  });

  test("propagates rate-limit errors as code rate_limit", async () => {
    setFetchForTest(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    /* describeImage versucht describe, fängt rate_limit ab und wirft. */
    await expect(mistral.describeImage(Buffer.from("img"), "image/jpeg", undefined, "de")).rejects.toMatchObject({
      code: "rate_limit",
    });
  }, 10000);

  test("throws code api_error on a non-429 HTTP error (not blocked.safetyFilter)", async () => {
    setFetchForTest(async () => ({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    }));

    /* Ein echter API-Fehler darf NICHT als null durchgehen (→ würde im Caller
       fälschlich als safetyFilter gelabelt) — describeImage muss api_error werfen. */
    await expect(mistral.describeImage(Buffer.from("img"), "image/jpeg", undefined, "de")).rejects.toMatchObject({
      code: "api_error",
    });
  });
});

/* ── generateBothProfiles: erfolgreicher Lauf ──────────────────── */

describe("generateBothProfiles", () => {
  const validProfileJson = JSON.stringify({
    categories: {
      alter_geschlecht: { label: "Alter & Geschlecht", value: "Du bist ...", confidence: 0.9 },
    },
    ad_targeting: ["Marke A"],
    manipulation_triggers: ["Trigger 1"],
    profileText: "Du bist eine ...",
  });

  test("returns both profiles when Small 4 succeeds", async () => {
    let calls = 0;
    setFetchForTest(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: validProfileJson }, finish_reason: "stop" }],
          usage: {},
        }),
      };
    });

    const result = await mistral.generateBothProfiles("Eine junge Frau mit langen Haaren.", {}, undefined, "de");

    expect(result.normal).not.toBeNull();
    expect(result.boost).not.toBeNull();
    expect(result.normal.categories.alter_geschlecht.value).toBe("Du bist ...");
    expect(calls).toBe(2); /* Normal + Boost parallel, beide direkt OK */
  });

  test("falls back to Large 3 when Small 4 returns unparseable text", async () => {
    let calls = 0;
    setFetchForTest(async (_url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      /* Small 4 antwortet mit Müll, Large 3 antwortet mit gültigem JSON */
      const isSmall4 = body.model === "mistral-small-2603";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: isSmall4 ? "totally not json" : validProfileJson },
              finish_reason: "stop",
            },
          ],
          usage: {},
        }),
      };
    });

    const result = await mistral.generateBothProfiles("Ein Beschreibungstext.", {}, undefined, "de");

    expect(result.normal).not.toBeNull();
    expect(result.boost).not.toBeNull();
    /* Mindestens 4 Calls: 2× Small 4 versucht + 2× Large 3 fallback */
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  test("returns null for a profile when both Small 4 and Large 3 fail", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "not json at all" }, finish_reason: "stop" }],
        usage: {},
      }),
    }));

    const result = await mistral.generateBothProfiles("text", {}, undefined, "de");
    expect(result.normal).toBeNull();
    expect(result.boost).toBeNull();
  });

  test("includes EXIF camera data in the prompt", async () => {
    let capturedBody;
    setFetchForTest(async (_url, opts) => {
      if (!capturedBody) capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: validProfileJson }, finish_reason: "stop" }],
          usage: {},
        }),
      };
    });

    await mistral.generateBothProfiles("image description", { make: "Canon" }, undefined, "de");

    const prompt = capturedBody.messages[0].content;
    expect(prompt).toContain("Canon");
  });
});

/* ── Mistral-Describe-Addendum liegt im Locale ─────────────────── */

describe("mistralDescribeAddendum locale entries", () => {
  test("de locale exposes addendum with visible-text instruction", () => {
    const { loadPrompts } = require("../i18n");
    const prompts = loadPrompts("de");
    expect(prompts.mistralDescribeAddendum).toBeDefined();
    expect(prompts.mistralDescribeAddendum).toContain("Sichtbarer Text");
    expect(prompts.mistralDescribeAddendum).toContain("ZUSATZAUFGABE");
  });

  test("en locale exposes addendum with visible-text instruction", () => {
    const { loadPrompts } = require("../i18n");
    const prompts = loadPrompts("en");
    expect(prompts.mistralDescribeAddendum).toBeDefined();
    expect(prompts.mistralDescribeAddendum).toContain("Visible text");
    expect(prompts.mistralDescribeAddendum).toContain("ADDITIONAL TASK");
  });
});
