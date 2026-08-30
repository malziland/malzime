const { SATZ } = require("../test-satz");
const { getClientIp, checkRateLimit } = require("../middleware");

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
