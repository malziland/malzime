import { describe, test, expect, vi } from "vitest";

vi.mock("../lib/exifr/lite.esm.mjs", () => ({
  default: { parse: vi.fn().mockResolvedValue(null) },
}));

import { sniffFormat, prepareImage, READ_RETRY_DELAY_MS } from "../js/exif.js";

/* Baut Test-Bytes: erste Bytes wie angegeben, Rest mit Nullen auf 16 aufgefuellt. */
function bytes(...head) {
  const arr = new Uint8Array(16);
  head.forEach((b, i) => (arr[i] = typeof b === "string" ? b.charCodeAt(0) : b));
  return arr;
}

/* Nachgebauter DOMException-Ersatz — eslint kennt DOMException im Test-Env nicht,
   und der Code liest ohnehin nur err.name. */
function notReadableError() {
  const err = new Error("read error");
  err.name = "NotReadableError";
  return err;
}

describe("sniffFormat", () => {
  test("erkennt JPEG an ff d8", () => {
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
  });

  test("erkennt PNG", () => {
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("png");
  });

  test("erkennt HEIC (ftypheic)", () => {
    const arr = bytes(0, 0, 0, 0x18, "f", "t", "y", "p", "h", "e", "i", "c");
    expect(sniffFormat(arr)).toBe("heic");
  });

  test("erkennt AVIF (ftypavif)", () => {
    const arr = bytes(0, 0, 0, 0x18, "f", "t", "y", "p", "a", "v", "i", "f");
    expect(sniffFormat(arr)).toBe("avif");
  });

  test("zu kurze Datei ist 'leer'", () => {
    expect(sniffFormat(new Uint8Array(4))).toBe("leer");
  });

  test("unbekannte Bytes sind 'unbekannt'", () => {
    expect(sniffFormat(bytes(0x00, 0x01, 0x02, 0x03))).toBe("unbekannt");
  });
});

describe("prepareImage bei unlesbarer Datei (Vorfall 2026-07-06)", () => {
  test(
    "wirft read_failed mit Diagnose-Feldern, wenn beide Leseversuche scheitern",
    async () => {
      const file = {
        size: 3 * 1024 * 1024,
        type: "image/jpeg",
        arrayBuffer: vi.fn().mockRejectedValue(notReadableError()),
      };
      const promise = prepareImage(file).then(
        () => null,
        (e) => e
      );
      const err = await promise;
      expect(err).not.toBeNull();
      expect(err.message).toBe("read_failed");
      expect(err.errorDetail).toBe("NotReadableError");
      expect(err.fileFormat).toBe("decl:image/jpeg");
      expect(err.fileSizeKb).toBe(3072);
      /* Beide Versuche wurden gemacht (Sofort + Retry). */
      expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
    },
    5000 + READ_RETRY_DELAY_MS
  );

  test(
    "zweiter Leseversuch rettet einen transienten Fehler",
    async () => {
      const jpegBytes = new Uint8Array(16);
      jpegBytes[0] = 0xff;
      jpegBytes[1] = 0xd8;
      const file = {
        size: 1024,
        type: "image/jpeg",
        arrayBuffer: vi.fn().mockRejectedValueOnce(notReadableError()).mockResolvedValueOnce(jpegBytes.buffer),
      };
      /* jsdom kann keine Bilder dekodieren — wir pruefen nur, dass die Lese-Phase
       ueberlebt wird: der Fehler danach darf KEIN read_failed mehr sein. */
      globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
      globalThis.URL.revokeObjectURL = vi.fn();
      const OrigImage = globalThis.Image;
      globalThis.Image = class {
        set src(_) {
          setTimeout(() => this.onerror && this.onerror(), 0);
        }
      };
      try {
        const err = await prepareImage(file).then(
          () => null,
          (e) => e
        );
        expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
        expect(err.message).toBe("image_decode_failed");
        expect(err.fileFormat).toBe("jpeg");
      } finally {
        globalThis.Image = OrigImage;
      }
    },
    5000 + READ_RETRY_DELAY_MS
  );
});
