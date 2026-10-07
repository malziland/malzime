"use strict";

/* Abmelden über die Adressgrenze (Prüfrunde 07.10.2026).

   Im Betrieb ruft die Seite die Statusabfrage unter einer ANDEREN Adresse auf
   als die Website (public/js/api-basis.js: direkt beim Server in der EU). Vor
   jedem DELETE stellt der Browser deshalb eine Vorab-Anfrage. Lehnt der Rahmen
   der Schnittstelle sie ab, geht das DELETE nie hinaus — und zwar still: Das
   Abmelden schluckt jeden Fehler (public/js/api.js, meldeAuftragAb). Ein
   verworfenes Foto würde dann wieder analysiert, und jeder andere Test bliebe
   grün, weil sie den Rahmen ersetzen oder den Aufruf im Browser abfangen.

   Deshalb hier der ECHTE Rahmen: die Schnittstelle, wie index.js sie
   ausliefert (mit ihrer Einstellung für fremde Ursprünge), an einem echten
   Server auf 127.0.0.1. Nur was an die Datenbank und den Speicher ginge, ist
   Attrappe. Geprüft wird:
   - die Vorab-Anfrage der eigenen Seite wird beantwortet und erlaubt DELETE;
   - das DELETE der eigenen Seite kommt an, wirkt und trägt die Erlaubnis für
     den Ursprung (sonst verwürfe der Browser die Antwort);
   - ohne richtiges Ticket wirkt es nicht — das Ticket ist der Schutz, nicht
     der Ursprung (docs/SECURITY-MODEL.md);
   - eine fremde Seite bekommt keine Erlaubnis für ihren Ursprung. */

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
/* Der Rahmen lädt beim Start auch die Prüfung von Anmelde-Tokens; deren
   Schlüssel-Abruf liegt nur als ES-Modul vor und lässt sich hier nicht laden.
   Die Schnittstelle ist öffentlich und prüft kein Token — der Rest des
   Rahmens (und damit die Behandlung fremder Ursprünge) bleibt der echte. */
jest.mock("jwks-rsa", () => ({}));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  markFailedIfStale: jest.fn(),
  touchJob: jest.fn(),
  markDelivered: jest.fn(),
  abandonJob: jest.fn(),
}));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn(async () => {}) }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));

const http = require("http");
const express = require("express");
const jobs = require("../jobs");
const { deleteImage } = require("../queue-storage");
const { ALLOWED_ORIGINS } = require("../domains");
const index = require("../index");

const JOB_ID = "Aa1Bb2Cc3Dd4Ee5Ff6Gg";
const TICKET = "abhol-ticket";
const EIGENE_SEITE = "https://malzi.me";
const FREMDE_SEITE = "https://fremd.example";

let server;
let port;

beforeAll(async () => {
  const app = express();
  app.use((req, res) => index.jobStatus(req, res));
  server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((fertig) => server.close(fertig));
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jobs.getJob.mockResolvedValue({
    id: JOB_ID,
    status: "queued",
    resultToken: TICKET,
    zaehlerStempel: 1,
    imagePath: "queue/x.jpg",
  });
  jobs.abandonJob.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ruf(method, headers, token = TICKET) {
  return new Promise((fertig, fehler) => {
    const anfrage = http.request(
      { host: "127.0.0.1", port, path: `/api/job-status?jobId=${JOB_ID}&token=${token}`, method, headers },
      (antwort) => {
        let rumpf = "";
        antwort.on("data", (stueck) => (rumpf += stueck));
        antwort.on("end", () => fertig({ status: antwort.statusCode, kopf: antwort.headers, rumpf }));
      }
    );
    anfrage.on("error", fehler);
    anfrage.end();
  });
}

test("die eigene Seite steht auf der Liste der erlaubten Ursprünge (Messmittel-Kontrolle)", () => {
  expect(ALLOWED_ORIGINS).toContain(EIGENE_SEITE);
  expect(typeof index.jobStatus).toBe("function");
});

test("Vorab-Anfrage der eigenen Seite: beantwortet, DELETE erlaubt", async () => {
  const antwort = await ruf("OPTIONS", { Origin: EIGENE_SEITE, "Access-Control-Request-Method": "DELETE" });

  expect(antwort.status).toBe(204);
  expect(antwort.kopf["access-control-allow-origin"]).toBe(EIGENE_SEITE);
  expect(antwort.kopf["access-control-allow-methods"]).toMatch(/\bDELETE\b/);
  expect(jobs.abandonJob).not.toHaveBeenCalled();
});

test("DELETE der eigenen Seite mit Ticket: kommt an, verwirft den Auftrag, löscht das Foto", async () => {
  const antwort = await ruf("DELETE", { Origin: EIGENE_SEITE });

  expect(antwort.status).toBe(200);
  expect(JSON.parse(antwort.rumpf)).toEqual({ verworfen: true });
  expect(antwort.kopf["access-control-allow-origin"]).toBe(EIGENE_SEITE);
  expect(antwort.kopf["cache-control"]).toContain("no-store");
  expect(jobs.abandonJob).toHaveBeenCalledTimes(1);
  expect(deleteImage).toHaveBeenCalledWith("queue/x.jpg");
});

test("DELETE mit falschem Ticket: abgelehnt, nichts wird verworfen", async () => {
  const antwort = await ruf("DELETE", { Origin: EIGENE_SEITE }, "falsch");

  expect(antwort.status).toBe(403);
  expect(jobs.abandonJob).not.toHaveBeenCalled();
  expect(deleteImage).not.toHaveBeenCalled();
});

test("Vorab-Anfrage einer fremden Seite: keine Erlaubnis für ihren Ursprung", async () => {
  const antwort = await ruf("OPTIONS", { Origin: FREMDE_SEITE, "Access-Control-Request-Method": "DELETE" });

  expect(antwort.kopf["access-control-allow-origin"]).toBeUndefined();
  expect(jobs.abandonJob).not.toHaveBeenCalled();
});
