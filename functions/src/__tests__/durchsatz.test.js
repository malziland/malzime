/**
 * durchsatz.test.js — Die Wartezeit-Ansage rechnet mit der Wirklichkeit.
 *
 * HINTERGRUND (FEATURE-2026-08-29-02): `QUEUE_AVG_JOB_SECONDS = 65` stammt aus
 * einem Lasttest vom 23.05.2026 und war am 28.08. um mehr als die Haelfte zu
 * optimistisch (real ~150 s). Aus derselben Zahl wird die Einlassgrenze
 * berechnet: 155 Plaetze statt der real schaffbaren 67.
 *
 * Geprueft wird vor allem, dass die Riegel halten — eine Ansage, die nicht
 * stimmt, ist schlechter als gar keine.
 */

const mockDoc = { daten: undefined };

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
    async runTransaction(fn) {
      return fn({
        async get() {
          return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
        },
        set(_ref, daten) {
          mockDoc.daten = { ...(mockDoc.daten || {}), ...daten };
        },
      });
    },
  }),
}));

const { merkeDauer, gemesseneDauer, dauerJeAnalyse, _cacheLeeren, _MIN_WERTE } = require("../durchsatz");
const { QUEUE_AVG_JOB_SECONDS } = require("../config");

/** Legt n Messwerte mit gegebener Dauer und gegebenem Alter ab. */
function werteSetzen(sekundenListe, alterMs = 0) {
  mockDoc.daten = {
    werte: sekundenListe.map((s) => ({ s, t: Date.now() - alterMs })),
  };
  _cacheLeeren();
}

beforeEach(() => {
  mockDoc.daten = undefined;
  _cacheLeeren();
});

describe("Gemessene Analysedauer", () => {
  test("unter fuenf Werten gibt es keine Aussage", async () => {
    werteSetzen([100, 100, 100, 100]);
    expect(await gemesseneDauer()).toBeNull();

    werteSetzen([100, 100, 100, 100, 100]);
    expect((await gemesseneDauer()).anzahl).toBe(_MIN_WERTE);
  });

  test("unplausible Werte werden verworfen, nicht angezeigt", async () => {
    /* 5 s waere ein Messfehler, 9000 s ein haengender Job. Beide duerfen die
       Ansage nicht verfaelschen. */
    werteSetzen([5, 9000, 120, 130, 140, 150, 160]);
    const ergebnis = await gemesseneDauer();

    expect(ergebnis.anzahl).toBe(5);
    expect(ergebnis.sekunden).toBeGreaterThanOrEqual(120);
    expect(ergebnis.sekunden).toBeLessThanOrEqual(160);
  });

  test("die Ansage ueberschaetzt bewusst (80-Perzentil statt Median)", async () => {
    /* Median waere 130. Wer weniger wartet als angesagt, ist zufrieden; wer
       laenger wartet, verliert das Vertrauen. */
    werteSetzen([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]);
    const ergebnis = await gemesseneDauer();

    expect(ergebnis.sekunden).toBeGreaterThan(130);
  });

  test("alte Messwerte gelten als nicht mehr frisch", async () => {
    const achtTage = 8 * 24 * 60 * 60 * 1000;
    werteSetzen([120, 130, 140, 150, 160], achtTage);
    const ergebnis = await gemesseneDauer();

    /* Der Wert bleibt brauchbar — malziME ruht ueber Ferien wochenlang, und
       die letzten 20 Laeufe vom letzten Workshop sind besser als eine Zahl aus
       dem Mai. Aber "frisch" ist er nicht, und der Aufrufer zeigt dann die
       Position statt einer Sekundenzahl. */
    expect(ergebnis).not.toBeNull();
    expect(ergebnis.frisch).toBe(false);
  });

  test("frische Werte sind als frisch gekennzeichnet", async () => {
    werteSetzen([120, 130, 140, 150, 160], 60 * 60 * 1000);
    expect((await gemesseneDauer()).frisch).toBe(true);
  });
});

describe("Rueckfallebene", () => {
  test("ohne Flag gilt der Code-Wert", async () => {
    werteSetzen([200, 210, 220, 230, 240]);
    const ergebnis = await dauerJeAnalyse(false);

    expect(ergebnis.sekunden).toBe(QUEUE_AVG_JOB_SECONDS);
    expect(ergebnis.gemessen).toBe(false);
  });

  test("ohne genug Messwerte gilt der Code-Wert", async () => {
    werteSetzen([200, 210]);
    const ergebnis = await dauerJeAnalyse(true);

    expect(ergebnis.sekunden).toBe(QUEUE_AVG_JOB_SECONDS);
    expect(ergebnis.gemessen).toBe(false);
  });

  test("mit genug Messwerten gilt die Messung", async () => {
    werteSetzen([200, 210, 220, 230, 240]);
    const ergebnis = await dauerJeAnalyse(true);

    expect(ergebnis.gemessen).toBe(true);
    expect(ergebnis.sekunden).toBeGreaterThan(QUEUE_AVG_JOB_SECONDS);
  });
});

describe("Schreiben", () => {
  test("unplausible Dauern kommen gar nicht erst in den Ring", async () => {
    await merkeDauer(3);
    await merkeDauer(5000);
    expect(mockDoc.daten).toBeUndefined();

    await merkeDauer(120);
    expect(mockDoc.daten.werte).toHaveLength(1);
  });

  test("der Ring haelt hoechstens zwanzig Werte", async () => {
    for (let i = 0; i < 25; i += 1) await merkeDauer(100 + i);
    expect(mockDoc.daten.werte).toHaveLength(20);
    /* Die aeltesten fliegen raus, nicht die neuesten. */
    expect(mockDoc.daten.werte[19].s).toBe(124);
  });
});
