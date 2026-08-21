/* BUG-2026-08-20-02: Der Melder fuer den Druck-Abbruch-Fehler lieferte eine
   inhaltsleere Meldung — String statt Error, Kontextfelder ausserhalb der festen
   Feldliste des Loggers. Diese Tests messen die WIRKUNG: Sie schicken die Meldung
   durch den echten `logClientError` und sehen im abgeschickten Rumpf nach, ob die
   Messwerte tatsaechlich ankommen. Ein Test, der nur den Aufruf zaehlt, haette den
   Fehler nicht gesehen — genau deshalb blieb er unbemerkt. */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { pruefeSeiteNachDruck } from "../js/druck-wache.js";
import { logClientError } from "../js/error-logger.js";

function baueSeite({ hoehe, display = "block", visibility = "visible", modus = "boost" }) {
  document.documentElement.setAttribute("data-mode", modus);
  document.documentElement.setAttribute("data-theme", "dark");
  document.body.innerHTML = '<section id="resultsPanel"></section>';
  const panel = document.getElementById("resultsPanel");
  panel.getBoundingClientRect = () => ({ height: hoehe, width: 300, top: 0, left: 0, bottom: hoehe, right: 300 });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({ display, visibility, opacity: "1" });
  return panel;
}

describe("Druck-Wache meldet die leere Seite mit ihren Messwerten", () => {
  let gesendet;

  beforeEach(() => {
    gesendet = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, optionen) => {
        gesendet.push(JSON.parse(optionen.body));
        return Promise.resolve({ ok: true, status: 204 });
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  test("unsichtbarer Ergebnisbereich: die Messwerte stehen im abgeschickten Rumpf", () => {
    baueSeite({ hoehe: 0 });

    const gemeldet = pruefeSeiteNachDruck(logClientError);

    expect(gemeldet).toBe(true);
    expect(gesendet).toHaveLength(1);
    const rumpf = gesendet[0];

    /* Der Kern des Befunds: Ohne den Fix waere errorName "Error", errorMessage
       leer und phase "unknown" — die Meldung also nicht zuordenbar und ohne
       jede Angabe. */
    expect(rumpf.phase).toBe("druck-abbruch-seite-leer");
    expect(rumpf.errorName).toBe("DruckAbbruchLeereSeite");
    expect(rumpf.errorMessage).toContain("hoehe=0");
    expect(rumpf.errorMessage).toContain("display=block");
    expect(rumpf.errorMessage).toContain("modus=boost");
    expect(rumpf.errorMessage).toContain("thema=dark");
    expect(rumpf.errorMessage).toContain("druckhinweise=0");
    expect(rumpf.errorDetail).toContain("h=0");
  });

  test("Meldung bleibt innerhalb der serverseitigen Laengengrenzen", () => {
    baueSeite({ hoehe: 0, display: "none" });

    pruefeSeiteNachDruck(logClientError);

    const rumpf = gesendet[0];
    /* handle-errors.js: phase 50, errorDetail 60, errorMessage 500 Zeichen.
       Was darueber liegt, schneidet der Server ab — dann fehlen genau die
       Angaben, um derentwillen die Wache gebaut wurde. */
    expect(rumpf.phase.length).toBeLessThanOrEqual(50);
    expect(rumpf.errorDetail.length).toBeLessThanOrEqual(60);
    expect(rumpf.errorMessage.length).toBeLessThanOrEqual(500);
  });

  test("sichtbarer Ergebnisbereich: keine Meldung", () => {
    baueSeite({ hoehe: 600 });

    const gemeldet = pruefeSeiteNachDruck(logClientError);

    expect(gemeldet).toBe(false);
    expect(gesendet).toHaveLength(0);
  });

  test("fehlender Ergebnisbereich: keine Meldung, kein Fehler", () => {
    document.body.innerHTML = "";

    expect(() => pruefeSeiteNachDruck(logClientError)).not.toThrow();
    expect(gesendet).toHaveLength(0);
  });
});
