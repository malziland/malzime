/* Tests für handle-job-status.js — Polling-Endpoint der Queue-Architektur. */

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  markFailedIfStale: jest.fn(),
  touchJob: jest.fn(),
  markDelivered: jest.fn(),
}));

const { handleJobStatus } = require("../handle-job-status");
const jobs = require("../jobs");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const getReq = (jobId) => ({ method: "GET", query: jobId === undefined ? {} : { jobId } });

beforeEach(() => {
  jest.clearAllMocks();
  jobs.markFailedIfStale.mockImplementation(async (job) => job);
  jobs.touchJob.mockResolvedValue();
  jobs.markDelivered.mockResolvedValue();
});

/* ── Abweisungen ─────────────────────────────────────────────────── */

describe("handleJobStatus — Abweisungen", () => {
  test("nicht-GET → 405", async () => {
    const res = makeRes();
    await handleJobStatus({ method: "POST", query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  test("fehlende jobId → 400", async () => {
    const res = makeRes();
    await handleJobStatus(getReq(undefined), res);
    expect(res.statusCode).toBe(400);
  });

  test("nicht existierender Job → 404", async () => {
    jobs.getJob.mockResolvedValue(null);
    const res = makeRes();
    await handleJobStatus(getReq("job-x"), res);
    expect(res.statusCode).toBe(404);
  });
});

/* ── Status-Antworten ────────────────────────────────────────────── */

describe("handleJobStatus — Status-Antworten", () => {
  test("queued → Status, Position und ETA", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "queued" });
    jobs.getQueuePosition.mockResolvedValue(6);
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("queued");
    expect(res.body.position).toBe(6);
    expect(res.body.etaSeconds).toBeGreaterThan(0);
    /* Der Poll ist zugleich der Liveness-Herzschlag. */
    expect(jobs.touchJob).toHaveBeenCalledWith("job-1");
  });

  test("Position 0 → ETA 0", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "queued" });
    jobs.getQueuePosition.mockResolvedValue(0);
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.etaSeconds).toBe(0);
  });

  test("processing → Status processing, kein Ergebnis", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "processing" });
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.status).toBe("processing");
    expect(res.body.etaSeconds).toBeGreaterThan(0);
  });

  test("done → Status done samt Ergebnis (mit Abhol-Ticket)", async () => {
    const result = { profiles: { normal: {}, boost: {} }, meta: { mode: "multimodal" } };
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "done", result, resultToken: "ticket-abc" });
    const res = makeRes();
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, res);
    expect(res.body.status).toBe("done");
    expect(res.body.result).toEqual(result);
  });

  test("failed → Status failed samt Fehlergrund", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "failed", errorReason: "enqueue_failed" });
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.status).toBe("failed");
    expect(res.body.errorReason).toBe("enqueue_failed");
  });

  test("abandoned → Status abandoned (Client hatte die Seite verlassen)", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "abandoned" });
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.status).toBe("abandoned");
  });

  test("ein done-Job löst keinen Heartbeat aus — nur wartende Jobs zählen", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "done", result: {} });
    await handleJobStatus(getReq("job-1"), makeRes());
    expect(jobs.touchJob).not.toHaveBeenCalled();
  });
});

/* ── Stale-Timeout ───────────────────────────────────────────────── */

describe("handleJobStatus — Stale-Timeout", () => {
  test("ein hängender processing-Job wird beim Pollen auf failed gekippt", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "processing" });
    jobs.markFailedIfStale.mockResolvedValue({
      id: "job-1",
      status: "failed",
      errorReason: "processing_timeout",
    });
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(jobs.markFailedIfStale).toHaveBeenCalled();
    expect(res.body.status).toBe("failed");
    expect(res.body.errorReason).toBe("processing_timeout");
  });
});

/* ── Auslieferungs-Messung ───────────────────────────────────────── */

describe("handleJobStatus — Auslieferungs-Messung", () => {
  test("erstes Ausliefern eines done-Jobs → markDelivered + job-delivered-Log", async () => {
    jobs.getJob.mockResolvedValue({
      id: "job-1",
      status: "done",
      result: {},
      resultToken: "ticket-abc",
      traceId: "trace1",
      createdAt: 1000,
      finishedAt: 5000,
    });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, makeRes());
    /* KA-02: Mit der Erstauslieferung wird der HASH des Realitäts-Check-
       Einmal-Tickets abgelegt (64 Hex-Zeichen = SHA-256, nie das Ticket). */
    expect(jobs.markDelivered).toHaveBeenCalledWith("job-1", expect.stringMatching(/^[0-9a-f]{64}$/));
    const delivered = logSpy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(c[0]);
        } catch (_) {
          return null;
        }
      })
      .find((o) => o && o.step === "job-delivered");
    logSpy.mockRestore();
    expect(delivered).toBeTruthy();
    expect(delivered.jobId).toBe("job-1");
    expect(typeof delivered.deliveryGapMs).toBe("number");
    expect(typeof delivered.totalMs).toBe("number");
  });

  test("bereits ausgelieferter Job → kein erneutes markDelivered", async () => {
    jobs.getJob.mockResolvedValue({
      id: "job-1",
      status: "done",
      result: {},
      resultToken: "ticket-abc",
      deliveredAt: 9999,
    });
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, makeRes());
    expect(jobs.markDelivered).not.toHaveBeenCalled();
  });
});

