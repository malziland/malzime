/**
 * ueberlast-entscheidung.test.js — ob ein Fehler "Ueberlast" ist, entscheidet
 * EINE Funktion, und sie liest nur Code und Status (BUG-2026-10-03-34).
 *
 * Vorher entschieden drei Stellen verschieden, zwei davon per Textsuche nach
 * den Ziffern 429 und nach "quota". Die Folge: Eine Zeitueberschreitung, deren
 * Millisekundenzahl "429" enthaelt, galt als Ueberlast — das Kind sah
 * "ueberlastet", und im Protokoll stand der falsche Grund.
 *
 * Geprueft wird zweimal: an der Funktion selbst (alle drei Zugaenge sind
 * dieselbe Funktion) und an der echten Kette runPipeline → mistral.js →
 * mistral-http.js, nur `fetch` ist gestellt.
 */

/* Die Zeitgrenze des Analyse-Aufrufs steht im Einstellungssatz. 1429 ms: Die
   Meldung der Zeitueberschreitung traegt dann "429" mitten in der Zahl. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock({ singleLargeTimeoutMs: 1429 }));
jest.mock("../queue-storage", () => ({
  loadImage: jest.fn(async () => ({ buffer: Buffer.from("bild"), mimeType: "image/jpeg" })),
  deleteImage: jest.fn(async () => true),
}));
jest.mock("../jobs", () => ({ setLiveText: jest.fn(async () => {}) }));
jest.mock("../feature-flags", () => ({ isBeastAdsCallEnabled: jest.fn(async () => false) }));

const { istUeberlast } = require("../ueberlast");
const { setFetchForTest } = require("../mistral");
const { runPipeline } = require("../job-pipelines");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
const ORIGINAL_MOCK = process.env.MISTRAL_MOCK;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  delete process.env.MISTRAL_MOCK;
  _setRateIntervalMs(0);
  _resetRateBucket();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_MOCK !== undefined) process.env.MISTRAL_MOCK = ORIGINAL_MOCK;
  setFetchForTest(null);
  jest.restoreAllMocks();
});

afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

const ZUGAENGE = [
  ["ueberlast.js (istUeberlast)", () => istUeberlast],
  ["mistral-http.js (isRateLimitError)", () => require("../mistral-http").isRateLimitError],
  ["mistral.js (isRateLimitError)", () => require("../mistral").isRateLimitError],
  ["Attrappe (isRateLimitError)", () => require("../mistral-mock").isRateLimitError],
];

describe.each(ZUGAENGE)("Ueberlast-Entscheidung ueber %s", (_name, hole) => {
  test("es ist dieselbe Funktion", () => {
    expect(hole()).toBe(istUeberlast);
  });

  test.each([
    [{ status: 429 }, "Mistral lehnt ab"],
    [{ code: "rate_limit" }, "so meldet die Analyse-Strecke Ueberlast weiter"],
    [{ code: "throttle_timeout" }, "die eigene Drossel ist aufgelaufen"],
    [Object.assign(new Error("Mistral 429 rate limited"), { status: 429 }), "der Fehler, wie mistral-http.js ihn baut"],
  ])("%p ist Ueberlast (%s)", (fehler) => {
    expect(hole()(fehler)).toBe(true);
  });

  test.each([
    [{ code: "timeout", message: "Mistral request timeout after 142900ms" }, "429 mitten in einer Millisekundenzahl"],
    [{ message: "Request failed with status code 429" }, "die Zahl nur im Text"],
    [{ message: "Quota exceeded for model" }, "das Wort quota"],
    [{ message: "Rate limit exceeded" }, "Wortlaut ohne Status"],
    [{ message: "429 Bewertungen gelesen" }, "Zahl im Fliesstext"],
    [{ status: 400, message: "Mistral HTTP 400: quota" }, "fehlerhafte Anfrage"],
    [{ status: 503 }, "Aussetzer — wird wiederholt, ist aber keine Ueberlast"],
    [{ code: "api_error" }, "anderer Fehlercode"],
    [{ code: "ECONNRESET" }, "Netzabbruch"],
    [null, "kein Fehlerobjekt"],
    [undefined, "undefined"],
    [{}, "leeres Objekt"],
  ])("%p ist keine Ueberlast (%s)", (fehler) => {
    expect(hole()(fehler)).toBe(false);
  });
});

describe("die echte Kette: was das Kind als Grund sieht", () => {
  const AUFTRAG = { lang: "de", exif: {}, imagePath: "p", traceId: "t" };

  test("Zeitueberschreitung nach 1429 ms ist ein technischer Fehler, keine Ueberlast", async () => {
    /* fetch antwortet nie und bricht ab, sobald die Zeitgrenze ausloest. */
    setFetchForTest(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
          );
        })
    );
    const { result, success } = await runPipeline(AUFTRAG);
    const warnung = console.warn.mock.calls.map((c) => String(c[0])).find((z) => z.includes("1429ms"));
    expect(warnung).toBeDefined();
    expect(success).toBe(false);
    expect(result.blockedReason).toBe("blocked.apiError");
  });

  test("eine Fehlerantwort mit dem Wort 'quota' im Text ist ein technischer Fehler", async () => {
    setFetchForTest(async () => ({ ok: false, status: 400, text: async () => '{"message":"quota"}' }));
    const { result } = await runPipeline(AUFTRAG);
    expect(result.blockedReason).toBe("blocked.apiError");
  });

  test("Gegenprobe: Lehnt Mistral mit 429 ab, sieht das Kind 'ueberlastet'", async () => {
    let aufrufe = 0;
    setFetchForTest(async () => {
      aufrufe += 1;
      return { ok: false, status: 429, text: async () => '{"message":"Rate limit exceeded"}' };
    });
    const { result } = await runPipeline(AUFTRAG);
    expect(result.blockedReason).toBe("blocked.overloaded");
    /* Erster Versuch und die Wiederholungen aus dem Einstellungssatz. */
    expect(aufrufe).toBeGreaterThan(1);
  });

  test("Gegenprobe: Ein Serverfehler 500 bleibt ein technischer Fehler", async () => {
    setFetchForTest(async () => ({ ok: false, status: 500, text: async () => "Internal Server Error" }));
    const { result } = await runPipeline(AUFTRAG);
    expect(result.blockedReason).toBe("blocked.apiError");
  });
});
