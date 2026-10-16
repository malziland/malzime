"use strict";

/* Der Aufraeumdienst zaehlt jeden Auftrag in die dauerhaften Zaehler, BEVOR er
   ihn loescht (16.10.2026, statistik.js) — und loescht auch dann, wenn das
   Zaehlen scheitert: Die Loeschfrist ist eine Datenschutzzusage, das Zaehlen
   nur Statistik. Doppelt gezaehlt wird nie, auch nicht, wenn ein Lauf das
   Loeschen nicht schafft und der naechste es wiederholt.

   Echte Module: Aufraeumdienst, Auftragsverwaltung, Zaehler — gegen eine
   Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn(async () => {}) }));
jest.mock("../erinnerungs-waechter", () => ({ pruefeErinnerungsLebenszeichen: jest.fn(async () => {}) }));

const speicher = require("./hilfen/speicher-datenbank");
const storage = require("../queue-storage");
const statistik = require("../statistik");
const { reapJobs } = require("../handle-reap");

const MIN = 60 * 1000;
const PROFIL = {
  profiles: { normal: { profileText: "a" }, boost: { profileText: "b" } },
  meta: { mode: "multimodal" },
};

let jetzt;
let warnungen;
beforeEach(() => {
  speicher.leeren();
  statistik._zuruecksetzen();
  storage.deleteImage.mockReset().mockResolvedValue(true);
  jetzt = Date.now();
  warnungen = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/* Ein abgeholter Auftrag, dessen Zustellfenster (15 min) vorbei ist. */
function abgeholt(id, extra = {}) {
  const createdAt = jetzt - 30 * MIN;
  speicher.lege(`jobs/${id}`, {
    status: "done",
    createdAt,
    startedAt: createdAt + 5000,
    finishedAt: createdAt + 70000,
    deliveredAt: createdAt + 75000,
    imagePath: null,
    result: PROFIL,
    kennzahlen: { kiMs: 60000, kiWiederholungen: 0, tokenEingabe: 1000, tokenZwischenspeicher: 600, tokenAusgabe: 400 },
    ...extra,
  });
  return createdAt;
}

const fensterVon = (ms) => speicher.lies(`statistik/${statistik.fensterId(ms)}`);

test("zaehlt, dann loescht: das Zaehlerdokument steht, der Auftrag ist weg", async () => {
  const createdAt = abgeholt("a");
  const r = await reapJobs();
  expect(r.zugestellt).toBe(1);
  expect(speicher.lies("jobs/a")).toBeUndefined();
  expect(fensterVon(createdAt)).toMatchObject({
    eingereiht: 1,
    fertig: 1,
    abgeholt: 1,
    wartezeit: { unter30s: 1 },
    gesamtzeit: { unter2min: 1 },
    kiDauer: { unter2min: 1 },
  });
  expect(speicher.lies(`statistik/${statistik.tagId(createdAt)}`).kiText).toEqual({
    eingabe: 1000,
    zwischenspeicher: 600,
    ausgabe: 400,
  });
  /* Reihenfolge: die Transaktion des Zaehlens beginnt vor dem Loeschen. */
  const zaehlen = speicher.protokoll.findIndex((p) => p.art === "transaktion");
  const loeschen = speicher.protokoll.findIndex((p) => p.art === "delete" && p.pfad === "jobs/a");
  expect(zaehlen).toBeGreaterThanOrEqual(0);
  expect(zaehlen).toBeLessThan(loeschen);
});

test("ZAEHLEN SCHEITERT: geloescht wird trotzdem, Warnzeile ohne Kennung", async () => {
  abgeholt("JOBKENNUNG7");
  speicher.vor(({ art }) => {
    if (art === "transaktion") throw new Error("Datenbank weg: jobs/JOBKENNUNG7");
  });
  const r = await reapJobs();
  expect(r.zugestellt).toBe(1);
  expect(speicher.lies("jobs/JOBKENNUNG7")).toBeUndefined();
  expect(speicher.pfade("statistik")).toEqual([]);
  const zeilen = warnungen.mock.calls.map((c) => String(c[0])).join("\n");
  expect(zeilen).toContain("statistik-zaehlen-fehlgeschlagen");
  expect(zeilen).not.toContain("JOBKENNUNG7");
});

test("LOESCHEN SCHEITERT, naechster Lauf wiederholt: gezaehlt wird genau einmal", async () => {
  const createdAt = abgeholt("b", { imagePath: "queue-uploads/b.jpg" });
  /* Erster Lauf: Das Foto laesst sich nicht loeschen -> Zweig (2c) laesst den
     Auftrag stehen (PRIV-2026-08-12-26). Gezaehlt ist er schon. */
  storage.deleteImage.mockResolvedValue(false);
  await reapJobs();
  expect(speicher.lies("jobs/b")).toMatchObject({ gezaehlt: true });
  expect(fensterVon(createdAt).eingereiht).toBe(1);

  /* Zweiter Lauf: jetzt klappt es. */
  storage.deleteImage.mockResolvedValue(true);
  await reapJobs();
  expect(speicher.lies("jobs/b")).toBeUndefined();
  expect(fensterVon(createdAt).eingereiht).toBe(1);
  expect(fensterVon(createdAt).abgeholt).toBe(1);
});

test("Dokument-Loeschen wirft: naechster Lauf loescht, ohne erneut zu zaehlen", async () => {
  const createdAt = abgeholt("c");
  let kaputt = true;
  speicher.vor(({ art, pfad }) => {
    if (kaputt && art === "delete" && pfad === "jobs/c") throw new Error("weg");
  });
  await reapJobs();
  expect(speicher.lies("jobs/c")).toMatchObject({ gezaehlt: true });
  kaputt = false;
  await reapJobs();
  expect(speicher.lies("jobs/c")).toBeUndefined();
  expect(fensterVon(createdAt)).toMatchObject({ eingereiht: 1, fertig: 1, abgeholt: 1 });
});

test("abgelaufene Auftraege (2 h): verworfen und nie abgeholt zaehlen, die Einlass-Ruecknahme nicht", async () => {
  const alt = jetzt - 3 * 60 * MIN;
  speicher.lege("jobs/v", { status: "abandoned", createdAt: alt, startedAt: null, finishedAt: alt + MIN });
  speicher.lege("jobs/e", {
    status: "abandoned",
    abbruchArt: "einlass",
    createdAt: alt,
    startedAt: null,
    finishedAt: alt + 1000,
  });
  speicher.lege("jobs/n", {
    status: "done",
    createdAt: alt,
    startedAt: alt + 400000,
    finishedAt: alt + 470000,
    deliveredAt: null,
    result: PROFIL,
  });
  const r = await reapJobs();
  expect(r.expired).toBe(3);
  expect(speicher.pfade("jobs")).toEqual([]);
  expect(fensterVon(alt)).toMatchObject({
    eingereiht: 2,
    verworfen: 1,
    fertig: 1,
    nieAbgeholt: 1,
    wartezeit: { unter8min: 1 },
    gesamtzeit: { unter8min: 1 },
  });
});
