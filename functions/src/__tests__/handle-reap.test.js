/* Tests für handle-reap.js — Reaper für hängengebliebene Queue-Jobs. */

jest.mock("../jobs", () => ({
  findAbandonedJobs: jest.fn(),
  findUeberfaelligeJobs: jest.fn(),
  findStaleProcessingJobs: jest.fn(),
  findExpiredJobs: jest.fn(),
  findZugestellteJobs: jest.fn(),
  abandonJob: jest.fn(),
  failJob: jest.fn(),
  deleteJob: jest.fn(),
  /* NEU (BUG-2026-08-30-14): Der Reaper gleicht den Warteschlangen-Zaehler mit
     der Wirklichkeit ab. Ohne diesen Eintrag meldete jeder Reaper-Test einen
     Fehler ins Protokoll — und die Tests, die auf "keine Fehlermeldung"
     pruefen, wurden rot. */
}));
jest.mock("../queue-storage", () => ({
  deleteImage: jest.fn(),
}));
jest.mock("../counter", () => ({
  releaseHourlySlot: jest.fn(),
}));
/* OPS-2026-08-12-11: Der Reaper liest das Lebenszeichen der Wochen-Erinnerung. */
const mockLebenszeichenGet = jest.fn();
jest.mock("../db", () => ({
  datenbank: () => ({ doc: () => ({ get: mockLebenszeichenGet }) }),
}));

const { reapJobs } = require("../handle-reap");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const counter = require("../counter");

beforeEach(() => {
  mockLebenszeichenGet.mockResolvedValue({ exists: true, data: () => ({ letzterLauf: Date.now() }) });
  jest.clearAllMocks();
  jobs.findAbandonedJobs.mockResolvedValue([]);
  jobs.findUeberfaelligeJobs.mockResolvedValue([]);
  jobs.findStaleProcessingJobs.mockResolvedValue([]);
  jobs.findExpiredJobs.mockResolvedValue([]);
  jobs.findZugestellteJobs.mockResolvedValue([]);
  jobs.abandonJob.mockResolvedValue(true);
  jobs.failJob.mockResolvedValue(true);
  jobs.deleteJob.mockResolvedValue();
  storage.deleteImage.mockResolvedValue();
  counter.releaseHourlySlot.mockResolvedValue();
});

