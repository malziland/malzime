"use strict";

/**
 * handle-enqueue.js — POST /enqueue (Queue-Architektur v2.0).
 *
 * Annahme-Endpoint der Queue — seit v2.10 der einzige Upload-Weg. Validiert
 * die Anfrage (Method, Maintenance, Rate-Limit, Body-Größe, Honeypot, MIME,
 * Magic-Bytes, Warteschlangen-Tiefe, Stundenlimit), legt das Bild kurz ab,
 * erzeugt ein Job-Dokument und reiht es in Cloud Tasks ein. Antwortet SOFORT
 * mit der `jobId` — die eigentliche Mistral-Pipeline läuft asynchron im
 * Worker `processJob`.
 *
 * Public erreichbar. Honeypot und Zeitmessung sind Browser-Heuristiken und
 * halten einen Aufruf per curl nicht auf — die tragenden Bremsen sind das
 * IP-Rate-Limit, die Body-Größe, die Warteschlangen-Tiefe und das Stundenlimit.
 */

const crypto = require("crypto");
const { ALLOWED_MIME, MAX_UPLOAD_BYTES, MAX_QUEUE_DEPTH } = require("./config");
const { getClientIp, checkRateLimit } = require("./middleware");
const { parseMultipart, parseJsonBody } = require("./upload");
const { resolveLanguage } = require("./i18n");
const { checkAndIncrement, getMaintenanceStatus, releaseHourlySlot } = require("./counter");
const { notifyLimitReached } = require("./notify");
const { ALLOWED_ORIGINS } = require("./domains");
const { createJob, failJob, countQueuedJobs } = require("./jobs");
const { storeImage, deleteImage } = require("./queue-storage");
const { enqueueJob } = require("./cloud-tasks");

/**
 * Magic-Byte-Erkennung — prüft den echten Datei-Inhalt gegen den vom Client
 * behaupteten MIME-Typ. Gibt den erkannten MIME-Typ zurück oder null.
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hex = buffer.slice(0, 4).toString("hex");
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/* Whitelist-Sanitisierung der Kamera-Metadaten — nur make/model, je 100 Zeichen.
   GPS und dateTimeOriginal bleiben client-seitig (unverändert zur Architektur). */
function sanitizeExif(raw) {
  const safe = {};
  if (raw && typeof raw === "object") {
    if (typeof raw.make === "string") safe.make = raw.make.slice(0, 100);
    if (typeof raw.model === "string") safe.model = raw.model.slice(0, 100);
  }
  return safe;
}

