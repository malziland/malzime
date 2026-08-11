/**
 * telemetry-logger.js — Anonyme Success-/Performance-Telemetrie.
 *
 * Sendet strukturierte Performance-Metriken an /api/telemetry. DSGVO-Profil
 * identisch zu error-logger: keine PII, keine IP, kein Cookie, keine
 * persistente Speicherung — nur grobe Hardware-/Netzwerk-Klassen + Timings.
 * Gegenstueck zum error-logger, separater Endpoint (INFO severity statt
 * ERROR), damit Cloud Logging die Klassen sauber trennt.
 */

import { collectClientContext, coarseUserAgent } from "./client-context.js";
import { leseRcTicket } from "./rc-ticket.js";

const TELEMETRY_ENDPOINT = "/api/telemetry";

export function logTelemetry(eventType, context = {}) {
  try {
    const clientCtx = collectClientContext();

    const payload = {
      eventType: typeof eventType === "string" ? eventType : "unknown",
      durationMs: typeof context.durationMs === "number" && isFinite(context.durationMs) ? context.durationMs : 0,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hidden: typeof document !== "undefined" ? document.hidden : false,
      userAgent: coarseUserAgent(),
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

/**
 * Realitäts-Check (v3.1): meldet die Selbsteinschätzung als anonymes
 * Ereignis. BEWUSST ein eigener, minimaler Pfad statt logTelemetry():
 * Es gehen AUSSCHLIESSLICH die Kategorie-Stufen und das Einmal-Ticket über
 * die Leitung — keine traceId, keine jobId, kein UserAgent, keine
 * Geräteklassen, nichts, was die Eingabe mit einer Analyse oder einem Gerät
 * verknüpfen könnte (Privacy-Zusage der Spezifikation). Den Score rechnet
 * der Server selbst.
 *
 * KA-02: Das Ticket (ein bedeutungsloser Zufallswert aus der
 * job-status-Antwort) beweist dem Server nur „echte Analyse" und wird dort
 * sofort entwertet — er loggt und speichert es nicht. Ohne Ticket zählt die
 * Stimme nicht; gesendet wird trotzdem NICHT anders (der Bildschirm-Check
 * funktioniert unabhängig davon).
 */
export function logRealitaetsCheck(stufen) {
  try {
    const ticket = leseRcTicket();
    const nutzlast = ticket
      ? { eventType: "realitaets-check", stufen, ticket }
      : { eventType: "realitaets-check", stufen };
    fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nutzlast),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* niemals werfen */
  }
}