describe("reapJobs", () => {
  test("leerer Lauf — nichts zu tun", async () => {
    const result = await reapJobs();
    expect(result).toEqual({ abandoned: 0, staleProcessing: 0, expired: 0, ueberfaellig: 0, zugestellt: 0 });
    expect(jobs.abandonJob).not.toHaveBeenCalled();
    expect(jobs.failJob).not.toHaveBeenCalled();
    expect(jobs.deleteJob).not.toHaveBeenCalled();
  });

  /* ── PRIV-107b: zugestellte Ergebnisse nach dem 15-min-Fenster ────────── */

  test("PRIV-107b: zugestellte Jobs werden gelöscht — Bild zuerst, dann das Dokument", async () => {
    jobs.findZugestellteJobs.mockResolvedValue([{ id: "z1", imagePath: "queue-uploads/z1.jpg" }, { id: "z2" }]);
    const reihenfolge = [];
    storage.deleteImage.mockImplementation(async () => reihenfolge.push("bild"));
    jobs.deleteJob.mockImplementation(async () => reihenfolge.push("dokument"));

    const result = await reapJobs();

    /* (Diese Erwartung wird ROT, wenn jemand Zweig 2c entfernt — dann räumt
       erst die 2-h-Grenze, und das Zustellungs-Versprechen der
       Datenschutzerklärung wäre gebrochen.) */
    expect(result.zugestellt).toBe(2);
    expect(jobs.deleteJob).toHaveBeenCalledWith("z1");
    expect(jobs.deleteJob).toHaveBeenCalledWith("z2");
    /* BUG-002-Regel: Bild vor Dokument; ohne imagePath (z2) kein Bild-Aufruf. */
    expect(reihenfolge).toEqual(["bild", "dokument", "dokument"]);
    expect(storage.deleteImage).toHaveBeenCalledTimes(1);
  });

  test("PRIV-107b: ein Löschfehler wird geloggt und stoppt weder den Zweig noch den Lauf", async () => {
    jobs.findZugestellteJobs.mockResolvedValue([{ id: "z1" }, { id: "z2" }]);
    jobs.deleteJob.mockRejectedValueOnce(new Error("firestore weg")).mockResolvedValue();

    const result = await reapJobs();

    expect(result.zugestellt).toBe(1);
    expect(jobs.deleteJob).toHaveBeenCalledTimes(2);
  });

  test("verlassene wartende Jobs → abandoned, Bild gelöscht", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([
      { id: "a1", imagePath: "queue-uploads/a1.jpg" },
      { id: "a2", imagePath: "queue-uploads/a2.jpg" },
    ]);
    const result = await reapJobs();
    expect(result.abandoned).toBe(2);
    expect(jobs.abandonJob).toHaveBeenCalledWith("a1");
    expect(jobs.abandonJob).toHaveBeenCalledWith("a2");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/a1.jpg");
    /* BIZ-001: pro erfolgreich verlassenem Job kommt der Stunden-Slot zurück. */
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(2);
  });

  test("abandonJob verliert das Race (Job inzwischen geclaimt) → Bild bleibt, kein Slot zurück", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([{ id: "a1", imagePath: "queue-uploads/a1.jpg" }]);
    jobs.abandonJob.mockResolvedValue(false);
    const result = await reapJobs();
    expect(result.abandoned).toBe(0);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(counter.releaseHourlySlot).not.toHaveBeenCalled();
  });

  test("in processing hängende Jobs → failed (processing_timeout), Bild gelöscht", async () => {
    jobs.findStaleProcessingJobs.mockResolvedValue([{ id: "p1", imagePath: "queue-uploads/p1.jpg" }]);
    const result = await reapJobs();
    expect(result.staleProcessing).toBe(1);
    expect(jobs.failJob).toHaveBeenCalledWith("p1", "processing_timeout");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/p1.jpg");
  });

  test("abgelaufene Job-Dokumente → gelöscht", async () => {
    jobs.findExpiredJobs.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    const result = await reapJobs();
    expect(result.expired).toBe(2);
    expect(jobs.deleteJob).toHaveBeenCalledWith("e1");
    expect(jobs.deleteJob).toHaveBeenCalledWith("e2");
  });

  test("räumt alle drei Sorten in einem Lauf ab", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([{ id: "a1", imagePath: "a" }]);
    jobs.findStaleProcessingJobs.mockResolvedValue([{ id: "p1", imagePath: "p" }]);
    jobs.findExpiredJobs.mockResolvedValue([{ id: "e1" }]);
    const result = await reapJobs();
    expect(result).toEqual({ abandoned: 1, staleProcessing: 1, expired: 1, ueberfaellig: 0, zugestellt: 0 });
  });

  test("ein einzelner fehlschlagender Job stoppt den Lauf nicht", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([
      { id: "a1", imagePath: "x" },
      { id: "a2", imagePath: "y" },
    ]);
    jobs.abandonJob.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("firestore blip"));
    const result = await reapJobs();
    expect(result.abandoned).toBe(1);
  });
});

describe("SEC-003 — Jobs, die nur durch Pollen am Leben bleiben", () => {
  /* Jeder Poll erneuert `lastSeenAt`, deshalb sieht Zweig (1) sie nie. Ohne
     Obergrenze kann jemand 500 Mini-Uploads anlegen, im Takt weiterfragen und
     damit das ganze Stundenfenster dauerhaft blockieren — ohne dass je ein
     Platz zurückkommt. */
  beforeEach(() => {
    jest.clearAllMocks();
    jobs.findAbandonedJobs.mockResolvedValue([]);
    jobs.findUeberfaelligeJobs.mockResolvedValue([]);
    jobs.findStaleProcessingJobs.mockResolvedValue([]);
    jobs.findExpiredJobs.mockResolvedValue([]);
    jobs.findZugestellteJobs.mockResolvedValue([]);
    jobs.abandonJob.mockResolvedValue(true);
    jobs.failJob.mockResolvedValue(true);
    jobs.deleteJob.mockResolvedValue(true);
  });

  test("überfälliger Job wird abgebrochen, Platz und Bild kommen zurück", async () => {
    jobs.findUeberfaelligeJobs.mockResolvedValue([{ id: "u1", imagePath: "queue-uploads/u1.jpg" }]);
    const r = await reapJobs();
    expect(jobs.abandonJob).toHaveBeenCalledWith("u1");
    expect(counter.releaseHourlySlot).toHaveBeenCalled();
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/u1.jpg");
    expect(r.ueberfaellig).toBe(1);
  });

  test("verliert der Übergang das Rennen, bleibt alles unangetastet", async () => {
    jobs.findUeberfaelligeJobs.mockResolvedValue([{ id: "u2", imagePath: "queue-uploads/u2.jpg" }]);
    jobs.abandonJob.mockResolvedValue(false);
    const r = await reapJobs();
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(counter.releaseHourlySlot).not.toHaveBeenCalled();
    expect(r.ueberfaellig).toBe(0);
  });
});

