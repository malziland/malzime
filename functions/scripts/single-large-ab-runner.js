#!/usr/bin/env node
"use strict";

/**
 * single-large-ab-runner.js — A/B-Test Live-Prompt vs. RC1-Kandidat.
 *
 * Fährt ALLE Bilder aus compare-input/ je 3× gegen Live-Prompt und 3× gegen
 * RC1-Prompt (PROMPT_VARIANT-Logik intern, kein ENV-Schalter). Bewertet
 * 7 automatische + 2 manuelle Metriken und schreibt einen Markdown-Report.
 *
 * NICHT Production. Lädt nichts aus functions/src außer dem Live-Locale-Prompt.
 * Schreibt nur lokale Output-Dateien — kein Live-Deploy, kein Firestore.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/single-large-ab-runner.js
 *
 *   Optional:
 *     RUNS_PER_IMAGE=3        Default 3
 *     CONCURRENCY=5           Default 5 (parallele Mistral-Calls)
 *     TEST_IMAGES=a.jpg,b.jpg Default: alle Bilder in compare-input/
 *
 * Output:
 *   ./ab-test-results.json        Roh-Daten aller 90 Calls
 *   ./ab-test-report.md           Markdown-Auswertung
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");
const OUTPUT_JSON = path.join(REPO_ROOT, "ab-test-results.json");
const OUTPUT_REPORT = path.join(REPO_ROOT, "ab-test-report.md");

const ENDPOINT = "https://api.eu.mistral.ai/v1/chat/completions";
const MODEL = "mistral-large-2512";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.5;
const TIMEOUT_MS = 180_000;

const RUNS_PER_IMAGE = Number(process.env.RUNS_PER_IMAGE || 3);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

const LIVE_PROMPT = require("../src/locales/de/prompts").singleLargePrompt;
const RC1_PROMPT = require("./prompts-v2.2.1-rc1").singleLargePrompt;

/* ────────────────────────────────────────────────────────────────────────── */

function loadApiKey() {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  try {
    console.log("MISTRAL_API_KEY nicht in ENV — versuche firebase functions:secrets:access ...");
    const key = (() => { throw new Error("MISTRAL_API_KEY muss ausdruecklich gesetzt werden — dieses Skript holt den Produktivschluessel nicht mehr von selbst (Audit 2026-08-10, OSS-002)."); })().trim();
    if (!key || key.length < 10) throw new Error("Leerer Secret");
    return key;
  } catch (err) {
    console.error("FEHLER: Kein MISTRAL_API_KEY. Setze ihn als ENV oder via firebase login.");
    console.error("  Details:", err.message);
    process.exit(1);
  }
}

function loadImages() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`FEHLER: ${INPUT_DIR} nicht gefunden`); process.exit(1);
  }
  let files = fs.readdirSync(INPUT_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (process.env.TEST_IMAGES) {
    const wanted = process.env.TEST_IMAGES.split(",").map((s) => s.trim()).filter(Boolean);
    files = wanted.filter((w) => files.includes(w));
  }
  return files.map((name) => {
    const buf = fs.readFileSync(path.join(INPUT_DIR, name));
    const ext = name.split(".").pop().toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { name, base64: buf.toString("base64"), mime, sizeKB: Math.round(buf.length / 1024) };
  });
}

async function callMistral({ promptText, image, apiKey }) {
  const dataUrl = `data:${image.mime};base64,${image.base64}`;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: dataUrl },
      ],
    }],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return { error: `HTTP-Fehler: ${err.message}`, httpMs: Date.now() - start };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { error: `Mistral ${res.status}: ${errBody.slice(0, 200)}`, httpMs: Date.now() - start };
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const usage = json.usage || {};
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(text); } catch (err) { parseError = err.message; }

  return {
    promptTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    httpMs: Date.now() - start,
    finishReason: choice?.finish_reason || "unknown",
    rawText: text,
    parsed,
    parseError,
  };
}

/* Pool mit Concurrency-Limit */
async function runWithLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Metriken
 * ────────────────────────────────────────────────────────────────────────── */

const REQUIRED_CARDS = [
  "alter_geschlecht", "herkunft", "einkommen", "bildung", "beziehungsstatus",
  "interessen", "persoenlichkeit", "charakterzuege", "politisch", "gesundheit",
  "kaufkraft", "verletzlichkeit", "werbeprofil",
];

const LEAKAGE_TOKENS = [
  "bikepack", "garmin edge 1040", "rapha pro team", "wahoo kickr",
  "specialized roubaix", "ortlieb", "komoot premium", "endurance",
];

