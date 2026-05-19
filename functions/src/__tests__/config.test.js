const config = require("../config");

describe("config", () => {
  test("exports expected constants", () => {
    expect(config.MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(config.RATE_LIMIT).toBe(500);
    expect(config.RATE_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(config.ALLOWED_MIME).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  });

  test("no legacy Google AI/Vision constants present (Mistral-only seit v1.6.0)", () => {
    expect(config.DESCRIBE_MODELS).toBeUndefined();
    expect(config.PROFILE_MODELS).toBeUndefined();
  });

  test("legacy API_TIMEOUT_MS removed (Mistral-only seit v1.6.0)", () => {
    expect(config.API_TIMEOUT_MS).toBeUndefined();
  });

  test("Mistral constants are set", () => {
    expect(config.MISTRAL_DESCRIBE_MODEL).toBe("mistral-large-2512");
    expect(config.MISTRAL_PROFILE_MODEL).toBe("mistral-small-2603");
    expect(config.MISTRAL_FALLBACK_MODEL).toBe("mistral-large-2512");
    expect(config.MISTRAL_ENDPOINT).toMatch(/^https:\/\/api\.mistral\.ai/);
    expect(config.MISTRAL_DESCRIBE_MAX_TOKENS).toBeGreaterThan(0);
    expect(config.MISTRAL_PROFILE_MAX_TOKENS).toBeGreaterThan(5000);
    expect(config.MISTRAL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
