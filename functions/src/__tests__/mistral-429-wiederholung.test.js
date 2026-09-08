/**
 * mistral-429-wiederholung.test.js — Ueberlast bei Mistral ist Wartezeit,
 * kein Fehler fuer das Kind vor dem Bildschirm.
 *
 * BELEG (08.09.2026, 12:19–12:27 Wien, eine Klasse): 47 Analysen, 6 davon
 * mit "Mistral HTTP 429 Rate limit exceeded" gescheitert. Jede Ablehnung kam
 * genau dann, wenn in den 60 Sekunden davor 15 Aufrufe angenommen worden
 * waren (Stufe T1). Der Code wiederholte EINMAL nach 2 Sekunden — bei einem
 * Limit von einem Aufruf je vier Sekunden aussichtslos: alle sechs bekamen
 * beim zweiten Versuch wieder 429, der Auftrag wurde "blocked", sechs Kinder
 * sahen nach 110 Sekunden Wartezeit "technischer Fehler".
 *
 * Geprueft wird:
 *   1. Wartezeit und Anzahl der Wiederholungen kommen aus dem Einstellungssatz
 *      (ueberlastWarteMs, ueberlastVersuche); jede Wiederholung wartet doppelt
 *      so lang wie die vorige.
 *   2. Bleibt es bei 429, gibt der Aufruf erst nach ALLEN Wiederholungen auf.
 *   3. Nennt Mistral eine Wartezeit (Retry-After), gilt die laengere von beiden.
 *   4. Das Zeitbudget des Auftrags wird nicht ueberschritten: Reicht der Rest
 *      nicht mehr fuer die naechste Wartezeit, wird sofort aufgegeben.
 *   5. Jede Wiederholung steht als eigene Zeile im Log, mit Wartezeit und
 *      Retry-After — damit die naechste Logauswertung sieht, wie oft das Netz
 *      greift.
 *   6. Das Ergebnis traegt die Zahl der Wiederholungen (fuer das Analyse-Log).
 */
const WARTE_MS = 40;
const VERSUCHE = 3;
jest.mock("../betriebsprofil", () =>
  require("../test-satz").betriebsprofilMock({ ueberlastWarteMs: 40, ueberlastVersuche: 3 })
);

const mistral = require("../mistral");
const { setFetchForTest, _callMistralRaw } = mistral;
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
let logSpy;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  setFetchForTest(null);
  logSpy.mockRestore();
});

afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

const AUFRUF = { model: "x", messages: [], maxTokens: 1, temperature: 0 };

function gesund() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
  };
}

/* Der Rumpf ist der echte vom 08.09.2026. */
function ueberlastet(retryAfter) {
  return {
    ok: false,
    status: 429,
    headers: {
      get: (name) => (name.toLowerCase() === "retry-after" && retryAfter != null ? String(retryAfter) : null),
    },
    text: async () =>
      '{"object":"error","message":"Rate limit exceeded","type":"rate_limited","param":null,"code":"1300","raw_status_code":429}',
  };
}

function wiederholungsZeilen() {
  return logSpy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0]);
      } catch (_) {
        return null;
      }
    })
    .filter((z) => z && z.step === "mistral-wiederholung");
}

describe("callMistralRaw bei 429 (Vorfall 08.09.2026)", () => {
  test("wiederholt so oft, wie der Satz sagt, mit verdoppelter Wartezeit — und liefert dann das Ergebnis", async () => {
    const zeiten = [];
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      zeiten.push(Date.now());
      return versuche <= VERSUCHE ? ueberlastet() : gesund();
    });
    const ergebnis = await _callMistralRaw(AUFRUF);
    expect(ergebnis.text).toBe("ok");
    expect(versuche).toBe(VERSUCHE + 1);
    expect(ergebnis.wiederholungen).toBe(VERSUCHE);
    /* 40, 80, 160 ms — jede Pause mindestens so lang wie geplant. */
    for (let i = 1; i <= VERSUCHE; i++) {
      expect(zeiten[i] - zeiten[i - 1]).toBeGreaterThanOrEqual(WARTE_MS * 2 ** (i - 1) - 5);
    }
    const zeilen = wiederholungsZeilen();
    expect(zeilen).toHaveLength(VERSUCHE);
    expect(zeilen.map((z) => z.wartezeitMs)).toEqual([40, 80, 160]);
    expect(zeilen[0]).toMatchObject({ status: 429, versuch: 1, retryAfter: null });
  }, 10000);

  test("bleibt es bei 429, gibt der Aufruf erst nach allen Wiederholungen auf — mit Status 429", async () => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return ueberlastet();
    });
    await expect(_callMistralRaw(AUFRUF)).rejects.toMatchObject({ status: 429 });
    expect(versuche).toBe(VERSUCHE + 1);
  }, 10000);

  test("nennt Mistral eine laengere Wartezeit (Retry-After), gilt diese", async () => {
    const zeiten = [];
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      zeiten.push(Date.now());
      /* Retry-After in Sekunden, wie im HTTP-Standard: 1 s > geplante 40 ms. */
      return versuche === 1 ? ueberlastet(1) : gesund();
    });
    await _callMistralRaw(AUFRUF);
    expect(zeiten[1] - zeiten[0]).toBeGreaterThanOrEqual(995);
    expect(wiederholungsZeilen()[0]).toMatchObject({ retryAfter: 1, wartezeitMs: 1000 });
  }, 10000);

  test("eine kuerzere Retry-After-Angabe verkuerzt die geplante Wartezeit NICHT", async () => {
    const zeiten = [];
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      zeiten.push(Date.now());
      return versuche === 1 ? ueberlastet(0) : gesund();
    });
    await _callMistralRaw(AUFRUF);
    expect(zeiten[1] - zeiten[0]).toBeGreaterThanOrEqual(WARTE_MS - 5);
  }, 10000);

  test("reicht das Restbudget nicht fuer die naechste Wartezeit, wird sofort aufgegeben", async () => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return ueberlastet();
    });
    const start = Date.now();
    /* Budget 100 ms: Erster Versuch, dann 40 ms warten, zweiter Versuch, die
       naechste Pause (80 ms) passt nicht mehr hinein -> Schluss, ohne Warten. */
    await expect(_callMistralRaw({ ...AUFRUF, timeoutMs: 100 })).rejects.toMatchObject({ status: 429 });
    expect(versuche).toBeLessThanOrEqual(2);
    expect(Date.now() - start).toBeLessThan(100 + 50);
  }, 10000);

  test("ein 5xx-Aussetzer folgt derselben Reihe (kein eigener Sonderweg)", async () => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return versuche === 1 ? { ok: false, status: 503, text: async () => "weg" } : gesund();
    });
    const ergebnis = await _callMistralRaw(AUFRUF);
    expect(ergebnis.wiederholungen).toBe(1);
    expect(wiederholungsZeilen()[0]).toMatchObject({ status: 503, wartezeitMs: WARTE_MS });
  }, 10000);
});
