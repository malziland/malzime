/**
 * einlass-ohne-satz-echt.test.js — der Einlass mit der ECHTEN Middleware.
 *
 * BEFUND 01.09.2026, gefunden in der Simulation (Emulator, echtes Foto):
 * Ohne Einstellungssatz antwortete der Einlass mit HTTP 500 "unknown_error"
 * statt mit dem freundlichen 503. Ursache: `checkRateLimit` wirft
 * ("adressLimit fehlt"), und dieser Aufruf steht VOR dem 503-Riegel — der kam
 * nie dran. Das Kind saehe damit wieder die falsche Meldung, obwohl der
 * richtige Text seit heute vorhanden ist.
 *
 * WARUM KEIN TEST DAS GEFUNDEN HAT: `handle-enqueue.test.js` ersetzt die
 * Middleware durch eine Attrappe, die immer `true` liefert
 * (`checkRateLimit: jest.fn(() => true)`). Die echte lief in keinem Test.
 * Ein Test, der alles ersetzt, prueft am Ende nur seine eigenen Attrappen.
 *
 * Diese Datei nutzt die ECHTE Middleware. Sie ersetzt nur, was nach aussen
 * wirkt: Firestore, Bildspeicher, Warteschlange.
 */

jest.mock("../betriebsprofil", () => ({
  geltendeWerte: jest.fn(async () => ({ werte: null, quelle: "fehlt", grund: "kein Dokument" })),
}));
jest.mock("../queue-storage", () => ({
  storeImage: jest.fn(async () => "queue-uploads/x.jpg"),
  deleteImage: jest.fn(async () => true),
}));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn(async () => "task-1") }));
jest.mock("../jobs", () => ({
  createJob: jest.fn(async () => "job-1"),
  countQueuedJobs: jest.fn(async () => 0),
}));
/* getMaintenanceStatus liegt in counter.js, nicht in einem eigenen Modul. */
jest.mock("../counter", () => ({
  checkAndIncrement: jest.fn(async () => ({ allowed: true, count: 1, limit: 155 })),
  releaseHourlySlot: jest.fn(async () => {}),
  getMaintenanceStatus: jest.fn(async () => ({ enabled: false })),
}));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn(async () => {}) }));

const { handleEnqueue } = require("../handle-enqueue");
const queueStorage = require("../queue-storage");
const jobs = require("../jobs");

/** Eine Antwort-Attrappe, die Status und Rumpf festhält. */
function antwort() {
  const a = { status_: null, json_: null, headers: {} };
  a.status = (s) => {
    a.status_ = s;
    return a;
  };
  a.json = (j) => {
    a.json_ = j;
    return a;
  };
  a.set = (k, v) => {
    a.headers[k] = v;
    return a;
  };
  a.setHeader = a.set;
  a.end = () => a;
  return a;
}

/** Eine Anfrage mit einem winzigen, gültigen Bild. */
function anfrage() {
  /* Ein 1×1-JPEG reicht: Geprüft wird der Weg, nicht das Bild. */
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
      "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64"
  ).toString("base64");
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: {
      imageBase64: jpeg,
      exif: {},
      mimeType: "image/jpeg",
      filename: "probe.jpg",
      lang: "de",
      traceId: "test",
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("Einlass ohne Einstellungssatz — mit der echten Middleware", () => {
  test("antwortet 503 mit configMissing, nicht 500", async () => {
    const res = antwort();
    await handleEnqueue(anfrage(), res, {});

    expect(res.status_).toBe(503);
    expect(res.json_).toMatchObject({ blocked: "configMissing" });
  });

  test("und speichert dabei KEIN Bild", async () => {
    /* Der eigentliche Grund für den Riegel: Ein Foto, das nie analysiert
       wird, soll nie auf dem Speicher liegen. */
    const res = antwort();
    await handleEnqueue(anfrage(), res, {});

    expect(queueStorage.storeImage).not.toHaveBeenCalled();
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  test("die Antwort nennt eine Wartezeit, damit der Client nicht sofort wiederkommt", async () => {
    const res = antwort();
    await handleEnqueue(anfrage(), res, {});

    expect(res.json_.retryAfterSeconds).toBeGreaterThan(0);
  });
});
