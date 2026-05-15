/**
 * telemetry-logger.js — Anonyme Success-/Performance-Telemetrie.
 *
 * Sendet strukturierte Performance-Metriken an /api/telemetry. DSGVO-Profil
 * identisch zu error-logger: keine PII, keine IP, kein Cookie, keine
 * persistente Speicherung — nur grobe Hardware-/Netzwerk-Klassen + Timings.
 * Gegenstueck zum error-logger, separater Endpoint (INFO severity statt
 * ERROR), damit Cloud Logging die Klassen sauber trennt.
 */

import { collectClientContext } from "./client-context.js";

const TELEMETRY_ENDPOINT = "/api/telemetry";

export function logTelemetry(eventType, context = {}) {
  try {
    const clientCtx = collectClientContext();

    const payload = {
      eventType: typeof eventType === "string" ? eventType : "unknown",
      durationMs:
        typeof context.durationMs === "number" && isFinite(context.durationMs)
          ? context.durationMs
          : 0,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hidden: typeof document !== "undefined" ? document.hidden : false,
      userAgent: (navigator && navigator.userAgent) || "",
      url: (typeof location !== "undefined" && location.pathname) || "",
      traceId: typeof context.traceId === "string" ? context.traceId : null,
      timings: context.timings && typeof context.timings === "object" ? context.timings : null,
      meta: context.meta && typeof context.meta === "object" ? context.meta : null,
      client: clientCtx,
    };

    fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* niemals werfen */
  }
}
