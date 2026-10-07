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
  zaehlerNachtragen: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../cloud-tasks", () => ({
  redispatchJobLocal: jest.fn(),
}));

const util = require("util");
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

/* Ein Argument einer Konsolenausgabe als Text, in dem sein INHALT steht
   (TEST-2026-10-04-15): Text bleibt Text; ein Objekt wird als JSON geschrieben,
   ein Fehler mit Meldung, Stapel und eigenen Feldern. `String(objekt)` ergaebe
   "[object Object]" — die Suche nach dem Wert einer Kennung saehe nicht hinein.
   Was sich nicht als JSON schreiben laesst (ein Objekt, das sich selbst
   enthaelt), klappt util.inspect auf. */
function alsText(wert) {
  if (wert === null || typeof wert !== "object") return String(wert);
  if (wert instanceof Error) return `${wert.stack || wert.message} ${alsText({ ...wert })}`;
  try {
    return JSON.stringify(wert);
  } catch (_) {
    return util.inspect(wert, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity });
  }
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
    jest.spyOn(console, art).mockImplementation((...args) => ausgabe.push(args.map(alsText).join(" ")));
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
  /* TEST-2026-10-04-15: Gesucht wird nach dem WERT einer Kennung. Das geht nur,
     wenn auch ein Objekt oder ein Fehler als Argument einer Konsolenausgabe mit
     seinem Inhalt gesammelt wird. */
  test("ein Objekt in einer Konsolenausgabe erscheint als JSON, nicht als [object Object]", () => {
    console.log("vorgang", { traceId: TRACE_ID, tief: { liste: [{ jobId: JOB_ID }] } });
    const log = ausgabe.join("\n");
    expect(log).not.toContain("[object Object]");
    expect(log).toContain(`vorgang {"traceId":"${TRACE_ID}","tief":{"liste":[{"jobId":"${JOB_ID}"}]}}`);
  });

  test("ein Fehler als Argument wird mit Meldung und eigenen Feldern gesammelt", () => {
    console.error(Object.assign(new Error(`kein Dokument jobs/${JOB_ID}`), { traceId: TRACE_ID, code: 5 }));
    const log = ausgabe.join("\n");
    expect(log).toContain(`kein Dokument jobs/${JOB_ID}`);
    expect(log).toContain(TRACE_ID);
  });

  test("ein Objekt, das sich selbst enthaelt, wirft die Sammlung nicht um", () => {
    const kreis = { jobId: JOB_ID };
    kreis.selbst = kreis;
    expect(() => console.warn(kreis)).not.toThrow();
    expect(ausgabe.join("\n")).toContain(JOB_ID);
  });

  test("Text bleibt Text — die Zeilen des Programms stehen unveraendert in der Sammlung", () => {
    console.info('{"step":"probe"}', 7, null, undefined);
    expect(ausgabe).toEqual(['{"step":"probe"} 7 null undefined']);
  });

  test("vor dem Claim steht die jobId im Log — die Suche findet sie", async () => {
    jobs.claimJob.mockResolvedValue(false);
    const log = await lauf();
    expect(log).toContain("already-claimed");
    expect(log).toContain(JOB_ID);
    expect(log).not.toContain('"step":"minor-safety"');
  });
});
