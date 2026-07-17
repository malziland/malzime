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

/* Vergröbert den User-Agent auf Browser-Familie + Hauptversion + OS-Familie
   (z. B. "Safari 17 / iOS"). Der volle UA-String ist ein stabiler Fingerprint-
   Vektor und geht deshalb nie über die Diagnose-Endpunkte hinaus — die grobe
   Form reicht für jede bisherige Fehlersuche (Browser-/OS-Klasse). */
export function coarseUserAgent() {
  try {
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    let os = "other";
    if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";
    let browser = "other";
    let major = "";
    let m;
    if ((m = ua.match(/Edg\/(\d+)/))) [browser, major] = ["Edge", m[1]];
    else if ((m = ua.match(/OPR\/(\d+)/))) [browser, major] = ["Opera", m[1]];
    else if ((m = ua.match(/SamsungBrowser\/(\d+)/))) [browser, major] = ["SamsungBrowser", m[1]];
    else if ((m = ua.match(/Firefox\/(\d+)/))) [browser, major] = ["Firefox", m[1]];
    else if ((m = ua.match(/Chrome\/(\d+)/))) [browser, major] = ["Chrome", m[1]];
    else if ((m = ua.match(/Version\/(\d+).*Safari/))) [browser, major] = ["Safari", m[1]];
    else if (/Safari/.test(ua)) browser = "Safari";
    return `${browser}${major ? " " + major : ""} / ${os}`;
  } catch (_) {
    return "unknown";
  }
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
      if (typeof navigator.hardwareConcurrency === "number") ctx.hardwareConcurrency = navigator.hardwareConcurrency;
      if (typeof navigator.language === "string") ctx.language = navigator.language.slice(0, 10);
    }
    if (typeof screen !== "undefined") {
      if (typeof screen.width === "number" && typeof screen.height === "number") {
        /* Größenklasse statt exakter Auflösung: die exakten Pixel sind ein
           stabiles Fingerprint-Merkmal, für die Diagnose zählt nur die Klasse. */
        const maxDim = Math.max(screen.width, screen.height);
        ctx.screen = maxDim < 1000 ? "small" : maxDim < 1800 ? "medium" : "large";
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
