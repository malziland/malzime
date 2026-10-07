"use strict";

/* Ein Foto bleibt nach einem Absturz nicht laenger liegen als im Normalweg
   (PRIV-2026-10-03-28).

   Zwei Wege:
   1. Der Verarbeiter stirbt, waehrend das Kind wartet. Die Statusabfrage setzt
      den Auftrag nach dem Zeitlimit auf "gescheitert" — und loescht dabei das
      Foto. Der Aufraeumdienst sucht nur haengende Auftraege und faende diesen
      danach nicht mehr.
   2. Der Einlass stirbt zwischen seinen zwei Schritten. Er legt deshalb zuerst
      den Auftrag an (mit dem vorab bestimmten Pfad des Fotos) und speichert das
      Foto erst danach: Ein Foto, das im Speicher liegt, hat immer einen Auftrag,
      der seinen Pfad kennt, und der Aufraeumdienst findet es ueber ihn.

   Echte Module: Einlass, Auftragsverwaltung, Aufraeumdienst, Foto-Ablage — gegen
   eine Datenbank und einen Speicher im Arbeitsspeicher. Nachgestellt sind
   Stundenzaehler, Warteschlange und Benachrichtigung. */

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
  releaseHourlySlot: jest.fn(async () => {}),
}));
jest.mock("../middleware", () => ({
  getClientIp: jest.fn(() => "test"),
  checkRateLimit: jest.fn(() => true),
}));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })) }));
jest.mock("../durchsatz", () => ({
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn(async () => "aufgabe") }));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn(async () => {}) }));

const { SATZ } = require("../test-satz");
const speicher = require("./hilfen/speicher-datenbank");
const counter = require("../counter");
const tasks = require("../cloud-tasks");
const storage = require("../queue-storage");
const jobs = require("../jobs");
const { handleEnqueue } = require("../handle-enqueue");
const { reapJobs } = require("../handle-reap");

/* ── Foto-Speicher im Arbeitsspeicher ── */

const dateien = new Map();
/* Was beim Speichern geschieht: "ok", "wirft" oder "haengt" (die Datei liegt
   dann im Speicher, der Aufruf kehrt aber nie zurueck — wie ein Prozess, der
   genau danach endet). */
let speichern = "ok";
/* Stand der Datenbank in dem Augenblick, in dem das Speichern beginnt. */
let auftraegeBeimSpeichern = null;

const bucket = {
  file: (pfad) => ({
    async save(buffer) {
      auftraegeBeimSpeichern = speicher.pfade("jobs").map((p) => speicher.lies(p));
      if (speichern === "wirft") throw new Error("Speicher nicht erreichbar");
      dateien.set(pfad, buffer);
      if (speichern === "haengt") await new Promise(() => {});
    },
    async delete() {
      if (!dateien.has(pfad)) {
        const fehler = new Error("No such object");
        fehler.code = 404;
        throw fehler;
      }
      dateien.delete(pfad);
    },
  }),
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const SECRETS = { ntfyUrl: { value: () => "" }, ntfyTopic: { value: () => "" }, adminSecret: { value: () => "" } };

function anfrage() {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://malzi.me" },
    body: { imageBase64: JPEG.toString("base64"), mimeType: "image/jpeg", lang: "de" },
  };
}

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
    setHeader() {},
  };
}

const auftraege = () => speicher.pfade("jobs").map((pfad) => speicher.lies(pfad));
const gescheitertZeilen = (spion) =>
  spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0])).filter((zeile) => zeile.alert === "analyse-gescheitert");

/* Wartet, bis eine Bedingung gilt: gibt der Laufzeit je Runde einmal das Wort. */
async function bis(bedingung) {
  for (let i = 0; i < 200 && !bedingung(); i += 1) await new Promise((weiter) => setTimeout(weiter, 0));
  expect(bedingung()).toBe(true);
}

let fehlerZeilen;

beforeEach(() => {
  speicher.leeren();
  /* Das Lebenszeichen der Wochen-Erinnerung, das der Aufraeumdienst mitliest. */
  speicher.lege("config/erinnerung", { letzterErfolg: Date.now() });
  dateien.clear();
  speichern = "ok";
  auftraegeBeimSpeichern = null;
  storage.setBucketForTest(bucket);
  counter.releaseHourlySlot.mockClear();
  tasks.enqueueJob.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  fehlerZeilen = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  storage.setBucketForTest(null);
  jest.restoreAllMocks();
});

