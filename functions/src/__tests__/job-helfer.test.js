/* job-helfer.test.js — die vier Fail-safe-Entscheidungen.
 *
 * ANLASS (Pruefschleife, 31.08.2026): job-helfer.js hatte keine eigene
 * Testdatei. Eine Mutationsprobe zeigte, wo das wirklich weh tut: Wer
 * `isBeastAdsCallEnabledSafe` durch `return null` ersetzt, bekommt alle 1206
 * Tests gruen — die Funktion ist von nichts gedeckt.
 *
 * Sie ist die einzige der vier, die im Fehlerfall auf `true` faellt. Das ist
 * Absicht: Die Beast-Werbung gehoert zum Lerninhalt, ihr Ausfall waere ein
 * stiller Qualitaetsverlust im Workshop. Die anderen drei fallen auf `false`,
 * weil ein ausgefallener Schalter dort nur Kosten oder Tempo betrifft.
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

  test("die anderen drei fallen auf false", async () => {
    const spy = stumm();
    jest.resetModules();
    jest.doMock("../feature-flags", () => ({
      isSingleLargeCallEnabled: async () => {
        throw new Error("x");
      },
      isPromptCacheEnabled: async () => {
        throw new Error("x");
      },
      isLiveTextEnabled: async () => {
        throw new Error("x");
      },
    }));
    const frisch = require("../job-helfer");
    const werte = await Promise.all([
      frisch.isSingleLargeCallEnabledSafe(),
      frisch.isPromptCacheEnabledSafe(),
      frisch.isLiveTextEnabledSafe(),
    ]);
    spy.mockRestore();
    expect(werte).toEqual([false, false, false]);
  });

  test("ohne Fehler kommt der echte Wert durch", async () => {
    jest.resetModules();
    jest.doMock("../feature-flags", () => ({
      isBeastAdsCallEnabled: async () => false,
      isLiveTextEnabled: async () => true,
    }));
    const frisch = require("../job-helfer");
    expect(await frisch.isBeastAdsCallEnabledSafe()).toBe(false);
    expect(await frisch.isLiveTextEnabledSafe()).toBe(true);
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
});
