/* Tests für handle-enqueue.js — Annahme-Endpoint der Queue-Architektur.
   Die externen Module (Counter, Storage, Cloud Tasks, Jobs) sind gemockt;
   getestet wird die Validierungs-Logik und der Annahme-Ablauf des Handlers. */

jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(),
  checkAndIncrement: jest.fn(),
  releaseHourlySlot: jest.fn(() => Promise.resolve()),
}));
jest.mock("../middleware", () => ({
  getClientIp: jest.fn(() => "1.2.3.4"),
  checkRateLimit: jest.fn(() => true),
}));
jest.mock("../jobs", () => ({
  createJob: jest.fn(),
  failJob: jest.fn(),
}));
jest.mock("../queue-storage", () => ({
  storeImage: jest.fn(),
  deleteImage: jest.fn(),
}));
jest.mock("../cloud-tasks", () => ({
  enqueueJob: jest.fn(),
}));
jest.mock("../notify", () => ({
  notifyLimitReached: jest.fn(() => Promise.resolve()),
}));

const { handleEnqueue, detectImageType } = require("../handle-enqueue");
const counter = require("../counter");
const middleware = require("../middleware");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const tasks = require("../cloud-tasks");

const VALID_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

const SECRETS = {
  ntfyUrl: { value: () => "url" },
  ntfyTopic: { value: () => "topic" },
  adminSecret: { value: () => "secret" },
};

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}

function jsonReq(bodyOverrides = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://malzi.me" },
    body: {
      imageBase64: VALID_JPEG.toString("base64"),
      mimeType: "image/jpeg",
      lang: "de",
      ...bodyOverrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  counter.getMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
  counter.checkAndIncrement.mockResolvedValue({ allowed: true, justReached: false, count: 1, limit: 1500 });
  middleware.checkRateLimit.mockReturnValue(true);
  jobs.createJob.mockResolvedValue("job-abc");
  jobs.failJob.mockResolvedValue();
  storage.storeImage.mockResolvedValue("queue-uploads/test.jpg");
  storage.deleteImage.mockResolvedValue();
  tasks.enqueueJob.mockResolvedValue("projects/p/locations/l/queues/q/tasks/t");
});

/* ── detectImageType (Magic Bytes) ───────────────────────────────── */

describe("detectImageType", () => {
  test("erkennt JPEG, PNG, GIF und WEBP", () => {
    expect(detectImageType(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(20)]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]))).toBe("image/png");
    expect(detectImageType(Buffer.concat([Buffer.from("GIF8"), Buffer.alloc(20)]))).toBe("image/gif");
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe(
      "image/webp"
    );
  });

  test("lehnt zu kurze und unbekannte Buffer ab", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.alloc(20))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });
});

/* ── Frühe Abweisungen ───────────────────────────────────────────── */

describe("handleEnqueue — Abweisungen", () => {
  test("nicht-POST → 405", async () => {
    const res = makeRes();
    await handleEnqueue({ method: "GET", headers: {} }, res, SECRETS);
    expect(res.statusCode).toBe(405);
  });

  test("Maintenance-Modus → 503", async () => {
    counter.getMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Wartung" });
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.maintenance).toBe(true);
  });

  test("Rate-Limit überschritten → 429", async () => {
    middleware.checkRateLimit.mockReturnValue(false);
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(429);
  });

  test("Honeypot ausgefüllt → 403", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ website: "spam" }), res, SECRETS);
    expect(res.statusCode).toBe(403);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  test("fehlendes Bild → 400", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ imageBase64: undefined }), res, SECRETS);
    expect(res.statusCode).toBe(400);
  });

  test("ungültige Magic Bytes → 400", async () => {
    const res = makeRes();
    const bogus = Buffer.alloc(40).toString("base64");
    await handleEnqueue(jsonReq({ imageBase64: bogus }), res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(storage.storeImage).not.toHaveBeenCalled();
  });

  test("Stundenlimit erreicht → 429 blocked:limit, kein Job angelegt", async () => {
    counter.checkAndIncrement.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(429);
    expect(res.body.blocked).toBe("limit");
    expect(jobs.createJob).not.toHaveBeenCalled();
  });
});

/* ── Erfolgsfall ─────────────────────────────────────────────────── */

describe("handleEnqueue — Erfolgsfall", () => {
  test("gültige Anfrage → 200 mit jobId, Bild gespeichert, Job eingereiht", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBe("job-abc");
    /* PRIV-003: enqueue gibt zusätzlich ein Abhol-Ticket zurück. */
    expect(typeof res.body.resultToken).toBe("string");
    expect(res.body.resultToken.length).toBeGreaterThan(0);
    expect(storage.storeImage).toHaveBeenCalledTimes(1);
    expect(jobs.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "de",
        traceId: null,
        imagePath: "queue-uploads/test.jpg",
        exif: {},
      })
    );
    expect(tasks.enqueueJob).toHaveBeenCalledWith("job-abc");
  });

  test("Kamera-EXIF (make/model) wird sanitisiert an den Job durchgereicht", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ exif: { make: "Apple", model: "iPhone 15", gps: "geheim" } }), res, SECRETS);
    expect(jobs.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ exif: { make: "Apple", model: "iPhone 15" } })
    );
  });

  test("gültige Trace-ID wird übernommen", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ traceId: "abc123XYZ" }), res, SECRETS);
    expect(jobs.createJob).toHaveBeenCalledWith(expect.objectContaining({ traceId: "abc123XYZ" }));
    expect(res.headers["X-Trace-Id"]).toBe("abc123XYZ");
  });
});

/* ── Cloud-Tasks-Ausfall ─────────────────────────────────────────── */

describe("handleEnqueue — Cloud-Tasks-Ausfall", () => {
  test("schlägt enqueueJob fehl → 503, Job auf failed gesetzt, Bild gelöscht", async () => {
    tasks.enqueueJob.mockRejectedValue(new Error("tasks unavailable"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("enqueue_failed");
    expect(jobs.failJob).toHaveBeenCalledWith("job-abc", "enqueue_failed");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/test.jpg");
  });
});

/* ── Storage-/Firestore-Ausfall nach gezogenem Stunden-Slot ──────── */

describe("handleEnqueue — Ausfall zwischen Slot und Task", () => {
  test("schlägt storeImage fehl → 503, Slot zurückgegeben, kein deleteImage nötig", async () => {
    storage.storeImage.mockRejectedValue(new Error("gcs down"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("store_failed");
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(1);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
  });

  test("schlägt createJob fehl → 503, Slot zurückgegeben UND Bild-Waise gelöscht", async () => {
    jobs.createJob.mockRejectedValue(new Error("firestore blip"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("store_failed");
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(1);
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/test.jpg");
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
  });
});
