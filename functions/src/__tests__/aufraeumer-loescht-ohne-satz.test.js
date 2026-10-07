"use strict";

/* Die zwei Loeschfristen des Aufraeumdienstes haengen nicht am Einstellungssatz
   (PRIV-2026-10-03-26).

   Ohne gueltigen Einstellungssatz laeuft keine Analyse — das ist gewollt. Das
   LOESCHEN darf davon nicht abhaengen: Ein abgeholtes Ergebnis ist spaetestens
   15 Minuten nach der Abholung weg, jeder Auftrag spaetestens nach 2 Stunden.
   Beide Zahlen sind die Obergrenzen, die betriebsprofil.js als Zusage fuehrt;
   fehlt der Satz, gelten sie selbst.

   Hier laufen der echte Aufraeumdienst, die echte Auftragsverwaltung und das
   echte Lesen des Einstellungssatzes gegen eine Datenbank im Arbeitsspeicher.
   Grenzfall (ausschliesslich, wie im Normalbetrieb): geloescht wird, was AELTER
   ist als die Frist — Beispiele je eine Minute darunter und darueber. */

jest.mock("../db", () => ({ datenbank: () => mockDatenbank }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn(async () => {}) }));

const { SATZ } = require("../test-satz");

/* ── Datenbank im Arbeitsspeicher ── */

const mockAuftraege = new Map();
/* Was unter config/betriebsprofil liegt: ein Objekt, `null` (kein Dokument) oder
   ein Error (der Lesezugriff scheitert). */
let mockSatzDokument = null;

function mockPasst(daten, bedingung) {
  const wert = daten[bedingung.feld];
  if (bedingung.op === "==") return wert === bedingung.wert;
  /* Wie Firestore: Bei Ungleichungen fallen Dokumente ohne Wert heraus. */
  if (wert === null || wert === undefined) return false;
  if (bedingung.op === "<") return wert < bedingung.wert;
  throw new Error(`Vergleich "${bedingung.op}" ist in dieser Attrappe nicht nachgebildet`);
}

function mockAbfrage(bedingungen, grenze) {
  return {
    where: (feld, op, wert) => mockAbfrage([...bedingungen, { feld, op, wert }], grenze),
    limit: (n) => mockAbfrage(bedingungen, n),
    async get() {
      let treffer = [...mockAuftraege.entries()].filter(([, daten]) => bedingungen.every((b) => mockPasst(daten, b)));
      if (grenze != null) treffer = treffer.slice(0, grenze);
      return { docs: treffer.map(([id, daten]) => ({ id, data: () => daten })) };
    },
  };
}

const mockDatenbank = {
  doc: (pfad) => ({
    async get() {
      if (pfad === "config/erinnerung") return { exists: true, data: () => ({ letzterErfolg: Date.now() }) };
      if (pfad !== "config/betriebsprofil") throw new Error(`unerwartetes Dokument ${pfad}`);
      if (mockSatzDokument instanceof Error) throw mockSatzDokument;
      return { exists: mockSatzDokument !== null, data: () => mockSatzDokument };
    },
  }),
  collection: () => ({
    where: (feld, op, wert) => mockAbfrage([{ feld, op, wert }]),
    doc: (id) => ({
      async delete() {
        mockAuftraege.delete(id);
      },
    }),
  }),
};

const { deleteImage } = require("../queue-storage");
const betriebsprofil = require("../betriebsprofil");
const { reapJobs } = require("../handle-reap");

const MINUTE = 60 * 1000;
const STUNDE = 60 * MINUTE;

const gueltig = (ueberschreiben) => ({ aktiv: "test", profile: { test: { ...SATZ, ...ueberschreiben } } });
/* Ein Satz, den die Pruefung ablehnt: Die Frist liegt ueber der Zusage. */
const ABGELEHNT = gueltig({ jobAufbewahrungMs: 3 * STUNDE });

function lege(id, daten) {
  mockAuftraege.set(id, { status: "done", createdAt: Date.now() - 30 * MINUTE, deliveredAt: null, ...daten });
}

let warnung;

