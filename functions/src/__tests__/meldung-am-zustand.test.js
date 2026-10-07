"use strict";

/* "Ein Alarm je gescheiterter Analyse" haengt am Zustand des Auftrags, nicht am
   einzelnen Aufruf (OPS-2026-10-03-31).

   Die Fehlerzeile `analyse-gescheitert` entstand nur, wenn der Aufruf, der den
   Auftrag in seinen Endzustand brachte, das auch erfuhr. Kam die Bestaetigung
   der Datenbank nicht an, sah das Kind die Fehlermeldung — ohne Nachricht.

   Jetzt:
     - Der Uebergang wird einmal wiederholt, wenn er mit einem Fehler endet. Die
       Wiederholung erkennt den eigenen, schon angekommenen Schreibvorgang und
       meldet.
     - Der Auftrag traegt `gemeldet`: `false` ab dem Uebergang in einen Endzustand
       mit Fehlermeldung, `true`, sobald die Zeile geschrieben ist. Findet der
       Aufraeumdienst beim Loeschen einen Auftrag mit `gemeldet: false`, meldet
       er nach — spaet, aber nicht gar nicht.

   Echte Module: Auftragsverwaltung, Verarbeiter, Abholen, Aufraeumdienst —
   gegen eine Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../counter", () => ({
  incrementTotals: jest.fn(async () => {}),
  releaseHourlySlot: jest.fn(async () => {}),
  zaehlerNachtragen: jest.fn(async () => true),
}));
jest.mock("../durchsatz", () => ({
  merkeDauer: jest.fn(async () => {}),
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })) }));
jest.mock("../job-pipelines", () => ({ runPipeline: jest.fn() }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));
jest.mock("../cloud-tasks", () => ({ redispatchJobLocal: jest.fn() }));

const { SATZ } = require("../test-satz");
const speicher = require("./hilfen/speicher-datenbank");
const pipelines = require("../job-pipelines");
const jobs = require("../jobs");
const { handleProcessJob } = require("../handle-process-job");
const { handleJobStatus } = require("../handle-job-status");
const { reapJobs } = require("../handle-reap");

const JOB = "C".repeat(20);
const MINUTE = 60 * 1000;
const BLOCKIERT = {
  profiles: null,
  blockedReason: "blocked.profileBlocked",
  privacyRisks: [],
  exif: {},
  meta: { traceId: null, mode: "blocked" },
};
const PROFIL = {
  profiles: { normal: { profileText: "Text", categories: {} }, boost: { profileText: "Text", categories: {} } },
  privacyRisks: [],
  exif: {},
  meta: { traceId: null, mode: "human" },
};

function antwort() {
  return {
    statusCode: null,
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

const auftrag = () => speicher.lies(`jobs/${JOB}`);
const lege = (daten) =>
  speicher.lege(`jobs/${JOB}`, { createdAt: Date.now() - 5000, lastSeenAt: Date.now() - 1000, ...daten });

/* Die n-te Transaktion schreibt, ihre Bestaetigung kommt aber nicht an. */
function bestaetigungGehtVerloren(nummern) {
  let transaktionen = 0;
  speicher.vor(({ art }) => {
    if (art === "transaktion") transaktionen += 1;
    if (art === "transaktion-ende" && nummern.includes(transaktionen)) throw new Error("DEADLINE_EXCEEDED");
  });
}

let fehlerZeilen;
const meldungen = () =>
  fehlerZeilen.mock.calls
    .map((aufruf) => JSON.parse(aufruf[0]))
    .filter((zeile) => zeile.alert === "analyse-gescheitert")
    .map((zeile) => zeile.grund);

