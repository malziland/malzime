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
       der Rechtstext ist die Vorgabe, nicht der Code. Der naheliegende
       „Verbesserungsvorschlag", die Warteschlange haltbar zu machen, scheitert
       genau hier. */
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));

    logClientError(new Error("darf_nirgends_landen"), { phase: "queue-network" });
    await vi.waitFor(() => expect(offeneMeldungen()).toHaveLength(1));

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
});

/* 07.10.2026: Meldet sich der Browser nie als getrennt, kommt kein „wieder
   online" — die Meldung ueber einen Verbindungsabriss laege bis zum Verlassen
   der Seite. Deshalb schickt die Seite nach einer Pause von selbst nach:
   dreimal, in wachsendem Abstand, dann Ruhe. */
describe("Fehler-Nachsendung nach einer Pause", () => {
  let logClientError, offeneMeldungen;
  const SEKUNDE = 1000;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ logClientError, offeneMeldungen } = await import("../js/error-logger.js"));
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ohne „wieder online“: nach 15 Sekunden geht die Meldung von selbst hinaus", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValue({ ok: true, status: 204 });

    logClientError(new Error("abriss"), { phase: "queue-network" });
    await vi.advanceTimersByTimeAsync(0);
    expect(offeneMeldungen()).toHaveLength(1);

    /* Kurz davor noch nichts … */
    await vi.advanceTimersByTimeAsync(14 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(1);
    /* … nach 15 Sekunden der zweite Anlauf, diesmal mit Netz. */
    await vi.advanceTimersByTimeAsync(1 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(2);
    expect(offeneMeldungen()).toHaveLength(0);
    expect(JSON.parse(f.mock.calls[1][1].body).errorMessage).toBe("abriss");
  });

  it("bleibt das Netz weg: drei Versuche (15 s, 60 s, 180 s), dann Ruhe — die Meldung bleibt liegen", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));

    logClientError(new Error("bleibt_weg"), { phase: "queue-network" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(180 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(4);

    /* Danach kein weiterer Versuch von selbst, auch nicht nach einer Stunde. */
    await vi.advanceTimersByTimeAsync(3600 * SEKUNDE);
    expect(f).toHaveBeenCalledTimes(4);
    expect(offeneMeldungen()).toHaveLength(1);
  });

  it("nach einer zugestellten Meldung bekommt die naechste Stoerung wieder alle Versuche", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockRejectedValue(new TypeError("Load failed"));

    logClientError(new Error("erste"), { phase: "queue-network" });
    await vi.advanceTimersByTimeAsync(15 * SEKUNDE);
    expect(offeneMeldungen()).toHaveLength(0);

    logClientError(new Error("zweite"), { phase: "queue-network" });
    await vi.advanceTimersByTimeAsync(0);
    const vorher = f.mock.calls.length;
    await vi.advanceTimersByTimeAsync((15 + 60 + 180) * SEKUNDE);
    expect(f.mock.calls.length - vorher).toBe(3);
  });

  it("ist das Geraet nachweislich offline, wartet die Seite auf „wieder online“ — keine Uhr", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true, writable: true });
    const f = vi.spyOn(globalThis, "fetch");

    logClientError(new Error("offline"), { phase: "queue-network" });
    await vi.advanceTimersByTimeAsync(3600 * SEKUNDE);

    expect(f).not.toHaveBeenCalled();
    expect(offeneMeldungen()).toHaveLength(1);
  });

  /* Prüfrunde 07.10.2026: Die Uhr zählte einen Versuch, auch wenn inzwischen
     alles zugestellt war — die nächste Störung begann dann bei 60 statt 15
     Sekunden. */
  it("stellt „wieder online“ zu, bevor die Uhr läutet, bekommt die nächste Störung wieder alle Versuche", async () => {
    const logger = await import("../js/error-logger.js");
    logger.initFehlerNachsendung();
    let netz = "weg";
    const aufrufe = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      aufrufe.push(Date.now());
      return netz === "weg"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ ok: true, status: 200 });
    });
    logger.logClientError(new Error("erste"), { phase: "probe" });
    await vi.advanceTimersByTimeAsync(5000);
    netz = "da";
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.offeneMeldungen().length).toBe(0); /* zugestellt */
    await vi.advanceTimersByTimeAsync(20000); /* die 15-s-Uhr läutet ins Leere */

    /* Zweite Störung, später. */
    netz = "weg";
    const vorher = aufrufe.length;
    logger.logClientError(new Error("zweite"), { phase: "probe" });
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(20000);
    const nach20s = aufrufe.length - vorher;
    /* Soll laut Kommentar: erster Nachsendeversuch nach 15 s -> nach 20 s zwei Aufrufe (Erstversuch + Nachsenden). */
    expect(nach20s).toBe(2);
  });
});
