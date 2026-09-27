/* Analyse-Aufruf ohne Kennung im Log (26.09.2026).

   Die Kinderschutz-Zeile (geschaetztes Alter, 30 Tage im Diagnose-Speicher)
   traegt bewusst keine Vorgangskennung (PRIV-2026-09-10-02). Cloud Run
   versieht aber jede Logzeile eines Aufrufs mit demselben Label
   `execution_id`. Schreibt irgendeine Zeile desselben Aufrufs die jobId oder
   die traceId, ist die Altersschaetzung darueber wieder mit der Kennung und
   mit den Geraeteangaben des Browsers verbunden — gemessen am 25.09.2026.

   Zusicherung: In jedem Aufruf, der eine Kinderschutz-Zeile schreibt, taucht
   weder der Wert der jobId noch der traceId in irgendeiner Ausgabe auf —
   gesucht wird nach dem WERT, nicht nach Feldnamen, damit auch eine
   umbenannte oder kuenftige Zeile auffaellt.
   Positivkontrolle: Auf einem Weg vor dem Claim steht die jobId im Log, die
   Suche findet sie also, wenn sie da ist. */

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
  zaehlerNachtragen: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../cloud-tasks", () => ({
  redispatchJobLocal: jest.fn(),
}));

const { handleProcessJob } = require("../handle-process-job");
const jobs = require("../jobs");
const storage = require("../queue-storage");

const JOB_ID = "auftrag-geheim-4711";
const TRACE_ID = "vorgang-geheim-0815";
const JOB = {
  id: JOB_ID,
  status: "queued",
  createdAt: Date.now() - 5000,
  lang: "de",
  traceId: TRACE_ID,
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

let ausgabe;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.MISTRAL_MOCK = "1";
  process.env.MISTRAL_MOCK_DELAY_MS = "0";
  delete process.env.MISTRAL_MOCK_FAIL;
  jobs.getJob.mockResolvedValue(JOB);
  jobs.claimJob.mockResolvedValue(true);
  jobs.completeJob.mockResolvedValue(true);
  jobs.isAbandoned.mockReturnValue(false);
  jobs.abandonJob.mockResolvedValue(true);
  jobs.countProcessingJobs.mockResolvedValue(0);
  storage.loadImage.mockResolvedValue({ buffer: Buffer.from("img"), mimeType: "image/jpeg" });
  storage.deleteImage.mockResolvedValue();
  ausgabe = [];
  for (const art of ["log", "error", "warn", "info"]) {
    jest.spyOn(console, art).mockImplementation((...args) => ausgabe.push(args.map(String).join(" ")));
  }
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.MISTRAL_MOCK;
  delete process.env.MISTRAL_MOCK_DELAY_MS;
});

async function lauf() {
  await handleProcessJob({ method: "POST", body: { jobId: JOB_ID } }, makeRes());
  return ausgabe.join("\n");
}

function pruefeOhneKennung(log) {
  /* Ohne Kinderschutz-Zeile waere die Pruefung leer und wertlos gruen. */
  expect(log).toContain('"step":"minor-safety"');
  expect(log).not.toContain(JOB_ID);
  expect(log).not.toContain(TRACE_ID);
}

describe("Aufruf mit Kinderschutz-Zeile: keine Kennung in irgendeiner Ausgabe", () => {
  test("Erfolg", async () => {
    const log = await lauf();
    expect(log).toContain('"status":"done"');
    pruefeOhneKennung(log);
  });

  test("Ergebnis verworfen, weil der Job schon abgeschlossen war", async () => {
    jobs.completeJob.mockResolvedValue(false);
    const log = await lauf();
    expect(log).toContain("ergebnis-verworfen-job-bereits-terminal");
    pruefeOhneKennung(log);
  });

  test("Speichern scheitert zweimal (Fehlerzeile und Warnung)", async () => {
    jobs.completeJob.mockRejectedValue(new Error("firestore weg"));
    const log = await lauf();
    expect(log).toContain('"status":"error"');
    expect(log).toContain("completeJob-error");
    pruefeOhneKennung(log);
  });
});

describe("Fehlertexte mit Kennung (27.09.2026)", () => {
  /* Firestore nennt bei einem Fehler zum Auftrag dessen Dokumentpfad samt
     jobId — in Produktion als Pfad, im lokalen Emulator als `name: "<id>"`.
     Der Fehlertext bleibt im Log, die Kennungen nicht. */
  test.each([
    ["Pfad", `No document to update: projects/p/databases/d/documents/jobs/${JOB_ID}`],
    ["Name", `5 NOT_FOUND: no entity to update: name: "${JOB_ID}" trace ${TRACE_ID}`],
  ])("Speichern scheitert mit Firestore-Text (%s)", async (_art, meldung) => {
    jobs.completeJob.mockRejectedValue(new Error(meldung));
    const log = await lauf();
    expect(log).toContain('"status":"error"');
    expect(log).toContain("completeJob-error");
    /* Positivkontrolle: Der Fehlertext selbst ist noch da. */
    expect(log).toMatch(/No document to update|NOT_FOUND/);
    pruefeOhneKennung(log);
  });
});

describe("Positivkontrolle des Messmittels", () => {
  test("vor dem Claim steht die jobId im Log — die Suche findet sie", async () => {
    jobs.claimJob.mockResolvedValue(false);
    const log = await lauf();
    expect(log).toContain("already-claimed");
    expect(log).toContain(JOB_ID);
    expect(log).not.toContain('"step":"minor-safety"');
  });
});
