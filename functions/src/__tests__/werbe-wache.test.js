"use strict";

/* Werbe-Wache (21.10.2026, werbe-wache.js): Push, wenn die Beast-Werbung zu
   lange am Stueck ausfaellt. Vorgabe Christoph 21.10.2026 ("dazwischen klappt
   die Werbung kein einziges Mal, mindestens 10 gescheiterte Versuche"):
     - LAENGER als 30 Minuten vom ersten bis zum juengsten Fehlversuch
       (30:00 kein Alarm, 30:01 Alarm),
     - UND mindestens 10 gescheiterte Versuche (9 kein Alarm, 10 Alarm),
     - gescheitert ist alles ausser "ok" (aussetzer, fehler, leer); ein
       Auftrag ohne Werbe-Aufruf aendert nichts,
     - am Stueck = kein gelungener Werbe-Aufruf dazwischen, auch ueber eine
       Pause hinweg,
     - eine Nachricht je Ausfall, nach einem Erfolg zaehlt alles neu,
     - Zustellung: lieber doppelt als keine (Reservierung mit Ablauf, Marke
       erst nach bestaetigtem Versand).
   Gegen eine Datenbank im Arbeitsspeicher. */

jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const speicher = require("./hilfen/speicher-datenbank");
const wache = require("../werbe-wache");

const SEK = 1000;
const MIN = 60 * SEK;
/* 21.10.2026, 10:00 Wien = 08:00 UTC */
const T = Date.UTC(2026, 9, 21, 8, 0, 0);
/* Uhrzeit am 21.10.2026 in Wien (UTC+2) als Zeitstempel. */
const wien = (hhmmss) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return Date.UTC(2026, 9, 21, h - 2, m, s);
};

const A = "aussetzer";
const OK = "ok";
const LEER = "leer";
const FEHLER = "fehler";
/* n gescheiterte Versuche gleichmaessig von `von` bis `bis` (beide eingeschlossen). */
const reihe = (n, von, bis, werbeAufruf = A) =>
  Array.from({ length: n }, (_, i) => ({
    finishedAt: n === 1 ? von : von + ((bis - von) * i) / (n - 1),
    werbeAufruf,
  }));

let warnungen;
let fehler;
let melder;
let nummer = 0;
beforeEach(() => {
  speicher.leeren();
  wache._zuruecksetzen();
  nummer = 0;
  warnungen = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  melder = jest.fn(async () => true);
});
afterEach(() => jest.restoreAllMocks());

/* Ein fertiger Auftrag, so wie completeJob ihn hinterlaesst. */
const fertig = (finishedAt, werbeAufruf) =>
  speicher.lege(`jobs/j${++nummer}`, {
    status: "done",
    finishedAt,
    kennzahlen: { kiMs: 40000, ...(werbeAufruf ? { werbeAufruf } : {}) },
  });

/* Ein Lauf der Wache, 31 s nach `zeit` (damit ein Auftrag mit dieser
   Fertigzeit ausserhalb des Nachlaufs liegt). */
const laufNach = (zeit) => wache.pruefeWerbung({ melder, jetzt: zeit + 31 * SEK });
/* Laeufe im Minutentakt wie der Aufraeumdienst; gibt das letzte Ergebnis zurueck. */
async function laufeJedeMinute(von, bis) {
  let r;
  for (let t = von; t <= bis; t += MIN) r = await laufNach(t);
  return r;
}
const wacheZeilen = () => warnungen.mock.calls.map((c) => JSON.parse(c[0])).filter((z) => z.step === "werbe-wache");

