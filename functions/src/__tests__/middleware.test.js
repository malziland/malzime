const { SATZ } = require("../test-satz");
const { getClientIp, checkRateLimit, _rateState } = require("../middleware");

describe("getClientIp", () => {
  test("uses req.ip (ignores spoofable x-forwarded-for)", () => {
    const req = { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, ip: "9.9.9.9" };
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  test("falls back to req.ip", () => {
    const req = { headers: {}, ip: "10.0.0.1" };
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  test("returns unknown when no IP info", () => {
    const req = { headers: {} };
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  test("allows first request", () => {
    expect(checkRateLimit("test-unique-key-" + Date.now(), SATZ.adressLimit, SATZ.adressfensterMs)).toBe(true);
  });

  test("allows multiple requests within limit", () => {
    const key = "test-multi-" + Date.now();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(key, SATZ.adressLimit, SATZ.adressfensterMs)).toBe(true);
    }
  });

  test("blocks request at rate limit boundary (501st request)", () => {
    const key = "boundary-test-" + Date.now();
    for (let i = 0; i < 500; i++) {
      expect(checkRateLimit(key, SATZ.adressLimit, SATZ.adressfensterMs)).toBe(true);
    }
    expect(checkRateLimit(key, SATZ.adressLimit, SATZ.adressfensterMs)).toBe(false);
  });

  test("does not crash with many unique IPs (LRU-Cap)", () => {
    const prefix = "lru-" + Date.now() + "-";
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit(prefix + i, SATZ.adressLimit, SATZ.adressfensterMs)).toBe(true);
    }
  });
});

/* PRIV-2026-09-10-07: Die Datenschutzerklaerung nennt eine Hoechstdauer fuer
   die IP-Adresse im Arbeitsspeicher. Frueher verschwand ein Eintrag nur, wenn
   danach noch jemand anfragte — und selbst dann hoechstens alle 60 s. */
describe("Adressliste raeumt sich selbst auf (PRIV-2026-09-10-07)", () => {
  const FENSTER = 10_000;

  afterEach(() => {
    jest.useRealTimers();
  });

  test("ein Eintrag ist zum Ende seines Fensters weg, ohne dass noch jemand anfragt", () => {
    jest.useFakeTimers();
    const key = "ablauf-ohne-folgeaufruf";
    expect(checkRateLimit(key, 5, FENSTER)).toBe(true);
    expect(_rateState.has(key)).toBe(true);
    jest.advanceTimersByTime(FENSTER - 1);
    expect(_rateState.has(key)).toBe(true);
    jest.advanceTimersByTime(1);
    expect(_rateState.has(key)).toBe(false);
  });

  test("verspaeteter Zeitgeber (CPU gedrosselt): der naechste Aufruf loescht jeden abgelaufenen Eintrag, und er zaehlt nicht mehr mit", () => {
    jest.useFakeTimers();
    const gesperrt = "ablauf-gedrosselt-a";
    expect(checkRateLimit(gesperrt, 1, FENSTER)).toBe(true);
    expect(checkRateLimit(gesperrt, 1, FENSTER)).toBe(false);
    /* Nur die Uhr vorstellen, KEINEN Zeitgeber ausfuehren — so sieht es aus,
       wenn Cloud Run die CPU zwischen zwei Anfragen gedrosselt hat. */
    jest.setSystemTime(Date.now() + FENSTER);
    expect(_rateState.has(gesperrt)).toBe(true);
    checkRateLimit("ablauf-gedrosselt-b", 1, FENSTER);
    expect(_rateState.has(gesperrt)).toBe(false);
    expect(checkRateLimit(gesperrt, 1, FENSTER)).toBe(true);
  });

  test("der Zeitgeber haelt den Prozess nicht wach (unref)", () => {
    const key = "ablauf-unref";
    checkRateLimit(key, 5, FENSTER);
    expect(_rateState.get(key).zeitgeber.hasRef()).toBe(false);
  });
});
