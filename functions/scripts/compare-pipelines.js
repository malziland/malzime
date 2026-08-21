#!/usr/bin/env node
"use strict";

/**
 * compare-pipelines.js — Forschungs-Tool für den Architektur-Vergleich.
 *
 * Schickt jedes Bild aus `compare-input/` durch drei Pipelines parallel und
 * schreibt sowohl `compare-results.json` (Roh-Daten) als auch
 * `compare-result.html` (Live-Frontend-Stil, 1:1-Vergleich).
 *
 * NICHT Production-Pfad. NICHT von functions/src/ geladen.
 *
 * HINWEIS (2026-07): mistral-small-2506 wurde von Mistral zum 31.07.2026
 * zurueckgezogen (Retirement) — Pipeline B ist seither NICHT mehr
 * lauffaehig (API-Fehler). Fuer neue Modellvergleiche die MODELS-
 * Konstanten unten auf aktuelle Modell-IDs umstellen.
 *
 * Pipelines:
 *   A = Status quo Live: 1× Describe (Large 2512) + 2× Profile (Small 2603)
 *   B = Neu V2 mit 2506: 1× Large-Bundle + 2× Karten (2506) + 2× profileText (2603)
 *   C = Neu V2 mit 2603: 1× Large-Bundle + 2× Karten (2603) + 2× profileText (2603)
 *
 * Aufruf:
 *   MISTRAL_API_KEY=... node functions/scripts/compare-pipelines.js
 *
 * Output:
 *   ./compare-result.html       (sichtbarer Vergleich, in .gitignore)
 *   ./compare-results.json      (Roh-Daten für erneutes Rendern, in .gitignore)
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
const OUTPUT_HTML = path.join(REPO_ROOT, "compare-result.html");
const OUTPUT_JSON = path.join(REPO_ROOT, "compare-results.json");

const MODELS = {
  LARGE: "mistral-large-2512",
  SMALL_2603: "mistral-small-2603",
  SMALL_2506: "mistral-small-2506", // RETIRED 31.07.2026 — Pipeline B nicht mehr lauffaehig
};

const ENDPOINT = "https://api.eu.mistral.ai/v1/chat/completions";
const TIMEOUT_MS = 120000;

const CATEGORY_ORDER = [
  "alter_geschlecht", "herkunft", "einkommen", "bildung", "beziehungsstatus",
  "interessen", "persoenlichkeit", "charakterzuege", "politisch",
  "gesundheit", "kaufkraft", "verletzlichkeit", "werbeprofil",
];
const CATEGORY_LABELS = {
  alter_geschlecht: "Alter & Geschlecht",
  herkunft: "Ethnische Herkunft",
  einkommen: "Geschätztes Einkommen",
  bildung: "Bildungsniveau",
  beziehungsstatus: "Beziehungsstatus",
  interessen: "Interessen & Hobbys",
  persoenlichkeit: "Persönlichkeitstyp",
  charakterzuege: "Charaktereigenschaften",
  politisch: "Politische Tendenz",
  gesundheit: "Gesundheit & Fitness",
  kaufkraft: "Kaufkraft & Konsum",
  verletzlichkeit: "Verletzlichkeiten",
  werbeprofil: "Werbeprofil",
};

/* ─────────────────────────────────────────────────────────────────────────
 * Low-level Mistral-Call
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
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
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
 * Pipeline A — Live nachgebaut (gleicher Prompt + gleiches Modell)
 * ───────────────────────────────────────────────────────────────────────── */

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildLiveProfilePrompt(systemContext, description, schema) {
  return `${systemContext}

${livePrompts.injectionWarning}

<bildbeschreibung>
${escapeXml(description || "")}
</bildbeschreibung>

${livePrompts.workshopNote}
${schema}`;
}

