"use strict";

/* Die Betriebswerte der Functions im Einstiegspunkt (index.js) stehen fest
   (TEST-2026-10-03-42).

   Instanzgrenzen, Gleichzeitigkeit, erlaubte Herkuenfte, Region, Zeitplan des
   Aufraeumdienstes und die Bindung des KI-Schluessels liessen sich aendern,
   ohne dass eine Zeile rot wurde — erst der Betrieb haette es gezeigt:
     - mehr Instanzen am Einlass schwaechen die Sperre je Adresse (sie lebt im
       Arbeitsspeicher JEDER Instanz; SECURITY.md nennt die Instanzgrenze als
       Ausgleich dafuer)
     - der Verarbeiter rechnet genau einen Auftrag je Instanz
     - ein seltenerer Aufraeumdienst haelt Plaetze und Fotos laenger
     - ohne Schluessel am Verarbeiter scheitert jede Analyse
     - eine fremde Herkunft duerfte Antworten lesen

   Gelesen werden die Einstellungen so, wie index.js sie an Firebase uebergibt.
   Wer einen Wert bewusst aendert, aendert ihn hier mit — das ist der Zweck. */

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({ onRequest: jest.fn((_opts, handler) => handler) }));
jest.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: jest.fn((_opts, handler) => handler) }));
jest.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: jest.fn((_opts, handler) => handler) }));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const index = require("../index");
const { ALLOWED_ORIGINS } = require("../domains");
const { FUNCTION_LIMIT_MS } = require("../betriebsprofil-kopplung");

/* Die Einstellungen, mit denen eine Function angelegt wurde. */
function einstellungen(name) {
  for (const anleger of [onRequest, onSchedule, onDocumentWritten]) {
    const aufruf = anleger.mock.calls.find(([, handler]) => handler === index[name]);
    if (aufruf) return aufruf[0];
  }
  throw new Error(`Function ${name} nicht gefunden`);
}
const schluessel = (name) => (einstellungen(name).secrets || []).map((geheimnis) => geheimnis.name).sort();

const OEFFENTLICH = ["stats", "admin", "errors", "telemetry", "enqueue", "jobStatus"];
const ALLE = [...OEFFENTLICH, "processJob", "reapJobs", "erinnerung", "laufzeitWache", "satzWache"];

test("Messmittel: der Einstiegspunkt bietet genau die bekannten Functions", () => {
  expect(Object.keys(index).sort()).toEqual([...ALLE].sort());
});

test.each(ALLE)("%s laeuft in europe-west1", (name) => {
  expect(einstellungen(name).region).toBe("europe-west1");
});

describe("erlaubte Herkuenfte", () => {
  test("die Liste: genau die vier eigenen Adressen", () => {
    expect(ALLOWED_ORIGINS).toEqual([
      "https://malzi.me",
      "https://www.malzi.me",
      "https://malzime.web.app",
      "https://malzime.firebaseapp.com",
    ]);
  });

  test.each(OEFFENTLICH)("%s: oeffentlich, Antworten nur fuer die eigenen Herkuenfte", (name) => {
    expect(einstellungen(name).invoker).toBe("public");
    expect(einstellungen(name).cors).toBe(ALLOWED_ORIGINS);
  });
});

describe("Instanzgrenzen", () => {
  test.each([
    ["stats", 5],
    ["admin", 2],
    ["errors", 3],
    ["telemetry", 3],
    ["enqueue", 10],
    ["jobStatus", 10],
    ["processJob", 10],
  ])("%s: hoechstens %i Instanzen", (name, grenze) => {
    expect(einstellungen(name).maxInstances).toBe(grenze);
  });
});

describe("der Verarbeiter", () => {
  test("nicht oeffentlich, ein Auftrag je Instanz, keine Herkunftsfreigabe", () => {
    const e = einstellungen("processJob");
    expect(e.invoker).toBe("private");
    expect(e.concurrency).toBe(1);
    expect(e.cors).toBeUndefined();
  });

  test("traegt den KI-Schluessel — und nur ihn", () => {
    expect(schluessel("processJob")).toEqual(["MISTRAL_API_KEY_EU"]);
  });

  test("seine Zeitgrenze ist die, mit der die Satz-Pruefung rechnet", () => {
    expect(einstellungen("processJob").timeoutSeconds * 1000).toBe(FUNCTION_LIMIT_MS);
  });
});

describe("Schluessel der uebrigen Functions", () => {
  test.each([
    ["stats", []],
    ["errors", []],
    ["telemetry", []],
    ["jobStatus", []],
    ["admin", ["ADMIN_SECRET_EU"]],
    ["enqueue", ["ADMIN_SECRET_EU", "NTFY_TOPIC_EU", "NTFY_URL_EU"]],
  ])("%s: %j", (name, erwartet) => {
    expect(schluessel(name)).toEqual(erwartet);
  });

  test("der KI-Schluessel liegt an keiner oeffentlichen Function", () => {
    for (const name of OEFFENTLICH) expect(schluessel(name)).not.toContain("MISTRAL_API_KEY_EU");
  });
});

describe("Zeitplaene", () => {
  test("der Aufraeumdienst laeuft jede Minute", () => {
    expect(einstellungen("reapJobs").schedule).toBe("every 1 minutes");
  });
});
