"use strict";

/* Ein Platz im Stundenfenster wird nur ueber EINE Hilfe freigegeben — und die
   wird ueberall abgewartet (STRUCT-2026-10-03-37, STRUCT-2026-10-03-36).

   Die Freigabe stand an sechs Stellen in drei Dateien, an vier davon ohne
   Abwarten, jede mit etwas anderer Reihenfolge von "Platz zurueckgeben" und
   "Foto loeschen". Eine verlorene Freigabe haelt einen Platz bis zu 60 Minuten
   belegt, ohne Signal. Jetzt gibt es `belegtesFreigeben` (ruecknahme.js): erst
   der Platz, dann das Foto, beides abgewartet, wirft nie.

   Zwei Pruefungen:
     1. am Quelltext: Ausserhalb der Hilfe ruft niemand die Zaehler-Funktion
        direkt, und jeder Aufruf der Hilfe steht hinter `await`. Eine neue
        Stelle faellt damit automatisch unter die Regel.
     2. am Verhalten der Hilfe selbst. */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");
const quellen = () =>
  fs
    .readdirSync(SRC)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, zeilen: fs.readFileSync(path.join(SRC, name), "utf8").split("\n") }));

/* Zeilen, in denen `name(` AUFGERUFEN wird — ohne Kommentare, ohne die
   Definition und ohne Import/Export. */
function aufrufe(zeilen, name) {
  return zeilen
    .map((text, i) => ({ text: text.trim(), nr: i + 1 }))
    .filter(({ text }) => text.includes(`${name}(`))
    .filter(({ text }) => !/^(\/\*|\*|\/\/)/.test(text))
    .filter(({ text }) => !text.startsWith(`async function ${name}(`) && !text.startsWith(`function ${name}(`));
}

const ohneAwait = (zeilen, name) =>
  aufrufe(zeilen, name).filter(({ text }) => !new RegExp(`\\bawait ${name}\\(`).test(text));

describe("am Quelltext", () => {
  test("Messmittel: die Suche findet einen Aufruf und erkennt einen ohne Abwarten", () => {
    const beispiel = [
      "  await belegtesFreigeben(job);",
      "  belegtesFreigeben(job).catch(() => {});",
      "  /* belegtesFreigeben(job) im Kommentar */",
      "async function belegtesFreigeben(auftrag) {",
      "  const ok = await belegtesFreigeben({ zaehlerStempel, imagePath });",
    ];
    expect(aufrufe(beispiel, "belegtesFreigeben").map((a) => a.nr)).toEqual([1, 2, 5]);
    expect(ohneAwait(beispiel, "belegtesFreigeben").map((a) => a.nr)).toEqual([2]);
  });

  test("die Zaehler-Funktion releaseHourlySlot kommt nur im Zaehler und in der Hilfe vor", () => {
    const fundstellen = quellen()
      .filter(({ name }) => name !== "counter.js" && name !== "ruecknahme.js")
      .flatMap(({ name, zeilen }) =>
        zeilen.map((text, i) => (text.includes("releaseHourlySlot") ? `${name}:${i + 1}` : null)).filter(Boolean)
      );
    expect(fundstellen).toEqual([]);
  });

  test("die Hilfe wird an den fuenf Stellen gerufen, die einen Auftrag zuruecknehmen — und ueberall abgewartet", () => {
    const stellen = quellen().flatMap(({ name, zeilen }) =>
      aufrufe(zeilen, "belegtesFreigeben").map(({ nr }) => ({ name, nr }))
    );
    const jeDatei = stellen.reduce((zahl, { name }) => ({ ...zahl, [name]: (zahl[name] || 0) + 1 }), {});
    /* Einlass: eine gemeinsame Rueckabwicklung. Verarbeiter: verlassener
       Auftrag. Aufraeumdienst: verlassen und ueberfaellig. Statusabfrage: ein
       vom Browser abgemeldeter Auftrag (PRIV-2026-10-03-57). */
    expect(jeDatei).toEqual({
      "handle-enqueue.js": 1,
      "handle-job-status.js": 1,
      "handle-process-job.js": 1,
      "handle-reap.js": 2,
    });

    const nichtAbgewartet = quellen().flatMap(({ name, zeilen }) =>
      ohneAwait(zeilen, "belegtesFreigeben").map(({ nr }) => `${name}:${nr}`)
    );
    expect(nichtAbgewartet).toEqual([]);
  });
});

describe("die Hilfe selbst", () => {
  let belegtesFreigeben;
  let counter;
  let storage;
  let ablauf;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../counter", () => ({ releaseHourlySlot: jest.fn() }));
    jest.doMock("../queue-storage", () => ({ deleteImage: jest.fn() }));
    counter = require("../counter");
    storage = require("../queue-storage");
    belegtesFreigeben = require("../ruecknahme").belegtesFreigeben;
    ablauf = [];
    counter.releaseHourlySlot.mockImplementation(async () => {
      await new Promise((weiter) => setTimeout(weiter, 5));
      ablauf.push("platz");
    });
    storage.deleteImage.mockImplementation(async () => {
      ablauf.push("foto");
      return true;
    });
  });

  afterEach(() => {
    jest.dontMock("../counter");
    jest.dontMock("../queue-storage");
  });

  test("erst der Platz, dann das Foto — beides ist durch, wenn sie zurueckkehrt", async () => {
    const geloescht = await belegtesFreigeben({ zaehlerStempel: 4711.5, imagePath: "queue-uploads/x.jpg" });

    expect(ablauf).toEqual(["platz", "foto"]);
    expect(counter.releaseHourlySlot).toHaveBeenCalledWith(4711.5);
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
    expect(geloescht).toBe(true);
  });

  test("scheitert die Freigabe, wird das Foto trotzdem geloescht, und die Hilfe wirft nicht", async () => {
    counter.releaseHourlySlot.mockRejectedValue(new Error("Zaehler nicht erreichbar"));

    await expect(belegtesFreigeben({ zaehlerStempel: 1, imagePath: "queue-uploads/x.jpg" })).resolves.toBe(true);

    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
  });

  test("liess sich das Foto nicht loeschen, sagt die Hilfe das dem Aufrufer", async () => {
    storage.deleteImage.mockResolvedValue(false);

    expect(await belegtesFreigeben({ zaehlerStempel: 1, imagePath: "queue-uploads/x.jpg" })).toBe(false);
  });
});