/* ── Waechter ueber die Wochen-Erinnerung (OPS-2026-08-12-11) ────────── */

describe("Reaper als Waechter der Wochen-Erinnerung", () => {
  const leer = () => {
    jobs.findAbandonedJobs.mockResolvedValue([]);
    jobs.findUeberfaelligeJobs.mockResolvedValue([]);
    jobs.findStaleProcessingJobs.mockResolvedValue([]);
    jobs.findZugestellteJobs.mockResolvedValue([]);
    jobs.findExpiredJobs.mockResolvedValue([]);
  };

  test("frisches Lebenszeichen -> keine Meldung", async () => {
    leer();
    mockLebenszeichenGet.mockResolvedValue({ exists: true, data: () => ({ letzterLauf: Date.now() }) });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await reapJobs();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("Lebenszeichen aelter als neun Tage -> laute Meldung mit severity ERROR", async () => {
    leer();
    const zehnTage = Date.now() - 10 * 24 * 60 * 60 * 1000;
    mockLebenszeichenGet.mockResolvedValue({ exists: true, data: () => ({ letzterLauf: zehnTage }) });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    await reapJobs();

    const zeilen = spy.mock.calls.map((c) => JSON.parse(c[0]));
    const meldung = zeilen.find((z) => z.error === "erinnerung-lebenszeichen-veraltet");
    expect(meldung).toBeDefined();
    expect(meldung.severity).toBe("ERROR");
    expect(meldung.alterTage).toBeGreaterThanOrEqual(9);
    spy.mockRestore();
  });

  /* TEST-2026-08-20-01: Die beiden folgenden Tests stellen die Uhr selbst, statt sich
     auf die echte zu verlassen. Vorher prüfte nur der Schweige-Fall, und zwar mit
     `Date.now()` gegen das feste Auslieferungsdatum im Produktivcode — ab dem
     Stichtag (Auslieferung + neun Tage) wäre er bei JEDEM Lauf rot geworden und
     hätte die ganze Prüfkette blockiert. Die Regel dazu steht in
     handle-erinnerung.test.js: Tests dürfen nicht von der Uhr abhängen. */
  const mitUhr = async (zeitpunkt, pruefung) => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    jest.setSystemTime(new Date(zeitpunkt));
    try {
      await pruefung();
    } finally {
      jest.useRealTimers();
    }
  };

  test("noch nie gelaufen, innerhalb der Gnadenfrist -> keine Meldung", async () => {
    leer();
    mockLebenszeichenGet.mockResolvedValue({ exists: false, data: () => null });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    /* Zwei Tage nach der Auslieferung: der erste Montag stand noch aus. */
    await mitUhr("2026-08-14T00:00:00Z", async () => {
      await reapJobs();
      expect(spy).not.toHaveBeenCalled();
    });

    spy.mockRestore();
  });

  test("noch nie gelaufen, Gnadenfrist abgelaufen -> laute Meldung erinnerung-nie-gelaufen", async () => {
    leer();
    mockLebenszeichenGet.mockResolvedValue({ exists: false, data: () => null });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    /* Zwei Wochen nach der Auslieferung: zwei Montage sind verstrichen, das
       Ausbleiben des allerersten Lebenszeichens ist selbst der Befund. */
    await mitUhr("2026-08-26T00:00:00Z", async () => {
      await reapJobs();
      const zeilen = spy.mock.calls.map((c) => JSON.parse(c[0]));
      const meldung = zeilen.find((z) => z.error === "erinnerung-nie-gelaufen");
      expect(meldung).toBeDefined();
      expect(meldung.severity).toBe("ERROR");
      expect(meldung.ausgeliefert).toBe("2026-08-12T00:00:00.000Z");
    });

    spy.mockRestore();
  });
});