describe("Regel (reine Rechnung)", () => {
  test.each([
    [30 * MIN, 10, false],
    [30 * MIN + 1, 10, true],
    [30 * MIN + 1 * SEK, 10, true],
    [30 * MIN + 1 * SEK, 9, false],
    [29 * MIN, 20, false],
    [31 * MIN, 20, true],
    [31 * MIN, 9, false],
    [31 * MIN, 10, true],
  ])("Dauer %i ms, %i Fehlversuche -> langer Ausfall: %s", (dauer, n, erwartet) => {
    const z = wache.fortschreiben({}, reihe(n, T, T + dauer));
    expect(z.fehlversuche).toBe(n);
    expect(wache.langerAusfall(z)).toBe(erwartet);
  });

  test("ein gelungener Aufruf beendet den Ausfall, danach zaehlt alles neu", () => {
    const z = wache.fortschreiben({}, [
      ...reihe(15, T, T + 25 * MIN),
      { finishedAt: T + 26 * MIN, werbeAufruf: OK },
      ...reihe(9, T + 27 * MIN, T + 60 * MIN),
    ]);
    expect(z.ausfallSeit).toBe(T + 27 * MIN);
    expect(z.fehlversuche).toBe(9);
    expect(wache.langerAusfall(z)).toBe(false);
  });

  test("ueber eine Pause hinweg ist es EIN Ausfall", () => {
    const gestern = T - 24 * 60 * MIN;
    const z = wache.fortschreiben({}, [...reihe(5, gestern, gestern + 5 * MIN), ...reihe(5, T, T + 2 * MIN)]);
    expect(z.ausfallSeit).toBe(gestern);
    expect(z.fehlversuche).toBe(10);
    expect(wache.langerAusfall(z)).toBe(true);
  });

  test("leer und fehler sind gescheiterte Versuche wie ein Aussetzer", () => {
    const vorher = wache.fortschreiben({}, reihe(5, T, T + 10 * MIN));
    const nachher = wache.fortschreiben(vorher, [
      { finishedAt: T + 11 * MIN, werbeAufruf: LEER },
      { finishedAt: T + 12 * MIN, werbeAufruf: FEHLER },
    ]);
    expect(nachher).toMatchObject({ ausfallSeit: T, fehlversuche: 7, letzterFehlversuch: T + 12 * MIN });
  });

  test("ein Auftrag ohne Werbe-Aufruf aendert nichts", () => {
    const vorher = wache.fortschreiben({}, reihe(5, T, T + 10 * MIN));
    const nachher = wache.fortschreiben(vorher, [{ finishedAt: T + 13 * MIN, werbeAufruf: null }]);
    expect(nachher).toEqual(vorher);
  });

  test.each([[LEER], [FEHLER]])("nur %s, 31 min, 10 Versuche: langer Ausfall", (art) => {
    expect(wache.langerAusfall(wache.fortschreiben({}, reihe(10, T, T + 31 * MIN, art)))).toBe(true);
  });

  test("Reihenfolge der Eingabe egal; gleiche Fertigzeit: der Erfolg zaehlt zuletzt", () => {
    const z = wache.fortschreiben({}, [
      { finishedAt: T + 5 * MIN, werbeAufruf: OK },
      { finishedAt: T + 5 * MIN, werbeAufruf: A },
      { finishedAt: T, werbeAufruf: A },
    ]);
    expect(z.ausfallSeit).toBeNull();
    expect(z.fehlversuche).toBe(0);
  });

  test("21.10.2026, 10:25–10:40 (echte Zeiten aus dem Protokoll): kein Alarm", () => {
    const ereignisse = [
      ...[
        "10:25:50",
        "10:26:10",
        "10:26:25",
        "10:26:26",
        "10:28:22",
        "10:29:01",
        "10:29:01",
        "10:29:10",
        "10:29:39",
        "10:30:08",
        "10:30:14",
        "10:30:36",
        "10:30:57",
        "10:31:13",
        "10:31:15",
      ].map((t) => ({ finishedAt: wien(t), werbeAufruf: A })),
      ...["10:32:17", "10:32:41", "10:32:42", "10:33:23"].map((t) => ({ finishedAt: wien(t), werbeAufruf: OK })),
      ...["10:33:29", "10:39:05", "10:40:01"].map((t) => ({ finishedAt: wien(t), werbeAufruf: A })),
      { finishedAt: wien("10:40:29"), werbeAufruf: OK },
    ];
    let z = {};
    let jemalsLang = false;
    /* Ereignis fuer Ereignis, wie die Laeufe sie nacheinander saehen. */
    for (const e of ereignisse.sort((a, b) => a.finishedAt - b.finishedAt)) {
      z = wache.fortschreiben(z, [e]);
      if (wache.langerAusfall(z)) jemalsLang = true;
    }
    expect(jemalsLang).toBe(false);
    expect(z.ausfallSeit).toBeNull();
  });

  test("Text der Nachricht: seit wann, wie viele Versuche, wie lange, was tun", () => {
    const z = wache.fortschreiben({}, reihe(12, wien("10:25:00"), wien("10:56:00")));
    expect(wache.baueMeldung(z)).toBe(
      "malziME: Die Beast-Werbung klappt seit 21.10. 10:25 (Wiener Zeit) nicht mehr — 12 Versuche am Stueck, " +
        "keiner gelungen (ueber 31 min). Die Analysen laufen weiter, die Kinder sehen die Werbung aus der " +
        'Hauptanalyse. Was tun: RUNBOOK, "Beast-Werbung faellt aus".'
    );
  });
});

