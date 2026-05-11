#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Side-by-Side Vergleich: Gemini 2.5 Flash vs. Gemini 3.1 Flash-Lite
 *
 * Schickt EIN Bild durch die komplette malzime-Pipeline (Vision API + 3× Gemini)
 * — einmal mit dem aktuellen Modell, einmal mit dem neuen — und erzeugt einen
 * HTML-Bericht zum direkten Vergleich.
 *
 * Live-System bleibt unverändert. Skript schreibt nicht in Firestore.
 *
 * Implementierung: Gemini-Calls gehen direkt per HTTPS an die Vertex-REST-API
 * (nicht über @google-cloud/vertexai, weil diese SDK Probleme mit Multi-Region "eu"
 * hat und Ende Juni 2026 sowieso entfernt wird).
 *
 * Aufruf (aus dem Projekt-Root):
 *   node functions/scripts/compare-models.js <pfad-zum-bild>
 */

const PROJECT_ID = "malzime";

/* WICHTIG: ENV-Variablen MÜSSEN vor den require()-Aufrufen gesetzt werden,
   weil google-auth-library sie nur beim ersten Init liest. Hintergrund:
   ADC kann auf einem anderen Quota-Project stehen (z.B. malzispace) —
   das überschreiben wir hier zwangsweise für diesen Prozess. */
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = PROJECT_ID;

const fs = require("fs");
const path = require("path");
const { ImageAnnotatorClient } = require("@google-cloud/vision");
const { GoogleAuth } = require("google-auth-library");
const { loadPrompts } = require("../src/i18n");
const { escapeXml } = require("../src/gemini");
const { buildPrivacyRisks } = require("../src/privacy");

/* Wie Live-System: jede Variante hat eine Modell-Kette. Bei Block (leere Antwort)
   wird das nächste Modell probiert. So replizieren wir das Live-Verhalten. */
const VARIANTS = [
  {
    name: "A: Gemini 2.5 Flash (aktuell, Live-Setup)",
    models: ["gemini-2.5-flash", "gemini-2.0-flash-001"],
    location: "europe-west1",
    priceIn: 0.3,
    priceOut: 2.5,
  },
  {
    name: "B: Gemini 3.1 Flash-Lite (neu, global)",
    models: ["gemini-3.1-flash-lite", "gemini-2.5-flash"],
    location: "global",
    priceIn: 0.25, // global pricing
    priceOut: 1.5, // global pricing
  },
];

const VISION_COST_PER_ANALYSIS = 0.003;

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
];

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

/* ── Access-Token (gecached für die Laufzeit des Prozesses) ── */
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

/* ── Vision API (SDK funktioniert problemlos) ── */
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

/* ── Gemini via direkter REST-Aufruf (umgeht SDK-Probleme) ── */
async function callGemini(variant, modelName, parts, generationConfig) {
  const token = await getAccessToken();
  const host =
    variant.location === "global" ? "aiplatform.googleapis.com" : `${variant.location}-aiplatform.googleapis.com`;
  const url =
    `https://${host}/v1/projects/${PROJECT_ID}` +
    `/locations/${variant.location}/publishers/google/models/${modelName}:generateContent`;

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
    safetySettings: SAFETY_SETTINGS,
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    /* Netzwerk-Layer-Fehler: cause enthält die echte Ursache (DNS, TLS, Timeout, ...) */
    const cause = err.cause;
    const causeMsg = cause ? `${cause.code || cause.name || "?"}: ${cause.message}` : "(keine cause)";
    throw new Error(`fetch failed → URL=${url} | cause: ${causeMsg}`);
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `HTTP ${res.status} bei ${modelName} (${variant.location}): ${errBody.slice(0, 400).replace(/\s+/g, " ")}`
    );
  }
  return await res.json();
}

