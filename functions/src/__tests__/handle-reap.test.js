/* Tests für handle-reap.js — Reaper für verlassene Queue-Jobs. */

jest.mock("../jobs", () => ({
  findAbandonedJobs: jest.fn(),
  abandonJob: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  deleteImage: jest.fn(),
}));

const { reapAbandonedJobs } = require("../handle-reap");
const jobs = require("../jobs");
const storage = require("../queue-storage");

beforeEach(() => {
  jest.clearAllMocks();
  jobs.abandonJob.mockResolvedValue();
  storage.deleteImage.mockResolvedValue();
});

describe("reapAbandonedJobs", () => {
  test("leerer Lauf — nichts zu tun", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([]);
    const result = await reapAbandonedJobs();
    expect(result).toEqual({ scanned: 0, reaped: 0 });
    expect(jobs.abandonJob).not.toHaveBeenCalled();
  });

  test("markiert verlassene Jobs als abandoned und löscht ihre Bilder", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([
      { id: "j1", imagePath: "queue-uploads/1.jpg" },
      { id: "j2", imagePath: "queue-uploads/2.jpg" },
    ]);
    const result = await reapAbandonedJobs();
    expect(result).toEqual({ scanned: 2, reaped: 2 });
    expect(jobs.abandonJob).toHaveBeenCalledWith("j1");
    expect(jobs.abandonJob).toHaveBeenCalledWith("j2");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/1.jpg");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/2.jpg");
  });

  test("ein einzelner fehlschlagender Job stoppt den Lauf nicht", async () => {
    jobs.findAbandonedJobs.mockResolvedValue([
      { id: "j1", imagePath: "queue-uploads/1.jpg" },
      { id: "j2", imagePath: "queue-uploads/2.jpg" },
    ]);
    jobs.abandonJob.mockResolvedValueOnce().mockRejectedValueOnce(new Error("firestore blip"));
    const result = await reapAbandonedJobs();
    expect(result).toEqual({ scanned: 2, reaped: 1 });
  });
});
