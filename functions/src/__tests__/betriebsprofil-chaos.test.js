/**
 * betriebsprofil-chaos.test.js — Was passiert bei Unsinn im Einstellungssatz?
 *
 * AUFTRAG DES NUTZERS (30.08.2026): „Das muss wirklich kreuz und quer getestet
 * werden, auch auf zufaellige Bedienung und so irgendwelche Chaos-Eingaben.
 * Also nicht nur den vorgefertigten Lauf, wie wir ihn kennen, denn man weiss
 * nie, wie Benutzer reagieren."
 *
 * Das Dokument wird von Hand in der Firebase-Konsole bearbeitet — also von
 * einem Menschen, nachts, unter Druck, womoeglich am Handy. Dabei entstehen
 * Tippfehler, halbe Eingaben, falsche Typen, kopierte Textbausteine.
 *
 * VERLANGT WIRD IMMER DASSELBE: kein Absturz, keine stillen Falschwerte, und
 * ein lesbarer Grund. Lieber gar keine Analyse mit klarer Meldung als eine
 * Analyse mit Werten, die niemand gewollt hat.
 */

const mockDoc = { daten: undefined };

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, _pruefe, _cacheLeeren } = require("../betriebsprofil");

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
const setze = (d) => {
  mockDoc.daten = d;
  _cacheLeeren();
};

describe("CHAOS — Eingaben, die ein Mensch tatsaechlich macht", () => {
  const unsinn = [
    ["Zahl als Text getippt", { ...GUELTIG, singleLargeTimeoutMs: "300000" }],
    ["Komma statt Punkt", { ...GUELTIG, singleLargeTimeoutMs: "300.000" }],
    ["Sekunden statt Millisekunden", { ...GUELTIG, singleLargeTimeoutMs: 300 }],
    ["Minuten statt Millisekunden", { ...GUELTIG, singleLargeTimeoutMs: 5 }],
    ["negativ", { ...GUELTIG, parallelitaet: -7 }],
    ["null", { ...GUELTIG, singleLargeTimeoutMs: null }],
    ["leerer Text", { ...GUELTIG, singleLargeTimeoutMs: "" }],
    ["Nachkommastellen", { ...GUELTIG, parallelitaet: 7.5 }],
    ["unendlich", { ...GUELTIG, requestBudgetMs: Infinity }],
    ["keine Zahl", { ...GUELTIG, stundenlimit: NaN }],
    ["Liste statt Zahl", { ...GUELTIG, parallelitaet: [7] }],
    ["Objekt statt Zahl", { ...GUELTIG, parallelitaet: { wert: 7 } }],
    ["wahr/falsch", { ...GUELTIG, parallelitaet: true }],
    ["riesige Zahl", { ...GUELTIG, stundenlimit: 999999999999 }],
    ["Feldname vertippt", { ...GUELTIG, singleLargeTimeoutMS: 300000, singleLargeTimeoutMs: undefined }],
    ["alles leer", {}],
    ["nur ein Feld", { singleLargeTimeoutMs: 300000 }],
  ];

  test.each(unsinn)("%s: kein Absturz, keine Falschwerte, Grund vorhanden", async (_n, satz) => {
    setze({ aktiv: "x", profile: { x: satz } });
    const e = await geltendeWerte();
    if (e.werte !== null) {
      /* Wenn etwas durchgeht, muss es vollstaendig UND plausibel sein. */
      expect(_pruefe(e.werte)).toBeNull();
      for (const v of Object.values(e.werte)) {
        expect(typeof v).toBe("number");
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    } else {
      expect(typeof e.grund).toBe("string");
      expect(e.grund.length).toBeGreaterThan(5);
    }
  });

  const kaputteDokumente = [
    ["Dokument ist ein Text", "kaputt"],
    ["Dokument ist eine Zahl", 42],
    ["Dokument ist eine Liste", [1, 2, 3]],
    ["aktiv ist eine Zahl", { aktiv: 1, profile: { 1: GUELTIG } }],
    ["aktiv ist eine Liste", { aktiv: ["t1"], profile: { t1: GUELTIG } }],
    ["profile ist ein Text", { aktiv: "t1", profile: "t1" }],
    ["profile ist null", { aktiv: "t1", profile: null }],
    ["Name mit Leerzeichen", { aktiv: " t1 ", profile: { t1: GUELTIG } }],
    ["Name mit Sonderzeichen", { aktiv: "t1/../etc", profile: { t1: GUELTIG } }],
    ["sehr langer Name", { aktiv: "x".repeat(5000), profile: { t1: GUELTIG } }],
    ["verschachtelt", { aktiv: "t1", profile: { t1: { profile: { t1: GUELTIG } } } }],
  ];

  test.each(kaputteDokumente)("%s: stuerzt nicht ab", async (_n, dok) => {
    setze(dok);
    const e = await geltendeWerte();
    expect(e).toBeDefined();
    expect(e.werte === null || typeof e.werte === "object").toBe(true);
    if (e.werte === null) expect(typeof e.grund).toBe("string");
  });
});

describe("CHAOS — Zufallswerte", () => {
  test("500 zufaellige Saetze: entweder gueltig und plausibel, oder abgelehnt mit Grund", () => {
    /* Kein festes Muster, sondern Streuung ueber Groessenordnungen — genau
       das, was eine Handeingabe erzeugt. */
    const wuerfel = () => {
      const art = Math.floor(Math.random() * 6);
      if (art === 0) return Math.floor(Math.random() * 1000);
      if (art === 1) return Math.floor(Math.random() * 1000000);
      if (art === 2) return -Math.floor(Math.random() * 1000);
      if (art === 3) return Math.random();
      if (art === 4) return String(Math.floor(Math.random() * 1000));
      return null;
    };
    for (let i = 0; i < 500; i += 1) {
      const satz = {};
      for (const feld of Object.keys(GUELTIG)) satz[feld] = wuerfel();
      const grund = _pruefe(satz);
      if (grund === null) {
        /* Durchgelassen? Dann muss jeder Wert eine sinnvolle Zahl sein. */
        for (const [name, v] of Object.entries(satz)) {
          expect(typeof v).toBe("number");
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
        /* Und die Kopplung muss halten. */
        expect(satz.singleLargeMaxTokens / 19.4).toBeLessThanOrEqual(satz.singleLargeTimeoutMs / 1000);
      } else {
        expect(typeof grund).toBe("string");
      }
    }
  });

  test("die Pruefung stuerzt bei keinem denkbaren Eingabetyp ab", () => {
    const typen = [
      undefined,
      null,
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
      "",
      "text",
      [],
      {},
      true,
      false,
      Symbol("x").toString(),
      1e308,
      -1e308,
      0.1 + 0.2,
    ];
    for (const t of typen) {
      for (const feld of Object.keys(GUELTIG)) {
        expect(() => _pruefe({ ...GUELTIG, [feld]: t })).not.toThrow();
      }
    }
  });
});
