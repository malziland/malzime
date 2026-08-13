/* Tests for admin handler in index.js */

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
}));

const mockCreate = jest.fn().mockResolvedValue();
const mockDelete = jest.fn();
const mockCommit = jest.fn().mockResolvedValue();
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ create: mockCreate })),
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        })),
      })),
    })),
    batch: jest.fn(() => ({ delete: mockDelete, commit: mockCommit })),
  })),
  FieldValue: { serverTimestamp: jest.fn() },
}));

const TEST_SECRET = "test-admin-secret-xyz";

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => {
    const secret = () => {};
    secret.value = () => {
      if (name === "ADMIN_SECRET") return TEST_SECRET;
      return "";
    };
    secret.name = name;
    return secret;
  }),
}));

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts, handler) => handler),
}));

const mockBoostLimit = jest.fn().mockResolvedValue();
const mockResetCounter = jest.fn().mockResolvedValue();
const mockGetStats = jest.fn().mockResolvedValue({
  current: { count: 100, limit: 500, limitActive: false, retryAfterSeconds: 0, hourlyTotal: 100 },
  totals: { today: 10, week: 50, month: 200, year: 500, allTime: 1000 },
});

const mockSetMaintenanceMode = jest.fn().mockResolvedValue();
const mockGetMaintenanceStatus = jest.fn().mockResolvedValue({ enabled: false, message: "" });

jest.mock("../counter", () => ({
  checkAndIncrement: jest.fn(),
  incrementTotals: jest.fn(),
  getStats: (...args) => mockGetStats(...args),
  boostLimit: (...args) => mockBoostLimit(...args),
  resetCounter: (...args) => mockResetCounter(...args),
  setMaintenanceMode: (...args) => mockSetMaintenanceMode(...args),
  getMaintenanceStatus: (...args) => mockGetMaintenanceStatus(...args),
  filterRecent: jest.fn(),
  calcRetrySeconds: jest.fn(),
}));

jest.mock("../notify", () => ({ notifyLimitReached: jest.fn() }));
jest.mock("../middleware", () => ({ checkRateLimit: jest.fn(), getClientIp: jest.fn() }));
jest.mock("../upload", () => ({ parseMultipart: jest.fn(), parseJsonBody: jest.fn() }));
jest.mock("../privacy", () => ({ buildPrivacyRisks: jest.fn(), extractVisibleText: jest.fn() }));
jest.mock("../mistral", () => ({
  describeImage: jest.fn(),
  generateBothProfiles: jest.fn(),
}));
jest.mock("../animal", () => ({
  classifyDescription: jest.fn(),
  buildAnimalProfiles: jest.fn(),
}));
jest.mock("../i18n", () => ({
  resolveLanguage: jest.fn(),
  loadPrompts: jest.fn(),
}));

const { createAdminToken, createNonce } = require("../auth");
const { admin } = require("../index");

function mockReq(overrides = {}) {
  return {
    method: "GET",
    headers: {},
    query: {},
    body: {},
    path: "/boost",
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    htmlBody: null,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (data) {
      this.body = data;
    }),
    type: jest.fn(function () {
      return this;
    }),
    send: jest.fn(function (html) {
      this.htmlBody = html;
    }),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue();
  mockBoostLimit.mockResolvedValue();
  mockResetCounter.mockResolvedValue();
  mockGetStats.mockResolvedValue({
    current: { count: 100, limit: 500, limitActive: false, retryAfterSeconds: 0, hourlyTotal: 100 },
    totals: { today: 10, week: 50, month: 200, year: 500, allTime: 1000 },
  });
  mockSetMaintenanceMode.mockResolvedValue();
  mockGetMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
});