describe("der Verarbeiter stirbt, waehrend das Kind wartet", () => {
  const PFAD = "queue-uploads/absturz.jpg";

  function haengenderAuftrag(seitMs) {
    speicher.lege("jobs/a1", {
      status: "processing",
      createdAt: Date.now() - seitMs,
      startedAt: Date.now() - seitMs,
      imagePath: PFAD,
    });
    dateien.set(PFAD, JPEG);
    return { id: "a1", ...speicher.lies("jobs/a1") };
  }

  test("die Statusabfrage setzt den Auftrag nach dem Zeitlimit auf gescheitert und loescht das Foto", async () => {
    const job = haengenderAuftrag(SATZ.verarbeitungsZeitlimitMs + 1000);

    const danach = await jobs.markFailedIfStale(job);

    expect(danach.status).toBe("failed");
    expect(speicher.lies("jobs/a1").status).toBe("failed");
    expect(dateien.has(PFAD)).toBe(false);
    expect(gescheitertZeilen(fehlerZeilen).map((zeile) => zeile.grund)).toEqual(["processing_timeout"]);
  });

  test("vor dem Zeitlimit bleibt alles, wie es ist: Der Verarbeiter braucht das Foto noch", async () => {
    const job = haengenderAuftrag(SATZ.verarbeitungsZeitlimitMs - 1000);

    const danach = await jobs.markFailedIfStale(job);

    expect(danach.status).toBe("processing");
    expect(dateien.has(PFAD)).toBe(true);
    expect(fehlerZeilen).not.toHaveBeenCalled();
  });

  test("hat der Verarbeiter inzwischen doch fertig geschrieben, fasst die Statusabfrage nichts an", async () => {
    const job = haengenderAuftrag(SATZ.verarbeitungsZeitlimitMs + 1000);
    speicher.lege("jobs/a1", { ...speicher.lies("jobs/a1"), status: "done", result: { meta: { mode: "human" } } });

    const danach = await jobs.markFailedIfStale(job);

    expect(danach.status).toBe("done");
    expect(dateien.has(PFAD)).toBe(true);
    expect(fehlerZeilen).not.toHaveBeenCalled();
  });
});

describe("der Einlass legt zuerst den Auftrag an und speichert dann das Foto", () => {
  test("Normalweg: Antwort 200, das Foto liegt unter dem Pfad, den der Auftrag kennt", async () => {
    const res = antwort();

    await handleEnqueue(anfrage(), res, SECRETS);

    expect(res.statusCode).toBe(200);
    const [auftrag] = auftraege();
    expect(auftraege()).toHaveLength(1);
    expect(auftrag.status).toBe("queued");
    expect(auftrag.imagePath).toMatch(/^queue-uploads\/[0-9a-f-]{36}\.jpg$/);
    expect([...dateien.keys()]).toEqual([auftrag.imagePath]);
    expect(tasks.enqueueJob).toHaveBeenCalledTimes(1);
    /* Als das Speichern begann, gab es den Auftrag schon — mit diesem Pfad. */
    expect(auftraegeBeimSpeichern.map((a) => a.imagePath)).toEqual([auftrag.imagePath]);
  });

  test("endet der Einlass waehrend des Speicherns, findet der Aufraeumdienst das Foto ueber den Auftrag", async () => {
    speichern = "haengt";
    const res = antwort();

    /* Kehrt nie zurueck — wie ein Prozess, der an dieser Stelle endet. */
    handleEnqueue(anfrage(), res, SECRETS);
    await bis(() => dateien.size === 1);

    expect(res.statusCode).toBeNull();
    const [auftrag] = auftraege();
    expect(auftraege()).toHaveLength(1);
    expect([...dateien.keys()]).toEqual([auftrag.imagePath]);

    /* Dieser Browser hat nie eine Kennung bekommen und fragt nie nach. Nach
       der Karenz raeumt der Aufraeumdienst den Auftrag ab — samt Foto und Platz
       im Stundenfenster. */
    const jetzt = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(jetzt + SATZ.livenessGnadenfristMs + 60 * 1000);
    const lauf = await reapJobs();

    expect(lauf.abandoned).toBe(1);
    expect(dateien.size).toBe(0);
    expect(auftraege()[0].status).toBe("abandoned");
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
  });

  test("scheitert das Speichern, endet der Auftrag als gescheitert: eine Meldung, kein Foto, Platz frei", async () => {
    speichern = "wirft";
    const res = antwort();

    await handleEnqueue(anfrage(), res, SECRETS);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Queue unavailable", code: "store_failed" });
    expect(auftraege().map((a) => [a.status, a.errorReason])).toEqual([["failed", "store_failed"]]);
    expect(dateien.size).toBe(0);
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
    expect(gescheitertZeilen(fehlerZeilen).map((zeile) => zeile.grund)).toEqual(["store_failed"]);
  });

  test("scheitert schon das Anlegen des Auftrags, wird das Foto gar nicht erst gespeichert", async () => {
    speicher.vor(({ art, pfad }) => {
      if (art === "set" && pfad.startsWith("jobs/")) throw new Error("Datenbank nicht erreichbar");
    });
    const res = antwort();

    await handleEnqueue(anfrage(), res, SECRETS);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Queue unavailable", code: "store_failed" });
    expect(auftraegeBeimSpeichern).toBeNull();
    expect(dateien.size).toBe(0);
    expect(auftraege()).toEqual([]);
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
    expect(gescheitertZeilen(fehlerZeilen).map((zeile) => zeile.grund)).toEqual(["store_failed"]);
  });
});

describe("der Pfad eines Fotos liegt immer im Fach, das die Ein-Tages-Regel des Speichers erfasst", () => {
  test("ein vorab bestimmter Pfad beginnt mit dem Fach und traegt die Endung des Bildtyps", () => {
    expect(storage.neuerBildPfad("image/png")).toMatch(/^queue-uploads\/[0-9a-f-]{36}\.png$/);
    expect(storage.neuerBildPfad("image/jpeg")).not.toBe(storage.neuerBildPfad("image/jpeg"));
  });

  test("ein Pfad ausserhalb des Fachs wird nicht beschrieben", async () => {
    await expect(storage.storeImage(JPEG, "image/jpeg", "anderswo/foto.jpg")).rejects.toThrow(/queue-uploads/);
    expect(dateien.size).toBe(0);
  });
});
