"use strict";

/**
 * handle-analyze.js — POST /analyze Pipeline.
 *
 * Seit v1.6.0 reine Mistral-Pipeline (kein Vision API, kein Gemini):
 *
 *  1. Validation (Method, Rate-Limit, Honeypot, MIME, Magic-Bytes, Size)
 *  2. Hourly-Limit (Firestore-Counter, rollendes Fenster)
 *  3. Mistral Large 3 — Bildbeschreibung (multimodal). Mistral liefert eine
 *     SUBJECT-Kopfzeile + Beschreibung + "Sichtbarer Text"-Zeile am Ende.
 *  4. SUBJECT-Parsing: ANIMAL_ONLY → Easter-Egg-Profil-Pfad, sonst Mensch.
 *  5. Privacy-Risiken aus dem sichtbaren Text der Beschreibung extrahieren.
 *  6. Mistral Small 4 — Normal- und Boost-Profil parallel.
 *  7. Response zusammenbauen oder blocked-Status liefern.
 *
 * Wenn Mistral nicht antwortet, fällt die Pipeline NICHT auf einen anderen
 * AI-Anbieter zurück (Gemini/Vision wurden in v1.6.0 entfernt). Der User
 * bekommt eine blockierte Antwort mit "blocked.apiError" oder "blocked.overloaded".
 */

const { ALLOWED_MIME, MAX_UPLOAD_BYTES, REQUEST_BUDGET_MS } = require("./config");
const { getClientIp, checkRateLimit } = require("./middleware");
const { parseMultipart, parseJsonBody } = require("./upload");
const { buildPrivacyRisks, extractVisibleText } = require("./privacy");
const mistral = require("./mistral");
const { classifyDescription, buildAnimalProfiles } = require("./animal");
const { resolveLanguage } = require("./i18n");
const { checkAndIncrement, incrementTotals, getMaintenanceStatus } = require("./counter");
const { notifyLimitReached } = require("./notify");
const { ALLOWED_ORIGINS } = require("./domains");

