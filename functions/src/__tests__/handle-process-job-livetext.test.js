/* Tests fuer die Live-Text-Verdrahtung (v3.0 Phase 1) im Queue-Worker.

   Hier ist ALLES gemockt (auch mistral.js und die Feature-Flags), denn
   geprueft wird ausschliesslich die Verdrahtung in runPipelineSingleLarge:
     - Flag AN  → runSingleLargeCall bekommt einen onLiveText-Callback, der
       (auf 1 Schreibvorgang je 2 s gedrosselt) jobs.setLiveText ruft.
     - Flag AUS → die opts sind EXAKT die heutigen — kein onLiveText,
       kein Stream, kein Schreibvorgang. Das ist die zentrale
       „ohne Flag aendert sich nichts"-Garantie des Workers. */

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
  setLiveText: jest.fn(),
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
jest.mock("../feature-flags", () => ({
  isSingleLargeCallEnabled: jest.fn(),
  isPromptCacheEnabled: jest.fn(),
  isBeastAdsCallEnabled: jest.fn(),
  isLiveTextEnabled: jest.fn(),
}));
jest.mock("../mistral", () => ({
  runSingleLargeCall: jest.fn(),
  generateBeastAds: jest.fn(),
  describeImage: jest.fn(),
  generateBothProfiles: jest.fn(),
  isRateLimitError: jest.fn(() => false),
}));

const { handleProcessJob } = require("../handle-process-job");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const flags = require("../feature-flags");
const mistral = require("../mistral");

const JOB = {
  id: "job-1",
  status: "queued",
  createdAt: Date.now() - 5000,
  lang: "de",
  traceId: "trace1",
  imagePath: "queue-uploads/x.jpg",
  exif: {},
};

/* Minimal-Profil, das die Pipeline als Personen-Erfolg durchlaeuft
   (subject PERSON → kein Tier-Pfad; eine Karte genuegt fuer hasCategories). */
