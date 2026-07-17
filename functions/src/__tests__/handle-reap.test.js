/* Tests für handle-reap.js — Reaper für hängengebliebene Queue-Jobs. */

jest.mock("../jobs", () => ({
  findAbandonedJobs: jest.fn(),
  findStaleProcessingJobs: jest.fn(),
  findExpiredJobs: jest.fn(),
  abandonJob: jest.fn(),
  failJob: jest.fn(),
  deleteJob: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  deleteImage: jest.fn(),
}));
jest.mock("../counter", () => ({
  releaseHourlySlot: jest.fn(),
}));

const { reapJobs } = require("../handle-reap");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const counter = require("../counter");

beforeEach(() => {
  jest.clearAllMocks();
  jobs.findAbandonedJobs.mockResolvedValue([]);
  jobs.findStaleProcessingJobs.mockResolvedValue([]);
  jobs.findExpiredJobs.mockResolvedValue([]);
  jobs.abandonJob.mockResolvedValue(true);
  jobs.failJob.mockResolvedValue(true);
  jobs.deleteJob.mockResolvedValue();
  storage.deleteImage.mockResolvedValue();
  counter.releaseHourlySlot.mockResolvedValue();
});

describe("reapJobs", () => {
  test("leerer Lauf — nichts zu tun", async () => {
    const result = await reapJobs();
    expect(result).toEqual({ abandoned: 0, staleProcessing: 0, expired: 0 });
    expect(jobs.abandonJob).not.toHaveBeenCalled();
    expect(jobs.failJob).not.toHaveBeenCalled();
    expect(jobs.deleteJob).not.toHaveBeenCalled();
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
    expect(result).toEqual({ abandoned: 1, staleProcessing: 1, expired: 1 });
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
