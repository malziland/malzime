/* PRIV-2026-10-03-57: DELETE /job-status meldet einen wartenden Job ab, den
   der Browser nicht mehr abholt (anderes Foto gewählt). Geprüft wird:
   - nur mit dem Abhol-Ticket des Jobs,
   - nur ein noch wartender Job,
   - danach dieselben Aufräumschritte wie im Aufräumdienst (Platz im
     Stundenkontingent zurück, Bild gelöscht),
   - die Statusabfrage (GET) bleibt unverändert und verwirft nie etwas.
   Die Job-Nummern sind echte Firestore-Auto-IDs (20 Zeichen), sonst bliebe
   der Aufruf am Formatriegel hängen. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  markFailedIfStale: jest.fn(),
  touchJob: jest.fn(),
  markDelivered: jest.fn(),
  abandonJob: jest.fn(),
}));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn() }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn() }));

const { handleJobStatus } = require("../handle-job-status");
const jobs = require("../jobs");
const { releaseHourlySlot } = require("../counter");
const { deleteImage } = require("../queue-storage");

const JOB_ID = "Aa1Bb2Cc3Dd4Ee5Ff6Gg";
const TICKET = "ticket-des-auftrags-0123456789";

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

const wartenderJob = (zusatz = {}) => ({
  id: JOB_ID,
  status: "queued",
  resultToken: TICKET,
  zaehlerStempel: 1759850000000,
  imagePath: "queue/bild-1.jpg",
  lastSeenAt: Date.now(),
  ...zusatz,
});

const abmelden = (query) => ({ method: "DELETE", query });

async function rufe(req) {
  const res = makeRes();
  await handleJobStatus(req, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jobs.markFailedIfStale.mockImplementation(async (job) => job);
  jobs.getQueuePosition.mockResolvedValue(1);
  jobs.touchJob.mockResolvedValue();
  jobs.abandonJob.mockResolvedValue(true);
  releaseHourlySlot.mockResolvedValue();
  deleteImage.mockResolvedValue(true);
});

describe("DELETE /job-status — wartenden Job abmelden", () => {
  test("mit Ticket: der wartende Job wird verworfen, der Platz frei, das Bild gelöscht", async () => {
    jobs.getJob.mockResolvedValue(wartenderJob());
    const res = await rufe(abmelden({ jobId: JOB_ID, token: TICKET }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ verworfen: true });
    expect(jobs.abandonJob).toHaveBeenCalledWith(JOB_ID);
    expect(releaseHourlySlot).toHaveBeenCalledWith(1759850000000);
    expect(deleteImage).toHaveBeenCalledWith("queue/bild-1.jpg");
  });

  test.each([
    ["ohne Ticket", { jobId: JOB_ID }],
    ["mit leerem Ticket", { jobId: JOB_ID, token: "" }],
    ["mit falschem Ticket", { jobId: JOB_ID, token: "ticket-eines-anderen" }],
  ])("%s: 403, nichts wird angefasst", async (_name, query) => {
    jobs.getJob.mockResolvedValue(wartenderJob());
    const res = await rufe(abmelden(query));
    expect(res.statusCode).toBe(403);
    expect(jobs.abandonJob).not.toHaveBeenCalled();
    expect(releaseHourlySlot).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test("Job ohne hinterlegtes Ticket: nie abmeldbar", async () => {
    jobs.getJob.mockResolvedValue(wartenderJob({ resultToken: undefined }));
    const res = await rufe(abmelden({ jobId: JOB_ID, token: "" }));
    expect(res.statusCode).toBe(403);
    expect(jobs.abandonJob).not.toHaveBeenCalled();
  });

  test.each(["processing", "done", "failed", "abandoned"])("Job im Zustand %s bleibt unberührt", async (status) => {
    jobs.getJob.mockResolvedValue(wartenderJob({ status }));
    const res = await rufe(abmelden({ jobId: JOB_ID, token: TICKET }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ verworfen: false });
    expect(jobs.abandonJob).not.toHaveBeenCalled();
    expect(releaseHourlySlot).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test("ein Worker war schneller (Übergang verloren): kein Platz zurück, das Bild bleibt", async () => {
    jobs.getJob.mockResolvedValue(wartenderJob());
    jobs.abandonJob.mockResolvedValue(false);
    const res = await rufe(abmelden({ jobId: JOB_ID, token: TICKET }));
    expect(res.body).toEqual({ verworfen: false });
    expect(releaseHourlySlot).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test("Datenbankfehler beim Verwerfen: Antwort ohne Absturz, Warnzeile ohne Job-Nummer", async () => {
    jobs.getJob.mockResolvedValue(wartenderJob());
    const fehler = new Error(`5 NOT_FOUND: projects/x/databases/y/documents/jobs/${JOB_ID}`);
    fehler.code = 5;
    jobs.abandonJob.mockRejectedValue(fehler);
    const zeilen = [];
    const spion = jest.spyOn(console, "log").mockImplementation((z) => zeilen.push(String(z)));
    try {
      const res = await rufe(abmelden({ jobId: JOB_ID, token: TICKET }));
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ verworfen: false });
    } finally {
      spion.mockRestore();
    }
    expect(zeilen).toHaveLength(1);
    expect(JSON.parse(zeilen[0])).toMatchObject({
      severity: "WARNING",
      warning: "job-abmelden-fehlgeschlagen",
      code: 5,
    });
    expect(zeilen[0]).not.toContain(JOB_ID);
    expect(releaseHourlySlot).not.toHaveBeenCalled();
  });

  test.each([
    ["fehlende jobId", { token: TICKET }, 400],
    ["ungültige jobId", { jobId: "a/b", token: TICKET }, 400],
  ])("%s → %i, ohne Datenbankzugriff", async (_name, query, code) => {
    const res = await rufe(abmelden(query));
    expect(res.statusCode).toBe(code);
    expect(jobs.getJob).not.toHaveBeenCalled();
  });

  test("unbekannter Job → 404", async () => {
    jobs.getJob.mockResolvedValue(null);
    const res = await rufe(abmelden({ jobId: JOB_ID, token: TICKET }));
    expect(res.statusCode).toBe(404);
    expect(jobs.abandonJob).not.toHaveBeenCalled();
  });
});

describe("Die Statusabfrage (GET) verwirft nie etwas", () => {
  test("GET mit Ticket auf einen wartenden Job: Status wie bisher, kein Verwerfen", async () => {
    jobs.getJob.mockResolvedValue(wartenderJob());
    const res = await rufe({ method: "GET", query: { jobId: JOB_ID, token: TICKET } });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("queued");
    expect(jobs.abandonJob).not.toHaveBeenCalled();
    expect(releaseHourlySlot).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  test.each(["POST", "PUT", "PATCH"])("%s bleibt abgewiesen (405)", async (method) => {
    const res = await rufe({ method, query: { jobId: JOB_ID, token: TICKET } });
    expect(res.statusCode).toBe(405);
    expect(jobs.getJob).not.toHaveBeenCalled();
  });
});
