"use strict";

/* Einlassgrenze und Wartezeit-Ansage rechnen mit BEIDEN Bremsen der
   Warteschlange (BUG-2026-10-03-35).

   Den Durchsatz begrenzen zwei Einstellwerte: wie viele Analysen gleichzeitig
   laufen (`parallelitaet`) und wie viele Auftraege die Warteschlange je Sekunde
   losschickt (`queueRatePerSekunde`). Es gilt die kleinere Zahl. Vorher
   rechneten beide Stellen nur mit der Parallelitaet: Wurde die KI schneller
   als rund 32 Sekunden je Analyse, liess der Einlass mehr ein, als in 30
   Minuten zu schaffen ist (bei 25 Sekunden 230 statt 144).

   Echte Funktionen von Einlass und Statusabfrage, mit den Werten des
   ausgelieferten Satzes (4 gleichzeitig, 0,1 je Sekunde). Nachgestellt ist nur
   die gemessene Dauer. */

const mockLage = { werte: null, dauer: null };

jest.mock("../betriebsprofil", () => ({ geltendeWerte: async () => ({ werte: mockLage.werte }) }));
jest.mock("../durchsatz", () => ({ dauerJeAnalyse: async () => mockLage.dauer }));
jest.mock("../feature-flags", () => ({ getFeatureFlags: async () => ({ useGemesseneDauer: true }) }));

const { T1_NORMAL } = require("../produktiv-satz");
const { _aktuelleEinlassgrenze } = require("../handle-enqueue");
const { _etaForPosition } = require("../handle-job-status");

const HALBE_STUNDE = 30 * 60;
const gemessen = (sekunden) => ({ sekunden, gemessen: true, frisch: true });

beforeEach(() => {
  mockLage.werte = { ...T1_NORMAL };
  mockLage.dauer = gemessen(40);
});

/* Messmittel-Kontrolle: Der Test rechnet mit den ausgelieferten Zahlen. */
test("der ausgelieferte Satz: 4 gleichzeitig, 0,1 Auftraege je Sekunde", () => {
  expect(T1_NORMAL.parallelitaet).toBe(4);
  expect(T1_NORMAL.queueRatePerSekunde).toBe(0.1);
});

describe("Einlassgrenze: was in 30 Minuten zu schaffen ist, mit 20 % Abschlag", () => {
  test.each([
    /* Dauer, Grenze, welche Bremse gilt */
    [45, 128, "Parallelitaet (4 / 45 s = 0,089 je Sekunde)"],
    [40, 144, "beide gleich (4 / 40 s = 0,1 je Sekunde)"],
    [35, 144, "Rate (4 / 35 s waeren 0,114)"],
    [25, 144, "Rate (4 / 25 s waeren 0,16) — vorher 230"],
    [10, 144, "Rate"],
  ])("gemessene Dauer %i s → %i (%s)", async (sekunden, grenze) => {
    mockLage.dauer = gemessen(sekunden);

    expect(await _aktuelleEinlassgrenze()).toBe(grenze);
  });

  test("nie mehr, als die Rate in 30 Minuten losschickt (1800 × 0,1 × 0,8 = 144)", async () => {
    for (const sekunden of [10, 20, 25, 30, 32, 33, 40, 60, 110]) {
      mockLage.dauer = gemessen(sekunden);
      expect(await _aktuelleEinlassgrenze()).toBeLessThanOrEqual(144);
    }
  });

  test("nur die Rate halbiert: die Grenze halbiert sich", async () => {
    mockLage.werte.queueRatePerSekunde = 0.05;

    expect(await _aktuelleEinlassgrenze()).toBe(72);
  });

  test("nur die Parallelitaet verdoppelt: die Rate bremst weiter", async () => {
    mockLage.werte.parallelitaet = 8;

    expect(await _aktuelleEinlassgrenze()).toBe(144);
  });

  test("bremst die Parallelitaet, bleibt die Rechnung die bisherige", async () => {
    /* Grosse Rate, wie im Testsatz: 1800 / 60 × 7 × 0,8 = 168. */
    mockLage.werte = { ...T1_NORMAL, parallelitaet: 7, queueRatePerSekunde: 0.5 };
    mockLage.dauer = gemessen(60);

    expect(await _aktuelleEinlassgrenze()).toBe(168);
  });
});

describe("Wartezeit-Ansage: rechnet mit derselben kleineren Zahl", () => {
  test.each([
    /* Dauer, Position, Ansage in Sekunden */
    [45, 128, 1440 /* Parallelitaet bremst: 32 Runden × 45 s */],
    [25, 144, 1440 /* Rate bremst: 144 / 0,1 je Sekunde — vorher 900 */],
    [25, 10, 100 /* Rate: 10 / 0,1 — vorher 75 */],
    [40, 4, 40 /* beide gleich: eine Runde */],
  ])("Dauer %i s, Position %i → %i s", async (sekunden, position, ansage) => {
    mockLage.dauer = gemessen(sekunden);

    expect(await _etaForPosition(position)).toBe(ansage);
  });

  test("wer als Letzter eingelassen wird, bekommt nie mehr als 30 Minuten angesagt", async () => {
    for (const sekunden of [10, 20, 25, 30, 35, 40, 45, 60, 110]) {
      mockLage.dauer = gemessen(sekunden);
      const grenze = await _aktuelleEinlassgrenze();

      expect(await _etaForPosition(grenze)).toBeLessThanOrEqual(HALBE_STUNDE);
    }
  });

  test("Position 0 (als Naechstes dran) → 0 Sekunden", async () => {
    expect(await _etaForPosition(0)).toBe(0);
  });

  test("bremst die Parallelitaet, bleibt die Ansage die bisherige", async () => {
    mockLage.werte = { ...T1_NORMAL, parallelitaet: 7, queueRatePerSekunde: 0.5 };
    mockLage.dauer = gemessen(65);

    /* 10 Wartende, 7 gleichzeitig: zwei Runden zu 65 s. */
    expect(await _etaForPosition(10)).toBe(130);
  });
});
