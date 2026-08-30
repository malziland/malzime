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
const { geltendeWerte } = require("./betriebsprofil");
const { zaehleRealitaetsCheck } = require("./counter");
const { verbraucheRcTicket } = require("./jobs");
const { sha256Hex } = require("./auth");

const STRING_FIELDS = {
  eventType: 50,
  url: 200,
  /* Client sendet nur noch den vergröberten UA — knappes Limit als zweites Netz. */
  userAgent: 80,
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

/* ── Realitäts-Check (v3.1): anonyme Selbsteinschätzung ──────────────────
   Erlaubt sind AUSSCHLIESSLICH die Kategorie-Stufen — keine traceId, keine
   jobId, nichts Verknüpfbares (Privacy-Zusage der Spezifikation). Alles,
   was nicht exakt dem Schema entspricht, wird verworfen: kein Log, kein
   Zähler-Inkrement. Geschlecht ist optional (die Zeile entfällt im
   Frontend, wenn die KI sich nicht festgelegt hat) und binär (0|1);
   alle anderen Stufen sind Pflicht mit den Werten 0 | 0,5 | 1. */

const RC_PFLICHT_STUFEN = ["alter", "interessen", "charakter", "werbung", "manipulation"];
const RC_OPTIONALE_STUFEN = ["geschlecht"];

/**
 * Validiert das stufen-Objekt strikt: nur die erlaubten Schlüssel, nur die
 * erlaubten Werte, alle Pflicht-Stufen vorhanden. Liefert das bereinigte
 * Objekt oder null (= komplette Eingabe verwerfen).
 */
function validiereRealitaetsCheckStufen(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const erlaubt = new Set([...RC_PFLICHT_STUFEN, ...RC_OPTIONALE_STUFEN]);
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!erlaubt.has(key)) return null;
  }
  for (const key of RC_PFLICHT_STUFEN) {
    if (!(key in raw)) return null;
  }
  const out = {};
  for (const key of keys) {
    const wert = raw[key];
    const erlaubteWerte = key === "geschlecht" ? [0, 1] : [0, 0.5, 1];
    if (!erlaubteWerte.includes(wert)) return null;
    out[key] = wert;
  }
  return out;
}

/**
 * Berechnet die Trefferquote 0–100 serverseitig aus den Stufen — dem
 * Client wird kein fertiger Score geglaubt.
 */
function berechneRealitaetsCheckScore(stufen) {
  const werte = Object.values(stufen);
  const summe = werte.reduce((s, v) => s + v, 0);
  return Math.round((summe / werte.length) * 100);
}

/* KA-02: Ein Ticket ist eine UUID (36 Zeichen) — die Grenze ist nur ein
   zweites Netz gegen absurd lange Strings vor dem Hashen. */
const RC_TICKET_MAX_LAENGE = 100;

/**
 * Behandelt das realitaets-check-Ereignis: strikt validieren, EIN anonymes
 * Log-Ereignis schreiben und das Aggregat in Firestore hochzählen. Bewusst
 * KEINE weiteren Felder aus dem Body (traceId, userAgent, timings, …) —
 * dieses Ereignis bleibt unverknüpfbar. Ungültige Eingaben werden still
 * verworfen; die Antwort ist in jedem Fall 204.
 *
 * KA-02 (Kurzaudit 2026-08-12): Gezählt wird NUR noch gegen ein gültiges
 * Einmal-Ticket aus einer echten Analyse (ausgegeben vom job-status-Handler
 * bei der ersten Auslieferung, entwertet in einer Transaktion). Vorher war
 * der Zähler von außen flutbar: Das IP-Limit lebt je Function-Instanz (bis
 * zu 3 Instanzen), und das Aggregat kennt keinen Rückweg. Reihenfolge
 * bewusst: erst die Stufen prüfen, DANN das Ticket entwerten — eine kaputte
 * Eingabe verbrennt kein gültiges Ticket. Das Ticket selbst wird weder
 * geloggt noch gespeichert; das Log-Ereignis trägt unverändert nur
 * {stufen, score} und bleibt unverknüpfbar.
 */
async function handleRealitaetsCheckEvent(body, res) {
  const stufen = validiereRealitaetsCheckStufen(body.stufen);
  if (stufen) {
    const ticket =
      typeof body.ticket === "string" && body.ticket.length > 0 && body.ticket.length <= RC_TICKET_MAX_LAENGE
        ? body.ticket
        : null;
    /* Ein Firestore-Schluckauf beim Entwerten darf die Antwort nie kippen —
       dann zählt diese Stimme eben nicht (fail-closed: lieber eine echte
       Stimme verlieren als Flutung wieder öffnen). */
    const gueltig = ticket ? await verbraucheRcTicket(sha256Hex(ticket)).catch(() => false) : false;
    if (gueltig) {
      const score = berechneRealitaetsCheckScore(stufen);
      console.log(JSON.stringify({ type: "client-telemetry", eventType: "realitaets-check", stufen, score }));
      /* zaehleRealitaetsCheck schluckt Firestore-Fehler selbst (nur Warnung) —
         Telemetrie darf nie mit einem 5xx antworten. */
      await zaehleRealitaetsCheck(score);
    }
  }
  res.status(204).end();
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
    const { werte: grenzwerte } = await geltendeWerte().catch(() => ({ werte: null }));
    if (!checkRateLimit(ip, grenzwerte?.adressLimit, grenzwerte?.adressfensterMs)) {
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

    /* Realitäts-Check (v3.1): eigener, minimaler Pfad VOR der allgemeinen
       Feld-Übernahme — für dieses Ereignis darf ausser den Stufen nichts
       verarbeitet oder geloggt werden (keine traceId, kein UserAgent). */
    if (body.eventType === "realitaets-check") {
      await handleRealitaetsCheckEvent(body, res);
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
