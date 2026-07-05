#!/usr/bin/env node
"use strict";

/**
 * rebuild-compare-html.js — Rendert compare-result.html neu aus dem
 * compare-results.json-Cache, ohne neue Mistral-Calls zu machen.
 * (Funktioniert weiterhin — reine Cache-Auswertung. Das Label "2506"
 * bezeichnet historische Daten; das Modell wurde zum 31.07.2026 retired.)
 *
 * Design: Live-Frontend-Look. Pro Bild zwei Reihen (Standard- und Beast-Modus),
 * jede Reihe mit drei nebeneinanderstehenden Live-Profil-Views (A=Live,
 * B=V2-2506, C=V2-2603). Karten in Gruppen mit Akzent-Linien, wie im
 * compare-prototype.html.
 *
 * Aufruf:  node functions/scripts/rebuild-compare-html.js
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_JSON = path.join(REPO_ROOT, "compare-results.json");
const OUTPUT_HTML = path.join(REPO_ROOT, "compare-result.html");

const MODELS_LARGE = "mistral-large-2512";
const MODELS_2603 = "mistral-small-2603";
const MODELS_2506 = "mistral-small-2506";

/* Karten-Gruppen (wie im Prototyp) */
const GROUPS = [
  { id: "identity", title: "Wer du bist", keys: ["alter_geschlecht", "herkunft", "beziehungsstatus"] },
  { id: "ability", title: "Was dich ausmacht", keys: ["bildung", "persoenlichkeit", "charakterzuege", "interessen"] },
  { id: "money", title: "Was du kaufst", keys: ["einkommen", "kaufkraft", "werbeprofil"] },
  { id: "risk", title: "Wo du verwundbar bist", keys: ["verletzlichkeit", "gesundheit", "politisch"] },
];

