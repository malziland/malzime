"use strict";

/* Jede Abweisung der Annahmestelle zaehlt mit ihrem Grund (dauerhafte Zaehler,
   16.10.2026, statistik.js) — und zwar BEVOR die Antwort hinausgeht: Was danach
   noch laeuft, kommt vielleicht nie an.

   Geprueft wird jede Ablehnungsstelle in handle-enqueue.js einzeln, dazu die
   drei Faelle, in denen NICHTS gezaehlt werden darf: Erfolg, falsche Methode
   (kein Hochladen) und ein Auftrag, der nach dem Anlegen scheitert (den zaehlt
   der Aufraeumdienst als gescheitert, sonst zaehlte er doppelt). */

jest.mock("../betriebsprofil", () => {
  const m = require("../test-satz").betriebsprofilMock();
  return { ...m, geltendeWerte: jest.fn(m.geltendeWerte) };
});
jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(),
  checkAndIncrement: jest.fn(),
  releaseHourlySlot: jest.fn(() => Promise.resolve()),
}));
jest.mock("../middleware", () => ({
  getClientIp: jest.fn(() => "1.2.3.4"),
  checkRateLimit: jest.fn(() => true),
}));
jest.mock("../jobs", () => ({
  createJob: jest.fn(),
  failJob: jest.fn(),
  countQueuedJobs: jest.fn(),
  platzBestaetigen: jest.fn(),
  getJob: jest.fn(async (id) => ({ id, status: "queued", createdAt: Date.now() })),
  abandonJob: jest.fn(async () => true),
  meldeGescheiterteAnalyse: jest.fn(),
}));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })) }));
jest.mock("../durchsatz", () => ({
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../queue-storage", () => ({
  neuerBildPfad: jest.fn(() => "queue-uploads/test.jpg"),
  storeImage: jest.fn(),
  deleteImage: jest.fn(async () => true),
}));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn() }));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn(() => Promise.resolve()) }));
jest.mock("../statistik", () => ({ zaehleAbweisung: jest.fn() }));

const betriebsprofil = require("../betriebsprofil");
const counter = require("../counter");
const middleware = require("../middleware");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const tasks = require("../cloud-tasks");
const statistik = require("../statistik");
const { handleEnqueue } = require("../handle-enqueue");

const VALID_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const SECRETS = {
  ntfyUrl: { value: () => "url" },
  ntfyTopic: { value: () => "topic" },
  adminSecret: { value: () => "secret" },
};

/* Reihenfolge von Zaehler und Antwort, in einem gemeinsamen Protokoll. */
let ablauf;

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      ablauf.push("antwort");
      this.body = body;
      return this;
    },
    setHeader() {},
  };
}

function jsonReq(body = {}, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://malzi.me", ...headers },
    body: { imageBase64: VALID_JPEG.toString("base64"), mimeType: "image/jpeg", lang: "de", ...body },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ablauf = [];
  statistik.zaehleAbweisung.mockReset().mockImplementation(async (grund) => {
    ablauf.push(`zaehler:${grund}`);
  });
  counter.getMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
  counter.checkAndIncrement.mockResolvedValue({ allowed: true, justReached: false, count: 1, limit: 1500 });
  middleware.checkRateLimit.mockReturnValue(true);
  jobs.createJob.mockReset().mockResolvedValue("job-abc");
  jobs.failJob.mockReset().mockResolvedValue(true);
  jobs.countQueuedJobs.mockReset().mockResolvedValue(0);
  jobs.platzBestaetigen.mockReset().mockResolvedValue(true);
  storage.storeImage.mockReset().mockResolvedValue("queue-uploads/test.jpg");
  tasks.enqueueJob.mockReset().mockResolvedValue("t");
  betriebsprofil.geltendeWerte
    .mockReset()
    .mockImplementation(require("../test-satz").betriebsprofilMock().geltendeWerte);
});

const echteWerte = () => require("../test-satz").betriebsprofilMock().geltendeWerte();