describe("Laeufe gegen die Datenbank", () => {
  test("Ausfall genau 30:00 mit 10 Fehlversuchen — kein Alarm", async () => {
    for (const e of reihe(10, T, T + 30 * MIN)) fertig(e.finishedAt, A);
    expect((await laufeJedeMinute(T, T + 40 * MIN)).status).toBe("ausfall-laeuft");
    expect(melder).not.toHaveBeenCalled();
    expect(speicher.lies("stats/werbe-wache")).toMatchObject({ ausfallSeit: T, fehlversuche: 10 });
  });

  test("Ausfall 30:01 mit 10 Fehlversuchen — Alarm, einmal", async () => {
    for (const e of reihe(10, T, T + 30 * MIN + 1 * SEK)) fertig(e.finishedAt, A);
    await laufeJedeMinute(T, T + 40 * MIN);
    expect(melder).toHaveBeenCalledTimes(1);
    expect(melder.mock.calls[0][0]).toContain("10 Versuche am Stueck");
    expect(wacheZeilen()).toEqual([
      { severity: "WARNING", step: "werbe-wache", status: "gemeldet", fehlversuche: 10, dauerMs: 30 * MIN + 1 * SEK },
    ]);
    expect(fehler).not.toHaveBeenCalled();
  });

  test("31 Minuten, aber nur 9 Fehlversuche — kein Alarm; der zehnte loest ihn aus", async () => {
    for (const e of reihe(9, T, T + 31 * MIN)) fertig(e.finishedAt, A);
    expect((await laufeJedeMinute(T, T + 31 * MIN)).status).toBe("ausfall-laeuft");
    expect(melder).not.toHaveBeenCalled();
    fertig(T + 32 * MIN, A);
    expect((await laufNach(T + 32 * MIN)).status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(1);
  });

  test("ein dauerhaft unverwertbarer Werbe-Inhalt (nur leere Antworten) meldet sich", async () => {
    for (const e of reihe(10, T, T + 31 * MIN, LEER)) fertig(e.finishedAt, LEER);
    expect((await laufeJedeMinute(T, T + 31 * MIN)).status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(1);
  });

  test("eine Nachricht je Ausfall; nach einem Erfolg kann ein neuer Ausfall wieder melden", async () => {
    for (const e of reihe(12, T, T + 31 * MIN)) fertig(e.finishedAt, A);
    fertig(T + 32 * MIN, A);
    fertig(T + 33 * MIN, A);
    await laufeJedeMinute(T, T + 33 * MIN);
    expect(melder).toHaveBeenCalledTimes(1);

    fertig(T + 34 * MIN, OK);
    expect((await laufNach(T + 34 * MIN)).status).toBe("im-rahmen");
    expect(speicher.lies("stats/werbe-wache")).toMatchObject({ ausfallSeit: null, fehlversuche: 0 });

    const neuBeginn = T + 35 * MIN;
    for (const e of reihe(10, neuBeginn, neuBeginn + 31 * MIN)) fertig(e.finishedAt, A);
    await laufeJedeMinute(neuBeginn, neuBeginn + 31 * MIN);
    expect(melder).toHaveBeenCalledTimes(2);
  });

  test("ueber eine Pause ohne Laeufe hinweg: EIN Ausfall", async () => {
    for (const e of reihe(5, T, T + 5 * MIN)) fertig(e.finishedAt, A);
    await laufeJedeMinute(T, T + 6 * MIN);
    const morgen = T + 24 * 60 * MIN;
    for (const e of reihe(5, morgen, morgen + 4 * MIN)) fertig(e.finishedAt, A);
    await laufeJedeMinute(morgen, morgen + 4 * MIN);
    expect(melder).toHaveBeenCalledTimes(1);
    expect(melder.mock.calls[0][0]).toContain("10 Versuche am Stueck");
  });

  test("ein Auftrag, den mehrere Laeufe sehen koennten, zaehlt einmal", async () => {
    fertig(T, A);
    await laufeJedeMinute(T, T + 5 * MIN);
    expect(speicher.lies("stats/werbe-wache").fehlversuche).toBe(1);
  });

  test("ein Auftrag im Nachlauf (juenger als 30 s) zaehlt erst im naechsten Lauf", async () => {
    fertig(T, A);
    await wache.pruefeWerbung({ melder, jetzt: T + 10 * SEK });
    expect(speicher.lies("stats/werbe-wache")).toBeUndefined();
    await wache.pruefeWerbung({ melder, jetzt: T + 70 * SEK });
    expect(speicher.lies("stats/werbe-wache").fehlversuche).toBe(1);
  });

  test("ohne neue Auftraege schreibt ein Lauf nichts", async () => {
    await laufeJedeMinute(T, T + 3 * MIN);
    expect(speicher.lies("stats/werbe-wache")).toBeUndefined();
    expect(speicher.protokoll.filter((z) => z.art === "transaktion")).toHaveLength(0);
  });

  test("leer und fehler verlaengern den Ausfall, ein Auftrag ohne Werbe-Aufruf nicht", async () => {
    for (const e of reihe(5, T, T + 10 * MIN)) fertig(e.finishedAt, A);
    fertig(T + 11 * MIN, LEER);
    fertig(T + 12 * MIN, FEHLER);
    fertig(T + 13 * MIN, null);
    await laufeJedeMinute(T, T + 13 * MIN);
    expect(speicher.lies("stats/werbe-wache")).toMatchObject({
      ausfallSeit: T,
      fehlversuche: 7,
      letzterFehlversuch: T + 12 * MIN,
    });
  });

  /* Lauf A schiebt sich zwischen Abfrage und Transaktion von Lauf B: B hat
     dieselben Auftraege gelesen wie A und darf sie nicht noch einmal zaehlen. */
  test("zwei Laeufe zugleich: gezaehlt wird einmal, der zweite meldet anderer-lauf", async () => {
    fertig(T, A);
    let laufA = null;
    speicher.vor(async ({ art }) => {
      if (art === "transaktion" && laufA === null) {
        laufA = wache.pruefeWerbung({ melder, jetzt: T + 31 * SEK });
        await laufA;
      }
    });
    const b = await wache.pruefeWerbung({ melder, jetzt: T + 31 * SEK });
    expect((await laufA).status).toBe("ausfall-laeuft");
    expect(b.status).toBe("anderer-lauf");
    expect(speicher.lies("stats/werbe-wache").fehlversuche).toBe(1);
  });
});

describe("Zustellung: lieber doppelt als keine", () => {
  /* 10 Fehlversuche von T bis T+31 min; der Lauf um T+31:31 versucht die
     Nachricht und reserviert sie bis T+36:31. */
  async function bisZumErstenVersuch() {
    for (const e of reihe(10, T, T + 31 * MIN)) fertig(e.finishedAt, A);
    return laufeJedeMinute(T, T + 31 * MIN);
  }

  test("Versand gelingt: keine zweite Nachricht, auch nach Ablauf der Reservierung", async () => {
    expect((await bisZumErstenVersuch()).status).toBe("gemeldet");
    fertig(T + 33 * MIN, A);
    fertig(T + 40 * MIN, FEHLER);
    await laufeJedeMinute(T + 32 * MIN, T + 45 * MIN);
    expect(melder).toHaveBeenCalledTimes(1);
    expect(speicher.lies("stats/werbe-wache").gemeldetFuer).toBe(T);
  });

  test("Push geht nicht hinaus, jeder weitere Schreibvorgang scheitert: vor Ablauf kein Versuch, danach schon", async () => {
    melder.mockResolvedValue(false);
    speicher.vor(({ art }) => {
      if (art === "set") throw new Error("nicht erreichbar");
    });
    expect((await bisZumErstenVersuch()).status).toBe("nicht-zugestellt");
    expect(wacheZeilen()).toEqual([
      {
        severity: "WARNING",
        step: "werbe-wache",
        status: "nicht-zugestellt",
        warning: "werbe-wache-nicht-zugestellt",
        fehlversuche: 10,
        dauerMs: 31 * MIN,
      },
    ]);
    expect(speicher.lies("stats/werbe-wache").gemeldetFuer).toBeNull();

    expect((await laufeJedeMinute(T + 32 * MIN, T + 35 * MIN)).status).toBe("ausfall-laeuft");
    expect(melder).toHaveBeenCalledTimes(1);
    expect((await laufNach(T + 36 * MIN)).status).toBe("nicht-zugestellt");
    expect(melder).toHaveBeenCalledTimes(2);
  });

  test("Lauf endet zwischen Reservierung und Versand: vor Ablauf kein Versuch, danach schon", async () => {
    for (const e of reihe(10, T, T + 31 * MIN)) fertig(e.finishedAt, A);
    await laufeJedeMinute(T, T + 30 * MIN);
    let abbrechen = true;
    /* Die Transaktion hat geschrieben (Reservierung steht), dann endet der Lauf. */
    speicher.vor(({ art }) => {
      if (abbrechen && art === "transaktion-ende") throw new Error("Instanz beendet");
    });
    expect((await laufNach(T + 31 * MIN)).status).toBe("nicht-messbar");
    abbrechen = false;
    expect(speicher.lies("stats/werbe-wache")).toMatchObject({ reserviertFuer: T, gemeldetFuer: null });
    expect(melder).not.toHaveBeenCalled();

    await laufeJedeMinute(T + 32 * MIN, T + 35 * MIN);
    expect(melder).not.toHaveBeenCalled();
    expect((await laufNach(T + 36 * MIN)).status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(1);
  });

  test("Versand gelingt, die Marke laesst sich nicht setzen: nach Ablauf kommt die Nachricht ein zweites Mal", async () => {
    speicher.vor(({ art }) => {
      if (art === "set") throw new Error("nicht erreichbar");
    });
    expect((await bisZumErstenVersuch()).status).toBe("gemeldet");
    expect(wacheZeilen()[0]).toMatchObject({ status: "gemeldet", warning: "werbe-wache-marke-nicht-gesetzt" });
    await laufNach(T + 35 * MIN);
    expect(melder).toHaveBeenCalledTimes(1);
    expect((await laufNach(T + 36 * MIN)).status).toBe("gemeldet");
    expect(melder).toHaveBeenCalledTimes(2);
  });

  test("Melder wirft sofort: nicht zugestellt, nach Ablauf neuer Versuch", async () => {
    melder = jest.fn(() => {
      throw new Error("kaputt");
    });
    expect((await bisZumErstenVersuch()).status).toBe("nicht-zugestellt");
    expect(fehler).not.toHaveBeenCalled();
    expect((await laufNach(T + 36 * MIN)).status).toBe("nicht-zugestellt");
    expect(melder).toHaveBeenCalledTimes(2);
  });

  test("ohne Versandweg: nicht zugestellt, keine Kennung im Protokoll", async () => {
    for (const e of reihe(10, T, T + 31 * MIN)) fertig(e.finishedAt, A);
    let r;
    for (let t = T; t <= T + 31 * MIN; t += MIN) r = await wache.pruefeWerbung({ jetzt: t + 31 * SEK });
    expect(r.status).toBe("nicht-zugestellt");
    const zeilen = warnungen.mock.calls.map((c) => c[0]).join("\n");
    expect(zeilen).not.toMatch(/"j\d+"/);
  });
});

describe("nie still ausfallen", () => {
  test.each([["get"], ["abfrage"]])(
    "Zugriff %s scheitert: Warnung, ab dem fuenften Lauf in Folge ERROR",
    async (art) => {
      speicher.vor(({ art: a }) => {
        if (a === art) throw Object.assign(new Error("nicht erreichbar"), { code: 14 });
      });
      fertig(T, A);
      for (let i = 1; i < wache.FEHLER_BIS_ALARM; i++) {
        expect((await laufNach(T + i * MIN)).status).toBe("nicht-messbar");
      }
      expect(fehler).not.toHaveBeenCalled();
      expect(warnungen).toHaveBeenCalledTimes(wache.FEHLER_BIS_ALARM - 1);

      expect((await laufNach(T + wache.FEHLER_BIS_ALARM * MIN)).status).toBe("nicht-messbar");
      expect(fehler).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fehler.mock.calls[0][0])).toMatchObject({
        severity: "ERROR",
        step: "werbe-wache",
        warning: "werbe-wache-nicht-messbar",
        laeufeInFolge: wache.FEHLER_BIS_ALARM,
      });
    }
  );

  test("ein gelungener Lauf setzt die Fehlerfolge zurueck", async () => {
    let stoeren = true;
    speicher.vor(({ art }) => {
      if (stoeren && art === "get") throw new Error("nicht erreichbar");
    });
    for (let i = 1; i < wache.FEHLER_BIS_ALARM; i++) await laufNach(T + i * MIN);
    stoeren = false;
    expect((await laufNach(T + 10 * MIN)).status).toBe("im-rahmen");
    stoeren = true;
    for (let i = 1; i < wache.FEHLER_BIS_ALARM; i++) await laufNach(T + (10 + i) * MIN);
    expect(fehler).not.toHaveBeenCalled();
  });
});