const LABELS = {
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

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function confDots(confidence) {
  const v = typeof confidence === "number" ? confidence : 0;
  const n = v >= 0.7 ? 3 : v >= 0.4 ? 2 : 1;
  return `<span class="cat-conf dots">${
    [0, 1, 2].map((i) => `<span class="d ${i < n ? "on" : ""}"></span>`).join("")
  }</span>`;
}

/* Schlüssel-Begriffe automatisch fett markieren — sehr einfache Heuristik:
   Zahlen, Eurobeträge, "Du bist X", "Du wirkst Y". Reicht für den Prototypen. */
function highlightKeyTerms(text) {
  let t = esc(text);
  /* Eurobeträge: €45.000 oder €45–60K oder "45.000 brutto" */
  t = t.replace(/(€[\s\d.,]+(?:[–-][\s\d.,]+)?(?:\s*[A-Za-zäöüÄÖÜß]+)*)/g, "<strong>$1</strong>");
  /* Erste 2-4 Worte nach "Du bist", "Du hast", "Du tendierst", "Du wirkst" markieren */
  t = t.replace(/(Du (?:bist|hast|tendierst|wirkst|verdienst)\s+)([\wäöüÄÖÜß][\wäöüÄÖÜß\s,-]{2,40}?)(\.|,|\s+(?:und|der|die|das|in|mit|bei|für)\s)/g,
    (m, p1, p2, p3) => `${p1}<strong>${p2}</strong>${p3}`);
  return t;
}

function renderCardsGrouped(profile) {
  const cats = profile.categories || {};
  if (Object.keys(cats).length === 0) {
    return `<div class="warn">Keine Karten</div>`;
  }
  return `<div class="facts-grid">${
    GROUPS.map((grp) => {
      const groupHead = `<div class="cat-group-head" data-grp="${grp.id}"><span class="group-dot"></span><h3>${grp.title}</h3></div>`;
      const cards = grp.keys.map((key) => {
        const cat = cats[key];
        if (!cat) return `<div class="cat-card missing" data-grp="${grp.id}"><div class="cat-head"><span class="cat-label">${LABELS[key]}</span><span class="cat-conf low">—</span></div><p class="cat-value missing-val">fehlt</p></div>`;
        const labelText = cat.label || LABELS[key];
        const valueText = cat.value || "";
        return `<div class="cat-card" data-grp="${grp.id}">
          <div class="cat-head">
            <span class="cat-label">${esc(labelText)}</span>
            ${confDots(cat.confidence)}
          </div>
          <p class="cat-value">${highlightKeyTerms(valueText)}</p>
        </div>`;
      }).join("");
      return groupHead + cards;
    }).join("")
  }</div>`;
}

function renderVerdict(profile) {
  const text = profile.profileText || "";
  if (!text) return `<div class="verdict empty"><p>profileText leer</p></div>`;
  return `<div class="verdict">
    <div class="verdict-head">
      <svg class="verdict-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 9v4m0 4h.01M3.6 19.8h16.8a1.2 1.2 0 001.04-1.8L13.04 4.2a1.2 1.2 0 00-2.08 0L2.56 18a1.2 1.2 0 001.04 1.8z"/>
      </svg>
      <h3>Profil-Verdict</h3>
    </div>
    <p class="verdict-text">${esc(text)}</p>
  </div>`;
}

function renderTargeting(profile) {
  const ads = profile.ad_targeting || [];
  const triggers = profile.manipulation_triggers || [];
  if (ads.length === 0 && triggers.length === 0) return "";
  let html = `<div class="targeting-grid"><div class="target-stack">`;
  if (ads.length > 0) {
    html += `<div class="target-card"><h3>So zielt Werbung auf dich</h3><div class="tag-cloud">${
      ads.map((a) => `<span class="tag">${esc(a)}</span>`).join("")
    }</div></div>`;
  }
  if (triggers.length > 0) {
    html += `<div class="target-card warn"><h3>So wirst du manipuliert</h3><ul class="trigger-list">${
      triggers.map((t) => `<li>${esc(t)}</li>`).join("")
    }</ul></div>`;
  }
  html += `</div></div>`;
  return html;
}

function renderPipelineColumn(result, mode, pipelineLabel) {
  if (result._error) {
    return `<div class="profile-column"><div class="col-head">${esc(pipelineLabel)}</div><div class="warn">Fehler: ${esc(result._error)}</div></div>`;
  }
  const profile = result.profiles?.[mode];
  if (!profile || profile._parseError) {
    return `<div class="profile-column"><div class="col-head">${esc(pipelineLabel)}</div><div class="warn">Parse-Fehler</div></div>`;
  }
  return `<div class="profile-column">
    <div class="col-head">${esc(pipelineLabel)}</div>
    ${renderVerdict(profile)}
    ${renderCardsGrouped(profile)}
    ${renderTargeting(profile)}
  </div>`;
}

function priceEurOf(call) {
  const isLarge = /large/i.test(call.model);
  const inUsdPerM = isLarge ? 0.5 : 0.15;
  const outUsdPerM = isLarge ? 1.5 : 0.6;
  const usd = ((call.promptTokens || 0) * inUsdPerM + (call.outputTokens || 0) * outUsdPerM) / 1_000_000;
  return usd * 0.92;
}

function renderStats(result, label) {
  if (!result.calls || result.calls.length === 0) return `<td>—</td>`;
  const total = result.calls.reduce((s, c) => s + (c.promptTokens || 0) + (c.outputTokens || 0), 0);
  const cost = result.calls.reduce((s, c) => s + priceEurOf(c), 0);
  const tokens2603 = result.calls.filter((c) => c.model === MODELS_2603).reduce((s, c) => s + (c.promptTokens || 0) + (c.outputTokens || 0), 0);
  const tokens2506 = result.calls.filter((c) => c.model === MODELS_2506).reduce((s, c) => s + (c.promptTokens || 0) + (c.outputTokens || 0), 0);
  const tokensLarge = result.calls.filter((c) => /large/i.test(c.model)).reduce((s, c) => s + (c.promptTokens || 0) + (c.outputTokens || 0), 0);
  return `<td><strong>${total.toLocaleString("de-AT")} T</strong> · ${(cost * 100).toFixed(2)} ct<br>
    <small>L: ${tokensLarge} · 2603: ${tokens2603} · 2506: ${tokens2506} · ${result.calls.length} Calls</small></td>`;
}

function renderImage(item) {
  if (item.error) {
    return `<section class="image-section"><h2>📷 ${esc(item.imageName)}</h2><div class="warn">Fehler: ${esc(item.error)}</div></section>`;
  }
  const [a, b, c] = item.results;

  return `<section class="image-section">
    <h2>📷 ${esc(item.imageName)}</h2>
    <img class="preview" src="${item.imageDataUrl}" alt="">

    <h3 class="mode-head">— Modus: STANDARD —</h3>
    <div class="three-col-grid">
      ${renderPipelineColumn(a, "normal", "A — Live heute")}
      ${renderPipelineColumn(b, "normal", "B — V2 mit 2506")}
      ${renderPipelineColumn(c, "normal", "C — V2 mit 2603")}
    </div>

    <h3 class="mode-head">— Modus: BEAST —</h3>
    <div class="three-col-grid">
      ${renderPipelineColumn(a, "boost", "A — Live heute")}
      ${renderPipelineColumn(b, "boost", "B — V2 mit 2506")}
      ${renderPipelineColumn(c, "boost", "C — V2 mit 2603")}
    </div>

    <h3 class="mode-head">— Token + Kosten —</h3>
    <table class="stats-table">
      <thead><tr><th>A — Live heute</th><th>B — V2 mit 2506</th><th>C — V2 mit 2603</th></tr></thead>
      <tbody><tr>${renderStats(a, "A")}${renderStats(b, "B")}${renderStats(c, "C")}</tr></tbody>
    </table>
  </section>`;
}

function renderHtml(perImage) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>malziME — Pipeline-Vergleich (Live-Design)</title>
  <link rel="stylesheet" href="./public/styles.css">
  <style>
    /* Container deutlich breiter für 3-spaltigen Vergleich */
    body { max-width: 2400px !important; margin: 1rem auto !important; padding: 0 1rem !important; }
    .container { max-width: 2400px !important; }

    /* Karten-Gruppen-Akzent (wie im Prototyp) */
    :root {
      --grp-identity: #60a5fa;
      --grp-ability: #4ade80;
      --grp-money: #fbbf24;
      --grp-risk: #f87171;
    }
    .cat-group-head {
      grid-column: 1 / -1;
      display: flex; align-items: center; gap: 0.5rem;
      margin: 1rem 0 0.2rem 0;
    }
    .cat-group-head:first-child { margin-top: 0; }
    .cat-group-head h3 {
      font-family: "JetBrains Mono", monospace;
      font-size: 0.65rem; letter-spacing: 0.13em; text-transform: uppercase;
      font-weight: 600; margin: 0; color: var(--muted);
    }
    .cat-group-head .group-dot {
      width: 7px; height: 7px; border-radius: 50%;
    }
    .cat-group-head[data-grp="identity"] .group-dot { background: var(--grp-identity); }
    .cat-group-head[data-grp="ability"]  .group-dot { background: var(--grp-ability); }
    .cat-group-head[data-grp="money"]    .group-dot { background: var(--grp-money); }
    .cat-group-head[data-grp="risk"]     .group-dot { background: var(--grp-risk); }

    .cat-card[data-grp="identity"] { border-left: 3px solid var(--grp-identity); }
    .cat-card[data-grp="ability"]  { border-left: 3px solid var(--grp-ability); }
    .cat-card[data-grp="money"]    { border-left: 3px solid var(--grp-money); }
    .cat-card[data-grp="risk"]     { border-left: 3px solid var(--grp-risk); }
    .cat-card.missing { opacity: 0.5; }
    .cat-value strong { font-weight: 600; color: var(--text); }
    .missing-val { color: var(--warn); font-style: italic; }

    /* 3-Punkte Konfidenz */
    .cat-conf.dots {
      display: inline-flex; gap: 3px;
      background: none !important; color: var(--muted) !important;
      font-size: 0 !important; padding: 0 !important;
    }
    .cat-conf.dots .d {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--border); display: inline-block;
    }
    .cat-card[data-grp="identity"] .cat-conf.dots .d.on { background: var(--grp-identity); }
    .cat-card[data-grp="ability"]  .cat-conf.dots .d.on { background: var(--grp-ability); }
    .cat-card[data-grp="money"]    .cat-conf.dots .d.on { background: var(--grp-money); }
    .cat-card[data-grp="risk"]     .cat-conf.dots .d.on { background: var(--grp-risk); }
    .conf-track { display: none; }

    /* 3-Spalten-Layout für Pipelines */
    .three-col-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .profile-column {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      min-width: 0;
    }
    .col-head {
      font-family: "JetBrains Mono", monospace;
      font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase;
      font-weight: 700; color: var(--accent);
      padding-bottom: 0.5rem; margin-bottom: 0.8rem;
      border-bottom: 2px solid var(--border);
    }
    /* In den Profile-Columns die Karten einspaltig (passt in die Spalten-Breite) */
    .profile-column .facts-grid {
      display: grid; grid-template-columns: 1fr; gap: 0.5rem;
    }

    /* Image section header */
    .image-section { margin-bottom: 4rem; padding-bottom: 2rem; border-bottom: 2px dashed var(--border); }
    .image-section h2 {
      font-size: 1.3rem; margin-bottom: 0.5rem;
      color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.3rem;
    }
    .preview {
      max-width: 380px; max-height: 280px;
      border: 1px solid var(--border); border-radius: 6px; margin-bottom: 1rem;
    }
    .mode-head {
      font-family: "JetBrains Mono", monospace;
      font-size: 0.85rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--muted); margin: 2rem 0 1rem 0;
    }

    /* Stats-Tabelle */
    .stats-table {
      width: 100%; border-collapse: collapse; font-size: 0.85rem;
      background: var(--card); border-radius: 6px; overflow: hidden;
    }
    .stats-table th, .stats-table td {
      padding: 0.6rem 0.8rem; border: 1px solid var(--border); text-align: left;
    }
    .stats-table th {
      background: var(--surface); font-family: "JetBrains Mono", monospace;
      font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--accent);
    }
    .stats-table small { color: var(--muted); font-size: 0.75rem; }

    .warn { background: rgba(248,113,113,0.1); color: var(--warn); padding: 0.5rem; border-left: 3px solid var(--warn); border-radius: 4px; }

    /* Header */
    .compare-header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid var(--border); }
    .compare-header h1 { margin-bottom: 0.3rem; }
    .compare-header .meta { color: var(--muted); font-size: 0.9rem; }
    .compare-header .meta code { background: var(--surface); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }

    /* Bewertungstabelle */
    .rating-section {
      margin-top: 5rem; padding: 1.5rem; background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px;
    }
    .rating-section h2 { margin-bottom: 1rem; }
    .rating-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    .rating-table th, .rating-table td {
      padding: 4px 6px; border: 1px solid var(--border); text-align: center; vertical-align: middle;
    }
    .rating-table th { background: var(--card); font-weight: 600; font-size: 0.7rem; }
    .rating-table .kriterium {
      background: var(--card); text-align: left; font-weight: 600;
      font-size: 0.78rem; padding-left: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="compare-header">
    <h1>Pipeline-Vergleich · Live-Frontend-Design</h1>
    <p class="meta">
      Pro Bild zwei Reihen (Standard- und Beast-Modus), pro Reihe drei Spalten im echten malzi.me-Look.<br>
      Spalte A = aktuelle Live-Pipeline · Spalte B = neue V2 mit <code>mistral-small-2506</code> für Karten · Spalte C = neue V2 mit <code>mistral-small-2603</code> für Karten.<br>
      Karten mit Akzent-Linien gruppiert: 🔵 Wer du bist · 🟢 Was dich ausmacht · 🟡 Was du kaufst · 🔴 Wo du verwundbar bist.<br>
      Schlüsselbegriffe (Eurobeträge, "Du bist…") automatisch fett markiert. Konfidenz als 3 Punkte in Gruppen-Farbe.
    </p>
  </div>

  ${perImage.map(renderImage).join("\n")}

  <section class="rating-section">
    <h2>Bewertung (1–5 pro Pipeline pro Bild)</h2>
    <table class="rating-table">
      <thead><tr><th>Kriterium</th>${perImage.map((i) => `<th>${esc(i.imageName).slice(0, 18)}</th>`).join("")}</tr></thead>
      <tbody>${
        [
          "Beschreibung ähnlich detailliert?",
          "Alter realistisch?",
          "Alter bei Kindern auf A-Niveau zurück? (Option 1)",
          "Geschlecht korrekt (Bias-Test)?",
          "Marken plausibel?",
          "Trigger bildspezifisch + ausreichend lang?",
          "Karten-Variante B angenehm lesbar?",
          "Karten-Werte stimmig (1-2 Sätze, keine Marken im Text)?",
          "Karten Normal ↔ Beast Grundfakten konsistent?",
          "profileText konkret (mit Marken)?",
          "profileText konsistent mit Karten?",
          "Beast spürbar härter ohne Inkohärenz?",
        ].map((cr) => `<tr><td class="kriterium">${cr}</td>${perImage.map(() => `<td>A:_ B:_ C:_</td>`).join("")}</tr>`).join("")
      }</tbody>
    </table>
  </section>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error(`Kein JSON-Cache gefunden: ${INPUT_JSON}`);
    console.error(`Lass erst compare-pipelines.js laufen.`);
    process.exit(1);
  }
  const perImage = JSON.parse(fs.readFileSync(INPUT_JSON, "utf8"));
  console.log(`${perImage.length} Bilder aus Cache geladen.`);
  const html = renderHtml(perImage);
  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`Geschrieben: ${OUTPUT_HTML}`);
  console.log(`Größe: ${Math.round(html.length / 1024)} KB`);
}

main();
