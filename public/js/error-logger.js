/**
 * error-logger.js — Anonymes Client-Error-Logging.
 *
 * Sendet strukturierte Fehler-Metadaten an /api/errors. DSGVO: keine PII,
 * keine IP-Speicherung serverseitig, keine Cookies, kein User-Tracking —
 * nur Fehler-Typ, Phase, Dauer + grober User-Agent. Logging-Fehler werden
 * still geschluckt, damit der User-Flow nie davon abhaengt.
 */

const ERROR_ENDPOINT = "/api/errors";

export function logClientError(error, context = {}) {
  try {
    const payload = {
      errorName: (error && error.name) || "Error",
      errorMessage: ((error && error.message) || "").slice(0, 500),
      phase: typeof context.phase === "string" ? context.phase : "unknown",
      durationMs:
        typeof context.durationMs === "number" && isFinite(context.durationMs)
          ? context.durationMs
          : 0,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hidden: typeof document !== "undefined" ? document.hidden : false,
      userAgent: (navigator && navigator.userAgent) || "",
      url: (typeof location !== "undefined" && location.pathname) || "",
      requestId:
        typeof context.requestId === "string" ? context.requestId : null,
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
