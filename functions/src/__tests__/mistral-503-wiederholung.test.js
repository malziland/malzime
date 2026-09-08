/**
 * mistral-503-wiederholung.test.js — ein kurzer Aussetzer bei Mistral ist
 * kein Fehler fuer den Menschen vor dem Bildschirm.
 *
 * BELEG (Logauswertung 07.09.2026, 18:44 Wien): Mistral antwortete auf die
 * erste Analyse des Tages mit HTTP 503 "Service unavailable". Der Code
 * wiederholte bis dahin nur bei 429; der 503 ging ungebremst durch, der
 * Auftrag wurde "blocked", und der Mensch am iPhone sah "technischer
 * Fehler". Sein zweiter Versuch eine Minute spaeter lief in 41 Sekunden
 * sauber durch — der Dienst war also nur kurz weg.
 *
 * Geprueft wird: 502, 503 und 504 bekommen dieselben Wiederholungen wie 429
 * (Anzahl und Wartezeit aus dem Einstellungssatz; der Testsatz sagt zwei).
 * Ein 500, 400 oder 401 bekommt sie NICHT — das sind keine Aussetzer,
 * sondern Antworten auf genau diese Anfrage; eine Wiederholung kostete dort
 * nur Zeit und Geld.
 */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const mistral = require("../mistral");
const { setFetchForTest, _callMistralRaw } = mistral;
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

const AUFRUF = { model: "x", messages: [], maxTokens: 1, temperature: 0 };

function gesund() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
  };
}

/* Der Rumpf ist der echte vom 07.09.2026 — so sieht ein Mistral-Aussetzer aus. */
function kaputt(status) {
  return {
    ok: false,
    status,
    text: async () =>
      '{"object":"error","message":"Service unavailable.","type":"internal_server_error","code":"3800"}',
  };
}

describe("callMistralRaw: voruebergehende Serverfehler (07.09.2026)", () => {
  test.each([502, 503, 504])(
    "HTTP %i: einmal wiederholt, dann Erfolg",
    async (status) => {
      let versuche = 0;
      setFetchForTest(async () => {
        versuche += 1;
        return versuche === 1 ? kaputt(status) : gesund();
      });
      const ergebnis = await _callMistralRaw(AUFRUF);
      expect(versuche).toBe(2);
      expect(ergebnis.text).toBe("ok");
    },
    10000
  );

  test("bleibt der 503, gibt er nach den Wiederholungen aus dem Satz auf — mit Status 503", async () => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return kaputt(503);
    });
    await expect(_callMistralRaw(AUFRUF)).rejects.toMatchObject({ status: 503 });
    /* Der erste Versuch plus so viele Wiederholungen, wie der Satz sagt
       (Testsatz: 2). Seit 08.09.2026 sind es im Betrieb vier, mit 10, 20, 40
       und 80 s Abstand — bei einem laengeren Ausfall begrenzt das Restbudget
       die Reihe, nicht eine feste Zahl im Code. */
    const { SATZ } = require("../test-satz");
    expect(versuche).toBe(1 + SATZ.ueberlastVersuche);
  }, 10000);

  test.each([500, 400, 401])("HTTP %i wird NICHT wiederholt", async (status) => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return kaputt(status);
    });
    await expect(_callMistralRaw(AUFRUF)).rejects.toMatchObject({ status });
    expect(versuche).toBe(1);
  });

  test("ein SPAETER 504: die Wiederholung bekommt nur das Restbudget (Abnahme 07.09.2026)", async () => {
    /* Erster Versuch: 300 ms bis zum 504, dann eine Pause (im Testsatz 1 ms).
       Budget 3000 ms — die Wiederholungen bekommen nur den Rest. Die Attrappe
       braucht danach je 1500 ms; spaetestens die zweite Wiederholung MUSS
       deshalb an der Uhr scheitern, nicht am 504, und der ganze Aufruf darf
       nicht laenger als das Budget dauern. Vorher bekam jede Wiederholung das
       volle Budget: 3800 ms statt hoechstens 3000. */
    let versuche = 0;
    setFetchForTest(
      (_url, { signal }) =>
        new Promise((erfuellen, ablehnen) => {
          versuche += 1;
          const uhr = setTimeout(() => erfuellen(kaputt(504)), versuche === 1 ? 300 : 1500);
          signal.addEventListener("abort", () => {
            clearTimeout(uhr);
            const e = new Error("abgebrochen");
            e.name = "AbortError";
            ablehnen(e);
          });
        })
    );
    const start = Date.now();
    await expect(_callMistralRaw({ ...AUFRUF, timeoutMs: 3000 })).rejects.toMatchObject({ code: "timeout" });
    expect(versuche).toBeGreaterThanOrEqual(2);
    expect(Date.now() - start).toBeLessThan(3000 + 300);
  }, 10000);

  test("KA-09 gilt auch hier: der nie gelesene 503-Antwortrumpf wird verworfen", async () => {
    let versuche = 0;
    const cancel = jest.fn(async () => {});
    setFetchForTest(async () => {
      versuche += 1;
      return versuche === 1 ? { ...kaputt(503), body: { cancel } } : gesund();
    });
    await _callMistralRaw(AUFRUF);
    expect(cancel).toHaveBeenCalledTimes(1);
  }, 10000);
});
