/**
 * error-logger-puffer.test.js — Fehlermeldungen gehen nicht mehr verloren
 * (v3.3.1, BUG-2026-08-17-04).
 *
 * Die Zusage lautet: alle Fehler abfangen, speichern und melden. Sie war an
 * einer Stelle gebrochen, die harmlos aussah — eine misslungene Meldung wurde
 * still verschluckt. Das traf ausgerechnet die haeufigste Fehlerklasse: Eine
 * Meldung ueber eine abgerissene Verbindung braucht dieselbe Verbindung.
 *
 * Belegt an echten Daten: 2 Client-Fehler in 30 Tagen, obwohl im selben
 * Zeitraum mehrere Fehler gemeldet wurden.
 *
 * ZWEITE ZUSAGE, die hier mitgeprueft wird: Die Warteschlange liegt
 * ausschliesslich im Arbeitsspeicher. Die Datenschutzerklaerung zaehlt
 * abschliessend auf, was im Browser abgelegt wird — diese Funktion legt dort
 * NICHTS ab. Der letzte Test unten wird rot, wenn das jemand aendert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../js/client-context.js", () => ({
  collectClientContext: () => ({ screen: "small" }),
  coarseUserAgent: () => "Safari 26 / iOS",
  generateTraceId: () => "trace-test",
}));

describe("Fehler-Nachsendung", () => {
  let logClientError, fehlerNachschicken, initFehlerNachsendung, offeneMeldungen;

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    vi.resetModules();
    ({ logClientError, fehlerNachschicken, initFehlerNachsendung, offeneMeldungen } =
      await import("../js/error-logger.js"));
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stellt eine Meldung zurueck, wenn das Senden scheitert", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));

    logClientError(new Error("queue_failed"), { phase: "queue-poll" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    expect(offeneMeldungen()[0].errorMessage).toBe("queue_failed");
    expect(offeneMeldungen()[0].phase).toBe("queue-poll");
  });

  it("sendet gar nicht erst, wenn das Geraet offline ist — direkt in die Warteschlange", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true, writable: true });
    const f = vi.spyOn(globalThis, "fetch");

    logClientError(new Error("offline_fall"), { phase: "queue-network" });

    expect(f).not.toHaveBeenCalled();
    expect(offeneMeldungen()).toHaveLength(1);
  });

  it("schickt Zurueckgestelltes beim naechsten Anlauf nach", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));
    logClientError(new Error("erster"), { phase: "queue-poll" });
    logClientError(new Error("zweiter"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(2));

    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 204 });
    /* Derselbe Spion wie oben — sonst zaehlten die zwei gescheiterten
       Erstversuche mit und der Test misste etwas anderes, als er behauptet. */
    f.mockClear();
    const zugestellt = await fehlerNachschicken();

    expect(zugestellt).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(offeneMeldungen()).toHaveLength(0);
  });

  it("das Ereignis 'wieder online' loest die Nachsendung aus", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));
    logClientError(new Error("haengt"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    initFehlerNachsendung();
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 204 });

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(0));

    expect(f).toHaveBeenCalled();
  });

  it("beim Verlassen der Seite wird ein letzter Versuch unternommen", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));
    logClientError(new Error("letzter_versuch"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    initFehlerNachsendung();
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 204 });

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(0));

    expect(f).toHaveBeenCalled();
  });

  it("ein misslungener Nachsendeversuch verliert die Meldung nicht", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));
    logClientError(new Error("bleibt"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    /* Zweiter Anlauf, wieder kein Netz — die Warteschlange darf jetzt nicht
       leer sein. Genau hier lag die Falle: Wer sie vor dem Senden leert und
       den Fehlschlag nicht zuruecklegt, verliert die Meldung beim
       Rettungsversuch. */
    const zugestellt = await fehlerNachschicken();

    expect(zugestellt).toBe(0);
    expect(offeneMeldungen()).toHaveLength(1);
    expect(offeneMeldungen()[0].errorMessage).toBe("bleibt");
  });

  it("ein 4xx wird NICHT erneut versucht — der Server will diese Meldung nicht", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 400 });

    logClientError(new Error("unbrauchbar"), { phase: "queue-poll" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(0));
  });

  it("ein 5xx wird aufgehoben — das ist voruebergehend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 });

    logClientError(new Error("serverproblem"), { phase: "queue-poll" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));
  });

  it("die Warteschlange waechst nicht endlos", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));

    for (let i = 0; i < 25; i++) logClientError(new Error(`fehler-${i}`), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen().length).toBeGreaterThan(0));

    const liste = offeneMeldungen();
    expect(liste.length).toBeLessThanOrEqual(10);
    /* Die juengsten ueberleben — sie passen zum aktuellen Zustand. */
    expect(liste[liste.length - 1].errorMessage).toBe("fehler-24");
  });

  it("DATENSCHUTZ: die Fehlererfassung legt NICHTS im Browser ab", async () => {
    /* Die Datenschutzerklaerung zaehlt abschliessend auf, was in sessionStorage
       und localStorage liegt. Diese Funktion darf diese Liste nicht erweitern —
       der Rechtstext ist die Vorgabe, nicht der Code. Ein erster Entwurf legte
       misslungene Meldungen in den sessionStorage; dieser Test haelt fest, dass
       das nicht zurueckkommt. */
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));

    logClientError(new Error("darf_nirgends_landen"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
});
