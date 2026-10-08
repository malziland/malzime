"use strict";

/* Gepackte Anfragen werden an jeder oeffentlichen Schnittstelle abgewiesen
   (SEC-2026-10-03-21).

   Der eigene Browser schickt nie einen gepackten Rumpf. Wer es tut, will einen
   winzigen Rumpf auf Hunderte Megabyte aufblaehen lassen. Die Laufzeit entpackt
   ihn, BEVOR unser Programm laeuft — das laesst sich hier nicht verhindern
   (docs/SECURITY-MODEL.md, Restrisiko 9). Was das Programm tun kann: sofort
   abweisen, nichts damit anfangen, und den Versuch ins Protokoll schreiben.

   Geprueft am echten Einstiegspunkt (index.js): Jede Function mit
   `invoker: "public"` wird aufgerufen. Eine neue Schnittstelle faellt damit
   automatisch unter die Pruefung. */

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({ onRequest: jest.fn((_opts, handler) => handler) }));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../handle-stats", () => ({ handleStats: jest.fn((req, res) => res.status(200).json({ ok: true })) }));
jest.mock("../handle-admin", () => ({ handleAdmin: jest.fn((req, res) => res.status(200).json({ ok: true })) }));
jest.mock("../handle-errors", () => ({ handleErrors: jest.fn((req, res) => res.status(200).json({ ok: true })) }));
jest.mock("../handle-telemetry", () => ({
  handleTelemetry: jest.fn((req, res) => res.status(200).json({ ok: true })),
}));
jest.mock("../handle-enqueue", () => ({ handleEnqueue: jest.fn((req, res) => res.status(200).json({ ok: true })) }));
jest.mock("../handle-job-status", () => ({
  handleJobStatus: jest.fn((req, res) => res.status(200).json({ ok: true })),
}));

const { onRequest } = require("firebase-functions/v2/https");
const index = require("../index");
const dahinter = [
  require("../handle-stats").handleStats,
  require("../handle-admin").handleAdmin,
  require("../handle-errors").handleErrors,
  require("../handle-telemetry").handleTelemetry,
  require("../handle-enqueue").handleEnqueue,
  require("../handle-job-status").handleJobStatus,
];

const OEFFENTLICH = Object.entries(index).filter(([, fn]) =>
  onRequest.mock.calls.some(([opts, handler]) => handler === fn && opts.invoker === "public")
);

function antwort() {
  return {
    kopf: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, wert) {
      this.kopf[name.toLowerCase()] = wert;
      return this;
    },
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

const anfrage = (kopfzeilen, rawBody) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...kopfzeilen },
  query: {},
  body: {},
  rawBody,
  path: "",
  ip: "203.0.113.7",
});

let warnung;
const zeilen = () => warnung.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));

beforeEach(() => {
  dahinter.forEach((fn) => fn.mockClear());
  jest.spyOn(console, "log").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* Messmittel-Kontrolle: Findet die Suche die bekannten Schnittstellen nicht,
   waere jede Pruefung darunter leer und damit wertlos gruen. */
test("die oeffentlichen Schnittstellen sind erfasst", () => {
  expect(OEFFENTLICH.map(([name]) => name).sort()).toEqual(
    ["admin", "enqueue", "errors", "jobStatus", "stats", "telemetry"].sort()
  );
});

describe.each(OEFFENTLICH)("%s", (_name, handler) => {
  test.each([["gzip"], ["GZIP"], [" gzip "], ["br"], ["deflate"], ["gzip, br"], ["x-unbekannt"]])(
    "Content-Encoding %p → 415, und dahinter laeuft nichts",
    async (kodierung) => {
      const res = antwort();

      await handler(anfrage({ "content-encoding": kodierung }, Buffer.alloc(4096)), res);

      expect(res.statusCode).toBe(415);
      expect(res.body).toEqual({ error: "Content-Encoding not supported" });
      expect(res.kopf["cache-control"]).toBe("no-store");
      dahinter.forEach((fn) => expect(fn).not.toHaveBeenCalled());
    }
  );

  test.each([
    ["ohne Kopfzeile", {}],
    ["identity", { "content-encoding": "identity" }],
    ["leer", { "content-encoding": "" }],
  ])("ungepackt (%s) → geht durch", async (_fall, kopfzeilen) => {
    const res = antwort();

    await handler(anfrage(kopfzeilen, Buffer.alloc(16)), res);

    expect(res.statusCode).toBe(200);
    expect(dahinter.filter((fn) => fn.mock.calls.length === 1)).toHaveLength(1);
    expect(warnung).not.toHaveBeenCalled();
  });
});

test("der Versuch steht als Warnung im Protokoll: nur die Groesse des entpackten Rumpfs, keine Adresse", async () => {
  await index.enqueue(anfrage({ "content-encoding": "gzip" }, Buffer.alloc(300000)), antwort());

  expect(zeilen()).toEqual([{ severity: "WARNING", warning: "gepackte-anfrage-abgewiesen", entpacktBytes: 300000 }]);
  expect(JSON.stringify(zeilen())).not.toContain("203.0.113.7");
});
