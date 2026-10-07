/**
 * heic.test.js — der HEIC-Dekoder wird nur bei Bedarf geladen und meldet
 * Fehler mit Ort (Laden, Dekodieren, Zeichnen).
 *
 * ANLASS (08.09.2026): 3 von 31 Versuchen einer Klasse scheiterten an HEIC
 * auf Android. Der echte Dekoder (WebAssembly) laeuft nicht in jsdom — er
 * wird in e2e/problemfaelle.test.js in Chromium und Firefox gegen echte
 * HEIC-Dateien geprueft. Hier geht es um den Umgang mit ihm.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { heicZuCanvas, setDekoderLaderForTest } from "../js/heic.js";

/* Attrappe eines libheif-Moduls: liefert ein 2x3-Bild mit bekannten Pixeln. */
function modulAttrappe({ decodeWirft, displayScheitert, leer } = {}) {
  return {
    HeifDecoder: class {
      decode(bytes) {
        if (decodeWirft) throw new Error("kaputte datei");
        if (leer) return [];
        expect(bytes).toBeInstanceOf(Uint8Array);
        return [
          {
            get_width: () => 2,
            get_height: () => 3,
            display(imageData, cb) {
              if (displayScheitert) return cb(null);
              for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] = 200;
                imageData.data[i + 1] = 100;
                imageData.data[i + 2] = 50;
                imageData.data[i + 3] = 255;
              }
              cb(imageData);
            },
          },
        ];
      }
    },
  };
}

/* jsdom hat keinen Canvas-Kontext — eine minimale Attrappe fuer createImageData
   und putImageData genuegt, um den Datenfluss zu pruefen. */
let gezeichnet;
beforeEach(() => {
  gezeichnet = null;
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (d) => {
        gezeichnet = d;
      },
    };
  };
});
afterEach(() => setDekoderLaderForTest(null));

describe("heicZuCanvas", () => {
  it("dekodiert ueber das Modul und liefert einen Canvas in Originalgroesse", async () => {
    let geladen = 0;
    setDekoderLaderForTest(async () => {
      geladen += 1;
      return modulAttrappe();
    });
    const canvas = await heicZuCanvas(new Uint8Array([0, 0, 0, 24]));
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(3);
    expect(gezeichnet.data[0]).toBe(200);
    expect(gezeichnet.data[3]).toBe(255);
    expect(geladen).toBe(1);
  });

  it("meldet einen Ladefehler als image_decode_failed mit Ort 'heic:laden'", async () => {
    setDekoderLaderForTest(async () => {
      throw new Error("wasm 404");
    });
    const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
    expect(err.message).toBe("image_decode_failed");
    expect(err.errorDetail).toBe("heic:laden:wasm 404");
  });

  it("meldet einen Dekodierfehler mit Ort 'heic:dekodieren'", async () => {
    setDekoderLaderForTest(async () => modulAttrappe({ decodeWirft: true }));
    const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
    expect(err.message).toBe("image_decode_failed");
    expect(err.errorDetail).toBe("heic:dekodieren:kaputte datei");
  });

  it("eine Datei ohne Bild darin ist ein Dekodierfehler", async () => {
    setDekoderLaderForTest(async () => modulAttrappe({ leer: true }));
    const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
    expect(err.errorDetail).toBe("heic:dekodieren:leer");
  });

  it("scheitert das Zeichnen, heisst der Ort 'heic:zeichnen'", async () => {
    setDekoderLaderForTest(async () => modulAttrappe({ displayScheitert: true }));
    const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
    expect(err.errorDetail).toBe("heic:zeichnen");
  });

  it("der Ort im Fehler bleibt kurz — nichts aus der Datei, hoechstens 60 Zeichen", async () => {
    setDekoderLaderForTest(async () => modulAttrappe({ decodeWirft: true }));
    const modul = modulAttrappe();
    modul.HeifDecoder = class {
      decode() {
        throw new Error("x".repeat(500));
      }
    };
    setDekoderLaderForTest(async () => modul);
    const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
    expect(err.errorDetail.length).toBeLessThanOrEqual(60);
  });

  /* BUG-2026-08-20-37: Scheitert es NACH dem Anlegen der Zeichenfläche, wird
     sie freigegeben — in Originalgröße belegt ein Foto schnell 40 MB und mehr. */
  describe("Zeichenfläche im Fehlerfall", () => {
    let flaechen, spion;
    beforeEach(() => {
      flaechen = [];
      const echt = document.createElement.bind(document);
      spion = vi.spyOn(document, "createElement").mockImplementation((name, ...rest) => {
        const el = echt(name, ...rest);
        if (String(name).toLowerCase() === "canvas") flaechen.push(el);
        return el;
      });
    });
    afterEach(() => spion.mockRestore());

    it("Erfolgsweg: die Fläche bleibt in Originalgröße — sie ist das Ergebnis", async () => {
      setDekoderLaderForTest(async () => modulAttrappe());
      const canvas = await heicZuCanvas(new Uint8Array(4));
      expect(flaechen).toEqual([canvas]);
      expect([canvas.width, canvas.height]).toEqual([2, 3]);
    });

    it("kein Zeichen-Kontext: Ort 'heic:canvas', die Fläche ist freigegeben", async () => {
      let groesseBeimVersuch = null;
      HTMLCanvasElement.prototype.getContext = function () {
        groesseBeimVersuch = [this.width, this.height];
        return null;
      };
      setDekoderLaderForTest(async () => modulAttrappe());
      const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
      expect(err.message).toBe("image_decode_failed");
      expect(err.errorDetail).toBe("heic:canvas");
      expect(groesseBeimVersuch).toEqual([2, 3]);
      expect(flaechen).toHaveLength(1);
      expect([flaechen[0].width, flaechen[0].height]).toEqual([0, 0]);
    });

    it("das Zeichnen scheitert: die Fläche ist freigegeben", async () => {
      setDekoderLaderForTest(async () => modulAttrappe({ displayScheitert: true }));
      const err = await heicZuCanvas(new Uint8Array(4)).catch((e) => e);
      expect(err.errorDetail).toBe("heic:zeichnen");
      expect(flaechen).toHaveLength(1);
      expect([flaechen[0].width, flaechen[0].height]).toEqual([0, 0]);
    });
  });
});