beforeEach(() => {
  speicher.leeren();
  speicher.lege("config/erinnerung", { letzterErfolg: Date.now() });
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  fehlerZeilen = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("die Bestaetigung der Datenbank kommt nicht an", () => {
  test("Verarbeiter speichert ein blockiertes Ergebnis: trotzdem genau eine Meldung", async () => {
    lege({ status: "queued", imagePath: "queue-uploads/x.jpg" });
    pipelines.runPipeline.mockResolvedValue({ result: BLOCKIERT, success: false });
    /* Erste Transaktion: Auftrag uebernehmen. Zweite: Ergebnis speichern. */
    bestaetigungGehtVerloren([2]);

    await handleProcessJob({ method: "POST", body: { jobId: JOB }, headers: {} }, antwort());

    expect(auftrag().status).toBe("done");
    expect(auftrag().result.blockedReason).toBe("blocked.profileBlocked");
    expect(meldungen()).toEqual(["blocked.profileBlocked"]);
    expect(auftrag().gemeldet).toBe(true);
  });

  test("Abholen setzt einen haengenden Auftrag auf gescheitert: eine Meldung, und das Kind bekommt die Antwort", async () => {
    lege({ status: "processing", startedAt: Date.now() - SATZ.verarbeitungsZeitlimitMs - 1000 });
    bestaetigungGehtVerloren([1]);
    const res = antwort();

    await handleJobStatus({ method: "GET", query: { jobId: JOB, token: "" } }, res);

    expect(res.body).toEqual({ status: "failed", errorReason: "processing_timeout" });
    expect(meldungen()).toEqual(["processing_timeout"]);
    expect(auftrag().gemeldet).toBe(true);
  });

  test("Aufraeumdienst setzt einen haengenden Auftrag auf gescheitert: eine Meldung", async () => {
    lege({ status: "processing", startedAt: Date.now() - SATZ.verarbeitungsZeitlimitMs - 1000 });
    bestaetigungGehtVerloren([1]);

    const lauf = await reapJobs();

    expect(lauf.staleProcessing).toBe(1);
    expect(auftrag().status).toBe("failed");
    expect(meldungen()).toEqual(["processing_timeout"]);
  });

  test("auch die Wiederholung erfaehrt nichts: keine Meldung jetzt, aber der Auftrag traegt gemeldet: false", async () => {
    lege({ status: "processing", startedAt: Date.now() - SATZ.verarbeitungsZeitlimitMs - 1000 });
    bestaetigungGehtVerloren([1, 2]);

    await expect(jobs.failJob(JOB, "processing_timeout")).rejects.toThrow("DEADLINE_EXCEEDED");

    expect(auftrag().status).toBe("failed");
    expect(meldungen()).toEqual([]);
    expect(auftrag().gemeldet).toBe(false);
  });
});

describe("der Aufraeumdienst meldet nach, was beim Loeschen noch nicht gemeldet ist", () => {
  const alt = { createdAt: Date.now() - 3 * 60 * MINUTE };

  test("gescheiterter Auftrag mit gemeldet: false → eine Meldung beim Loeschen", async () => {
    lege({ ...alt, status: "failed", errorReason: "processing_timeout", gemeldet: false });

    const lauf = await reapJobs();

    expect(lauf.expired).toBe(1);
    expect(auftrag()).toBeUndefined();
    expect(meldungen()).toEqual(["processing_timeout"]);
  });

  test("abgeholtes blockiertes Ergebnis mit gemeldet: false → eine Meldung beim Loeschen", async () => {
    lege({ status: "done", result: BLOCKIERT, deliveredAt: Date.now() - 20 * MINUTE, gemeldet: false });

    const lauf = await reapJobs();

    expect(lauf.zugestellt).toBe(1);
    expect(meldungen()).toEqual(["blocked.profileBlocked"]);
  });

  test.each([
    ["schon gemeldet", { status: "failed", errorReason: "processing_timeout", gemeldet: true }],
    ["Auftrag aus der Zeit vor diesem Feld", { status: "failed", errorReason: "processing_timeout" }],
    ["erfolgreiche Analyse", { status: "done", result: PROFIL, gemeldet: null }],
    ["verlassener Auftrag", { status: "abandoned" }],
  ])("%s → keine Meldung beim Loeschen", async (_fall, daten) => {
    lege({ ...alt, ...daten });

    const lauf = await reapJobs();

    expect(lauf.expired).toBe(1);
    expect(meldungen()).toEqual([]);
  });

  test("laesst sich der Auftrag nicht loeschen, wird auch nicht nachgemeldet — der naechste Lauf versucht beides wieder", async () => {
    lege({ ...alt, status: "failed", errorReason: "processing_timeout", gemeldet: false });
    speicher.vor(({ art }) => {
      if (art === "delete") throw new Error("UNAVAILABLE");
    });

    const lauf = await reapJobs();

    expect(lauf.expired).toBe(0);
    expect(meldungen()).toEqual([]);
  });
});

describe("ohne Stoerung", () => {
  test("blockiertes Ergebnis: eine Meldung, der Auftrag traegt gemeldet: true", async () => {
    lege({ status: "processing" });

    expect(await jobs.completeJob(JOB, BLOCKIERT)).toBe(true);

    expect(meldungen()).toEqual(["blocked.profileBlocked"]);
    expect(auftrag().gemeldet).toBe(true);
  });

  test("erfolgreiche Analyse: keine Meldung, kein zusaetzlicher Schreibvorgang", async () => {
    lege({ status: "processing" });

    expect(await jobs.completeJob(JOB, PROFIL)).toBe(true);

    expect(meldungen()).toEqual([]);
    expect(auftrag().gemeldet).toBeNull();
    expect(speicher.protokoll.filter((eintrag) => eintrag.art === "update")).toEqual([]);
  });

  test("gescheitert: eine Meldung, gemeldet: true", async () => {
    lege({ status: "queued" });

    expect(await jobs.failJob(JOB, "enqueue_failed")).toBe(true);

    expect(meldungen()).toEqual(["enqueue_failed"]);
    expect(auftrag().gemeldet).toBe(true);
  });

  test("ein zweiter Aufruf fuer denselben Endzustand meldet nicht noch einmal", async () => {
    lege({ status: "queued" });
    await jobs.failJob(JOB, "enqueue_failed");

    expect(await jobs.failJob(JOB, "processing_timeout")).toBe(false);

    expect(meldungen()).toEqual(["enqueue_failed"]);
    expect(auftrag().errorReason).toBe("enqueue_failed");
  });

  test("laesst sich der Vermerk gemeldet: true nicht schreiben, bleibt es bei der einen Meldung im Aufruf", async () => {
    lege({ status: "queued" });
    speicher.vor(({ art }) => {
      if (art === "update") throw new Error("UNAVAILABLE");
    });

    expect(await jobs.failJob(JOB, "enqueue_failed")).toBe(true);

    expect(meldungen()).toEqual(["enqueue_failed"]);
    expect(auftrag().gemeldet).toBe(false);
  });
});
