/**
 * exif-lesefehler-und-heic.test.js — was prepareImage tut, wenn das Geraet
 * die Datei nicht hergibt oder der Browser das Format nicht kennt.
 *
 * ANLASS (08.09.2026, eine Klasse, alle Android): 5× NotReadableError beim
 * Lesen, 3× HEIC nicht dekodierbar. Zwei Kinder probierten dieselbe Datei
 * zweimal — die Meldung hatte ihnen nicht geholfen. Geprueft wird:
 *   1. Zweiter Leseweg: liest FileReader die Datei doch, laeuft alles weiter.
 *   2. Scheitern beide, traegt der Fehler die Diagnosefelder msSeitAuswahl
 *      und zweiterLeseweg (ohne Dateiname, ohne Inhalt).
 *   3. Kennt der Browser das Format nicht und es ist HEIC, uebernimmt der
 *      Dekoder — mit demselben Ergebnisweg wie ein JPEG.
 *   4. Ist es kein HEIC, bleibt es ein Dekodierfehler mit Diagnose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../js/heic.js", () => ({
  heicZuCanvas: vi.fn(),
}));
import { heicZuCanvas } from "../js/heic.js";
import { prepareImage } from "../js/exif.js";

const HEIC_KOPF = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const JPEG_KOPF = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

function datei(bytes, { arrayBufferWirft = false, readerWirft = false, type = "image/jpeg" } = {}) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const f = new Blob([bytes], { type });
  Object.defineProperty(f, "size", { value: bytes.length });
  f.arrayBuffer = async () => {
    if (arrayBufferWirft) {
      const e = new Error("nicht lesbar");
      e.name = "NotReadableError";
      throw e;
    }
    return buffer;
  };
  f._readerWirft = readerWirft;
  f._buffer = buffer;
  return f;
}

let bildLaedt;
beforeEach(() => {
  /* Image in jsdom laedt nichts — wir steuern, ob "nativ" gelingt. */
  bildLaedt = false;
  globalThis.URL.createObjectURL = () => "blob:test";
  globalThis.URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis.Image.prototype, "src", {
    configurable: true,
    set() {
      setTimeout(() => (bildLaedt ? this.onload && this.onload() : this.onerror && this.onerror()), 0);
    },
  });
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    };
  };
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,QUJD";
  /* FileReader-Attrappe: liest, ausser die Datei sagt readerWirft. */
  globalThis.FileReader = class {
    readAsArrayBuffer(f) {
      setTimeout(() => {
        if (f._readerWirft) {
          this.error = { name: "NotReadableError" };
          this.onerror && this.onerror();
        } else {
          this.result = f._buffer;
          this.onload && this.onload();
        }
      }, 0);
    }
  };
  heicZuCanvas.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Lesefehler: zweiter Leseweg", () => {
  it("liest FileReader die Datei doch, laeuft die Analyse mit diesen Bytes weiter", async () => {
    bildLaedt = true;
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true });
    const ergebnis = await prepareImage(f, { auswahlZeit: Date.now() - 1500 });
    expect(ergebnis.imageBase64).toBe("QUJD");
  }, 10000);

  it("scheitern beide Wege, traegt der Fehler die Diagnosefelder", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f, { auswahlZeit: Date.now() - 1500 }).catch((e) => e);
    expect(err.message).toBe("read_failed");
    expect(err.errorDetail).toBe("NotReadableError");
    expect(err.zweiterLeseweg).toBe("NotReadableError");
    expect(err.msSeitAuswahl).toBeGreaterThanOrEqual(1500);
    expect(err.msSeitAuswahl).toBeLessThan(60000);
    expect(err.fileFormat).toBe("decl:image/jpeg");
  }, 10000);

  it("ohne Auswahlzeit bleibt msSeitAuswahl null statt einer erfundenen Zahl", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f).catch((e) => e);
    expect(err.msSeitAuswahl).toBeNull();
  }, 10000);
});

describe("Format, das der Browser nicht kennt", () => {
  it("HEIC: der Dekoder uebernimmt, das Ergebnis geht denselben Weg wie ein JPEG", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 6;
    heicZuCanvas.mockResolvedValue(canvas);
    const ergebnis = await prepareImage(datei(HEIC_KOPF, { type: "image/heic" }), { auswahlZeit: Date.now() });
    expect(heicZuCanvas).toHaveBeenCalledTimes(1);
    expect(ergebnis.imageBase64).toBe("QUJD");
    expect(ergebnis.mimeType).toBe("image/jpeg");
    expect(ergebnis.dateiname).toBe("upload.jpg");
  });

  it("HEIC, das der Browser selbst oeffnen kann (iPhone), braucht den Dekoder nicht", async () => {
    bildLaedt = true;
    await prepareImage(datei(HEIC_KOPF, { type: "image/heic" }));
    expect(heicZuCanvas).not.toHaveBeenCalled();
  });

  it("scheitert der Dekoder, traegt der Fehler Format, Groesse und Zeit seit Auswahl", async () => {
    const e = new Error("image_decode_failed");
    e.errorDetail = "heic:dekodieren:x";
    heicZuCanvas.mockRejectedValue(e);
    const err = await prepareImage(datei(HEIC_KOPF, { type: "image/heic" }), { auswahlZeit: Date.now() - 200 }).catch(
      (x) => x
    );
    expect(err.message).toBe("image_decode_failed");
    expect(err.errorDetail).toBe("heic:dekodieren:x");
    expect(err.fileFormat).toBe("heic");
    expect(err.fileSizeKb).toBe(0);
    expect(err.msSeitAuswahl).toBeGreaterThanOrEqual(200);
  });

  it("kein HEIC und nicht oeffenbar: Dekodierfehler mit Diagnose, Dekoder bleibt aus", async () => {
    const text = new globalThis.TextEncoder().encode("Das ist kein Bild, nur Text mit Endung jpg.");
    const err = await prepareImage(datei(text), { auswahlZeit: Date.now() }).catch((x) => x);
    expect(err.message).toBe("image_decode_failed");
    expect(err.errorDetail).toBe("decode");
    expect(err.fileFormat).not.toBe("heic");
    expect(heicZuCanvas).not.toHaveBeenCalled();
  });
});
