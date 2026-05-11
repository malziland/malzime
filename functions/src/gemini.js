const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require("@google/genai");
const { DESCRIBE_MODELS, PROFILE_MODELS, API_TIMEOUT_MS } = require("./config");
const { loadPrompts } = require("./i18n");

function isQuotaError(err) {
  const msg = (err.message || "").toLowerCase();
  return (
    (msg.includes("resource") && msg.includes("exhausted")) ||
    msg.includes("quota") ||
    msg.includes("too many requests") ||
    msg.includes("429") ||
    err.code === 8 ||
    err.status === 429
  );
}

/** SEC-003: Escapet Sonderzeichen die XML-Tags aufbrechen koennten */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSafetySettings() {
  return [
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];
}

let genaiInstance = null;
function getGenAI() {
  if (!genaiInstance) {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "malzime";
    const location = process.env.VERTEX_LOCATION || "europe-west1";
    genaiInstance = new GoogleGenAI({ vertexai: true, project, location });
  }
  return genaiInstance;
}

/* Nur fuer Tests: erlaubt Mock-Injection ohne neue Instanz pro Modul-Load. */
function setGenAIForTest(instance) {
  genaiInstance = instance;
}

async function describeImageWithModel(genai, modelName, imageBuffer, mimeType, prompt, timeoutMs) {
  let timeoutId;
  const apiPromise = genai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { data: imageBuffer.toString("base64"), mimeType: mimeType || "image/jpeg" } },
        ],
      },
    ],
    config: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 },
      safetySettings: getSafetySettings(),
    },
  });
  const effectiveTimeout = timeoutMs != null ? Math.min(API_TIMEOUT_MS, timeoutMs) : API_TIMEOUT_MS;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Gemini describe timeout")), effectiveTimeout);
  });
  let response;
  try {
    response = await Promise.race([apiPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  /* @google/genai gibt das GenerateContentResponse direkt zurueck — kein
     verschachteltes .response wie bei @google-cloud/vertexai. */
  const candidates = response.candidates || [];
  const text =
    candidates[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("") || "";
  const finishReason = candidates[0]?.finishReason || "NO_CANDIDATES";

  return { text: text.trim(), finishReason, candidateCount: candidates.length };
}

async function describeImage(imageBuffer, mimeType, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const genai = getGenAI();
  let quotaHit = false;

  for (const modelName of DESCRIBE_MODELS) {
    try {
      const budget = remainingBudget ? remainingBudget() : undefined;
      if (budget != null && budget <= 0) break;
      const result = await describeImageWithModel(
        genai,
        modelName,
        imageBuffer,
        mimeType,
        prompts.describePrompt,
        budget
      );
      if (result.text) {
        console.log(JSON.stringify({ step: "describe", model: modelName, status: "ok", length: result.text.length }));
        return result.text;
      }
      console.log(
        JSON.stringify({
          step: "describe",
          model: modelName,
          status: "empty",
          finishReason: result.finishReason,
          candidateCount: result.candidateCount,
        })
      );
    } catch (err) {
      if (isQuotaError(err)) quotaHit = true;
      console.log(JSON.stringify({ step: "describe", model: modelName, status: "error", error: err.message }));
    }
  }

  /* Fallback: neutraler Prompt ohne "accessibility tool" Framing —
     wird seltener von Sicherheitsfiltern geblockt */
  for (const modelName of DESCRIBE_MODELS) {
    try {
      const budget = remainingBudget ? remainingBudget() : undefined;
      if (budget != null && budget <= 0) break;
      const result = await describeImageWithModel(
        genai,
        modelName,
        imageBuffer,
        mimeType,
        prompts.describeFallback,
        budget
      );
      if (result.text) {
        console.log(
          JSON.stringify({ step: "describe-neutral", model: modelName, status: "ok", length: result.text.length })
        );
        return result.text;
      }
      console.log(
        JSON.stringify({
          step: "describe-neutral",
          model: modelName,
          status: "empty",
          finishReason: result.finishReason,
        })
      );
    } catch (err) {
      if (isQuotaError(err)) quotaHit = true;
      console.log(JSON.stringify({ step: "describe-neutral", model: modelName, status: "error", error: err.message }));
    }
  }

  if (quotaHit) {
    const e = new Error("API quota exceeded");
    e.code = "quota_exceeded";
    throw e;
  }
  return null;
}

function buildDescriptionFromLabels(visionResult, exif, lang) {
  const prompts = loadPrompts(lang || "de");
  const parts = [];
  if (visionResult.labels.length > 0) {
    parts.push(`${prompts.labelElements}: ${visionResult.labels.join(", ")}.`);
  }
  if (visionResult.objects && visionResult.objects.length > 0) {
    parts.push(`${prompts.labelObjects}: ${visionResult.objects.join(", ")}.`);
  }
  if (visionResult.faces && visionResult.faces.length > 0) {
    const faceDescs = visionResult.faces.map((f, i) => {
      const desc = [`${prompts.labelPerson} ${i + 1}`];
      if (f.emotions.length > 0) desc.push(`${prompts.labelEmotion}: ${f.emotions.join(", ")}`);
      if (f.hasHeadwear) desc.push(prompts.labelHeadwear);
      return desc.join(", ");
    });
    parts.push(`${prompts.labelFaces} (${visionResult.faces.length}): ${faceDescs.join("; ")}.`);
  }
  if (visionResult.landmarks.length > 0) {
    parts.push(`${prompts.labelLandmarks}: ${visionResult.landmarks.join(", ")}.`);
  }
  if (visionResult.ocrText) {
    parts.push(`${prompts.labelOcrText}: "${visionResult.ocrText}".`);
  }
  if (exif.make || exif.model) {
    parts.push(`${prompts.labelCamera}: ${[exif.make, exif.model].filter(Boolean).join(" ")}.`);
  }
  /* dateTimeOriginal bewusst NICHT an Gemini senden —
     verleitet das Modell zu falschen Altersschaetzungen bei aelteren Fotos */
  return parts.length > 0 ? parts.join(" ") : null;
}

function buildPrompt(prompts, systemContext, imageDescription, labelsContext, exifContext, privacyContext, schema) {
  /* SEC-003: Dynamische Inhalte escapen um Prompt-Injection via XML-Tags zu verhindern */
  const safeDesc = escapeXml(imageDescription);
  const safeLabels = labelsContext ? escapeXml(labelsContext) : "";
  const safeExif = exifContext ? escapeXml(exifContext) : "";
  const safePrivacy = privacyContext ? escapeXml(privacyContext) : "";

  return `${systemContext}

${prompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>
${safeLabels ? `\n<vision_labels>${safeLabels}</vision_labels>` : ""}${safeExif ? `\n<exif_daten>${safeExif}</exif_daten>` : ""}${safePrivacy ? `\n<privacy_risiken>${safePrivacy}</privacy_risiken>` : ""}

${prompts.workshopNote}
${schema}`;
}

async function runProfileWithFallback(genai, prompt, temperature, mode, remainingBudget) {
  let quotaHit = false;
  for (const modelName of PROFILE_MODELS) {
    const budget = remainingBudget ? remainingBudget() : undefined;
    if (budget != null && budget <= 0) break;
    const effectiveTimeout = budget != null ? Math.min(API_TIMEOUT_MS, budget) : API_TIMEOUT_MS;
    let timeoutId;
    try {
      const apiPromise = genai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          safetySettings: getSafetySettings(),
        },
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Gemini profile timeout")), effectiveTimeout);
      });
      const response = await Promise.race([apiPromise, timeoutPromise]);
      clearTimeout(timeoutId);

      const candidate = response.candidates?.[0];
      const text =
        candidate?.content?.parts
          ?.map((p) => p.text)
          .filter(Boolean)
          .join("") || "";

      if (!text.trim()) {
        console.log(
          JSON.stringify({
            step: `profile-${mode}`,
            model: modelName,
            status: "empty",
            finishReason: candidate?.finishReason,
          })
        );
        continue;
      }

      let cleaned = text
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      try {
        const parsed = JSON.parse(cleaned);

        /* SEC-004: Output-Schema-Validierung — nur gueltige Profile durchlassen */
        if (!parsed || typeof parsed !== "object" || !parsed.categories || typeof parsed.categories !== "object") {
          console.log(JSON.stringify({ step: `profile-${mode}`, model: modelName, status: "invalid-schema" }));
          continue;
        }

        /* SEC-004: Bounds auf Categories (max 20 Keys, Strings auf 800 Zeichen) */
        const catKeys = Object.keys(parsed.categories).slice(0, 20);
        const boundedCats = {};
        for (const key of catKeys) {
          const cat = parsed.categories[key];
          if (cat && typeof cat === "object") {
            boundedCats[key] = {
              label: typeof cat.label === "string" ? cat.label.slice(0, 200) : String(key),
              value: typeof cat.value === "string" ? cat.value.slice(0, 800) : "",
              confidence: typeof cat.confidence === "number" ? Math.max(0, Math.min(1, cat.confidence)) : 0.5,
            };
          }
        }
        parsed.categories = boundedCats;

        if (!Array.isArray(parsed.ad_targeting)) parsed.ad_targeting = [];
        else
          parsed.ad_targeting = parsed.ad_targeting
            .filter((s) => typeof s === "string")
            .map((s) => s.slice(0, 300))
            .slice(0, 20);
        if (!Array.isArray(parsed.manipulation_triggers)) parsed.manipulation_triggers = [];
        else
          parsed.manipulation_triggers = parsed.manipulation_triggers
            .filter((s) => typeof s === "string")
            .map((s) => s.slice(0, 500))
            .slice(0, 10);
        if (typeof parsed.profileText !== "string") parsed.profileText = "";
        else parsed.profileText = parsed.profileText.slice(0, 2000);

        console.log(JSON.stringify({ step: `profile-${mode}`, model: modelName, status: "ok" }));
        return parsed;
      } catch (_err) {
        console.log(JSON.stringify({ step: `profile-${mode}`, model: modelName, status: "json-error" }));
        continue;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (isQuotaError(err)) quotaHit = true;
      console.log(JSON.stringify({ step: `profile-${mode}`, model: modelName, status: "error", error: err.message }));
      continue;
    }
  }
  if (quotaHit) {
    const e = new Error("API quota exceeded");
    e.code = "quota_exceeded";
    throw e;
  }
  return null;
}

async function generateBothProfiles(imageDescription, visionLabels, exifData, privacyRisks, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const genai = getGenAI();

  const { dateTimeOriginal: _dateTimeOriginal, ...exifWithoutDate } = exifData;
  const exifContext =
    Object.keys(exifWithoutDate).length > 0 ? `\n${prompts.labelExif}: ${JSON.stringify(exifWithoutDate)}` : "";
  const labelsContext = visionLabels.length > 0 ? `\n${prompts.labelVisionLabels}: ${visionLabels.join(", ")}` : "";
  const privacyContext = privacyRisks.length > 0 ? `\n${prompts.labelPrivacyRisks}: ${privacyRisks.join("; ")}` : "";

  const normalPrompt = buildPrompt(
    prompts,
    prompts.systemNormal,
    imageDescription,
    labelsContext,
    exifContext,
    privacyContext,
    prompts.jsonSchemaNormal
  );
  const boostPrompt = buildPrompt(
    prompts,
    prompts.systemBoost,
    imageDescription,
    labelsContext,
    exifContext,
    privacyContext,
    prompts.jsonSchemaBoost
  );

  const [normal, boost] = await Promise.all([
    runProfileWithFallback(genai, normalPrompt, 0.7, "normal", remainingBudget),
    runProfileWithFallback(genai, boostPrompt, 1.0, "boost", remainingBudget),
  ]);

  return { normal, boost };
}

module.exports = {
  describeImage,
  buildDescriptionFromLabels,
  generateBothProfiles,
  buildPrompt,
  escapeXml,
  isQuotaError,
  setGenAIForTest,
};
