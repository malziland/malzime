#!/usr/bin/env node
"use strict";

/**
 * single-large-ab-runner-v3-ads.js — A/B-Test Live-Prompt vs. Werbe-Kandidat.
 *
 * ADDITIV / TEST-ONLY. Lädt den Live-Locale-Prompt (lesend) und den Kandidaten
 * aus scripts/prompts-candidate-ads-split.js. Berührt KEINEN Produktionscode,
 * kein Firestore, kein Deploy. Schreibt nur lokale Output-Dateien.
 *
 * MISST GENAU ZWEI FRAGEN:
 *   1) Ist die Werbung im Beast-Modus dieselbe wie im Standard-Modus?
 *      Live ist die Antwort per Bauweise 100 % (src/mistral.js:835 kopiert eine
 *      Liste in beide Modi). Der Kandidat soll deutlich darunter liegen.
 *   2) Wiederholen sich über verschiedene Fotos hinweg dieselben Marken?
 *      Gemessen als Anker-Rate (Marken aus der Prompt-Beispielliste),
 *      Marken-Vielfalt und Bild-zu-Bild-Überlappung.
 *
 * QUALITÄTS-WÄCHTER (der Kandidat darf nichts kaputt machen):
 *   Alters-/Geschlechtstreffer gegen compare-input/ground-truth.json,
 *   Konkretheit der Marken, Platzhalter-Echos, Parse-Fehler,
 *   abgeschnittene Antworten (finish_reason = length), Tokenverbrauch.
 *
 * CACHE-TREUE:
 *   Beide Varianten fahren mit system/user-Split wie der Live-Cache-Pfad
 *   (src/mistral.js:761-771). Der Kandidat hängt seine rotierende Sperrliste
 *   hinter das Bild in die user-Message — dort war ohnehin nie Cache.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/single-large-ab-runner-v3-ads.js
 *   Optional: RUNS_PER_IMAGE=3  CONCURRENCY=4  TEST_IMAGES=a.jpg,b.jpg
 *
 * WICHTIG: NICHT Mo–Fr 08–14 Uhr starten (konkurriert mit der Produktion um
 * denselben Mistral-Key/TPM). Abends/Wochenende fahren.
 *
 * Output:
 *   ./ab-test-v3-ads-results.json   Rohdaten aller Calls
 *   ./ab-test-v3-ads-report.md      Markdown-Auswertung
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { parseSafely } = require("../src/json-repair");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");
const OUTPUT_JSON = path.join(REPO_ROOT, "ab-test-v3-ads-results.json");
const OUTPUT_REPORT = path.join(REPO_ROOT, "ab-test-v3-ads-report.md");

const ENDPOINT = "https://api.eu.mistral.ai/v1/chat/completions";
const MODEL = "mistral-large-2512";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.5;
const TIMEOUT_MS = 180_000;

const RUNS_PER_IMAGE = Number(process.env.RUNS_PER_IMAGE || 3);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

const LIVE_PROMPT = require("../src/locales/de/prompts").singleLargePrompt;
const CANDIDATE = require("./prompts-candidate-ads-split");

const GROUND_TRUTH = (() => {
  const p = path.join(INPUT_DIR, "ground-truth.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
})();

/* Die neun Beispielmarken aus dem Live-Prompt — kanonisiert. Tauchen sie in
   einer Antwort auf, ist das ein Anker-Treffer (Modell schreibt das Beispiel
   ab, statt aus dem Foto abzuleiten). */
const ANCHOR_BRANDS = [
  "garmin edge", "garmin", "rapha pro team", "rapha", "red bull energy", "red bull",
  "apple watch ultra", "apple watch", "wahoo kickr", "wahoo elemnt", "wahoo",
  "specialized roubaix", "specialized", "komoot premium", "komoot",
  "ortlieb back-roller", "ortlieb", "nike metcon",
];