async function runPipelineA(imageBuffer, mimeType) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  const describe = await callMistral({
    model: MODELS.LARGE,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: livePrompts.describePrompt + livePrompts.mistralDescribeAddendum },
        { type: "image_url", image_url: dataUrl },
      ],
    }],
    maxTokens: 2048,
    temperature: 0.2,
    forceJSON: false,
  });

  const [normalCall, boostCall] = await Promise.all([
    callMistral({
      model: MODELS.SMALL_2603,
      messages: [{ role: "user", content: buildLiveProfilePrompt(livePrompts.systemNormal, describe.text, livePrompts.jsonSchemaNormal) }],
      maxTokens: 8000,
      temperature: 0.7,
      forceJSON: true,
    }),
    callMistral({
      model: MODELS.SMALL_2603,
      messages: [{ role: "user", content: buildLiveProfilePrompt(livePrompts.systemBoost, describe.text, livePrompts.jsonSchemaBoost) }],
      maxTokens: 8000,
      temperature: 1.0,
      forceJSON: true,
    }),
  ]);

  const normalParsed = parseSafely(normalCall.text) || { _parseError: true, _raw: normalCall.text };
  const boostParsed = parseSafely(boostCall.text) || { _parseError: true, _raw: boostCall.text };

  return {
    label: "A — Heute live",
    calls: [describe, normalCall, boostCall],
    description: describe.text,
    bundle: null, /* A hat kein Bundle */
    profiles: {
      normal: {
        categories: normalParsed.categories || {},
        ad_targeting: normalParsed.ad_targeting || [],
        manipulation_triggers: normalParsed.manipulation_triggers || [],
        profileText: normalParsed.profileText || "",
        _parseError: normalParsed._parseError,
      },
      boost: {
        categories: boostParsed.categories || {},
        ad_targeting: boostParsed.ad_targeting || [],
        manipulation_triggers: boostParsed.manipulation_triggers || [],
        profileText: boostParsed.profileText || "",
        _parseError: boostParsed._parseError,
      },
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Pipelines B + C — Neue V2-Architektur
 * ───────────────────────────────────────────────────────────────────────── */

async function runLargeBundle(imageBuffer, mimeType) {
  /* EINZIGER Large-Call: Bild → description + ads + triggers + hard_facts.
     Option 1 (zusätzlicher Large-Text-Call) wurde am 2026-05-23 verworfen,
     weil sie keine Verbesserung brachte aber Kosten + Latenz erhöhte. */
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const result = await callMistral({
    model: MODELS.LARGE,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: testPrompts.largeBundlePrompt },
        { type: "image_url", image_url: dataUrl },
      ],
    }],
    maxTokens: 5000,
    temperature: 0.3,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text, { requireSchema: false }) || {};
  return {
    call: result,
    bundle: {
      description: parsed.description || "",
      ads: Array.isArray(parsed.ads) ? parsed.ads : [],
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
      hard_facts: parsed.hard_facts || {},
      _parseError: !parsed.description,
      _raw: !parsed.description ? result.text : undefined,
    },
  };
}