beforeEach(() => {
  mockAuftraege.clear();
  mockSatzDokument = null;
  deleteImage.mockClear();
  betriebsprofil._cacheLeeren();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const warnNamen = () =>
  warnung.mock.calls
    .map((aufruf) => JSON.parse(aufruf[0]).warning)
    .filter(Boolean)
    .sort();

describe.each([
  ["kein Dokument", () => null],
  ["abgelehnter Satz", () => ABGELEHNT],
  ["Lesezugriff scheitert", () => new Error("UNAVAILABLE")],
])("Aufraeumdienst ohne gueltigen Einstellungssatz (%s)", (_name, satz) => {
  beforeEach(() => {
    mockSatzDokument = satz();
  });

  test("ein vor 20 Minuten abgeholtes Ergebnis wird geloescht, ein vor 14 Minuten abgeholtes bleibt", async () => {
    lege("abgeholt-20", { deliveredAt: Date.now() - 20 * MINUTE });
    lege("abgeholt-14", { deliveredAt: Date.now() - 14 * MINUTE });

    const ergebnis = await reapJobs();

    expect(ergebnis.zugestellt).toBe(1);
    expect(mockAuftraege.has("abgeholt-20")).toBe(false);
    expect(mockAuftraege.has("abgeholt-14")).toBe(true);
  });

  test("ein drei Stunden alter Auftrag wird samt Foto geloescht, ein 119 Minuten alter bleibt", async () => {
    lege("alt", { status: "queued", createdAt: Date.now() - 3 * STUNDE, imagePath: "queue-uploads/alt.jpg" });
    lege("jung", { status: "queued", createdAt: Date.now() - 119 * MINUTE, imagePath: "queue-uploads/jung.jpg" });

    const ergebnis = await reapJobs();

    expect(ergebnis.expired).toBe(1);
    expect(mockAuftraege.has("alt")).toBe(false);
    expect(mockAuftraege.has("jung")).toBe(true);
    expect(deleteImage.mock.calls.map((aufruf) => aufruf[0])).toEqual(["queue-uploads/alt.jpg"]);
  });

  test("die drei Abfragen nach wartenden und haengenden Auftraegen warnen weiter, die zwei Loeschabfragen nicht", async () => {
    await reapJobs();

    expect(warnNamen()).toEqual([
      "reap-query-ohne-betriebswerte:abandoned",
      "reap-query-ohne-betriebswerte:stale",
      "reap-query-ohne-betriebswerte:ueberfaellig",
    ]);
  });
});

describe("Aufraeumdienst mit gueltigem Einstellungssatz", () => {
  test("der Satz gilt, nicht die Obergrenze: Fenster 5 Minuten loescht ein vor 6 Minuten abgeholtes Ergebnis", async () => {
    mockSatzDokument = gueltig({ zustellfensterMs: 5 * MINUTE });
    lege("abgeholt-6", { deliveredAt: Date.now() - 6 * MINUTE });
    lege("abgeholt-4", { deliveredAt: Date.now() - 4 * MINUTE });

    const ergebnis = await reapJobs();

    expect(ergebnis.zugestellt).toBe(1);
    expect(mockAuftraege.has("abgeholt-6")).toBe(false);
    expect(mockAuftraege.has("abgeholt-4")).toBe(true);
    expect(warnNamen()).toEqual([]);
  });

  test("der Satz gilt, nicht die Obergrenze: Aufbewahrung 30 Minuten loescht einen 31 Minuten alten Auftrag", async () => {
    mockSatzDokument = gueltig({ jobAufbewahrungMs: 30 * MINUTE });
    lege("alt-31", { status: "failed", createdAt: Date.now() - 31 * MINUTE });
    lege("alt-29", { status: "failed", createdAt: Date.now() - 29 * MINUTE });

    const ergebnis = await reapJobs();

    expect(ergebnis.expired).toBe(1);
    expect(mockAuftraege.has("alt-31")).toBe(false);
    expect(mockAuftraege.has("alt-29")).toBe(true);
  });
});

/* BUG-2026-10-03-32: Ist der Satz nur GERADE nicht lesbar, gilt der zuletzt
   gueltig gelesene weiter — auch fuer den Aufraeumdienst, mit dessen Fristen.
   Solche Laeufe zaehlen trotzdem als "ohne frisch gelesene Betriebswerte":
   Bleibt es fuenf Laeufe in Folge dabei, kommt der Alarm wie bisher. */
describe("Aufraeumdienst, wenn der Satz nach einem gueltigen Stand nicht mehr lesbar ist", () => {
  let fehler;
  let versatzMs;
  const echteUhr = Date.now.bind(Date);
  const minuteSpaeter = () => {
    versatzMs += 61 * 1000;
  };
  const fehlerNamen = () => fehler.mock.calls.map((aufruf) => JSON.parse(aufruf[0]).error);

  beforeEach(async () => {
    versatzMs = 0;
    jest.spyOn(Date, "now").mockImplementation(() => echteUhr() + versatzMs);
    fehler = console.error;
    /* Erster Lauf: Der Satz wird gueltig gelesen (Zustellfenster 5 Minuten). */
    mockSatzDokument = gueltig({ zustellfensterMs: 5 * MINUTE });
    await reapJobs();
    expect(warnNamen()).toEqual([]);
    mockSatzDokument = new Error("UNAVAILABLE");
    minuteSpaeter();
  });

  test("er arbeitet mit dem letzten gueltigen Stand weiter und sagt es mit EINER Warnung je Lauf", async () => {
    lege("abgeholt-6", { deliveredAt: Date.now() - 6 * MINUTE });
    lege("abgeholt-4", { deliveredAt: Date.now() - 4 * MINUTE });

    const ergebnis = await reapJobs();

    /* Fenster 5 Minuten aus dem letzten Stand, nicht die Obergrenze 15. */
    expect(ergebnis.zugestellt).toBe(1);
    expect(mockAuftraege.has("abgeholt-6")).toBe(false);
    expect(mockAuftraege.has("abgeholt-4")).toBe(true);
    expect(warnNamen()).toEqual(["reap-query-ohne-betriebswerte:letzter-stand"]);
    expect(fehler).not.toHaveBeenCalled();
  });

  test("fuenf solche Laeufe in Folge alarmieren wie bisher", async () => {
    for (let lauf = 1; lauf <= 4; lauf += 1) {
      await reapJobs();
      minuteSpaeter();
    }
    expect(fehler).not.toHaveBeenCalled();

    await reapJobs();

    expect(fehlerNamen()).toEqual(["betriebswerte-wiederholt-nicht-lesbar"]);
  });

  test("ist der Satz wieder lesbar, beginnt die Zaehlung von vorn", async () => {
    for (let lauf = 1; lauf <= 4; lauf += 1) {
      await reapJobs();
      minuteSpaeter();
    }
    mockSatzDokument = gueltig();
    await reapJobs();
    minuteSpaeter();
    mockSatzDokument = new Error("UNAVAILABLE");
    for (let lauf = 1; lauf <= 4; lauf += 1) {
      await reapJobs();
      minuteSpaeter();
    }

    expect(fehler).not.toHaveBeenCalled();
  });
});
