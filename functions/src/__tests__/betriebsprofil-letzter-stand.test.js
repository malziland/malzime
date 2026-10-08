"use strict";

/* Ein einzelner traeger Lesezugriff auf den Einstellungssatz verwirft den eben
   noch gueltigen Stand nicht (BUG-2026-10-03-32).

   Kann der Satz gerade nicht GELESEN werden (Zeitlimit, Verbindung), gilt der
   zuletzt gueltig gelesene weiter — mit einer Warnung, und nach wenigen
   Sekunden wird neu gelesen. Nur ein fehlendes oder abgelehntes Dokument macht
   ihn ungueltig. Ohne frueheren gueltigen Stand bleibt es bei "kein Satz".

   Das Zeitlimit von zwei Sekunden und der Verzicht auf einen zweiten
   Leseversuch im selben Aufruf bleiben, wie sie sind (SECURITY-MODEL, "Ein
   Ausrutscher der Datenbank ist kein Alarm").

   Echte Module: betriebsprofil und Einlass. Die Uhr ist gestellt
   (jest-Zeitgeber), damit das Zeitlimit ohne Warten ablaeuft. Den
   Aufraeumdienst mit dem letzten Stand prueft aufraeumer-loescht-ohne-satz.test.js. */

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: (pfad) => ({
      get() {
        if (pfad !== "config/betriebsprofil") return Promise.reject(new Error(`unerwartetes Dokument ${pfad}`));
        mockLesen.anzahl += 1;
        const { daten, fehler, dauerMs } = mockLesen;
        return new Promise((fertig, ab) => {
          const antworten = () =>
            fehler ? ab(new Error(fehler)) : fertig({ exists: daten !== undefined, data: () => daten });
          if (dauerMs) setTimeout(antworten, dauerMs);
          else antworten();
        });
      },
    }),
  }),
}));
jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(async () => ({ enabled: false, message: "" })),
  checkAndIncrement: jest.fn(async () => ({ allowed: true, justReached: false, count: 1, limit: 500, stempel: 1 })),
  releaseHourlySlot: jest.fn(async () => {}),
}));
jest.mock("../middleware", () => ({ getClientIp: jest.fn(() => "test"), checkRateLimit: jest.fn(() => true) }));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })) }));
jest.mock("../durchsatz", () => ({
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../jobs", () => ({
  createJob: jest.fn(async () => "auftrag-1"),
  failJob: jest.fn(async () => true),
  countQueuedJobs: jest.fn(async () => 0),
  platzBestaetigen: jest.fn(async () => true),
  getJob: jest.fn(async (id) => ({ id, status: "queued", createdAt: 1 })),
  abandonJob: jest.fn(async () => true),
  meldeGescheiterteAnalyse: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  neuerBildPfad: jest.fn(() => "queue-uploads/x.jpg"),
  storeImage: jest.fn(async () => "queue-uploads/x.jpg"),
  deleteImage: jest.fn(async () => true),
}));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn(async () => "aufgabe") }));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn(async () => {}) }));

const { SATZ } = require("../test-satz");
const betriebsprofil = require("../betriebsprofil");
const { handleEnqueue } = require("../handle-enqueue");

/* Was die Datenbank auf den naechsten Lesezugriff antwortet. */
const mockLesen = { daten: undefined, fehler: null, dauerMs: 0, anzahl: 0 };

const satz = (ueberschreiben) => ({ aktiv: "t1", profile: { t1: { ...SATZ, ...ueberschreiben } } });
const SEKUNDE = 1000;

function datenbank({ daten, fehler = null, dauerMs = 0 }) {
  Object.assign(mockLesen, { daten, fehler, dauerMs });
}

/* Liest und stellt dabei die Uhr so weit vor, dass ein traeger Zugriff sein
   Zeitlimit erreicht. */
async function lies(vorstellenMs = 0) {
  const lesen = betriebsprofil.geltendeWerte();
  if (vorstellenMs) await jest.advanceTimersByTimeAsync(vorstellenMs);
  return lesen;
}

/* Der Zwischenspeicher haelt 30 Sekunden; danach wird neu gelesen. */
const zwischenspeicherAbgelaufen = () => jest.advanceTimersByTimeAsync(31 * SEKUNDE);

