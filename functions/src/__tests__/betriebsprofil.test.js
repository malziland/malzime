/**
 * betriebsprofil.test.js — Betriebswerte kommen AUSSCHLIESSLICH aus Firestore.
 *
 * ENTSCHEIDUNG DES NUTZERS (30.08.2026): „Natuerlich gehoeren die Werte raus
 * aus dem Code. Das war von Anfang an der Auftrag. Dass wir hier wirklich nur
 * mehr ueber den Firestore unsere Konfiguration machen."
 *
 * Damit gibt es keine Rueckfallwerte mehr. Fehlt der Einstellungssatz oder ist
 * er ungueltig, laeuft KEINE Analyse — das System meldet das laut, statt still
 * mit alten Zahlen weiterzulaufen.
 *
 * Diese Datei prueft drei Dinge: dass ein gueltiger Satz greift, dass ein
 * ungueltiger abgelehnt wird, und dass die Ablehnung IMMER einen lesbaren
 * Grund nennt — ohne den waere ein Ausfall nicht zu diagnostizieren.
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

const { geltendeWerte, _pruefe, _cacheLeeren, PFLICHTFELDER } = require("../betriebsprofil");

/* Ein gueltiger Satz mit den Werten, die heute im Code stehen. */
const GUELTIG = {
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

function setze(daten, fehler = null, verzoegerung = 0) {
  mockDoc.daten = daten;
  mockDoc.fehler = fehler;
  mockDoc.verzoegerung = verzoegerung;
  lesevorgaenge = 0;
  _cacheLeeren();
}
const satz = (werte, name = "t1-normal") => ({ aktiv: name, profile: { [name]: werte } });

beforeEach(() => setze(undefined));

describe("Ein gueltiger Einstellungssatz greift", () => {
  test("die Werte kommen aus Firestore, nicht aus dem Code", async () => {
    setze(satz(GUELTIG));
    const e = await geltendeWerte();
    expect(e.quelle).toBe("firestore");
    expect(e.profil).toBe("t1-normal");
    expect(e.werte.singleLargeTimeoutMs).toBe(300000);
  });

  test("geaenderte Werte wirken — der Fall vom 28.08.", async () => {
    /* Damals kostete das Hochsetzen der Zeitgrenze eine Auslieferung von
       25 Minuten, mitten im Vorfall. */
    setze(satz({ ...GUELTIG, singleLargeTimeoutMs: 420000 }, "notfall"));
    const e = await geltendeWerte();
    expect(e.werte.singleLargeTimeoutMs).toBe(420000);
    expect(e.profil).toBe("notfall");
  });

  test("mehrere Saetze hinterlegt: nur der aktive gilt", async () => {
    setze({
      aktiv: "t2",
      profile: {
        t1: { ...GUELTIG, parallelitaet: 7 },
        t2: { ...GUELTIG, parallelitaet: 14 },
        workshop: { ...GUELTIG, parallelitaet: 20 },
      },
    });
    const e = await geltendeWerte();
    expect(e.werte.parallelitaet).toBe(14);
  });
});

describe("KEINE Werte, KEIN Betrieb — und immer mit Grund", () => {
  const faelle = [
    ["kein Dokument", undefined, null],
    ["Dokument leer", {}, null],
    ["kein aktiver Satz benannt", { profile: { t1: GUELTIG } }, null],
    ["aktiver Satz nicht hinterlegt", { aktiv: "gibt-es-nicht", profile: {} }, null],
    ["Datenbank nicht erreichbar", undefined, "UNAVAILABLE"],
    ["Satz ist kein Objekt", { aktiv: "x", profile: { x: "text" } }, null],
    ["Pflichtfeld fehlt", { aktiv: "x", profile: { x: { singleLargeTimeoutMs: 300000 } } }, null],
  ];

  test.each(faelle)("%s: keine Werte, aber ein lesbarer Grund", async (_name, daten, fehler) => {
    setze(daten, fehler);
    const e = await geltendeWerte();
    expect(e.werte).toBeNull();
    expect(e.quelle).not.toBe("firestore");
    /* Ohne Grund waere ein Ausfall nicht zu diagnostizieren. */
    expect(typeof e.grund).toBe("string");
    expect(e.grund.length).toBeGreaterThan(5);
  });
});

describe("Die Kopplungspruefung — Sicherung aus BUG-2026-08-17-01", () => {
  test("Textmenge passt nicht in die Zeit: abgelehnt", async () => {
    setze(satz({ ...GUELTIG, singleLargeMaxTokens: 20000, singleLargeTimeoutMs: 60000 }));
    const e = await geltendeWerte();
    expect(e.werte).toBeNull();
    expect(e.grund).toContain("abgelehnt");
  });

  test("Einzelgrenze ueber dem Gesamtbudget: abgelehnt", async () => {
    setze(satz({ ...GUELTIG, singleLargeTimeoutMs: 500000, requestBudgetMs: 400000 }));
    expect((await geltendeWerte()).werte).toBeNull();
  });

  test("Budget ueber dem Function-Limit von 540 s: abgelehnt", async () => {
    setze(satz({ ...GUELTIG, requestBudgetMs: 600000 }));
    expect((await geltendeWerte()).werte).toBeNull();
  });

  test("POSITIVKONTROLLE: die heutigen Werte bestehen die Pruefung", () => {
    /* Waere die Pruefung zu streng, waere jeder Satz chancenlos — auch der,
       den wir anlegen wollen. */
    expect(_pruefe(GUELTIG)).toBeNull();
  });

  test("alle Pflichtfelder werden einzeln als fehlend erkannt", () => {
    for (const feld of PFLICHTFELDER) {
      const ohne = { ...GUELTIG };
      delete ohne[feld];
      const grund = _pruefe(ohne);
      expect(grund).toContain(feld);
    }
  });
});
