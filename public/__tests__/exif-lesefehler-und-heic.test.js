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
import { prepareImage, dateizeitArt, zeitsprungArt } from "../js/exif.js";

const HEIC_KOPF = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const JPEG_KOPF = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

function datei(bytes, { arrayBufferWirft = false, readerWirft = false, kopfWirft = false, type = "image/jpeg" } = {}) {
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
  /* Kopf-Lesetest (16.09.2026): slice(0, 16) liefert den Anfang — oder wirft
     wie auf den betroffenen Android-Geraeten. */
  f.slice = (von, bis) => ({
    arrayBuffer: async () => {
      if (kopfWirft) {
        const e = new Error("nicht lesbar");
        e.name = "NotReadableError";
        throw e;
      }
      return buffer.slice(von, bis);
    },
  });
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

  it("Kopf-Lesetest: ist der Anfang lesbar, meldet der Fehler 'ok'", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f, { auswahlZeit: Date.now() }).catch((e) => e);
    expect(err.message).toBe("read_failed");
    expect(err.kopfLesetest).toBe("ok");
  }, 10000);

  it("Kopf-Lesetest: ist auch der Anfang nicht lesbar, steht dort der Fehlername", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true, kopfWirft: true });
    const err = await prepareImage(f, { auswahlZeit: Date.now() }).catch((e) => e);
    expect(err.kopfLesetest).toBe("NotReadableError");
  }, 10000);

  it("Kopf-Lesetest: eine leere Datei heisst 'leer', nicht 'ok'", async () => {
    const f = datei(new Uint8Array(0), { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f, { auswahlZeit: Date.now() }).catch((e) => e);
    expect(err.kopfLesetest).toBe("leer");
  }, 10000);

  it("klappt der zweite Leseweg, gibt es keinen Kopf-Lesetest und keinen Fehler", async () => {
    bildLaedt = true;
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, kopfWirft: true });
    const ergebnis = await prepareImage(f, { auswahlZeit: Date.now() });
    expect(ergebnis.imageBase64).toBe("QUJD");
  }, 10000);

  it("ohne Auswahlzeit bleibt msSeitAuswahl null statt einer erfundenen Zahl", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f).catch((e) => e);
    expect(err.msSeitAuswahl).toBeNull();
  }, 10000);
});

/* Am Android-Prüfgerät gemessen (09.10.2026, Chromium 157): Foto-Fenster des
   Systems (Android 15) → die Zeit liegt im Augenblick der Auswahl (11 bis 54 ms
   davor); Chromiums eigenes Foto-Fenster (Android 10), Dateien-Dialog und
   Galerie-App → die echte Änderungszeit, auf Sekunden oder Millisekunden. */
describe("Lesefehler: Art der Zeitangabe der Datei", () => {
  const AUSWAHL = 1791555880537;

  it("Zeit der Datei liegt im Augenblick der Auswahl: der Browser kennt keine eigene", () => {
    expect(dateizeitArt({ lastModified: AUSWAHL - 52 }, AUSWAHL)).toBe("keine");
    expect(dateizeitArt({ lastModified: AUSWAHL - 11 }, AUSWAHL)).toBe("keine");
    expect(dateizeitArt({ lastModified: AUSWAHL + 3 }, AUSWAHL)).toBe("keine");
  });

  it("echte Zeit der Datei, auf volle Sekunden", () => {
    expect(dateizeitArt({ lastModified: 1786372853000 }, AUSWAHL)).toBe("sekunden");
  });

  it("echte Zeit der Datei, auf Millisekunden", () => {
    expect(dateizeitArt({ lastModified: 1791556068149 - 600000 }, AUSWAHL)).toBe("millisekunden");
  });

  it("Grenze: knapp unter zwei Sekunden Abstand zählt als „keine“, genau zwei Sekunden nicht mehr", () => {
    expect(dateizeitArt({ lastModified: AUSWAHL - 1999 }, AUSWAHL)).toBe("keine");
    expect(dateizeitArt({ lastModified: AUSWAHL - 2000 }, AUSWAHL)).toBe("millisekunden");
  });

  it("ohne Zeit der Datei oder ohne Zeitpunkt der Auswahl: „unbekannt“", () => {
    expect(dateizeitArt({}, AUSWAHL)).toBe("unbekannt");
    expect(dateizeitArt({ lastModified: NaN }, AUSWAHL)).toBe("unbekannt");
    expect(dateizeitArt(null, AUSWAHL)).toBe("unbekannt");
    expect(dateizeitArt({ lastModified: AUSWAHL }, null)).toBe("unbekannt");
  });

  it("der Lesefehler trägt das Stichwort, und nur ein Wort aus der festen Liste", async () => {
    const f = datei(JPEG_KOPF, { arrayBufferWirft: true, readerWirft: true });
    const err = await prepareImage(f, { auswahlZeit: Date.now() }).catch((e) => e);
    expect(err.message).toBe("read_failed");
    expect(["keine", "sekunden", "millisekunden", "unbekannt"]).toContain(err.dateizeit);
  }, 10000);
});

/* Dieselbe Datei zweimal hintereinander gewählt: Hat sich ihre Zeit geändert?
   Am Prüfgerät blieb sie gleich; auf den betroffenen Handys ist das die offene
   Frage hinter dem Lesefehler. */