const BEAST_OPENERS = [
  /^wir verkaufen\b/i, /^wir wissen\b/i, /^wir bombardieren\b/i,
  /^wir kalkulieren\b/i, /^wir testen\b/i, /^algorithmen sehen\b/i,
  /^für unsere ad-systeme\b/i, /^versicherer rechnen\b/i,
  /^dein werbewert\b/i, /^du bist für uns\b/i,
];

function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

function evaluateRun(result, imageName) {
  if (!result.parsed) {
    return { valid: false, error: result.parseError || result.error || "no parse" };
  }
  const p = result.parsed;
  const m = {
    valid: true,
    imageName,
    cardsTotal: 0,
    cardsInRange: 0,
    cardsBelow15: 0,
    cardsAbove25: 0,
    cardsListLike: 0,
    confidenceValues: [],
    leakageHits: 0,
    inventedBrands: 0,
    hardFactsConsistent: false,
    beastOpenerRepeats: 0,
    standardProfileWords: countWords(p.standard?.profileText),
    beastProfileWords: countWords(p.beast?.profileText),
    cardsMissing: 0,
  };

  for (const mode of ["standard", "beast"]) {
    const cats = p[mode]?.categories || {};
    for (const key of REQUIRED_CARDS) {
      const card = cats[key];
      if (!card || !card.value) { m.cardsMissing++; continue; }
      m.cardsTotal++;
      const w = countWords(card.value);
      if (w >= 15 && w <= 25) m.cardsInRange++;
      if (w < 15) m.cardsBelow15++;
      if (w > 25) m.cardsAbove25++;
      /* Stichwort-Liste: enthält ≥3 Kommas und keinen Punkt vor letztem Komma → grobe Heuristik */
      const commas = (card.value.match(/,/g) || []).length;
      const sentences = card.value.split(/[.!?]/).filter((s) => s.trim().length > 0);
      if (commas >= 3 && sentences.length < 2) m.cardsListLike++;
      if (typeof card.confidence === "number") m.confidenceValues.push(card.confidence);
      /* Leakage */
      const lc = card.value.toLowerCase();
      for (const tok of LEAKAGE_TOKENS) if (lc.includes(tok)) m.leakageHits++;
    }
  }

  /* Hard-Facts-Konsistenz */
  const hf = p.hard_facts || {};
  const ag = (hf.alter_geschlecht || "").trim();
  const hk = (hf.herkunft || "").trim();
  const sAG = (p.standard?.categories?.alter_geschlecht?.value || "").trim();
  const bAG = (p.beast?.categories?.alter_geschlecht?.value || "").trim();
  const sHK = (p.standard?.categories?.herkunft?.value || "").trim();
  const bHK = (p.beast?.categories?.herkunft?.value || "").trim();
  /* "wortgleich" = Hard-Fact muss als Substring in beiden value-Strings vorkommen */
  m.hardFactsConsistent = ag && hk && sAG.includes(ag) && bAG.includes(ag) && sHK.includes(hk) && bHK.includes(hk);

  /* Beast-profileText Opener-Wiederholungen: zähle, wie oft derselbe Opener-Pattern ≥2× im Text vorkommt */
  const beastText = p.beast?.profileText || "";
  const beastSentences = beastText.split(/(?<=[.!?])\s+/).filter(Boolean);
  const openerCounts = new Map();
  for (const s of beastSentences) {
    for (const re of BEAST_OPENERS) {
      if (re.test(s.trim())) {
        const key = re.source;
        openerCounts.set(key, (openerCounts.get(key) || 0) + 1);
        break;
      }
    }
  }
  for (const c of openerCounts.values()) if (c >= 3) m.beastOpenerRepeats++;

  /* ad_targeting plausibilität — wir können nicht "erfundene Marken" zuverlässig erkennen.
     Heuristik: Eintrag ist plausibel, wenn er <= 4 Wörter hat UND mind. einen Großbuchstaben enthält. */
  for (const entry of (p.ad_targeting || [])) {
    if (typeof entry !== "string") continue;
    const w = entry.trim().split(/\s+/);
    if (w.length > 4) m.inventedBrands++;
  }

  m.confidenceMean = m.confidenceValues.length
    ? m.confidenceValues.reduce((a,b)=>a+b,0)/m.confidenceValues.length : 0;
  const mean = m.confidenceMean;
  m.confidenceStdDev = m.confidenceValues.length > 1
    ? Math.sqrt(m.confidenceValues.reduce((a,v)=>a+(v-mean)**2,0)/m.confidenceValues.length) : 0;

  return m;
}

