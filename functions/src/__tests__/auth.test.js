/* Tests for auth.js — HMAC-based admin tokens */

const mockCreate = jest.fn().mockResolvedValue();
const mockDelete = jest.fn();
const mockCommit = jest.fn().mockResolvedValue();
const mockGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ create: mockCreate })),
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: mockGet,
        })),
      })),
    })),
    batch: jest.fn(() => ({ delete: mockDelete, commit: mockCommit })),
  })),
}));

const { SATZ } = require("../test-satz");
const {
  createAdminToken,
  verifyAdminToken,
  createNonce,
  verifyNonce,
  consumeNonce,
  cleanupNonces,
  safeCompare,
  NONCE_TTL_MS,
} = require("../auth");

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue();
  mockGet.mockResolvedValue({ empty: true, docs: [] });
});

describe("safeCompare (SEC-01)", () => {
  test("returns true for identical strings", () => {
    expect(safeCompare("admin-secret-xyz", "admin-secret-xyz")).toBe(true);
  });

  test("returns false for different strings of same length", () => {
    expect(safeCompare("admin-secret-xyz", "admin-secret-XYZ")).toBe(false);
  });

  test("returns false for strings of different length without throwing", () => {
    expect(safeCompare("short", "a-much-longer-secret")).toBe(false);
  });

  test("returns false for non-string input", () => {
    expect(safeCompare(undefined, "x")).toBe(false);
    expect(safeCompare("x", null)).toBe(false);
    expect(safeCompare(123, 123)).toBe(false);
  });

  test("handles empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
    expect(safeCompare("", "x")).toBe(false);
  });
});

describe("createAdminToken", () => {
  test("returns token in format expires.signature", () => {
    const token = createAdminToken("boost", "test-secret", SATZ.ticketGueltigkeitMs);
    expect(token).toMatch(/^\d+\.[a-f0-9]{64}$/);
  });

  test("token expires in the future", () => {
    const token = createAdminToken("boost", "test-secret", SATZ.ticketGueltigkeitMs);
    const expires = Number(token.split(".")[0]);
    expect(expires).toBeGreaterThan(Date.now());
  });

  test("different actions produce different signatures", () => {
    const t1 = createAdminToken("boost", "test-secret", SATZ.ticketGueltigkeitMs);
    const t2 = createAdminToken("reset", "test-secret", SATZ.ticketGueltigkeitMs);
    expect(t1.split(".")[1]).not.toBe(t2.split(".")[1]);
  });

  test("different secrets produce different signatures", () => {
    const t1 = createAdminToken("boost", "secret-a", SATZ.ticketGueltigkeitMs);
    const t2 = createAdminToken("boost", "secret-b", SATZ.ticketGueltigkeitMs);
    expect(t1.split(".")[1]).not.toBe(t2.split(".")[1]);
  });
});

describe("verifyAdminToken", () => {
  const SECRET = "test-secret-123";

  test("validates a valid token", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    expect(verifyAdminToken(token, "boost", SECRET)).toBe(true);
  });

  test("rejects expired token", () => {
    /* UMGESTELLT 30.08.2026: Frueher wurde das abgelaufene Token mit einer
       NEGATIVEN Gueltigkeitsdauer (-1000 ms) erzeugt. Das geht nicht mehr —
       createAdminToken verlangt eine positive Dauer, seit die Dauer ein
       Pflichtwert aus dem Einstellungssatz ist.

       Die Zusicherung bleibt unveraendert: Ein abgelaufenes Token wird
       abgelehnt. Nur der Weg dorthin ist jetzt der echte — die Uhr laeuft
       weiter, statt dass ein unmoeglicher Wert hineingereicht wird. */
    const echteZeit = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(echteZeit - 60 * 60 * 1000);
    const abgelaufen = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    Date.now.mockRestore();
    expect(verifyAdminToken(abgelaufen, "boost", SECRET)).toBe(false);
  });

  test("rejects token with wrong action", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    expect(verifyAdminToken(token, "reset", SECRET)).toBe(false);
  });

  test("rejects token with wrong secret", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    expect(verifyAdminToken(token, "boost", "wrong-secret")).toBe(false);
  });

  test("rejects null/undefined/empty token", () => {
    expect(verifyAdminToken(null, "boost", SECRET)).toBe(false);
    expect(verifyAdminToken(undefined, "boost", SECRET)).toBe(false);
    expect(verifyAdminToken("", "boost", SECRET)).toBe(false);
  });

  test("rejects malformed token without dot", () => {
    expect(verifyAdminToken("nodot", "boost", SECRET)).toBe(false);
  });

  test("rejects token with invalid expires", () => {
    expect(verifyAdminToken("notanumber.abc123", "boost", SECRET)).toBe(false);
  });

  test("rejects token with wrong signature length", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    const expires = token.split(".")[0];
    expect(verifyAdminToken(`${expires}.tooshort`, "boost", SECRET)).toBe(false);
  });

  test("rejects non-string input", () => {
    expect(verifyAdminToken(42, "boost", SECRET)).toBe(false);
    expect(verifyAdminToken({}, "boost", SECRET)).toBe(false);
  });
});

