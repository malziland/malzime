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
          if (!files.has(path)) {
            /* Wie GCS: ein nicht vorhandenes Objekt meldet 404. */
            const err = new Error("object not found");
            err.code = 404;
            throw err;
          }
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

  test("ein bereits gelöschtes Bild (404) gilt als erfolgreich, ohne Meldung", async () => {
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(storage.deleteImage("queue-uploads/nicht-da.jpg")).resolves.toBe(true);
    expect(fehlerSpy).not.toHaveBeenCalled();
    fehlerSpy.mockRestore();
  });

  test("leerer Pfad ist ein No-Op und gilt als erfolgreich", async () => {
    await expect(storage.deleteImage(null)).resolves.toBe(true);
  });

  /* PRIV-2026-08-12-26 / OPS-2026-08-12-10: Bis zum 2026-08-12 verschluckte
     deleteImage JEDEN Fehler in eine console.log-Zeile ohne severity — also
     unterhalb der Alarmschwelle — und gab nichts zurück. Der Aufrufer löschte
     danach das Job-Dokument mitsamt dem einzigen Verweis auf die Datei.
     Gemessen: 11 solcher Fehlschläge in 30 Tagen, alle unbemerkt. */
  test("ein echter Löschfehler gibt false zurück UND meldet mit severity ERROR", async () => {
    const pfad = await storage.storeImage(Buffer.from("x"), "image/jpeg");
    const echterFehler = new Error("permission denied");
    echterFehler.code = 403;
    jest.spyOn(bucket, "file").mockReturnValue({
      async delete() {
        throw echterFehler;
      },
    });
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(storage.deleteImage(pfad)).resolves.toBe(false);

    expect(fehlerSpy).toHaveBeenCalledTimes(1);
    const zeile = JSON.parse(fehlerSpy.mock.calls[0][0]);
    expect(zeile.severity).toBe("ERROR");
    expect(zeile.error).toBe("queue-image-delete-failed");
    expect(zeile.path).toBe(pfad);
    fehlerSpy.mockRestore();
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

  test("deleteImage auf eine fehlende Datei wirft nicht und gilt als erfolgreich", async () => {
    /* Im Lokal-Modus meldet fs.unlink ENOENT — wie GCS' 404 der Normalfall. */
    await expect(storage.deleteImage("queue-uploads/gibt-es-nicht.jpg")).resolves.toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   OPS-2026-08-31-03 — Riegel gegen Zugriff auf den ECHTEN Bildspeicher.

   Am 30.08. lagen 4.056 Testbilder (233 MB) im Produktions-Bucket. Die
   Lifecycle-Regel war in Ordnung; was fehlte, war die aktive Loeschung nach
   der Analyse — die Bilder waren nie durch einen Worker gelaufen. Derselbe
   Fehlertyp hatte am selben Tag die Produktions-Warteschlange verstellt: Eine
   Attrappe, die nur greift, wenn ein Test daran DENKT, sie zu setzen.

   Der einzelne Test, der es vergisst, ist austauschbar — der Riegel nicht.
   ══════════════════════════════════════════════════════════════════════ */

describe("OPS-2026-08-31-03 — der echte Bildspeicher ist gegen Tests verriegelt", () => {
  test("ohne Attrappe wirft der Zugriff, statt in die Produktion zu schreiben", () => {
    jest.resetModules();
    const frisch = require("../queue-storage");
    frisch.setBucketForTest(null);
    expect(() => frisch._bucketFuerTest()).toThrow(/Attrappe/i);
  });

  test("mit Attrappe laeuft alles normal weiter", () => {
    jest.resetModules();
    const frisch = require("../queue-storage");
    const attrappe = { name: "attrappe" };
    frisch.setBucketForTest(attrappe);
    expect(frisch._bucketFuerTest()).toBe(attrappe);
    frisch.setBucketForTest(null);
  });
});
