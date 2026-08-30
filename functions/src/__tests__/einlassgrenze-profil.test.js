/**
 * einlassgrenze-profil.test.js — Wirkt die Parallelitaet aus dem
 * Einstellungssatz bis in die Einlasskontrolle?
 *
 * BEFUND ARCH-2026-08-30-01 (Kurz-Audit vom 30.08.2026): Die Einlassgrenze
 * rechnete mit dem Wert aus dem Code, obwohl der Einstellungssatz einen
 * eigenen traegt. Wer auf einen groesseren Tarif umstellte, sah im
 * Zahlen-Endpunkt "quelle: firestore" und hielt alles fuer umgestellt — die
 * Seite liess aber weiter so viele Leute ein wie zuvor.
 *
 * Unentdeckbar ohne diesen Test: Es faellt erst im Workshop unter Last auf,
 * und kein Signal meldet es.
 */

const zustand = { dauer: { sekunden: 60, gemessen: true }, werte: null, flags: { useGemesseneDauer: true } };

jest.mock("../durchsatz", () => ({ dauerJeAnalyse: async () => zustand.dauer }));
jest.mock("../feature-flags", () => ({ getFeatureFlags: async () => zustand.flags }));
jest.mock("../betriebsprofil", () => ({ geltendeWerte: async () => ({ werte: zustand.werte }) }));

const { _aktuelleEinlassgrenze } = require("../handle-enqueue");
const { MAX_QUEUE_DEPTH } = require("../config");

const SATZ = (parallel) => ({
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  requestBudgetMs: 480000,
  describeMaxTokens: 2048,
  profileMaxTokens: 16000,
  parallelitaet: parallel,
  stundenlimit: 500,
  adressLimit: 500,
});

describe("Einlassgrenze folgt dem Einstellungssatz", () => {
  test("groessere Parallelitaet laesst mehr Wartende ein", async () => {
    /* (Rueckbauprobe: Mit QUEUE_DISPATCH_CONCURRENCY aus config.js sind beide
       Werte gleich -> ROT.) */
    zustand.werte = SATZ(7);
    const bei7 = await _aktuelleEinlassgrenze();
    zustand.werte = SATZ(14);
    const bei14 = await _aktuelleEinlassgrenze();

    expect(bei14).toBeGreaterThan(bei7);
    expect(bei14).toBe(bei7 * 2);
  });

  test("die Rechnung stimmt: Dauer x Parallelitaet x Sicherheitsabschlag", async () => {
    zustand.dauer = { sekunden: 60, gemessen: true };
    zustand.werte = SATZ(7);
    /* 30 min / 60 s = 30 Durchlaeufe, mal 7 parallel, mal 0,8 Abschlag = 168 */
    expect(await _aktuelleEinlassgrenze()).toBe(168);
  });

  test("SCHUTZGRENZE: ohne Einstellungssatz gilt die Konstante, nicht unbegrenzt", async () => {
    /* Die Einlassgrenze darf NIE fehlen — sonst liesse die Seite beliebig
       viele Leute herein. Anders als bei den Zeitgrenzen ist der Rueckfall
       hier richtig. */
    zustand.werte = null;
    expect(await _aktuelleEinlassgrenze()).toBe(MAX_QUEUE_DEPTH);
  });

  test("ohne gemessene Dauer gilt ebenfalls die Konstante", async () => {
    zustand.werte = SATZ(7);
    zustand.dauer = { sekunden: 65, gemessen: false };
    expect(await _aktuelleEinlassgrenze()).toBe(MAX_QUEUE_DEPTH);
    zustand.dauer = { sekunden: 60, gemessen: true };
  });

  test("unsinnige Parallelitaet im Satz fuehrt nicht zu unsinniger Grenze", async () => {
    /* Ein Satz mit 99999 wird zwar schon beim Laden abgelehnt — hier der
       zweite Riegel, falls er es doch bis hierher schafft. */
    zustand.werte = { ...SATZ(7), parallelitaet: 0 };
    expect(await _aktuelleEinlassgrenze()).toBe(MAX_QUEUE_DEPTH);
  });
});
