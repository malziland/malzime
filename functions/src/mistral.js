"use strict";

/**
 * mistral.js — Mistral-Anbieter für die Hybrid-Pipeline.
 *
 * Spiegelt die Schnittstelle von gemini.js, damit handle-analyze.js
 * provider-agnostisch bleibt:
 *   - describeImage(buffer, mimeType, remainingBudget, lang) → text | null
 *   - generateBothProfiles(description, ...) → { normal, boost }
 *
 * Hybrid-Architektur:
 *   - Describe: Mistral Large 3 (multimodal, sieht das Bild direkt)
 *   - Normal/Boost: Mistral Small 4 (text-only, schneller + billiger)
 *
 * Mistral hat KEINE Vision-API-Safety-Filter, daher keine separate Fallback-
 * Beschreibung wie bei Gemini. Sollte Large 3 doch fehlschlagen, gibt
 * describeImage null zurück — die nachgelagerte Fallback-Chain (Gemini etc.)
 * springt dann ein (siehe handle-analyze.js in Phase 3).
 *
 * API-Key kommt aus process.env.MISTRAL_API_KEY (Firebase Secret).
 */

const {
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_DESCRIBE_MAX_TOKENS,
  MISTRAL_PROFILE_MAX_TOKENS,
  MISTRAL_TIMEOUT_MS,
} = require("./config");
const { loadPrompts } = require("./i18n");
const { parseSafely } = require("./json-repair");

/* Wird beim Modul-Load via env-Variable gelesen. NICHT hartcodiert. */
function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    const e = new Error("MISTRAL_API_KEY environment variable not set");
    e.code = "no_api_key";
    throw e;
  }
  return key;
}

/* Für Tests: erlaubt fetch zu mocken ohne globalThis zu überschreiben. */
let fetchImpl = (...args) => fetch(...args);
function setFetchForTest(impl) {
  fetchImpl = impl || ((...args) => fetch(...args));
}

/* ── Rate-Limit-Detection (für Telemetrie + Fallback-Entscheidung) ── */

function isRateLimitError(err) {
  const msg = (err.message || "").toLowerCase();
  return err.status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limited");
}

/* ── Low-Level: HTTP-Call mit Timeout + Retry bei 429 ── */

async function callMistralRaw({ model, messages, maxTokens, temperature, forceJSON, timeoutMs }) {
  const apiKey = getApiKey();

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (forceJSON) body.response_format = { type: "json_object" };

  /* Bis zu 2 Retry-Versuche bei 429 (kurzer Burst); danach Fehler nach oben. */
  const backoffs = [1000, 3000];
  let lastError;

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const controller = new AbortController();
    const effectiveTimeout = timeoutMs || MISTRAL_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    let res;
    try {
      res = await fetchImpl(MISTRAL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const e = new Error(`Mistral request timeout after ${effectiveTimeout}ms`);
        e.code = "timeout";
        throw e;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (res.status === 429 && attempt < backoffs.length) {
      lastError = new Error("Mistral 429 rate limited");
      lastError.status = 429;
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
      continue;
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch (_) {
        /* ignore */
      }
      const e = new Error(`Mistral HTTP ${res.status}: ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`);
      e.status = res.status;
      throw e;
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    let text = "";
    const msgContent = choice?.message?.content;
    if (typeof msgContent === "string") {
      text = msgContent;
    } else if (Array.isArray(msgContent)) {
      text = msgContent
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
    const usage = json.usage || {};
    return {
      text: text.trim(),
      finishReason: choice?.finish_reason || "unknown",
      promptTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
    };
  }

  /* Wenn wir hier landen, sind alle Retry-Versuche fehlgeschlagen mit 429 */
  throw lastError || new Error("Mistral request failed");
}

/* ── Public: describeImage (multimodal via Large 3) ──────────────── */

async function describeImage(imageBuffer, mimeType, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const addendum = prompts.mistralDescribeAddendum || "";

  /* Versuch 1: regulärer Describe-Prompt */
  const result = await tryDescribeWithPrompt(prompts.describePrompt + addendum, imageBuffer, mimeType, remainingBudget);
  if (result && result.text) return result.text;

  /* Versuch 2: Fallback-Prompt (weniger triggerig) */
  const fallback = await tryDescribeWithPrompt(
    prompts.describeFallback + addendum,
    imageBuffer,
    mimeType,
    remainingBudget
  );
  if (fallback && fallback.text) return fallback.text;

  return null;
}

async function tryDescribeWithPrompt(prompt, imageBuffer, mimeType, remainingBudget) {
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: dataUrl },
      ],
    },
  ];

  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL,
      messages,
      maxTokens: MISTRAL_DESCRIBE_MAX_TOKENS,
      temperature: 0.2,
      forceJSON: false,
      timeoutMs: budget,
    });
    console.log(
      JSON.stringify({
        step: "mistral-describe",
        model: MISTRAL_DESCRIBE_MODEL,
        status: result.text ? "ok" : "empty",
        finishReason: result.finishReason,
        length: result.text.length,
      })
    );
    return result;
  } catch (err) {
    console.log(
      JSON.stringify({ step: "mistral-describe", model: MISTRAL_DESCRIBE_MODEL, status: "error", error: err.message })
    );
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    /* Andere Fehler bewusst NICHT propagieren — Caller bekommt null und fällt auf
       die nächste Schicht (Gemini etc.) zurück. */
    return null;
  }
}

