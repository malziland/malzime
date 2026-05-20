const { handleStats } = require("../handle-stats");

jest.mock("../counter");
jest.mock("../feature-flags");
const { getStats, getMaintenanceStatus } = require("../counter");
const { isQueueEnabled } = require("../feature-flags");

function mockReq(method = "GET") {
  return { method };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = jest.fn();
  return res;
}

describe("handleStats", () => {
  beforeEach(() => isQueueEnabled.mockResolvedValue(false));
  afterEach(() => jest.restoreAllMocks());

  test("returns 405 for POST", async () => {
    const res = mockRes();
    await handleStats(mockReq("POST"), res);
    expect(res.statusCode).toBe(405);
    expect(res.json).toHaveBeenCalledWith({ error: "Method not allowed" });
  });

  test("returns 405 for DELETE", async () => {
    const res = mockRes();
    await handleStats(mockReq("DELETE"), res);
    expect(res.statusCode).toBe(405);
  });

  test("returns 503 when getStats returns null", async () => {
    getStats.mockResolvedValue(null);
    getMaintenanceStatus.mockResolvedValue(false);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.statusCode).toBe(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Stats unavailable" });
  });

  test("returns stats with maintenance flag on success", async () => {
    const statsData = {
      current: { count: 10, limit: 500 },
      totals: { today: 10, week: 50, month: 200, total: 1000 },
    };
    getStats.mockResolvedValue(statsData);
    getMaintenanceStatus.mockResolvedValue(false);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({ ...statsData, maintenance: false, useQueue: false });
  });

  test("includes maintenance: true when maintenance is active", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(true);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ maintenance: true }));
  });

  test("reicht das useQueue-Feature-Flag durch", async () => {
    getStats.mockResolvedValue({ current: { count: 0 } });
    getMaintenanceStatus.mockResolvedValue(false);
    isQueueEnabled.mockResolvedValue(true);
    const res = mockRes();
    await handleStats(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ useQueue: true }));
  });
});
