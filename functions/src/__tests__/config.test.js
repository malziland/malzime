const config = require("../config");

describe("config", () => {
  test("exports expected constants", () => {
    expect(config.MAX_UPLOAD_BYTES).toBe(6 * 1024 * 1024);
    expect(config.RATE_LIMIT).toBe(200);
    expect(config.RATE_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(config.ALLOWED_MIME).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  });

  test("model lists are non-empty arrays", () => {
    expect(Array.isArray(config.DESCRIBE_MODELS)).toBe(true);
    expect(config.DESCRIBE_MODELS.length).toBeGreaterThan(0);
    expect(Array.isArray(config.PROFILE_MODELS)).toBe(true);
    expect(config.PROFILE_MODELS.length).toBeGreaterThan(0);
  });

  test("API_TIMEOUT_MS is a reasonable value", () => {
    expect(config.API_TIMEOUT_MS).toBe(45000);
  });

  test("Mistral constants are set for Phase 2", () => {
    expect(config.MISTRAL_DESCRIBE_MODEL).toBe("mistral-large-latest");
    expect(config.MISTRAL_PROFILE_MODEL).toBe("mistral-small-2603");
    expect(config.MISTRAL_FALLBACK_MODEL).toBe("mistral-large-latest");
    expect(config.MISTRAL_ENDPOINT).toMatch(/^https:\/\/api\.mistral\.ai/);
    expect(config.MISTRAL_DESCRIBE_MAX_TOKENS).toBeGreaterThan(0);
    expect(config.MISTRAL_PROFILE_MAX_TOKENS).toBeGreaterThan(5000);
    expect(config.MISTRAL_TIMEOUT_MS).toBeGreaterThan(config.API_TIMEOUT_MS);
  });
});
