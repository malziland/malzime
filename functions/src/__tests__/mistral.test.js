const mistral = require("../mistral");
const { isRateLimitError, setFetchForTest, _callMistralRaw } = mistral;
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

/* Speichert ursprüngliche env, restored in afterEach */
const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  /* v1.10.6: Token-Bucket-Rate-Limiter im Throttle deaktivieren, sonst
     serialisiert er parallele Calls auf 1 RPS und sprengt Test-Timeouts. */
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

  test("detects throttle_timeout (v1.10.6: eigene Drossel als Ueberlast-Signal)", () => {
    const err = new Error("Throttle queue timeout after 360000ms");
    err.code = "throttle_timeout";
    expect(isRateLimitError(err)).toBe(true);
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
    /* v1.10.6: 2 Versuche total (initial + 1 retry), war [1000,3000] → [2000] */
    expect(attempts).toBe(2);
  }, 15000);

  test("v1.10.6: Einzel-Call-Timeout cappt bei MISTRAL_TIMEOUT_MS auch wenn budget groesser ist", async () => {
    /* Wenn das REQUEST_BUDGET_MS gross ist (z.B. 480s), darf der einzelne
       Mistral-Call trotzdem nicht laenger als MISTRAL_TIMEOUT_MS laufen.
       Simuliert wird via Mock-Fetch, der nie returnt — dann sollte
       AbortController nach MISTRAL_TIMEOUT_MS feuern, nicht nach 480s. */
    const { MISTRAL_TIMEOUT_MS } = require("../config");
    let abortedAt = null;
    const start = Date.now();
    setFetchForTest(async (_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          abortedAt = Date.now() - start;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    /* Budget 480000 absichtlich gross gewaehlt — Cap muss greifen */
    await expect(
      _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0, timeoutMs: 480000 })
    ).rejects.toMatchObject({ code: "timeout" });

    /* AbortController muss bei ~MISTRAL_TIMEOUT_MS (90s) feuern, nicht bei 480s.
       Wir geben grosszuegig Toleranz, weil Fake-Timing im Jest-Setup nicht
       exakt arbeitet — wichtig ist: deutlich < 480s. */
    expect(abortedAt).toBeLessThan(MISTRAL_TIMEOUT_MS + 5000);
  }, 100000);
});

/* ── callMistralRaw: Throttle-Integration (REL-01) ─────────────── */

