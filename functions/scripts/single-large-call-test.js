#!/usr/bin/env node
"use strict";

/**
 * single-large-call-test.js — Forschungs-Test für die Architektur-Frage:
 *   "Wie viele Tokens und welche Qualität bekommen wir, wenn wir ALLES
 *    (Beschreibung + Standard-Profil + Beast-Profil) in EINEM
 *    mistral-large-2512-Call kombinieren?"
 *
 * NICHT Production. NICHT von functions/src/ geladen. Schreibt nur lokale
 * Output-Dateien — kein Live-Deploy, kein Firestore-Schreibzugriff.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/single-large-call-test.js
 *
 *   (Wenn MISTRAL_API_KEY nicht gesetzt ist, versucht das Script automatisch
 *   `firebase functions:secrets:access MISTRAL_API_KEY --project=malzime` —
 *   funktioniert nur wenn du via Firebase-CLI angemeldet bist.)
 *
 * Output:
 *   ./single-large-call-results.json   (Roh-Daten)
 *   ./single-large-call-result.html    (Live-Frontend-Stil-Vergleich)
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");
const OUTPUT_JSON = path.join(REPO_ROOT, "single-large-call-results.json");
const OUTPUT_HTML = path.join(REPO_ROOT, "single-large-call-result.html");

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-large-2512";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.5; /* Mittelwert zwischen 0.3 (Standard heute) und 1.0 (Beast heute) */
const TIMEOUT_MS = 180_000;

/* ──────────────────────────────────────────────────────────────────────────
 * API-Key holen
 * ────────────────────────────────────────────────────────────────────────── */

