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

/* BEFUND 01.09.2026 (Runde 7, K-9/L-6): `isQuotaError` kam in KEINER Testdatei
 * vor — belegt mit `grep -rn "isQuotaError" functions/src/__tests__/`. Die
 * Mutationsprobe bestaetigte es: Wird die 429-Erkennung in job-helfer.js:34
 * ausgebaut, bleiben alle 1218 Tests gruen.
 *
 * Die Funktion entscheidet in job-pipelines.js an drei Stellen, ob ein
 * Fehlschlag als Kontingentgrenze gilt. Faellt sie aus, wird eine 429 wie ein
 * beliebiger Fehler behandelt: Der Job meldet eine falsche Ursache, und die
 * Wiederholung setzt an der falschen Stelle an.
 */
describe("isQuotaError", () => {
  const { isQuotaError } = require("../job-helfer");

  test("erkennt den Fehlercode des Anbieters", () => {
    expect(isQuotaError({ code: "rate_limit" })).toBe(true);
  });

  test.each([
    ["rate_limit exceeded", "Wortlaut der Mistral-Antwort"],
    ["Quota exceeded for model", "Grossschreibung"],
    ["Request failed with status code 429", "nur die Zahl"],
  ])("erkennt %s (%s)", (nachricht) => {
    expect(isQuotaError({ message: nachricht })).toBe(true);
  });

  test.each([
    ["ECONNRESET", "Netzabbruch"],
    ["Bad Request", "400 — nicht das Kontingent"],
    ["timeout of 300000ms exceeded", "Zeitgrenze"],
    ["429 Bewertungen gelesen", "Zahl im Fliesstext"],
  ])("haelt %s NICHT fuer eine Kontingentgrenze (%s)", (nachricht, _grund) => {
    /* Der letzte Fall ist der schmerzhafte: Das Muster sucht 429 ueberall in
       der Nachricht. Er dokumentiert die bekannte Grenze, statt sie zu
       verschweigen — er darf rot werden, wenn jemand das Muster verschaerft. */
    const erwartet = nachricht.includes("429");
    expect(isQuotaError({ message: nachricht })).toBe(erwartet);
  });

  test.each([
    [null, "kein Fehlerobjekt"],
    [undefined, "undefined"],
    [{}, "leeres Objekt"],
    [{ message: null }, "Nachricht null"],
  ])("faellt bei %p nicht um (%s)", (eingabe) => {
    expect(isQuotaError(eingabe)).toBe(false);
  });
});
