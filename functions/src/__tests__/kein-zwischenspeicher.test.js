"use strict";

/* PRIV-2026-09-10-06: Keine Antwort einer oeffentlichen Schnittstelle darf im
   Browser-Zwischenspeicher liegen bleiben — vor allem nicht das fertige Profil
   aus job-status. Die Datenschutzerklaerung sagt, dass nach dem Schliessen der
   Seite im Browser nichts mehr da ist.

   Geprueft wird am echten Einstiegspunkt (index.js), nicht an einem einzelnen
   Handler: Jede Function, die dort mit `invoker: "public"` entsteht, wird
   aufgerufen und muss `Cache-Control: no-store` senden. Eine neue
   Schnittstelle faellt damit automatisch unter die Pruefung. */

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts, handler) => handler),
}));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  markFailedIfStale: jest.fn(),
  touchJob: jest.fn(),
  markDelivered: jest.fn(),
}));

const { onRequest } = require("firebase-functions/v2/https");
const jobs = require("../jobs");
const index = require("../index");

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
    json(b) {
      this.body = b;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
    end() {
      return this;
    },
  };
}

/* Messmittel-Kontrolle: Findet die Suche die bekannten Schnittstellen nicht,
   waere jede Pruefung darunter leer und damit wertlos gruen. */
test("die oeffentlichen Schnittstellen sind erfasst", () => {
  expect(OEFFENTLICH.map(([name]) => name)).toEqual(
    expect.arrayContaining(["stats", "admin", "errors", "telemetry", "enqueue", "jobStatus"])
  );
});

test.each(OEFFENTLICH)("%s antwortet mit Cache-Control: no-store", async (_name, handler) => {
  const res = antwort();
  await handler({ method: "PATCH", headers: {}, query: {}, body: {}, path: "", ip: "kein-cache-test" }, res);
  expect(res.kopf["cache-control"]).toBe("no-store");
});

test("job-status: das fertige Profil geht mit no-store an den Browser", async () => {
  const jobId = "Aa1Bb2Cc3Dd4Ee5Ff6Gg";
  const profil = { profiles: { normal: { profileText: "T" } } };
  jobs.getJob.mockResolvedValue({ id: jobId, status: "done", resultToken: "ticket-1", result: profil, deliveredAt: 1 });
  const res = antwort();
  await index.jobStatus({ method: "GET", headers: {}, query: { jobId, token: "ticket-1" } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.result).toEqual(profil);
  expect(res.kopf["cache-control"]).toBe("no-store");
});
