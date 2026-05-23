#!/usr/bin/env node
"use strict";

/**
 * compare-pipelines.js — Forschungs-Tool für den Architektur-Vergleich.
 *
 * Schickt jedes Bild aus `compare-input/` durch drei Pipelines parallel und
 * schreibt einen Side-by-Side-HTML-Report mit Bewertungs-Tabelle.
 *
 * NICHT Production-Pfad. NICHT von functions/src/ geladen.
 * Verifizierbar via `grep -r "compare-pipelines" functions/src/`.
 *
 * Pipelines:
 *   A = Status quo Live: 1× Describe (Large 2512) + 2× Profile (Small 2603)
 *   B = Neu V2 mit 2506: 1× Large-Bundle + 2× Karten (2506) + 2× profileText (2603)
 *   C = Neu V2 mit 2603: 1× Large-Bundle + 2× Karten (2603) + 2× profileText (2603)
 *
 * Aufruf:
 *   MISTRAL_API_KEY=... node functions/scripts/compare-pipelines.js
 *
 * Output: ./compare-result.html (in .gitignore)
 */

const fs = require("fs");
const path = require("path");

const livePrompts = require("../src/locales/de/prompts");
const { parseSafely } = require("../src/json-repair");
const testPrompts = require("./test-prompts-v2");

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error("FEHLER: MISTRAL_API_KEY ist nicht gesetzt.");
  console.error("Aufruf: MISTRAL_API_KEY=<key> node functions/scripts/compare-pipelines.js");
  process.exit(1);
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");
const OUTPUT_FILE = path.join(REPO_ROOT, "compare-result.html");

const MODELS = {
  LARGE: "mistral-large-2512",
  SMALL_2603: "mistral-small-2603", /* heute live für Profile */
  SMALL_2506: "mistral-small-2506", /* Test-Kandidat für Karten */
};

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const TIMEOUT_MS = 90000;

/* ─────────────────────────────────────────────────────────────────────────
 * Low-level Mistral-Call mit Token + Latenz-Telemetrie
 * ───────────────────────────────────────────────────────────────────────── */

async function callMistral({ model, messages, maxTokens, temperature, forceJSON }) {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (forceJSON) body.response_format = { type: "json_object" };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`HTTP-Fehler bei ${model}: ${err.message}`, { cause: err });
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Mistral HTTP ${res.status} bei ${model}: ${errBody.slice(0, 300)}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const msgContent = choice?.message?.content;
  let text = "";
  if (typeof msgContent === "string") text = msgContent;
  else if (Array.isArray(msgContent)) text = msgContent.filter((c) => c.type === "text").map((c) => c.text).join("");

  const usage = json.usage || {};
  return {
    model,
    text: text.trim(),
    promptTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    httpMs: Date.now() - start,
    finishReason: choice?.finish_reason || "unknown",
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Pipeline A — Heute live (nachgebaut für saubere Token-Erfassung)
 * ───────────────────────────────────────────────────────────────────────── */

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLiveProfilePrompt(systemContext, description, exifContext, schema) {
  const safeDesc = escapeXml(description || "");
  const safeExif = exifContext ? escapeXml(exifContext) : "";
  return `${systemContext}

${livePrompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>${safeExif ? `\n<exif_daten>${safeExif}</exif_daten>` : ""}

${livePrompts.workshopNote}
${schema}`;
}

async function runPipelineA(imageBuffer, mimeType, exif) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  /* Stufe 1: Describe Large */
  const describe = await callMistral({
    model: MODELS.LARGE,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: livePrompts.describePrompt + livePrompts.mistralDescribeAddendum },
          { type: "image_url", image_url: dataUrl },
        ],
      },
    ],
    maxTokens: 2048,
    temperature: 0.2,
    forceJSON: false,
  });

  const exifContext = Object.keys(exif || {}).length > 0 ? `\n${livePrompts.labelExif}: ${JSON.stringify(exif)}` : "";

  /* Stufe 2: 2 Profile parallel */
  const [normalCall, boostCall] = await Promise.all([
    callMistral({
      model: MODELS.SMALL_2603,
      messages: [{ role: "user", content: buildLiveProfilePrompt(livePrompts.systemNormal, describe.text, exifContext, livePrompts.jsonSchemaNormal) }],
      maxTokens: 8000,
      temperature: 0.7,
      forceJSON: true,
    }),
    callMistral({
      model: MODELS.SMALL_2603,
      messages: [{ role: "user", content: buildLiveProfilePrompt(livePrompts.systemBoost, describe.text, exifContext, livePrompts.jsonSchemaBoost) }],
      maxTokens: 8000,
      temperature: 1.0,
      forceJSON: true,
    }),
  ]);

  const normalParsed = parseSafely(normalCall.text) || { _parseError: true, _raw: normalCall.text.slice(0, 500) };
  const boostParsed = parseSafely(boostCall.text) || { _parseError: true, _raw: boostCall.text.slice(0, 500) };

  return {
    label: "A — Heute live",
    calls: [describe, normalCall, boostCall],
    description: describe.text,
    profiles: { normal: normalParsed, boost: boostParsed },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Pipelines B + C — Neue V2-Architektur
 * ───────────────────────────────────────────────────────────────────────── */

async function runLargeBundle(imageBuffer, mimeType) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const result = await callMistral({
    model: MODELS.LARGE,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: testPrompts.largeBundlePrompt },
          { type: "image_url", image_url: dataUrl },
        ],
      },
    ],
    maxTokens: 4000,
    temperature: 0.3,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text) || {};
  return {
    call: result,
    bundle: {
      description: parsed.description || "",
      ads: Array.isArray(parsed.ads) ? parsed.ads : [],
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
      hard_facts: parsed.hard_facts || {},
      _parseError: !parsed.description,
      _raw: !parsed.description ? result.text.slice(0, 500) : undefined,
    },
  };
}