const PROFIL = {
  normal: {
    categories: { interessen: { label: "Interessen", value: "Radfahren", confidence: 0.8 } },
    profileText: "Du bist sportlich.",
    ad_targeting: [],
    manipulation_triggers: [],
  },
  boost: null,
  subject: "PERSON",
  visibleText: "",
  alterAnker: null,
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

const postReq = () => ({ method: "POST", body: { jobId: "job-1" } });

/* opts (5. Argument) des letzten runSingleLargeCall-Aufrufs. */
const letzteOpts = () => mistral.runSingleLargeCall.mock.calls[0][4];

beforeEach(() => {
  jest.clearAllMocks();
  /* Sicherstellen, dass der Worker das gemockte ../mistral nimmt — andere
     Testdateien im selben Worker setzen MISTRAL_MOCK=1. */
  delete process.env.MISTRAL_MOCK;
  jobs.getJob.mockResolvedValue(JOB);
  jobs.claimJob.mockResolvedValue(true);
  jobs.completeJob.mockResolvedValue(true);
  jobs.isAbandoned.mockReturnValue(false);
  jobs.abandonJob.mockResolvedValue(true);
  jobs.countProcessingJobs.mockResolvedValue(0);
  storage.loadImage.mockResolvedValue({ buffer: Buffer.from("img"), mimeType: "image/jpeg" });
  storage.deleteImage.mockResolvedValue();
  flags.isSingleLargeCallEnabled.mockResolvedValue(true);
  flags.isPromptCacheEnabled.mockResolvedValue(false);
  flags.isBeastAdsCallEnabled.mockResolvedValue(false);
  flags.isLiveTextEnabled.mockResolvedValue(false);
  mistral.runSingleLargeCall.mockResolvedValue(PROFIL);
});

describe("runPipelineSingleLarge — Flag useLiveText AUS (Default)", () => {
  test("opts sind EXAKT die heutigen — kein onLiveText, kein Schreibvorgang", async () => {
    await handleProcessJob(postReq(), makeRes());
    expect(mistral.runSingleLargeCall).toHaveBeenCalledTimes(1);
    /* toEqual mit dem VOLLEN Objekt: haette sich auch nur die Form der opts
       geaendert, faellt dieser Test um — Byte-Identitaets-Garantie. */
    expect(letzteOpts()).toEqual({ usePromptCache: false });
    expect(letzteOpts()).not.toHaveProperty("onLiveText");
    expect(jobs.setLiveText).not.toHaveBeenCalled();
  });

  test("Flag-Lesefehler wirkt wie Flag AUS (fail-safe)", async () => {
    flags.isLiveTextEnabled.mockRejectedValue(new Error("firestore down"));
    const res = makeRes();
    await handleProcessJob(postReq(), res);
    expect(res.body.ok).toBe(true); /* die Analyse selbst laeuft normal durch */
    expect(letzteOpts()).not.toHaveProperty("onLiveText");
    expect(jobs.setLiveText).not.toHaveBeenCalled();
  });
});

describe("runPipelineSingleLarge — Flag useLiveText AN", () => {
  beforeEach(() => {
    flags.isLiveTextEnabled.mockResolvedValue(true);
  });

  test("runSingleLargeCall bekommt einen onLiveText-Callback, der setLiveText mit jobId und BEIDEN Texten ruft", async () => {
    mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
      expect(typeof opts.onLiveText).toBe("function");
      opts.onLiveText({ standard: "Du bist", beast: null });
      return PROFIL;
    });
    await handleProcessJob(postReq(), makeRes());
    expect(jobs.setLiveText).toHaveBeenCalledTimes(1);
    /* EIN Schreibvorgang traegt beide Felder — das Objekt geht 1:1 durch. */
    expect(jobs.setLiveText).toHaveBeenCalledWith("job-1", { standard: "Du bist", beast: null });
  });

  test("Drossel: zwei Wellen innerhalb von 2 s ergeben nur EINEN Schreibvorgang", async () => {
    mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
      opts.onLiveText({ standard: "Du bist", beast: null });
      /* unmittelbar danach → gedrosselt, auch wenn Beast inzwischen da ist */
      opts.onLiveText({ standard: "Du bist sportlich", beast: "Du bist ein" });
      return PROFIL;
    });
    await handleProcessJob(postReq(), makeRes());
    expect(jobs.setLiveText).toHaveBeenCalledTimes(1);
    expect(jobs.setLiveText).toHaveBeenCalledWith("job-1", { standard: "Du bist", beast: null });
  });

  test("nach Ablauf der 2-s-Drossel wird erneut geschrieben — dann mit dem Beast-Stand", async () => {
    const echteNow = Date.now.bind(Date);
    let versatzMs = 0;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => echteNow() + versatzMs);
    try {
      mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
        opts.onLiveText({ standard: "Du bist", beast: null });
        versatzMs += 2500; /* die Drossel-Frist ist abgelaufen */
        opts.onLiveText({ standard: "Du bist sportlich", beast: "Du bist ein" });
        return PROFIL;
      });
      await handleProcessJob(postReq(), makeRes());
    } finally {
      nowSpy.mockRestore();
    }
    expect(jobs.setLiveText).toHaveBeenCalledTimes(2);
    expect(jobs.setLiveText).toHaveBeenLastCalledWith("job-1", { standard: "Du bist sportlich", beast: "Du bist ein" });
  });

  test("das Analyse-Ergebnis bleibt mit Flag identisch — completeJob bekommt das normale Profil", async () => {
    mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
      opts.onLiveText({ standard: "Du bist", beast: null });
      return PROFIL;
    });
    const res = makeRes();
    await handleProcessJob(postReq(), res);
    expect(res.body.ok).toBe(true);
    const ergebnis = jobs.completeJob.mock.calls[0][1];
    expect(ergebnis.profiles.normal.profileText).toBe("Du bist sportlich.");
    expect(ergebnis.meta.pipeline).toBe("single-large");
  });
});
