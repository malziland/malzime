#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Side-by-Side Vergleich der Live-Pipeline gegen den Hybrid-Kandidaten:
 *   Variante A: Heute live — Vision API + Gemini 2.5 Flash (3 KI-Calls)
 *   Variante B: Hybrid — Describe via Mistral Large 3, Normal+Boost via Mistral Small 4
 *               (Vision-Qualitaet von Large 3, Profil-Generierung guenstiger via Small 4)
 *
 * Architektur-Unterschied:
 *   - A (Gemini): Vision liest Text + Labels → fliesst in Profil-Prompt ein.
 *                 Vision Cost (~$0.003) wird mitgerechnet.
 *   - B (Hybrid Mistral): Multimodal, Large 3 sieht das Bild selbst inkl. Text und Objekten.
 *                          Keine Vision-Calls. Describe-Prompt bekommt Zusatz,
 *                          damit Text aus dem Bild explizit in die Beschreibung wandert.
 *                          Small 4 bekommt nur die Text-Beschreibung fuer die Profile.
 *
 * Live-System bleibt unveraendert. Skript schreibt nicht in Firestore.
 *
 * Aufruf (aus dem Projekt-Root):
 *   MISTRAL_API_KEY=<dein-key> node functions/scripts/compare-models.js <pfad-zum-bild>
 */

const PROJECT_ID = "malzime";

/* ENV-Variablen MUESSEN vor den require()-Aufrufen gesetzt werden,
   damit google-auth-library beim ersten Init die richtigen Werte liest. */
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = PROJECT_ID;

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { ImageAnnotatorClient } = require("@google-cloud/vision");
const { GoogleAuth } = require("google-auth-library");
const testPrompts = require("./test-prompts");
const { escapeXml, buildDescriptionFromLabels } = require("../src/gemini");
const { buildPrivacyRisks } = require("../src/privacy");

/* ── Konfiguration ── */
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

const GEMINI_LOCATION = "europe-west1";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_PRICE_IN = 0.3; // $/1M Input-Tokens
const GEMINI_PRICE_OUT = 2.5; // $/1M Output-Tokens

const MISTRAL_LARGE_MODEL = "mistral-large-latest"; // alias auf neueste Large-3
const MISTRAL_LARGE_PRICE_IN = 0.5; // $/1M Input-Tokens
const MISTRAL_LARGE_PRICE_OUT = 1.5; // $/1M Output-Tokens

const MISTRAL_MEDIUM_MODEL = "mistral-medium-3-5"; // Mistral Medium 3.5, 128B dense, multimodal
const MISTRAL_MEDIUM_PRICE_IN = 1.5; // $/1M Input-Tokens
const MISTRAL_MEDIUM_PRICE_OUT = 7.5; // $/1M Output-Tokens

const MISTRAL_SMALL_MODEL = "mistral-small-2603"; // Mistral Small 4, multimodal, GA seit 16.03.2026
const MISTRAL_SMALL_PRICE_IN = 0.15; // $/1M Input-Tokens
const MISTRAL_SMALL_PRICE_OUT = 0.6; // $/1M Output-Tokens

const VISION_COST_PER_ANALYSIS = 0.003;

const GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
];

/* ── Bild verkleinern wie Live-System (1280px max, JPEG 82%) ──
   Mistral Free-Tier hat 500K TPM — grosse Bilder sprengen das Limit. */
