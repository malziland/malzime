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

/* Zentral aus ../test-satz — sonst muss jedes neue Pflichtfeld in
   jeder Testdatei nachgetragen werden (Ein-Quellen-Regel). */
const T1 = require("../test-satz").SATZ;
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

  /* ZWEI FAELLE, seit dem Betriebsvorfall vom 01.09.2026 getrennt geprueft.
     Vorher stand hier nur der erste — und der misst ausgerechnet den Fall, in
     dem die Grenze GROSSZUEGIGER ist. Die Zusage "im Betrieb wartet niemand
     laenger als zwei Sekunden" war damit nie gemessen. */
  test("erster Lesevorgang nach dem Start: darf laenger warten, aber nicht endlos", async () => {
    setze(satz(T1), null, 6000);
    const start = Date.now();
    const e = await geltendeWerte();
    /* 5000 ms Limit — die Toleranz deckt den Testlauf selbst ab. */
    expect(Date.now() - start).toBeLessThan(6000);
    expect(e.werte).toBeNull();
    expect(e.grund).toContain("nicht lesbar");
  }, 15000);

  /* DER EIGENTLICHE BELEG fuer den Vorfall vom 01.09.2026.
     Die beiden Tests darum herum waeren auch OHNE die Aenderung gruen — sie
     messen Obergrenzen, und eine engere Grenze reisst eine Obergrenze nicht.
     Dieser hier misst den Unterschied selbst: Dieselbe traege Datenbank
     (3 Sekunden) muss beim ersten Lesevorgang durchgehen und im laufenden
     Betrieb abbrechen. Wird das Erstlimit zurueckgebaut, faellt genau diese
     Pruefung um. */
  test("dieselbe traege Datenbank: kalt geht durch, warm bricht ab", async () => {
    setze(satz(T1), null, 3000);
    const kalt = await geltendeWerte();
    expect(kalt.grund).toBeNull();
    expect(kalt.werte).not.toBeNull();

    mockDoc.verzoegerung = 3000;
    _cacheLeeren({ warmBleiben: true });
    const warm = await geltendeWerte();
    expect(warm.werte).toBeNull();
    expect(warm.grund).toContain("Zeitlimit 2000 ms");
  }, 20000);

  test("im laufenden Betrieb bleibt es bei zwei Sekunden", async () => {
    /* Erst einmal ERFOLGREICH lesen — danach gilt die Instanz als warm. */
    setze(satz(T1));
    expect((await geltendeWerte()).werte).not.toBeNull();

    /* Jetzt haengt die Datenbank, der Cache ist abgelaufen, die Verbindung
       steht aber. Genau hier muss die enge Grenze greifen. */
    mockDoc.verzoegerung = 6000;
    _cacheLeeren({ warmBleiben: true });
    const start = Date.now();
    const e = await geltendeWerte();
    expect(Date.now() - start).toBeLessThan(3000);
    expect(e.werte).toBeNull();
    expect(e.grund).toContain("Zeitlimit 2000 ms");
  }, 15000);
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
    /* Frische Instanz, also gilt das grosszuegigere Erstlimit (5000 ms).
       Entscheidend ist nicht die Zahl, sondern dass ALLE zwanzig gemeinsam
       darunter bleiben — niemand haengt hinter dem anderen. */
    expect(Date.now() - start).toBeLessThan(6000);
    for (const e of alle) expect(e.werte).toBeNull();
  }, 15000);
});
