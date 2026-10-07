/**
 * mistral-rumpf-zeitgrenze.test.js — die Zeitgrenze eines KI-Aufrufs ohne
 * Datenstrom gilt, bis die Antwort ganz gelesen ist (BUG-2026-10-03-27).
 *
 * Ohne Datenstrom laufen der Werbe-Aufruf und die Nachfrage nach fehlenden
 * Karten. `fetch` kehrt schon mit den Kopfzeilen zurueck; der Text der Antwort
 * kommt danach. Bleibt er aus, muss derselbe Waechter den Aufruf beenden, der
 * auch das Warten auf die Kopfzeilen begrenzt — sonst haengt der Auftrag, bis
 * die Netzbibliothek von sich aus aufgibt.
 *
 * Die Attrappe verhaelt sich wie das echte `fetch`: Wird das Abbruch-Signal
 * ausgeloest, waehrend der Rumpf gelesen wird, scheitert das Lesen mit einem
 * AbortError. Ohne Signal bleibt das Lesen offen.
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

const GRENZE_MS = 80;
const AUFRUF = { model: "x", messages: [], maxTokens: 1, temperature: 0, timeoutCapMs: GRENZE_MS };
const ANTWORT = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} };

/* Liest einen Rumpf, der erst nach `nachMs` da ist (oder nie) — und bricht
   wie das echte fetch ab, sobald das Signal des Aufrufers ausloest. */
function rumpf(signal, wert, nachMs) {
  return new Promise((resolve, reject) => {
    const uhr = nachMs == null ? null : setTimeout(() => resolve(wert), nachMs);
    signal.addEventListener("abort", () => {
      if (uhr) clearTimeout(uhr);
      reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    });
  });
}

/* Endet der Aufruf von selbst? Sonst meldet die Probe nach einer Sekunde
   "haengt" — das Zwoelffache der Grenze. */
async function ausgang(aufruf) {
  let probe;
  const haengt = new Promise((resolve) => {
    probe = setTimeout(() => resolve({ haengt: true }), 1000);
  });
  const start = Date.now();
  const fertig = aufruf.then(
    (ergebnis) => ({ ergebnis, ms: Date.now() - start }),
    (fehler) => ({ fehler, ms: Date.now() - start })
  );
  const erster = await Promise.race([fertig, haengt]);
  clearTimeout(probe);
  return erster;
}

describe("Zeitgrenze deckt auch das Lesen der Antwort (BUG-2026-10-03-27)", () => {
  test("bleibt der Text nach den Kopfzeilen aus, endet der Aufruf an der Zeitgrenze", async () => {
    let signal;
    setFetchForTest(async (_url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, json: () => rumpf(init.signal, ANTWORT, null) };
    });
    const r = await ausgang(_callMistralRaw(AUFRUF));
    expect(r.haengt).toBeUndefined();
    expect(r.fehler).toMatchObject({ code: "timeout" });
    expect(r.fehler.message).toContain(`${GRENZE_MS}ms`);
    expect(r.ms).toBeGreaterThanOrEqual(GRENZE_MS - 10);
    expect(signal.aborted).toBe(true);
  });

  test("bleibt der Rumpf einer Fehlerantwort aus, endet der Aufruf ebenfalls — mit dem Status der Antwort", async () => {
    setFetchForTest(async (_url, init) => ({ ok: false, status: 500, text: () => rumpf(init.signal, "", null) }));
    const r = await ausgang(_callMistralRaw(AUFRUF));
    expect(r.haengt).toBeUndefined();
    expect(r.fehler).toMatchObject({ status: 500 });
  });

  test("kommt der Text innerhalb der Grenze, gilt die Antwort — und der Waechter ist danach abgeraeumt", async () => {
    let signal;
    setFetchForTest(async (_url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, json: () => rumpf(init.signal, ANTWORT, 20) };
    });
    const r = await ausgang(_callMistralRaw(AUFRUF));
    expect(r.fehler).toBeUndefined();
    expect(r.ergebnis).toMatchObject({ text: "ok", finishReason: "stop" });
    await new Promise((weiter) => setTimeout(weiter, GRENZE_MS + 40));
    expect(signal.aborted).toBe(false);
  });

  test("scheitert das Lesen sofort, ist der Waechter ebenfalls abgeraeumt", async () => {
    let signal;
    setFetchForTest(async (_url, init) => {
      signal = init.signal;
      /* Eine Antwort ohne lesbaren Rumpf: Der Leseaufruf selbst wirft. */
      return { ok: true, status: 200 };
    });
    const r = await ausgang(_callMistralRaw(AUFRUF));
    expect(r.fehler).toBeInstanceOf(TypeError);
    await new Promise((weiter) => setTimeout(weiter, GRENZE_MS + 40));
    expect(signal.aborted).toBe(false);
  });

  test("ein Lesefehler ohne Zeitgrenze bleibt ein Verbindungsabriss, keine Zeitueberschreitung", async () => {
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } });
      },
    }));
    const r = await ausgang(_callMistralRaw(AUFRUF));
    expect(r.fehler).toBeDefined();
    expect(r.fehler.code).not.toBe("timeout");
  });
});
