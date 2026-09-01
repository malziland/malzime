/**
 * mistral-http.test.js — die zwei Entscheidungen, die vor jedem Aufruf stehen.
 *
 * BEFUND 01.09.2026 (Runde 7, L-16): mistral-http.js hatte keine eigene
 * Testdatei. Fuenf andere Dateien beruehren sie mittelbar; die beiden
 * Funktionen hier entscheiden aber allein, ob ein Fehlschlag als Ueberlastung
 * gilt und ob ein Aufruf ohne Einstellungssatz ueberhaupt losgeht.
 *
 * `isRateLimitError` ist die Schwester von `isQuotaError` aus job-helfer.js —
 * dieselbe Frage, andere Ebene. Sie entscheidet, ob der Client ein
 * blocked.overloaded sieht und selbst neu versucht, oder einen harten Fehler.
 */

const { isRateLimitError } = require("../mistral-http");

describe("isRateLimitError", () => {
  test("die eigene Drossel zaehlt als Ueberlastung", () => {
    /* throttle.js laeuft auf, bevor Mistral ueberhaupt gefragt wird. Aus Sicht
       der Pipeline ist das derselbe Zustand — der Client soll neu versuchen,
       nicht abbrechen. */
    expect(isRateLimitError({ code: "throttle_timeout" })).toBe(true);
  });

  test("der HTTP-Status 429 zaehlt", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  test.each([
    ["Rate limit exceeded", "Wortlaut des Anbieters"],
    ["RATE_LIMITED", "Grossschreibung"],
    ["Request failed with status code 429", "Zahl in der Nachricht"],
  ])("erkennt %s (%s)", (nachricht) => {
    expect(isRateLimitError({ message: nachricht })).toBe(true);
  });

  test.each([
    [{ status: 500 }, "Serverfehler"],
    [{ status: 400 }, "fehlerhafte Anfrage"],
    [{ code: "ECONNRESET" }, "Netzabbruch"],
    [{ message: "timeout of 300000ms exceeded" }, "Zeitgrenze"],
  ])("%p ist keine Ueberlastung (%s)", (fehler) => {
    expect(isRateLimitError(fehler)).toBe(false);
  });

  test.each([
    [null, "kein Fehlerobjekt"],
    [undefined, "undefined"],
    [{}, "leeres Objekt"],
  ])("faellt bei %p nicht um (%s)", (eingabe) => {
    expect(isRateLimitError(eingabe)).toBe(false);
  });
});

describe("betriebswerteOderAbbruch", () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("ohne Einstellungssatz bricht der Aufruf mit config_missing ab", async () => {
    /* Der Code ist die Verabredung mit dem Aufrufer: handle-process-job
       unterscheidet daran einen Konfigurationsmangel von einem Fehlschlag der
       Analyse. Ohne ihn wuerde ein fehlender Satz als Modellfehler gezaehlt —
       und der Job als "nicht analysierbar" verworfen statt wiederholt. */
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: null, profil: null, grund: "kein-dokument" }),
    }));
    const { betriebswerteOderAbbruch: fn } = require("../mistral-http");

    await expect(fn()).rejects.toMatchObject({ code: "config_missing" });
  });

  test("der Grund steht in der Meldung, statt verschluckt zu werden", async () => {
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: null, profil: null, grund: "ungueltiges-feld:parallelitaet" }),
    }));
    const { betriebswerteOderAbbruch: fn } = require("../mistral-http");

    await expect(fn()).rejects.toThrow(/ungueltiges-feld:parallelitaet/);
  });

  test("mit Satz kommen Werte und Profil zurueck", async () => {
    jest.resetModules();
    const SATZ = require("../test-satz").SATZ;
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: SATZ, profil: "t1-single-large", grund: null }),
    }));
    const { betriebswerteOderAbbruch: fn } = require("../mistral-http");

    await expect(fn()).resolves.toEqual({ werte: SATZ, profil: "t1-single-large" });
  });

  test("ein fehlendes Profil wird zu null, nicht zu undefined", async () => {
    /* Der Unterschied ist nicht kosmetisch: undefined faellt in JSON.stringify
       aus dem Protokoll heraus — dann fehlt in der Logzeile genau die Angabe,
       nach der man im Vorfall sucht. */
    jest.resetModules();
    const SATZ = require("../test-satz").SATZ;
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: SATZ, grund: null }),
    }));
    const { betriebswerteOderAbbruch: fn } = require("../mistral-http");

    await expect(fn()).resolves.toMatchObject({ profil: null });
  });
});
