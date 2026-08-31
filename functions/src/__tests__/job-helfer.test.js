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
