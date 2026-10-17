"use strict";

/* Dauerhafte Zaehler (statistik.js, 16.10.2026): Fenster, Klassen, Beitrag
   eines Auftrags, Geraetefamilien, Zaehlen vor dem Loeschen und der Sammler
   fuer die oeffentlichen Schnittstellen — gegen eine Datenbank im
   Arbeitsspeicher. */

jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const speicher = require("./hilfen/speicher-datenbank");
const statistik = require("../statistik");

const MIN = 60 * 1000;
/* 16.10.2026, 08:23:45 Wiener Sommerzeit = 06:23:45 UTC */
const T = Date.UTC(2026, 9, 16, 6, 23, 45);

let warnungen;
let fehler;
beforeEach(() => {
  speicher.leeren();
  statistik._zuruecksetzen();
  warnungen = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warnungen.mockRestore();
  fehler.mockRestore();
});

const warnTexte = () => warnungen.mock.calls.map((c) => String(c[0]));

describe("Fensterzuordnung (UTC) und Tag (Wiener Datum)", () => {
  test("Fensterbeginn und Name", () => {
    expect(statistik.fensterBeginn(T)).toBe(Date.UTC(2026, 9, 16, 6, 20));
    expect(statistik.fensterId(T)).toBe("fenster-2026-10-16T06-20Z");
  });

  test("Grenzen eines Fensters: 06:29:59,999 noch drin, 06:30:00 im naechsten", () => {
    expect(statistik.fensterId(Date.UTC(2026, 9, 16, 6, 29, 59, 999))).toBe("fenster-2026-10-16T06-20Z");
    expect(statistik.fensterId(Date.UTC(2026, 9, 16, 6, 30, 0, 0))).toBe("fenster-2026-10-16T06-30Z");
  });

  test("Wiener Tag: 21:59:59 UTC im Sommer ist noch derselbe, 22:00 UTC schon der naechste", () => {
    expect(statistik.tagId(Date.UTC(2026, 9, 16, 21, 59, 59))).toBe("tag-2026-10-16");
    expect(statistik.tagId(Date.UTC(2026, 9, 16, 22, 0, 0))).toBe("tag-2026-10-17");
  });

  test("Wiener Tag im Winter: 22:59:59 UTC noch derselbe, 23:00 UTC der naechste", () => {
    expect(statistik.tagId(Date.UTC(2026, 11, 1, 22, 59, 59))).toBe("tag-2026-12-01");
    expect(statistik.tagId(Date.UTC(2026, 11, 1, 23, 0, 0))).toBe("tag-2026-12-02");
  });

  test("Nacht der Zeitumstellung: die doppelte Wiener Stunde ergibt zwei verschiedene Fenster", () => {
    /* 25.10.2026: 02:30 Wien gibt es zweimal — um 00:30 und um 01:30 UTC. */
    const erstes = statistik.fensterId(Date.UTC(2026, 9, 25, 0, 30));
    const zweites = statistik.fensterId(Date.UTC(2026, 9, 25, 1, 30));
    expect(erstes).not.toBe(zweites);
  });
});

describe("Dauer-Klassen: Grenzen ausschliesslich", () => {
  test.each([
    [0, "unter30s"],
    [29999, "unter30s"],
    [30000, "unter1min"],
    [59999, "unter1min"],
    [60000, "unter2min"],
    [119999, "unter2min"],
    [120000, "unter4min"],
    [239999, "unter4min"],
    [240000, "unter8min"],
    [479999, "unter8min"],
    [480000, "laenger"],
    [3600000, "laenger"],
  ])("%i ms -> %s", (ms, klasse) => {
    expect(statistik.dauerKlasse(ms)).toBe(klasse);
  });

  test("ungueltige Dauern zaehlen in keiner Klasse", () => {
    for (const w of [-1, NaN, undefined, null, "5"]) expect(statistik.dauerKlasse(w)).toBeNull();
  });
});