async function runCardsCall(model, mode, bundle, temperature) {
  const prompt = testPrompts.buildCardsPrompt(mode, bundle);
  const result = await callMistral({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2000,
    temperature,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text) || { _parseError: true, _raw: result.text.slice(0, 500) };
  return { call: result, parsed };
}

async function runProfileTextCall(mode, bundle, temperature) {
  const prompt = testPrompts.buildProfileTextPrompt(mode, bundle);
  const result = await callMistral({
    model: MODELS.SMALL_2603,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 800,
    temperature,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text) || { _parseError: true, _raw: result.text.slice(0, 500) };
  return { call: result, parsed };
}

async function runPipelineV2(imageBuffer, mimeType, cardsModel, label) {
  /* Stufe 1: Large-Bundle */
  const { call: largeCall, bundle } = await runLargeBundle(imageBuffer, mimeType);

  if (bundle._parseError) {
    return {
      label,
      calls: [largeCall],
      description: "",
      bundle,
      profiles: { normal: { _parseError: true }, boost: { _parseError: true } },
      cards: { normal: { _parseError: true }, boost: { _parseError: true } },
      _abortReason: "Large-Bundle JSON-Parsing fehlgeschlagen",
    };
  }

  /* Stufe 2: 4 parallele Calls */
  const [cardsNormal, cardsBeast, profileNormal, profileBeast] = await Promise.all([
    runCardsCall(cardsModel, "normal", bundle, 0.5),
    runCardsCall(cardsModel, "beast", bundle, 0.9),
    runProfileTextCall("normal", bundle, 0.7),
    runProfileTextCall("beast", bundle, 1.0),
  ]);

  return {
    label,
    calls: [largeCall, cardsNormal.call, cardsBeast.call, profileNormal.call, profileBeast.call],
    description: bundle.description,
    bundle,
    cards: { normal: cardsNormal.parsed, boost: cardsBeast.parsed },
    profiles: {
      normal: { profileText: profileNormal.parsed.profileText || "" },
      boost: { profileText: profileBeast.parsed.profileText || "" },
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Reporting
 * ───────────────────────────────────────────────────────────────────────── */

function priceOf(call) {
  /* Listenpreise grob — siehe config.js Kommentar:
     Large 2512: $0.50 / $1.50 in/out
     Small 2603/2506: $0.15 / $0.60 in/out */
  const isLarge = /large/i.test(call.model);
  const inUsdPerM = isLarge ? 0.5 : 0.15;
  const outUsdPerM = isLarge ? 1.5 : 0.6;
  const usd = (call.promptTokens * inUsdPerM + call.outputTokens * outUsdPerM) / 1_000_000;
  return usd * 0.92; /* EUR */
}

function aggregateCalls(calls) {
  let promptTokens = 0;
  let outputTokens = 0;
  let totalMs = 0;
  let costEur = 0;
  for (const c of calls) {
    promptTokens += c.promptTokens || 0;
    outputTokens += c.outputTokens || 0;
    totalMs += c.httpMs || 0;
    costEur += priceOf(c);
  }
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, totalMs, costEur };
}

function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCardsBlock(cards) {
  if (!cards || cards._parseError) return `<div class="warn">JSON-Parse-Fehler</div><pre class="raw">${htmlEscape(cards?._raw || "")}</pre>`;
  const cats = cards.categories || {};
  const keys = [
    "alter_geschlecht", "herkunft", "einkommen", "bildung", "beziehungsstatus",
    "interessen", "persoenlichkeit", "charakterzuege", "politisch",
    "gesundheit", "kaufkraft", "verletzlichkeit", "werbeprofil",
  ];
  return `<dl class="cards">${keys.map((k) => {
    const c = cats[k];
    if (!c) return `<dt>${k}</dt><dd class="missing">—</dd>`;
    const conf = typeof c.confidence === "number" ? ` <span class="conf">(${Math.round(c.confidence * 100)}%)</span>` : "";
    return `<dt>${k}</dt><dd>${htmlEscape(c.value || "")}${conf}</dd>`;
  }).join("")}</dl>`;
}

function renderLiveProfileBlock(profile) {
  if (!profile || profile._parseError) return `<div class="warn">JSON-Parse-Fehler</div><pre class="raw">${htmlEscape(profile?._raw || "")}</pre>`;
  const cats = profile.categories || {};
  const keys = Object.keys(cats);
  const cardsHtml = keys.map((k) => {
    const c = cats[k];
    const conf = typeof c.confidence === "number" ? ` <span class="conf">(${Math.round(c.confidence * 100)}%)</span>` : "";
    return `<dt>${htmlEscape(c.label || k)}</dt><dd>${htmlEscape(c.value || "")}${conf}</dd>`;
  }).join("");
  const ads = (profile.ad_targeting || []).map((a) => `<span class="tag">${htmlEscape(a)}</span>`).join("");
  const triggers = (profile.manipulation_triggers || []).map((t) => `<li>${htmlEscape(t)}</li>`).join("");
  return `
    <div class="profile-text"><strong>profileText:</strong><br>${htmlEscape(profile.profileText || "")}</div>
    <details><summary>13 Karten (Fließtext-Stil heute)</summary><dl class="cards">${cardsHtml}</dl></details>
    <details><summary>ad_targeting</summary><div class="tags">${ads}</div></details>
    <details><summary>manipulation_triggers</summary><ul>${triggers}</ul></details>
  `;
}

function renderV2Column(result, mode) {
  const cards = result.cards?.[mode];
  const profileText = result.profiles?.[mode]?.profileText || "";
  return `
    <div class="profile-text"><strong>profileText:</strong><br>${htmlEscape(profileText)}</div>
    <h5>13 Karten (Schlagworte, ${mode})</h5>
    ${renderCardsBlock(cards)}
  `;
}

function renderV2Bundle(result) {
  const b = result.bundle || {};
  if (b._parseError) return `<div class="warn">Bundle Parse-Fehler</div><pre class="raw">${htmlEscape(b._raw || "")}</pre>`;
  const ads = (b.ads || []).map((a) => `<span class="tag">${htmlEscape(a)}</span>`).join("");
  const triggers = (b.triggers || []).map((t) => `<li>${htmlEscape(t)}</li>`).join("");
  const hf = Object.entries(b.hard_facts || {}).map(([k, v]) => `<dt>${k}</dt><dd>${htmlEscape(v)}</dd>`).join("");
  return `
    <details open><summary>hard_facts (Konsistenz-Anker)</summary><dl class="cards">${hf}</dl></details>
    <details><summary>ads (Marken — identisch in beiden Modi)</summary><div class="tags">${ads}</div></details>
    <details><summary>triggers (identisch in beiden Modi)</summary><ul>${triggers}</ul></details>
  `;
}

function renderStats(result) {
  const agg = aggregateCalls(result.calls);
  const small2603Tokens = result.calls.filter((c) => c.model === MODELS.SMALL_2603).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  const small2506Tokens = result.calls.filter((c) => c.model === MODELS.SMALL_2506).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  const largeTokens = result.calls.filter((c) => /large/i.test(c.model)).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  return `
    <table class="stats">
      <tr><th>Total Tokens</th><td>${agg.totalTokens.toLocaleString("de-AT")}</td></tr>
      <tr><th>davon Large 2512</th><td>${largeTokens.toLocaleString("de-AT")}</td></tr>
      <tr><th>davon Small 2603</th><td>${small2603Tokens.toLocaleString("de-AT")}</td></tr>
      <tr><th>davon Small 2506</th><td>${small2506Tokens.toLocaleString("de-AT")}</td></tr>
      <tr><th>Kosten (Listenpreis)</th><td>${(agg.costEur * 100).toFixed(2)} ct</td></tr>
      <tr><th>Calls gesamt</th><td>${result.calls.length}</td></tr>
      <tr><th>Σ HTTP-Zeit (parallel-naiv)</th><td>${(agg.totalMs / 1000).toFixed(1)} s</td></tr>
    </table>
  `;
}

function renderRatingTable() {
  const criteria = [
    "Alter realistisch geschätzt",
    "Geschlecht korrekt",
    "Marken plausibel",
    "Marken-Vielfalt",
    "Trigger bildspezifisch (nicht generisch)",
    "Karten-Werte stimmig zum Bild",
    "Karten Normal ↔ Beast konsistent in Grundfakten",
    "profileText konkret (nennt Marken/Trigger)",
    "profileText konsistent mit Karten",
    "Beast spürbar härter ohne Inkohärenz",
  ];
  return `
    <h4>Bewertung (1–5)</h4>
    <table class="rating">
      <thead><tr><th>Kriterium</th><th>A — Live</th><th>B — V2 mit 2506</th><th>C — V2 mit 2603</th></tr></thead>
      <tbody>${criteria.map((c) => `<tr><td>${c}</td><td>_</td><td>_</td><td>_</td></tr>`).join("")}</tbody>
    </table>
  `;
}

function renderHtml(perImage) {
  const styles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1800px; margin: 1rem auto; padding: 0 1rem; line-height: 1.4; color: #222; }
      h1 { border-bottom: 2px solid #333; padding-bottom: 0.3rem; }
      h2 { background: #eef; padding: 0.5rem 0.8rem; margin-top: 3rem; border-left: 4px solid #44e; }
      h3 { margin-top: 2rem; }
      .image-section { margin-bottom: 4rem; padding-bottom: 2rem; border-bottom: 1px dashed #aaa; }
      .preview { max-width: 400px; max-height: 300px; border: 1px solid #ddd; margin-bottom: 1rem; }
      .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
      .column { background: #fafafa; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; }
      .column.live { background: #f0fff0; }
      .column.v2-2506 { background: #f0f8ff; }
      .column.v2-2603 { background: #fffbf0; }
      .column h4 { margin: 0 0 0.5rem 0; font-size: 1rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
      dl.cards { display: grid; grid-template-columns: 1fr 2fr; gap: 0.2rem 0.5rem; margin: 0.5rem 0; font-size: 0.8rem; }
      dl.cards dt { font-weight: bold; color: #555; }
      dl.cards dd { margin: 0; }
      .conf { color: #888; font-size: 0.85em; }
      .missing { color: #c00; }
      .tag { display: inline-block; background: #ddf; padding: 2px 6px; margin: 2px; border-radius: 3px; font-size: 0.75rem; }
      .tags { line-height: 1.8; }
      .warn { background: #fee; color: #900; padding: 0.5rem; border-left: 3px solid #c00; }
      .raw { font-size: 0.7rem; background: #fff; padding: 0.5rem; border: 1px solid #fcc; max-height: 100px; overflow: auto; }
      pre { font-family: SF Mono, Consolas, monospace; font-size: 0.75rem; }
      details { margin: 0.5rem 0; }
      summary { cursor: pointer; font-weight: bold; padding: 0.2rem 0; }
      .profile-text { background: #fff; padding: 0.6rem; border-left: 3px solid #44e; margin: 0.5rem 0; font-size: 0.85rem; }
      table.stats, table.rating { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.8rem; }
      table.stats th, table.stats td, table.rating th, table.rating td { padding: 4px 8px; border: 1px solid #ccc; text-align: left; }
      table.stats th { background: #eef; width: 40%; }
      table.rating th { background: #eef; }
      table.rating td:first-child { background: #f5f5f5; }
      .description-block { background: #fff; padding: 0.5rem; border-radius: 3px; font-size: 0.8rem; max-height: 200px; overflow: auto; margin: 0.5rem 0; }
      .meta { color: #666; font-size: 0.85rem; }
    </style>
  `;

  const body = perImage.map(({ imageName, imageDataUrl, results, error }) => {
    if (error) {
      return `<section class="image-section"><h2>${htmlEscape(imageName)}</h2><div class="warn">Fehler: ${htmlEscape(error)}</div></section>`;
    }
    const [a, b, c] = results;
    return `
      <section class="image-section">
        <h2>📷 ${htmlEscape(imageName)}</h2>
        <img class="preview" src="${imageDataUrl}" alt="">

        <h3>Beschreibungen</h3>
        <div class="columns">
          <div class="column live">
            <h4>${htmlEscape(a.label)}</h4>
            <div class="description-block">${htmlEscape(a.description)}</div>
            ${renderStats(a)}
          </div>
          <div class="column v2-2506">
            <h4>${htmlEscape(b.label)}</h4>
            <div class="description-block">${htmlEscape(b.description)}</div>
            ${renderV2Bundle(b)}
            ${renderStats(b)}
          </div>
          <div class="column v2-2603">
            <h4>${htmlEscape(c.label)}</h4>
            <div class="description-block">${htmlEscape(c.description)}</div>
            ${renderV2Bundle(c)}
            ${renderStats(c)}
          </div>
        </div>

        <h3>Modus: NORMAL</h3>
        <div class="columns">
          <div class="column live"><h4>A — Live</h4>${renderLiveProfileBlock(a.profiles.normal)}</div>
          <div class="column v2-2506"><h4>B — V2 mit 2506</h4>${renderV2Column(b, "normal")}</div>
          <div class="column v2-2603"><h4>C — V2 mit 2603</h4>${renderV2Column(c, "normal")}</div>
        </div>

        <h3>Modus: BEAST</h3>
        <div class="columns">
          <div class="column live"><h4>A — Live</h4>${renderLiveProfileBlock(a.profiles.boost)}</div>
          <div class="column v2-2506"><h4>B — V2 mit 2506</h4>${renderV2Column(b, "boost")}</div>
          <div class="column v2-2603"><h4>C — V2 mit 2603</h4>${renderV2Column(c, "boost")}</div>
        </div>

        ${renderRatingTable()}
      </section>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>malziME — Pipeline-Vergleich</title>
  ${styles}
</head>
<body>
  <h1>Pipeline-Vergleich · ${new Date().toLocaleString("de-AT")}</h1>
  <p class="meta">
    Spalte A = aktuelle Live-Pipeline (Status quo, mistral-small-2603 für Profile).<br>
    Spalte B = neue V2-Architektur mit <code>mistral-small-2506</code> für die 13 Karten.<br>
    Spalte C = neue V2-Architektur mit <code>mistral-small-2603</code> für die Karten (Fallback-Variante).<br>
    Beide V2-Varianten haben Marken + Triggers im Large-Call, profileText separat auf 2603.<br>
    Bewertung pro Bild: 1 (deutlich schlechter) bis 5 (klar besser/identisch).
  </p>
  ${body}
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────────────────── */

function mimeTypeOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

async function processImage(imagePath) {
  const imageName = path.basename(imagePath);
  console.log(`\n=== ${imageName} ===`);
  const imageBuffer = fs.readFileSync(imagePath);
  const mimeType = mimeTypeOf(imageName);
  if (!mimeType) {
    return { imageName, error: `Unbekannter Bild-Typ: ${path.extname(imageName)}` };
  }
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const sizeKb = Math.round(imageBuffer.length / 1024);
  console.log(`Bildgröße: ${sizeKb} KB`);

  try {
    /* Drei Pipelines parallel — spart Wall-Clock-Zeit beim Testen. */
    const t0 = Date.now();
    const [a, b, c] = await Promise.all([
      runPipelineA(imageBuffer, mimeType, {}).catch((err) => ({ label: "A — Heute live", calls: [], description: "", profiles: { normal: { _parseError: true }, boost: { _parseError: true } }, _error: err.message })),
      runPipelineV2(imageBuffer, mimeType, MODELS.SMALL_2506, "B — V2 mit 2506").catch((err) => ({ label: "B — V2 mit 2506", calls: [], description: "", profiles: { normal: { _parseError: true }, boost: { _parseError: true } }, _error: err.message })),
      runPipelineV2(imageBuffer, mimeType, MODELS.SMALL_2603, "C — V2 mit 2603").catch((err) => ({ label: "C — V2 mit 2603", calls: [], description: "", profiles: { normal: { _parseError: true }, boost: { _parseError: true } }, _error: err.message })),
    ]);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Alle drei Pipelines fertig nach ${elapsed} s.`);
    for (const r of [a, b, c]) {
      if (r._error) console.log(`  ${r.label}: FEHLER — ${r._error}`);
      else {
        const agg = aggregateCalls(r.calls);
        console.log(`  ${r.label}: ${r.calls.length} Calls · ${agg.totalTokens.toLocaleString("de-AT")} Tokens · ${(agg.costEur * 100).toFixed(2)} ct`);
      }
    }
    return { imageName, imageDataUrl, results: [a, b, c] };
  } catch (err) {
    console.error(`Fehler bei ${imageName}: ${err.message}`);
    return { imageName, imageDataUrl, error: err.message };
  }
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Eingabe-Ordner nicht gefunden: ${INPUT_DIR}`);
    console.error(`Lege ihn an und kopiere 8–10 Workshop-typische Bilder rein, dann starte nochmal.`);
    process.exit(1);
  }
  const files = fs.readdirSync(INPUT_DIR)
    .filter((f) => mimeTypeOf(f) !== null)
    .map((f) => path.join(INPUT_DIR, f))
    .sort();
  if (files.length === 0) {
    console.error(`Keine Bilder in ${INPUT_DIR}. Erlaubte Formate: jpg, jpeg, png, webp, gif.`);
    process.exit(1);
  }
  console.log(`${files.length} Bild(er) gefunden, starte Vergleich...`);
  console.log(`Anker-Längen: AGE_ANCHOR=${testPrompts._anchorLengths.age} Zeichen, GENDER_ANCHOR=${testPrompts._anchorLengths.gender} Zeichen`);

  const perImage = [];
  for (const f of files) {
    /* Bilder NACHEINANDER, nicht parallel — wir wollen Mistral-Rate-Limits
       nicht reizen, und der HTML-Report wird beim Schreiben sukzessive
       vollständiger, falls das Skript zwischendurch abgebrochen wird. */
    perImage.push(await processImage(f));
    fs.writeFileSync(OUTPUT_FILE, renderHtml(perImage));
  }

  console.log(`\nFertig. Output: ${OUTPUT_FILE}`);
  console.log(`Im Browser öffnen: open "${OUTPUT_FILE}"`);
}

main().catch((err) => {
  console.error(`Unerwarteter Fehler: ${err.stack || err.message}`);
  process.exit(1);
});
