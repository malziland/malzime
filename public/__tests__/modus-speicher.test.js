import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { merkeModus, gemerkterModus, vergissModus } from "../js/modus-speicher.js";

/* Merken der Modus-Wahl über ein Neuladen hinweg (aufgefallen 2026-08-11).

   ANLASS: Im Beast Mode neu laden landete wieder im seriösen Modus. Die alte
   Regel lautete „Beast startet immer ausgeschaltet" und ist präzisiert —
   die Präzisierung ist der ganze Kern dieser Datei:

     „Beast startet immer ausgeschaltet — das stimmt, aber ein Reload ist
      kein Start."

   Deshalb sessionStorage und nicht localStorage: Neuladen und Tab-Wechsel
   behalten die Wahl, das Schliessen des Tabs verwirft sie. Im Workshop startet
   damit jede neue Person wieder seriös. */

describe("Modus-Speicher", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("ohne gemerkte Wahl kommt null zurück — nicht false", () => {
    /* Der Unterschied ist tragend: `false` hiesse „bewusst seriös gewählt" und
       würde eine vom Browser wiederhergestellte Checkbox überschreiben. */
    expect(gemerkterModus()).toBeNull();
  });

  it("gemerkter Beast Mode kommt als true zurück", () => {
    merkeModus(true);
    expect(gemerkterModus()).toBe(true);
  });

  it("gemerkter seriöser Modus kommt als false zurück", () => {
    merkeModus(false);
    expect(gemerkterModus()).toBe(false);
  });

  it('vergissModus setzt auf "nie gewählt" zurück', () => {
    merkeModus(true);
    vergissModus();
    expect(gemerkterModus()).toBeNull();
  });

  it("die Wahl liegt in sessionStorage, NICHT in localStorage", () => {
    /* Das ist die eigentliche Zusage: Sie endet mit dem Tab. Läge sie in
       localStorage, würde ein weitergereichtes Gerät im Beast Mode starten —
       genau der didaktische Einstieg ginge verloren. */
    merkeModus(true);
    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });

  it("ein defekter Speicher legt nichts lahm (privater Modus)", () => {
    /* Safari im privaten Modus kann bei setItem werfen. Die Umschaltung selbst
       darf daran nicht scheitern — sie funktioniert dann eben ohne Gedächtnis. */
    const setzen = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const lesen = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => merkeModus(true)).not.toThrow();
    expect(gemerkterModus()).toBeNull();

    setzen.mockRestore();
    lesen.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
