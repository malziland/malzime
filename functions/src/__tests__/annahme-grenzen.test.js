"use strict";

/* Grenzen der Foto-Annahme, die bis dahin kein Test hielt (TEST-2026-10-03-42):

     Multipart-Weg (upload.js)   Groessengrenze der Datei, hoechstens EINE Datei,
                                 hoechstens zehn Formularfelder. Das ist der
                                 Weg, den die Laufzeit mit dem vorab gelesenen
                                 Rumpf bedient.
     Bildart (handle-enqueue.js) Der Inhalt entscheidet, nicht die Behauptung —
                                 und zwar an BEIDEN Erkennungsmerkmalen eines
                                 Formats, nicht nur am ersten.

   Jede dieser Stellen liess sich ausbauen, ohne dass eine Zeile rot wurde.

   GRENZE DER DATEIGROESSE, gemessen und hier festgehalten: Der Multipart-Weg
   nimmt eine Datei bis ein Byte UNTER der Grenze an und lehnt sie ab, sobald
   sie die Grenze erreicht (die Lese-Bibliothek meldet das Erreichen). Der
   JSON-Weg laesst genau die Grenze noch zu (handle-enqueue.test.js). */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { MAX_UPLOAD_BYTES } = require("../config");
const { parseMultipart } = require("../upload");
const { detectImageType } = require("../handle-enqueue");

const GRENZE = "----grenze-test";

function teil(kopf, inhalt) {
  return Buffer.concat([Buffer.from(`--${GRENZE}\r\n${kopf}\r\n\r\n`), inhalt, Buffer.from("\r\n")]);
}
const datei = (name, inhalt) =>
  teil(`Content-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: image/jpeg`, inhalt);
const feld = (name, wert) => teil(`Content-Disposition: form-data; name="${name}"`, Buffer.from(wert));

/* Eine Anfrage, wie die Laufzeit sie uebergibt: der ganze Rumpf liegt schon vor. */
function anfrage(teile) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${GRENZE}` },
    rawBody: Buffer.concat([...teile, Buffer.from(`--${GRENZE}--\r\n`)]),
    on() {},
  };
}

describe("Multipart: Groessengrenze der Datei", () => {
  test("ein Byte unter der Grenze wird angenommen, mit der wirklichen Groesse", async () => {
    const ergebnis = await parseMultipart(anfrage([datei("a.jpg", Buffer.alloc(MAX_UPLOAD_BYTES - 1, 1))]));

    expect(ergebnis.file.size).toBe(MAX_UPLOAD_BYTES - 1);
    expect(ergebnis.file.buffer.length).toBe(MAX_UPLOAD_BYTES - 1);
  });

  test.each([
    ["genau auf der Grenze", 0],
    ["ein Byte darueber", 1],
  ])("%s wird mit 413 abgelehnt", async (_fall, mehr) => {
    await expect(
      parseMultipart(anfrage([datei("a.jpg", Buffer.alloc(MAX_UPLOAD_BYTES + mehr, 1))]))
    ).rejects.toMatchObject({
      status: 413,
      code: "file_too_large",
    });
  });
});

describe("Multipart: hoechstens eine Datei und zehn Felder", () => {
  test("von zwei Dateien zaehlt nur die erste", async () => {
    const ergebnis = await parseMultipart(
      anfrage([datei("erste.jpg", Buffer.from("ERSTE")), datei("zweite.jpg", Buffer.from("ZWEITE-DATEI"))])
    );

    expect(ergebnis.file.filename).toBe("erste.jpg");
    expect(ergebnis.file.buffer.toString()).toBe("ERSTE");
    expect(ergebnis.file.size).toBe(5);
  });

  test("von zwoelf Feldern kommen zehn an", async () => {
    const felder = Array.from({ length: 12 }, (_, i) => feld(`feld${i}`, `wert${i}`));

    const ergebnis = await parseMultipart(anfrage([...felder, datei("a.jpg", Buffer.from("X"))]));

    expect(Object.keys(ergebnis.fields)).toHaveLength(10);
    expect(ergebnis.fields.feld0).toBe("wert0");
    expect(ergebnis.fields.feld11).toBeUndefined();
  });

  test("zehn Felder gehen alle durch", async () => {
    const felder = Array.from({ length: 10 }, (_, i) => feld(`feld${i}`, `wert${i}`));

    const ergebnis = await parseMultipart(anfrage([...felder, datei("a.jpg", Buffer.from("X"))]));

    expect(Object.keys(ergebnis.fields)).toHaveLength(10);
  });
});

describe("Bildart: beide Merkmale eines Formats muessen stimmen", () => {
  const mit = (...anfang) => Buffer.concat([Buffer.from(anfang), Buffer.alloc(12)]);
  const riff = (kennung) =>
    Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from(kennung), Buffer.alloc(8)]);

  test.each([
    ["JPEG", mit(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    ["PNG", mit(0x89, 0x50, 0x4e, 0x47), "image/png"],
    ["GIF", Buffer.concat([Buffer.from("GIF8"), Buffer.alloc(12)]), "image/gif"],
    ["WebP", riff("WEBP"), "image/webp"],
  ])("ein richtiger Anfang wird erkannt: %s", (_name, anfang, typ) => {
    expect(detectImageType(anfang)).toBe(typ);
  });

  test.each([
    ["erstes Byte wie JPEG, zweites nicht", mit(0xff, 0x00, 0xff, 0xe0)],
    ["RIFF-Datei, aber Ton statt Bild (WAVE)", riff("WAVE")],
    ["RIFF-Datei, aber Film (AVI)", riff("AVI ")],
    ["PNG-Anfang um ein Byte verschoben", mit(0x00, 0x89, 0x50, 0x4e, 0x47)],
  ])("kein Bild: %s", (_fall, anfang) => {
    expect(detectImageType(anfang)).toBeNull();
  });
});
