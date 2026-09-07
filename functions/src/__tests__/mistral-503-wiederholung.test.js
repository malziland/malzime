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
 * Geprueft wird: 502, 503 und 504 bekommen EINE Wiederholung nach derselben
 * Pause wie 429. Ein 500, 400 oder 401 bekommt sie NICHT — das sind keine
 * Aussetzer, sondern Antworten auf genau diese Anfrage; eine Wiederholung
 * kostete dort nur Zeit und Geld.
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

  test("bleibt der 503, gibt er nach der einen Wiederholung auf — mit Status 503", async () => {
    let versuche = 0;
    setFetchForTest(async () => {
      versuche += 1;
      return kaputt(503);
    });
    await expect(_callMistralRaw(AUFRUF)).rejects.toMatchObject({ status: 503 });
    /* Genau zwei Versuche: der erste und EINE Wiederholung. Mehr wuerde bei
       einem laengeren Ausfall nur das Zeitbudget der Analyse aufbrauchen. */
    expect(versuche).toBe(2);
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
