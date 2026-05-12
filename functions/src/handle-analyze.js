const { ALLOWED_MIME, MAX_UPLOAD_BYTES, REQUEST_BUDGET_MS } = require("./config");
const { getClientIp, checkRateLimit } = require("./middleware");
const { parseMultipart, parseJsonBody } = require("./upload");
const { analyzeWithVision } = require("./vision");
const { buildPrivacyRisks } = require("./privacy");
const gemini = require("./gemini");
const mistral = require("./mistral");
const { classifyLabels, buildAnimalProfiles, AGE_LABELS } = require("./animal");
const { resolveLanguage, loadPrompts } = require("./i18n");
const { checkAndIncrement, incrementTotals, getMaintenanceStatus } = require("./counter");
const { notifyLimitReached } = require("./notify");
const { ALLOWED_ORIGINS } = require("./domains");
const { getFeatureFlags } = require("./feature-flags");

const { describeImage, buildDescriptionFromLabels, generateBothProfiles } = gemini;

async function handleAnalyze(req, res, secrets) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const requestStart = Date.now();
  const remainingBudget = () => Math.max(0, REQUEST_BUDGET_MS - (Date.now() - requestStart));
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
       Erst NACH Honeypot/Demo/Validierung zählen, damit ungültige Requests
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

    /* ── Vision API ── */
    const visionResult = await analyzeWithVision(imageBuffer, remainingBudget());

    /* ── Personen-/Tier-Check (VOR Label-Filterung) ── */
    const { hasPerson, hasAnimal, rawLabelsLower } = classifyLabels(visionResult.labels);

    /* Alters-Labels filtern (unzuverlässig, vergiften Profilgenerierung) */
    visionResult.labels = visionResult.labels.filter((l) => !AGE_LABELS.includes(l.toLowerCase()));

    /* EXIF kommt vom Client (ohne GPS — GPS bleibt im Browser) */
    const exif = file.clientExif || {};

    const privacyRisks = buildPrivacyRisks({
      ocrText: visionResult.ocrText,
      exif,
      labels: visionResult.labels,
    });

    /* Tier-Check: Wenn NUR Tier-Labels und keine Personen-Labels → Easter-Egg-Profil */
    if (!hasPerson && hasAnimal) {
      const { normalProfile, boostProfile } = buildAnimalProfiles(rawLabelsLower, lang);

      /* BUG-007: Privacy-Risks und EXIF auch bei Tier-Fotos durchreichen —
         ein sichtbares Nummernschild im Hintergrund soll trotzdem gemeldet werden */
      incrementTotals().catch((err) => {
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: err.message }));
      });
      res.json({
        profiles: { normal: normalProfile, boost: boostProfile },
        privacyRisks,
        exif,
        meta: { requestId, mode: "animal" },
      });
      console.log(JSON.stringify({ requestId, status: "ok", mode: "animal" }));
      return;
    }

    /* ── Provider-Wahl per Feature-Flag ──
       Default ist "gemini" — der heutige Live-Pfad. "hybrid" aktiviert
       Mistral als Primär-Provider mit Gemini als Schicht-Fallback. */
    const flags = await getFeatureFlags();
    const provider = flags.aiProvider;
    console.log(JSON.stringify({ requestId, step: "provider-choice", provider }));

    /* ── Stage 1: Bildbeschreibung mit Fallback-Chain ── */
    const describeResult = await runDescribeStage({
      provider,
      imageBuffer,
      mimeType: file.mimeType,
      visionResult,
      exif,
      remainingBudget,
      lang,
      requestId,
    });
    let imageDescription = describeResult.text;
    const describeBlocked = describeResult.blocked;
    const describeError = describeResult.errored;
    let quotaError = describeResult.quotaHit;
    const usedFallback = describeResult.usedLabelFallback;

    /* ── Stage 2: Profile generieren mit Fallback-Chain ── */
    let profiles = { normal: null, boost: null };
    let profileBlocked = false;
    if (imageDescription) {
      const profileResult = await runProfileStage({
        provider,
        imageDescription,
        visionResult,
        exif,
        privacyRisks,
        remainingBudget,
        lang,
        requestId,
      });
      profiles = profileResult.profiles;
      profileBlocked = profileResult.blocked;
      if (profileResult.quotaHit) quotaError = true;
    }

    /* ── Response ── */
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
        meta: { requestId, mode: "multimodal" },
      });
    } else {
      let blockedReason;
      if (quotaError) {
        blockedReason = "blocked.overloaded";
      } else if (describeBlocked && !usedFallback) {
        blockedReason = "blocked.safetyFilter";
      } else if (describeBlocked && usedFallback && profileBlocked) {
        blockedReason = "blocked.safetyFilterFallback";
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
    }

    console.log(JSON.stringify({ requestId, status: "ok" }));
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "unknown_error";
    console.log(JSON.stringify({ requestId, status: "error", code }));
    res.status(status).json({ error: "Analyze failed", code });
  }
}

