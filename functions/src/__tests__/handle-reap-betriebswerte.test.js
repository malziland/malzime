/**
 * handle-reap-betriebswerte.test.js — ein Ausrutscher der Datenbank ist
 * kein Alarm.
 *
 * BELEG (Logauswertung 07.09.2026, 17:37 Wien): Der Aufraeumer konnte die
 * Betriebswerte einmal nicht in 2 Sekunden lesen. Der naechste Lauf eine
 * Minute spaeter war gesund, kein Mensch war betroffen — trotzdem gingen zwei
 * Alarme raus (E-Mail und Push), weil der Reaper den Abbruch als ERROR
 * meldete. Ein Alarm, der nichts bedeutet, kostet das Vertrauen in die
 * Alarme, die etwas bedeuten.
 *
 * Regel seitdem: Fehlen die Betriebswerte in EINEM Lauf, ist das eine
 * Warnung. Fehlen sie in ZWEI Laeufen hintereinander (= zwei Minuten), ist es
 * ein Fehler und alarmiert. Alle anderen Abfragefehler (fehlender Index,
 * Berechtigung, Firestore-Stoerung) alarmieren weiter sofort — wie bisher.
 */

jest.mock("../jobs", () => ({
  findAbandonedJobs: jest.fn(),
  findUeberfaelligeJobs: jest.fn(),
  findStaleProcessingJobs: jest.fn(),
  findExpiredJobs: jest.fn(),
  findZugestellteJobs: jest.fn(),
  abandonJob: jest.fn(),
  failJob: jest.fn(),
  deleteJob: jest.fn(),
  platzAbgleichen: jest.fn(async () => ({ vorher: 0, jetzt: 0 })),
}));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn() }));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn() }));
jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ letzterLauf: Date.now() }) }) }),
  }),
}));

let jobs;
let reapJobs;
let fehler;
let warnung;
let normal;

/* Genau der Fehler, den jobs.js wirft, wenn betriebsprofil.js keinen Satz
   liefert (betriebswerteOderAbbruch). Der Text ist der vom 07.09.2026. */
function ohneBetriebswerte() {
  const e = new Error("Betriebswerte fehlen: nicht lesbar: Zeitlimit 2000 ms");
  e.code = "config_missing";
  return e;
}

const LEERER_LAUF = { abandoned: 0, staleProcessing: 0, expired: 0, ueberfaellig: 0, zugestellt: 0 };

function zeilen(spion) {
  return spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));
}

/* Der Reaper zaehlt Laeufe ohne Betriebswerte im Modulzustand. Jeder Test
   bekommt deshalb ein frisch geladenes Modul — wie eine frisch gestartete
   Instanz. Die Attrappen werden mitgeladen, damit Reaper und Test dieselben
   Exemplare sehen. */
beforeEach(() => {
  jest.resetModules();
  jobs = require("../jobs");
  reapJobs = require("../handle-reap").reapJobs;
  jobs.findAbandonedJobs.mockResolvedValue([]);
  jobs.findUeberfaelligeJobs.mockResolvedValue([]);
  jobs.findStaleProcessingJobs.mockResolvedValue([]);
  jobs.findExpiredJobs.mockResolvedValue([]);
  jobs.findZugestellteJobs.mockResolvedValue([]);
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
  normal = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  fehler.mockRestore();
  warnung.mockRestore();
  normal.mockRestore();
});

describe("Reaper ohne Betriebswerte (07.09.2026)", () => {
  test("EIN Lauf ohne Betriebswerte: Warnung, kein Fehler, der Lauf endet normal", async () => {
    jobs.findAbandonedJobs.mockRejectedValue(ohneBetriebswerte());

    const ergebnis = await reapJobs();

    expect(ergebnis).toEqual(LEERER_LAUF);
    expect(fehler).not.toHaveBeenCalled();
    const warnungen = zeilen(warnung);
    expect(warnungen).toHaveLength(1);
    expect(warnungen[0]).toMatchObject({
      severity: "WARNING",
      step: "reap",
      warning: "reap-query-ohne-betriebswerte:abandoned",
    });
    expect(warnungen[0].message).toContain("Zeitlimit 2000 ms");
  });

  test("ZWEI Laeufe hintereinander ohne Betriebswerte: Fehler mit Anzahl — das alarmiert", async () => {
    jobs.findAbandonedJobs.mockRejectedValue(ohneBetriebswerte());

    await reapJobs();
    expect(fehler).not.toHaveBeenCalled();
    await reapJobs();

    const fehlerZeilen = zeilen(fehler);
    expect(fehlerZeilen).toHaveLength(1);
    expect(fehlerZeilen[0]).toMatchObject({
      severity: "ERROR",
      step: "reap",
      error: "betriebswerte-wiederholt-nicht-lesbar",
      laeufeInFolge: 2,
    });
    expect(typeof fehlerZeilen[0].hinweis).toBe("string");
  });

  test("ein gesunder Lauf dazwischen setzt die Zaehlung zurueck", async () => {
    jobs.findAbandonedJobs
      .mockRejectedValueOnce(ohneBetriebswerte())
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(ohneBetriebswerte());

    await reapJobs();
    await reapJobs();
    await reapJobs();

    expect(fehler).not.toHaveBeenCalled();
    expect(zeilen(warnung)).toHaveLength(2);
  });

  test("scheitern mehrere Abfragen im selben Lauf, zaehlt der Lauf EINMAL", async () => {
    jobs.findAbandonedJobs.mockRejectedValue(ohneBetriebswerte());
    jobs.findStaleProcessingJobs.mockRejectedValue(ohneBetriebswerte());
    jobs.findExpiredJobs.mockRejectedValue(ohneBetriebswerte());

    await reapJobs();

    expect(fehler).not.toHaveBeenCalled();
    /* Drei Warnungen (je Abfrage eine), aber kein Fehler — ein Lauf ist ein Lauf. */
    expect(zeilen(warnung)).toHaveLength(3);
  });

  test("BESTAND: jeder andere Abfragefehler alarmiert sofort", async () => {
    jobs.findAbandonedJobs.mockRejectedValue(new Error("FAILED_PRECONDITION: index fehlt"));

    const ergebnis = await reapJobs();

    expect(ergebnis).toEqual(LEERER_LAUF);
    const fehlerZeilen = zeilen(fehler);
    expect(fehlerZeilen).toHaveLength(1);
    expect(fehlerZeilen[0]).toMatchObject({
      severity: "ERROR",
      step: "reap",
      error: "reap-query-fehlgeschlagen:abandoned",
    });
    expect(fehlerZeilen[0].message).toContain("index fehlt");
    expect(warnung).not.toHaveBeenCalled();
  });
});