function maybeResizeImage(buffer, originalPath) {
  /* Unter ~600 KB lassen wir das Bild original */
  if (buffer.length < 600 * 1024) return { buffer, mimeType: detectMime(originalPath), resized: false };
  if (process.platform !== "darwin") {
    console.log(`     ⚠ Bild ist ${(buffer.length / 1024).toFixed(0)} KB — auf nicht-macOS-Systemen wird nicht automatisch verkleinert.`);
    return { buffer, mimeType: detectMime(originalPath), resized: false };
  }
  const tmpIn = path.join(os.tmpdir(), `cmp-in-${Date.now()}.jpg`);
  const tmpOut = path.join(os.tmpdir(), `cmp-out-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buffer);
    execSync(`sips -Z 1280 -s format jpeg -s formatOptions 82 "${tmpIn}" --out "${tmpOut}"`, { stdio: "ignore" });
    const resized = fs.readFileSync(tmpOut);
    return { buffer: resized, mimeType: "image/jpeg", resized: true };
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[ext] || "image/jpeg"
  );
}

/* ── Google Access-Token (gecacht) ── */
let _cachedToken = null;
let _cachedTokenExpires = 0;
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  if (_cachedToken && Date.now() < _cachedTokenExpires - 60000) {
    return _cachedToken;
  }
  const client = await auth.getClient();
  const resp = await client.getAccessToken();
  _cachedToken = resp.token;
  _cachedTokenExpires = Date.now() + 50 * 60 * 1000;
  return _cachedToken;
}

/* ── Vision API ── */
async function visionAnalyze(buffer) {
  const client = new ImageAnnotatorClient({
    apiEndpoint: "eu-vision.googleapis.com",
  });
  const [result] = await client.annotateImage({
    image: { content: buffer },
    features: [{ type: "TEXT_DETECTION" }, { type: "LABEL_DETECTION" }],
  });
  return {
    labels: (result.labelAnnotations || []).map((a) => a.description).filter(Boolean),
    ocrText: result.textAnnotations?.[0]?.description || "",
  };
}

/* ── Gemini-Call via REST (europe-west1) ── */
async function callGemini({ prompt, imageBuffer, mimeType, generationConfig }) {
  const token = await getAccessToken();
  const url =
    `https://${GEMINI_LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/locations/${GEMINI_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  const parts = [{ text: prompt }];
  if (imageBuffer) {
    parts.push({ inlineData: { data: imageBuffer.toString("base64"), mimeType } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  const json = await res.json();
  const candidate = json.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("") || "";
  const usage = json.usageMetadata || {};
  return {
    text: text.trim(),
    finishReason: candidate?.finishReason || "NO_CANDIDATE",
    promptTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/* ── Mistral-Call via REST (Paris-Server) mit Retry bei 429 + Timeout ──
   forceJSON: true setzt response_format auf json_object — Mistral muss dann
   valides JSON liefern. Funktioniert nur wenn das Wort "JSON" im Prompt steht
   (Mistral-API-Anforderung). Unser Profil-Schema enthaelt das. */
async function callMistral({ prompt, imageBuffer, mimeType, maxTokens, temperature, forceJSON, model }) {
  if (!MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY env-Variable nicht gesetzt");
  }
  if (!model) {
    throw new Error("callMistral: model-Parameter fehlt");
  }

  const content = [{ type: "text", text: prompt }];
  if (imageBuffer) {
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    content.push({ type: "image_url", image_url: dataUrl });
  }

  const body = {
    model,
    messages: [{ role: "user", content }],
    max_tokens: maxTokens,
    temperature,
  };
  if (forceJSON) {
    body.response_format = { type: "json_object" };
  }

  /* Bis zu 4 Retry-Versuche mit exponentialem Backoff bei 429 (Free-Tier Limit) */
  let res;
  const backoffs = [5000, 15000, 30000, 60000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    /* 240s Timeout pro Mistral-Call — Large-3 mit max_tokens=8192 + temperature=1.0
       kann ueber 2 Min brauchen. Achtung: Im Live-Betrieb ist das ein UX-Problem. */
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 240000);
    try {
      res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Mistral-Call timeout nach 120s — Modell zu langsam oder haengt");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    if (res.status !== 429 || attempt === backoffs.length) break;
    const wait = backoffs[attempt];
    console.log(`     ⏸ Mistral 429 (rate limited), warte ${wait / 1000}s und probiere erneut…`);
    await new Promise((r) => setTimeout(r, wait));
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Mistral HTTP ${res.status}: ${errBody.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  const json = await res.json();
  const choice = json.choices?.[0];
  /* Mistral kann content als String oder Array von Parts liefern */
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

/* Zusatz fuer Mistral-Describe: Mistral sieht das Bild direkt, hat aber keine
   separate Vision-Stufe. Damit Text-auf-Bild (Schilder, Logos, Tattoos,
   T-Shirt-Aufdrucke, Bildunterschriften) im Profil-Schritt verfuegbar bleibt,
   muessen sie EXPLIZIT in die Bildbeschreibung wandern. */
const MISTRAL_DESCRIBE_ADDENDUM = `

ZUSATZAUFGABE (kein separater Vision-Schritt):
Liste am Ende der Bildbeschreibung jeden auf dem Bild sichtbaren Text auf —
wortgenau wenn moeglich (Schilder, Strassennamen, Marken-Logos, Tattoos,
T-Shirt-/Trikot-Aufdrucke, Bildunterschriften, Display-Anzeigen).
Format: "Sichtbarer Text: <Text 1>; <Text 2>; ..." — leer lassen wenn kein Text.`;

/* ── Provider-Konfigurationen ── */
const PROVIDERS = {
  gemini: {
    name: "A: Heute live (Gemini 2.5 Flash + Vision API, europe-west1)",
    short: "Gemini 2.5 Flash",
    priceIn: GEMINI_PRICE_IN,
    priceOut: GEMINI_PRICE_OUT,
    usesVision: true,
    call: callGemini,
    describeConfig: { generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } },
    profileConfig: (t) => ({ generationConfig: { temperature: t, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } } }),
  },
  mistral: {
    name: "B: Mistral Large 3 multimodal (ohne Vision API, Paris)",
    short: "Mistral Large 3",
    model: MISTRAL_LARGE_MODEL,
    priceIn: MISTRAL_LARGE_PRICE_IN,
    priceOut: MISTRAL_LARGE_PRICE_OUT,
    usesVision: false,
    describeAddendum: MISTRAL_DESCRIBE_ADDENDUM,
    call: callMistral,
    describeConfig: { model: MISTRAL_LARGE_MODEL, maxTokens: 2048, temperature: 0.2 },
    /* max_tokens 5000 — Sicherheitsdeckel, kein Laengen-Ziel.
       Die LAENGEN-VORGABE in test-prompts.js zielt auf ca. 1500-2000 Tokens
       pro Profil; 5000 ist Puffer fuer den verbosen Boost-Modus, damit das
       JSON nicht mitten im Satz abreisst (Beobachtung Test 5 mit 4000). */
    profileConfig: (t) => ({ model: MISTRAL_LARGE_MODEL, maxTokens: 5000, temperature: t, forceJSON: true }),
  },
  mistralHybrid: {
    name: "B: Hybrid — Large 3 Describe + Small 4 Profile (ohne Vision API, Paris)",
    short: "Hybrid L3+S4",
    /* Per-Stage Preise: Describe nutzt Large 3 (bessere Vision), Profile nutzen Small 4 (billiger). */
    describePrice: { in: MISTRAL_LARGE_PRICE_IN, out: MISTRAL_LARGE_PRICE_OUT },
    profilePrice: { in: MISTRAL_SMALL_PRICE_IN, out: MISTRAL_SMALL_PRICE_OUT },
    usesVision: false,
    describeAddendum: MISTRAL_DESCRIBE_ADDENDUM,
    call: callMistral,
    describeConfig: { model: MISTRAL_LARGE_MODEL, maxTokens: 2048, temperature: 0.2 },
    profileConfig: (t) => ({ model: MISTRAL_SMALL_MODEL, maxTokens: 5000, temperature: t, forceJSON: true }),
  },
};

/* ── Beschreibung mit Fallback-Prompt (wie Live-System) ── */
async function describeImage(provider, buffer, mimeType, prompts) {
  let totalIn = 0;
  let totalOut = 0;
  const attempts = [];
  const addendum = provider.describeAddendum || "";

  for (const promptText of [prompts.describePrompt, prompts.describeFallback]) {
    const isFallback = promptText === prompts.describeFallback;
    const result = await provider.call({
      prompt: promptText + addendum,
      imageBuffer: buffer,
      mimeType,
      ...provider.describeConfig,
    });
    totalIn += result.promptTokens;
    totalOut += result.outputTokens;
    attempts.push(`${isFallback ? "fallback" : "primary"}=${result.finishReason}`);
    if (result.text) {
      return {
        text: result.text,
        promptTokens: totalIn,
        outputTokens: totalOut,
        usedFallback: isFallback,
        finishReason: result.finishReason,
      };
    }
  }

  return {
    text: "",
    promptTokens: totalIn,
    outputTokens: totalOut,
    blocked: true,
    blockedReason: attempts.join(", "),
  };
}

/* ── Prompt-Bau identisch zur Live-Pipeline ── */
function buildProfilePrompt(prompts, systemContext, imageDescription, labelsContext, privacyContext, schema) {
  const safeDesc = escapeXml(imageDescription);
  const safeLabels = labelsContext ? escapeXml(labelsContext) : "";
  const safePrivacy = privacyContext ? escapeXml(privacyContext) : "";
  return `${systemContext}

${prompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>${safeLabels ? `\n<vision_labels>${safeLabels}</vision_labels>` : ""}${safePrivacy ? `\n<privacy_risiken>${safePrivacy}</privacy_risiken>` : ""}

${prompts.workshopNote}
${schema}`;
}

async function generateProfile(provider, prompt, temperature, label) {
  const result = await provider.call({
    prompt,
    ...provider.profileConfig(temperature),
  });
  let cleaned = result.text
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parseError = err.message;
  }
  if (!parsed) {
    dumpFailedProfile({
      provider,
      label,
      parseError,
      finishReason: result.finishReason,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      rawText: result.text,
      cleaned,
    });
  }
  return {
    profile: parsed,
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    finishReason: result.finishReason,
  };
}

/* Diagnose-Hilfe: bei JSON-Parse-Fehler komplette Rohausgabe + Metadaten in
   eine Datei schreiben und Konsole mit deutlicher Hypothesen-Einordnung
   informieren. So koennen wir Refusal vs. Truncation vs. JSON-Bug unterscheiden. */
function dumpFailedProfile({ provider, label, parseError, finishReason, promptTokens, outputTokens, rawText, cleaned }) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeProvider = String(provider.short || "provider").replace(/\s+/g, "-").toLowerCase();
  const filename = `compare-failed-${safeProvider}-${label || "profile"}-${ts}.txt`;
  const filepath = path.join(process.cwd(), filename);

  /* Hypothesen-Einordnung basierend auf finishReason und Inhalt */
  let diagnosis = "UNKLAR — Inhalt der Datei pruefen.";
  const reasonLower = String(finishReason || "").toLowerCase();
  const textLower = (rawText || "").toLowerCase();
  if (reasonLower.includes("length") || reasonLower.includes("max_tokens")) {
    diagnosis = "TRUNCATION (Hypothese 2) — finishReason zeigt max_tokens-Limit. Fix: max_tokens erhoehen.";
  } else if (reasonLower.includes("content_filter") || reasonLower.includes("safety")) {
    diagnosis = "REFUSAL (Hypothese 1) — finishReason zeigt Content-Filter. Mistral verweigert die Generierung.";
  } else if (
    /\b(i can't|i cannot|sorry|policy|guidelines|harmful|inappropriate|verweiger|kann ich nicht|nicht erstellen|ethisch|leider)\b/i.test(
      textLower
    )
  ) {
    diagnosis = "REFUSAL (Hypothese 1) — Refusal-Phrasen im Text erkannt, finishReason aber unverdaechtig. Modell verweigert 'soft'.";
  } else if (cleaned && /[,}]\s*$/.test(cleaned) === false && cleaned.length > 100) {
    diagnosis = "JSON-BUG oder TRUNCATION (Hypothese 2 oder 3) — Text scheint mitten im Wert abzubrechen. Letzte 200 Zeichen in der Datei pruefen.";
  } else {
    diagnosis = "JSON-BUG (Hypothese 3) — Text scheint vollstaendig, aber syntaktisch invalid (Trailing Comma, unescaped Quote o.ae.).";
  }

  const header = [
    `=== Diagnose-Dump: ${provider.short} — ${label} ===`,
    `Zeitstempel:    ${new Date().toLocaleString("de-AT")}`,
    `Provider:       ${provider.short}`,
    `Profile-Typ:    ${label}`,
    `JSON-Fehler:    ${parseError || "(kein Parse-Versuch)"}`,
    `finishReason:   ${finishReason || "(unbekannt)"}`,
    `Tokens:         in=${promptTokens}, out=${outputTokens}`,
    `Textlaenge:     ${(rawText || "").length} Zeichen`,
    `Hypothese:      ${diagnosis}`,
    "",
    "--- Letzte 200 Zeichen der gecleanten Ausgabe (Truncation-Check) ---",
    (cleaned || "").slice(-200),
    "",
    "--- Vollstaendige Rohausgabe ---",
    "",
  ].join("\n");

  fs.writeFileSync(filepath, header + (rawText || ""));

  console.log(`     ⚠ ${provider.short} (${label}): JSON-Parse fehlgeschlagen`);
  console.log(`        → finishReason: ${finishReason || "unbekannt"}`);
  console.log(`        → Hypothese:    ${diagnosis}`);
  console.log(`        → Dump:         ${filename}`);
}

/* ── Komplette Pipeline mit einem Provider ──
   visionResult wird nur genutzt wenn provider.usesVision === true.
   Bei usesVision === false (Mistral) faellt sowohl Vision-Fallback als auch
   die Label-/Privacy-Anreicherung im Profil-Prompt weg — Mistral sieht das
   Bild direkt und extrahiert Text via describeAddendum. */
async function runPipeline(provider, buffer, mimeType, visionResult) {
  const prompts = testPrompts;
  const start = Date.now();
  const useVisionData = provider.usesVision === true;

  console.log(`     ⏳ ${provider.short}: Bildbeschreibung…`);
  let describe = await describeImage(provider, buffer, mimeType, prompts);
  let describeViaFallback = false;

  /* Vision-Labels-Fallback nur fuer Provider die Vision nutzen.
     Bei Mistral gibt es keinen Fallback — Block fuehrt zu Abbruch. */
  if (!describe.text) {
    if (!useVisionData) {
      throw new Error(`${provider.short}: Beschreibung blockiert — kein Vision-Fallback verfuegbar`);
    }
    const fallbackText = buildDescriptionFromLabels(
      { labels: visionResult.labels, objects: [], faces: [], landmarks: [], ocrText: visionResult.ocrText },
      {},
      "de"
    );
    if (!fallbackText) {
      throw new Error(`${provider.short}: Beschreibung blockiert und Vision-Labels auch leer`);
    }
    describe = { text: fallbackText, promptTokens: describe.promptTokens, outputTokens: describe.outputTokens };
    describeViaFallback = true;
    console.log(`     ⚠ ${provider.short}: Beschreibung blockiert → fallback auf Vision-Labels`);
  }

  let labelsContext = "";
  let privacyContext = "";
  if (useVisionData) {
    labelsContext =
      visionResult.labels.length > 0 ? `\n${prompts.labelVisionLabels}: ${visionResult.labels.join(", ")}` : "";
    const privacyRisks = buildPrivacyRisks({ ocrText: visionResult.ocrText, labels: visionResult.labels });
    privacyContext =
      privacyRisks.length > 0 ? `\n${prompts.labelPrivacyRisks}: ${privacyRisks.join("; ")}` : "";
  }

  const normalPrompt = buildProfilePrompt(
    prompts,
    prompts.systemNormal,
    describe.text,
    labelsContext,
    privacyContext,
    prompts.jsonSchemaNormal
  );
  const boostPrompt = buildProfilePrompt(
    prompts,
    prompts.systemBoost,
    describe.text,
    labelsContext,
    privacyContext,
    prompts.jsonSchemaBoost
  );

  /* PARALLEL — schneller, wie Live-System es machen wuerde.
     Bei 429 macht callMistral exponentiellen Backoff (5s-60s). */
  console.log(`     ⏳ ${provider.short}: Normal-Profil + Boost-Profil parallel…`);
  const [normal, boost] = await Promise.all([
    generateProfile(provider, normalPrompt, 0.7, "normal"),
    generateProfile(provider, boostPrompt, 1.0, "boost"),
  ]);
  console.log(`     ✓ ${provider.short}: Normal-Profil fertig (${normal.outputTokens} tok)`);
  console.log(`     ✓ ${provider.short}: Boost-Profil fertig (${boost.outputTokens} tok)`);
  const duration = Date.now() - start;

  const tokensIn = describe.promptTokens + normal.promptTokens + boost.promptTokens;
  const tokensOut = describe.outputTokens + normal.outputTokens + boost.outputTokens;

  /* Hybrid-Provider haben unterschiedliche Preise pro Stage (Describe vs. Profile).
     Fallback auf uniforme priceIn/priceOut fuer normale Provider. */
  const dIn = provider.describePrice?.in ?? provider.priceIn;
  const dOut = provider.describePrice?.out ?? provider.priceOut;
  const pIn = provider.profilePrice?.in ?? provider.priceIn;
  const pOut = provider.profilePrice?.out ?? provider.priceOut;
  const describeCost = (describe.promptTokens * dIn + describe.outputTokens * dOut) / 1_000_000;
  const profileCost = (
    (normal.promptTokens + boost.promptTokens) * pIn +
    (normal.outputTokens + boost.outputTokens) * pOut
  ) / 1_000_000;
  const aiCost = describeCost + profileCost;
  const visionCost = useVisionData ? VISION_COST_PER_ANALYSIS : 0;
  const totalCost = aiCost + visionCost;

  return {
    provider,
    describe: { ...describe, usedFallback: describeViaFallback },
    normal,
    boost,
    duration,
    tokensIn,
    tokensOut,
    aiCost,
    visionCost,
    totalCost,
  };
}

/* ── HTML-Helpers ── */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderText(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

function formatProfile(profile) {
  if (!profile) return '<em style="color:#f88">Profil konnte nicht generiert werden</em>';
  const cats = profile.categories || {};
  let html = "<dl>";
  for (const key of Object.keys(cats)) {
    const cat = cats[key];
    if (!cat) continue;
    html += `<dt>${escapeHtml(cat.label || key)}</dt>`;
    html += `<dd>${renderText(cat.value || "")}</dd>`;
  }
  html += "</dl>";
  if (Array.isArray(profile.ad_targeting) && profile.ad_targeting.length) {
    html += "<h4>Ad-Targeting</h4><ul>";
    for (const a of profile.ad_targeting) html += `<li>${renderText(a)}</li>`;
    html += "</ul>";
  }
  if (Array.isArray(profile.manipulation_triggers) && profile.manipulation_triggers.length) {
    html += "<h4>Manipulation-Trigger</h4><ul>";
    for (const t of profile.manipulation_triggers) html += `<li>${renderText(t)}</li>`;
    html += "</ul>";
  }
  if (profile.profileText) {
    html += `<h4>Profil-Text</h4><p>${renderText(profile.profileText)}</p>`;
  }
  return html;
}

function pct(a, b) {
  if (!a) return "–";
  const delta = ((b - a) / a) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(0)}%`;
}

function buildReport(imagePath, results) {
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const imageMime = detectMime(imagePath);
  const colorPct = (n) => (n.startsWith("-") ? "color:#8f8" : n.startsWith("+") ? "color:#f88" : "");
  const css = `
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 1600px; margin: 2rem auto;
           padding: 1rem; background: #1a1a1a; color: #eee; line-height: 1.5; }
    h1 { font-size: 1.3rem; margin: 0 0 0.5rem; }
    .imgwrap { text-align: center; margin: 1rem 0; }
    .imgwrap img { max-width: 360px; border: 1px solid #444; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: repeat(${results.length}, 1fr); gap: 1rem; }
    .col { background: #2a2a2a; padding: 1rem; border-radius: 8px; min-width: 0; }
    .col h2 { margin: 0 0 0.5rem; font-size: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid #444; }
    .meta { background: #1f1f1f; padding: 0.5rem 0.8rem; border-radius: 4px;
            margin-bottom: 1rem; font-size: 0.85rem; }
    .meta span { display: inline-block; margin-right: 0.8rem; }
    section { margin-bottom: 1.2rem; }
    section h3 { font-size: 0.9rem; color: #88f; margin: 0 0 0.3rem; text-transform: uppercase; letter-spacing: 0.05em; }
    dl { margin: 0; }
    dt { font-weight: 600; margin-top: 0.5rem; color: #fc8; font-size: 0.88rem; }
    dd { margin: 0.1rem 0 0.4rem; font-size: 0.9rem; word-wrap: break-word; }
    h4 { font-size: 0.82rem; color: #aaa; margin: 0.7rem 0 0.2rem;
         text-transform: uppercase; letter-spacing: 0.05em; }
    ul { margin: 0.2rem 0 0.3rem 1.2rem; padding: 0; font-size: 0.88rem; }
    p { font-size: 0.9rem; margin: 0.3rem 0; }
    .desc { font-style: italic; color: #bbb; font-size: 0.88rem; }
    table.summary { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.88rem; }
    table.summary th, table.summary td { padding: 0.5rem; border-bottom: 1px solid #333; text-align: left; }
    table.summary th { background: #2a2a2a; }
    .delta { font-size: 0.78rem; margin-left: 0.4rem; }
    .footer { color: #666; font-size: 0.75rem; margin-top: 2rem; }
  `;

  const columns = results
    .map(
      (r) => `
  <div class="col">
    <h2>${escapeHtml(r.provider.name)}</h2>
    <div class="meta">
      <span>⏱ <strong>${(r.duration / 1000).toFixed(1)}s</strong></span>
      <span>📥 ${r.tokensIn.toLocaleString()} tok</span>
      <span>📤 ${r.tokensOut.toLocaleString()} tok</span>
      <span>💰 <strong>$${r.totalCost.toFixed(4)}</strong></span>
    </div>
    <section>
      <h3>Bildbeschreibung${r.describe.usedFallback ? " (Fallback-Prompt)" : ""}</h3>
      <p class="desc">${renderText(r.describe.text)}</p>
    </section>
    <section>
      <h3>Normal-Profil</h3>
      ${formatProfile(r.normal.profile)}
    </section>
    <section>
      <h3>Boost-Profil</h3>
      ${formatProfile(r.boost.profile)}
    </section>
  </div>`
    )
    .join("");

  /* Summary-Zellen: erste Spalte (A) ohne Delta, B/C/... mit Delta gegen A. */
  const base = results[0];
  const cell = (value, baseValue, format, { withColor = false } = {}) => {
    const formatted = format(value);
    const p = pct(baseValue, value);
    const style = withColor ? colorPct(p) : "";
    return `<td>${formatted}<span class="delta" style="${style}">${p}</span></td>`;
  };
  const baseCell = (value, format) => `<td>${format(value)}</td>`;
  const fmtDuration = (v) => `${(v / 1000).toFixed(1)}s`;
  const fmtInt = (v) => v.toLocaleString();
  const fmtUsd4 = (v) => `$${v.toFixed(4)}`;
  const fmtUsd2K = (v) => `$${(v * 1000).toFixed(2)}`;

  const headerCells = results.map((r) => `<th>${escapeHtml(r.provider.short)}</th>`).join("");
  const row = (label, getter, format, opts) => {
    const baseValue = getter(base);
    const cells = results
      .map((r, idx) => (idx === 0 ? baseCell(getter(r), format) : cell(getter(r), baseValue, format, opts)))
      .join("");
    return `<tr><td>${label}</td>${cells}</tr>`;
  };
  const visionRow = `<tr><td>Vision API</td>${results
    .map((r) => `<td>${r.visionCost > 0 ? "$" + r.visionCost.toFixed(4) : "<em>nicht verwendet</em>"}</td>`)
    .join("")}</tr>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>malzime — Gemini Live vs. Mistral Hybrid (Large 3 Describe + Small 4 Profile)</title>
<style>${css}</style>
</head>
<body>
<h1>Pipeline-Vergleich: <code>${escapeHtml(path.basename(imagePath))}</code></h1>
<div class="imgwrap"><img src="data:${imageMime};base64,${imageData}" alt="Test-Bild"></div>

<div class="grid">${columns}
</div>

<h2 style="font-size:1rem; margin-top:2rem;">Zusammenfassung <span style="font-weight:normal; color:#888; font-size:0.85rem;">(Delta-Prozente gegen ${escapeHtml(base.provider.short)})</span></h2>
<table class="summary">
  <tr><th>Metrik</th>${headerCells}</tr>
  ${row("Dauer", (r) => r.duration, fmtDuration, { withColor: true })}
  ${row("Input-Tokens", (r) => r.tokensIn, fmtInt)}
  ${row("Output-Tokens", (r) => r.tokensOut, fmtInt)}
  ${row("KI-Kosten (3 Calls)", (r) => r.aiCost, fmtUsd4)}
  ${visionRow}
  ${row("<strong>Gesamt-Pipeline</strong>", (r) => r.totalCost, (v) => `<strong>${fmtUsd4(v)}</strong>`, { withColor: true })}
  ${row("Hochgerechnet pro 1000 Analysen", (r) => r.totalCost, fmtUsd2K)}
</table>

<p class="footer">
  Erzeugt am ${new Date().toLocaleString("de-AT")}<br>
  Variante A: Vision API (eu-vision.googleapis.com) + Gemini ${escapeHtml(GEMINI_MODEL)} (${escapeHtml(GEMINI_LOCATION)}) — heutiges Live-Setup<br>
  Variante B: Hybrid — Describe via ${escapeHtml(MISTRAL_LARGE_MODEL)} + Normal/Boost via ${escapeHtml(MISTRAL_SMALL_MODEL)} (api.mistral.ai, Paris)<br>
  Live-System unveraendert. Keine Firestore-Schreibvorgaenge.
</p>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Aufruf: MISTRAL_API_KEY=<dein-key> node functions/scripts/compare-models.js <pfad-zum-bild>");
    process.exit(1);
  }
  if (!MISTRAL_API_KEY) {
    console.error("✗ MISTRAL_API_KEY ist nicht gesetzt.");
    console.error("  Beispiel: MISTRAL_API_KEY=dein-key node functions/scripts/compare-models.js <bild>");
    process.exit(1);
  }

  let imagePath = args[0].replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ");
  if (!fs.existsSync(imagePath)) {
    console.error(`Datei nicht gefunden: ${imagePath}`);
    process.exit(1);
  }

  const originalBuffer = fs.readFileSync(imagePath);
  if (originalBuffer.length > 20 * 1024 * 1024) {
    console.error(`Bild ist sehr gross (${(originalBuffer.length / 1024 / 1024).toFixed(1)} MB) — Abbruch.`);
    process.exit(1);
  }

  console.log(`\n📷 Bild: ${imagePath} (${(originalBuffer.length / 1024).toFixed(0)} KB original)`);
  const resizeResult = maybeResizeImage(originalBuffer, imagePath);
  const buffer = resizeResult.buffer;
  const mimeType = resizeResult.mimeType;
  if (resizeResult.resized) {
    console.log(`   ↓ verkleinert auf ${(buffer.length / 1024).toFixed(0)} KB (1280px, JPEG 82 %) — wie Live-System`);
  }
  console.log("🔍 Vision API laeuft...");
  const visionResult = await visionAnalyze(buffer);
  console.log(`   → ${visionResult.labels.length} Labels${visionResult.ocrText ? ", OCR-Text vorhanden" : ""}`);

  console.log("\n🤖 Pipeline parallel — Gemini Live vs. Mistral Hybrid:\n");

  /* Sequenziell ausfuehren, damit Mistral Free-Tier Rate-Limit nicht trifft */
  const runOrder = [
    { key: "gemini", letter: "A" },
    { key: "mistralHybrid", letter: "B" },
  ];

  /* Alle Provider parallel — auf Scale Tier kein Rate-Limit-Risiko, ~3× schneller.
     Logs interleaven, sind aber durch provider.short-Prefix zuordenbar. */
  console.log("   ▶ Alle Provider parallel:");
  const outcomes = await Promise.all(
    runOrder.map(async ({ key, letter }) => {
      const provider = PROVIDERS[key];
      try {
        const value = await runPipeline(provider, buffer, mimeType, visionResult);
        return { letter, provider, status: "fulfilled", value };
      } catch (err) {
        return { letter, provider, status: "rejected", reason: err };
      }
    })
  );

  for (const o of outcomes) {
    if (o.status === "rejected") {
      console.error(`   ✗ Variante ${o.letter} (${o.provider.short}): ${o.reason.message}`);
    } else {
      console.log(
        `   ✓ ${o.letter} (${o.provider.short}): ${(o.value.duration / 1000).toFixed(1)}s | $${o.value.totalCost.toFixed(4)}`
      );
    }
  }

  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const failed = outcomes.filter((o) => o.status === "rejected");

  if (fulfilled.length === 0) {
    console.error("\n⚠ Alle Varianten haben versagt. Kein Bericht erzeugt.");
    process.exit(1);
  }
  if (failed.length > 0) {
    console.error(
      `\n⚠ ${failed.length} von ${outcomes.length} Varianten gescheitert — Teilbericht wird erzeugt:`
    );
    for (const f of failed) {
      console.error(`   ✗ ${f.letter} (${f.provider.short}): ${f.reason.message}`);
    }
  }

  const html = buildReport(
    imagePath,
    fulfilled.map((o) => o.value),
    failed.map((f) => ({ letter: f.letter, short: f.provider.short, message: f.reason.message }))
  );
  const outputPath = path.join(process.cwd(), "compare-result.html");
  fs.writeFileSync(outputPath, html);
  console.log(`\n📄 Bericht: ${outputPath}`);

  if (process.platform === "darwin") {
    require("child_process").exec(`open "${outputPath}"`);
    console.log("   (oeffnet automatisch im Standard-Browser)");
  }
}

main().catch((err) => {
  console.error("\n✗ Abbruch:", err.message);
  if (err.message?.includes("could not load the default credentials")) {
    console.error("\nTipp: Fuehre einmal `gcloud auth application-default login` aus.");
  }
  process.exit(1);
});
