/* Tests für queue-storage.js — temporäre Bild-Ablage der Queue.
   Der Storage-Bucket wird durch eine In-Memory-Attrappe ersetzt. */

const storage = require("../queue-storage");

function fakeBucket() {
  const files = new Map();
  return {
    _files: files,
    file(path) {
      return {
        async save(buffer, opts) {
          files.set(path, { buffer, contentType: opts.contentType });
        },
        async download() {
          const f = files.get(path);
          if (!f) throw new Error("object not found");
          return [f.buffer];
        },
        async getMetadata() {
          const f = files.get(path);
          return [{ contentType: f ? f.contentType : undefined }];
        },
        async delete() {
          if (!files.has(path)) throw new Error("object not found");
          files.delete(path);
        },
      };
    },
  };
}

let bucket;

beforeEach(() => {
  bucket = fakeBucket();
  storage.setBucketForTest(bucket);
});

afterEach(() => {
  storage.setBucketForTest(null);
});

describe("storeImage", () => {
  test("legt das Bild unter queue-uploads/ mit passender Endung ab", async () => {
    const path = await storage.storeImage(Buffer.from("jpegdata"), "image/jpeg");
    expect(path).toMatch(/^queue-uploads\/.+\.jpg$/);
    expect(bucket._files.has(path)).toBe(true);
    expect(bucket._files.get(path).contentType).toBe("image/jpeg");
  });

  test("nutzt die korrekte Endung je MIME-Typ", async () => {
    expect(await storage.storeImage(Buffer.from("x"), "image/png")).toMatch(/\.png$/);
    expect(await storage.storeImage(Buffer.from("x"), "image/webp")).toMatch(/\.webp$/);
    expect(await storage.storeImage(Buffer.from("x"), "image/gif")).toMatch(/\.gif$/);
  });

  test("vergibt für jedes Bild einen eindeutigen Pfad", async () => {
    const a = await storage.storeImage(Buffer.from("x"), "image/jpeg");
    const b = await storage.storeImage(Buffer.from("x"), "image/jpeg");
    expect(a).not.toBe(b);
  });
});

describe("loadImage", () => {
  test("liefert Buffer und MIME-Typ des abgelegten Bildes", async () => {
    const path = await storage.storeImage(Buffer.from("inhalt"), "image/png");
    const loaded = await storage.loadImage(path);
    expect(loaded.buffer.toString()).toBe("inhalt");
    expect(loaded.mimeType).toBe("image/png");
  });
});

describe("deleteImage", () => {
  test("entfernt ein abgelegtes Bild", async () => {
    const path = await storage.storeImage(Buffer.from("x"), "image/jpeg");
    await storage.deleteImage(path);
    expect(bucket._files.has(path)).toBe(false);
  });

  test("ein bereits gelöschtes Bild wirft keinen Fehler (Lifecycle räumt nach)", async () => {
    await expect(storage.deleteImage("queue-uploads/nicht-da.jpg")).resolves.toBeUndefined();
  });

  test("leerer Pfad ist ein No-Op", async () => {
    await expect(storage.deleteImage(null)).resolves.toBeUndefined();
  });
});

describe("Lokal-Modus (QUEUE_LOCAL=1, Emulator)", () => {
  const os = require("os");
  const nodePath = require("path");
  const fs = require("fs");
  const localDir = nodePath.join(os.tmpdir(), "malzime-queue-uploads");

  beforeEach(() => {
    process.env.QUEUE_LOCAL = "1";
  });

  afterEach(async () => {
    delete process.env.QUEUE_LOCAL;
    await fs.promises.rm(localDir, { recursive: true, force: true });
  });

  test("storeImage → loadImage → deleteImage über das Dateisystem", async () => {
    const objectPath = await storage.storeImage(Buffer.from("lokaler-inhalt"), "image/png");
    expect(objectPath).toMatch(/^queue-uploads\/.+\.png$/);

    const loaded = await storage.loadImage(objectPath);
    expect(loaded.buffer.toString()).toBe("lokaler-inhalt");
    expect(loaded.mimeType).toBe("image/png");

    await storage.deleteImage(objectPath);
    await expect(storage.loadImage(objectPath)).rejects.toBeDefined();
  });

  test("deleteImage auf eine fehlende Datei wirft nicht", async () => {
    await expect(storage.deleteImage("queue-uploads/gibt-es-nicht.jpg")).resolves.toBeUndefined();
  });
});
