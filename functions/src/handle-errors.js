"use strict";

/**
 * handle-errors.js — Anonymes Client-Error-Logging.
 *
 * DSGVO: keine PII, keine IP-Speicherung, keine Cookies, keine persistente
 * Speicherung. Felder sind whitelist-validiert + laengenbegrenzt. Logs landen
 * in Cloud Logging und werden ueber die konfigurierte Retention automatisch
 * geloescht. Rate-Limit identisch zur restlichen API.
 */

const { checkRateLimit, getClientIp } = require("./middleware");

const STRING_FIELDS = {
  errorName: 100,
  errorMessage: 500,
  phase: 50,
  url: 200,
  userAgent: 250,
  requestId: 50,
};
const NUMBER_FIELDS = ["durationMs"];
const BOOLEAN_FIELDS = ["online", "hidden"];

async function handleErrors(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }
    }
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const sanitized = { type: "client-error" };

    for (const [key, maxLen] of Object.entries(STRING_FIELDS)) {
      const value = body[key];
      if (typeof value === "string" && value.length > 0) {
        sanitized[key] = value.slice(0, maxLen);
      }
    }
    for (const key of NUMBER_FIELDS) {
      const value = body[key];
      if (typeof value === "number" && isFinite(value)) {
        sanitized[key] = Math.max(0, Math.min(600000, Math.round(value)));
      }
    }
    for (const key of BOOLEAN_FIELDS) {
      if (typeof body[key] === "boolean") sanitized[key] = body[key];
    }

    /* console.error → severity ERROR in Cloud Logging → alarmierbar. */
    console.error(JSON.stringify(sanitized));

    res.status(204).end();
  } catch (err) {
    console.log(JSON.stringify({ warning: "errors-handler-failed", error: err.message }));
    res.status(204).end();
  }
}

module.exports = { handleErrors };
