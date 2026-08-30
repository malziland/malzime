/* BIZ-2026-08-20-28 (Entscheidung E2 aus dem Audit): Ein Boost hob den Deckel
   DAUERHAFT an — kein Rückfall, kein Zeitplan, kein Alarm. Nach einem Klick war
   die mockDokumentierte Kostenbremse still verdoppelt, bis sich jemand an einen
   manuellen Reset erinnerte.

   Der Verfall ist BEWUSST SANFT gebaut, weil hier der Workshop-Betrieb hängt:
   Er greift erst, wenn die Frist um ist UND der Boost gerade nicht gebraucht
   wird. Genau das prüfen diese Tests — der zweite ist der wichtigere. */
/* Einstellungssatz gestellt: Die Betriebswerte kommen seit 30.08.2026 aus
   Firestore, ohne Rueckfallwerte im Code. Ohne diesen Satz laeuft die
   Einlasskontrolle nicht — das ist Absicht und wird in
   betriebsprofil*.test.js geprueft, nicht hier. */
jest.mock("../betriebsprofil", () => ({
  geltendeWerte: async () => ({
    werte: {
      mistralTimeoutMs: 90000,
      singleLargeTimeoutMs: 300000,
      singleLargeMaxTokens: 5000,
      requestBudgetMs: 480000,
      describeMaxTokens: 2048,
      profileMaxTokens: 16000,
      parallelitaet: 7,
      stundenlimit: 500,
      adressLimit: 500,
      stundenfensterMinuten: 60,
      adressfensterMs: 600000,
      jobAufbewahrungMs: 7200000,
      zustellfensterMs: 900000,
      livenessGnadenfristMs: 480000,
    },
    quelle: "firestore",
    profil: "test",
    grund: null,
  }),
}));

const HOURLY_LIMIT = 500;
const BOOST_FRIST_MS = 2 * 60 * 60 * 1000;

let counter;
/* Jest erlaubt in der Attrappen-Fabrik nur Namen mit "mock"-Praefix. */
let mockDokument;
let mockGeschrieben;

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => mockDokument }),
      set: async () => {},
    }),
    runTransaction: async (fn) =>
      fn({
        get: async () => ({ exists: true, data: () => mockDokument }),
        update: (_ref, aenderung) => {
          mockGeschrieben = aenderung;
        },
        set: () => {},
      }),
  }),
}));

beforeEach(() => {
  jest.resetModules();
  mockGeschrieben = null;
  counter = require("../counter");
});

describe("Boost verfällt, wenn er nicht mehr gebraucht wird", () => {
  test("abgelaufen und ruhig: der Deckel fällt auf das reguläre Limit zurück", async () => {
    mockDokument = {
      recentAnalyses: [Date.now()],
      limit: 700,
      limitBis: Date.now() - 60 * 1000 /* eine Minute zu spät */,
      windowMinutes: 60,
    };

    const ergebnis = await counter.checkAndIncrement();

    expect(ergebnis.limit).toBe(HOURLY_LIMIT);
    expect(mockGeschrieben).toMatchObject({ limit: HOURLY_LIMIT, limitBis: null });
  });

  test("WICHTIG: abgelaufen, aber noch unter Last — niemand wird mitten im Workshop ausgesperrt", async () => {
    /* 600 Analysen im Fenster, reguläres Limit 500: Ein harter Verfall würde die
       laufende Klasse sofort sperren. Der Boost bleibt deshalb stehen, bis der
       Zähler wieder unter 500 liegt. */
    const jetzt = Date.now();
    mockDokument = {
      recentAnalyses: Array.from({ length: 600 }, (_, i) => jetzt - i * 1000),
      limit: 700,
      limitBis: jetzt - 60 * 1000,
      windowMinutes: 60,
    };

    const ergebnis = await counter.checkAndIncrement();

    expect(ergebnis.limit).toBe(700);
    expect(ergebnis.allowed).toBe(true);
    expect(mockGeschrieben).not.toMatchObject({ limit: HOURLY_LIMIT });
  });

  test("noch gültig: der Boost bleibt unangetastet", async () => {
    mockDokument = {
      recentAnalyses: [Date.now()],
      limit: 700,
      limitBis: Date.now() + BOOST_FRIST_MS,
      windowMinutes: 60,
    };

    const ergebnis = await counter.checkAndIncrement();

    expect(ergebnis.limit).toBe(700);
    expect(mockGeschrieben).not.toMatchObject({ limit: HOURLY_LIMIT });
  });

  test("Boost aus der Zeit vor diesem Fix (ohne Frist) bleibt bestehen", async () => {
    /* Bestehendes still zu entwerten wäre die schlechtere Überraschung. */
    mockDokument = { recentAnalyses: [Date.now()], limit: 700, windowMinutes: 60 };

    const ergebnis = await counter.checkAndIncrement();

    expect(ergebnis.limit).toBe(700);
  });

  test("ohne Boost bleibt alles beim regulären Limit", async () => {
    mockDokument = { recentAnalyses: [Date.now()], limit: HOURLY_LIMIT, windowMinutes: 60 };

    const ergebnis = await counter.checkAndIncrement();

    expect(ergebnis.limit).toBe(HOURLY_LIMIT);
    expect(mockGeschrieben).toMatchObject({ recentAnalyses: expect.any(Array) });
    expect(mockGeschrieben.limitBis).toBeUndefined();
  });
});
