"use strict";

/* Ein Platz im Stundenfenster wird nur ueber EINE Hilfe freigegeben — und die
   wird ueberall abgewartet (STRUCT-2026-10-03-37, STRUCT-2026-10-03-36).

   Die Freigabe stand an sechs Stellen in drei Dateien, an vier davon ohne
   Abwarten, jede mit etwas anderer Reihenfolge von "Platz zurueckgeben" und
   "Foto loeschen". Eine verlorene Freigabe haelt einen Platz bis zu 60 Minuten
   belegt, ohne Signal. Jetzt gibt es `belegtesFreigeben` (ruecknahme.js): erst
   das Foto, dann der Platz, beides abgewartet, wirft nie.
   ERST DAS FOTO (07.10.2026): Stand die Freigabe des Platzes vorn und hing
   sie, blieb das Foto eines schon verworfenen Auftrags bis zur
   2-Stunden-Loeschung liegen. Auf den Platz wird deshalb auch nur begrenzt
   gewartet.

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

  test("erst das Foto, dann der Platz — beides ist durch, wenn sie zurueckkehrt", async () => {
    const geloescht = await belegtesFreigeben({ zaehlerStempel: 4711.5, imagePath: "queue-uploads/x.jpg" });

    expect(ablauf).toEqual(["foto", "platz"]);
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

  test("haengt die Freigabe des Platzes, ist das Foto trotzdem sofort geloescht", async () => {
    let freigabeFertig;
    counter.releaseHourlySlot.mockImplementation(() => new Promise((fertig) => (freigabeFertig = fertig)));
    jest.useFakeTimers();
    try {
      let zurueck = null;
      const lauf = belegtesFreigeben({ zaehlerStempel: 7, imagePath: "queue-uploads/y.jpg" }).then((wert) => {
        zurueck = wert;
      });
      await jest.advanceTimersByTimeAsync(0);
      /* Das Foto ist weg, obwohl die Freigabe noch haengt. */
      expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/y.jpg");
      expect(ablauf).toEqual(["foto"]);
      expect(zurueck).toBeNull();
      freigabeFertig();
      await lauf;
      expect(zurueck).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("auf eine haengende Freigabe wartet die Hilfe hoechstens fuenf Sekunden — und sagt es", async () => {
    const { _FREIGABE_WARTEN_HOECHSTENS_MS } = require("../ruecknahme");
    expect(_FREIGABE_WARTEN_HOECHSTENS_MS).toBe(5000);
    counter.releaseHourlySlot.mockImplementation(() => new Promise(() => {}));
    const warnungen = [];
    jest.spyOn(console, "warn").mockImplementation((zeile) => warnungen.push(String(zeile)));
    jest.useFakeTimers();
    try {
      let fertig = false;
      const lauf = belegtesFreigeben({ zaehlerStempel: 7, imagePath: "queue-uploads/y.jpg" }).then((wert) => {
        fertig = wert;
      });
      await jest.advanceTimersByTimeAsync(4900);
      expect(fertig).toBe(false);
      await jest.advanceTimersByTimeAsync(200);
      await lauf;
      expect(fertig).toBe(true);
      expect(warnungen).toHaveLength(1);
      expect(JSON.parse(warnungen[0])).toEqual({ severity: "WARNING", warning: "release-slot-nicht-abgewartet" });
    } finally {
      jest.useRealTimers();
      console.warn.mockRestore();
    }
  });

  test("kommt die Freigabe rechtzeitig, gibt es keine Warnung (Erfolgsweg)", async () => {
    const warnungen = [];
    jest.spyOn(console, "warn").mockImplementation((zeile) => warnungen.push(String(zeile)));
    try {
      await belegtesFreigeben({ zaehlerStempel: 7, imagePath: "queue-uploads/y.jpg" });
      expect(warnungen).toEqual([]);
    } finally {
      console.warn.mockRestore();
    }
  });
});
