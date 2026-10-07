"use strict";

/* Die zwei Nachrichten "kein gueltiger Einstellungssatz" sagen auch, was mit
   den liegenden Auftraegen geschieht (PRIV-2026-10-03-26): Wartende werden
   nicht abgeraeumt, geloescht wird weiter nach den zugesagten Fristen.

   Geprueft am echten Einstiegspunkt (index.js): die Wache am Dokument
   (satzWache) und die taegliche Pruefung (laufzeitWache). */

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({ onRequest: jest.fn((_opts, handler) => handler) }));
jest.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: jest.fn((_opts, handler) => handler) }));
jest.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: jest.fn((_opts, handler) => handler) }));
jest.mock("../betriebsprofil", () => ({
  ...jest.requireActual("../betriebsprofil"),
  geltendeWerte: jest.fn(),
  _cacheLeeren: jest.fn(),
}));
jest.mock("../notify", () => ({ sendeNtfy: jest.fn(async () => {}) }));
jest.mock("../laufzeit-wache", () => ({ pruefeLaufzeit: jest.fn(async () => ({ status: "ok" })) }));
jest.mock("../kapazitaets-wache", () => ({ pruefeKapazitaet: jest.fn(async () => ({ auffaellig: false })) }));
jest.mock("../cloud-tasks", () => ({
  warteschlangeNachziehen: jest.fn(async () => ({ ok: true, geaendert: false, parallel: 7, rate: 0.5 })),
}));

const { SATZ } = require("../test-satz");
const betriebsprofil = require("../betriebsprofil");
const { sendeNtfy } = require("../notify");
const index = require("../index");

const HINWEIS = "geloescht wird weiter nach den festen Fristen (2 Stunden, 15 Minuten nach der Abholung)";

const texte = () => sendeNtfy.mock.calls.map((aufruf) => aufruf[0].text);

beforeEach(() => {
  sendeNtfy.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ohne gueltigen Einstellungssatz", () => {
  beforeEach(() => {
    betriebsprofil.geltendeWerte.mockResolvedValue({
      werte: null,
      quelle: "fehlt",
      profil: null,
      grund: "kein Dokument",
    });
  });

  test("die Wache am Dokument nennt, was mit den liegenden Auftraegen geschieht", async () => {
    await index.satzWache();

    expect(texte()).toHaveLength(1);
    expect(texte()[0]).toContain("UNGUELTIG");
    expect(texte()[0]).toContain("Wartende Auftraege werden solange nicht abgeraeumt");
    expect(texte()[0]).toContain(HINWEIS);
  });

  test("die taegliche Pruefung nennt es ebenfalls", async () => {
    await index.laufzeitWache();

    const ohneSatz = texte().filter((text) => text.includes("KEIN gueltiger Einstellungssatz"));
    expect(ohneSatz).toHaveLength(1);
    expect(ohneSatz[0]).toContain(HINWEIS);
  });
});

describe("mit gueltigem Einstellungssatz", () => {
  beforeEach(() => {
    betriebsprofil.geltendeWerte.mockResolvedValue({
      werte: { ...SATZ },
      quelle: "firestore",
      profil: "test",
      grund: null,
    });
  });

  test("die Wache am Dokument meldet die Uebernahme ohne diesen Hinweis", async () => {
    await index.satzWache();

    expect(texte()).toHaveLength(1);
    expect(texte()[0]).toContain("uebernommen");
    expect(texte()[0]).not.toContain("nicht abgeraeumt");
  });

  test("die taegliche Pruefung schickt keine Nachricht zum Einstellungssatz", async () => {
    await index.laufzeitWache();

    expect(texte().filter((text) => text.includes("Einstellungssatz"))).toEqual([]);
  });
});
