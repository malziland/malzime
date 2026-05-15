/**
 * client-context.js — Anonyme Hardware-/Netzwerk-Kontextdaten für Telemetrie.
 *
 * Sammelt nur Pseudonymisierungs-Klassen (grobe Bandbreite, Memory-Stufe,
 * CPU-Cores, Screen-Dims). KEINE IP, kein Cookie, keine PII, keine
 * persistente Speicherung. Auf serverseitiger Cloud-Logging-Retention.
 *
 * Trace-ID: kurze zufaellige ID pro Analyse-Lauf, damit Frontend-Errors
 * mit dem Backend-Request korreliert werden koennen.
 */

export function generateTraceId() {
  /* 16 Zeichen aus base36 → ~83 Bit Entropie, kollisionsarm fuer unsere Skala. */
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return rand.slice(0, 16);
}

export function collectClientContext() {
  const ctx = {};
  try {
    if (typeof navigator !== "undefined") {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        if (typeof conn.effectiveType === "string") ctx.effectiveType = conn.effectiveType;
        if (typeof conn.downlink === "number") ctx.downlinkMbps = Math.round(conn.downlink * 10) / 10;
        if (typeof conn.rtt === "number") ctx.rttMs = conn.rtt;
        if (typeof conn.saveData === "boolean") ctx.saveData = conn.saveData;
      }
      if (typeof navigator.deviceMemory === "number") ctx.deviceMemoryGb = navigator.deviceMemory;
      if (typeof navigator.hardwareConcurrency === "number")
        ctx.hardwareConcurrency = navigator.hardwareConcurrency;
      if (typeof navigator.language === "string") ctx.language = navigator.language.slice(0, 10);
    }
    if (typeof screen !== "undefined") {
      if (typeof screen.width === "number" && typeof screen.height === "number") {
        ctx.screen = `${screen.width}x${screen.height}`;
      }
    }
    if (typeof window !== "undefined" && typeof window.devicePixelRatio === "number") {
      ctx.dpr = Math.round(window.devicePixelRatio * 10) / 10;
    }
  } catch (_) {
    /* niemals werfen */
  }
  return ctx;
}

export function isDebugMode() {
  try {
    return new URLSearchParams(location.search).get("debug") === "1";
  } catch (_) {
    return false;
  }
}