/* ────────────────────────────── Infrastruktur ───────────────────────────── */

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
    console.error(`FEHLER: ${INPUT_DIR} nicht gefunden`);
    process.exit(1);
  }
  let files = fs.readdirSync(INPUT_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (process.env.TEST_IMAGES) {
    const wanted = process.env.TEST_IMAGES.split(",").map((s) => s.trim()).filter(Boolean);
    files = files.filter((f) => wanted.includes(f));
  }
  files.sort();
  return files.map((name) => {
    const buf = fs.readFileSync(path.join(INPUT_DIR, name));
    const ext = path.extname(name).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { name, base64: buf.toString("base64"), mime };
  });
}

async function callMistral({ variant, image, runIndex, apiKey }) {
  const dataUrl = `data:${image.mime};base64,${image.base64}`;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /* system/user-Split wie im Live-Cache-Pfad. Der Kandidat hängt seinen
     dynamischen Block HINTER das Bild — cache-neutral. */
  const systemText = variant === "live" ? LIVE_PROMPT : CANDIDATE.systemPrompt;
  const userContent = [{ type: "image_url", image_url: dataUrl }];
  if (variant === "cand") {
    userContent.push({ type: "text", text: CANDIDATE.buildDynamicBlock(runIndex) });
  }

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userContent },
    ],
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

  let parsed = null;
  let parseError = null;
  try {
    parsed = parseSafely(text, { requireSchema: false });
    if (!parsed) parseError = "parseSafely lieferte null";
  } catch (err) {
    parseError = err.message;
  }

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

