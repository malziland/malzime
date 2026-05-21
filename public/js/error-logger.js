/**
 * error-logger.js — Anonymes Client-Error-Logging.
 *
 * Sendet strukturierte Fehler-Metadaten an /api/errors. DSGVO: keine PII,
 * keine IP-Speicherung serverseitig, keine Cookies, kein User-Tracking —
 * nur Fehler-Typ, Phase, Dauer, anonyme Hardware-/Netzwerk-Klassen + grober
 * User-Agent. Logging-Fehler werden still geschluckt, damit der User-Flow
 * nie davon abhaengt.
 */

import { collectClientContext } from "./client-context.js";

const ERROR_ENDPOINT = "/api/errors";

export function logClientError(error, context = {}) {
  try {
    const clientCtx = collectClientContext();

    const payload = {
      errorName: (error && error.name) || "Error",
      errorMessage: ((error && error.message) || "").slice(0, 500),
      phase: typeof context.phase === "string" ? context.phase : "unknown",
      durationMs: typeof context.durationMs === "number" && isFinite(context.durationMs) ? context.durationMs : 0,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hidden: typeof document !== "undefined" ? document.hidden : false,
      userAgent: (navigator && navigator.userAgent) || "",
      url: (typeof location !== "undefined" && location.pathname) || "",
      requestId: typeof context.requestId === "string" ? context.requestId : null,
      traceId: typeof context.traceId === "string" ? context.traceId : null,
      httpStatus: typeof context.httpStatus === "number" ? context.httpStatus : null,
      wakeLock: typeof context.wakeLock === "string" ? context.wakeLock : null,
      fileFormat: typeof context.fileFormat === "string" ? context.fileFormat : null,
      timings: context.timings && typeof context.timings === "object" ? context.timings : null,
      client: clientCtx,
    };

    /* keepalive: damit der Beacon auch beim Tab-Schliessen durchgeht. */
    fetch(ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* niemals werfen */
  }
}