/* ── Nonce (SEC-001) ── */

describe("createNonce / verifyNonce", () => {
  const SECRET = "test-secret-123";

  test("creates a valid nonce that can be verified", () => {
    const nonce = createNonce("boost", SECRET);
    expect(verifyNonce(nonce, "boost", SECRET)).toBe(true);
  });

  test("nonce has shorter TTL than admin token", () => {
    expect(NONCE_TTL_MS).toBeLessThan(30 * 60 * 1000);
    expect(NONCE_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("nonce expires within 5 minutes", () => {
    const nonce = createNonce("boost", SECRET);
    const expires = Number(nonce.split(".")[0]);
    const diff = expires - Date.now();
    expect(diff).toBeLessThanOrEqual(NONCE_TTL_MS);
    expect(diff).toBeGreaterThan(0);
  });

  test("rejects nonce with wrong action", () => {
    const nonce = createNonce("boost", SECRET);
    expect(verifyNonce(nonce, "reset", SECRET)).toBe(false);
  });

  test("rejects nonce with wrong secret", () => {
    const nonce = createNonce("boost", SECRET);
    expect(verifyNonce(nonce, "boost", "wrong")).toBe(false);
  });
});

/* ── SEC-002: Nonce-Replay-Schutz ── */

describe("consumeNonce", () => {
  test("returns true on first use", async () => {
    expect(await consumeNonce("nonce-abc")).toBe(true);
    expect(mockCreate).toHaveBeenCalled();
  });

  test("returns false on replay (ALREADY_EXISTS)", async () => {
    mockCreate.mockRejectedValue({ code: 6 });
    expect(await consumeNonce("nonce-abc")).toBe(false);
  });

  test("fails closed on Firestore error (v3.0.4)", async () => {
    mockCreate.mockRejectedValue(new Error("DB down"));
    expect(await consumeNonce("nonce-abc")).toBe(false);
  });
});

describe("cleanupNonces", () => {
  test("does nothing when no expired nonces", async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    await cleanupNonces();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  test("deletes expired nonces in batch", async () => {
    const mockRef = { id: "abc" };
    mockGet.mockResolvedValue({ empty: false, docs: [{ ref: mockRef }] });
    await cleanupNonces();
    expect(mockDelete).toHaveBeenCalledWith(mockRef);
    expect(mockCommit).toHaveBeenCalled();
  });
});

/* SEC-2026-08-12-17: Token und Nonce trugen dieselbe Nutzlast und waren damit
   austauschbar. Der 30-Minuten-Token steht im Klartext in der ntfy-Mitteilung;
   wer ihn sah, konnte ihn im Nonce-Feld einsetzen und die Bestaetigungsseite
   (SEC-001) ueberspringen. */
describe("SEC-2026-08-12-17 — Token und Nonce sind nicht austauschbar", () => {
  const SECRET = "geheim-fuer-den-test";

  test("ein Admin-Token gilt NICHT als Nonce", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    expect(verifyAdminToken(token, "boost", SECRET)).toBe(true);
    expect(verifyNonce(token, "boost", SECRET)).toBe(false);
  });

  test("eine Nonce gilt NICHT als Admin-Token", () => {
    const nonce = createNonce("boost", SECRET);
    expect(verifyNonce(nonce, "boost", SECRET)).toBe(true);
    expect(verifyAdminToken(nonce, "boost", SECRET)).toBe(false);
  });

  test("die Action-Bindung gilt weiterhin fuer beide", () => {
    const token = createAdminToken("boost", SECRET, SATZ.ticketGueltigkeitMs);
    const nonce = createNonce("boost", SECRET);
    expect(verifyAdminToken(token, "reset", SECRET)).toBe(false);
    expect(verifyNonce(nonce, "reset", SECRET)).toBe(false);
  });
});