async function runCardsCall(model, mode, bundle, temperature) {
  const prompt = testPrompts.buildCardsPrompt(mode, bundle);
  const result = await callMistral({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 5000,
    temperature,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text) || { _parseError: true, _raw: result.text };
  return { call: result, categories: parsed.categories || {}, _parseError: parsed._parseError, _raw: parsed._raw };
}

async function runProfileTextCall(mode, bundle, temperature) {
  const prompt = testPrompts.buildProfileTextPrompt(mode, bundle);
  const result = await callMistral({
    model: MODELS.SMALL_2603,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1200,
    temperature,
    forceJSON: true,
  });
  const parsed = parseSafely(result.text, { requireSchema: false }) || { _parseError: true, _raw: result.text };
  return { call: result, profileText: parsed.profileText || "", _parseError: parsed._parseError, _raw: parsed._raw };
}

async function runPipelineV2(imageBuffer, mimeType, cardsModel, label) {
  /* Stufe 1: Large-Bundle (Bild → description + ads + triggers + hard_facts) */
  const { call: largeCall, bundle } = await runLargeBundle(imageBuffer, mimeType);

  if (bundle._parseError) {
    return {
      label, calls: [largeCall], description: "", bundle,
      profiles: {
        normal: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "", _parseError: true },
        boost: { categories: {}, ad_targeting: [], manipulation_triggers: [], profileText: "", _parseError: true },
      },
      _abortReason: "Large-Bundle JSON-Parsing fehlgeschlagen",
    };
  }

  /* Stufe 2: 4 parallele Small-Calls */
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
    profiles: {
      normal: {
        categories: cardsNormal.categories,
        ad_targeting: bundle.ads,
        manipulation_triggers: bundle.triggers,
        profileText: profileNormal.profileText,
        _parseError: cardsNormal._parseError || profileNormal._parseError,
      },
      boost: {
        categories: cardsBeast.categories,
        ad_targeting: bundle.ads,
        manipulation_triggers: bundle.triggers,
        profileText: profileBeast.profileText,
        _parseError: cardsBeast._parseError || profileBeast._parseError,
      },
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Kosten + Statistik
 * ───────────────────────────────────────────────────────────────────────── */

function priceEurOf(call) {
  /* Live-config.js Kommentar:
       Large 2512: $0.50 / $1.50  in/out
       Small 2506/2603: $0.15 / $0.60  in/out */
  const isLarge = /large/i.test(call.model);
  const inUsdPerM = isLarge ? 0.5 : 0.15;
  const outUsdPerM = isLarge ? 1.5 : 0.6;
  const usd = (call.promptTokens * inUsdPerM + call.outputTokens * outUsdPerM) / 1_000_000;
  return usd * 0.92;
}

function aggregateCalls(calls) {
  return calls.reduce((acc, c) => ({
    promptTokens: acc.promptTokens + (c.promptTokens || 0),
    outputTokens: acc.outputTokens + (c.outputTokens || 0),
    totalMs: acc.totalMs + (c.httpMs || 0),
    costEur: acc.costEur + priceEurOf(c),
  }), { promptTokens: 0, outputTokens: 0, totalMs: 0, costEur: 0 });
}

/* ─────────────────────────────────────────────────────────────────────────
 * HTML-Rendering — Live-Frontend-Stil, identische Spalten
 * ───────────────────────────────────────────────────────────────────────── */

function htmlEscape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderCardsLive(profile) {
  const cats = profile.categories || {};
  if (Object.keys(cats).length === 0) return `<div class="warn">Keine Karten</div>`;

  return `<div class="cat-grid">${CATEGORY_ORDER.map((key) => {
    const cat = cats[key];
    if (!cat) return `<div class="cat-card missing"><div class="cat-head"><span class="cat-label">${CATEGORY_LABELS[key]}</span><span class="cat-conf low">—</span></div><p class="cat-value missing-val">fehlt</p></div>`;
    const conf = typeof cat.confidence === "number" ? cat.confidence : 0;
    const pct = Math.round(conf * 100);
    const cls = pct >= 70 ? "high" : pct >= 40 ? "med" : "low";
    return `<div class="cat-card">
      <div class="cat-head">
        <span class="cat-label">${htmlEscape(cat.label || CATEGORY_LABELS[key])}</span>
        <span class="cat-conf ${cls}">${pct}%</span>
      </div>
      <p class="cat-value">${htmlEscape(cat.value || "")}</p>
      <div class="conf-track"><div class="conf-bar ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }).join("")}</div>`;
}

function renderAds(profile) {
  const ads = profile.ad_targeting || [];
  if (ads.length === 0) return "";
  return `<div class="block-tags"><h4>Werbemarken (ad_targeting)</h4><div class="tag-cloud">${ads.map((a) => `<span class="tag">${htmlEscape(a)}</span>`).join("")}</div></div>`;
}

function renderTriggers(profile) {
  const triggers = profile.manipulation_triggers || [];
  if (triggers.length === 0) return "";
  return `<div class="block-triggers"><h4>Manipulations-Trigger</h4><ul class="trigger-list">${triggers.map((t) => `<li>${htmlEscape(t)}</li>`).join("")}</ul></div>`;
}

function renderVerdict(profile) {
  const text = profile.profileText || "";
  if (!text) return `<div class="verdict empty">profileText leer</div>`;
  return `<div class="verdict"><div class="verdict-head">⚠️ profileText (Verdict)</div><p>${htmlEscape(text)}</p></div>`;
}

function renderProfileFull(profile, label, pipelineClass) {
  if (profile._parseError) {
    return `<div class="profile-block ${pipelineClass}"><h3 class="pipeline-h">${htmlEscape(label)}</h3><div class="warn">JSON-Parse-Fehler</div></div>`;
  }
  return `<div class="profile-block ${pipelineClass}">
    <h3 class="pipeline-h">${htmlEscape(label)}</h3>
    ${renderVerdict(profile)}
    ${renderCardsLive(profile)}
    ${renderAds(profile)}
    ${renderTriggers(profile)}
  </div>`;
}

function renderBundle(result) {
  if (!result.bundle) return `<div class="bundle-block none">(kein Bundle — A nutzt Live-Architektur)</div>`;
  if (result.bundle._parseError) return `<div class="bundle-block warn">Bundle-Parse-Fehler</div>`;
  const hf = result.bundle.hard_facts || {};
  const hfHtml = CATEGORY_ORDER.map((k) => {
    const v = hf[k];
    return `<dt>${CATEGORY_LABELS[k]}</dt><dd>${v ? htmlEscape(v) : `<span class="missing-val">fehlt</span>`}</dd>`;
  }).join("");
  return `<div class="bundle-block">
    <h4>hard_facts (Konsistenz-Anker)</h4>
    <dl class="hard-facts">${hfHtml}</dl>
  </div>`;
}

function renderDescription(result, label) {
  return `<div class="desc-block"><h4>${htmlEscape(label)}</h4><div class="desc-text">${htmlEscape(result.description)}</div></div>`;
}

function renderStatsRow(result) {
  const agg = aggregateCalls(result.calls);
  const small2603 = result.calls.filter((c) => c.model === MODELS.SMALL_2603).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  const small2506 = result.calls.filter((c) => c.model === MODELS.SMALL_2506).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  const large = result.calls.filter((c) => /large/i.test(c.model)).reduce((s, c) => s + c.promptTokens + c.outputTokens, 0);
  return `
    <div class="stats-cell">
      <strong>Gesamt:</strong> ${agg.promptTokens + agg.outputTokens} Tokens · ${(agg.costEur * 100).toFixed(2)} ct<br>
      Large: ${large} · Small 2603: ${small2603} · Small 2506: ${small2506}<br>
      ${result.calls.length} Calls, Σ ${(agg.totalMs / 1000).toFixed(1)} s
    </div>`;
}

function renderImage(item) {
  const [a, b, c] = item.results;
  return `
    <section class="image-section">
      <h2>📷 ${htmlEscape(item.imageName)}</h2>
      <img class="preview" src="${item.imageDataUrl}" alt="">

      <h3>1. Bildbeschreibung (vom Large-Modell)</h3>
      <div class="three-col">
        ${renderDescription(a, "A — Heute live")}
        ${renderDescription(b, "B — V2 mit 2506")}
        ${renderDescription(c, "C — V2 mit 2603")}
      </div>

      <h3>2. hard_facts (nur in B/C — Konsistenz-Anker)</h3>
      <div class="three-col">
        ${renderBundle(a)}
        ${renderBundle(b)}
        ${renderBundle(c)}
      </div>

      <h3>3. Modus NORMAL — Profil-Ausgabe</h3>
      <div class="three-col">
        ${renderProfileFull(a.profiles.normal, "A — Heute live", "live")}
        ${renderProfileFull(b.profiles.normal, "B — V2 mit 2506", "v2-2506")}
        ${renderProfileFull(c.profiles.normal, "C — V2 mit 2603", "v2-2603")}
      </div>

      <h3>4. Modus BEAST — Profil-Ausgabe</h3>
      <div class="three-col">
        ${renderProfileFull(a.profiles.boost, "A — Heute live", "live")}
        ${renderProfileFull(b.profiles.boost, "B — V2 mit 2506", "v2-2506")}
        ${renderProfileFull(c.profiles.boost, "C — V2 mit 2603", "v2-2603")}
      </div>

      <h3>5. Token + Kosten</h3>
      <div class="three-col">
        ${renderStatsRow(a)}
        ${renderStatsRow(b)}
        ${renderStatsRow(c)}
      </div>
    </section>`;
}

function renderRatingTable(perImage) {
  const criteria = [
    "Beschreibung ähnlich detailliert?",
    "Alter realistisch?",
    "Geschlecht korrekt (Bias-Test bei Kindern)?",
    "Marken plausibel + Anzahl OK?",
    "Trigger bildspezifisch?",
    "Karten-Werte stimmig + detailliert?",
    "Karten Normal ↔ Beast Grundfakten konsistent?",
    "profileText konkret (nennt Marken)?",
    "profileText konsistent mit Karten?",
    "Beast spürbar härter ohne Inkohärenz?",
  ];
  const headers = perImage.map((i) => `<th>${htmlEscape(i.imageName)}</th>`).join("");
  const rows = criteria.map((cr) => `<tr><td class="kriterium">${cr}</td>${perImage.map(() => `<td>A:_ B:_ C:_</td>`).join("")}</tr>`).join("");
  return `<section class="rating-section">
    <h2>Bewertungstabelle (1–5 pro Pipeline, ausfüllen beim Anschauen)</h2>
    <table class="rating-table">
      <thead><tr><th>Kriterium</th>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderHtml(perImage) {
  const styles = `
    <style>
      :root {
        --bg: #fafafa; --card: #fff; --border: #ddd; --text: #222; --muted: #666;
        --warn: #d97706;
        --live-bg: #f0fff0; --v2-2506-bg: #f0f8ff; --v2-2603-bg: #fffbf0;
      }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1900px; margin: 1rem auto; padding: 0 1rem; line-height: 1.45; color: var(--text); background: var(--bg); }
      h1 { border-bottom: 3px solid #444; padding-bottom: 0.4rem; }
      h2 { background: #eef; padding: 0.5rem 0.8rem; margin-top: 3rem; border-left: 5px solid #44e; }
      h3 { margin-top: 2rem; color: #444; }
      .image-section { margin-bottom: 5rem; padding-bottom: 2rem; border-bottom: 2px dashed #aaa; }
      .preview { max-width: 380px; max-height: 280px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 1rem; }
      .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items: start; }
      .desc-block, .bundle-block, .profile-block, .stats-cell {
        background: var(--card); padding: 0.8rem; border: 1px solid var(--border); border-radius: 6px;
      }
      .desc-block.live, .profile-block.live, .bundle-block.live { background: var(--live-bg); }
      .desc-block h4, .bundle-block h4 { margin: 0 0 0.5rem 0; font-size: 0.95rem; color: var(--muted); }
      .pipeline-h { margin: 0 0 0.6rem 0; font-size: 0.95rem; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
      .desc-text { font-size: 0.82rem; max-height: 250px; overflow-y: auto; white-space: pre-wrap; }
      .three-col > div:nth-child(1) { background: var(--live-bg); }
      .three-col > div:nth-child(2) { background: var(--v2-2506-bg); }
      .three-col > div:nth-child(3) { background: var(--v2-2603-bg); }

      /* Verdict-Box (Live-Frontend-Stil) */
      .verdict { background: linear-gradient(135deg, #fff3e0 0%, #ffe8d6 100%); border: 1px solid #f59e0b; border-radius: 6px; padding: 0.7rem; margin-bottom: 0.7rem; }
      .verdict-head { font-weight: bold; color: var(--warn); margin-bottom: 0.3rem; font-size: 0.85rem; }
      .verdict p { margin: 0; font-size: 0.85rem; }
      .verdict.empty { background: #fee; color: #c00; font-style: italic; }

      /* Karten (Live-Frontend cat-card-Stil) */
      .cat-grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; margin-top: 0.5rem; }
      .cat-card { background: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; }
      .cat-card.missing { opacity: 0.5; }
      .cat-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; font-size: 0.78rem; }
      .cat-label { font-weight: bold; color: #333; }
      .cat-conf.high { color: #16a34a; font-weight: bold; }
      .cat-conf.med { color: #ca8a04; font-weight: bold; }
      .cat-conf.low { color: #c00; font-weight: bold; }
      .cat-value { margin: 0.2rem 0; font-size: 0.78rem; }
      .conf-track { height: 3px; background: #eee; border-radius: 2px; margin-top: 0.3rem; }
      .conf-bar { height: 100%; border-radius: 2px; }
      .conf-bar.high { background: #4ade80; }
      .conf-bar.med { background: #fbbf24; }
      .conf-bar.low { background: #f87171; }
      .missing-val { color: #c00; font-style: italic; }

      /* Marken + Triggers */
      .block-tags, .block-triggers { margin-top: 0.7rem; padding-top: 0.5rem; border-top: 1px dashed var(--border); }
      .block-tags h4, .block-triggers h4 { margin: 0 0 0.4rem 0; font-size: 0.82rem; color: var(--muted); }
      .tag-cloud { display: flex; flex-wrap: wrap; gap: 4px; }
      .tag { background: #e0e7ff; color: #3730a3; padding: 3px 7px; border-radius: 3px; font-size: 0.75rem; font-weight: 500; }
      .trigger-list { padding-left: 18px; margin: 0; font-size: 0.78rem; }
      .trigger-list li { margin-bottom: 4px; }

      /* hard_facts */
      .hard-facts { display: grid; grid-template-columns: 1fr 2fr; gap: 0.2rem 0.5rem; margin: 0; font-size: 0.78rem; }
      .hard-facts dt { font-weight: bold; color: var(--muted); }
      .hard-facts dd { margin: 0; }
      .bundle-block.none { color: var(--muted); font-style: italic; text-align: center; padding: 1.5rem 0.5rem; }

      .stats-cell { font-size: 0.8rem; }
      .warn { background: #fee; color: #900; padding: 0.5rem; border-left: 3px solid #c00; }

      .rating-section { margin-top: 5rem; padding: 1rem; background: #f5f5f5; border: 2px solid #44e; border-radius: 6px; }
      .rating-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
      .rating-table th, .rating-table td { padding: 4px 6px; border: 1px solid var(--border); text-align: center; }
      .rating-table th { background: #eef; }
      .rating-table .kriterium { background: #f5f5f5; text-align: left; font-weight: bold; }
      .meta { color: var(--muted); font-size: 0.9rem; }
    </style>
  `;

  const body = perImage.map(renderImage).join("\n");
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>malziME — Pipeline-Vergleich (V2)</title>${styles}</head>
<body>
  <h1>Pipeline-Vergleich (Live-Frontend-Stil) · ${new Date().toLocaleString("de-AT")}</h1>
  <p class="meta">
    Spalte A (grün) = aktuelle Live-Pipeline (Status quo).<br>
    Spalte B (blau) = neue V2-Architektur mit <code>mistral-small-2506</code> für die Karten.<br>
    Spalte C (gelb) = neue V2-Architektur mit <code>mistral-small-2603</code> für die Karten.<br>
    Alle drei nutzen <code>mistral-large-2512</code> für die Bildanalyse.<br>
    Test-Prompts in <code>functions/scripts/test-prompts-v2.js</code> nutzen die Live-Prompts als Basis (gleiche Tiefe, gleiches Schema, nur andere Call-Aufteilung).
  </p>
  ${body}
  ${renderRatingTable(perImage)}
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
  if (!mimeType) return { imageName, error: `Unbekannter Bild-Typ: ${path.extname(imageName)}` };
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  console.log(`Bildgröße: ${Math.round(imageBuffer.length / 1024)} KB`);

  try {
    const t0 = Date.now();
    const [a, b, c] = await Promise.all([
      runPipelineA(imageBuffer, mimeType).catch((e) => ({ label: "A — Heute live", calls: [], description: "", bundle: null, profiles: { normal: { _parseError: true, categories: {} }, boost: { _parseError: true, categories: {} } }, _error: e.message })),
      runPipelineV2(imageBuffer, mimeType, MODELS.SMALL_2506, "B — V2 mit 2506").catch((e) => ({ label: "B — V2 mit 2506", calls: [], description: "", bundle: null, profiles: { normal: { _parseError: true, categories: {} }, boost: { _parseError: true, categories: {} } }, _error: e.message })),
      runPipelineV2(imageBuffer, mimeType, MODELS.SMALL_2603, "C — V2 mit 2603").catch((e) => ({ label: "C — V2 mit 2603", calls: [], description: "", bundle: null, profiles: { normal: { _parseError: true, categories: {} }, boost: { _parseError: true, categories: {} } }, _error: e.message })),
    ]);
    console.log(`Alle drei Pipelines fertig nach ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    for (const r of [a, b, c]) {
      if (r._error) console.log(`  ${r.label}: FEHLER — ${r._error}`);
      else {
        const agg = aggregateCalls(r.calls);
        console.log(`  ${r.label}: ${r.calls.length} Calls · ${(agg.promptTokens + agg.outputTokens).toLocaleString("de-AT")} Tokens · ${(agg.costEur * 100).toFixed(2)} ct`);
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
    process.exit(1);
  }
  const files = fs.readdirSync(INPUT_DIR).filter((f) => mimeTypeOf(f) !== null).map((f) => path.join(INPUT_DIR, f)).sort();
  if (files.length === 0) {
    console.error(`Keine Bilder in ${INPUT_DIR}.`);
    process.exit(1);
  }
  console.log(`${files.length} Bild(er) gefunden, starte Vergleich...`);
  console.log(`largeBundlePrompt-Länge: ${testPrompts._bundlePromptLength} Zeichen`);

  const perImage = [];
  for (const f of files) {
    perImage.push(await processImage(f));
    /* Daten-Cache als JSON UND HTML inkrementell schreiben — falls Skript bricht,
       sind die bis dahin fertigen Bilder im JSON für späteres Re-Rendering. */
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(perImage, null, 2));
    fs.writeFileSync(OUTPUT_HTML, renderHtml(perImage));
  }

  console.log(`\nFertig.`);
  console.log(`  HTML: ${OUTPUT_HTML}`);
  console.log(`  JSON: ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error(`Unerwarteter Fehler: ${err.stack || err.message}`);
  process.exit(1);
});