function aggregate(evals, label) {
  const valid = evals.filter((e) => e.valid);
  if (!valid.length) return { label, n: 0, error: "keine validen Ergebnisse" };
  const sum = (k) => valid.reduce((a,e) => a + (e[k] || 0), 0);
  const avg = (k) => sum(k) / valid.length;
  const pct = (num, den) => den ? (num / den * 100).toFixed(1) + "%" : "n/a";
  return {
    label,
    runs: evals.length,
    parsedOk: valid.length,
    parseFailRate: pct(evals.length - valid.length, evals.length),
    cardsTotalAvg: avg("cardsTotal").toFixed(1),
    cardsMissingAvg: avg("cardsMissing").toFixed(2),
    cardsInRangePct: pct(sum("cardsInRange"), sum("cardsTotal")),
    cardsBelow15Pct: pct(sum("cardsBelow15"), sum("cardsTotal")),
    cardsAbove25Pct: pct(sum("cardsAbove25"), sum("cardsTotal")),
    cardsListLikeTotal: sum("cardsListLike"),
    confidenceMeanAvg: avg("confidenceMean").toFixed(3),
    confidenceStdDevAvg: avg("confidenceStdDev").toFixed(3),
    leakageHitsTotal: sum("leakageHits"),
    leakageRunsAffected: valid.filter((e) => e.leakageHits > 0).length,
    inventedBrandsTotal: sum("inventedBrands"),
    hardFactsConsistentPct: pct(valid.filter((e) => e.hardFactsConsistent).length, valid.length),
    beastOpenerRepeatRunsAffected: valid.filter((e) => e.beastOpenerRepeats > 0).length,
    standardProfileWordsAvg: avg("standardProfileWords").toFixed(1),
    beastProfileWordsAvg: avg("beastProfileWords").toFixed(1),
  };
}

function generateReport(liveAgg, rc1Agg, costEUR, durationMin, totalCalls) {
  const cmpLine = (key, lower, format = (v)=>v) => {
    const liveV = liveAgg[key];
    const rc1V = rc1Agg[key];
    const liveN = parseFloat(String(liveV).replace("%",""));
    const rc1N = parseFloat(String(rc1V).replace("%",""));
    let arrow = "→";
    if (!Number.isNaN(liveN) && !Number.isNaN(rc1N)) {
      if (Math.abs(rc1N - liveN) < 0.1) arrow = "→";
      else if (lower ? rc1N < liveN : rc1N > liveN) arrow = "**↑ besser**";
      else arrow = "↓ schlechter";
    }
    return `| ${key} | ${format(liveV)} | ${format(rc1V)} | ${arrow} |`;
  };

  return `# A/B-Test: Live-Prompt vs. RC1-Kandidat

- Bilder: ${liveAgg.runs / RUNS_PER_IMAGE} × ${RUNS_PER_IMAGE} Läufe = ${liveAgg.runs} pro Variante
- Mistral-Calls insgesamt: ${totalCalls}
- Dauer: ${durationMin.toFixed(1)} Min
- Kosten (geschätzt): ${costEUR.toFixed(2)} EUR
- Modell: ${MODEL}  |  Temperature: ${TEMPERATURE}  |  Max-Tokens: ${MAX_TOKENS}

## Metriken-Vergleich

| Metrik | Live | RC1 | Richtung |
|---|---|---|---|
${cmpLine("parseFailRate", true)}
${cmpLine("cardsMissingAvg", true)}
${cmpLine("cardsInRangePct", false)}
${cmpLine("cardsBelow15Pct", true)}
${cmpLine("cardsAbove25Pct", true)}
${cmpLine("cardsListLikeTotal", true)}
${cmpLine("confidenceMeanAvg", false)}
${cmpLine("confidenceStdDevAvg", false)}
${cmpLine("leakageHitsTotal", true)}
${cmpLine("leakageRunsAffected", true)}
${cmpLine("inventedBrandsTotal", true)}
${cmpLine("hardFactsConsistentPct", false)}
${cmpLine("beastOpenerRepeatRunsAffected", true)}
${cmpLine("standardProfileWordsAvg", false)}
${cmpLine("beastProfileWordsAvg", false)}

## Lese-Hilfe

- **cardsInRangePct** — wie viele Karten im 15–25-Wörter-Korridor liegen. Höher = besser.
- **cardsBelow15Pct / cardsAbove25Pct** — Karten unter/über dem Korridor. Niedriger = besser.
- **cardsListLikeTotal** — Karten, die wie Stichwort-Listen aussehen (≥3 Kommas, <2 Sätze). Niedriger = besser.
- **confidenceStdDevAvg** — Standardabweichung der Confidence pro Lauf. Höher = ehrlich differenziert (statt allem 0.85).
- **leakageHitsTotal** — Erwähnungen von Schema-Beispiel-Vokabeln (Bikepack/Garmin/Wahoo/Specialized/Ortlieb/Komoot Premium/Endurance) in Karten-Values, summiert.
- **leakageRunsAffected** — Wie viele Läufe sind überhaupt von Leakage betroffen.
- **inventedBrandsTotal** — ad_targeting-Einträge mit >4 Wörtern (Heuristik für „keine Marke, sondern Satz").
- **hardFactsConsistentPct** — Anteil Läufe, in denen hard_facts.alter_geschlecht UND .herkunft wortgleich in beiden Modus-Karten landen.
- **beastOpenerRepeatRunsAffected** — Läufe, in denen ein Beast-Opener-Pattern (z.B. „Wir verkaufen") ≥3× im profileText vorkommt. Niedriger = weniger monoton.

## Entscheidungsregel (vorab festgelegt)

- **Deploy**, wenn ≥5 Metriken **besser** UND **keine** schlechter.
- **Stop und nachbessern**, wenn auch nur eine Metrik schlechter.
- **Stop und vergessen**, wenn alle Pari.
`;
}