/* ── KA-02 (Kurzaudit 2026-08-12): Realitäts-Check-Einmal-Ticket ── */

describe("handleJobStatus — KA-02 Realitäts-Check-Ticket", () => {
  const doneJob = (extra = {}) => ({
    id: "job-1",
    status: "done",
    result: { x: 1 },
    resultToken: "ticket-abc",
    createdAt: 1000,
    finishedAt: 5000,
    ...extra,
  });

  test("Erstauslieferung: Antwort trägt rcTicket, im Job landet exakt dessen SHA-256-Hash", async () => {
    jobs.getJob.mockResolvedValue(doneJob());
    const res = makeRes();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, res);
    logSpy.mockRestore();
    expect(typeof res.body.rcTicket).toBe("string");
    expect(res.body.rcTicket.length).toBeGreaterThan(0);
    const { sha256Hex } = require("../auth");
    expect(jobs.markDelivered).toHaveBeenCalledWith("job-1", sha256Hex(res.body.rcTicket));
  });

  test("wiederholter Abruf (deliveredAt gesetzt): KEIN neues rcTicket — es gibt genau eins je Analyse", async () => {
    jobs.getJob.mockResolvedValue(doneJob({ deliveredAt: 9999 }));
    const res = makeRes();
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, res);
    expect(res.body.status).toBe("done");
    expect(res.body.rcTicket).toBeUndefined();
  });

  test("falsches Abhol-Ticket: weder Ergebnis noch rcTicket — dieselbe PRIV-003-Schranke", async () => {
    jobs.getJob.mockResolvedValue(doneJob());
    const res = makeRes();
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "falsch" } }, res);
    expect(res.body.result).toBeNull();
    expect(res.body.rcTicket).toBeUndefined();
    expect(jobs.markDelivered).not.toHaveBeenCalled();
  });
});

/* ── PRIV-003: Abhol-Ticket (resultToken) ───────────────────────── */

describe("handleJobStatus — PRIV-003 Abhol-Ticket", () => {
  const doneJob = (extra = {}) => ({
    id: "job-1",
    status: "done",
    result: { profileText: "geheim" },
    resultToken: "ticket-abc",
    createdAt: 1000,
    finishedAt: 5000,
    ...extra,
  });

  test("richtiges Ticket → Ergebnis wird zurückgegeben", async () => {
    jobs.getJob.mockResolvedValue(doneJob());
    const res = makeRes();
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "ticket-abc" } }, res);
    expect(res.body.status).toBe("done");
    expect(res.body.result).toEqual({ profileText: "geheim" });
  });

  test("falsches Ticket → KEIN Ergebnis (tokenRequired), kein markDelivered", async () => {
    jobs.getJob.mockResolvedValue(doneJob());
    const res = makeRes();
    await handleJobStatus({ method: "GET", query: { jobId: "job-1", token: "falsch" } }, res);
    expect(res.body.status).toBe("done");
    expect(res.body.result).toBeNull();
    expect(res.body.tokenRequired).toBe(true);
    expect(jobs.markDelivered).not.toHaveBeenCalled();
  });

  test("fehlendes Ticket → KEIN Ergebnis", async () => {
    jobs.getJob.mockResolvedValue(doneJob());
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.result).toBeNull();
    expect(res.body.tokenRequired).toBe(true);
  });

  test("Job ohne resultToken (darf nicht vorkommen) → wird NIE ausgeliefert", async () => {
    /* createJob setzt das Ticket unkonditional; der frühere Abwärts-
       kompatibilitäts-Zweig (Alt-Jobs offen ausliefern) ist entfernt —
       fail-closed statt leise offen. */
    jobs.getJob.mockResolvedValue(doneJob({ resultToken: null }));
    const res = makeRes();
    await handleJobStatus(getReq("job-1"), res);
    expect(res.body.result).toBeNull();
    expect(res.body.tokenRequired).toBe(true);
  });
});
