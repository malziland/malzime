/* Tests für mistral-mock.js — die Mistral-Attrappe für kostenlose Tests.
   Prüft Schnittstellen-Parität zu mistral.js: Rückgabe-Struktur, Sprach-
   Auswahl und das Fehlerverhalten über MISTRAL_MOCK_FAIL. */

const mock = require("../mistral-mock");

const lauf = (lang = "de") => mock.runSingleLargeCall(Buffer.from(""), "image/jpeg", null, lang);

beforeEach(() => {
  /* Verzögerung in Tests auf 0 — keine echte Wartezeit. */
  process.env.MISTRAL_MOCK_DELAY_MS = "0";
  delete process.env.MISTRAL_MOCK_FAIL;
});

afterAll(() => {
  delete process.env.MISTRAL_MOCK_DELAY_MS;
  delete process.env.MISTRAL_MOCK_FAIL;
});

/* ── Schnittstelle ────────────────────────────────────────────── */

describe("Schnittstelle", () => {
  test("bietet genau die Aufrufe, die der Analyseweg braucht", () => {
    expect(typeof mock.runSingleLargeCall).toBe("function");
    expect(typeof mock.isRateLimitError).toBe("function");
    /* Die Attrappe des ausgebauten Drei-Aufruf-Wegs (10.09.2026) darf nicht
       zurueckkehren — sonst liefe ein Test still ueber einen Weg, den es im
       Betrieb nicht mehr gibt. */
    expect(mock.describeImage).toBeUndefined();
    expect(mock.generateBothProfiles).toBeUndefined();
  });
});

/* ── runSingleLargeCall ───────────────────────────────────────── */

describe("runSingleLargeCall", () => {
  test("liefert strukturell gültige normal- und boost-Profile", async () => {
    const { normal, boost, subject } = await lauf();
    expect(subject).toBe("HUMAN");
    for (const profile of [normal, boost]) {
      expect(Object.keys(profile.categories).length).toBeGreaterThan(0);
      expect(Array.isArray(profile.ad_targeting)).toBe(true);
      expect(Array.isArray(profile.manipulation_triggers)).toBe(true);
      expect(typeof profile.profileText).toBe("string");
    }
  });

  test("jede Kategorie hat label, value und confidence", async () => {
    const { normal } = await lauf();
    for (const cat of Object.values(normal.categories)) {
      expect(typeof cat.label).toBe("string");
      expect(typeof cat.value).toBe("string");
      expect(typeof cat.confidence).toBe("number");
    }
  });

  test("normal- und boost-Profil unterscheiden sich im profileText", async () => {
    const { normal, boost } = await lauf();
    expect(normal.profileText).not.toBe(boost.profileText);
  });

  test("Profile sind als Mock erkennbar markiert", async () => {
    const { normal } = await lauf();
    expect(normal.profileText).toContain("[MOCK-PROFIL]");
  });

  test("englische Profile nutzen englische Labels", async () => {
    const { normal } = await lauf("en");
    expect(normal.categories.alter_geschlecht.label).toBe("Age & Gender");
  });
});

/* ── Fehlerverhalten ──────────────────────────────────────────── */

describe("MISTRAL_MOCK_FAIL", () => {
  test("api_error wirft einen api_error", async () => {
    process.env.MISTRAL_MOCK_FAIL = "api_error";
    await expect(lauf()).rejects.toMatchObject({ code: "api_error" });
  });

  test("leer liefert kein Profil — wie die echte Funktion ohne auswertbare Antwort", async () => {
    process.env.MISTRAL_MOCK_FAIL = "leer";
    const r = await lauf();
    expect(r.normal).toBeNull();
    expect(r.boost).toBeNull();
  });

  test("rate_limit wirft einen rate_limit-Fehler", async () => {
    process.env.MISTRAL_MOCK_FAIL = "rate_limit";
    await expect(lauf()).rejects.toMatchObject({ code: "rate_limit" });
  });

  test("ein unbekannter Wert bricht laut ab, statt still zu gelingen", async () => {
    /* Die Werte des ausgebauten Drei-Aufruf-Wegs zuerst: Ein Test, der sie
       noch setzt, soll sofort auffallen und nicht gruen durchlaufen. */
    for (const wert of ["describe", "describe-empty", "profiles", "Tippfehler"]) {
      process.env.MISTRAL_MOCK_FAIL = wert;
      await expect(lauf()).rejects.toThrow(/MISTRAL_MOCK_FAIL/);
    }
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
    await lauf();
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
