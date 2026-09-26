/* Erfolgsmeldung ohne Geraet und ohne Kennung (26.09.2026).

   Gegenstueck zu functions/src/__tests__/handle-telemetry-ohne-geraet.test.js:
   Dort verwirft der Server die Angaben, hier schickt der Browser sie gar nicht
   erst. Begruendung in public/js/telemetry-logger.js. */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { logTelemetry } from "../js/telemetry-logger.js";

describe("logTelemetry", () => {
  let gesendet;
  beforeEach(() => {
    gesendet = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, opts) => {
        gesendet.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("schickt Dauer, Seite und Motiv — aber kein Geraet und keine Kennung", () => {
    logTelemetry("analyze-success", {
      traceId: "vorgang-geheim-42",
      durationMs: 41719,
      timings: { totalMs: 41719, renderMs: 2199 },
      meta: { subject: "HUMAN", mode: "multimodal", lang: "de", queue: true },
    });
    expect(gesendet).toHaveLength(1);
    const body = gesendet[0];
    /* Positivkontrolle: die erlaubten Angaben gehen raus. */
    expect(body.eventType).toBe("analyze-success");
    expect(body.timings.totalMs).toBe(41719);
    expect(body.meta.subject).toBe("HUMAN");
    /* Auch eine uebergebene Kennung verlaesst den Browser nicht. */
    expect(body).not.toHaveProperty("traceId");
    expect(body).not.toHaveProperty("userAgent");
    expect(body).not.toHaveProperty("client");
    expect(JSON.stringify(body)).not.toContain("vorgang-geheim-42");
  });
});