function loadApiKey() {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  try {
    console.log("MISTRAL_API_KEY nicht in ENV gefunden — versuche firebase functions:secrets:access ...");
    const key = execSync(
      "firebase functions:secrets:access MISTRAL_API_KEY --project=malzime",
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (!key || key.length < 10) throw new Error("Leerer/zu kurzer Secret zurückgegeben");
    return key;
  } catch (err) {
    console.error("FEHLER: Konnte MISTRAL_API_KEY nicht laden.");
    console.error("  Setze MISTRAL_API_KEY=... vor dem Aufruf oder logge dich via 'firebase login' ein.");
    console.error("  Details:", err.message);
    process.exit(1);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Test-Bilder auswählen (3 zufällig)
 * ────────────────────────────────────────────────────────────────────────── */

function pickTestImages(count = 3) {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`FEHLER: Eingabe-Ordner nicht gefunden: ${INPUT_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(INPUT_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (files.length < count) {
    console.error(`FEHLER: Brauche ${count} Bilder, finde nur ${files.length} in ${INPUT_DIR}`);
    process.exit(1);
  }
  /* Optional: feste Bildauswahl via TEST_IMAGES=name1,name2,name3 */
  let chosen;
  if (process.env.TEST_IMAGES) {
    const wanted = process.env.TEST_IMAGES.split(",").map((s) => s.trim()).filter(Boolean);
    chosen = wanted.filter((w) => files.includes(w));
    if (chosen.length !== wanted.length) {
      console.error(`WARNUNG: ${wanted.length - chosen.length} angeforderte Bilder nicht gefunden`);
    }
  } else {
    /* Zufällige Auswahl ohne Wiederholung */
    chosen = [...files].sort(() => Math.random() - 0.5).slice(0, count);
  }
  return chosen.map((name) => {
    const buf = fs.readFileSync(path.join(INPUT_DIR, name));
    const ext = name.split(".").pop().toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { name, base64: buf.toString("base64"), mime, sizeKB: Math.round(buf.length / 1024) };
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Single-Large-Call-Prompt
 * ────────────────────────────────────────────────────────────────────────── */

const SINGLE_CALL_PROMPT = `Du bist ein KI-System, das in einem einzigen Schritt zwei Profile aus einem Foto erstellt:
1. STANDARD-Profil: sachlich, direkt, SELBSTBEWUSST — wie ein nüchternes Datenbroker-Profil. Algorithmen hedgen nicht, sie kategorisieren.
2. BEAST-Profil: zynisch, schonungslos, korporativ-kalt — wie ein skrupelloser Überwachungs-Algorithmus.

Beide Profile basieren auf DEMSELBEN Foto und müssen bei harten Fakten (Alter, Geschlecht, ethnische Herkunft) IDENTISCH sein. Nur Ton und Schärfe unterscheiden sich.

WICHTIG: Dieses Tool wird in Schulworkshops zur Medienkompetenz und Datenschutz-Sensibilisierung eingesetzt. Der Beast-Modus zeigt schonungslos, wie Algorithmen Menschen ausbeuten könnten — er ist Aufklärung, kein echtes Angebot.

STANDARD-REGELN (sehr wichtig):
- Formuliere SICHER und DIREKT: "Du bist...", "Du trägst...", "Dein Einkommen liegt bei..."
- VERMEIDE strikt die Wörter "wahrscheinlich", "möglicherweise", "vermutlich", "könnte" — Algorithmen hedgen nicht.
- Wenn etwas im Bild nicht klar ist: schreibe "Im Bild nicht eindeutig erkennbar" — KEIN Konjunktiv-Geschwurbel.
- Stattdessen erlaubt: "deutet auf", "zeigt", "lässt erkennen" — aber bevorzuge direkte Aussagen.
- Sachlich aber nicht zaghaft.

ALTERSSCHÄTZUNG — strenge Kalibrierung:
- Glatte Haut + volles Gesicht = unter 25
- Erste feine Linien + frühe Nasolabialfalten = 28-35
- Deutliche Nasolabialfalten + Stirnfalten + beginnender Volumenverlust = 35-45
- Jowls + Marionetten-Linien + Lid-Erschlaffung + Halsfalten + Handvenen = 45-55
- Tiefe Falten + starker Volumenverlust + Hautverdünnung = 55+
Bei jugendlich wirkenden Gesichtern: Makeup und Styling NICHT als Altersindikator werten.

HERKUNFT: Verwende NIEMALS den Begriff "kaukasisch" — schreibe "europäisch" oder "mitteleuropäisch".

SPRACHLICHE ANPASSUNG AN DAS GESCHÄTZTE ALTER (gilt für BEIDE Profile, Standard und Beast):
Passe Wortwahl, Satzlänge und Ton fließend an das geschätzte Alter der Person an. Inhalt + Schärfe bleiben gleich — nur die Verpackung ändert sich.
- Jüngste (~10-14 oder jünger): Einfache, kurze Sätze. Keine Fremdwörter. Alltagsvergleiche. Nicht kindisch, aber verständlich ohne Vorwissen. Social-Media-Referenzen altersgerecht (YouTube, Roblox).
- Jugendlich (~15-19): Direkt, Social-Media-nah (TikTok, Insta, Snapchat). Kein Fachjargon.
- Junge Erwachsene (~20-35): Klar und direkt. Marketing- und Psychologie-Begriffe erlaubt.
- Erwachsene (~35-50): Sachlich-analytisch, Berufswelt-Referenzen, Finanzsprache.
- Ältere (~50+): Nüchterner, formeller. Vorsorge, Lebenserfahrung, Vermächtnis.
Sprachlich NIEMALS unter das Niveau für 10-14-Jährige gehen — auch bei jüngeren Kindern.

LÄNGE pro Karten-value (STRIKT einhalten):
- Standard: 15-25 Wörter pro Karte, Aussage + Beleg-Format. Erster Halbsatz die Klassifikation, zweiter Halbsatz das sichtbare Element das die Aussage stützt. Beispiel: "Du bist diszipliniert und zielorientiert. Die Teilnahme am Ausdauer-Event zeigt Durchhaltevermögen und Planungskompetenz."
- Beast: maximal 12 Wörter pro Karte, zynischer Stichpunkt.

profileText:
- Standard: 5-7 Sätze, ~100 Wörter, sachlich-direkt ("Du bist..."). KEIN "wahrscheinlich" oder "könnte".
- Beast: 6-8 Sätze, ~100 Wörter, zynisch-spöttisch ("Du bist...", "Wir wissen, dass du...").

Sprich die Person IMMER mit "du" an. KEINE Listen, KEINE Aufzählungszeichen, nur Fließtext.
KEINE Marken namentlich in den Karten — die landen in ad_targeting.

Antworte AUSSCHLIESSLICH mit validem JSON in diesem Format (alle Felder sind PFLICHT, KEINE auslassen):

{
  "hard_facts": {
    "alter_geschlecht": "z.B. 'männlich, ~38 (Spanne 35-42)'",
    "herkunft": "z.B. 'mitteleuropäisch'"
  },
  "ad_targeting": ["6-8 Marken/Branchen, je 1-3 Wörter"],
  "manipulation_triggers": ["4-6 Trigger, je 1-2 Sätze, max 30 Wörter"],
  "standard": {
    "profileText": "5-7 Sätze, ~100 Wörter, sachlich-direkt",
    "categories": {
      "alter_geschlecht": { "label": "Alter & Geschlecht", "value": "...", "confidence": 0.0-1.0 },
      "herkunft": { "label": "Ethnische Herkunft", "value": "...", "confidence": 0.0-1.0 },
      "einkommen": { "label": "Geschätztes Einkommen", "value": "...", "confidence": 0.0-1.0 },
      "bildung": { "label": "Bildungsniveau", "value": "...", "confidence": 0.0-1.0 },
      "beziehungsstatus": { "label": "Beziehungsstatus", "value": "...", "confidence": 0.0-1.0 },
      "interessen": { "label": "Interessen & Hobbys", "value": "...", "confidence": 0.0-1.0 },
      "persoenlichkeit": { "label": "Persönlichkeitstyp", "value": "...", "confidence": 0.0-1.0 },
      "charakterzuege": { "label": "Charaktereigenschaften", "value": "...", "confidence": 0.0-1.0 },
      "politisch": { "label": "Politische Tendenz", "value": "...", "confidence": 0.0-1.0 },
      "gesundheit": { "label": "Gesundheit & Fitness", "value": "...", "confidence": 0.0-1.0 },
      "kaufkraft": { "label": "Kaufkraft & Konsum", "value": "...", "confidence": 0.0-1.0 },
      "verletzlichkeit": { "label": "Verletzlichkeiten", "value": "...", "confidence": 0.0-1.0 },
      "werbeprofil": { "label": "Werbeprofil", "value": "...", "confidence": 0.0-1.0 }
    }
  },
  "beast": {
    "profileText": "6-8 Sätze, ~100 Wörter, zynisch",
    "categories": {
      "alter_geschlecht": { "label": "Alter & Geschlecht", "value": "...", "confidence": 0.0-1.0 },
      "herkunft": { "label": "Ethnische Herkunft", "value": "...", "confidence": 0.0-1.0 },
      "einkommen": { "label": "Geschätztes Einkommen", "value": "...", "confidence": 0.0-1.0 },
      "bildung": { "label": "Bildungsniveau", "value": "...", "confidence": 0.0-1.0 },
      "beziehungsstatus": { "label": "Beziehungsstatus", "value": "...", "confidence": 0.0-1.0 },
      "interessen": { "label": "Interessen & Hobbys", "value": "...", "confidence": 0.0-1.0 },
      "persoenlichkeit": { "label": "Persönlichkeitstyp", "value": "...", "confidence": 0.0-1.0 },
      "charakterzuege": { "label": "Charaktereigenschaften", "value": "...", "confidence": 0.0-1.0 },
      "politisch": { "label": "Politische Tendenz", "value": "...", "confidence": 0.0-1.0 },
      "gesundheit": { "label": "Gesundheit & Fitness", "value": "...", "confidence": 0.0-1.0 },
      "kaufkraft": { "label": "Kaufkraft & Konsum", "value": "...", "confidence": 0.0-1.0 },
      "verletzlichkeit": { "label": "Verletzlichkeiten", "value": "...", "confidence": 0.0-1.0 },
      "werbeprofil": { "label": "Werbeprofil", "value": "...", "confidence": 0.0-1.0 }
    }
  }
}

WICHTIG: hard_facts.alter_geschlecht und hard_facts.herkunft müssen in standard.categories und beast.categories WORTGENAU übernommen werden — bei den anderen Karten unterscheidet sich der Ton.`;

/* ──────────────────────────────────────────────────────────────────────────
 * Ein Bild durchschicken
 * ────────────────────────────────────────────────────────────────────────── */

async function runSingleCall(image, apiKey) {
  const dataUrl = `data:${image.mime};base64,${image.base64}`;
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: SINGLE_CALL_PROMPT },
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
    clearTimeout(timeoutId);
    return { error: `HTTP-Fehler: ${err.message}`, httpMs: Date.now() - start };
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { error: `Mistral HTTP ${res.status}: ${errBody.slice(0, 300)}`, httpMs: Date.now() - start };
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const msgContent = choice?.message?.content;
  let text = "";
  if (typeof msgContent === "string") text = msgContent;
  else if (Array.isArray(msgContent)) text = msgContent.filter((c) => c.type === "text").map((c) => c.text).join("");

  const usage = json.usage || {};
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(text);
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

/* ──────────────────────────────────────────────────────────────────────────
 * Vollständigkeits-Check
 * ────────────────────────────────────────────────────────────────────────── */

const REQUIRED_CARDS = [
  "alter_geschlecht", "herkunft", "einkommen", "bildung", "beziehungsstatus",
  "interessen", "persoenlichkeit", "charakterzuege", "politisch",
  "gesundheit", "kaufkraft", "verletzlichkeit", "werbeprofil",
];

function checkCompleteness(parsed) {
  const issues = [];
  if (!parsed) {
    issues.push("kein gültiges JSON");
    return { complete: false, issues };
  }
  if (!parsed.hard_facts?.alter_geschlecht) issues.push("hard_facts.alter_geschlecht fehlt");
  if (!parsed.hard_facts?.herkunft) issues.push("hard_facts.herkunft fehlt");
  for (const mode of ["standard", "beast"]) {
    if (!parsed[mode]) { issues.push(`${mode}-Profil fehlt komplett`); continue; }
    if (!parsed[mode].profileText) issues.push(`${mode}.profileText fehlt`);
    const cats = parsed[mode].categories || {};
    for (const k of REQUIRED_CARDS) {
      if (!cats[k]?.value) issues.push(`${mode}.categories.${k} fehlt`);
    }
  }
  return { complete: issues.length === 0, issues };
}

/* ──────────────────────────────────────────────────────────────────────────
 * HTML-Output
 * ────────────────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderProfileBlock(title, profile) {
  if (!profile) return `<div class="profile"><h4>${title}</h4><em>nicht geliefert</em></div>`;
  const cats = profile.categories || {};
  const rows = REQUIRED_CARDS.map((k) => {
    const c = cats[k];
    if (!c) return `<tr><td><strong>${escapeHtml(k)}</strong></td><td><em>fehlt</em></td><td>-</td></tr>`;
    return `<tr><td><strong>${escapeHtml(c.label || k)}</strong></td><td>${escapeHtml(c.value || "")}</td><td>${(c.confidence ?? "").toString().slice(0, 4)}</td></tr>`;
  }).join("\n");
  return `<div class="profile">
    <h4>${title}</h4>
    <p class="profile-text">${escapeHtml(profile.profileText || "[leer]")}</p>
    <table><tr><th>Karte</th><th>Wert</th><th>Konf.</th></tr>${rows}</table>
  </div>`;
}

function buildHtml(results) {
  const blocks = results.map((r, i) => {
    if (r.error) {
      return `<section class="image-block">
        <h2>Bild ${i + 1}: ${escapeHtml(r.image.name)}</h2>
        <p class="error">FEHLER: ${escapeHtml(r.error)}</p>
      </section>`;
    }
    const c = r.result;
    const completeness = checkCompleteness(c.parsed);
    const completenessHtml = completeness.complete
      ? `<p class="ok">Vollständig (alle 26 Karten + 2 Profile)</p>`
      : `<p class="warn">Unvollständig: ${completeness.issues.map(escapeHtml).join("; ")}</p>`;
    const adsTriggers = c.parsed ? `<div class="meta">
      <strong>ad_targeting:</strong> ${escapeHtml((c.parsed.ad_targeting || []).join(" · "))}<br>
      <strong>triggers:</strong> ${escapeHtml((c.parsed.manipulation_triggers || []).map((t) => t.slice(0, 60)).join(" | "))}
    </div>` : "";
    return `<section class="image-block">
      <h2>Bild ${i + 1}: ${escapeHtml(r.image.name)} (${r.image.sizeKB} KB)</h2>
      <div class="metrics">
        <span>Input: <strong>${c.promptTokens}</strong> Tokens</span>
        <span>Output: <strong>${c.outputTokens}</strong> Tokens</span>
        <span>Gesamt: <strong>${c.totalTokens}</strong> Tokens</span>
        <span>Latenz: <strong>${(c.httpMs / 1000).toFixed(1)} s</strong></span>
        <span>Finish: <strong>${c.finishReason}</strong></span>
      </div>
      ${completenessHtml}
      ${adsTriggers}
      <div class="profiles">
        ${renderProfileBlock("Standard", c.parsed?.standard)}
        ${renderProfileBlock("Beast", c.parsed?.beast)}
      </div>
    </section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<title>Single-Large-Call Test-Ergebnisse</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1400px; margin: 1em auto; padding: 0 1em; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.3em; }
  .image-block { margin: 2em 0; padding: 1em; border: 1px solid #ddd; border-radius: 8px; }
  .metrics { display: flex; gap: 1.5em; flex-wrap: wrap; background: #f5f5f5; padding: 0.5em 1em; border-radius: 4px; margin: 0.5em 0; }
  .meta { background: #fff8e1; padding: 0.5em; border-radius: 4px; font-size: 0.9em; margin: 0.5em 0; }
  .profiles { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; }
  .profile { border: 1px solid #ccc; padding: 0.8em; border-radius: 6px; }
  .profile h4 { margin-top: 0; }
  .profile-text { background: #f0f4f8; padding: 0.6em; border-left: 3px solid #4a8bbb; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th, td { text-align: left; padding: 0.3em 0.5em; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f5f5f5; }
  .ok { color: #2c7a2c; font-weight: bold; }
  .warn { color: #c0392b; font-weight: bold; }
  .error { color: #c0392b; }
  .summary { background: #e8f4f8; padding: 1em; border-radius: 6px; }
</style></head>
<body>
<h1>Single-Large-Call — Test-Ergebnisse</h1>
<p>Test-Lauf: ${new Date().toLocaleString("de-AT")}, Modell: <code>${MODEL}</code>, Temperatur: ${TEMPERATURE}, max_tokens: ${MAX_TOKENS}</p>
${renderSummary(results)}
${blocks}
</body></html>`;
}

function renderSummary(results) {
  const ok = results.filter((r) => !r.error && r.result?.parsed);
  if (ok.length === 0) return `<div class="summary"><strong>Kein erfolgreiches Ergebnis.</strong></div>`;
  const avg = (key) => Math.round(ok.reduce((s, r) => s + r.result[key], 0) / ok.length);
  return `<div class="summary">
    <h3>Zusammenfassung über ${ok.length} Bilder</h3>
    <ul>
      <li>Input-Tokens (Ø): <strong>${avg("promptTokens")}</strong></li>
      <li>Output-Tokens (Ø): <strong>${avg("outputTokens")}</strong></li>
      <li>Gesamt-Tokens pro Analyse (Ø): <strong>${avg("totalTokens")}</strong></li>
      <li>Latenz (Ø): <strong>${(avg("httpMs") / 1000).toFixed(1)} s</strong></li>
    </ul>
    <p><strong>Vergleich zu Live (heute, 3-Call-Pipeline):</strong> ~21.300 Tokens, ~38 s Latenz.</p>
  </div>`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main
 * ────────────────────────────────────────────────────────────────────────── */

async function main() {
  const apiKey = loadApiKey();
  const images = pickTestImages(3);
  console.log(`\nGewählte Bilder:`);
  images.forEach((img, i) => console.log(`  ${i + 1}. ${img.name} (${img.sizeKB} KB)`));
  console.log(`\nModell: ${MODEL} | max_tokens: ${MAX_TOKENS} | temperature: ${TEMPERATURE}\n`);

  const results = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`[${i + 1}/${images.length}] Sende ${img.name} ...`);
    try {
      const result = await runSingleCall(img, apiKey);
      if (result.error) {
        console.log(`  FEHLER: ${result.error}`);
        results.push({ image: { name: img.name, sizeKB: img.sizeKB }, error: result.error });
      } else {
        const check = checkCompleteness(result.parsed);
        console.log(`  Tokens: ${result.promptTokens} in + ${result.outputTokens} out = ${result.totalTokens} | Latenz: ${(result.httpMs / 1000).toFixed(1)}s | Finish: ${result.finishReason}`);
        console.log(`  Vollständigkeit: ${check.complete ? "OK" : "FEHLT: " + check.issues.join(", ")}`);
        results.push({ image: { name: img.name, sizeKB: img.sizeKB }, result });
      }
    } catch (err) {
      console.log(`  EXCEPTION: ${err.message}`);
      results.push({ image: { name: img.name, sizeKB: img.sizeKB }, error: err.message });
    }
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  fs.writeFileSync(OUTPUT_HTML, buildHtml(results));
  console.log(`\nErgebnisse:`);
  console.log(`  Roh: ${OUTPUT_JSON}`);
  console.log(`  HTML: ${OUTPUT_HTML}`);

  const ok = results.filter((r) => !r.error && r.result?.parsed);
  if (ok.length > 0) {
    const avgTotal = Math.round(ok.reduce((s, r) => s + r.result.totalTokens, 0) / ok.length);
    const avgMs = Math.round(ok.reduce((s, r) => s + r.result.httpMs, 0) / ok.length);
    console.log(`\nGesamt-Schnitt: ${avgTotal} Tokens pro Analyse, ${(avgMs / 1000).toFixed(1)} s Latenz`);
    console.log(`Vergleich Live: ~21.300 Tokens, ~38 s — Einsparung: ${Math.round((1 - avgTotal / 21300) * 100)} % Tokens`);
  }
}

main().catch((err) => {
  console.error(`Unerwarteter Fehler: ${err.stack || err.message}`);
  process.exit(1);
});