/* ── Multi-Provider-Pipeline-Helfer (Phase 3 Mistral-Migration) ──
   Diese Funktionen kapseln die Fallback-Chain pro Stage. Live-Pfad bleibt
   unverändert solange aiProvider="gemini" gesetzt ist (Default). */

async function runDescribeStage({
  provider,
  imageBuffer,
  mimeType,
  visionResult,
  exif,
  remainingBudget,
  lang,
  requestId,
}) {
  const result = {
    text: null,
    blocked: false,
    errored: false,
    quotaHit: false,
    usedLabelFallback: false,
  };

  /* Reihenfolge der Provider abhängig vom Flag. */
  const order = provider === "hybrid" ? ["mistral", "gemini"] : ["gemini"];

  for (const p of order) {
    try {
      const text =
        p === "mistral"
          ? await mistral.describeImage(imageBuffer, mimeType, remainingBudget, lang)
          : await describeImage(imageBuffer, mimeType, remainingBudget, lang);

      console.log(
        JSON.stringify({
          requestId,
          step: "describe",
          provider: p,
          status: text ? "ok" : "blocked",
          length: text ? text.length : 0,
        })
      );

      if (text) {
        result.text = text;
        return result;
      }
      /* Leerer Text: bei Gemini = Safety-Block. Bei Mistral = unwahrscheinlich
         aber theoretisch möglich. Wir markieren describe als blockiert nur wenn
         AUCH der letzte Provider in der Chain leer kam. */
      result.blocked = true;
    } catch (err) {
      result.errored = true;
      if (gemini.isQuotaError(err) || /rate_limit|quota/i.test(err.message || "")) {
        result.quotaHit = true;
      }
      console.log(
        JSON.stringify({
          requestId,
          step: "describe",
          provider: p,
          status: "error",
          error: err.message,
        })
      );
      /* Bei Mistral-Fehler weiter zu Gemini fallen. Bei Gemini-Fehler ist die Chain
         hier vorbei und der Label-Fallback unten greift. */
    }
  }

  /* Letzter Fallback: Vision-API-Labels in Fließtext bauen. Funktioniert für
     beide Provider — der Profil-Schritt kommt sowieso mit Text aus. */
  const labelDesc = buildDescriptionFromLabels(visionResult, exif, lang);
  if (labelDesc) {
    let text = labelDesc;
    if (result.blocked) {
      text += loadPrompts(lang).blockedImageHint;
    }
    result.text = text;
    result.usedLabelFallback = true;
    console.log(
      JSON.stringify({
        requestId,
        step: "describe-fallback",
        status: "using-labels",
        length: text.length,
      })
    );
  }

  return result;
}

async function runProfileStage({
  provider,
  imageDescription,
  visionResult,
  exif,
  privacyRisks,
  remainingBudget,
  lang,
  requestId,
}) {
  const result = { profiles: { normal: null, boost: null }, blocked: false, quotaHit: false };

  const order = provider === "hybrid" ? ["mistral", "gemini"] : ["gemini"];

  for (const p of order) {
    try {
      const profiles =
        p === "mistral"
          ? await mistral.generateBothProfiles(
              imageDescription,
              visionResult.labels,
              exif,
              privacyRisks,
              remainingBudget,
              lang
            )
          : await generateBothProfiles(
              imageDescription,
              visionResult.labels,
              exif,
              privacyRisks,
              remainingBudget,
              lang
            );

      console.log(
        JSON.stringify({
          requestId,
          step: "profiles",
          provider: p,
          normal: !!(profiles && profiles.normal),
          boost: !!(profiles && profiles.boost),
        })
      );

      const hasAny = profiles && (profiles.normal || profiles.boost);
      if (hasAny) {
        result.profiles = profiles;
        return result;
      }
      /* Beide leer: nächster Provider in der Chain. */
    } catch (err) {
      if (gemini.isQuotaError(err) || /rate_limit|quota/i.test(err.message || "")) {
        result.quotaHit = true;
      }
      console.log(
        JSON.stringify({
          requestId,
          step: "profiles",
          provider: p,
          status: "error",
          error: err.message,
        })
      );
      /* Fallback zum nächsten Provider. */
    }
  }

  result.blocked = true;
  return result;
}

module.exports = { handleAnalyze };
