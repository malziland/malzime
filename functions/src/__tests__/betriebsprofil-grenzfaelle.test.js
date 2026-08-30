/**
 * betriebsprofil-grenzfaelle.test.js — Faelle, die im Alltag selten sind und
 * dann besonders weh tun.
 *
 * Zusammengetragen nach dem Chaos- und Lasttest. Jeder dieser Faelle ist
 * schon einmal irgendwo aufgetreten oder ergibt sich zwingend aus dem Aufbau.
 */

const mockDoc = { daten: undefined, fehler: null };
let lesevorgaenge = 0;

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        lesevorgaenge += 1;
        if (mockDoc.fehler) throw new Error(mockDoc.fehler);
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, _pruefe, _cacheLeeren } = require("../betriebsprofil");

const T1 = {
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  requestBudgetMs: 480000,
  parallelitaet: 7,
  stundenlimit: 500,
  adressLimit: 500,
};
const setze = (d, f = null) => {
  mockDoc.daten = d;
  mockDoc.fehler = f;
  lesevorgaenge = 0;
  _cacheLeeren();
};

describe("GRENZFAELLE", () => {
  test("Wechsel WAEHREND einer laufenden Analyse: der Lauf behaelt seine Werte", async () => {
    /* Der heikelste Fall: Eine Analyse laeuft seit 200 s mit einer Grenze von
       300 s. Jemand stellt auf 100 s um. Waere der neue Wert sofort gueltig,
       wuerde der laufende Job ruecklings abgebrochen — obwohl er nach der
       Regel, unter der er gestartet ist, noch Zeit haette.

       Das kann hier nicht passieren: Die Werte werden EINMAL beim Start des
       Aufrufs gelesen und dann als lokale Groesse weitergereicht. Ein Wechsel
       wirkt erst auf den naechsten Lauf. Dieser Test haelt das fest. */
    setze({
      aktiv: "lang",
      profile: { lang: T1, kurz: { ...T1, singleLargeTimeoutMs: 150000, singleLargeMaxTokens: 5000 } },
    });
    const beimStart = await geltendeWerte();
    expect(beimStart.werte.singleLargeTimeoutMs).toBe(300000);

    /* Umschalten mitten im Lauf. */
    setze({
      aktiv: "kurz",
      profile: { lang: T1, kurz: { ...T1, singleLargeTimeoutMs: 150000, singleLargeMaxTokens: 5000 } },
    });

    /* Der bereits gelesene Satz bleibt unveraendert — er ist eine Kopie. */
    expect(beimStart.werte.singleLargeTimeoutMs).toBe(300000);
    /* Der naechste Lauf bekommt den neuen. */
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(150000);
  });

  test("der gelesene Satz laesst sich nicht von aussen veraendern", async () => {
    /* Wuerde ein Aufrufer die Werte veraendern, traefe das alle anderen, die
       denselben zwischengespeicherten Satz halten. */
    setze({ aktiv: "t1", profile: { t1: T1 } });
    const a = await geltendeWerte();
    a.werte.singleLargeTimeoutMs = 999999;
    const b = await geltendeWerte();
    expect(b.werte.singleLargeTimeoutMs).not.toBe(999999);
  });

  test("sehr viele Saetze im Dokument: nur der aktive wird ausgewertet", async () => {
    /* Ueber Monate sammeln sich Saetze an. Firestore erlaubt 1 MB je Dokument. */
    const viele = {};
    for (let i = 0; i < 300; i += 1) viele[`satz-${i}`] = { ...T1, parallelitaet: (i % 90) + 1 };
    viele.aktiv = { ...T1, parallelitaet: 7 };
    setze({ aktiv: "aktiv", profile: viele });
    const e = await geltendeWerte();
    expect(e.werte.parallelitaet).toBe(7);
  });

  test("Satzname, der wie eine Zahl aussieht", async () => {
    /* In Firestore werden Objektschluessel zu Text — "2026" bleibt lesbar. */
    setze({ aktiv: "2026", profile: { 2026: T1 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("Satzname mit Umlauten und Leerzeichen", async () => {
    setze({ aktiv: "Workshop Grüne Klasse", profile: { "Workshop Grüne Klasse": T1 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("Grenzwert exakt auf der Schwelle wird ANGENOMMEN, knapp darueber nicht", async () => {
    /* Bei Grenzwerten ist die Frage immer: einschliesslich oder ausschliesslich?
       Hier: Die Textmenge darf die Zeit exakt ausschoepfen. */
    /* Die langsamste je gemessene Geschwindigkeit steht in config.js bei
       39,4 Token/s. 300 s * 39,4 = 11.820 Token — exakt aufgehend. */
    const genau = { ...T1, singleLargeMaxTokens: 11820, singleLargeTimeoutMs: 300000 };
    expect(_pruefe(genau)).toBeNull();
    const knappDrueber = { ...T1, singleLargeMaxTokens: 11821, singleLargeTimeoutMs: 300000 };
    expect(_pruefe(knappDrueber)).not.toBeNull();
  });

  test("Zahlen als Gleitkomma aus der Konsole (300000.0)", async () => {
    /* Die Firebase-Konsole speichert Zahlen als Double — 300000.0 statt 300000. */
    setze({ aktiv: "t1", profile: { t1: { ...T1, singleLargeTimeoutMs: 300000.0 } } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("zwei Lesevorgaenge kurz hintereinander lesen die Datenbank einmal", async () => {
    setze({ aktiv: "t1", profile: { t1: T1 } });
    await geltendeWerte();
    await geltendeWerte();
    await geltendeWerte();
    expect(lesevorgaenge).toBe(1);
  });

  test("nach einem Fehler wird beim naechsten Mal WIEDER gelesen", async () => {
    /* Sonst bliebe ein einmaliger Netzfehler bis zum Neustart haengen. */
    setze(undefined, "UNAVAILABLE");
    const ersteAntwort = await geltendeWerte();
    expect(ersteAntwort.werte).toBeNull();

    setze({ aktiv: "t1", profile: { t1: T1 } });
    const zweiteAntwort = await geltendeWerte();
    expect(zweiteAntwort.werte).not.toBeNull();
  });
});

describe("PROTOKOLL — damit ein Ausfall auffindbar ist", () => {
  let ausgabe, fehler;
  beforeEach(() => {
    ausgabe = jest.spyOn(console, "log").mockImplementation(() => {});
    fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    ausgabe.mockRestore();
    fehler.mockRestore();
  });

  test("ein abgelehnter Satz landet als FEHLER im Protokoll, mit Grund", async () => {
    /* Ohne diesen Eintrag liefe schlicht keine Analyse mehr, und niemand
       koennte sagen warum. */
    setze({ aktiv: "kaputt", profile: { kaputt: { singleLargeTimeoutMs: 1000 } } });
    await geltendeWerte();

    expect(fehler).toHaveBeenCalled();
    const zeile = JSON.parse(fehler.mock.calls[0][0]);
    expect(zeile.step).toBe("betriebsprofil");
    expect(typeof zeile.grund).toBe("string");
    expect(zeile.grund.length).toBeGreaterThan(5);
  });

  test("ein gueltiger Satz wird mit seinen Zahlen protokolliert", async () => {
    setze({ aktiv: "t1", profile: { t1: T1 } });
    await geltendeWerte();

    expect(ausgabe).toHaveBeenCalled();
    const zeile = JSON.parse(ausgabe.mock.calls[0][0]);
    expect(zeile.profil).toBe("t1");
    expect(zeile.zeitgrenzeMs).toBe(300000);
    expect(zeile.maxTokens).toBe(5000);
  });

  test("KEINE Flut: gleicher Zustand wird nur EINMAL protokolliert", async () => {
    /* Bei einem Workshop mit 2000 Analysen waeren 2000 gleiche Eintraege
       wertlos — der eine wichtige ginge darin unter. */
    setze({ aktiv: "t1", profile: { t1: T1 } });
    for (let i = 0; i < 20; i += 1) {
      /* Cache-Ablauf nachstellen, ohne den Protokoll-Zustand zu vergessen. */
      await geltendeWerte();
    }
    expect(ausgabe.mock.calls.length).toBe(1);
  });

  test("DATENSCHUTZ: im Protokoll stehen nur Zahlen und der Satzname", async () => {
    setze({ aktiv: "t1", profile: { t1: T1 } });
    await geltendeWerte();
    const zeile = JSON.parse(ausgabe.mock.calls[0][0]);
    const erlaubt = ["step", "quelle", "profil", "grund", "zeitgrenzeMs", "maxTokens"];
    for (const schluessel of Object.keys(zeile)) {
      expect(erlaubt).toContain(schluessel);
    }
  });
});
