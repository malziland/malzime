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

/* Zentral aus ../test-satz, mit der jeweils zu pruefenden Parallelitaet. */
const SATZ = (parallel) => ({ ...require("../test-satz").SATZ, parallelitaet: parallel });

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

  /* UMGESCHRIEBEN AM 30.08.2026 — das Verhalten hat sich geaendert, und zwar
     zum Strengeren.

     FRUEHER: Ohne Einstellungssatz griff die Konstante MAX_QUEUE_DEPTH (155).
     Die Begruendung dafuer klang plausibel ("eine Schutzgrenze darf nie
     fehlen") und war trotzdem falsch: Sie liess 155 Leute herein, deren
     Auftraege anschliessend ALLE scheitern — weil ohne Satz gar keine Analyse
     laufen kann. Das ist die unfreundlichste Variante: erst warten lassen,
     dann fehlschlagen.

     HEUTE: Ohne Satz ist die ehrliche Einlassgrenze null. Wer kommt, bekommt
     sofort eine klare Absage statt eines Platzes in einer Schlange, die nie
     abgearbeitet wird. */
  test("ohne Einstellungssatz wird niemand eingelassen — sofortige Absage", async () => {
    zustand.werte = null;
    expect(await _aktuelleEinlassgrenze()).toBe(0);
  });

  test("ohne gemessene Dauer gilt die Tiefe aus dem Einstellungssatz", async () => {
    zustand.werte = SATZ(7);
    zustand.dauer = { sekunden: 65, gemessen: false };
    /* Nicht mehr die Code-Konstante, sondern der Wert aus dem Satz — sonst
       waere die Einlassgrenze das einzige, was eine Umstellung ignoriert. */
    expect(await _aktuelleEinlassgrenze()).toBe(SATZ(7).warteschlangeTiefe);
    zustand.dauer = { sekunden: 60, gemessen: true };
  });

  test("unsinnige Parallelitaet fuehrt nicht zu unsinniger Grenze", async () => {
    /* Ein solcher Satz wird schon beim Laden abgelehnt (parallelitaet min 1) —
       hier der zweite Riegel, falls er es doch bis hierher schafft. Erwartet
       wird die kleinstmoegliche Grenze, nicht eine erfundene Zahl. */
    zustand.werte = { ...SATZ(7), parallelitaet: 0 };
    expect(await _aktuelleEinlassgrenze()).toBe(1);
  });
});