/* ────────────────────────────────────────────────────────────────────────── */

async function main() {
  const apiKey = loadApiKey();
  const images = loadImages();
  console.log(`A/B-Test: ${images.length} Bilder × ${RUNS_PER_IMAGE} Läufe × 2 Varianten = ${images.length * RUNS_PER_IMAGE * 2} Calls`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Bilder: ${images.map((i) => i.name).join(", ")}\n`);

  const tasks = [];
  for (const image of images) {
    for (let run = 0; run < RUNS_PER_IMAGE; run++) {
      tasks.push(async () => {
        const r = await callMistral({ promptText: LIVE_PROMPT, image, apiKey });
        return { variant: "live", image: image.name, run, ...r };
      });
      tasks.push(async () => {
        const r = await callMistral({ promptText: RC1_PROMPT, image, apiKey });
        return { variant: "rc1", image: image.name, run, ...r };
      });
    }
  }

  const totalCalls = tasks.length;
  console.log(`Starte ${totalCalls} Calls (parallel ${CONCURRENCY})...`);
  const tStart = Date.now();
  let done = 0;
  /* Wrapping mit Fortschrittsanzeige */
  const wrapped = tasks.map((t) => async () => {
    const r = await t();
    done++;
    const status = r.error ? `ERROR (${r.error.slice(0,50)})` :
                   r.parsed ? `OK ${r.totalTokens} tok` : `parse-fail`;
    console.log(`  [${done}/${totalCalls}] ${r.variant.padEnd(4)} ${r.image.padEnd(50)} ${status}`);
    return r;
  });
  const results = await runWithLimit(wrapped, CONCURRENCY);
  const durationMin = (Date.now() - tStart) / 60_000;

  /* Auswertung */
  const liveResults = results.filter((r) => r.variant === "live");
  const rc1Results  = results.filter((r) => r.variant === "rc1");
  const liveEvals = liveResults.map((r) => evaluateRun(r, r.image));
  const rc1Evals  = rc1Results.map((r) => evaluateRun(r, r.image));
  const liveAgg = aggregate(liveEvals, "live");
  const rc1Agg  = aggregate(rc1Evals,  "rc1");

  /* Kosten */
  const allCalls = results.filter((r) => r.totalTokens > 0);
  const totalIn  = allCalls.reduce((a,r) => a + (r.promptTokens || 0), 0);
  const totalOut = allCalls.reduce((a,r) => a + (r.outputTokens || 0), 0);
  const costUSD = (totalIn/1_000_000)*2 + (totalOut/1_000_000)*6;
  const costEUR = costUSD * 0.92;

  /* Schreiben */
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({
    meta: { totalCalls, durationMin, costEUR, model: MODEL, temperature: TEMPERATURE, runsPerImage: RUNS_PER_IMAGE },
    aggregations: { live: liveAgg, rc1: rc1Agg },
    rawResults: results.map((r) => ({ ...r, rawText: undefined })),
  }, null, 2));
  fs.writeFileSync(OUTPUT_REPORT, generateReport(liveAgg, rc1Agg, costEUR, durationMin, totalCalls));

  console.log(`\nFertig. Roh: ${OUTPUT_JSON}\nReport: ${OUTPUT_REPORT}\n`);
  console.log("=== AGG LIVE ==="); console.log(liveAgg);
  console.log("=== AGG RC1  ==="); console.log(rc1Agg);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
