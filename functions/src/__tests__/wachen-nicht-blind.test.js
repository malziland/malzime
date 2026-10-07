"use strict";

/* Zwei Wachen koennen nicht mehr still blind werden (OPS-2026-10-03-25).

   1. Die Dauer-Messung. Scheitert ihr Fortschreiben, steht jetzt eine Warnung im
      Protokoll (vorher: nichts — die Warnung im Verarbeiter hing an einem
      Fehler, den die Messung nie weitergab). Und die Einlassgrenze rechnet
      nicht mehr mit beliebig alten Messwerten: Sind sie aelter als eine Woche,
      gilt der feste Wert aus dem Einstellungssatz — dieselbe Regel wie bei der
      Wartezeit-Ansage.
   2. Der Waechter ueber die Wochen-Erinnerung. Ist ihr Lebenszeichen nicht
      lesbar, zaehlt er die Laeufe; nach fuenf in Folge meldet er einen Fehler —
      wie bei den Betriebswerten.

   Echte Module: Dauer-Messung, Einlassgrenze, Aufraeumdienst — gegen eine
   Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: true })) }));
jest.mock("../jobs", () => ({
  findAbandonedJobs: jest.fn(async () => []),
  findUeberfaelligeJobs: jest.fn(async () => []),
  findStaleProcessingJobs: jest.fn(async () => []),
  findExpiredJobs: jest.fn(async () => []),
  findZugestellteJobs: jest.fn(async () => []),
  abandonJob: jest.fn(),
  failJob: jest.fn(),
  deleteJob: jest.fn(),
  nachmeldenBeimLoeschen: jest.fn(),
}));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));
jest.mock("../counter", () => ({ releaseHourlySlot: jest.fn(async () => {}) }));

const { SATZ } = require("../test-satz");
const speicher = require("./hilfen/speicher-datenbank");
const durchsatz = require("../durchsatz");
const { _aktuelleEinlassgrenze } = require("../handle-enqueue");

const TAG = 24 * 60 * 60 * 1000;

let warnung;
let fehler;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));

beforeEach(() => {
  speicher.leeren();
  durchsatz._cacheLeeren();
  jest.spyOn(console, "log").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Dauer-Messung: ein Fehlschlag steht im Protokoll", () => {
  test("scheitert das Fortschreiben, kehrt die Messung ohne Fehler zurueck und schreibt eine Warnung", async () => {
    speicher.vor(({ art }) => {
      if (art === "transaktion") throw Object.assign(new Error("UNAVAILABLE stats/durchsatz"), { code: 14 });
    });

    await expect(durchsatz.merkeDauer(40)).resolves.toBeUndefined();

    expect(speicher.lies("stats/durchsatz")).toBeUndefined();
    expect(fehler).not.toHaveBeenCalled();
    expect(zeilen(warnung)).toEqual([
      { severity: "WARNING", step: "durchsatz", warning: "merkeDauer-fehlgeschlagen", code: 14, art: "Error" },
    ]);
  });

  test("scheitert nur die Tageshistorie, steht dafuer eine eigene Warnung da — der Messwert ist geschrieben", async () => {
    let transaktionen = 0;
    speicher.vor(({ art }) => {
      if (art === "transaktion" && (transaktionen += 1) === 2) throw new Error("UNAVAILABLE");
    });

    await durchsatz.merkeDauer(40);

    expect(speicher.lies("stats/durchsatz").werte).toHaveLength(1);
    expect(speicher.lies("stats/laufzeit-tage")).toBeUndefined();
    expect(zeilen(warnung).map((zeile) => zeile.warning)).toEqual(["merkeTag-fehlgeschlagen"]);
  });

  test("ohne Stoerung: Messwert und Tageshistorie geschrieben, keine Zeile", async () => {
    await durchsatz.merkeDauer(40);

    expect(speicher.lies("stats/durchsatz").werte.map((wert) => wert.s)).toEqual([40]);
    expect(speicher.lies("stats/laufzeit-tage").tage).toHaveLength(1);
    expect(warnung).not.toHaveBeenCalled();
  });

  test("ein Wert ausserhalb des plausiblen Bereichs wird still verworfen — das ist kein Fehlschlag", async () => {
    await durchsatz.merkeDauer(4000);

    expect(speicher.lies("stats/durchsatz")).toBeUndefined();
    expect(warnung).not.toHaveBeenCalled();
  });
});

describe("Einlassgrenze: keine Rechnung mit veralteten Messwerten", () => {
  const messwerte = (alterMs) =>
    speicher.lege("stats/durchsatz", {
      werte: Array.from({ length: 20 }, () => ({ s: 25, t: Date.now() - alterMs })),
    });

  test("20 Werte von 25 Sekunden, 30 Tage alt: es gilt der feste Wert aus dem Einstellungssatz", async () => {
    messwerte(30 * TAG);

    expect(await _aktuelleEinlassgrenze()).toBe(SATZ.warteschlangeTiefe);
  });

  test("dieselben Werte, frisch: die Grenze wird aus der Messung gerechnet", async () => {
    messwerte(60 * 1000);

    const grenze = await _aktuelleEinlassgrenze();

    expect(grenze).not.toBe(SATZ.warteschlangeTiefe);
    expect(grenze).toBeGreaterThan(0);
  });

  test("die Grenze liegt bei einer Woche: sechs Tage alt zaehlt noch, acht Tage alt nicht mehr", async () => {
    messwerte(6 * TAG);
    const sechsTage = await _aktuelleEinlassgrenze();
    durchsatz._cacheLeeren();
    messwerte(8 * TAG);
    const achtTage = await _aktuelleEinlassgrenze();

    expect(sechsTage).not.toBe(SATZ.warteschlangeTiefe);
    expect(achtTage).toBe(SATZ.warteschlangeTiefe);
  });
});

describe("Waechter ueber die Wochen-Erinnerung: zaehlt Laeufe ohne lesbares Lebenszeichen", () => {
  let reapJobs;
  let lesbar;

  beforeEach(() => {
    /* Der Waechter zaehlt im Modulzustand — je Test ein frisch geladenes Modul. */
    jest.isolateModules(() => {
      reapJobs = require("../handle-reap").reapJobs;
    });
    lesbar = false;
    speicher.lege("config/erinnerung", { letzterErfolg: Date.now() });
    speicher.vor(({ art, pfad }) => {
      if (art === "get" && pfad === "config/erinnerung" && !lesbar) throw new Error("PERMISSION_DENIED");
    });
  });

  const erinnerungsWarnungen = () => zeilen(warnung).filter((zeile) => zeile.warning === "lebenszeichen-nicht-lesbar");
  const erinnerungsFehler = () =>
    zeilen(fehler).filter((zeile) => zeile.error === "lebenszeichen-wiederholt-nicht-lesbar");

  test("vier Laeufe in Folge: je eine Warnung mit Schweregrad, kein Fehler", async () => {
    for (let lauf = 1; lauf <= 4; lauf += 1) await reapJobs();

    expect(erinnerungsWarnungen()).toHaveLength(4);
    expect(erinnerungsWarnungen()[0]).toMatchObject({ severity: "WARNING", step: "reap" });
    expect(fehler).not.toHaveBeenCalled();
  });

  test("fuenf Laeufe in Folge: ein Fehler mit der Anzahl, und jeder weitere Lauf meldet erneut", async () => {
    for (let lauf = 1; lauf <= 6; lauf += 1) await reapJobs();

    expect(erinnerungsFehler().map((zeile) => zeile.laeufeInFolge)).toEqual([5, 6]);
    expect(erinnerungsFehler()[0]).toMatchObject({ severity: "ERROR", step: "reap" });
  });

  test("ein lesbares Lebenszeichen dazwischen setzt die Zaehlung zurueck", async () => {
    for (let lauf = 1; lauf <= 4; lauf += 1) await reapJobs();
    lesbar = true;
    await reapJobs();
    lesbar = false;
    for (let lauf = 1; lauf <= 4; lauf += 1) await reapJobs();

    expect(fehler).not.toHaveBeenCalled();
    expect(erinnerungsWarnungen()).toHaveLength(8);
  });

  test("lesbar und frisch: weder Warnung noch Fehler", async () => {
    lesbar = true;

    await reapJobs();

    expect(warnung).not.toHaveBeenCalled();
    expect(fehler).not.toHaveBeenCalled();
  });
});