describe("Geraetefamilie aus den groben Angaben", () => {
  test.each([
    ["Safari 17 / iOS", "small", "appleTelefon"],
    ["Safari 17 / iOS", undefined, "appleTelefon"],
    ["Safari 17 / iOS", "medium", "appleTabletOderMac"],
    ["Safari 17 / iOS", "large", "appleTabletOderMac"],
    ["Safari 17 / macOS", "large", "appleTabletOderMac"],
    ["Chrome 126 / macOS", "medium", "appleTabletOderMac"],
    ["Chrome 126 / Android", "small", "android"],
    ["SamsungBrowser 25 / Android", "medium", "android"],
    ["Edge 126 / Windows", "large", "computer"],
    ["Firefox 128 / Linux", "large", "computer"],
    ["other / other", "large", "unbekannt"],
    ["unknown", "small", "unbekannt"],
    [undefined, undefined, "unbekannt"],
  ])("%s, Bildschirm %s -> %s", (ua, schirm, familie) => {
    expect(statistik.geraetefamilie(ua, schirm)).toBe(familie);
  });
});

describe("Beitrag eines Auftrags", () => {
  const basis = { createdAt: T, startedAt: T + 20 * 1000, finishedAt: T + 95 * 1000, deliveredAt: T + 100 * 1000 };
  const PROFIL = {
    profiles: { normal: { profileText: "x", categories: {} }, boost: { profileText: "y", categories: {} } },
    meta: { mode: "multimodal" },
  };

  test("fertig und abgeholt, mit Klassen und Kennzahlen", () => {
    const b = statistik.beitragEinesAuftrags({
      ...basis,
      status: "done",
      result: PROFIL,
      kennzahlen: {
        kiMs: 70000,
        kiWiederholungen: 2,
        tokenEingabe: 5000,
        tokenZwischenspeicher: 3000,
        tokenAusgabe: 900,
      },
    });
    expect(b.fenster).toBe("fenster-2026-10-16T06-20Z");
    expect(b.tag).toBe("tag-2026-10-16");
    expect(b.felder).toEqual({
      eingereiht: 1,
      fertig: 1,
      abgeholt: 1,
      gesamtzeit: { unter2min: 1 },
      wartezeit: { unter30s: 1 },
      kiDauer: { unter2min: 1 },
      kiWiederholungen: 2,
    });
    expect(b.tagFelder).toEqual({ kiText: { eingabe: 5000, zwischenspeicher: 3000, ausgabe: 900 } });
  });

  test("fertig, aber nie abgeholt", () => {
    const b = statistik.beitragEinesAuftrags({ ...basis, deliveredAt: null, status: "done", result: PROFIL });
    expect(b.felder.nieAbgeholt).toBe(1);
    expect(b.felder.abgeholt).toBeUndefined();
  });

  test("gesperrtes Ergebnis zaehlt als gescheitert je Grund (ohne Punkt im Feldnamen), mit Abholung", () => {
    const b = statistik.beitragEinesAuftrags({
      ...basis,
      status: "done",
      result: { profiles: null, blockedReason: "blocked.overloaded", meta: { mode: "blocked" } },
    });
    expect(b.felder.gescheitert).toEqual({ overloaded: 1 });
    expect(b.felder.fertig).toBeUndefined();
    expect(b.felder.gesamtzeit).toBeUndefined();
    expect(b.felder.abgeholt).toBe(1);
  });

  test("failed mit Grund, ohne Abholung", () => {
    const b = statistik.beitragEinesAuftrags({ ...basis, status: "failed", errorReason: "processing_timeout" });
    expect(b.felder.gescheitert).toEqual({ processing_timeout: 1 });
    expect(b.felder.abgeholt).toBeUndefined();
    expect(b.felder.nieAbgeholt).toBeUndefined();
  });

  test("in der Schlange verworfen", () => {
    const b = statistik.beitragEinesAuftrags({ createdAt: T, status: "abandoned", startedAt: null });
    expect(b.felder).toEqual({ eingereiht: 1, verworfen: 1 });
  });

  test("von der Annahmestelle zurueckgenommen (Schlange voll): zaehlt hier gar nicht", () => {
    expect(statistik.beitragEinesAuftrags({ createdAt: T, status: "abandoned", abbruchArt: "einlass" })).toBeNull();
  });

  test("ohne Abschluss geloescht", () => {
    const b = statistik.beitragEinesAuftrags({ createdAt: T, status: "processing", startedAt: T + 1000 });
    expect(b.felder.gescheitert).toEqual({ ohneAbschluss: 1 });
  });

  test("traegt keine Kennung, kein Alter, nichts vom Kinderschutz", () => {
    const b = statistik.beitragEinesAuftrags({
      ...basis,
      id: "JOB-GEHEIM",
      status: "done",
      result: { ...PROFIL, meta: { mode: "multimodal", alterUnlesbar: false, subject: "HUMAN" } },
      resultToken: "TICKET-GEHEIM",
      exif: { make: "Apple", model: "iPhone" },
      lang: "de",
    });
    const text = JSON.stringify(b);
    for (const verboten of ["JOB-GEHEIM", "TICKET-GEHEIM", "Apple", "iPhone", "alter", "HUMAN", "subject", "lang"]) {
      expect(text).not.toContain(verboten);
    }
  });
});

