import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

/* KA-02 (Kurzaudit 2026-08-12): das Einmal-Ticket des Realitäts-Checks im
   Frontend — Speicher-Modul, Mitsenden im Telemetrie-Logger und die
   Verdrahtung in api.js (merken bei done, räumen bei neuem Auftrag). */

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

vi.mock("../js/exif.js", () => ({
  prepareImage: vi.fn().mockResolvedValue({
    imageBase64: "QUFB",
    exif: { make: "Apple", model: "iPhone" },
    gps: null,
    dateTimeOriginal: null,
  }),
}));

vi.mock("../js/geocoding.js", () => ({
  startGeocoding: vi.fn(),
}));

vi.mock("../js/render.js", () => ({
  renderCurrentMode: vi.fn(),
  /* FEATURE-2026-08-29-01: Karten waehrend der Analyse. */
  zeigeLiveKarten: vi.fn(),
  liveKartenZuruecksetzen: vi.fn(),
  liveKartenModusWechsel: vi.fn(),
  zeigeVersteckteDatenUndKarte: vi.fn(),
}));

const RC_TICKET_KEY = "malzime.queueRcTicket";

const DONE_RESULT = {
  profiles: { normal: { categories: { a: {} }, ad_targeting: [], manipulation_triggers: [], profileText: "T" } },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
};

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    clone() {
      return this;
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/* ── 1. Das Speicher-Modul selbst ──────────────────────────────────────── */

describe("rc-ticket.js — Speichern, Lesen, Löschen", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("speichert und liest ein Ticket", async () => {
    const mod = await import("../js/rc-ticket.js");
    mod.speichereRcTicket("ticket-123");
    expect(mod.leseRcTicket()).toBe("ticket-123");
    expect(sessionStorage.getItem(RC_TICKET_KEY)).toBe("ticket-123");
  });

  it("löscht das Ticket wieder", async () => {
    const mod = await import("../js/rc-ticket.js");
    mod.speichereRcTicket("ticket-123");
    mod.loescheRcTicket();
    expect(mod.leseRcTicket()).toBeNull();
  });

  it("ignoriert Nicht-Strings und Leerstrings beim Speichern", async () => {
    const mod = await import("../js/rc-ticket.js");
    mod.speichereRcTicket("");
    mod.speichereRcTicket(null);
    mod.speichereRcTicket(42);
    expect(mod.leseRcTicket()).toBeNull();
  });
});

/* ── 2. telemetry-logger: Ticket geht mit — und NUR das ────────────────── */

describe("logRealitaetsCheck — Ticket im Ereignis", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("mit gemerktem Ticket: Body trägt eventType, stufen und ticket — sonst nichts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
    const { speichereRcTicket } = await import("../js/rc-ticket.js");
    const { logRealitaetsCheck } = await import("../js/telemetry-logger.js");
    speichereRcTicket("ticket-abc");
    logRealitaetsCheck({ alter: 1, interessen: 0.5 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      eventType: "realitaets-check",
      stufen: { alter: 1, interessen: 0.5 },
      ticket: "ticket-abc",
    });
  });

  it("ohne Ticket: Body exakt wie vor KA-02 (kein ticket-Feld)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
    const { logRealitaetsCheck } = await import("../js/telemetry-logger.js");
    logRealitaetsCheck({ alter: 1 });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ eventType: "realitaets-check", stufen: { alter: 1 } });
    expect("ticket" in body).toBe(false);
  });
});

/* ── 3. api.js-Verdrahtung: merken bei done, räumen bei neuem Auftrag ──── */

describe("api.js — rcTicket-Verdrahtung", () => {
  let analyzeImage, clearStoredJobId, state;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10000);
    sessionStorage.clear();

    const apiMod = await import("../js/api.js");
    const stateMod = await import("../js/state.js");
    analyzeImage = apiMod.analyzeImage;
    clearStoredJobId = apiMod.clearStoredJobId;
    state = stateMod.state;

    state.isAnalyzing = false;
    state.requestId = 0;
    state.lastPrepared = null;
    state.lastData = null;
    state.lastFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("done-Antwort MIT rcTicket → das Ticket liegt im sessionStorage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      if (String(url).includes("job-status")) {
        return jsonResponse({ status: "done", result: DONE_RESULT, rcTicket: "server-ticket-1" });
      }
      return jsonResponse({ ok: true });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(sessionStorage.getItem(RC_TICKET_KEY)).toBe("server-ticket-1");
  });

  it("done-Antwort OHNE rcTicket (Wiederholungs-Abruf): nichts wird gespeichert", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-1" });
      if (String(url).includes("job-status")) return jsonResponse({ status: "done", result: DONE_RESULT });
      return jsonResponse({ ok: true });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(sessionStorage.getItem(RC_TICKET_KEY)).toBeNull();
  });

  it("neuer Analyse-Auftrag räumt das alte Ticket weg (storeJobId-Pfad)", async () => {
    sessionStorage.setItem(RC_TICKET_KEY, "altes-ticket");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/enqueue")) return jsonResponse({ jobId: "job-2" });
      if (String(url).includes("job-status")) return jsonResponse({ status: "done", result: DONE_RESULT });
      return jsonResponse({ ok: true });
    });
    const p = analyzeImage();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    /* Das alte Ticket ist weg; ein neues kam in dieser Antwort nicht. */
    expect(sessionStorage.getItem(RC_TICKET_KEY)).toBeNull();
  });

  it("clearStoredJobId räumt auch das Ticket", async () => {
    sessionStorage.setItem(RC_TICKET_KEY, "ticket-xyz");
    clearStoredJobId();
    expect(sessionStorage.getItem(RC_TICKET_KEY)).toBeNull();
  });
});
