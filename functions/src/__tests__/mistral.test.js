/* Betriebswerte kommen seit 30.08.2026 ausschliesslich aus Firestore. Fuer
   Tests, die eine Analyse durchspielen, wird hier ein gueltiger Satz gestellt —
   sonst bricht jeder Aufruf mit "Betriebswerte fehlen" ab, was diese Tests
   nicht pruefen wollen. Wer das Verhalten OHNE Satz prueft, tut das in
   betriebsprofil*.test.js. */
/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { SATZ } = require("../test-satz");

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
      model: "mistral-large-2512",
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

  test("KA-09: der nie gelesene 429-Antwortrumpf wird aktiv verworfen (body.cancel)", async () => {
    let attempts = 0;
    const cancelSpy = jest.fn(async () => {});
    setFetchForTest(async () => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, status: 429, text: async () => "rate limited", body: { cancel: cancelSpy } };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
      };
    });

    const result = await _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 });
    expect(result.text).toBe("ok");
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  }, 10000);

  test("KA-09: ein werfendes body.cancel aendert am Retry NICHTS (best effort)", async () => {
    let attempts = 0;
    setFetchForTest(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "rate limited",
          body: {
            cancel: async () => {
              throw new Error("cancel kaputt");
            },
          },
        };
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
    /* Der erste Versuch plus die Wiederholungen aus dem Einstellungssatz
       (Testsatz: 2). Geschichte: v1.10.6 kuerzte auf [2000]; seit 08.09.2026
       kommt die Reihe aus dem Satz — mistral-429-wiederholung.test.js. */
    expect(attempts).toBe(1 + require("../test-satz").SATZ.ueberlastVersuche);
  }, 15000);

  test("v1.10.6: Einzel-Call-Timeout cappt bei mistralTimeoutMs aus dem Einstellungssatz auch wenn budget groesser ist", async () => {
    /* Wenn das REQUEST_BUDGET_MS gross ist (z.B. 480s), darf der einzelne
       Mistral-Call trotzdem nicht laenger als MISTRAL_TIMEOUT_MS laufen.
       Simuliert wird via Mock-Fetch, der nie returnt — dann sollte
       AbortController nach MISTRAL_TIMEOUT_MS feuern, nicht nach 480s. */
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
    expect(abortedAt).toBeLessThan(SATZ.mistralTimeoutMs + 5000);
  }, 100000);
});

/* ── callMistralRaw: Throttle-Integration (REL-01) ─────────────── */

describe("callMistralRaw throttle integration (REL-01)", () => {
  const { getMistralStats } = require("../throttle");

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
    const calls = Array.from({ length: SATZ.drosselMaxParallel + 6 }, () =>
      _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 })
    );
    await Promise.all(calls);

    expect(maxObserved).toBeGreaterThan(1); /* echte Parallelität fand statt */
    expect(maxObserved).toBeLessThanOrEqual(SATZ.drosselMaxParallel); /* aber gedeckelt durch die Semaphore */
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

  /* BIZ-001 (Audit 2026-08-10): Der Anker wird VORANGESTELLT, nicht eingesetzt.
     Vorher überschrieb er den ganzen Kartenwert und warf damit den zweiten Satz
     weg — das konkrete, im Workshop vorführbare Merkmal, das der Prompt
     ausdrücklich verlangt. Die v2.9-Messung „100 % mit konkretem Merkmal" wurde
     an der Modellantwort erhoben; auf der Karte kam es nie an. */
  test("BIZ-001: der Beleg-Satz des Modells überlebt den Hard-Facts-Anker", async () => {
    const body = makeCompleteResponse();
    body.standard.categories.alter_geschlecht.value =
      "Du bist männlich, etwa 38. Die Linien um die Augen bleiben auch ohne Lächeln sichtbar.";
    body.beast.categories.alter_geschlecht.value = "Männlich, ~38. Die Krähenfüße verraten dich.";
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4000, completion_tokens: 2000 },
      }),
    }));
    const result = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");

    /* Der verbindliche Anker steht vorn ... */
    expect(result.normal.categories.alter_geschlecht.value).toMatch(/^männlich, ~38 \(Spanne 35-42\)\./);
    /* ... und der Beleg-Satz ist noch da. */
    expect(result.normal.categories.alter_geschlecht.value).toContain("Die Linien um die Augen");
    /* Standard und Beast unterscheiden sich an dieser Karte wieder. */
    expect(result.boost.categories.alter_geschlecht.value).toContain("Krähenfüße");
    expect(result.normal.categories.alter_geschlecht.value).not.toBe(result.boost.categories.alter_geschlecht.value);
    /* Und der Filter bekommt den Anker separat, damit Zahlen aus dem
       Beleg-Satz die Altersauslese nicht nach unten ziehen. */
    expect(result.alterAnker).toBe("männlich, ~38 (Spanne 35-42)");
  });

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

  test("schickt immer einen prompt_cache_key (fest seit 10.09.2026)", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(seen[0].prompt_cache_key).toBe("malzime-single-large-de");
  });

  test("Cache-Key ist sprachgetrennt — de und en haben verschiedene Prompts", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "en");
    expect(seen[0].prompt_cache_key).toBe("malzime-single-large-en");
  });

  test("Cache-Key traegt keinen Nutzerbezug — konstant ueber mehrere Aufrufe", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("bild-eins"), "image/jpeg", () => 60000, "de");
    await runSingleLargeCall(Buffer.from("bild-zwei"), "image/jpeg", () => 60000, "de");
    expect(seen[0].prompt_cache_key).toBe(seen[1].prompt_cache_key);
  });

  /* Struktur-Tests. Der Aufbau ist hier kein Stilfrage, sondern die Bedingung
     dafuer, dass der Cache ueberhaupt greift — an der echten API gemessen:
     Text+Bild in einer user-Message => 0% Treffer, system-Split => 82-100%. */

  test("statischer Text als system-Message, Bild getrennt in user", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    const [sys, user] = seen[0].messages;
    expect(sys.role).toBe("system");
    expect(typeof sys.content).toBe("string");
    expect(sys.content.length).toBeGreaterThan(1000);
    expect(user.role).toBe("user");
    expect(user.content[0].type).toBe("image_url");
  });

  test("der statische Teil ist ueber Aufrufe hinweg bitgleich — sonst kein Cache-Treffer", async () => {
    const seen = captureBody();
    await runSingleLargeCall(Buffer.from("bild-eins"), "image/jpeg", () => 60000, "de");
    await runSingleLargeCall(Buffer.from("bild-zwei"), "image/jpeg", () => 60000, "de");
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

    await runSingleLargeCall(Buffer.from("fake"), "image/jpeg", () => 60000, "de");
    expect(seen).toHaveLength(2);
    /* Der cachebare Anfang muss in beiden Anfragen identisch sein ... */
    expect(seen[1].messages[0].role).toBe("system");
    expect(seen[1].messages[0].content).toBe(seen[0].messages[0].content);
    /* ... und der Hinweis unten in der user-Message stehen. */
    const retryUser = seen[1].messages[1].content;
    expect(retryUser[retryUser.length - 1].text).toContain("HINWEIS");
  });
});