/* ── Zaehlen vor dem Loeschen ─────────────────────────────────────────── */

const fenster = (ms) => speicher.lies(`statistik/${statistik.fensterId(ms)}`);
const tag = (ms) => speicher.lies(`statistik/${statistik.tagId(ms)}`);

function lege(id, daten) {
  speicher.lege(`jobs/${id}`, daten);
  return { id, ...daten };
}

describe("zaehleVorDemLoeschen", () => {
  const fertig = (id, extra = {}) =>
    lege(id, {
      createdAt: T,
      startedAt: T + 10000,
      finishedAt: T + 50000,
      deliveredAt: T + 60000,
      status: "done",
      result: { profiles: { normal: { profileText: "a" }, boost: { profileText: "b" } }, meta: { mode: "multimodal" } },
      kennzahlen: { kiMs: 35000, kiWiederholungen: 1, tokenEingabe: 100, tokenZwischenspeicher: 40, tokenAusgabe: 50 },
      ...extra,
    });

  test("zaehlt in EINER Transaktion je Fenster und markiert jeden Auftrag", async () => {
    const liste = [fertig("a"), fertig("b"), lege("c", { createdAt: T + 11 * MIN, status: "abandoned" })];
    const ergebnis = await statistik.zaehleVorDemLoeschen(liste);
    expect(ergebnis).toEqual({ gezaehlt: 3, gescheitert: 0 });
    expect(speicher.protokoll.filter((p) => p.art === "transaktion")).toHaveLength(2);
    expect(fenster(T)).toMatchObject({
      art: "fenster",
      beginn: statistik.fensterBeginn(T),
      eingereiht: 2,
      fertig: 2,
      abgeholt: 2,
      wartezeit: { unter30s: 2 },
      gesamtzeit: { unter1min: 2 },
      kiDauer: { unter1min: 2 },
      kiWiederholungen: 2,
    });
    expect(fenster(T + 11 * MIN)).toMatchObject({ eingereiht: 1, verworfen: 1 });
    expect(tag(T)).toEqual({
      art: "tag",
      tag: "2026-10-16",
      kiText: { eingabe: 200, zwischenspeicher: 80, ausgabe: 100 },
    });
    for (const id of ["a", "b", "c"]) expect(speicher.lies(`jobs/${id}`).gezaehlt).toBe(true);
  });

  test("LAUF WIEDERHOLT (Loeschen war gescheitert): keine Doppelzaehlung", async () => {
    const liste = [fertig("a"), fertig("b")];
    await statistik.zaehleVorDemLoeschen(liste);
    /* Zweiter Lauf mit der ALTEN Liste (ohne Marke) — die Transaktion liest frisch. */
    const zweiter = await statistik.zaehleVorDemLoeschen(liste);
    expect(zweiter).toEqual({ gezaehlt: 0, gescheitert: 0 });
    expect(fenster(T).eingereiht).toBe(2);
    expect(tag(T).kiText.eingabe).toBe(200);
  });

  test("schon markierte Auftraege werden gar nicht erst gelesen", async () => {
    const liste = [fertig("a", { gezaehlt: true })];
    await statistik.zaehleVorDemLoeschen(liste);
    expect(speicher.protokoll.filter((p) => p.art === "transaktion")).toHaveLength(0);
    expect(fenster(T)).toBeUndefined();
  });

  test("inzwischen geloeschter Auftrag zaehlt nicht", async () => {
    const liste = [fertig("a"), { id: "weg", createdAt: T, status: "done" }];
    const ergebnis = await statistik.zaehleVorDemLoeschen(liste);
    expect(ergebnis.gezaehlt).toBe(1);
    expect(fenster(T).eingereiht).toBe(1);
  });

  test("ZAEHLEN SCHEITERT: wirft nicht, Warnzeile ohne Kennung, nichts markiert, nichts gezaehlt", async () => {
    const liste = [fertig("JOB-KENNUNG-1")];
    speicher.vor(({ art }) => {
      if (art === "transaktion") {
        const e = new Error("ABORTED auf jobs/JOB-KENNUNG-1");
        e.code = 10;
        throw e;
      }
    });
    await expect(statistik.zaehleVorDemLoeschen(liste)).resolves.toEqual({ gezaehlt: 0, gescheitert: 1 });
    expect(speicher.lies("jobs/JOB-KENNUNG-1").gezaehlt).toBeUndefined();
    expect(fenster(T)).toBeUndefined();
    const zeilen = warnTexte();
    expect(zeilen.some((z) => z.includes("statistik-zaehlen-fehlgeschlagen"))).toBe(true);
    expect(zeilen.join("\n")).not.toContain("JOB-KENNUNG");
  });

  test("fuenf Laeufe in Folge gescheitert: Fehlerzeile (Alarm); ein gesunder Lauf setzt zurueck", async () => {
    let kaputt = true;
    speicher.vor(({ art }) => {
      if (kaputt && art === "transaktion") throw new Error("weg");
    });
    for (let i = 1; i <= 4; i += 1) await statistik.zaehleVorDemLoeschen([fertig(`x${i}`)]);
    expect(fehler).not.toHaveBeenCalled();
    await statistik.zaehleVorDemLoeschen([fertig("x5")]);
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(String(fehler.mock.calls[0][0])).toContain("statistik-zaehlen-wiederholt-gescheitert");
    kaputt = false;
    await statistik.zaehleVorDemLoeschen([fertig("x6")]);
    kaputt = true;
    await statistik.zaehleVorDemLoeschen([fertig("x7")]);
    expect(fehler).toHaveBeenCalledTimes(1);
  });

  test("leere Liste: kein Zugriff", async () => {
    await statistik.zaehleVorDemLoeschen([]);
    expect(speicher.protokoll).toHaveLength(0);
  });
});