let warnung;
let fehlerZeilen;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  Object.assign(mockLesen, { daten: undefined, fehler: null, dauerMs: 0, anzahl: 0 });
  betriebsprofil._cacheLeeren();
  jest.spyOn(console, "log").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehlerZeilen = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  /* Eine Antwort, die nach dem Zeitlimit doch noch kommt, schreibt ihre Dauer —
     vor dem Testende abwarten. */
  await jest.advanceTimersByTimeAsync(10 * SEKUNDE);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("der Satz war gueltig gelesen, dann ist er gerade nicht lesbar", () => {
  beforeEach(async () => {
    datenbank({ daten: satz({ stundenlimit: 321 }) });
    expect((await lies()).werte.stundenlimit).toBe(321);
    await zwischenspeicherAbgelaufen();
  });

  test("Lesezugriff braucht laenger als das Zeitlimit: der letzte gueltige Stand gilt weiter, mit Warnung", async () => {
    datenbank({ daten: satz({ stundenlimit: 321 }), dauerMs: 3 * SEKUNDE });

    const stand = await lies(2 * SEKUNDE);

    expect(stand.werte.stundenlimit).toBe(321);
    expect(stand.profil).toBe("t1");
    expect(stand.letzterStand).toBe(true);
    expect(fehlerZeilen).not.toHaveBeenCalled();
    const warnungen = zeilen(warnung);
    expect(warnungen).toHaveLength(1);
    expect(warnungen[0]).toMatchObject({ step: "betriebsprofil", severity: "WARNING", letzterStand: true });
    expect(warnungen[0].grund).toContain("nicht lesbar: Zeitlimit 2000 ms");
    /* Wie alt der Stand ist, den wir weiterbenutzen: eine Zahl, sonst nichts. */
    expect(warnungen[0].standAlterMs).toBeGreaterThanOrEqual(31 * SEKUNDE);
  });

  test("Lesezugriff scheitert sofort: ebenso", async () => {
    datenbank({ fehler: "UNAVAILABLE" });

    const stand = await lies();

    expect(stand.werte.stundenlimit).toBe(321);
    expect(stand.letzterStand).toBe(true);
  });

  test("es bleibt bei EINEM Leseversuch je Aufruf, und das Zeitlimit bleibt zwei Sekunden", async () => {
    datenbank({ daten: satz(), dauerMs: 60 * SEKUNDE });
    const vorher = mockLesen.anzahl;

    const lesen = betriebsprofil.geltendeWerte();
    let fertig = false;
    lesen.then(() => (fertig = true));
    await jest.advanceTimersByTimeAsync(2 * SEKUNDE - 1);
    expect(fertig).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(fertig).toBe(true);

    expect(mockLesen.anzahl - vorher).toBe(1);
  });

  test("wenige Sekunden lang wird nicht erneut gelesen, danach schon — und der neue Satz gilt", async () => {
    datenbank({ fehler: "UNAVAILABLE" });
    await lies();
    const nachFehlschlag = mockLesen.anzahl;

    /* Gleich danach (dieselbe Anfrage, die naechste Stelle im Einlass): kein
       zweiter Zugriff, der wieder bis zum Zeitlimit warten muesste. */
    datenbank({ daten: satz({ stundenlimit: 777 }) });
    expect((await lies()).werte.stundenlimit).toBe(321);
    expect(mockLesen.anzahl).toBe(nachFehlschlag);

    await jest.advanceTimersByTimeAsync(5 * SEKUNDE + 1);
    const neu = await lies();
    expect(mockLesen.anzahl).toBe(nachFehlschlag + 1);
    expect(neu.werte.stundenlimit).toBe(777);
    expect(neu.letzterStand).toBeUndefined();
  });

  test("ein FEHLENDES Dokument macht den Satz sofort ungueltig", async () => {
    datenbank({ daten: undefined });

    const stand = await lies();

    expect(stand.werte).toBeNull();
    expect(stand.grund).toBe("kein Dokument");
    expect(zeilen(fehlerZeilen)).toHaveLength(1);
  });

  test("ein ABGELEHNTER Satz macht ihn sofort ungueltig — und ein Lesefehler danach holt den alten nicht zurueck", async () => {
    datenbank({ daten: satz({ jobAufbewahrungMs: 3 * 60 * 60 * SEKUNDE }) });
    const abgelehnt = await lies();
    expect(abgelehnt.werte).toBeNull();
    expect(abgelehnt.grund).toContain("abgelehnt");

    datenbank({ fehler: "UNAVAILABLE" });
    const danach = await lies();
    expect(danach.werte).toBeNull();
    expect(danach.grund).toContain("nicht lesbar");
  });

  test("Einlass: fuenf gleichzeitige Uploads waehrend des traegen Zugriffs werden angenommen", async () => {
    datenbank({ daten: satz(), dauerMs: 3 * SEKUNDE });
    const antworten = [1, 2, 3, 4, 5].map(() => {
      const res = {
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
      return { res };
    });
    const bild = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");
    const laeufe = antworten.map(({ res }) =>
      handleEnqueue(
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: { imageBase64: bild, mimeType: "image/jpeg" },
        },
        res,
        { ntfyUrl: { value: () => "" }, ntfyTopic: { value: () => "" }, adminSecret: { value: () => "" } }
      )
    );
    await jest.advanceTimersByTimeAsync(2 * SEKUNDE);
    await Promise.all(laeufe);

    expect(antworten.map(({ res }) => res.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(fehlerZeilen).not.toHaveBeenCalled();
  });
});

describe("es gab noch keinen gueltigen Stand", () => {
  test("nicht lesbar heisst dann weiter: kein Satz", async () => {
    datenbank({ fehler: "UNAVAILABLE" });

    const stand = await lies();

    expect(stand.werte).toBeNull();
    expect(stand.grund).toContain("nicht lesbar");
    expect(stand.letzterStand).toBeUndefined();
  });

  test("nach dem Vergessen des Zwischenspeichers (Wache am Dokument) gilt nur, was frisch gelesen wurde", async () => {
    datenbank({ daten: satz() });
    expect((await lies()).werte).not.toBeNull();

    betriebsprofil._cacheLeeren();
    datenbank({ fehler: "UNAVAILABLE" });

    expect((await lies()).werte).toBeNull();
  });
});