async function handleAnalyze(req, res, secrets) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const requestStart = Date.now();
  const remainingBudget = () => Math.max(0, REQUEST_BUDGET_MS - (Date.now() - requestStart));
  let traceId = null;
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    /* Kill-Switch: Maintenance-Modus prüfen (30s Cache, fail-open) */
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

    /* SEC-003: Server-seitige Bot-Heuristik — CORS schützt nicht gegen curl/Bots.
       Requests ohne Origin/Referer von einer erlaubten Domain loggen.
       Nicht blockieren (Rate Limit ist die primäre Defense), nur observieren. */
    const origin = req.headers["origin"] || "";
    const referer = req.headers["referer"] || "";
    const hasValidOrigin = ALLOWED_ORIGINS.some((o) => origin.startsWith(o) || referer.startsWith(o));
    if (!hasValidOrigin) {
      console.log(JSON.stringify({ requestId, warning: "no-browser-origin" }));
    }

    let file = null;
    let multipartFields = null;

    const jsonBody = parseJsonBody(req);
    if (jsonBody) {
      if (jsonBody.imageBase64) {
        const b64Str = String(jsonBody.imageBase64);
        /* BUG-010: Offensichtlich ungültiges Base64 früh abweisen — spart teure API-Calls */
        if (/[^A-Za-z0-9+/=\s]/.test(b64Str.slice(0, 256))) {
          res.status(400).json({ error: "Invalid image data" });
          return;
        }
        const estimatedBytes = Math.ceil((b64Str.length * 3) / 4);
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
          res.status(413).json({ error: "File too large" });
          return;
        }
        const buffer = Buffer.from(b64Str, "base64");
        file = {
          buffer,
          mimeType: jsonBody.mimeType || "image/jpeg",
          filename: jsonBody.filename || "upload.jpg",
          size: buffer.length,
        };
        if (jsonBody.exif && typeof jsonBody.exif === "object") {
          /* SEC-006: Nur erlaubte Keys durchlassen, Typ + Länge validieren
             SEC-002: dateTimeOriginal wird nicht mehr akzeptiert — bleibt im Browser */
          const raw = jsonBody.exif;
          const safe = {};
          if (typeof raw.make === "string") safe.make = raw.make.slice(0, 100);
          if (typeof raw.model === "string") safe.model = raw.model.slice(0, 100);
          file.clientExif = safe;
        }
      }
    } else {
      const parsed = await parseMultipart(req);
      file = parsed.file;
      multipartFields = parsed.fields;
    }

    /* i18n: Sprache aus Request auflösen */
    const requestedLang = (jsonBody && jsonBody.lang) || (multipartFields && multipartFields.lang) || "";
    const lang = resolveLanguage(requestedLang);

    /* Trace-ID vom Frontend uebernehmen (sanitized): kurze alphanumerische
       ID, dient nur zur Korrelation mit Client-Logs. Falls fehlend → null. */
    const rawTraceId =
      (jsonBody && jsonBody.traceId) || (multipartFields && multipartFields.traceId) || "";
    if (typeof rawTraceId === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(rawTraceId)) {
      traceId = rawTraceId;
    }
    if (traceId) res.setHeader("X-Trace-Id", traceId);

    /* BUG-004: Honeypot-Check für JSON und Multipart */
    const hpValue = (jsonBody && jsonBody.website) || (multipartFields && multipartFields.website) || "";
    if (hpValue) {
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

    /* SEC-009: Magic-Byte-Check — Client-MIME gegen tatsächlichen File-Content validieren */
    const magic = file.buffer.slice(0, 4);
    const magicHex = magic.toString("hex");
    const isJpeg = magic[0] === 0xff && magic[1] === 0xd8;
    const isPng = magicHex.startsWith("89504e47");
    const isWebp =
      magic.toString("ascii", 0, 4) === "RIFF" &&
      file.buffer.length > 11 &&
      file.buffer.toString("ascii", 8, 12) === "WEBP";
    const isGif = magicHex.startsWith("47494638");
    if (!isJpeg && !isPng && !isWebp && !isGif) {
      res.status(400).json({ error: "Invalid image data" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }

    /* ── Globales Stundenlimit (Firestore-Zähler) ──
       Erst NACH Honeypot/Validierung zählen, damit ungültige Requests
       nicht das Budget aufbrauchen (BUG-001). */
    const counterResult = await checkAndIncrement();

    /* ntfy-Push beim erstmaligen Erreichen des Limits */
    if (counterResult.justReached) {
      notifyLimitReached({
        ntfyUrl: secrets.ntfyUrl.value(),
        ntfyTopic: secrets.ntfyTopic.value(),
        adminSecret: secrets.adminSecret.value(),
        count: counterResult.count,
        limit: counterResult.limit,
      }).catch((err) => {
        console.log(JSON.stringify({ warning: "ntfy-error", error: err.message }));
      });
    }

    if (!counterResult.allowed) {
      res.status(429).json({
        blocked: "limit",
        retryAfterSeconds: counterResult.retryAfterSeconds,
        message: "Stundenlimit erreicht",
      });
      return;
    }

    const imageBuffer = file.buffer;
    const exif = file.clientExif || {};

    /* ── Stage 1: Bildbeschreibung via Mistral Large 3 ── */
    let imageDescription = null;
    let describeBlocked = false;
    let describeError = false;
    let quotaError = false;
    let describeMs = 0;
    const describeStart = Date.now();
    try {
      imageDescription = await mistral.describeImage(imageBuffer, file.mimeType, remainingBudget, lang);
      describeMs = Date.now() - describeStart;
      if (!imageDescription) describeBlocked = true;
      console.log(
        JSON.stringify({
          requestId,
          traceId,
          step: "describe",
          status: imageDescription ? "ok" : "blocked",
          length: imageDescription ? imageDescription.length : 0,
          durationMs: describeMs,
        })
      );
    } catch (err) {
      describeMs = Date.now() - describeStart;
      if (err && (err.code === "rate_limit" || /rate_limit|quota|429/i.test(err.message || ""))) {
        quotaError = true;
      }
      describeError = true;
      console.log(
        JSON.stringify({
          requestId,
          traceId,
          warning: "describe-failed",
          error: err.message,
          durationMs: describeMs,
        })
      );
    }

    /* ── Stage 2: SUBJECT-Klassifikation + sichtbarer Text aus Beschreibung ── */
    const { subject, hasPerson, hasAnimal, animalType } = classifyDescription(imageDescription || "");
    const visibleText = extractVisibleText(imageDescription || "");
    const privacyRisks = buildPrivacyRisks({ visibleText, fullDescription: imageDescription || "" });

    console.log(JSON.stringify({ requestId, traceId, step: "subject-classify", subject, animalType }));

    /* ── Stage 3a: Tier-Easter-Egg-Pfad (nur Tier im Bild) ── */
    if (imageDescription && !hasPerson && hasAnimal) {
      const { normalProfile, boostProfile } = buildAnimalProfiles(animalType || "generic", lang);

      /* BUG-007: Privacy-Risks und EXIF auch bei Tier-Fotos durchreichen —
         ein sichtbares Nummernschild im Hintergrund soll trotzdem gemeldet werden */
      incrementTotals().catch((err) => {
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: err.message }));
      });
      res.json({
        profiles: { normal: normalProfile, boost: boostProfile },
        privacyRisks,
        exif,
        meta: { requestId, traceId, mode: "animal" },
      });
      console.log(
        JSON.stringify({
          requestId,
          traceId,
          status: "ok",
          mode: "animal",
          totalMs: Date.now() - requestStart,
          describeMs,
        })
      );
      return;
    }

    /* ── Stage 3b: Profile-Generierung via Mistral Small 4 (mit Mistral-internem Large-3-Fallback) ── */
    let profiles = { normal: null, boost: null };
    let profileBlocked = false;
    let profilesMs = 0;
    if (imageDescription) {
      const profilesStart = Date.now();
      try {
        profiles = await mistral.generateBothProfiles(imageDescription, exif, remainingBudget, lang);
        profilesMs = Date.now() - profilesStart;
        profileBlocked = !profiles.normal && !profiles.boost;
        console.log(
          JSON.stringify({
            requestId,
            traceId,
            step: "profiles",
            normal: !!profiles.normal,
            boost: !!profiles.boost,
            durationMs: profilesMs,
          })
        );
      } catch (err) {
        profilesMs = Date.now() - profilesStart;
        if (err && (err.code === "rate_limit" || /rate_limit|quota|429/i.test(err.message || ""))) {
          quotaError = true;
        }
        profileBlocked = true;
        console.log(
          JSON.stringify({
            requestId,
            traceId,
            warning: "profile-failed",
            error: err.message,
            durationMs: profilesMs,
          })
        );
      }
    }

    /* ── Response zusammenbauen ── */
    const hasCategories = (obj) => obj && obj.categories && Object.keys(obj.categories).length > 0;
    const hasAnyProfile = hasCategories(profiles.normal) || hasCategories(profiles.boost);

    if (hasAnyProfile) {
      incrementTotals().catch((err) => {
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: err.message }));
      });
      const normalData = profiles.normal || {};
      const boostData = profiles.boost || {};
      res.json({
        profiles: {
          normal: {
            categories: normalData.categories || {},
            ad_targeting: normalData.ad_targeting || [],
            manipulation_triggers: normalData.manipulation_triggers || [],
            profileText: normalData.profileText || "",
          },
          boost: {
            categories: boostData.categories || {},
            ad_targeting: boostData.ad_targeting || [],
            manipulation_triggers: boostData.manipulation_triggers || [],
            profileText: boostData.profileText || "",
          },
        },
        privacyRisks,
        exif,
        meta: { requestId, traceId, mode: "multimodal", subject },
      });
      console.log(
        JSON.stringify({
          requestId,
          traceId,
          status: "ok",
          mode: "multimodal",
          subject,
          totalMs: Date.now() - requestStart,
          describeMs,
          profilesMs,
        })
      );
      return;
    }

    /* Blocked-Pfad — kein Profil zu Stande gekommen */
    let blockedReason;
    if (quotaError) {
      blockedReason = "blocked.overloaded";
    } else if (describeBlocked) {
      blockedReason = "blocked.safetyFilter";
    } else if (describeError) {
      blockedReason = "blocked.apiError";
    } else if (profileBlocked) {
      blockedReason = "blocked.profileBlocked";
    } else if (!imageDescription) {
      blockedReason = "blocked.noContent";
    } else {
      blockedReason = "blocked.generic";
    }

    res.json({
      profiles: null,
      blockedReason,
      privacyRisks,
      exif,
      meta: {
        requestId,
        traceId,
        mode: "blocked",
        reason: describeBlocked
          ? "safety_filter"
          : describeError
            ? "api_error"
            : profileBlocked
              ? "profile_blocked"
              : "no_content",
      },
    });
    console.log(
      JSON.stringify({
        requestId,
        traceId,
        status: "blocked",
        reason: blockedReason,
        totalMs: Date.now() - requestStart,
        describeMs,
        profilesMs,
      })
    );
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "unknown_error";
    console.log(
      JSON.stringify({
        requestId,
        traceId,
        status: "error",
        code,
        totalMs: Date.now() - requestStart,
      })
    );
    res.status(status).json({ error: "Analyze failed", code });
  }
}

module.exports = { handleAnalyze };