async function runWithLimit(tasks, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/* ──────────────────────────────── Metriken ──────────────────────────────── */

function isPlaceholder(s) {
  return /[‹›]/.test(String(s || ""));
}

/* Marke kanonikalisieren: lowercase, Satzzeichen weg, beim ERSTEN ziffern-
   haltigen Token abschneiden → "Garmin Edge 1040" und "Garmin Edge 1040 Solar"
   kollabieren beide zu "garmin edge". Identisch zu Runner v2. */
function canonicalizeBrand(s) {
  const tokens = String(s || "")
    .toLowerCase()
    .replace(/[„""».,()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const t of tokens) {
    if (/\d/.test(t)) break;
    out.push(t);
  }
  return out.join(" ").trim();
}

/* Werbelisten der beiden Modi holen. Live liefert EINE Liste oben — genau wie
   src/mistral.js:835 sie in beide Modi kopiert, also zählen wir sie für beide.
   Der Kandidat liefert zwei getrennte Listen unter standard/beast. */
function adsPerMode(parsed) {
  const top = Array.isArray(parsed.ad_targeting) ? parsed.ad_targeting : null;
  const std = Array.isArray(parsed.standard?.ad_targeting) ? parsed.standard.ad_targeting : top;
  const bst = Array.isArray(parsed.beast?.ad_targeting) ? parsed.beast.ad_targeting : top;
  return { standard: std || [], beast: bst || [] };
}

function brandSet(list) {
  const out = new Set();
  for (const e of list) {
    if (typeof e !== "string" || isPlaceholder(e)) continue;
    const c = canonicalizeBrand(e);
    if (c) out.add(c);
  }
  return out;
}

/* Markenstamm = erstes Wort. "shein teen haul box" und "shein teen fashion set"
   sind zwei verschiedene PRODUKTE, aber dieselbe MARKE. Ohne diesen Schnitt
   würde die Modus-Überlappung als 0 % ausgewiesen, obwohl in beiden Modi
   durchgängig Shein steht — der Kandidat sähe besser aus als er ist. */
function brandRoot(canonical) {
  return String(canonical || "").split(/\s+/)[0] || "";
}

function rootSet(list) {
  const out = new Set();
  for (const c of brandSet(list)) {
    const r = brandRoot(c);
    if (r) out.add(r);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : null;
}

/* Marken-Vergleich auf Wortgrenze. "garmin fenix" trifft die Sperre "garmin",
   "apple airpods" trifft NICHT die Sperre "apple watch". Ohne diese Präfix-
   Logik würde ein Ausweichen von "Garmin Edge" auf "Garmin Fenix" als sauber
   durchgehen und die Messung schönen. */
function brandMatches(canonical, target) {
  if (!canonical || !target) return false;
  return canonical === target || canonical.startsWith(target + " ") || target.startsWith(canonical + " ");
}

function isAnchor(canonical) {
  return ANCHOR_BRANDS.some((a) => brandMatches(canonical, a));
}

/* Konkretheit: Eintrag nennt eine Modellnummer oder mindestens zwei Wörter
   (Marke + Linie). Reine Ein-Wort-Marken sind schwächer, generische Branchen
   die schlechteste Stufe. */
function isConcrete(entry) {
  const s = String(entry || "").trim();
  if (!s || isPlaceholder(s)) return false;
  if (/\d/.test(s)) return true;
  return s.split(/\s+/).filter(Boolean).length >= 2;
}

function estimateAgeGender(parsed) {
  const s = String(parsed.hard_facts?.alter_geschlecht || "").toLowerCase();
  let gender = null;
  if (/\b(männlich|mann|junge|bub|knabe|herr|opa|male|boy)\b/.test(s)) gender = "m";
  else if (/\b(weiblich|frau|mädchen|dame|oma|seniorin|female|girl)\b/.test(s)) gender = "w";
  const nums = (s.match(/\b(\d{1,2})\b/g) || []).map(Number).filter((n) => n >= 1 && n <= 100);
  const pointMatch = s.match(/~\s*(\d{1,2})/);
  const pointAge = pointMatch ? Number(pointMatch[1]) : nums.length ? nums[0] : null;
  return { gender, ageNums: nums, pointAge };
}

function evaluateAgeGender(parsed, imageName) {
  const gt = GROUND_TRUTH[imageName];
  if (!gt || typeof gt.age !== "number") return { hasGt: false, ageHit: false, genderHit: false };
  const est = estimateAgeGender(parsed);
  const tol = gt.age < 18 ? 2 : 5;
  let ageHit = false;
  if (est.pointAge !== null) {
    ageHit = Math.abs(est.pointAge - gt.age) <= tol;
  } else if (est.ageNums.length) {
    ageHit = gt.age >= Math.min(...est.ageNums) - tol && gt.age <= Math.max(...est.ageNums) + tol;
  }
  const genderHit = est.gender !== null && est.gender === gt.gender;
  return { hasGt: true, ageHit, genderHit };
}

function evaluateRun(result) {
  if (!result.parsed) {
    const transportError = !result.rawText || !String(result.rawText).trim();
    return { valid: false, transportError, truncated: result.finishReason === "length" };
  }
  const p = result.parsed;
  const ads = adsPerMode(p);
  const stdSet = brandSet(ads.standard);
  const bstSet = brandSet(ads.beast);
  const stdRoots = rootSet(ads.standard);
  const bstRoots = rootSet(ads.beast);
  const allEntries = [...ads.standard, ...ads.beast];
  /* Live liefert fuer beide Modi DIESELBE Liste (src/mistral.js kopiert sie).
     Fuer eintragsbezogene Quoten dann nur einmal zaehlen, sonst ist die
     Grundgesamtheit doppelt so gross wie beim Kandidaten. */
  const sameList = JSON.stringify(ads.standard) === JSON.stringify(ads.beast);
  const countableEntries = (sameList ? ads.standard : allEntries).filter(
    (e) => typeof e === "string" && !isPlaceholder(e),
  );
  /* Deduplizieren: Live liefert für beide Modi DIESELBE Liste — ohne Set würde
     dort jede Marke doppelt zählen und die absoluten Zahlen wären nicht mit
     dem Kandidaten vergleichbar. */
  const allCanon = [...new Set([...stdSet, ...bstSet])];

  const blocked = CANDIDATE.BLOCKLIST_SETS[
    result.runIndex % CANDIDATE.BLOCKLIST_SETS.length
  ].map((b) => canonicalizeBrand(b));

  const ag = evaluateAgeGender(p, result.image);

  return {
    valid: true,
    truncated: result.finishReason === "length",
    /* Kernfrage 1 — Marken-Überlappung ist die strenge Zahl, Produkt-Überlappung
       die nachsichtige. Beide ausweisen, damit "andere Produkte derselben Marke"
       nicht als Erfolg durchgeht. */
    modeOverlapBrand: jaccard(stdRoots, bstRoots),
    modeOverlapProduct: jaccard(stdSet, bstSet),
    stdCount: stdSet.size,
    bstCount: bstSet.size,
    /* Kernfrage 2 */
    anchorHits: allCanon.filter(isAnchor).length,
    adEntryCount: allCanon.length,
    /* Qualitätswächter.
       WICHTIG: concreteHits/concreteEntries bilden ein eigenes Paar. Sie zaehlen
       EINTRAEGE, waehrend anchorHits/adEntryCount deduplizierte MARKEN zaehlen.
       Die beiden Paare duerfen nicht vermischt werden — sonst kommen Quoten
       ueber 100 % heraus (Live liefert fuer beide Modi dieselbe Liste: doppelt
       so viele Eintraege wie verschiedene Marken). */
    concreteHits: countableEntries.filter(isConcrete).length,
    concreteEntries: countableEntries.length,
    placeholderEchoes: allEntries.filter((e) => typeof e === "string" && isPlaceholder(e)).length,
    blocklistViolations:
      result.variant === "cand"
        ? allCanon.filter((c) => blocked.some((b) => brandMatches(c, b))).length
        : 0,
    hasGt: ag.hasGt,
    ageHit: ag.ageHit,
    genderHit: ag.genderHit,
    /* Für Cross-Image-Auswertung */
    image: result.image,
    stdBrands: [...stdSet],
    bstBrands: [...bstSet],
    brandRoots: [...new Set([...stdRoots, ...bstRoots])],
  };
}

function aggregate(evals) {
  const valid = evals.filter((e) => e.valid);
  const transportErrors = evals.filter((e) => !e.valid && e.transportError).length;
  const parseFails = evals.filter((e) => !e.valid && !e.transportError).length;
  if (!valid.length) return { n: 0, transportErrors, parseFails };

  const sum = (k) => valid.reduce((a, e) => a + (e[k] || 0), 0);
  const avgOf = (k) => {
    const vs = valid.map((e) => e[k]).filter((v) => v !== null && v !== undefined);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const withGt = valid.filter((e) => e.hasGt);

  return {
    n: valid.length,
    transportErrors,
    parseFails,
    truncated: valid.filter((e) => e.truncated).length,
    modeOverlapBrandAvg: avgOf("modeOverlapBrand"),
    modeOverlapProductAvg: avgOf("modeOverlapProduct"),
    anchorRate: sum("adEntryCount") ? sum("anchorHits") / sum("adEntryCount") : 0,
    concreteRate: sum("concreteEntries") ? sum("concreteHits") / sum("concreteEntries") : 0,
    avgAdsStandard: sum("stdCount") / valid.length,
    avgAdsBeast: sum("bstCount") / valid.length,
    placeholderEchoes: sum("placeholderEchoes"),
    blocklistViolations: sum("blocklistViolations"),
    ageHitRate: withGt.length ? withGt.filter((e) => e.ageHit).length / withGt.length : null,
    genderHitRate: withGt.length ? withGt.filter((e) => e.genderHit).length / withGt.length : null,
    gtN: withGt.length,
  };
}

/* Cross-Image: Wiederholen sich Marken über VERSCHIEDENE Fotos? */
function diversityMetrics(evals) {
  const valid = evals.filter((e) => e.valid);
  if (!valid.length) return { uniqueBrands: 0, totalMentions: 0, top3Share: 0, crossImageOverlap: null, topBrands: [] };

  /* Auf Markenstamm zählen, nicht auf Produktnamen: sonst gelten
     "Shein Teen Haul Box" und "Shein Teen Fashion Set" als zwei verschiedene
     Marken und die Vielfalt wird systematisch überschätzt. */
  const counts = new Map();
  for (const e of valid) {
    for (const b of e.brandRoots || []) {
      counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  const totalMentions = [...counts.values()].reduce((a, b) => a + b, 0);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = sorted.slice(0, 3).reduce((a, [, c]) => a + c, 0);

  /* Markenmenge pro BILD (über alle Läufe vereinigt), dann paarweise Jaccard */
  const perImage = new Map();
  for (const e of valid) {
    if (!perImage.has(e.image)) perImage.set(e.image, new Set());
    const s = perImage.get(e.image);
    for (const b of e.brandRoots || []) s.add(b);
  }
  const imgs = [...perImage.values()];
  const pairs = [];
  for (let i = 0; i < imgs.length; i++) {
    for (let j = i + 1; j < imgs.length; j++) {
      const v = jaccard(imgs[i], imgs[j]);
      if (v !== null) pairs.push(v);
    }
  }

  return {
    uniqueBrands: counts.size,
    totalMentions,
    top3Share: totalMentions ? top3 / totalMentions : 0,
    crossImageOverlap: pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null,
    topBrands: sorted.slice(0, 10),
  };
}

/* ──────────────────────────────── Report ────────────────────────────────── */

function pct(v) {
  return v === null || v === undefined ? "n/a" : (v * 100).toFixed(1) + "%";
}

function generateReport(live, cand, liveDiv, candDiv, meta) {
  const arrow = (l, c, lowerIsBetter) => {
    if (l === null || c === null) return "n/a";
    const diff = c - l;
    if (Math.abs(diff) < 0.005) return "→ unverändert";
    const better = lowerIsBetter ? diff < 0 : diff > 0;
    return `${better ? "✅" : "⚠️"} ${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)} Pp`;
  };

  return `# A/B-Test: Werbung auftrennen + Wiederholungen brechen

Modell ${meta.model} · Temperatur ${meta.temperature} · ${meta.runsPerImage} Läufe je Bild
${meta.images} Bilder · ${meta.totalCalls} Calls · ${meta.durationMin.toFixed(1)} Min · ca. ${meta.costEUR.toFixed(2)} EUR
Gefahren am ${meta.startedAt}

---

## Kernfrage 1 — Ist die Beast-Werbung dieselbe wie im Standard?

| Messwert | Live | Kandidat | |
|---|---|---|---|
| **Marken**-Überlappung Standard ↔ Beast | ${pct(live.modeOverlapBrandAvg)} | ${pct(cand.modeOverlapBrandAvg)} | ${arrow(live.modeOverlapBrandAvg, cand.modeOverlapBrandAvg, true)} |
| Produkt-Überlappung Standard ↔ Beast | ${pct(live.modeOverlapProductAvg)} | ${pct(cand.modeOverlapProductAvg)} | ${arrow(live.modeOverlapProductAvg, cand.modeOverlapProductAvg, true)} |
| Ø Werbe-Einträge Standard | ${live.avgAdsStandard?.toFixed(1) ?? "n/a"} | ${cand.avgAdsStandard?.toFixed(1) ?? "n/a"} | |
| Ø Werbe-Einträge Beast | ${live.avgAdsBeast?.toFixed(1) ?? "n/a"} | ${cand.avgAdsBeast?.toFixed(1) ?? "n/a"} | |

Live liegt bauartbedingt bei 100 % — eine Liste wird in beide Modi kopiert.

**Die Markenzeile ist die entscheidende.** Wenn Standard „Shein Teen Fashion Set"
liefert und Beast „Shein Teen Haul Box", sind das zwar zwei Produkte, aber
dieselbe Marke — die Produktzeile sähe gut aus, im Workshop stünde trotzdem
zweimal Shein auf der Wand.

## Kernfrage 2 — Wiederholen sich die Marken?

| Messwert | Live | Kandidat | |
|---|---|---|---|
| Anker-Rate (Marken aus den Prompt-Beispielen) | ${pct(live.anchorRate)} | ${pct(cand.anchorRate)} | ${arrow(live.anchorRate, cand.anchorRate, true)} |
| Verschiedene Marken insgesamt | ${liveDiv.uniqueBrands} | ${candDiv.uniqueBrands} | ${candDiv.uniqueBrands > liveDiv.uniqueBrands ? "✅ mehr Vielfalt" : "⚠️"} |
| Top-3-Marken-Anteil (Konzentration) | ${pct(liveDiv.top3Share)} | ${pct(candDiv.top3Share)} | ${arrow(liveDiv.top3Share, candDiv.top3Share, true)} |
| Marken-Überlappung zwischen verschiedenen Fotos | ${pct(liveDiv.crossImageOverlap)} | ${pct(candDiv.crossImageOverlap)} | ${arrow(liveDiv.crossImageOverlap, candDiv.crossImageOverlap, true)} |

### Häufigste Marken — Live
${liveDiv.topBrands.map(([b, c]) => `- ${b} (${c}×)`).join("\n") || "keine"}

### Häufigste Marken — Kandidat
${candDiv.topBrands.map(([b, c]) => `- ${b} (${c}×)`).join("\n") || "keine"}

## Qualitäts-Wächter — darf nicht schlechter werden

| Messwert | Live | Kandidat | |
|---|---|---|---|
| Alterstreffer (Ground Truth, n=${live.gtN}) | ${pct(live.ageHitRate)} | ${pct(cand.ageHitRate)} | ${arrow(live.ageHitRate, cand.ageHitRate, false)} |
| Geschlechtstreffer | ${pct(live.genderHitRate)} | ${pct(cand.genderHitRate)} | ${arrow(live.genderHitRate, cand.genderHitRate, false)} |
| Konkretheit der Marken | ${pct(live.concreteRate)} | ${pct(cand.concreteRate)} | ${arrow(live.concreteRate, cand.concreteRate, false)} |

## Betriebs-Wächter

| Messwert | Live | Kandidat |
|---|---|---|
| Gültige Antworten | ${live.n} | ${cand.n} |
| Parse-Fehler | ${live.parseFails} | ${cand.parseFails} |
| Transport-Fehler (HTTP/429/Timeout) | ${live.transportErrors} | ${cand.transportErrors} |
| **Abgeschnittene Antworten** | ${live.truncated} | ${cand.truncated} |
| Platzhalter wörtlich abgeschrieben | ${live.placeholderEchoes} | ${cand.placeholderEchoes} |
| Sperrlisten-Verstöße | – | ${cand.blocklistViolations} |
| Ø Input-Tokens | ${meta.liveTokIn} | ${meta.candTokIn} |
| Ø Output-Tokens | ${meta.liveTokOut} | ${meta.candTokOut} |

Abgeschnittene Antworten sind das Hauptrisiko der Auftrennung: zwei Werbelisten
machen die Antwort länger. Steht hier beim Kandidaten etwas über 0, muss
\`MAX_TOKENS\` hoch, bevor irgendetwas live geht.

---

## Lesehilfe

- **Marken-Überlappung Standard ↔ Beast**: 100 % = exakt dieselben Marken in beiden Modi. Ziel für den Kandidaten: unter 30 %.
- **Anker-Rate**: Anteil der Werbe-Einträge, die aus der Beispielliste im Prompt stammen. Hoch = das Modell schreibt ab, statt aus dem Foto abzuleiten.
- **Marken-Überlappung zwischen Fotos**: Wie ähnlich sind sich die Marken bei völlig verschiedenen Bildern. Hoch = immer dieselbe Werbung, egal wer auf dem Foto ist.
- **Konkretheit**: Anteil Einträge mit Modellnummer oder mindestens Marke + Linie. Fällt der Wert stark, wird die Werbung generisch — genau die Regression von v2.0.
`;
}

/* ───────────────────────────────── main ─────────────────────────────────── */

async function main() {
  const apiKey = loadApiKey();
  const images = loadImages();
  if (!images.length) {
    console.error("FEHLER: Keine Bilder in compare-input/ gefunden.");
    process.exit(1);
  }

  const startedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  console.log(`${images.length} Bilder × ${RUNS_PER_IMAGE} Läufe × 2 Varianten = ${images.length * RUNS_PER_IMAGE * 2} Calls`);
  console.log(`Concurrency ${CONCURRENCY} · Modell ${MODEL}\n`);

  const tasks = [];
  for (const image of images) {
    for (let r = 0; r < RUNS_PER_IMAGE; r++) {
      for (const variant of ["live", "cand"]) {
        tasks.push({ variant, image, runIndex: r });
      }
    }
  }

  let done = 0;
  const t0 = Date.now();
  const wrapped = tasks.map((t) => async () => {
    const res = await callMistral({ ...t, apiKey });
    done++;
    const status = res.error ? `FEHLER ${res.error.slice(0, 60)}` : res.parsed ? "ok" : "parse-fail";
    console.log(`[${done}/${tasks.length}] ${t.variant} ${t.image.name} #${t.runIndex + 1} — ${status}`);
    return { variant: t.variant, image: t.image.name, runIndex: t.runIndex, ...res };
  });

  const results = await runWithLimit(wrapped, CONCURRENCY);
  const durationMin = (Date.now() - t0) / 60000;

  const liveEvals = results.filter((r) => r.variant === "live").map(evaluateRun);
  const candEvals = results.filter((r) => r.variant === "cand").map(evaluateRun);

  const live = aggregate(liveEvals);
  const cand = aggregate(candEvals);
  const liveDiv = diversityMetrics(liveEvals);
  const candDiv = diversityMetrics(candEvals);

  const tokAvg = (variant, key) => {
    const rs = results.filter((r) => r.variant === variant && r.totalTokens > 0);
    return rs.length ? Math.round(rs.reduce((a, r) => a + (r[key] || 0), 0) / rs.length) : 0;
  };
  const allCalls = results.filter((r) => r.totalTokens > 0);
  const totalIn = allCalls.reduce((a, r) => a + (r.promptTokens || 0), 0);
  const totalOut = allCalls.reduce((a, r) => a + (r.outputTokens || 0), 0);
  const costEUR = ((totalIn / 1_000_000) * 2 + (totalOut / 1_000_000) * 6) * 0.92;

  const meta = {
    model: MODEL,
    temperature: TEMPERATURE,
    runsPerImage: RUNS_PER_IMAGE,
    images: images.length,
    totalCalls: tasks.length,
    durationMin,
    costEUR,
    startedAt,
    liveTokIn: tokAvg("live", "promptTokens"),
    liveTokOut: tokAvg("live", "outputTokens"),
    candTokIn: tokAvg("cand", "promptTokens"),
    candTokOut: tokAvg("cand", "outputTokens"),
  };

  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify({ meta, live, cand, liveDiv, candDiv, results }, null, 2),
  );
  fs.writeFileSync(OUTPUT_REPORT, generateReport(live, cand, liveDiv, candDiv, meta));

  console.log(`\nFertig in ${durationMin.toFixed(1)} Min · ca. ${costEUR.toFixed(2)} EUR`);
  console.log(`Report:  ${OUTPUT_REPORT}`);
  console.log(`Rohdaten: ${OUTPUT_JSON}`);
}

/* Nur beim direkten Aufruf fahren — so kann der Offline-Selbsttest die
   Metrik-Funktionen laden, ohne 96 Mistral-Calls auszulösen. */
if (require.main === module) {
  main().catch((err) => {
    console.error("Unerwarteter Fehler:", err);
    process.exit(1);
  });
}

module.exports = {
  adsPerMode,
  brandSet,
  canonicalizeBrand,
  jaccard,
  isAnchor,
  isConcrete,
  evaluateRun,
  aggregate,
  diversityMetrics,
};
