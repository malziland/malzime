/* Tests für mistral-mock.js — die Mistral-Attrappe für kostenlose Tests.
   Prüft Schnittstellen-Parität zu mistral.js: Rückgabe-Struktur, Sprach-
   Auswahl und das Fehlerverhalten über MISTRAL_MOCK_FAIL. */

const mock = require("../mistral-mock");

beforeEach(() => {
  /* Verzögerung in Tests auf 0 — keine echte Wartezeit. */
  process.env.MISTRAL_MOCK_DELAY_MS = "0";
  delete process.env.MISTRAL_MOCK_FAIL;
});

afterAll(() => {
  delete process.env.MISTRAL_MOCK_DELAY_MS;
  delete process.env.MISTRAL_MOCK_FAIL;
});

/* ── describeImage ────────────────────────────────────────────── */

describe("describeImage", () => {
  test("liefert eine Beschreibung mit SUBJECT: HUMAN-Kopfzeile", async () => {
    const text = await mock.describeImage(Buffer.from(""), "image/jpeg", null, "de");
    expect(typeof text).toBe("string");
    expect(text).toMatch(/^SUBJECT:\s*HUMAN/im);
  });

  test("respektiert die Sprache (en)", async () => {
    const text = await mock.describeImage(Buffer.from(""), "image/jpeg", null, "en");
    expect(text).toContain("Visible text");
  });

  test("MISTRAL_MOCK_FAIL=describe wirft einen api_error", async () => {
    process.env.MISTRAL_MOCK_FAIL = "describe";
    await expect(mock.describeImage(Buffer.from(""), "image/jpeg", null, "de")).rejects.toMatchObject({
      code: "api_error",
    });
  });

  test("MISTRAL_MOCK_FAIL=describe-empty liefert null (Safety-Filter)", async () => {
    process.env.MISTRAL_MOCK_FAIL = "describe-empty";
    expect(await mock.describeImage(Buffer.from(""), "image/jpeg", null, "de")).toBeNull();
  });

  test("MISTRAL_MOCK_FAIL=rate_limit wirft einen rate_limit-Fehler", async () => {
    process.env.MISTRAL_MOCK_FAIL = "rate_limit";
    await expect(mock.describeImage(Buffer.from(""), "image/jpeg", null, "de")).rejects.toMatchObject({
      code: "rate_limit",
    });
  });
});

/* ── generateBothProfiles ─────────────────────────────────────── */

describe("generateBothProfiles", () => {
  test("liefert strukturell gültige normal- und boost-Profile", async () => {
    const { normal, boost } = await mock.generateBothProfiles("desc", {}, null, "de");
    for (const profile of [normal, boost]) {
      expect(Object.keys(profile.categories).length).toBeGreaterThan(0);
      expect(Array.isArray(profile.ad_targeting)).toBe(true);
      expect(Array.isArray(profile.manipulation_triggers)).toBe(true);
      expect(typeof profile.profileText).toBe("string");
    }
  });

  test("jede Kategorie hat label, value und confidence", async () => {
    const { normal } = await mock.generateBothProfiles("desc", {}, null, "de");
    for (const cat of Object.values(normal.categories)) {
      expect(typeof cat.label).toBe("string");
      expect(typeof cat.value).toBe("string");
      expect(typeof cat.confidence).toBe("number");
    }
  });

  test("normal- und boost-Profil unterscheiden sich im profileText", async () => {
    const { normal, boost } = await mock.generateBothProfiles("desc", {}, null, "de");
    expect(normal.profileText).not.toBe(boost.profileText);
  });

  test("Profile sind als Mock erkennbar markiert", async () => {
    const { normal } = await mock.generateBothProfiles("desc", {}, null, "de");
    expect(normal.profileText).toContain("[MOCK-PROFIL]");
  });

  test("englische Profile nutzen englische Labels", async () => {
    const { normal } = await mock.generateBothProfiles("desc", {}, null, "en");
    expect(normal.categories.alter_geschlecht.label).toBe("Age & Gender");
  });

  test("MISTRAL_MOCK_FAIL=profiles liefert { normal: null, boost: null }", async () => {
    process.env.MISTRAL_MOCK_FAIL = "profiles";
    const result = await mock.generateBothProfiles("desc", {}, null, "de");
    expect(result).toEqual({ normal: null, boost: null });
  });

  test("MISTRAL_MOCK_FAIL=rate_limit wirft einen rate_limit-Fehler", async () => {
    process.env.MISTRAL_MOCK_FAIL = "rate_limit";
    await expect(mock.generateBothProfiles("desc", {}, null, "de")).rejects.toMatchObject({
      code: "rate_limit",
    });
  });
});

/* ── isRateLimitError ─────────────────────────────────────────── */

describe("isRateLimitError", () => {
  test("erkennt einen rate_limit-Fehler", () => {
    expect(mock.isRateLimitError({ code: "rate_limit" })).toBe(true);
  });

  test("ignoriert andere Fehler und null", () => {
    expect(mock.isRateLimitError({ code: "api_error" })).toBe(false);
    expect(mock.isRateLimitError(null)).toBe(false);
  });
});

/* ── konfigurierbare Verzögerung ──────────────────────────────── */

describe("Verzögerung", () => {
  test("MISTRAL_MOCK_DELAY_MS verzögert den Aufruf messbar", async () => {
    process.env.MISTRAL_MOCK_DELAY_MS = "60";
    const start = Date.now();
    await mock.describeImage(Buffer.from(""), "image/jpeg", null, "de");
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
