/**
 * kapazitaets-wache-blind.test.js — merkt jemand, wenn diese Wache blind ist?
 *
 * BEFUND 01.09.2026 (Pruefrunde 8, N-P3a): Konnte die Wache nichts messen,
 * ging das als `console.log` hinaus — unterhalb der Alarmschwelle. Die
 * Begruendung war richtig (eine einzelne Netzstoerung ist keine
 * Fehlkonfiguration), die Folge nicht: Sie konnte DAUERHAFT blind sein, ohne
 * dass es jemandem auffiel. Diese Wache ist wegen des Vorfalls vom 31.08.
 * gebaut worden, bei dem ein Testlauf die Produktions-Warteschlange verstellt
 * hat — eine blinde Wache ist dort das eigentliche Risiko.
 */

const mockZustand = { daten: undefined, lesefehler: null };
let mockGeschrieben = [];

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        if (mockZustand.lesefehler) throw new Error(mockZustand.lesefehler);
        return { exists: mockZustand.daten !== undefined, data: () => mockZustand.daten };
      },
      async set(werte) {
        mockGeschrieben.push(werte);
      },
    }),
  }),
}));

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const wache = require("../kapazitaets-wache");

/** Ein Client, der beim Lesen der Warteschlange scheitert. */
const blinderClient = {
  queuePath: (p, r, n) => `projects/${p}/locations/${r}/queues/${n}`,
  async getQueue() {
    throw new Error("PERMISSION_DENIED");
  },
};

const ALT = { ...process.env };

beforeEach(() => {
  process.env.GCLOUD_PROJECT = "malzime-test";
  mockZustand.daten = undefined;
  mockZustand.lesefehler = null;
  mockGeschrieben = [];
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ALT };
  wache.setClientForTest(null);
  jest.restoreAllMocks();
});

/** Alle als JSON geschriebenen Zeilen eines Kanals. */
function zeilen(kanal) {
  return kanal.mock.calls
    .map(([z]) => z)
    .filter((z) => typeof z === "string")
    .map((z) => {
      try {
        return JSON.parse(z);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe("Eine blinde Wache meldet sich", () => {
  test("einmaliger Ausfall bleibt eine Logzeile, kein Alarm", async () => {
    /* Sonst meldet jede Netzstoerung Alarm, und nach zwei Wochen schaut
       niemand mehr hin. */
    wache.setClientForTest(blinderClient);
    await wache.pruefeKapazitaet({ melder: async () => {} });

    const gemeldet = zeilen(console.log).filter((z) => z.status === "nicht-messbar");
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0].tage).toBe(1);
    expect(zeilen(console.error).filter((z) => z.status === "nicht-messbar")).toHaveLength(0);
  });

  test("haelt der Ausfall an, wird daraus eine ERROR-Zeile", async () => {
    const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    mockZustand.daten = { blindSeit: gestern };
    wache.setClientForTest(blinderClient);

    await wache.pruefeKapazitaet({ melder: async () => {} });

    const alarm = zeilen(console.error).filter((z) => z.status === "nicht-messbar");
    expect(alarm).toHaveLength(1);
    expect(alarm[0].severity).toBe("ERROR");
    expect(alarm[0].tage).toBeGreaterThanOrEqual(2);
    expect(alarm[0].hinweis).toMatch(/blind/i);
  });

  test("ist auch der eigene Zustand unlesbar, wird sofort gemeldet", async () => {
    /* Dann laesst sich die Dauer gar nicht bestimmen — Schweigen waere hier
       dieselbe Falle eine Ebene tiefer. */
    mockZustand.lesefehler = "PERMISSION_DENIED";
    wache.setClientForTest(blinderClient);

    await wache.pruefeKapazitaet({ melder: async () => {} });

    const alarm = zeilen(console.error).filter((z) => z.status === "nicht-messbar");
    expect(alarm).toHaveLength(1);
    expect(alarm[0].severity).toBe("ERROR");
  });

  test("wieder messbar setzt den Zaehler zurueck", async () => {
    /* Ein Zaehler, der sich nie erholt, erzeugt Dauerrot. */
    wache.setClientForTest({
      queuePath: (p, r, n) => `projects/${p}/locations/${r}/queues/${n}`,
      async getQueue() {
        /* Die Werte des Einstellungssatzes — sonst ist der Befund
           "auffaellig", und der Ruecksetz-Zweig wird nie erreicht. */
        const { SATZ } = require("../test-satz");
        return [
          {
            rateLimits: {
              maxConcurrentDispatches: SATZ.parallelitaet,
              maxDispatchesPerSecond: SATZ.queueRatePerSekunde,
            },
          },
        ];
      },
    });

    await wache.pruefeKapazitaet({ melder: async () => {} });

    expect(mockGeschrieben.some((w) => w.blindSeit === null)).toBe(true);
  });
});