async function handleEnqueue(req, res, secrets) {
  const requestId = Math.random().toString(36).slice(2, 10);
  let traceId = null;
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    /* Kill-Switch: Maintenance-Modus (30s Cache, fail-open) */
    const maintenance = await getMaintenanceStatus();
    if (maintenance.enabled) {
      res.status(503).json({ maintenance: true, message: maintenance.message });
      return;
    }

    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    /* SEC-002 (Audit 2026-08-10): Groesse aus der Kopfzeile ablehnen, BEVOR
       irgendetwas mit dem Rumpf passiert. Gemessen kostet ein 23-MB-Bild als
       Base64 rund 170 MB Arbeitsspeicher pro gleichzeitiger Anfrage — bei
       512 MiB Grenze reichen wenige parallele Grossuploads, um die Instanz zu
       toeten. Die eigentliche Groessenpruefung weiter unten kommt dafuer zu
       spaet: Die Laufzeit liest den Rumpf vorab vollstaendig ein.
       Base64 blaeht um Faktor 4/3, dazu etwas Rahmen — deshalb wird gegen die
       Base64-Laenge geprueft, nicht gegen die Bildgroesse. */
    const gemeldeteLaenge = Number(req.headers["content-length"] || 0);
    const MAX_BODY_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 64 * 1024;
    if (gemeldeteLaenge > MAX_BODY_BYTES) {
      console.log(JSON.stringify({ requestId, warning: "body-too-large", bytes: gemeldeteLaenge }));
      res.status(413).json({ error: "File too large" });
      return;
    }

    /* Bot-Heuristik: Requests ohne Browser-Origin nur observieren, nicht blocken. */
    const origin = req.headers["origin"] || "";
    const referer = req.headers["referer"] || "";
    if (!ALLOWED_ORIGINS.some((o) => origin.startsWith(o) || referer.startsWith(o))) {
      console.log(JSON.stringify({ requestId, warning: "no-browser-origin" }));
    }

    /* ── Body parsen (JSON mit imageBase64 oder Multipart) ── */
    let file = null;
    let exif = {};
    let fields = null;
    const jsonBody = parseJsonBody(req);
    if (jsonBody && jsonBody.imageBase64) {
      const b64 = String(jsonBody.imageBase64);
      if (/[^A-Za-z0-9+/=\s]/.test(b64.slice(0, 256))) {
        res.status(400).json({ error: "Invalid image data" });
        return;
      }
      if (Math.ceil((b64.length * 3) / 4) > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "File too large" });
        return;
      }
      const buffer = Buffer.from(b64, "base64");
      file = { buffer, mimeType: jsonBody.mimeType || "image/jpeg", size: buffer.length };
      exif = sanitizeExif(jsonBody.exif);
    } else if (!jsonBody) {
      const parsed = await parseMultipart(req);
      file = parsed.file;
      fields = parsed.fields;
    }

    /* i18n + Trace-ID */
    const requestedLang = (jsonBody && jsonBody.lang) || (fields && fields.lang) || "";
    const lang = resolveLanguage(requestedLang);

    const rawTraceId = (jsonBody && jsonBody.traceId) || (fields && fields.traceId) || "";
    if (typeof rawTraceId === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(rawTraceId)) {
      traceId = rawTraceId;
    }
    if (traceId) res.setHeader("X-Trace-Id", traceId);

    /* Honeypot */
    const honeypot = (jsonBody && jsonBody.website) || (fields && fields.website) || "";
    if (honeypot) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    /* ── Validierung ── */
    if (!file || !file.buffer) {
      res.status(400).json({ error: "Missing image" });
      return;
    }
    if (!file.mimeType || !ALLOWED_MIME.includes(file.mimeType)) {
      res.status(400).json({ error: "Invalid file type. Allowed: JPEG, PNG, WEBP, GIF" });
      return;
    }
    if (!detectImageType(file.buffer)) {
      res.status(400).json({ error: "Invalid image data" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }

    /* ── ARCH-001: Warteschlangen-Tiefe ──
       Vor dem Zähler, damit ein abgelehnter Auftrag keinen Stunden-Platz
       verbraucht. Fail-open: Klemmt die Abfrage, wird angenommen wie bisher —
       eine Kapazitätsbremse darf nie zum Ausfall eskalieren. */
    try {
      const wartende = await countQueuedJobs();
      if (wartende >= MAX_QUEUE_DEPTH) {
        console.log(JSON.stringify({ requestId, warning: "queue-too-deep", wartende, grenze: MAX_QUEUE_DEPTH }));
        res.status(429).json({
          blocked: "queueFull",
          retryAfterSeconds: 300,
          message: "Gerade warten sehr viele Analysen — bitte in ein paar Minuten nochmal.",
        });
        return;
      }
    } catch (err) {
      console.log(JSON.stringify({ requestId, warning: "queue-depth-check-failed", error: err.message }));
    }

    /* ── Globales Stundenlimit (Firestore-Zähler) ──
       Erst NACH Honeypot/Validierung zählen, damit ungültige Requests
       das Budget nicht aufbrauchen. */
    const counter = await checkAndIncrement();
    if (counter.justReached) {
      notifyLimitReached({
        ntfyUrl: secrets.ntfyUrl.value(),
        ntfyTopic: secrets.ntfyTopic.value(),
        adminSecret: secrets.adminSecret.value(),
        count: counter.count,
        limit: counter.limit,
      }).catch((err) => {
        console.log(JSON.stringify({ warning: "ntfy-error", error: err.message }));
      });
    }
    if (!counter.allowed) {
      res.status(429).json({
        blocked: "limit",
        retryAfterSeconds: counter.retryAfterSeconds,
        message: "Stundenlimit erreicht",
      });
      return;
    }

    /* ── Bild ablegen → Job anlegen → in Cloud Tasks einreihen ── */
    /* PRIV-003: Abhol-Ticket fürs Ergebnis — nur dieser Browser bekommt es von
       job-status zurück (zweites Schloss zusätzlich zur unerratbaren jobId). */
    const resultToken = crypto.randomUUID();
    let imagePath;
    let jobId;
    try {
      imagePath = await storeImage(file.buffer, file.mimeType);
      jobId = await createJob({ lang, traceId, imagePath, exif, resultToken });
    } catch (err) {
      /* Der Stunden-Slot ist hier schon gezogen, aber es entsteht nie eine
         Analyse — Slot zurückgeben und ein evtl. schon abgelegtes Bild nicht
         bis zur Lifecycle-Regel liegen lassen. */
      console.log(JSON.stringify({ requestId, traceId, warning: "store-or-create-failed", error: err.message }));
      releaseHourlySlot().catch(() => {});
      if (imagePath) await deleteImage(imagePath);
      res.status(503).json({ error: "Queue unavailable", code: "store_failed" });
      return;
    }

    try {
      await enqueueJob(jobId);
    } catch (err) {
      /* Job ist angelegt, aber Cloud Tasks hat ihn nicht angenommen — sonst
         bliebe er für immer `queued` und der Client pollt ewig. Sauber als
         `failed` markieren und das Bild gleich wieder löschen. */
      console.log(JSON.stringify({ requestId, traceId, jobId, warning: "enqueue-failed", error: err.message }));
      await failJob(jobId, "enqueue_failed");
      /* BIZ-001: Slot zurückgeben — dieser Job löst nie eine echte Analyse aus. */
      releaseHourlySlot().catch(() => {});
      await deleteImage(imagePath);
      res.status(503).json({ error: "Queue unavailable", code: "enqueue_failed" });
      return;
    }

    console.log(JSON.stringify({ requestId, traceId, jobId, step: "enqueue", status: "ok" }));
    res.status(200).json({ jobId, resultToken });
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "unknown_error";
    console.log(JSON.stringify({ requestId, traceId, status: "error", code, error: err.message }));
    res.status(status).json({ error: "Enqueue failed", code });
  }
}

module.exports = { handleEnqueue, detectImageType };