/* ── Public: generateBothProfiles (Hybrid mit Small 4) ────────────── */

async function generateBothProfiles(imageDescription, visionLabels, exifData, privacyRisks, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");

  /* Im Hybrid-Modus IGNORIEREN wir visionLabels und privacyRisks — Mistral
     bekommt nur die Beschreibung (Large 3 hat oben das Bild selbst gesehen).
     EXIF-Kameradaten (make/model) bleiben sinnvoll und werden mitgegeben. */
  const { dateTimeOriginal: _dateTimeOriginal, ...exifWithoutDate } = exifData || {};
  const exifContext =
    Object.keys(exifWithoutDate).length > 0 ? `\n${prompts.labelExif}: ${JSON.stringify(exifWithoutDate)}` : "";

  /* visionLabels und privacyRisks sind im Hybrid-Mistral-Pfad bewusst leer.
     Die Variablen werden trotzdem entgegengenommen, damit handle-analyze.js
     mit derselben Signatur beide Provider aufrufen kann. */
  void visionLabels;
  void privacyRisks;

  const normalPrompt = buildProfilePrompt(
    prompts,
    prompts.systemNormal,
    imageDescription,
    exifContext,
    prompts.jsonSchemaNormal
  );
  const boostPrompt = buildProfilePrompt(
    prompts,
    prompts.systemBoost,
    imageDescription,
    exifContext,
    prompts.jsonSchemaBoost
  );

  const [normal, boost] = await Promise.all([
    runProfile(normalPrompt, 0.7, "normal", remainingBudget),
    runProfile(boostPrompt, 1.0, "boost", remainingBudget),
  ]);

  return { normal, boost };
}

function buildProfilePrompt(prompts, systemContext, imageDescription, exifContext, schema) {
  /* Selbe XML-Injection-Defense wie in gemini.js — escapeXml wird hier
     manuell gespiegelt, damit wir keine Cross-Dependency haben. */
  const safeDesc = escapeXml(imageDescription || "");
  const safeExif = exifContext ? escapeXml(exifContext) : "";
  return `${systemContext}

${prompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>${safeExif ? `\n<exif_daten>${safeExif}</exif_daten>` : ""}

${prompts.workshopNote}
${schema}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function runProfile(prompt, temperature, mode, remainingBudget) {
  const messages = [{ role: "user", content: prompt }];

  /* Versuch 1: Small 4 als Hybrid-Default */
  const small4 = await tryProfileCall({
    model: MISTRAL_PROFILE_MODEL,
    messages,
    temperature,
    mode,
    remainingBudget,
    isFallback: false,
  });
  if (small4) return small4;

  /* Versuch 2: Large 3 als Fallback wenn Small 4 ausfällt */
  const large3 = await tryProfileCall({
    model: MISTRAL_FALLBACK_MODEL,
    messages,
    temperature,
    mode,
    remainingBudget,
    isFallback: true,
  });
  return large3;
}

async function tryProfileCall({ model, messages, temperature, mode, remainingBudget, isFallback }) {
  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model,
      messages,
      maxTokens: MISTRAL_PROFILE_MAX_TOKENS,
      temperature,
      forceJSON: true,
      timeoutMs: budget,
    });

    if (!result.text) {
      console.log(
        JSON.stringify({ step: `mistral-profile-${mode}`, model, status: "empty", finishReason: result.finishReason })
      );
      return null;
    }

    const stages = [];
    const parsed = parseSafely(result.text, {
      onRepair: (stage, err) => {
        stages.push(stage + (err ? `:${err.message.slice(0, 60)}` : ""));
      },
    });

    if (!parsed) {
      console.log(
        JSON.stringify({
          step: `mistral-profile-${mode}`,
          model,
          status: "parse-failed",
          finishReason: result.finishReason,
          repairStages: stages,
        })
      );
      return null;
    }

    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "ok",
        finishReason: result.finishReason,
        isFallback,
        repairStages: stages,
      })
    );
    return parsed;
  } catch (err) {
    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "error",
        error: err.message,
        isFallback,
      })
    );
    return null;
  }
}

module.exports = {
  describeImage,
  generateBothProfiles,
  isRateLimitError,
  /* Für Tests */
  setFetchForTest,
  _callMistralRaw: callMistralRaw,
};