describe("admin handler", () => {
  /* ── Auth ── */

  test("returns 403 without any auth", async () => {
    const req = mockReq({ path: "/boost" });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error).toBe("Forbidden");
  });

  test("returns 403 with invalid Bearer token", async () => {
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("returns 403 with expired HMAC token", async () => {
    const expired = createAdminToken("boost", TEST_SECRET, -1000);
    const req = mockReq({ path: "/boost", query: { hmac: expired } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("returns 403 with HMAC for wrong action", async () => {
    const token = createAdminToken("reset", TEST_SECRET);
    const req = mockReq({ path: "/boost", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  /* ── Boost with valid auth ── */

  test("boost with valid Bearer (POST) returns JSON", async () => {
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe("boost");
    expect(mockBoostLimit).toHaveBeenCalled();
  });

  test("boost with valid HMAC (GET) returns confirmation page, no mutation (SEC-001)", async () => {
    const token = createAdminToken("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.type).toHaveBeenCalledWith("html");
    expect(res.send).toHaveBeenCalled();
    expect(res.htmlBody).toContain("Bestaetigen");
    expect(res.htmlBody).toContain('<form method="POST"');
    expect(res.htmlBody).toContain('name="nonce"');
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  /* ── Reset with valid auth ── */

  test("reset with valid Bearer (POST) returns JSON", async () => {
    const req = mockReq({
      path: "/reset",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe("reset");
    expect(mockResetCounter).toHaveBeenCalled();
  });

  test("reset with valid HMAC (GET) returns confirmation page, no mutation (SEC-001)", async () => {
    const token = createAdminToken("reset", TEST_SECRET);
    const req = mockReq({ path: "/reset", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.type).toHaveBeenCalledWith("html");
    expect(res.send).toHaveBeenCalled();
    expect(res.htmlBody).toContain("Bestaetigen");
    expect(res.htmlBody).toContain('<form method="POST"');
    expect(mockResetCounter).not.toHaveBeenCalled();
  });

  /* ── Boost cap ── */

  test("boost amount is capped at 500", async () => {
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: { amount: 9999 },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockBoostLimit).toHaveBeenCalledWith(500);
  });

  test("boost default amount is 100", async () => {
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockBoostLimit).toHaveBeenCalledWith(100);
  });

  /* SEC-2026-08-13-D: Ein abgelehnter Boost darf nicht als Erfolg gemeldet
     werden — der Betreiber reagiert gerade auf einen Überlast-Alarm. */
  test("abgelehnter Boost (Obergrenze) → ok:false, nicht als Erfolg gemeldet", async () => {
    mockBoostLimit.mockResolvedValueOnce({ limit: 1000, abgelehnt: true });
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.body.ok).toBe(false);
    expect(res.body.abgelehnt).toBe(true);
  });

  test("abgelehnter Boost per Nonce → HTML sagt 'abgelehnt', nicht 'hinzugefuegt'", async () => {
    mockBoostLimit.mockResolvedValueOnce({ limit: 1000, abgelehnt: true });
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.htmlBody).toContain("abgelehnt");
    expect(res.htmlBody).not.toContain("hinzugefuegt");
  });

  /* ── SEC-001: Nonce-based POST executes mutation ── */

  test("boost with valid nonce (POST) executes mutation and returns HTML", async () => {
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(mockBoostLimit).toHaveBeenCalledWith(100);
    expect(res.type).toHaveBeenCalledWith("html");
    expect(res.htmlBody).toContain("Boost");
    expect(res.htmlBody).not.toContain("Bestaetigen");
  });

  test("reset with valid nonce (POST) executes mutation and returns HTML", async () => {
    const nonce = createNonce("reset", TEST_SECRET);
    const req = mockReq({ path: "/reset", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(mockResetCounter).toHaveBeenCalled();
    expect(res.type).toHaveBeenCalledWith("html");
    expect(res.htmlBody).toContain("Reset");
  });

  test("expired nonce returns 403", async () => {
    const nonce = createNonce("boost", TEST_SECRET);
    /* Manipulate nonce to be expired: replace timestamp with past value */
    const expiredNonce = `${Date.now() - 1000}.${nonce.split(".")[1]}`;
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce: expiredNonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  test("nonce for wrong action returns 403", async () => {
    const nonce = createNonce("reset", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  test("nonce via GET is rejected (only POST allowed)", async () => {
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "GET", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  /* ── SEC-001: HMAC+POST must be rejected ── */

  test("HMAC+POST without nonce returns 403, no mutation (SEC-001)", async () => {
    const token = createAdminToken("boost", TEST_SECRET);
    const req = mockReq({ path: "/api/admin/boost", method: "POST", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  test("HMAC+POST reset without nonce returns 403 (SEC-001)", async () => {
    const token = createAdminToken("reset", TEST_SECRET);
    const req = mockReq({ path: "/api/admin/reset", method: "POST", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockResetCounter).not.toHaveBeenCalled();
  });

  /* ── BUG-001: Confirm page form action must use /api/admin/ prefix ── */

  test("confirm page form action contains /api/admin/ prefix (BUG-001)", async () => {
    const token = createAdminToken("boost", TEST_SECRET);
    const req = mockReq({ path: "/api/admin/boost", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.htmlBody).toContain('action="/api/admin/boost"');
  });

  test("reset confirm page form action contains /api/admin/ prefix (BUG-001)", async () => {
    const token = createAdminToken("reset", TEST_SECRET);
    const req = mockReq({ path: "/api/admin/reset", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.htmlBody).toContain('action="/api/admin/reset"');
  });

  /* ── SEC-002: HMAC ignores amount ── */

  test("Nonce boost always uses 100, ignores body amount (SEC-002)", async () => {
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce, amount: 999 } });
    const res = mockRes();
    await admin(req, res);
    expect(mockBoostLimit).toHaveBeenCalledWith(100);
  });

  test("Bearer boost accepts custom amount from body", async () => {
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: { amount: 200 },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockBoostLimit).toHaveBeenCalledWith(200);
  });

  /* ── Unknown action ── */

  test("returns 404 for unknown action", async () => {
    const req = mockReq({
      path: "/unknown",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  /* ── HTML escaping ── */

  test("HTML in boost success page is escaped", async () => {
    mockGetStats.mockResolvedValue({
      current: { count: 100, limit: 600, limitActive: false, retryAfterSeconds: 0, hourlyTotal: 100 },
      totals: { today: 10, week: 50, month: 200, year: 500, allTime: 1000 },
    });
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.htmlBody).not.toContain("<script>");
    expect(res.htmlBody).toContain("Boost");
  });

  /* ── Error handling ── */

  test("returns 500 on internal error", async () => {
    mockBoostLimit.mockRejectedValue(new Error("DB failure"));
    const req = mockReq({
      path: "/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  /* ── Path variations ── */

  test("handles /api/admin/boost path", async () => {
    const req = mockReq({
      path: "/api/admin/boost",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe("boost");
  });

  test("handles /api/admin/reset path", async () => {
    const req = mockReq({
      path: "/api/admin/reset",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe("reset");
  });

  /* ── SEC-002: Nonce-Replay-Schutz ── */

  test("replayed nonce returns 403 (SEC-002)", async () => {
    mockCreate.mockRejectedValue({ code: 6 }); // ALREADY_EXISTS
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error).toBe("Nonce already used");
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  test("nonce consumption Firestore error fails closed: 403, no mutation (v3.0.4)", async () => {
    mockCreate.mockRejectedValue(new Error("Firestore unavailable"));
    const nonce = createNonce("boost", TEST_SECRET);
    const req = mockReq({ path: "/boost", method: "POST", body: { nonce } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockBoostLimit).not.toHaveBeenCalled();
  });

  /* ── Maintenance (Kill-Switch) ── */

  test("maintenance enable with Bearer auth", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Test" });
    const req = mockReq({
      path: "/api/admin/maintenance",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: { enabled: true, message: "Test" },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockSetMaintenanceMode).toHaveBeenCalledWith(true, "Test");
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe("maintenance");
    expect(res.body.maintenance.enabled).toBe(true);
  });

  test("maintenance disable with Bearer auth", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
    const req = mockReq({
      path: "/api/admin/maintenance",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: { enabled: false },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockSetMaintenanceMode).toHaveBeenCalledWith(false, "");
    expect(res.body.maintenance.enabled).toBe(false);
  });

  test("maintenance rejects HMAC auth (Bearer only)", async () => {
    const token = createAdminToken("maintenance", TEST_SECRET);
    const req = mockReq({ path: "/api/admin/maintenance", query: { hmac: token } });
    const res = mockRes();
    await admin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSetMaintenanceMode).not.toHaveBeenCalled();
  });

  test("maintenance defaults to enabled:true when body.enabled omitted", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true, message: "" });
    const req = mockReq({
      path: "/api/admin/maintenance",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockSetMaintenanceMode).toHaveBeenCalledWith(true, "");
  });

  test("maintenance truncates message to 500 chars", async () => {
    const longMsg = "A".repeat(1000);
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true, message: longMsg.slice(0, 500) });
    const req = mockReq({
      path: "/api/admin/maintenance",
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: { enabled: true, message: longMsg },
    });
    const res = mockRes();
    await admin(req, res);
    expect(mockSetMaintenanceMode).toHaveBeenCalledWith(true, "A".repeat(500));
  });
});
