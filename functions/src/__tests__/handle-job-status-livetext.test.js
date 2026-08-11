/* Tests fuer die Live-Text-Auslieferung (v3.0 Phase 1) in handle-job-status.js.

   Bei `processing` gibt der Endpoint zusaetzlich `liveText`/`liveTextStand`
   aus dem Job-Dokument zurueck — aber NUR gegen das PRIV-003-Abhol-Ticket:
   Der Live-Text ist ein Vorgriff auf das `result`, und das ist seit dem
   Audit 2026-06 an genau dieses Ticket gebunden. Ohne Live-Felder (Flag aus)
   muss die Antwort byte-gleich zu heute sein — das sichert der exakte
   toEqual-Vergleich. */

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  markFailedIfStale: jest.fn(),
  touchJob: jest.fn(),
  markDelivered: jest.fn(),
}));

const { handleJobStatus } = require("../handle-job-status");
const { QUEUE_AVG_JOB_SECONDS } = require("../config");
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

const reqMit = (jobId, token) => ({ method: "GET", query: token === undefined ? { jobId } : { jobId, token } });

const PROCESSING_JOB = {
  id: "job-1",
  status: "processing",
  resultToken: "ticket-abc",
  liveText: "Du bist neugierig und",
  liveTextStand: 1754900000000,
};

/* Ab Phase 3 kann der Worker zusaetzlich den Beast-Text abgelegt haben. */
const PROCESSING_JOB_MIT_BEAST = { ...PROCESSING_JOB, liveTextBeast: "Du bist ein zynisches" };

beforeEach(() => {
  jest.clearAllMocks();
  jobs.markFailedIfStale.mockImplementation(async (job) => job);
  jobs.touchJob.mockResolvedValue();
  jobs.markDelivered.mockResolvedValue();
});

describe("handleJobStatus — Live-Text bei processing", () => {
  test("mit richtigem Ticket kommen liveText und liveTextStand mit", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("processing");
    expect(res.body.liveText).toBe("Du bist neugierig und");
    expect(res.body.liveTextStand).toBe(1754900000000);
  });

  test("mit richtigem Ticket kommt auch liveTextBeast mit, sobald der Worker es abgelegt hat", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB_MIT_BEAST);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    expect(res.body.status).toBe("processing");
    expect(res.body.liveText).toBe("Du bist neugierig und");
    expect(res.body.liveTextBeast).toBe("Du bist ein zynisches");
  });

  test("solange das Dokument keinen Beast-Text traegt, fehlt liveTextBeast in der Antwort", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    expect(res.body.liveText).toBe("Du bist neugierig und");
    expect(res.body).not.toHaveProperty("liveTextBeast");
  });

  test("ohne Ticket KEIN liveText (PRIV-003: Vorgriff aufs Ergebnis bleibt ticket-gebunden)", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1"), res);
    expect(res.body.status).toBe("processing");
    expect(res.body).not.toHaveProperty("liveText");
    expect(res.body).not.toHaveProperty("liveTextStand");
  });

  test("mit falschem Ticket KEIN liveText und KEIN liveTextBeast (gleiche Ticket-Bindung)", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB_MIT_BEAST);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "falsch"), res);
    expect(res.body.status).toBe("processing");
    expect(res.body).not.toHaveProperty("liveText");
    expect(res.body).not.toHaveProperty("liveTextBeast");
  });

  test("ohne Ticket KEIN liveTextBeast (dieselbe PRIV-003-Bindung wie liveText)", async () => {
    jobs.getJob.mockResolvedValue(PROCESSING_JOB_MIT_BEAST);
    const res = makeRes();
    await handleJobStatus(reqMit("job-1"), res);
    expect(res.body.status).toBe("processing");
    expect(res.body).not.toHaveProperty("liveTextBeast");
  });

  test("fehlender liveTextStand wird als null mitgegeben, nicht als undefined", async () => {
    jobs.getJob.mockResolvedValue({ ...PROCESSING_JOB, liveTextStand: undefined });
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    expect(res.body.liveText).toBe("Du bist neugierig und");
    expect(res.body.liveTextStand).toBeNull();
  });

  test("ohne liveText im Dokument (Flag aus) ist die processing-Antwort exakt die heutige", async () => {
    jobs.getJob.mockResolvedValue({ id: "job-1", status: "processing", resultToken: "ticket-abc" });
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    /* toEqual mit dem VOLLEN Objekt: kein zusaetzliches Feld, nichts fehlt —
       das ist die „ohne Flag aendert sich nichts"-Garantie des Endpoints. */
    expect(res.body).toEqual({ status: "processing", position: 0, etaSeconds: QUEUE_AVG_JOB_SECONDS });
  });
});

describe("handleJobStatus — done-Antwort bleibt unveraendert", () => {
  test("auch wenn das Dokument noch liveText-Felder traegt, liefert done nur result", async () => {
    jobs.getJob.mockResolvedValue({
      id: "job-1",
      status: "done",
      result: { profiles: { normal: {}, boost: {} } },
      resultToken: "ticket-abc",
      deliveredAt: 123 /* schon ausgeliefert → kein markDelivered-Log-Zweig */,
      liveText: "Du bist neugierig und",
      liveTextBeast: "Du bist ein zynisches",
      liveTextStand: 1754900000000,
    });
    const res = makeRes();
    await handleJobStatus(reqMit("job-1", "ticket-abc"), res);
    expect(res.body).toEqual({ status: "done", result: { profiles: { normal: {}, boost: {} } } });
    expect(res.body).not.toHaveProperty("liveText");
    expect(res.body).not.toHaveProperty("liveTextBeast");
  });
});
