/* Tests für handle-process-job.js — Worker der Queue-Architektur.
   Job-, Storage- und Counter-Module sind gemockt. Die Mistral-Pipeline läuft
   über den echten mistral-mock (MISTRAL_MOCK=1) — privacy.js und animal.js
   sind real, der Worker wird also als echte Integration getestet. */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  claimJob: jest.fn(),
  completeJob: jest.fn(),
  isAbandoned: jest.fn(),
  abandonJob: jest.fn(),
  countProcessingJobs: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  loadImage: jest.fn(),
  deleteImage: jest.fn(),
}));
jest.mock("../counter", () => ({
  incrementTotals: jest.fn(() => Promise.resolve()),
  releaseHourlySlot: jest.fn(() => Promise.resolve()),
}));
jest.mock("../cloud-tasks", () => ({
  redispatchJobLocal: jest.fn(),
}));

const { handleProcessJob } = require("../handle-process-job");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const counter = require("../counter");
const tasks = require("../cloud-tasks");

const JOB = {
  id: "job-1",
  status: "queued",
  createdAt: Date.now() - 5000,
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
  /* completeJob liefert true, wenn der Job noch `processing` war und das
     Ergebnis gespeichert wurde (BUG-2026-08-13-35). */
  jobs.completeJob.mockResolvedValue(true);
  jobs.isAbandoned.mockReturnValue(false);
  jobs.abandonJob.mockResolvedValue(true);
  jobs.countProcessingJobs.mockResolvedValue(0);
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
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(1);
  });

  test("abandonJob verliert das Race → Bild bleibt (gehört dem Gewinner), kein Slot zurück", async () => {
    jobs.isAbandoned.mockReturnValue(true);
    jobs.abandonJob.mockResolvedValue(false);
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);
    expect(res.body.reason).toBe("abandoned");
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(counter.releaseHourlySlot).not.toHaveBeenCalled();
    expect(jobs.claimJob).not.toHaveBeenCalled();
  });

  test("Lokal-Modus, Drossel voll → Job vertagt, kein Claim, Re-Dispatch geplant", async () => {
    process.env.QUEUE_LOCAL = "1";
    process.env.QUEUE_LOCAL_CONCURRENCY = "3";
    jobs.countProcessingJobs.mockResolvedValue(3);
    const res = makeRes();
    try {
      await handleProcessJob(postReq("job-1"), res);
      expect(res.body.reason).toBe("deferred");
      expect(jobs.claimJob).not.toHaveBeenCalled();
      expect(tasks.redispatchJobLocal).toHaveBeenCalledWith("job-1");
    } finally {
      delete process.env.QUEUE_LOCAL;
      delete process.env.QUEUE_LOCAL_CONCURRENCY;
    }
  });

  test("Lokal-Modus, Drossel frei → Job wird normal verarbeitet", async () => {
    process.env.QUEUE_LOCAL = "1";
    process.env.QUEUE_LOCAL_CONCURRENCY = "3";
    jobs.countProcessingJobs.mockResolvedValue(1);
    const res = makeRes();
    try {
      await handleProcessJob(postReq("job-1"), res);
      expect(jobs.claimJob).toHaveBeenCalledWith("job-1");
      expect(tasks.redispatchJobLocal).not.toHaveBeenCalled();
    } finally {
      delete process.env.QUEUE_LOCAL;
      delete process.env.QUEUE_LOCAL_CONCURRENCY;
    }
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

  /* BUG-2026-08-13-35: completeJob gibt false (Reaper war schneller). Das
     fertige Ergebnis darf dann NICHT als "done" gezählt oder geloggt werden. */
  test("completeJob=false → nicht gezählt, ERROR-Log, ok:false", async () => {
    jobs.completeJob.mockResolvedValue(false);
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();
    await handleProcessJob(postReq("job-1"), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe("already_terminal");
    expect(counter.incrementTotals).not.toHaveBeenCalled();
    const zeile = fehlerSpy.mock.calls.map((c) => c[0]).find((s) => String(s).includes("ergebnis-verworfen"));
    expect(zeile).toBeTruthy();
    expect(JSON.parse(zeile).severity).toBe("ERROR");
    fehlerSpy.mockRestore();
  });

  test("Erfolgs-Log enthält queueWaitMs (Wartezeit in der Warteschlange)", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await handleProcessJob(postReq("job-1"), makeRes());
    const doneLog = logSpy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(c[0]);
        } catch (_) {
          return null;
        }
      })
      .find((o) => o && o.step === "process-job" && o.status === "done");
    logSpy.mockRestore();
    expect(doneLog).toBeTruthy();
    expect(typeof doneLog.queueWaitMs).toBe("number");
    expect(doneLog.queueWaitMs).toBeGreaterThanOrEqual(0);
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

/* ══════════════════════════════════════════════════════════════════════
   Kurzaudit 2026-08-11, SEC-108 — der Kinderschutz-Bericht braucht einen
   Leser. Die minor-Stufe bleibt ein stiller Zaehler (sie schlaegt auf den
   Lerninhalt selbst an, gemessen: "Ratenzahlung" im Beast-Text). Die HARTE
   Stufe im Fliesstext ist dagegen ein Regelbruch des Modells und muss als
   ERROR raus — nur so erreicht sie den vorhandenen E-Mail-Alarm.
   ══════════════════════════════════════════════════════════════════════ */
describe("SEC-108 — Logging des Kinderschutz-Berichts", () => {
  const { _loggeMinorSafety } = require("../handle-process-job");

  const basisBericht = {
    alter: 14,
    minderjaehrig: true,
    entfernt: [],
    durchgerutscht: [],
  };

  let logSpy, errorSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("minor-Treffer im Fliesstext bleiben ein stiller Zaehler (kein ERROR)", () => {
    _loggeMinorSafety(
      { ...basisBericht, durchgerutscht: [{ modus: "boost", feld: "profileText", grund: "minor" }] },
      "trace-1",
      "de"
    );
    expect(errorSpy).not.toHaveBeenCalled();
    const zeile = JSON.parse(logSpy.mock.calls[0][0]);
    expect(zeile.durchgerutscht).toBe(1);
    expect(zeile.durchgerutschtGruende).toEqual(["minor"]);
  });

  test("harte Stufe im Fliesstext loggt zusaetzlich als ERROR (loest den Alarm aus)", () => {
    _loggeMinorSafety(
      {
        ...basisBericht,
        durchgerutscht: [
          { modus: "normal", feld: "profileText", grund: "immer" },
          { modus: "boost", feld: "categories.werbeprofil", grund: "minor" },
        ],
      },
      "trace-2",
      "de"
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const fehler = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(fehler.step).toBe("minor-safety-durchbruch");
    /* Nur Feldnamen, keine Inhalte — der Einzelfall ist per Design nicht
       rekonstruierbar; die Meldung heisst: Prompt-Regel haelt nicht mehr. */
    expect(fehler.felder).toEqual(["normal.profileText"]);
    expect(JSON.stringify(fehler)).not.toContain("eintrag");
  });

  test("ohne jeden Treffer: genau eine INFO-Zeile, kein ERROR (Positivkontrolle)", () => {
    _loggeMinorSafety(basisBericht, null, "en");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).step).toBe("minor-safety");
  });
});