async function describeImageWithPrompt(variant, modelName, buffer, mimeType, prompt) {
  const parts = [
    { text: prompt },
    { inlineData: { data: buffer.toString("base64"), mimeType } },
  ];
  const json = await callGemini(variant, modelName, parts, {
    temperature: 0.2,
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingBudget: 0 },
  });
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join("") || "";
  const usage = json.usageMetadata || {};
  return {
    text: text.trim(),
    finishReason: candidate?.finishReason || "NO_CANDIDATE",
    promptTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/* Wie im Live-System: durchläuft die Modell-Kette. Erst normaler Prompt für alle
   Modelle, danach Fallback-Prompt für alle Modelle. Liefert das erste Modell,
   das nicht-leeren Text zurückgibt. */
async function describeImage(variant, buffer, mimeType, prompts) {
  let totalIn = 0;
  let totalOut = 0;
  const attempts = [];

  for (const promptVariant of [prompts.describePrompt, prompts.describeFallback]) {
    const isFallback = promptVariant === prompts.describeFallback;
    for (const modelName of variant.models) {
      const result = await describeImageWithPrompt(variant, modelName, buffer, mimeType, promptVariant);
      totalIn += result.promptTokens;
      totalOut += result.outputTokens;
      attempts.push(`${modelName}${isFallback ? "/fallback-prompt" : ""}=${result.finishReason}`);
      if (result.text) {
        if (modelName !== variant.models[0] || isFallback) {
          console.log(`     ⚠ describe brauchte ${modelName}${isFallback ? " mit Fallback-Prompt" : ""}`);
        }
        return {
          text: result.text,
          promptTokens: totalIn,
          outputTokens: totalOut,
          usedModel: modelName,
        };
      }
    }
  }

  const err = new Error(
    `Alle Modelle und Prompts geblockt: ${attempts.join(", ")}. ` +
      `Im Live-System würde dieses Bild ebenfalls ein 'blocked'-Profil zeigen.`
  );
  err.tokensIn = totalIn;
  err.tokensOut = totalOut;
  throw err;
}

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

/* Durchläuft die Modell-Kette wie im Live-System. */
async function generateProfile(variant, prompt, temperature) {
  let totalIn = 0;
  let totalOut = 0;
  let lastFinish = "unknown";

  for (const modelName of variant.models) {
    const json = await callGemini(variant, modelName, [{ text: prompt }], {
      temperature,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    });
    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text).join("") || "";
    const usage = json.usageMetadata || {};
    totalIn += usage.promptTokenCount || 0;
    totalOut += usage.candidatesTokenCount || 0;
    lastFinish = candidate?.finishReason || "NO_CANDIDATE";

    if (!text.trim()) continue;

    let cleaned = text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      /* leave as null */
    }
    if (parsed && parsed.categories) {
      if (modelName !== variant.models[0]) {
        console.log(`     ⚠ profile brauchte Fallback-Modell ${modelName}`);
      }
      return {
        profile: parsed,
        promptTokens: totalIn,
        outputTokens: totalOut,
        finishReason: lastFinish,
        usedModel: modelName,
      };
    }
  }

  return {
    profile: null,
    promptTokens: totalIn,
    outputTokens: totalOut,
    finishReason: lastFinish,
    usedModel: null,
  };
}

