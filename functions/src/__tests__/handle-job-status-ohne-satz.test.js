/* Statusabfrage ohne Einstellungssatz (07.10.2026).

   Hängt ein Auftrag in der Verarbeitung, prüft die Statusabfrage, ob er seine
   Zeitgrenze überschritten hat — die Grenze steht im Einstellungssatz. Fehlt
   der Satz, wirft diese Prüfung. Bisher blieb das ungefangen: Der Browser
   bekam einen Serverfehler, und jede Abfrage (alle zwei Sekunden je wartendem
   Gerät) schrieb eine Fehlerzeile, die den Alarm auslöst.

   Geprüft wird:
   - ohne Satz: 503 und EINE Warnung ohne Auftragsnummer, kein Wurf;
   - der Browser behandelt 503 wie jede kurze Störung und fragt weiter
     (public/js/auftrag-abfrage.js: alles außer 404 ist vorübergehend);
   - jeder ANDERE Fehler bleibt ein Fehler (sonst verschwände ein echter
     Ausfall hinter „vorübergehend“);
   - mit Satz ändert sich nichts (Erfolgsweg). */

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
jest.mock("../durchsatz", () => ({
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 40, frisch: true, gemessen: true })),
}));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: true })) }));

const { handleJobStatus } = require("../handle-job-status");
const jobs = require("../jobs");
const { zeileAlsText } = require("./hilfen/als-text");

const JOB_ID = "Aa1Bb2Cc3Dd4Ee5Ff6Gg";

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

const laufenderJob = () => ({ id: JOB_ID, status: "processing", startedAt: Date.now() - 1000, resultToken: "t" });
const abfrage = () => ({ method: "GET", query: { jobId: JOB_ID } });

function ohneSatz() {
  const fehler = new Error("Kein Einstellungssatz");
  fehler.code = "config_missing";
  return fehler;
}

let zeilen;
beforeEach(() => {
  jest.clearAllMocks();
  zeilen = [];
  jest.spyOn(console, "log").mockImplementation((...a) => zeilen.push(zeileAlsText(...a)));
  jobs.getJob.mockResolvedValue(laufenderJob());
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("ohne Einstellungssatz: 503 statt Absturz, eine Warnung ohne Auftragsnummer", async () => {
  jobs.markFailedIfStale.mockRejectedValue(ohneSatz());
  const res = makeRes();

  await expect(handleJobStatus(abfrage(), res)).resolves.toBeUndefined();

  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: "config_missing" });
  expect(zeilen).toHaveLength(1);
  expect(JSON.parse(zeilen[0])).toEqual({ severity: "WARNING", warning: "job-status-ohne-einstellungssatz" });
  expect(zeilen[0]).not.toContain(JOB_ID);
});

test("ein anderer Fehler bleibt ein Fehler", async () => {
  jobs.markFailedIfStale.mockRejectedValue(new Error("Datenbank nicht erreichbar"));
  const res = makeRes();

  await expect(handleJobStatus(abfrage(), res)).rejects.toThrow("Datenbank nicht erreichbar");
  expect(res.statusCode).toBe(200);
  expect(res.body).toBeNull();
});

test("mit Einstellungssatz: der laufende Auftrag wird wie bisher gemeldet (Erfolgsweg)", async () => {
  jobs.markFailedIfStale.mockImplementation(async (job) => job);
  const res = makeRes();

  await handleJobStatus(abfrage(), res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ status: "processing", position: 0, etaSeconds: 40 });
  expect(zeilen).toEqual([]);
});

test("auch das Abmelden meldet fehlende Einstellungen als vorübergehend", async () => {
  jobs.getJob.mockRejectedValue(ohneSatz());
  const res = makeRes();

  await handleJobStatus({ method: "DELETE", query: { jobId: JOB_ID, token: "t" } }, res);

  expect(res.statusCode).toBe(503);
});