describe("Gesamtgrenze je Lauf (Abnahme-Befund P3)", () => {
  /* Fuenf Fenster, die Datenbank haengt bei jeder Transaktion. Ohne
     Gesamtgrenze dauerte das 5 x 10 s = 50 s; mit ihr hoechstens 30 s. */
  function fuenfFenster() {
    return [0, 1, 2, 3, 4].map((i) => lege(`h${i}`, { createdAt: T + i * 11 * MIN, status: "abandoned" }));
  }

  test("haengende Datenbank: nach 30 s Schluss, der Rest wird nicht gezaehlt (Warnzeile), nichts markiert", async () => {
    jest.useFakeTimers();
    try {
      speicher.vor(({ art }) => (art === "transaktion" ? new Promise(() => {}) : undefined));
      let fertig = false;
      const lauf = statistik.zaehleVorDemLoeschen(fuenfFenster()).then((r) => {
        fertig = true;
        return r;
      });
      await jest.advanceTimersByTimeAsync(29999);
      expect(fertig).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(fertig).toBe(true);
      await expect(lauf).resolves.toEqual({ gezaehlt: 0, gescheitert: 5 });
      /* Drei Fenster je 10 s versucht, zwei gar nicht erst angefangen. */
      expect(speicher.protokoll.filter((p) => p.art === "transaktion")).toHaveLength(3);
      const zeilen = warnTexte();
      expect(zeilen.filter((z) => z.includes("statistik-zaehlen-nicht-abgewartet"))).toHaveLength(3);
      expect(zeilen.find((z) => z.includes("statistik-zaehlen-zeit-um"))).toContain('"auftraege":2');
      for (let i = 0; i < 5; i += 1) expect(speicher.lies(`jobs/h${i}`).gezaehlt).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test("die Grenze gilt fuer den ganzen Lauf: der zweite Zweig mit derselben Frist faengt gar nicht mehr an", async () => {
    const lauf = { zaehlenBis: Date.now() - 1 };
    const r = await statistik.zaehleVorDemLoeschen([lege("z1", { createdAt: T, status: "abandoned" })], lauf);
    expect(r).toEqual({ gezaehlt: 0, gescheitert: 1 });
    expect(speicher.protokoll.filter((p) => p.art === "transaktion")).toHaveLength(0);
    expect(warnTexte().some((z) => z.includes("statistik-zaehlen-zeit-um"))).toBe(true);
  });

  test("ohne Stoerung: Frist wird gesetzt, alles gezaehlt", async () => {
    const lauf = {};
    const r = await statistik.zaehleVorDemLoeschen(fuenfFenster(), lauf);
    expect(r).toEqual({ gezaehlt: 5, gescheitert: 0 });
    expect(typeof lauf.zaehlenBis).toBe("number");
  });
});

/* ── Sammler: Abweisungen und Browser-Fehler ──────────────────────────── */

describe("Sammler fuer oeffentliche Schnittstellen", () => {
  test("erste Abweisung schreibt sofort; innerhalb des Abstands wird gesammelt, danach mitgeschrieben", async () => {
    await statistik.zaehleAbweisung("stundenlimit", T);
    expect(fenster(T).abgewiesen).toEqual({ stundenlimit: 1 });
    await statistik.zaehleAbweisung("stundenlimit", T + 500);
    await statistik.zaehleAbweisung("adresslimit", T + 1000);
    /* Noch im Abstand: nur vorgemerkt. */
    expect(fenster(T).abgewiesen).toEqual({ stundenlimit: 1 });
    expect(speicher.protokoll.filter((p) => p.art === "set")).toHaveLength(1);
    await statistik.zaehleAbweisung("schlangeVoll", T + statistik._SAMMEL_ABSTAND_MS);
    expect(fenster(T).abgewiesen).toEqual({ stundenlimit: 2, adresslimit: 1, schlangeVoll: 1 });
    expect(speicher.protokoll.filter((p) => p.art === "set")).toHaveLength(2);
  });

  test("unbekannter Grund zaehlt als unbekannt", async () => {
    await statistik.zaehleAbweisung("ganzNeu", T);
    expect(fenster(T).abgewiesen).toEqual({ unbekannt: 1 });
  });

  test("Flut: 1000 Abweisungen in einer Sekunde kosten EINEN Schreibvorgang", async () => {
    for (let i = 0; i < 1000; i += 1) await statistik.zaehleAbweisung("adresslimit", T + i);
    expect(speicher.protokoll.filter((p) => p.art === "set")).toHaveLength(1);
  });

  test("Datenbank haengt: die Antwort wartet hoechstens kurz, wirft nicht, Warnzeile", async () => {
    jest.useFakeTimers();
    try {
      speicher.vor(({ art }) => (art === "set" ? new Promise(() => {}) : undefined));
      const lauf = statistik.zaehleAbweisung("wartung", T);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(lauf).resolves.toBeUndefined();
      expect(warnTexte().some((z) => z.includes("statistik-sammler-nicht-abgewartet"))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("Datenbank wirft: kein Fehler nach aussen, Warnzeile, keine Wiedervorlage (nie doppelt)", async () => {
    let kaputt = true;
    speicher.vor(({ art }) => {
      if (kaputt && art === "set") throw new Error("weg");
    });
    await expect(statistik.zaehleAbweisung("wartung", T)).resolves.toBeUndefined();
    expect(warnTexte().some((z) => z.includes("statistik-sammler-fehlgeschlagen"))).toBe(true);
    kaputt = false;
    await statistik.zaehleAbweisung("wartung", T + 5000);
    expect(fenster(T).abgewiesen).toEqual({ wartung: 1 });
  });

  test("Browser-Fehler: Tagesdokument nach Phase und Geraetefamilie, unbekannte Phase als andere", async () => {
    await statistik.zaehleBrowserFehler({ phase: "queue-poll", userAgent: "Safari 17 / iOS", bildschirm: "small" }, T);
    await statistik.zaehleBrowserFehler(
      { phase: "<script>", userAgent: "Chrome 126 / Android", bildschirm: "small" },
      T + 5000
    );
    expect(tag(T)).toEqual({
      art: "tag",
      tag: "2026-10-16",
      browserFehler: { "queue-poll": { appleTelefon: 1 }, andere: { android: 1 } },
    });
  });
});