async function runVariant(variant, buffer, mimeType, visionResult) {
  const prompts = loadPrompts("de");

  const start = Date.now();
  const describe = await describeImage(variant, buffer, mimeType, prompts);
  if (!describe.text) {
    throw new Error(`describe lieferte leeren Text (Modell ${variant.model})`);
  }

  const labelsContext =
    visionResult.labels.length > 0 ? `\n${prompts.labelVisionLabels}: ${visionResult.labels.join(", ")}` : "";
  const privacyRisks = buildPrivacyRisks({ ocrText: visionResult.ocrText, labels: visionResult.labels });
  const privacyContext =
    privacyRisks.length > 0 ? `\n${prompts.labelPrivacyRisks}: ${privacyRisks.join("; ")}` : "";

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

  const [normal, boost] = await Promise.all([
    generateProfile(variant, normalPrompt, 0.7),
    generateProfile(variant, boostPrompt, 1.0),
  ]);
  const duration = Date.now() - start;

  const totalIn = describe.promptTokens + normal.promptTokens + boost.promptTokens;
  const totalOut = describe.outputTokens + normal.outputTokens + boost.outputTokens;
  const geminiCost = (totalIn * variant.priceIn + totalOut * variant.priceOut) / 1_000_000;

  return {
    variant,
    duration,
    describe: describe.text,
    normal: normal.profile,
    boost: boost.profile,
    normalFinish: normal.finishReason,
    boostFinish: boost.finishReason,
    tokensIn: totalIn,
    tokensOut: totalOut,
    geminiCost,
    visionCost: VISION_COST_PER_ANALYSIS,
    totalCost: geminiCost + VISION_COST_PER_ANALYSIS,
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Mini-Markdown: **bold** und *italic* → <strong>/<em>.
   Erst escapen (gegen Injection), dann die Markdown-Marker umwandeln. */
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
  const [a, b] = results;
  const colorPct = (n) => (n.startsWith("-") ? "color:#8f8" : n.startsWith("+") ? "color:#f88" : "");
  const css = `
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 1400px; margin: 2rem auto;
           padding: 1rem; background: #1a1a1a; color: #eee; line-height: 1.5; }
    h1 { font-size: 1.3rem; margin: 0 0 0.5rem; }
    .imgwrap { text-align: center; margin: 1rem 0; }
    .imgwrap img { max-width: 360px; border: 1px solid #444; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .col { background: #2a2a2a; padding: 1rem; border-radius: 8px; }
    .col h2 { margin: 0 0 0.5rem; font-size: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid #444; }
    .meta { background: #1f1f1f; padding: 0.5rem 0.8rem; border-radius: 4px;
            margin-bottom: 1rem; font-size: 0.85rem; }
    .meta span { display: inline-block; margin-right: 0.8rem; }
    section { margin-bottom: 1.2rem; }
    section h3 { font-size: 0.9rem; color: #88f; margin: 0 0 0.3rem; text-transform: uppercase; letter-spacing: 0.05em; }
    dl { margin: 0; }
    dt { font-weight: 600; margin-top: 0.5rem; color: #fc8; font-size: 0.88rem; }
    dd { margin: 0.1rem 0 0.4rem; font-size: 0.9rem; }
    h4 { font-size: 0.82rem; color: #aaa; margin: 0.7rem 0 0.2rem;
         text-transform: uppercase; letter-spacing: 0.05em; }
    ul { margin: 0.2rem 0 0.3rem 1.2rem; padding: 0; font-size: 0.88rem; }
    p { font-size: 0.9rem; margin: 0.3rem 0; }
    .desc { font-style: italic; color: #bbb; font-size: 0.88rem; }
    table.summary { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.88rem; }
    table.summary th, table.summary td { padding: 0.5rem; border-bottom: 1px solid #333; text-align: left; }
    table.summary th { background: #2a2a2a; }
    .footer { color: #666; font-size: 0.75rem; margin-top: 2rem; }
  `;
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>malzime — Modell-Vergleich</title>
<style>${css}</style>
</head>
<body>
<h1>Modell-Vergleich: <code>${escapeHtml(path.basename(imagePath))}</code></h1>
<div class="imgwrap"><img src="data:${imageMime};base64,${imageData}" alt="Test-Bild"></div>

<div class="grid">
${results
  .map(
    (r, i) => `
  <div class="col">
    <h2>${escapeHtml(r.variant.name)}</h2>
    <div class="meta">
      <span>⏱ <strong>${(r.duration / 1000).toFixed(1)}s</strong></span>
      <span>📥 ${r.tokensIn.toLocaleString()} tok</span>
      <span>📤 ${r.tokensOut.toLocaleString()} tok</span>
      <span style="${i === 0 ? "color:#f88" : "color:#8f8"}">💰 <strong>$${r.totalCost.toFixed(4)}</strong></span>
    </div>
    <section>
      <h3>Bildbeschreibung</h3>
      <p class="desc">${renderText(r.describe)}</p>
    </section>
    <section>
      <h3>Normal-Profil</h3>
      ${formatProfile(r.normal)}
    </section>
    <section>
      <h3>Boost-Profil</h3>
      ${formatProfile(r.boost)}
    </section>
  </div>`
  )
  .join("")}
</div>

<h2 style="font-size:1rem; margin-top:2rem;">Zusammenfassung</h2>
<table class="summary">
  <tr><th>Metrik</th><th>${escapeHtml(a.variant.name)}</th><th>${escapeHtml(b.variant.name)}</th><th>Differenz</th></tr>
  <tr><td>Dauer</td><td>${(a.duration / 1000).toFixed(1)}s</td><td>${(b.duration / 1000).toFixed(1)}s</td>
      <td style="${colorPct(pct(a.duration, b.duration))}">${pct(a.duration, b.duration)}</td></tr>
  <tr><td>Input-Tokens</td><td>${a.tokensIn.toLocaleString()}</td><td>${b.tokensIn.toLocaleString()}</td>
      <td>${pct(a.tokensIn, b.tokensIn)}</td></tr>
  <tr><td>Output-Tokens</td><td>${a.tokensOut.toLocaleString()}</td><td>${b.tokensOut.toLocaleString()}</td>
      <td>${pct(a.tokensOut, b.tokensOut)}</td></tr>
  <tr><td>Gemini-Kosten</td><td>$${a.geminiCost.toFixed(4)}</td><td>$${b.geminiCost.toFixed(4)}</td>
      <td style="${colorPct(pct(a.geminiCost, b.geminiCost))}">${pct(a.geminiCost, b.geminiCost)}</td></tr>
  <tr><td>Gesamt (mit Vision API)</td><td>$${a.totalCost.toFixed(4)}</td><td>$${b.totalCost.toFixed(4)}</td>
      <td style="${colorPct(pct(a.totalCost, b.totalCost))}">${pct(a.totalCost, b.totalCost)}</td></tr>
  <tr><td>Hochgerechnet pro 1000 Analysen</td>
      <td>$${(a.totalCost * 1000).toFixed(2)}</td>
      <td>$${(b.totalCost * 1000).toFixed(2)}</td>
      <td>$${((b.totalCost - a.totalCost) * 1000).toFixed(2)}</td></tr>
</table>

<p class="footer">
  Erzeugt am ${new Date().toLocaleString("de-AT")} —
  Live-System unverändert. Keine Firestore-Schreibvorgänge. Direkte REST-Calls an die EU-Endpoints.
</p>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Aufruf: node functions/scripts/compare-models.js <pfad-zum-bild>");
    process.exit(1);
  }

  let imagePath = args[0].replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ");
  if (!fs.existsSync(imagePath)) {
    console.error(`Datei nicht gefunden: ${imagePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(imagePath);
  const mimeType = detectMime(imagePath);
  if (buffer.length > 10 * 1024 * 1024) {
    console.error(`Bild ist sehr groß (${(buffer.length / 1024 / 1024).toFixed(1)} MB) — Abbruch zur Sicherheit.`);
    process.exit(1);
  }

  console.log(`\n📷 Bild: ${imagePath} (${(buffer.length / 1024).toFixed(0)} KB, ${mimeType})`);
  console.log("🔍 Vision API läuft...");
  const visionResult = await visionAnalyze(buffer);
  console.log(`   → ${visionResult.labels.length} Labels${visionResult.ocrText ? ", OCR-Text vorhanden" : ""}`);

  console.log("\n🤖 Vergleichslauf — bitte ca. 30s Geduld:\n");
  const results = [];
  for (const variant of VARIANTS) {
    console.log(`   ▶ ${variant.name}`);
    try {
      const result = await runVariant(variant, buffer, mimeType, visionResult);
      results.push(result);
      console.log(
        `     ✓ ${(result.duration / 1000).toFixed(1)}s | $${result.totalCost.toFixed(4)} | ` +
          `${result.tokensIn.toLocaleString()} in, ${result.tokensOut.toLocaleString()} out`
      );
    } catch (err) {
      console.error(`     ✗ Fehler: ${err.message}`);
      process.exit(1);
    }
  }

  const html = buildReport(imagePath, results);
  const outputPath = path.join(process.cwd(), "compare-result.html");
  fs.writeFileSync(outputPath, html);
  console.log(`\n📄 Bericht: ${outputPath}`);

  if (process.platform === "darwin") {
    require("child_process").exec(`open "${outputPath}"`);
    console.log("   (öffnet automatisch im Standard-Browser)");
  }
}

main().catch((err) => {
  console.error("\n✗ Abbruch:", err.message);
  if (err.message?.includes("could not load the default credentials")) {
    console.error("\nTipp: Führe einmal `gcloud auth application-default login` aus.");
  }
  process.exit(1);
});
