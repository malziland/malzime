"use strict";

/* Was geschrieben werden soll, ist geschrieben, BEVOR die Antwort hinausgeht
   (BUG-2026-10-03-29).

   Nach der Antwort drosselt die Plattform die Instanz; was dann noch laeuft,
   kommt vielleicht nie an (SECURITY-MODEL, "Jeder eingelassene Auftrag zaehlt
   genau einmal"). Sechs Schreibvorgaenge liefen trotzdem erst nach der Antwort
   zu Ende:

     Abholen       der Vermerk "abgeholt" — an ihm haengt die Loeschung des
                   Ergebnisses 15 Minuten nach der Abholung
     Verarbeiter   Tageszaehler, Dauer-Messung, Freigabe des Stundenplatzes
                   eines verlassenen Auftrags
     Einlass       Freigabe des Stundenplatzes in den drei Abbruchzweigen

   Geprueft wird der Stand IM AUGENBLICK DES SENDENS. Echte Module: Abholen,
   Verarbeiter, Einlass, Auftragsverwaltung — gegen eine Datenbank im
   Arbeitsspeicher. Nachgestellt sind Zaehler, Messung, Analyse und Speicher;
   die Zaehler-Attrappen brauchen absichtlich einen Moment. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(async () => ({ enabled: false, message: "" })),
  checkAndIncrement: jest.fn(async () => ({
    allowed: true,
    justReached: false,
    count: 1,
    limit: 500,
    stempel: 4711.5,
  })),
  releaseHourlySlot: jest.fn(),
  incrementTotals: jest.fn(),
  zaehlerNachtragen: jest.fn(async () => true),
}));
jest.mock("../durchsatz", () => ({
  merkeDauer: jest.fn(),
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })) }));
jest.mock("../job-pipelines", () => ({ runPipeline: jest.fn() }));
jest.mock("../queue-storage", () => ({
  neuerBildPfad: jest.fn(() => "queue-uploads/x.jpg"),
  storeImage: jest.fn(async () => "queue-uploads/x.jpg"),
  deleteImage: jest.fn(async () => true),
}));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn(async () => "aufgabe"), redispatchJobLocal: jest.fn() }));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn(async () => {}) }));
jest.mock("../middleware", () => ({ getClientIp: jest.fn(() => "test"), checkRateLimit: jest.fn(() => true) }));

const { SATZ } = require("../test-satz");
const speicher = require("./hilfen/speicher-datenbank");
const counter = require("../counter");
const durchsatz = require("../durchsatz");
const pipelines = require("../job-pipelines");
const storage = require("../queue-storage");
const tasks = require("../cloud-tasks");
const { handleJobStatus } = require("../handle-job-status");
const { handleProcessJob } = require("../handle-process-job");
const { handleEnqueue } = require("../handle-enqueue");

const JOB = "A".repeat(20);
const TICKET = "ticket-1";
const ERGEBNIS = {
  profiles: { normal: { profileText: "Text", categories: {} }, boost: { profileText: "Text", categories: {} } },
  privacyRisks: [],
  exif: {},
  meta: { traceId: null, mode: "human" },
};

/* Ein Schreibvorgang, der einen Moment braucht. `fertig` sagt, ob er durch ist. */
function langsam(attrappe) {
  const stand = { fertig: false, gerufen: 0 };
  attrappe.mockReset().mockImplementation(
    () =>
      new Promise((weiter) => {
        stand.gerufen += 1;
        setTimeout(() => {
          stand.fertig = true;
          weiter();
        }, 15);
      })
  );
  return stand;
}

/* Eine Antwort, die im Augenblick des Sendens festhaelt, was der Test wissen will. */
function antwort(beimSenden) {
  return {
    statusCode: null,
    body: null,
    gesehen: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.gesehen = beimSenden();
      return this;
    },
    setHeader() {},
  };
}

let warnung;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));

