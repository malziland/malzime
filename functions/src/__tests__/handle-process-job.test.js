/* Tests für handle-process-job.js — Worker der Queue-Architektur.
   Job-, Storage- und Counter-Module sind gemockt. Die Mistral-Pipeline läuft
   über den echten mistral-mock (MISTRAL_MOCK=1) — privacy.js und animal.js
   sind real, der Worker wird also als echte Integration getestet. */

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  claimJob: jest.fn(),
  completeJob: jest.fn(),
  isAbandoned: jest.fn(),
  abandonJob: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  loadImage: jest.fn(),
  deleteImage: jest.fn(),
}));
jest.mock("../counter", () => ({
  incrementTotals: jest.fn(() => Promise.resolve()),
}));

const { handleProcessJob } = require("../handle-process-job");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const counter = require("../counter");

const JOB = {
  id: "job-1",
  status: "queued",
  lang: "de",
  traceId: "trace1",
  imagePath: "queue-uploads/x.jpg",
  exif: {},
};

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

const postReq = (jobId) => ({ method: "POST", body: jobId === undefined ? {} : { jobId } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MISTRAL_MOCK = "1";
  process.env.MISTRAL_MOCK_DELAY_MS = "0";
  delete process.env.MISTRAL_MOCK_FAIL;
  jobs.getJob.mockResolvedValue(JOB);
  jobs.claimJob.mockResolvedValue(true);
  jobs.completeJob.mockResolvedValue();
  jobs.isAbandoned.mockReturnValue(false);
  jobs.abandonJob.mockResolvedValue();
  storage.loadImage.mockResolvedValue({ buffer: Buffer.from("img"), mimeType: "image/jpeg" });
  storage.deleteImage.mockResolvedValue();
});

afterAll(() => {
  delete process.env.MISTRAL_MOCK;
  delete process.env.MISTRAL_MOCK_DELAY_MS;
  delete process.env.MISTRAL_MOCK_FAIL;
});

/* completeJob-Ergebnis des letzten Aufrufs. */
const lastResult = () => jobs.completeJob.mock.calls[0][1];

/* ── Frühe Abweisungen ───────────────────────────────────────────── */

describe("handleProcessJob — Abweisungen", () => {
  test("nicht-POST → 405", async () => {
    const res = makeRes();
    await handleProcessJob({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  test("fehlende jobId → 200 ok:false, keine Verarbeitung", async () => {
    const res = makeRes();
    await handleProcessJob(postReq(undefined), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe("missing_jobId");
    expect(jobs.claimJob).not.toHaveBeenCalled();
  });

  test("nicht existierender Job → 200 ok:false job_not_found", async () => {
    jobs.getJob.mockResolvedValue(null);
    const res = makeRes();
    await handleProcessJob(postReq("job-x"), res);
    expect(res.body.reason).toBe("job_not_found");
    expect(jobs.claimJob).not.toHaveBeenCalled();
  });

  test("bereits geclaimter Job → 200 ok:false, kein completeJob (Idempotenz)", async () => {
    jobs.claimJob.mockResolvedValue(false);
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(res.body.reason).toBe("already_claimed");
    expect(jobs.completeJob).not.toHaveBeenCalled();
  });

  test("verlassener Job → abandoned, kein Claim, kein Mistral-Call, Bild gelöscht", async () => {
    jobs.isAbandoned.mockReturnValue(true);
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(res.body.reason).toBe("abandoned");
    expect(jobs.abandonJob).toHaveBeenCalledWith("job-1");
    expect(jobs.claimJob).not.toHaveBeenCalled();
    expect(jobs.completeJob).not.toHaveBeenCalled();
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
  });
});

/* ── Erfolgsfall ─────────────────────────────────────────────────── */

describe("handleProcessJob — Erfolgsfall", () => {
  test("gültiger Job → Profil erzeugt, Ergebnis gespeichert, Bild gelöscht", async () => {
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(jobs.completeJob).toHaveBeenCalledTimes(1);

    const result = lastResult();
    expect(result.meta.mode).toBe("multimodal");
    expect(Object.keys(result.profiles.normal.categories).length).toBeGreaterThan(0);
    expect(typeof result.profiles.boost.profileText).toBe("string");

    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
    expect(counter.incrementTotals).toHaveBeenCalledTimes(1);
  });
});

/* ── Blocked-Pfade ───────────────────────────────────────────────── */

describe("handleProcessJob — Blocked-Ergebnisse", () => {
  test("Describe-Fehler → blocked.apiError, kein incrementTotals", async () => {
    process.env.MISTRAL_MOCK_FAIL = "describe";
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(lastResult().blockedReason).toBe("blocked.apiError");
    expect(counter.incrementTotals).not.toHaveBeenCalled();
    expect(storage.deleteImage).toHaveBeenCalled();
  });

  test("leere Beschreibung (Safety-Filter) → blocked.safetyFilter", async () => {
    process.env.MISTRAL_MOCK_FAIL = "describe-empty";
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(lastResult().blockedReason).toBe("blocked.safetyFilter");
  });

  test("kein Profil → blocked.profileBlocked", async () => {
    process.env.MISTRAL_MOCK_FAIL = "profiles";
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(lastResult().blockedReason).toBe("blocked.profileBlocked");
  });

  test("Rate-Limit → blocked.overloaded", async () => {
    process.env.MISTRAL_MOCK_FAIL = "rate_limit";
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(lastResult().blockedReason).toBe("blocked.overloaded");
  });
});

/* ── Unerwarteter Fehler ─────────────────────────────────────────── */

describe("handleProcessJob — Fehlerfall", () => {
  test("Bild kann nicht geladen werden → blocked.apiError, Bild trotzdem gelöscht", async () => {
    storage.loadImage.mockRejectedValue(new Error("storage down"));
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(res.statusCode).toBe(200);
    expect(lastResult().blockedReason).toBe("blocked.apiError");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
  });
});
