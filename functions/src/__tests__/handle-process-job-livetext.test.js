/* Tests fuer die Live-Text-Verdrahtung (v3.0 Phase 1) im Queue-Worker.

   Hier ist ALLES gemockt (auch mistral.js und die Feature-Flags), denn
   geprueft wird ausschliesslich die Verdrahtung in runPipeline:
     - Flag AN  → runSingleLargeCall bekommt einen onLiveText-Callback, der
       nur noch beim Neuversuch jobs.setLiveText ruft (leere Welle).
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
  /* Der Verarbeiter speichert ueber diese zwei (BUG-2026-10-03-30). Hier
     reichen sie an die completeJob-Attrappe weiter; Wiederholung und
     Meldegrund prueft ergebnis-speichern.test.js mit dem echten Modul. */
  ergebnisSpeichern: (id, result) => require("../jobs").completeJob(id, result),
  ersatzErgebnisSpeichern: (id, job) =>
    require("../jobs").completeJob(id, jest.requireActual("../jobs").ersatzErgebnis(job)),
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
  isBeastAdsCallEnabled: jest.fn(),
}));
jest.mock("../mistral", () => ({
  runSingleLargeCall: jest.fn(),
  generateBeastAds: jest.fn(),
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
  flags.isBeastAdsCallEnabled.mockResolvedValue(false);
  mistral.runSingleLargeCall.mockResolvedValue(PROFIL);
});

describe("runPipeline — Live-Text ist fest eingebaut (seit 10.09.2026)", () => {
  test("opts tragen immer den onLiveText-Callback und sonst nichts", async () => {
    await handleProcessJob(postReq(), makeRes());
    expect(mistral.runSingleLargeCall).toHaveBeenCalledTimes(1);
    /* Kein Flag mehr, kein usePromptCache mehr — der Cache ist in mistral.js
       fest. Haette sich die Form der opts geaendert, faellt dieser Test um. */
    /* Seit 16.10.2026 dazu `messung`: das Objekt, in das der KI-Aufruf
       Textmenge und Wiederholungen fuer die dauerhaften Zaehler schreibt. */
    expect(Object.keys(letzteOpts()).sort()).toEqual(["messung", "onLiveText"]);
    expect(typeof letzteOpts().onLiveText).toBe("function");
  });
});

describe("runPipeline — Live-Text schreiben", () => {
  /* Der Rohtext darf nicht vor dem Lektor auf dem Bildschirm stehen. */
  test("Rohtext geht nicht hinaus, weder Standard noch Beast", async () => {
    mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
      opts.onLiveText({ standard: "Du bist", beast: "Wir wissen" });
      return PROFIL;
    });
    await handleProcessJob(postReq(), makeRes());
    expect(jobs.setLiveText).not.toHaveBeenCalled();
  });

  /* Neuversuch nach Verbindungsabriss: Die Welle setzt die Anzeige zurueck und
     traegt auch dann keinen Text, wenn das Modell schon geschrieben hat. */
  test("ein neuer Versuch schickt genau eine leere Welle", async () => {
    mistral.runSingleLargeCall.mockImplementation(async (_b, _m, _r, _l, opts) => {
      opts.onLiveText({ standard: "Du bist alt", beast: null });
      opts.onLiveText({ standard: "Du bist neu", beast: "Wir", versuch: 2 });
      opts.onLiveText({ standard: "Du bist neuer", beast: "Wir", versuch: 2 });
      return PROFIL;
    });
    await handleProcessJob(postReq(), makeRes());
    expect(jobs.setLiveText.mock.calls.map((c) => c[1])).toEqual([{ standard: "", beast: null, versuch: 2 }]);
  });

  test("der bereinigte Text ersetzt nur den seriösen Text, Beast bleibt", async () => {
    mistral.textBereinigen = jest.fn().mockResolvedValue("Bereinigt.");
    mistral.runSingleLargeCall.mockResolvedValue({
      ...PROFIL,
      normal: { ...PROFIL.normal },
      boost: { ...PROFIL.normal, profileText: "Wir wissen." },
    });
    try {
      await handleProcessJob(postReq(), makeRes());
      expect(mistral.textBereinigen).toHaveBeenCalledWith("Du bist sportlich.", expect.anything(), expect.anything());
      const ergebnis = jobs.completeJob.mock.calls[0][1];
      expect(ergebnis.profiles.normal.profileText).toBe("Bereinigt.");
      expect(ergebnis.profiles.boost.profileText).toBe("Wir wissen.");
    } finally {
      delete mistral.textBereinigen;
    }
  });

  test("scheitert der Lektor, bleibt der Text der Analyse stehen", async () => {
    mistral.textBereinigen = jest.fn().mockResolvedValue(null);
    try {
      await handleProcessJob(postReq(), makeRes());
      expect(jobs.completeJob.mock.calls[0][1].profiles.normal.profileText).toBe("Du bist sportlich.");
    } finally {
      delete mistral.textBereinigen;
    }
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
    expect(ergebnis.meta.mode).toBe("multimodal");
  });
});
