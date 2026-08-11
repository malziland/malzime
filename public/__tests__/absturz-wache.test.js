import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Absturz-Wache (2026-08-11).

   ANLASS: Safaris Meldung „Auf https://malzi.me/ ist wiederholt ein Problem
   aufgetreten" auf einem iPhone. Sechs Ursachen wurden geprüft und
   ausgeschlossen — das Ereignis selbst ist unsichtbar, weil beim Auftreten
   kein eigener Code mehr läuft und deshalb auch keine Meldung ankommt.

   Diese Prüfungen halten beide Aufgaben der Wache fest: melden UND die
   Schleife brechen. Und ebenso wichtig: dass sie im Normalbetrieb SCHWEIGT.
   Eine Wache, die bei jedem zweiten Neuladen anschlägt, wird ignoriert und
   ist damit wertlos. */

const meldungen = [];
vi.mock("../js/error-logger.js", () => ({
  logClientError: (fehler, kontext) => meldungen.push({ fehler, kontext }),
}));

const { initAbsturzWache, merkePhase } = await import("../js/absturz-wache.js");

describe("Absturz-Wache", () => {
  let jetzt;

  beforeEach(() => {
    sessionStorage.clear();
    meldungen.length = 0;
    jetzt = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => jetzt);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schweigt beim ersten Start", () => {
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(0);
  });

  it("schweigt auch beim zweiten Start — einmal neu laden ist normal", () => {
    initAbsturzWache({});
    jetzt += 3000;
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(0);
  });

  it("schlägt beim dritten Start innerhalb einer Minute an", () => {
    initAbsturzWache({});
    jetzt += 3000;
    initAbsturzWache({});
    jetzt += 3000;
    expect(initAbsturzWache({})).toBe(true);
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0].kontext.phase).toBe("absturz-schleife");
  });

  it("verwirft den gemerkten Auftrag, um die Schleife zu brechen", () => {
    const verwirfAuftrag = vi.fn();
    initAbsturzWache({ verwirfAuftrag });
    jetzt += 3000;
    initAbsturzWache({ verwirfAuftrag });
    jetzt += 3000;
    initAbsturzWache({ verwirfAuftrag });
    expect(verwirfAuftrag).toHaveBeenCalledTimes(1);
  });

  it("meldet die zuletzt erreichte Phase mit", () => {
    initAbsturzWache({});
    merkePhase("i18n");
    jetzt += 2000;
    initAbsturzWache({});
    jetzt += 2000;
    initAbsturzWache({});
    expect(meldungen[0].kontext.errorDetail).toContain("letztePhase=i18n");
  });

  it("meldet, ob ein Auftrag offen war — die wichtigste Spur", () => {
    sessionStorage.setItem("malzime.queueJobId", "job-123");
    initAbsturzWache({});
    jetzt += 2000;
    initAbsturzWache({});
    jetzt += 2000;
    initAbsturzWache({});
    expect(meldungen[0].kontext.errorDetail).toContain("offenerAuftrag=true");
  });

  it("meldet nur EINMAL, nicht bei jedem weiteren Start", () => {
    for (let i = 0; i < 3; i++) {
      initAbsturzWache({});
      jetzt += 2000;
    }
    expect(meldungen).toHaveLength(1);
    /* Der Zähler ist zurückgesetzt — der nächste Start beginnt bei null. */
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(1);
  });

  it("zählt Starts nicht mit, die länger als eine Minute her sind", () => {
    initAbsturzWache({});
    jetzt += 30_000;
    initAbsturzWache({});
    /* Der erste Start faellt jetzt aus dem Fenster. */
    jetzt += 40_000;
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(0);
  });

  it("ein defekter Speicher legt den Seitenstart nicht lahm", () => {
    const lesen = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const schreiben = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => initAbsturzWache({})).not.toThrow();
    expect(initAbsturzWache({})).toBe(false);

    lesen.mockRestore();
    schreiben.mockRestore();
  });

  it("ein Fehler beim Aufräumen verhindert die Meldung nicht", () => {
    /* Sonst wäre der Fall, in dem die Selbstheilung scheitert, genau der Fall,
       über den wir nichts erfahren. */
    const verwirfAuftrag = vi.fn(() => {
      throw new Error("kaputt");
    });
    initAbsturzWache({ verwirfAuftrag });
    jetzt += 2000;
    initAbsturzWache({ verwirfAuftrag });
    jetzt += 2000;
    expect(() => initAbsturzWache({ verwirfAuftrag })).not.toThrow();
    expect(meldungen).toHaveLength(1);
  });
});
