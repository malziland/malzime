"use strict";

/**
 * handle-telemetry.js — Anonyme Performance-/Success-Telemetrie.
 *
 * Spiegel zu handle-errors.js, aber INFO-severity (statt ERROR), getrennter
 * Endpoint damit Cloud Logging Success-Events sauber von Fehlern trennt.
 * DSGVO: keine PII, keine IP-Speicherung, keine Cookies, keine persistente
 * Speicherung. Whitelist + Laengenlimits identisch zum Error-Endpoint.
 */

const { checkRateLimit, getClientIp } = require("./middleware");

const STRING_FIELDS = {
  eventType: 50,
  url: 200,
  userAgent: 250,
  traceId: 50,
};
const NUMBER_FIELDS = ["durationMs"];
const BOOLEAN_FIELDS = ["online", "hidden"];

/* Erlaubte Felder im verschachtelten timings-Objekt — Whitelist + Wertgrenzen.
   enqueueMs = Upload-Dauer des Queue-Pfads (Bild rauf bis jobId zurück); der
   Client misst es bereits, es fehlte nur auf dieser Liste und wurde verworfen. */
const TIMING_KEYS = ["prepareImageMs", "fetchMs", "enqueueMs", "parseMs", "renderMs", "totalMs"];

const CLIENT_STRING_KEYS = { effectiveType: 20, language: 10, screen: 30 };
const CLIENT_NUMBER_KEYS = ["downlinkMbps", "rttMs", "deviceMemoryGb", "hardwareConcurrency", "dpr"];
const CLIENT_BOOL_KEYS = ["saveData"];

const META_STRING_KEYS = { subject: 30, mode: 30, lang: 10, reason: 100, wakeLock: 40 };
const META_BOOL_KEYS = ["maintenanceTriggered"];

function sanitizeTimings(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of TIMING_KEYS) {
    const v = raw[key];
    if (typeof v === "number" && isFinite(v)) {
      out[key] = Math.max(0, Math.min(600000, Math.round(v)));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeClient(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [key, maxLen] of Object.entries(CLIENT_STRING_KEYS)) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, maxLen);
  }
  for (const key of CLIENT_NUMBER_KEYS) {
    if (typeof raw[key] === "number" && isFinite(raw[key])) out[key] = raw[key];
  }
  for (const key of CLIENT_BOOL_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [key, maxLen] of Object.entries(META_STRING_KEYS)) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, maxLen);
  }
  for (const key of META_BOOL_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function handleTelemetry(req, res) {
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

    const sanitized = { type: "client-telemetry" };

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

    const timings = sanitizeTimings(body.timings);
    if (timings) sanitized.timings = timings;

    const client = sanitizeClient(body.client);
    if (client) sanitized.client = client;

    const meta = sanitizeMeta(body.meta);
    if (meta) sanitized.meta = meta;

    /* console.log → severity DEFAULT/INFO in Cloud Logging. */
    console.log(JSON.stringify(sanitized));

    res.status(204).end();
  } catch (err) {
    console.log(JSON.stringify({ warning: "telemetry-handler-failed", error: err.message }));
    res.status(204).end();
  }
}

module.exports = { handleTelemetry };
