"use strict";

/* Wartezeit-Wache (16.10.2026, wartezeit-wache.js): Push, wenn eine Analyse
   LAENGER als 5 Minuten vom Einreihen bis zum Start gewartet hat. 5:00 kein
   Alarm, 5:01 Alarm; hoechstens eine Nachricht je 30 Minuten (Marke in der
   Datenbank). Gegen die echte Auftragsverwaltung und eine Datenbank im
   Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const speicher = require("./hilfen/speicher-datenbank");
const wache = require("../wartezeit-wache");

const T = Date.UTC(2026, 9, 16, 7, 0, 0);
const SEK = 1000;
const MIN = 60 * SEK;

let warnungen;
let fehler;
let melder;
beforeEach(() => {
  speicher.leeren();
  wache._zuruecksetzen();
  warnungen = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  melder = jest.fn(async () => true);
});
afterEach(() => jest.restoreAllMocks());

const wartend = (id, seitMs) =>
  speicher.lege(`jobs/${id}`, { status: "queued", createdAt: T - seitMs, startedAt: null });
const gestartet = (id, wartezeitMs, vorMs = 30 * SEK) =>
  speicher.lege(`jobs/${id}`, {
    status: "done",
    createdAt: T - vorMs - wartezeitMs,
    startedAt: T - vorMs,
    finishedAt: T,
  });

describe("Grenze: laenger als 5 Minuten", () => {
  test.each([
    [4 * MIN + 59 * SEK, false],
    [5 * MIN - 1, false],
    [5 * MIN, false],
    [5 * MIN + 1, true],
    [5 * MIN + 1 * SEK, true],
  ])("zuLang(%i ms) = %s", (ms, erwartet) => {
    expect(wache.zuLang(ms)).toBe(erwartet);
  });

  test("ein Auftrag wartet genau 5:00 — kein Alarm", async () => {
    wartend("a", 5 * MIN);
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r.status).toBe("im-rahmen");
    expect(melder).not.toHaveBeenCalled();
  });

  test("ein Auftrag wartet 5:01 — Alarm mit laengster Wartezeit und Zahl der Wartenden", async () => {
    wartend("a", 5 * MIN + 1 * SEK);
    wartend("b", 1 * MIN);
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r).toEqual({ status: "gemeldet", laengsteMs: 5 * MIN + 1 * SEK, wartende: 2 });
    expect(melder).toHaveBeenCalledTimes(1);
    expect(melder.mock.calls[0][0]).toBe(
      "malziME: Eine Analyse hat 5 min 01 s auf ihren Start gewartet (Grenze 5 min 00 s). Gerade 2 Analysen warten."
    );
  });

  test("schon gestartet nach 5:00 Wartezeit — kein Alarm", async () => {
    gestartet("a", 5 * MIN);
    expect((await wache.pruefeWartezeit({ melder, jetzt: T })).status).toBe("im-rahmen");
  });

  test("schon gestartet nach 5:01 Wartezeit (zwischen zwei Laeufen) — Alarm, auch wenn niemand mehr wartet", async () => {
    gestartet("a", 5 * MIN + 1 * SEK);
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r).toEqual({ status: "gemeldet", laengsteMs: 5 * MIN + 1 * SEK, wartende: 0 });
    expect(melder.mock.calls[0][0]).toContain("Gerade 0 Analysen warten.");
  });

  test("lange Wartezeit, die laenger als zwei Minuten zurueckliegt, zaehlt nicht mehr", async () => {
    gestartet("a", 9 * MIN, 3 * MIN);
    expect((await wache.pruefeWartezeit({ melder, jetzt: T })).status).toBe("im-rahmen");
  });

  test("leere Schlange — im Rahmen, kein Zugriff auf die Marke", async () => {
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r).toEqual({ status: "im-rahmen", laengsteMs: 0 });
    expect(speicher.lies("stats/wartezeit-wache")).toBeUndefined();
  });
});

describe("Hoechstens eine Nachricht je 30 Minuten", () => {
  test("zweiter Befund 29:59 spaeter: still; 30:00 spaeter: wieder eine Nachricht", async () => {
    wartend("a", 6 * MIN);
    await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: T });

    const spaeter1 = T + 30 * MIN - SEK;
    speicher.lege("jobs/b", { status: "queued", createdAt: spaeter1 - 7 * MIN, startedAt: null });
    expect((await wache.pruefeWartezeit({ melder, jetzt: spaeter1 })).status).toBe("ruhezeit");
    expect(melder).toHaveBeenCalledTimes(1);

    const spaeter2 = T + 30 * MIN;
    expect((await wache.pruefeWartezeit({ melder, jetzt: spaeter2 })).status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(2);
  });

  test("die Marke gilt fuer alle Instanzen: steht sie schon in der Datenbank, meldet niemand", async () => {
    speicher.lege("stats/wartezeit-wache", { letzterAlarm: T - 10 * MIN });
    wartend("a", 6 * MIN);
    expect((await wache.pruefeWartezeit({ melder, jetzt: T })).status).toBe("ruhezeit");
    expect(melder).not.toHaveBeenCalled();
  });
});

describe("Die Marke bleibt nur, wenn die Nachricht hinausging (Abnahme-Befund P2)", () => {
  const warnTexte = () => warnungen.mock.calls.map((c) => String(c[0])).join("\n");

  test("Erfolg (melder liefert true): Marke gesetzt, Status gemeldet", async () => {
    wartend("a", 6 * MIN);
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r.status).toBe("gemeldet");
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: T });
  });

  test("melder liefert false (ntfy weg oder abgewiesen): Marke zurueck, Warnung nicht zugestellt, naechster Lauf meldet", async () => {
    wartend("a", 6 * MIN);
    melder.mockResolvedValueOnce(false);
    const r = await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(r.status).toBe("nicht-zugestellt");
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: null });
    expect(warnTexte()).toContain("wartezeit-wache-nicht-zugestellt");
    expect(warnTexte()).not.toContain('"status":"gemeldet"');
    /* Eine Minute spaeter: keine 30-Minuten-Sperre, der zweite Versuch geht hinaus. */
    const r2 = await wache.pruefeWartezeit({ melder, jetzt: T + MIN });
    expect(r2.status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(2);
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: T + MIN });
  });

  test("melder wirft: Marke zurueck auf die vorige, Warnung, Wache wirft nicht", async () => {
    speicher.lege("stats/wartezeit-wache", { letzterAlarm: T - 40 * MIN });
    wartend("a", 6 * MIN);
    melder.mockRejectedValueOnce(new Error("Netz weg"));
    await expect(wache.pruefeWartezeit({ melder, jetzt: T })).resolves.toMatchObject({ status: "nicht-zugestellt" });
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: T - 40 * MIN });
    expect(warnTexte()).toContain("wartezeit-wache-nicht-zugestellt");
  });

  test("ohne Versandweg: nicht zugestellt, keine Sperre", async () => {
    wartend("a", 6 * MIN);
    const r = await wache.pruefeWartezeit({ jetzt: T });
    expect(r.status).toBe("nicht-zugestellt");
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: null });
  });

  test("hat inzwischen eine andere Instanz gemeldet, bleibt deren Marke stehen", async () => {
    wartend("a", 6 * MIN);
    melder.mockImplementationOnce(async () => {
      /* waehrend dieser Versand haengt, meldet eine andere Instanz erfolgreich */
      speicher.lege("stats/wartezeit-wache", { letzterAlarm: T + 1 });
      return false;
    });
    await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(speicher.lies("stats/wartezeit-wache")).toEqual({ letzterAlarm: T + 1 });
  });
});

