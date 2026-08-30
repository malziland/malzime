/* Tests for notify.js — ntfy push notification with HMAC tokens */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { notifyLimitReached } = require("../notify");

describe("notifyLimitReached", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends notification with correct payload", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "test-topic",
      adminSecret: "secret123",
      count: 1000,
      limit: 1000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ntfy.example.com");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.topic).toBe("test-topic");
    expect(body.title).toContain("Stundenlimit");
    expect(body.message).toContain("1000/1000");
    expect(body.priority).toBe(4);
    expect(body.tags).toEqual(["warning"]);
    expect(body.actions).toHaveLength(3);
    expect(body.actions[0].label).toBe("+100 Analysen");
    expect(body.actions[0].action).toBe("view");
    expect(body.actions[1].label).toBe("Reset");
    expect(body.actions[2].label).toBe("Stats");
    expect(body.actions[2].url).toContain("/stats");
  });

  test("uses HMAC tokens instead of static secret in URLs", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "topic",
      adminSecret: "my-secret",
      count: 500,
      limit: 500,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    /* URLs enthalten ?hmac= statt ?token= */
    expect(body.actions[0].url).toContain("/api/admin/boost?hmac=");
    expect(body.actions[0].url).not.toContain("?token=");
    expect(body.actions[1].url).toContain("/api/admin/reset?hmac=");
    expect(body.actions[1].url).not.toContain("?token=");
    /* Static secret darf NICHT in der URL stehen */
    expect(body.actions[0].url).not.toContain("my-secret");
    expect(body.actions[1].url).not.toContain("my-secret");
  });

  test("HMAC token has correct format (expires.signature)", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "topic",
      adminSecret: "sec",
      count: 500,
      limit: 500,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const boostUrl = new URL(body.actions[0].url);
    const hmacParam = boostUrl.searchParams.get("hmac");
    expect(hmacParam).toMatch(/^\d+\.[a-f0-9]{64}$/);
  });

  test("uses base URL from domains.js, not hardcoded", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "topic",
      adminSecret: "secret",
      count: 500,
      limit: 500,
    });

    const { SITE_URL } = require("../domains");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.actions[0].url).toMatch(new RegExp("^" + SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(body.actions[1].url).toMatch(new RegExp("^" + SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(body.actions[2].url).toMatch(new RegExp("^" + SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("does nothing when ntfyUrl is empty", async () => {
    await notifyLimitReached({
      ntfyUrl: "",
      ntfyTopic: "topic",
      adminSecret: "secret",
      count: 1000,
      limit: 1000,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does nothing when ntfyTopic is empty", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "",
      adminSecret: "secret",
      count: 1000,
      limit: 1000,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("logs warning on non-ok response", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 502, text: jest.fn().mockResolvedValue("Bad Gateway") });
    const logSpy = jest.spyOn(console, "log").mockImplementation();
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "topic",
      adminSecret: "secret",
      count: 500,
      limit: 500,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ntfy-failed"));
    logSpy.mockRestore();
  });

  test("includes AbortSignal in fetch request (BUG-003)", async () => {
    await notifyLimitReached({
      ntfyUrl: "https://ntfy.example.com",
      ntfyTopic: "topic",
      adminSecret: "secret",
      count: 500,
      limit: 500,
    });
    const opts = fetchSpy.mock.calls[0][1];
    expect(opts.signal).toBeDefined();
    expect(typeof opts.signal.aborted).toBe("boolean");
  });

  test("does not throw on fetch error", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    await expect(
      notifyLimitReached({
        ntfyUrl: "https://ntfy.example.com",
        ntfyTopic: "topic",
        adminSecret: "secret",
        count: 1000,
        limit: 1000,
      })
    ).resolves.toBeUndefined();
  });
});
