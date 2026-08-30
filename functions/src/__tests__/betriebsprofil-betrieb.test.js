/**
 * betriebsprofil-betrieb.test.js — Notausstieg und Workshop-Last.
 *
 * SORGE DES NUTZERS (30.08.2026): „Ich kann ja alleine nicht alle Testfaelle
 * ausprobieren. Es kann sein, dass es bei mir zufaelligerweise geht, weil ich
 * in keinen Grenzbereich reinkomme. Das erste Problem wird dann vielleicht die
 * grosse Klasse sein."
 *
 * Nachgestellt wird ein Workshop-Vormittag: viele gleichzeitige Analysen,
 * Umschalten mitten im Betrieb, Datenbankausfall unter Last. Kostet nichts —
 * kein Mistral-Aufruf, kein echtes Firestore.
 */

const mockDoc = { daten: undefined, fehler: null, verzoegerung: 0 };
let lesevorgaenge = 0;

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        lesevorgaenge += 1;
        if (mockDoc.verzoegerung) await new Promise((f) => setTimeout(f, mockDoc.verzoegerung));
        if (mockDoc.fehler) throw new Error(mockDoc.fehler);
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, _cacheLeeren } = require("../betriebsprofil");

const T1 = {
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  requestBudgetMs: 480000,
  describeMaxTokens: 2048,
  profileMaxTokens: 16000,
  parallelitaet: 7,
  stundenlimit: 500,
  adressLimit: 500,
};
const T2 = { ...T1, singleLargeTimeoutMs: 420000, parallelitaet: 14 };

function setze(daten, fehler = null, verzoegerung = 0) {
  mockDoc.daten = daten;
  mockDoc.fehler = fehler;
  mockDoc.verzoegerung = verzoegerung;
  lesevorgaenge = 0;
  _cacheLeeren();
}
const satz = (w, n = "t1") => ({ aktiv: n, profile: { [n]: w } });

beforeEach(() => setze(undefined));

describe("NOTAUSSTIEG — zurueck ohne Auslieferung", () => {
  test("Umschalten auf einen anderen Satz wirkt sofort", async () => {
    setze({ aktiv: "t1", profile: { t1: T1, t2: T2 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);

    setze({ aktiv: "t2", profile: { t1: T1, t2: T2 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(420000);

    /* Und wieder zurueck — der eigentliche Notausstieg. */
    setze({ aktiv: "t1", profile: { t1: T1, t2: T2 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("ein kaputter Satz macht den vorherigen nicht kaputt", async () => {
    setze(satz(T1));
    expect((await geltendeWerte()).quelle).toBe("firestore");

    setze({ aktiv: "kaputt", profile: { t1: T1, kaputt: { singleLargeTimeoutMs: 1 } } });
    const e = await geltendeWerte();
    expect(e.werte).toBeNull();
    expect(e.grund).toContain("abgelehnt");

    /* Zurueckschalten heilt sofort. */
    setze({ aktiv: "t1", profile: { t1: T1 } });
    expect((await geltendeWerte()).werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("haengende Datenbank: niemand wartet laenger als das Zeitlimit", async () => {
    setze(satz(T1), null, 6000);
    const start = Date.now();
    const e = await geltendeWerte();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(e.werte).toBeNull();
    expect(e.grund).toContain("nicht lesbar");
  }, 12000);
});

describe("WORKSHOP-LAST", () => {
  test("50 gleichzeitige Analysen lesen die Datenbank hoechstens einmal", async () => {
    setze(satz(T1));
    const alle = await Promise.all(Array.from({ length: 50 }, () => geltendeWerte()));
    expect(lesevorgaenge).toBeLessThanOrEqual(1);
    for (const e of alle) expect(e.werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("200 Aufrufe bekommen ALLE denselben Satz — kein halb umgestellter Zustand", async () => {
    setze(satz(T1));
    const alle = await Promise.all(Array.from({ length: 200 }, () => geltendeWerte()));
    expect(new Set(alle.map((e) => JSON.stringify(e.werte))).size).toBe(1);
  });

  test("Umschalten unter Last: niemand bekommt einen ungueltigen Satz", async () => {
    setze({ aktiv: "t1", profile: { t1: T1, t2: T2 } });
    const vorher = await Promise.all(Array.from({ length: 30 }, () => geltendeWerte()));
    setze({ aktiv: "t2", profile: { t1: T1, t2: T2 } });
    const nachher = await Promise.all(Array.from({ length: 30 }, () => geltendeWerte()));

    for (const e of vorher) expect(e.werte.singleLargeTimeoutMs).toBe(300000);
    for (const e of nachher) expect(e.werte.singleLargeTimeoutMs).toBe(420000);
  });

  test("Datenbankausfall unter Last: alle bekommen denselben klaren Grund", async () => {
    setze(satz(T1));
    await geltendeWerte();
    setze(undefined, "UNAVAILABLE");
    const alle = await Promise.all(Array.from({ length: 40 }, () => geltendeWerte()));
    for (const e of alle) {
      expect(e.werte).toBeNull();
      expect(e.grund).toContain("nicht lesbar");
    }
  });

  test("haengende Datenbank unter Last: 20 Aufrufe, keiner blockiert", async () => {
    setze(satz(T1), null, 6000);
    const start = Date.now();
    const alle = await Promise.all(Array.from({ length: 20 }, () => geltendeWerte()));
    expect(Date.now() - start).toBeLessThan(5000);
    for (const e of alle) expect(e.werte).toBeNull();
  }, 15000);
});