describe("callMistralRaw throttle integration (REL-01)", () => {
  const { getMistralStats, DEFAULT_MAX_CONCURRENT } = require("../throttle");

  test("routes every call through the per-instance semaphore — concurrency stays capped", async () => {
    let maxObserved = 0;
    setFetchForTest(async () => {
      maxObserved = Math.max(maxObserved, getMistralStats().inFlight);
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
      };
    });

    /* Mehr gleichzeitige Calls losschicken als das Limit erlaubt */
    const calls = Array.from({ length: DEFAULT_MAX_CONCURRENT + 6 }, () =>
      _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 })
    );
    await Promise.all(calls);

    expect(maxObserved).toBeGreaterThan(1); /* echte Parallelität fand statt */
    expect(maxObserved).toBeLessThanOrEqual(DEFAULT_MAX_CONCURRENT); /* aber gedeckelt durch die Semaphore */
    expect(getMistralStats().inFlight).toBe(0); /* alle Slots wieder freigegeben */
  }, 10000);
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
  /* v2.1: Fixture mit allen 13 Karten — sonst triggert die Vollständigkeits-
     Prüfung in runProfile einen Retry und der Call-Count steigt auf 4 statt 2. */
  const validProfileJson = JSON.stringify({
    categories: {
      alter_geschlecht: { label: "Alter & Geschlecht", value: "Du bist ...", confidence: 0.9 },
      herkunft: { label: "Ethnische Herkunft", value: "Du bist mitteleuropäisch.", confidence: 0.8 },
      einkommen: { label: "Geschätztes Einkommen", value: "Etwa 3.000-4.500€ brutto.", confidence: 0.7 },
      bildung: { label: "Bildungsniveau", value: "Hochschulabschluss vermutlich.", confidence: 0.7 },
      beziehungsstatus: { label: "Beziehungsstatus", value: "Keine klaren Signale.", confidence: 0.5 },
      interessen: { label: "Interessen & Hobbys", value: "Outdoor und Sport.", confidence: 0.8 },
      persoenlichkeit: { label: "Persönlichkeitstyp", value: "Selbstbewusst und zielorientiert.", confidence: 0.8 },
      charakterzuege: { label: "Charaktereigenschaften", value: "Diszipliniert und planvoll.", confidence: 0.8 },
      politisch: { label: "Politische Tendenz", value: "Keine klaren Signale.", confidence: 0.5 },
      gesundheit: { label: "Gesundheit & Fitness", value: "Wirkt fit und aktiv.", confidence: 0.85 },
      kaufkraft: { label: "Kaufkraft & Konsum", value: "Mittleres Konsumsegment.", confidence: 0.75 },
      verletzlichkeit: { label: "Verletzlichkeiten", value: "Anfällig für Status-Werbung.", confidence: 0.75 },
      werbeprofil: { label: "Werbeprofil", value: "Premium Outdoor Zielgruppe.", confidence: 0.8 },
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
      const isSmall = body.model === "mistral-small-2603";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: isSmall ? "totally not json" : validProfileJson },
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

/* ── singleLargePrompt locale entries (v2.2) ───────────────────── */

describe("singleLargePrompt locale entries", () => {
  test("de locale exposes singleLargePrompt", () => {
    const { loadPrompts } = require("../i18n");
    const prompts = loadPrompts("de");
    expect(prompts.singleLargePrompt).toBeDefined();
    expect(prompts.singleLargePrompt).toContain("STANDARD-Profil");
    expect(prompts.singleLargePrompt).toContain("BEAST-Profil");
    expect(prompts.singleLargePrompt).toContain("hard_facts");
  });

  test("en locale exposes singleLargePrompt", () => {
    const { loadPrompts } = require("../i18n");
    const prompts = loadPrompts("en");
    expect(prompts.singleLargePrompt).toBeDefined();
    expect(prompts.singleLargePrompt).toContain("STANDARD profile");
    expect(prompts.singleLargePrompt).toContain("BEAST profile");
    expect(prompts.singleLargePrompt).toContain("hard_facts");
  });
});

/* ── runSingleLargeCall (v2.2) ─────────────────────────────────── */

describe("runSingleLargeCall", () => {
  const { runSingleLargeCall } = mistral;
  const REQUIRED_KEYS = [
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

  function makeFullCategories(prefix) {
    const out = {};
    for (const k of REQUIRED_KEYS) {
      out[k] = { label: k, value: `${prefix} ${k}`, confidence: 0.8 };
    }
    return out;
  }

  function makeCompleteResponse() {
    return {
      hard_facts: { alter_geschlecht: "männlich, ~38 (Spanne 35-42)", herkunft: "mitteleuropäisch" },
      ad_targeting: ["Bio-Kosmetik", "Premium-Reisen"],
      manipulation_triggers: ["Trigger A", "Trigger B"],
      standard: { profileText: "Du bist sachlich beschrieben.", categories: makeFullCategories("Standard") },
      beast: { profileText: "Du bist zynisch beschrieben.", categories: makeFullCategories("Beast") },
    };
  }

  test("returns normal+boost with overridden hard facts when response is complete", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(makeCompleteResponse()) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4000, completion_tokens: 2000 },
      }),
    }));

    const result = await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(result.normal).toBeTruthy();
    expect(result.boost).toBeTruthy();
    /* Hard-Facts müssen WORTGENAU aus hard_facts kommen — selbst wenn Standard/Beast
       in den categories etwas anderes geschrieben hätten. */
    expect(result.normal.categories.alter_geschlecht.value).toBe("männlich, ~38 (Spanne 35-42)");
    expect(result.boost.categories.alter_geschlecht.value).toBe("männlich, ~38 (Spanne 35-42)");
    expect(result.normal.categories.herkunft.value).toBe("mitteleuropäisch");
    expect(result.boost.categories.herkunft.value).toBe("mitteleuropäisch");
    /* ads + triggers in beide Modi geschrieben. */
    expect(result.normal.ad_targeting).toEqual(["Bio-Kosmetik", "Premium-Reisen"]);
    expect(result.boost.ad_targeting).toEqual(["Bio-Kosmetik", "Premium-Reisen"]);
    expect(result.normal.manipulation_triggers).toEqual(["Trigger A", "Trigger B"]);
    expect(result.boost.manipulation_triggers).toEqual(["Trigger A", "Trigger B"]);
    /* profileText übernommen. */
    expect(result.normal.profileText).toBe("Du bist sachlich beschrieben.");
    expect(result.boost.profileText).toBe("Du bist zynisch beschrieben.");
  });

  test("retries with completion-hint when first call missed cards", async () => {
    const incompleteFirst = makeCompleteResponse();
    /* Standard und Beast jeweils eine Karte weglassen */
    delete incompleteFirst.standard.categories.werbeprofil;
    delete incompleteFirst.beast.categories.kaufkraft;

    let callCount = 0;
    setFetchForTest(async () => {
      callCount++;
      const body = callCount === 1 ? incompleteFirst : makeCompleteResponse();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4000, completion_tokens: 2000 },
        }),
      };
    });

    const result = await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(callCount).toBe(2); /* genau ein Retry */
    /* Aus Retry gemergte Karten müssen jetzt da sein */
    expect(result.normal.categories.werbeprofil).toBeTruthy();
    expect(result.boost.categories.kaufkraft).toBeTruthy();
  });

  test("returns {normal: null, boost: null} when JSON unparseable in both attempts", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "<<< not json at all >>>" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    }));

    const result = await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(result).toEqual({ normal: null, boost: null, subject: "", visibleText: "" });
  });

  test("propagates rate_limit code so caller can mark blocked.overloaded", async () => {
    setFetchForTest(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    await expect(runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de")).rejects.toMatchObject({
      code: "rate_limit",
    });
  });

  /* ── v2.5: Prompt-Caching ──────────────────────────────────────
     Der Cache-Key ist eine reine Kostenmassnahme. Diese Tests sichern die drei
     Eigenschaften, auf die wir uns dabei verlassen: er ist standardmaessig AUS,
     er ist ohne Nutzerbezug, und das Bild bleibt ausserhalb des Cache-Praefix. */

  function captureBody() {
    const seen = [];
    setFetchForTest(async (_url, init) => {
      seen.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(makeCompleteResponse()) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10821, completion_tokens: 2600, prompt_tokens_details: { cached_tokens: 9500 } },
        }),
      };
    });
    return seen;
  }

  test("schickt KEINEN prompt_cache_key, solange das Flag aus ist (Ist-Zustand vor v2.5)", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("prompt_cache_key");
  });

  test("schickt prompt_cache_key, wenn das Flag an ist", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    expect(seen[0].prompt_cache_key).toBe("malzime-single-large-de");
  });

  test("Cache-Key ist sprachgetrennt — de und en haben verschiedene Prompts", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "en", { usePromptCache: true });
    expect(seen[0].prompt_cache_key).toBe("malzime-single-large-en");
  });

  test("Cache-Key traegt keinen Nutzerbezug — konstant ueber mehrere Aufrufe", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("bild-eins"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    await runSingleLargeCall(Buffer.from("bild-zwei"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    expect(seen[0].prompt_cache_key).toBe(seen[1].prompt_cache_key);
  });

  /* Struktur-Tests. Der Aufbau ist hier kein Stilfrage, sondern die Bedingung
     dafuer, dass der Cache ueberhaupt greift — an der echten API gemessen:
     Text+Bild in einer user-Message => 0% Treffer, system-Split => 82-100%. */

  test("ohne Cache: unveraenderte Struktur aus v2.4 — Text und Bild in EINER user-Message", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(seen[0].messages).toHaveLength(1);
    expect(seen[0].messages[0].role).toBe("user");
    const parts = seen[0].messages[0].content;
    expect(parts[0].type).toBe("text");
    expect(parts[1].type).toBe("image_url");
  });

  test("mit Cache: statischer Text als system-Message, Bild getrennt in user", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    const [sys, user] = seen[0].messages;
    expect(sys.role).toBe("system");
    expect(typeof sys.content).toBe("string");
    expect(sys.content.length).toBeGreaterThan(1000);
    expect(user.role).toBe("user");
    expect(user.content[0].type).toBe("image_url");
  });

  test("der statische Teil ist ueber Aufrufe hinweg bitgleich — sonst kein Cache-Treffer", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("bild-eins"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    await runSingleLargeCall(Buffer.from("bild-zwei"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    expect(seen[0].messages[0].content).toBe(seen[1].messages[0].content);
  });

  test("Retry haengt den Hinweis UNTEN an — die system-Message bleibt unveraendert", async () => {
    const seen = [];
    let call = 0;
    setFetchForTest(async (_url, init) => {
      seen.push(JSON.parse(init.body));
      /* 1. Antwort unvollstaendig => loest den Retry aus, 2. vollstaendig. */
      const incomplete = { ...makeCompleteResponse(), beast: { profileText: "x", categories: {} } };
      const payload = call++ === 0 ? incomplete : makeCompleteResponse();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11237, completion_tokens: 2600 },
        }),
      };
    });

    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de", { usePromptCache: true });
    expect(seen).toHaveLength(2);
    /* Der cachebare Anfang muss in beiden Anfragen identisch sein ... */
    expect(seen[1].messages[0].role).toBe("system");
    expect(seen[1].messages[0].content).toBe(seen[0].messages[0].content);
    /* ... und der Hinweis unten in der user-Message stehen. */
    const retryUser = seen[1].messages[1].content;
    expect(retryUser[retryUser.length - 1].text).toContain("HINWEIS");
  });
});