describe("Lesefehler: Vergleich mit der vorigen Auswahl", () => {
  const ZEIT = 1791557378000;
  const vorige = { name: "foto.jpg", size: 277504, lastModified: ZEIT };
  const datei = (aenderung = {}) => ({ name: "foto.jpg", size: 277504, lastModified: ZEIT, ...aenderung });

  it("ohne vorige Auswahl oder bei einer anderen Datei: „neu“", () => {
    expect(zeitsprungArt(null, datei())).toBe("neu");
    expect(zeitsprungArt(vorige, datei({ name: "anderes.jpg" }))).toBe("neu");
    expect(zeitsprungArt(vorige, datei({ size: 277505 }))).toBe("neu");
  });

  it("Erfolgsweg der Messung: dieselbe Datei mit derselben Zeit ist „gleich“", () => {
    expect(zeitsprungArt(vorige, datei())).toBe("gleich");
  });

  it("kleiner Sprung: unter zwei Sekunden, vor oder zurück", () => {
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 1000 }))).toBe("bis-2s");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT - 1 }))).toBe("bis-2s");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 1999 }))).toBe("bis-2s");
  });

  it("ganze Stunden, wie bei einer verschobenen Zeitzone (zwei Sekunden Spiel)", () => {
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 3600000 }))).toBe("stunden");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT - 2 * 3600000 }))).toBe("stunden");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 3600000 - 1500 }))).toBe("stunden");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 3600000 + 1999 }))).toBe("stunden");
  });

  it("Grenze: genau zwei Sekunden und alles, was nicht auf Stunden fällt, ist „anders“", () => {
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 2000 }))).toBe("anders");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 3600000 + 2000 }))).toBe("anders");
    expect(zeitsprungArt(vorige, datei({ lastModified: ZEIT + 3572000 }))).toBe("anders");
  });

  it("fehlt eine der Zeiten, gilt die Auswahl als „neu“ (kein Wort, das etwas behauptet)", () => {
    expect(zeitsprungArt(vorige, datei({ lastModified: undefined }))).toBe("neu");
    expect(zeitsprungArt({ ...vorige, lastModified: NaN }, datei())).toBe("neu");
  });
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

  it("HEIC: die Zeichenflaeche des Dekoders ist nach dem Verkleinern freigegeben", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    heicZuCanvas.mockResolvedValue(canvas);
    const ergebnis = await prepareImage(datei(HEIC_KOPF, { type: "image/heic" }), { auswahlZeit: Date.now() });
    /* Positivkontrolle: Das Bild ist entstanden … */
    expect(ergebnis.imageBase64).toBe("QUJD");
    /* … und die Flaeche in Originalgroesse ist wieder frei. */
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("HEIC: scheitert das Verkleinern, ist die Zeichenflaeche des Dekoders trotzdem freigegeben", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    heicZuCanvas.mockResolvedValue(canvas);
    const echterKontext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => null;
    try {
      const err = await prepareImage(datei(HEIC_KOPF, { type: "image/heic" }), { auswahlZeit: Date.now() }).catch(
        (x) => x
      );
      expect(err.message).toBe("image_decode_failed");
      expect(err.fileFormat).toBe("heic");
      expect([canvas.width, canvas.height]).toEqual([0, 0]);
    } finally {
      HTMLCanvasElement.prototype.getContext = echterKontext;
    }
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

/* BUG-2026-08-20-37: Kann der Browser keinen Zeichen-Kontext anlegen
   (Speichergrenze, auf iPhones beim zweiten Bild einer Sitzung schon
   vorgekommen), bleibt die eben angelegte Zeichenfläche sonst belegt — und
   macht das nächste Foto noch wahrscheinlicher zum nächsten Fehler. */
describe("Zeichenfläche ohne Kontext", () => {
  let flaechen;
  beforeEach(() => {
    bildLaedt = true;
    /* Das geladene Bild hat eine Größe — sonst wäre die Fläche von Anfang an leer. */
    for (const [seite, wert] of [
      ["width", 800],
      ["height", 600],
    ]) {
      Object.defineProperty(globalThis.Image.prototype, seite, { configurable: true, get: () => wert });
    }
    flaechen = [];
    const echt = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((name, ...rest) => {
      const el = echt(name, ...rest);
      if (String(name).toLowerCase() === "canvas") flaechen.push(el);
      return el;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Image.prototype.width;
    delete globalThis.Image.prototype.height;
  });

  it("Erfolgsweg: mit Kontext entsteht das Bild, und die Fläche ist danach freigegeben", async () => {
    const ergebnis = await prepareImage(datei(JPEG_KOPF), { auswahlZeit: Date.now() });
    expect(ergebnis.imageBase64).toBe("QUJD");
    expect(flaechen).toHaveLength(1);
    expect([flaechen[0].width, flaechen[0].height]).toEqual([0, 0]);
  });

  it("ohne Kontext: Dekodierfehler mit Diagnose, und die Fläche ist freigegeben", async () => {
    let groesseBeimVersuch = null;
    HTMLCanvasElement.prototype.getContext = function () {
      groesseBeimVersuch = [this.width, this.height];
      return null;
    };
    const err = await prepareImage(datei(JPEG_KOPF), { auswahlZeit: Date.now() - 300 }).catch((x) => x);
    expect(err.message).toBe("image_decode_failed");
    /* Die Fläche war wirklich angelegt (800 × 600) … */
    expect(groesseBeimVersuch).toEqual([800, 600]);
    /* … und ist nach dem Fehler wieder frei. */
    expect(flaechen).toHaveLength(1);
    expect([flaechen[0].width, flaechen[0].height]).toEqual([0, 0]);
    /* Die Fehlererfassung sieht, WO es scheiterte und bei welcher Art Datei. */
    expect(err.errorDetail).toBe("canvas");
    expect(err.fileFormat).toBe("jpeg");
    expect(err.fileSizeKb).toBe(0);
    expect(err.msSeitAuswahl).toBeGreaterThanOrEqual(300);
  });
});