describe("Ausfall der Wache", () => {
  test("wirft nie; ein Lauf ohne Messung ist eine Warnung, fuenf in Folge ein Fehler", async () => {
    speicher.vor(({ art }) => {
      if (art === "abfrage") throw new Error("Index fehlt");
    });
    for (let i = 1; i <= 4; i += 1) {
      await expect(wache.pruefeWartezeit({ melder, jetzt: T })).resolves.toEqual({ status: "nicht-messbar" });
    }
    expect(fehler).not.toHaveBeenCalled();
    expect(warnungen).toHaveBeenCalledTimes(4);
    await wache.pruefeWartezeit({ melder, jetzt: T });
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(String(fehler.mock.calls[0][0])).toContain("wartezeit-wache-nicht-messbar");
  });
});

describe("Kein Alarm fuer nie abgeholte Ergebnisse (Vorgabe)", () => {
  test("ein fertiges, nie abgeholtes Ergebnis nach kurzer Wartezeit loest nichts aus", async () => {
    speicher.lege("jobs/a", {
      status: "done",
      createdAt: T - 90 * MIN,
      startedAt: T - 90 * MIN + 10 * SEK,
      finishedAt: T - 89 * MIN,
      deliveredAt: null,
    });
    expect((await wache.pruefeWartezeit({ melder, jetzt: T })).status).toBe("im-rahmen");
    expect(melder).not.toHaveBeenCalled();
  });
});