/* [Beschreibung, Vorbereitung, Anfrage, erwarteter Grund, erwarteter Status] */
const FAELLE = [
  [
    "Wartungsmodus",
    () => counter.getMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Wartung" }),
    () => jsonReq(),
    "wartung",
    503,
  ],
  [
    "kein Einstellungssatz (vor der Ratenbegrenzung)",
    () => betriebsprofil.geltendeWerte.mockImplementation(async () => ({ werte: null, grund: "kein Dokument" })),
    () => jsonReq(),
    "satzFehlt",
    503,
  ],
  [
    "Einlassgrenze 0 (Satz zwischen den zwei Lesungen weg)",
    () =>
      betriebsprofil.geltendeWerte
        .mockImplementationOnce(echteWerte)
        .mockImplementation(async () => ({ werte: null, grund: "kein Dokument" })),
    () => jsonReq(),
    "satzFehlt",
    503,
  ],
  ["Adresslimit", () => middleware.checkRateLimit.mockReturnValue(false), () => jsonReq(), "adresslimit", 429],
  ["Rumpf laut Kopfzeile zu gross", () => {}, () => jsonReq({}, { "content-length": "999999999" }), "zuGross", 413],
  [
    "Bilddaten zu gross",
    () => {},
    () => jsonReq({ imageBase64: "A".repeat(Math.ceil((require("../config").MAX_UPLOAD_BYTES * 4) / 3) + 8) }),
    "zuGross",
    413,
  ],
  ["kaputte Bilddaten", () => {}, () => jsonReq({ imageBase64: "!!!!" }), "ungueltig", 400],
  ["Honeypot", () => {}, () => jsonReq({ website: "http://spam" }), "honeypot", 403],
  ["falscher Dateityp", () => {}, () => jsonReq({ mimeType: "image/tiff" }), "ungueltig", 400],
  [
    "Inhalt ist kein Bild",
    () => {},
    () => jsonReq({ imageBase64: Buffer.alloc(24).toString("base64") }),
    "ungueltig",
    400,
  ],
  ["Inhalt passt nicht zum behaupteten Typ", () => {}, () => jsonReq({ mimeType: "image/png" }), "ungueltig", 400],
  [
    "Warteschlange voll (Vorpruefung)",
    () => jobs.countQueuedJobs.mockResolvedValue(100000),
    () => jsonReq(),
    "schlangeVoll",
    429,
  ],
  [
    "Stundenlimit",
    () =>
      counter.checkAndIncrement.mockResolvedValue({
        allowed: false,
        justReached: false,
        count: 500,
        limit: 500,
        retryAfterSeconds: 60,
      }),
    () => jsonReq(),
    "stundenlimit",
    429,
  ],
  [
    "Warteschlange voll (nachtraeglich, Auftrag schon angelegt)",
    () => jobs.platzBestaetigen.mockResolvedValue(false),
    () => jsonReq(),
    "schlangeVoll",
    429,
  ],
  [
    "Auftrag liess sich nicht anlegen",
    () => jobs.createJob.mockRejectedValue(new Error("Firestore weg")),
    () => jsonReq(),
    "anlegenGescheitert",
    503,
  ],
];

describe("Jede Abweisung zaehlt mit ihrem Grund, vor der Antwort", () => {
  test.each(FAELLE)("%s", async (_name, vorbereiten, anfrage, grund, status) => {
    vorbereiten();
    const res = makeRes();
    await handleEnqueue(anfrage(), res, SECRETS);
    expect(res.statusCode).toBe(status);
    expect(statistik.zaehleAbweisung).toHaveBeenCalledTimes(1);
    expect(statistik.zaehleAbweisung).toHaveBeenCalledWith(grund);
    expect(ablauf).toEqual([`zaehler:${grund}`, "antwort"]);
  });

  test("jeder Grund ist einer der bekannten (sonst zaehlte er als unbekannt)", () => {
    const { ABWEISUNGSGRUENDE } = jest.requireActual("../statistik");
    for (const [, , , grund] of FAELLE) expect(ABWEISUNGSGRUENDE).toContain(grund);
  });
});

describe("Hier zaehlt die Annahmestelle NICHTS", () => {
  test("Erfolg", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(200);
    expect(statistik.zaehleAbweisung).not.toHaveBeenCalled();
  });

  test("falsche Methode — kein Hochladen", async () => {
    const res = makeRes();
    await handleEnqueue({ method: "GET", headers: {} }, res, SECRETS);
    expect(res.statusCode).toBe(405);
    expect(statistik.zaehleAbweisung).not.toHaveBeenCalled();
  });

  test("Speichern scheitert NACH dem Anlegen: den Auftrag zaehlt der Aufraeumdienst als gescheitert", async () => {
    storage.storeImage.mockRejectedValue(new Error("Speicher weg"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(jobs.failJob).toHaveBeenCalledWith("job-abc", "store_failed");
    expect(statistik.zaehleAbweisung).not.toHaveBeenCalled();
  });

  test("Einreihen scheitert NACH dem Anlegen: ebenso", async () => {
    tasks.enqueueJob.mockRejectedValue(new Error("Cloud Tasks weg"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(statistik.zaehleAbweisung).not.toHaveBeenCalled();
  });
});