beforeEach(() => {
  speicher.leeren();
  jest.clearAllMocks();
  counter.releaseHourlySlot.mockReset().mockResolvedValue();
  counter.incrementTotals.mockReset().mockResolvedValue();
  durchsatz.merkeDauer.mockReset().mockResolvedValue();
  tasks.enqueueJob.mockReset().mockResolvedValue("aufgabe");
  storage.storeImage.mockReset().mockResolvedValue("queue-uploads/x.jpg");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Abholen: der Vermerk steht, bevor das Ergebnis hinausgeht", () => {
  const abholen = (res) => handleJobStatus({ method: "GET", query: { jobId: JOB, token: TICKET } }, res);
  const fertigerAuftrag = () =>
    speicher.lege(`jobs/${JOB}`, {
      status: "done",
      createdAt: Date.now() - 60000,
      finishedAt: Date.now() - 1000,
      deliveredAt: null,
      resultToken: TICKET,
      result: ERGEBNIS,
    });

  test("im Augenblick des Sendens ist der Zeitpunkt der Abholung gespeichert", async () => {
    fertigerAuftrag();
    const res = antwort(() => speicher.lies(`jobs/${JOB}`).deliveredAt);

    await abholen(res);

    expect(res.body.status).toBe("done");
    expect(res.body.result).toEqual(ERGEBNIS);
    expect(typeof res.gesehen).toBe("number");
    expect(typeof speicher.lies(`jobs/${JOB}`).rcTicketHash).toBe("string");
  });

  test("scheitert das Speichern einmal, gelingt der zweite Versuch — ohne Meldung", async () => {
    fertigerAuftrag();
    let fehlschlaege = 1;
    speicher.vor(({ art }) => {
      if (art === "update" && fehlschlaege > 0) {
        fehlschlaege -= 1;
        throw new Error("UNAVAILABLE");
      }
    });
    const res = antwort(() => speicher.lies(`jobs/${JOB}`).deliveredAt);

    await abholen(res);

    expect(res.body.result).toEqual(ERGEBNIS);
    expect(typeof res.gesehen).toBe("number");
    expect(warnung).not.toHaveBeenCalled();
  });

  test("scheitert es zweimal, bekommt das Kind sein Ergebnis trotzdem — und es steht eine Warnung im Protokoll", async () => {
    fertigerAuftrag();
    speicher.vor(({ art }) => {
      if (art === "update") throw Object.assign(new Error("UNAVAILABLE jobs/geheim"), { code: 14 });
    });
    const res = antwort(() => speicher.lies(`jobs/${JOB}`).deliveredAt);

    await abholen(res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toEqual(ERGEBNIS);
    expect(res.gesehen).toBeNull();
    const warnungen = zeilen(warnung);
    expect(warnungen).toEqual([{ severity: "WARNING", warning: "markDelivered-error", code: 14, art: "Error" }]);
  });

  test("ein zweites Abholen schreibt nicht noch einmal", async () => {
    fertigerAuftrag();
    await abholen(antwort(() => null));
    const erster = speicher.lies(`jobs/${JOB}`);

    const res = antwort(() => null);
    await abholen(res);

    expect(res.body.result).toEqual(ERGEBNIS);
    expect(res.body.rcTicket).toBeUndefined();
    expect(speicher.lies(`jobs/${JOB}`)).toEqual(erster);
  });
});

describe("Verarbeiter: Zaehler und Messung sind durch, bevor er der Warteschlange antwortet", () => {
  const verarbeiten = (res) => handleProcessJob({ method: "POST", body: { jobId: JOB }, headers: {} }, res);
  const wartenderAuftrag = (ueberschreiben) =>
    speicher.lege(`jobs/${JOB}`, {
      status: "queued",
      createdAt: Date.now() - 5000,
      lastSeenAt: Date.now() - 1000,
      imagePath: "queue-uploads/x.jpg",
      zaehlerStempel: 4711.5,
      resultToken: TICKET,
      ...ueberschreiben,
    });

  test("erfolgreiche Analyse: Tageszaehler und Dauer-Messung sind geschrieben", async () => {
    wartenderAuftrag();
    pipelines.runPipeline.mockResolvedValue({ result: ERGEBNIS, success: true });
    const zaehler = langsam(counter.incrementTotals);
    const messung = langsam(durchsatz.merkeDauer);
    const res = antwort(() => ({ zaehler: zaehler.fertig, messung: messung.fertig }));

    await verarbeiten(res);

    expect(res.body).toEqual({ ok: true });
    expect(res.gesehen).toEqual({ zaehler: true, messung: true });
    expect(speicher.lies(`jobs/${JOB}`).status).toBe("done");
  });

  test("das Ergebnis steht schon in der Datenbank, waehrend Zaehler und Messung noch schreiben", async () => {
    wartenderAuftrag();
    pipelines.runPipeline.mockResolvedValue({ result: ERGEBNIS, success: true });
    let statusBeimZaehlen = null;
    counter.incrementTotals.mockImplementation(async () => {
      statusBeimZaehlen = speicher.lies(`jobs/${JOB}`).status;
    });

    await verarbeiten(antwort(() => null));

    /* Das Kind wartet auf das Ergebnis, nicht auf die Zaehler. */
    expect(statusBeimZaehlen).toBe("done");
  });

  test("blockiertes Ergebnis: weder gezaehlt noch gemessen", async () => {
    wartenderAuftrag();
    pipelines.runPipeline.mockResolvedValue({
      result: {
        profiles: null,
        blockedReason: "blocked.apiError",
        privacyRisks: [],
        exif: {},
        meta: { mode: "blocked" },
      },
      success: false,
    });

    await verarbeiten(antwort(() => null));

    expect(counter.incrementTotals).not.toHaveBeenCalled();
    expect(durchsatz.merkeDauer).not.toHaveBeenCalled();
  });

  test("verlassener Auftrag: der Stundenplatz ist freigegeben", async () => {
    wartenderAuftrag({ lastSeenAt: Date.now() - SATZ.livenessGnadenfristMs - 1000 });
    const freigabe = langsam(counter.releaseHourlySlot);
    const res = antwort(() => freigabe.fertig);

    await verarbeiten(res);

    expect(res.body).toEqual({ ok: false, reason: "abandoned" });
    expect(res.gesehen).toBe(true);
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
    expect(pipelines.runPipeline).not.toHaveBeenCalled();
  });
});

describe("Einlass: der Stundenplatz ist freigegeben, bevor die Absage hinausgeht", () => {
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");
  const SECRETS = { ntfyUrl: { value: () => "" }, ntfyTopic: { value: () => "" }, adminSecret: { value: () => "" } };
  const hochladen = (res) =>
    handleEnqueue(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { imageBase64: JPEG, mimeType: "image/jpeg" },
      },
      res,
      SECRETS
    );

  test.each([
    [
      "Speichern scheitert",
      () => storage.storeImage.mockRejectedValue(new Error("Speicher nicht erreichbar")),
      503,
      { error: "Queue unavailable", code: "store_failed" },
    ],
    [
      "Einreihen scheitert",
      () => tasks.enqueueJob.mockRejectedValue(new Error("Warteschlange nicht erreichbar")),
      503,
      { error: "Queue unavailable", code: "enqueue_failed" },
    ],
    [
      "Warteschlange nachtraeglich voll",
      () => {
        /* Ein aelterer wartender Auftrag je Platz bis zur Grenze: Der neue kommt zu spaet. */
        for (let i = 0; i < SATZ.warteschlangeTiefe; i += 1)
          speicher.lege(`jobs/alt-${i}`, { status: "queued", createdAt: 1 });
        /* Die Vorpruefung sieht die Schlange noch nicht (sie zaehlt, bevor die anderen da sind). */
        let ersteZaehlung = true;
        speicher.vor(({ art }) => {
          if (art === "zaehlen" && ersteZaehlung) {
            ersteZaehlung = false;
            throw new Error("Zaehlung nicht moeglich");
          }
        });
      },
      429,
      expect.objectContaining({ blocked: "queueFull" }),
    ],
  ])("%s", async (_fall, stoerung, status, rumpf) => {
    stoerung();
    const freigabe = langsam(counter.releaseHourlySlot);
    const res = antwort(() => freigabe.fertig);

    await hochladen(res);

    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual(rumpf);
    expect(freigabe.gerufen).toBe(1);
    expect(res.gesehen).toBe(true);
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
  });

  test("Normalweg: Annahme ohne Freigabe", async () => {
    const res = antwort(() => null);

    await hochladen(res);

    expect(res.statusCode).toBe(200);
    expect(counter.releaseHourlySlot).not.toHaveBeenCalled();
  });

  test("scheitert die Freigabe selbst, geht die Absage trotzdem hinaus", async () => {
    storage.storeImage.mockRejectedValue(new Error("Speicher nicht erreichbar"));
    counter.releaseHourlySlot.mockRejectedValue(new Error("Zaehler nicht erreichbar"));
    const res = antwort(() => null);

    await hochladen(res);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("store_failed");
  });
});
