/* job-helfer.test.js — die Fail-safe-Entscheidung des Werbe-Aufrufs.
 *
 * ANLASS (Pruefschleife, 31.08.2026): job-helfer.js hatte keine eigene
 * Testdatei. Eine Mutationsprobe zeigte, wo das wirklich weh tut: Wer
 * `isBeastAdsCallEnabledSafe` durch `return null` ersetzt, bekommt alle 1206
 * Tests gruen — die Funktion ist von nichts gedeckt.
 *
 * Sie faellt im Fehlerfall auf `true`. Das ist Absicht: Die Beast-Werbung
 * gehoert zum Lerninhalt, ihr Ausfall waere ein stiller Qualitaetsverlust im
 * Workshop. (Die frueheren Schalter fuer Prompt-Cache und Live-Text sind seit
 * 10.09.2026 fest eingebaut — ihre Safe-Varianten gibt es nicht mehr.)
 *
 * Genau diese Asymmetrie haelt diese Datei fest — sie ist eine Entscheidung,
 * keine Zufaelligkeit, und soll nicht unbemerkt umkippen.
 */

describe("job-helfer — was gilt, wenn ein Schalter nicht lesbar ist", () => {
  const stumm = () => jest.spyOn(console, "log").mockImplementation(() => {});

  test("isBeastAdsCallEnabledSafe faellt auf true", async () => {
    const spy = stumm();
    jest.resetModules();
    jest.doMock("../feature-flags", () => ({
      isBeastAdsCallEnabled: async () => {
        throw new Error("Flag nicht lesbar");
      },
    }));
    const frisch = require("../job-helfer");
    const ergebnis = await frisch.isBeastAdsCallEnabledSafe();
    spy.mockRestore();
    expect(ergebnis).toBe(true);
  });

  test("ohne Fehler kommt der echte Wert durch", async () => {
    jest.resetModules();
    jest.doMock("../feature-flags", () => ({
      isBeastAdsCallEnabled: async () => false,
    }));
    const frisch = require("../job-helfer");
    expect(await frisch.isBeastAdsCallEnabledSafe()).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   OPS-2026-09-01 (Runde 6, G-11) — hasCategories.

   Mutationsprobe: `Object.keys(...).length > 0` auf `>= 0` gesetzt -> alle
   1211 Tests blieben gruen. Die Funktion entscheidet in job-pipelines.js, ob
   der ausfalltolerante Beast-Werbe-Zweitaufruf noch noetig ist. Faellt sie
   immer auf "vorhanden", entfaellt er stillschweigend; faellt sie immer auf
   "leer", kostet jede Analyse einen ueberfluessigen KI-Aufruf.
   ══════════════════════════════════════════════════════════════════════ */
describe("OPS-2026-09-01 — hasCategories unterscheidet leer von gefuellt", () => {
  const { hasCategories } = require("../job-helfer");

  test("ein Profil mit Kategorien gilt als vorhanden", () => {
    expect(hasCategories({ categories: { interessen: ["Fussball"] } })).toBe(true);
  });

  test("ein LEERES Kategorien-Objekt gilt als nicht vorhanden", () => {
    /* Genau hier stirbt die Mutation `>= 0`. */
    expect(hasCategories({ categories: {} })).toBe(false);
  });

  test("fehlende Kategorien und leere Eingaben gelten als nicht vorhanden", () => {
    expect(hasCategories({})).toBeFalsy();
    expect(hasCategories(null)).toBeFalsy();
    expect(hasCategories(undefined)).toBeFalsy();
  });

  test("Karten, die kein Objekt sind, gelten als nicht vorhanden (BUG-2026-10-03-03)", () => {
    expect(hasCategories({ categories: "Du bist X. Beleg Y." })).toBeFalsy();
  });
});

/* Ob ein Fehlschlag "Ueberlast" ist, entscheidet seit BUG-2026-10-03-34 EINE
 * Funktion fuer alle Stellen: `istUeberlast` in ueberlast.js, geprueft in
 * ueberlast-entscheidung.test.js (an der Funktion und an der echten Kette).
 * Die fruehere eigene Entscheidung hier (`isQuotaError`, Textsuche nach
 * "rate_limit", "quota" und "429") gibt es nicht mehr — dieser Test haelt
 * fest, dass sie nicht unbemerkt zurueckkommt.
 */
describe("Ueberlast-Entscheidung liegt nicht mehr in job-helfer.js", () => {
  test("isQuotaError ist nicht mehr exportiert", () => {
    expect(require("../job-helfer").isQuotaError).toBeUndefined();
  });
});
