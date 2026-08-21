/* Wächter für zwei Fehlerpfade, die bis 2026-08-21 stumm blieben:
   - BUG-2026-08-20-16: Eine Überlastungs-Antwort (429) galt als endgültige
     Ablehnung; die Meldung wurde verworfen statt aufgehoben — ausgerechnet im
     Massenfehler-Fall, für den die Erfassung gebaut wurde.
   - BUG-2026-08-20-21: Der Zweig „in diesem Browser nicht möglich" der
     Echtheits-Prüfung warf einen ReferenceError, statt die ehrliche Meldung zu
     setzen: Der Knopf blieb mit unverändertem Text zurück und wirkte kaputt. */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("Fehlermeldungen überleben eine Überlastung", () => {
  let gesendet;

  beforeEach(() => {
    vi.resetModules();
    gesendet = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /* Die Warteschlange liegt bewusst NUR im Arbeitsspeicher — kein
     sessionStorage, kein localStorage (Datenschutz-Zusage). Gemessen wird sie
     deshalb ueber die dafuer vorgesehene Auskunft des Moduls. */
  async function meldeMit(status) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        gesendet += 1;
        return Promise.resolve({ ok: status < 400, status });
      })
    );
    const modul = await import("../js/error-logger.js");
    modul.logClientError(new Error("probe"), { phase: "probe" });
    await new Promise((f) => setTimeout(f, 0));
    return modul.offeneMeldungen().length;
  }

  test("429 wird aufgehoben statt verworfen", async () => {
    const offen = await meldeMit(429);
    expect(gesendet).toBe(1);
    /* Aufgehoben heisst: Die Meldung wartet auf den naechsten Versuch. Vorher
       fiel sie hier lautlos weg — im Massenfehler-Fall also alle. */
    expect(offen).toBe(1);
  });

  test("400 wird endgueltig verworfen (der Server will diese Meldung nicht)", async () => {
    const offen = await meldeMit(400);
    expect(gesendet).toBe(1);
    expect(offen).toBe(0);
  });

  test("503 wird aufgehoben", async () => {
    expect(await meldeMit(503)).toBe(1);
  });
});

describe("Echtheits-Prüfung ohne SubtleCrypto", () => {
  test("der Knopf sagt ehrlich, dass es nicht geht — ohne Programmfehler", async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <button id="echtheitKnopf">Jetzt hier prüfen</button>
      <div id="echtheitKonsole"></div><div id="echtheitZeilen"></div><div id="echtheitErgebnis"></div>`;
    const echtesCrypto = window.crypto;
    Object.defineProperty(window, "crypto", { value: {}, configurable: true });

    const { initEchtheitspruefung } = await import("../js/echtheit-pruefen.js");
    expect(() => initEchtheitspruefung()).not.toThrow();

    const knopf = document.getElementById("echtheitKnopf");
    expect(knopf.disabled).toBe(true);
    expect(knopf.textContent).not.toBe("Jetzt hier prüfen");
    expect(knopf.textContent.length).toBeGreaterThan(5);

    Object.defineProperty(window, "crypto", { value: echtesCrypto, configurable: true });
    document.body.innerHTML = "";
  });
});
