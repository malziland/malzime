/**
 * laufzeit-wache-zustand.test.js — Was tut die Wache, wenn sie ihren eigenen
 * Zustand nicht lesen kann?
 *
 * BEFUND 01.09.2026 (Runde 7, K-10): Das Lesen des Zustandsdokuments lag in
 * einem stummen catch mit dem Kommentar "wird nur einmalig nicht gemeldet".
 * Fuer einen einzelnen Fehlgriff stimmt das. Bleibt das Dokument dauerhaft
 * unlesbar, faengt der Zaehler jeden Tag wieder bei 1 an und erreicht die
 * Schwelle ANHALTEND_TAGE nie — die Wache schweigt fuer immer, und nichts
 * wird rot. Genau die Fehlerform, gegen die sie gebaut wurde.
 *
 * laufzeit-wache.test.js prueft die reine Rechnung ohne Attrappen; diese
 * Datei steht daneben, damit die Mocks dort nichts verdecken.
 */

const mockZustand = { fehler: null, daten: undefined };
let mockSchreibvorgaenge = 0;

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        if (mockZustand.fehler) throw new Error(mockZustand.fehler);
        return {
          exists: mockZustand.daten !== undefined,
          data: () => mockZustand.daten,
        };
      },
      async set() {
        mockSchreibvorgaenge += 1;
      },
    }),
  }),
}));

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const mockHistorie = { tage: [] };
jest.mock("../durchsatz", () => ({
  tagesHistorie: async () => mockHistorie.tage,
}));

const { pruefeLaufzeit } = require("../laufzeit-wache");
const { SATZ } = require("../test-satz");

/** Ein Tag mit n Analysen der angegebenen Dauer. */
function tag(datum, sekunden, n = 6) {
  return { d: datum, w: Array.from({ length: n }, () => sekunden) };
}

/** Die Lage vom 26.-28.08.2026: vierzehn ruhige Tage, dann der Einbruch. */
function auffaelligeHistorie() {
  const tage = [];
  for (let i = 11; i <= 25; i += 1) tage.push(tag(`2026-08-${i}`, 65));
  tage.push(tag("2026-08-26", 110), tag("2026-08-27", 95), tag("2026-08-28", 150));
  return tage;
}

const JETZT = Date.parse("2026-08-28T09:00:00Z");

beforeEach(() => {
  mockZustand.fehler = null;
  mockZustand.daten = undefined;
  mockSchreibvorgaenge = 0;
  mockHistorie.tage = auffaelligeHistorie();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Zustandsdokument unlesbar", () => {
  test("die Wache meldet trotzdem, statt auf die Schwelle zu warten", async () => {
    mockZustand.fehler = "PERMISSION_DENIED";
    const gemeldet = [];

    const ergebnis = await pruefeLaufzeit({ melder: async (t) => gemeldet.push(t), jetzt: JETZT });

    expect(ergebnis.gemeldet).toBe(true);
    expect(ergebnis.grund).toBe("zustand-unlesbar");
    expect(gemeldet).toHaveLength(1);
    /* Und sie versucht weiterhin zu schreiben — ein Lesefehler heisst nicht,
       dass auch das Fortschreiben aufzugeben waere. Wird das Dokument wieder
       lesbar, steht die Historie dann bereit. */
    expect(mockSchreibvorgaenge).toBeGreaterThan(0);
  });

  test("der Ausfall wird als ERROR protokolliert, nicht verschluckt", async () => {
    mockZustand.fehler = "PERMISSION_DENIED";

    await pruefeLaufzeit({ melder: async () => {}, jetzt: JETZT });

    const zeilen = console.error.mock.calls.map(([z]) => z).filter((z) => typeof z === "string");
    const treffer = zeilen.map((z) => JSON.parse(z)).filter((o) => o.grund === "zustand-unlesbar");
    expect(treffer).toHaveLength(1);
    expect(treffer[0].severity).toBe("ERROR");
    expect(treffer[0].fehler).toMatch(/PERMISSION_DENIED/);
  });

  test("bei lesbarem, leerem Zustand gilt die Schwelle unveraendert", async () => {
    /* Gegenprobe: Ohne Lesefehler ist der erste auffaellige Tag noch kein
       anhaltender Einbruch — sonst wuerde die Behebung die Schwelle
       aushebeln, statt nur den Ausfall abzudecken. */
    mockZustand.daten = undefined;
    const gemeldet = [];

    const ergebnis = await pruefeLaufzeit({ melder: async (t) => gemeldet.push(t), jetzt: JETZT });

    expect(ergebnis.gemeldet).toBe(false);
    expect(ergebnis.grund).toBe("noch-nicht-anhaltend");
    expect(gemeldet).toHaveLength(0);
  });

  test("bei bekanntem Vortag meldet sie wie bisher ueber die Schwelle", async () => {
    mockZustand.daten = { auffaelligSeit: "2026-08-27" };
    const gemeldet = [];

    const ergebnis = await pruefeLaufzeit({ melder: async (t) => gemeldet.push(t), jetzt: JETZT });

    expect(ergebnis.gemeldet).toBe(true);
    expect(ergebnis.grund).not.toBe("zustand-unlesbar");
    expect(gemeldet).toHaveLength(1);
  });
});

test("Satz vorhanden — sonst misst diese Datei am falschen Riegel", () => {
  expect(SATZ.singleLargeTimeoutMs).toBeGreaterThan(0);
});
