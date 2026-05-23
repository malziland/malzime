"use strict";

/**
 * test-prompts-v2.js — Prompt-Entwürfe für die V2-Pipeline (Forschung).
 *
 * Aktuelle Architektur (nach Verwurf von Option 1):
 *   Call 1  Large MIT Bild   → description + ads + triggers + hard_facts (JSON)
 *   Call 2a Small 2506/2603  → 13 Karten Variante B Normal
 *   Call 2b Small 2506/2603  → 13 Karten Variante B Beast
 *   Call 3a Small 2603       → profileText Normal (wie heute live)
 *   Call 3b Small 2603       → profileText Beast (wie heute live)
 *
 * Konsistenz-Anker: hard_facts aus Call 1 → an alle Stufe-2-Calls.
 *
 * NICHT mehr enthalten (verworfen am 2026-05-23):
 *   - Option 1 (zusätzlicher Large-Text-Call zur Verdichtung)
 *   - Few-Shot-Bias-Hebel 4
 *   - GENDER_ANCHOR-Erweiterungen (haben Live destabilisiert)
 */

const livePrompts = require("../src/locales/de/prompts");

/* ─────────────────────────────────────────────────────────────────────────
 * Call 1 — Large MIT Bild: description + ads + triggers + hard_facts
 *
 * Basis: kompletter Live-describePrompt + mistralDescribeAddendum
 * (= identisch zur heutigen Live-Pipeline für die Beschreibung).
 * Erweiterung: drei zusätzliche JSON-Felder (ads, triggers, hard_facts).
 * ───────────────────────────────────────────────────────────────────────── */

const HARD_FACTS_ANCHOR_SPEC = `

ZUSÄTZLICHE PFLICHT-FELDER für den JSON-Output:

ads — Marken-Liste:
- 6–8 Einträge, je 1–3 Wörter (Marke oder Produkttyp)
- Basierend auf sichtbaren Logos UND ableitbarem Konsum-/Lifestyle-Level
- Beispiele für Format: "Garmin Edge 1040", "Rapha Pro Team", "Red Bull Energy"
- KEINE ganzen Sätze, KEINE Preisangaben

triggers — Manipulations-Trigger-Liste:
- 4–6 Einträge, je 1–2 Sätze, maximal 30 Wörter pro Eintrag
- Bildspezifisch, NICHT generisch
- Vielfältig (nicht 4× FOMO)
- Beispiel: "Die Angst etwas zu verpassen wird durch zeitlich begrenzte Angebote
  für neue Bikepacking-Ausrüstung getriggert."

hard_facts — strukturierte Grundfakten als Konsistenz-Anker für die
nachgelagerten Profil-Calls. Diese Werte werden in Stufe 2 wortgenau
übernommen. JSON-Objekt mit GENAU diesen Schlüsseln:
  alter_geschlecht: "<Geschlecht + Alter/Spanne aus der Beschreibung wortgenau>"
  herkunft:         "<knapper Anker, z.B. 'mitteleuropäisch'>"
  einkommen:        "<Band brutto, am mitteleuropäischen Lohnniveau>"
  bildung:          "<knapper Anker, z.B. 'Hochschulabschluss, technisch'>"
  beziehungsstatus: "<knapper Anker, z.B. 'liiert, keine sichtbaren Kinder'>"
  interessen:       "<2-4 Hauptinteressen, Komma-separiert>"
  persoenlichkeit:  "<2-3 Schlüssel-Eigenschaften>"
  charakterzuege:   "<2-3 Schlüssel-Charakterzüge>"
  politisch:        "<knapper Anker, z.B. 'bürgerlich-konservativ'>"
  gesundheit:       "<knapper Anker, z.B. 'fit, gesundheitsbewusst'>"
  kaufkraft:        "<knapper Anker, z.B. 'obere Mittelschicht, Premium-affin'>"
  verletzlichkeit:  "<2 Schlüssel-Verletzlichkeiten>"
  werbeprofil:      "<knapper Anker, z.B. 'Premium-Outdoor, Endurance-Sport'>"

WICHTIG: alter_geschlecht — Spanne aus der Beschreibung wortgenau übernehmen,
NICHT auf Punkt-Wert reduzieren. Wenn die Beschreibung "8-12 Jahre" sagt,
übernimm "8-12". Bei Kindern: einkommen = Familieneinkommen.
KEIN "kaukasisch" — schreibe "europäisch" oder "mitteleuropäisch".

ANTWORTE AUSSCHLIESSLICH ALS VALIDES JSON in diesem Format:
{
  "description": "<vollständige Bildbeschreibung wie oben spezifiziert>",
  "ads": ["...", "..."],
  "triggers": ["...", "..."],
  "hard_facts": { "alter_geschlecht": "...", ... }
}

KEIN Markdown, KEINE Erklärungen außerhalb des JSON, KEINE Backticks.
`;

const largeBundlePrompt =
  livePrompts.describePrompt +
  livePrompts.mistralDescribeAddendum +
  HARD_FACTS_ANCHOR_SPEC;

/* ─────────────────────────────────────────────────────────────────────────
 * Call 2 — Karten Variante B (1–2 Sätze, 20–30 Wörter)
 *
 * Live-System-Prompts (systemNormal/Boost) als Basis.
 * Output: nur `categories`, KEINE Marken namentlich, KEINE Belege.
 * ───────────────────────────────────────────────────────────────────────── */

const CARDS_SCHEMA_VARIANT_B = `

Antworte AUSSCHLIESSLICH mit validem JSON in diesem Format — nur das categories-Objekt:
{
  "categories": {
    "alter_geschlecht": { "label": "Alter & Geschlecht", "value": "<1-2 Sätze, 20-30 Wörter>", "confidence": 0.0-1.0 },
    "herkunft": { "label": "Ethnische Herkunft", "value": "<...>", "confidence": 0.0-1.0 },
    "einkommen": { "label": "Geschätztes Einkommen", "value": "<...>", "confidence": 0.0-1.0 },
    "bildung": { "label": "Bildungsniveau", "value": "<...>", "confidence": 0.0-1.0 },
    "beziehungsstatus": { "label": "Beziehungsstatus", "value": "<...>", "confidence": 0.0-1.0 },
    "interessen": { "label": "Interessen & Hobbys", "value": "<...>", "confidence": 0.0-1.0 },
    "persoenlichkeit": { "label": "Persönlichkeitstyp", "value": "<...>", "confidence": 0.0-1.0 },
    "charakterzuege": { "label": "Charaktereigenschaften", "value": "<...>", "confidence": 0.0-1.0 },
    "politisch": { "label": "Politische Tendenz", "value": "<...>", "confidence": 0.0-1.0 },
    "gesundheit": { "label": "Gesundheit & Fitness", "value": "<...>", "confidence": 0.0-1.0 },
    "kaufkraft": { "label": "Kaufkraft & Konsum", "value": "<...>", "confidence": 0.0-1.0 },
    "verletzlichkeit": { "label": "Verletzlichkeiten", "value": "<...>", "confidence": 0.0-1.0 },
    "werbeprofil": { "label": "Werbeprofil", "value": "<...>", "confidence": 0.0-1.0 }
  }
}

LÄNGEN-VORGABE — PFLICHT:
- Pro Kategorie: 1–2 Sätze, 20–30 Wörter. KEINE 3-5-Sätze-Fließtexte.
- Eine Hauptaussage + eine Nuance/Konsequenz reicht.
- KEINE Marken namentlich im Karten-Text (Marken sind separat in ad_targeting/ads).
- KEINE "Belege:..."-Erklärungen, KEINE "Basierend auf..."-Floskeln.
- KEINE Aufzählungszeichen, KEINE Listen — nur 1–2 Sätze Fließtext pro Karte.
- Antworte als REINES JSON ohne Markdown, ohne \`\`\`json-Codeblöcke.

GESCHLECHT + ALTER: hard_facts.alter_geschlecht ist VERBINDLICH — übernimm
es wortgenau (z.B. wenn hard_facts sagt "weiblich, 11-13 Jahre", dann steht
das exakt so in der Karte). NICHT auf Punkt-Wert reduzieren.

GRUNDFAKTEN (herkunft, einkommen, bildung, beziehungsstatus): müssen mit
hard_facts übereinstimmen — sprachlich verfeinern erlaubt, inhaltlich nicht
abweichen.

WEICHE KARTEN: Tonfall darf variieren (Beast härter), Kernaussage aus
hard_facts bleibt inhaltlich.

NIEMALS "kaukasisch" — schreibe "europäisch" oder "mitteleuropäisch".
KEINE Preisangaben (€, $, EUR, USD) in werbeprofil oder kaufkraft.

BEISPIELE für die richtige Länge:
- einkommen (Normal): "Du verdienst geschätzt €45.000–60.000 brutto. Dein Konsumverhalten verortet dich im Premium-Segment der oberen Mittelschicht."
- verletzlichkeit (Beast): "Du bist eine FOMO-Schwachstelle mit Statussucht. Werbung trifft dich dort, wo du sie am wenigsten erwartest — bei Peer-Vergleichen."
`;

function buildCardsPrompt(mode, bundle) {
  const isBeast = mode === "beast";
  const systemContext = isBeast ? livePrompts.systemBoost : livePrompts.systemNormal;

  return `${systemContext}

${livePrompts.injectionWarning}

KONTEXT VOM BILDANALYST:

<bildbeschreibung>
${escapeXml(bundle.description || "")}
</bildbeschreibung>

<hard_facts_anker>
${JSON.stringify(bundle.hard_facts || {}, null, 2)}
</hard_facts_anker>

Werbemarken (NUR als Kontext für werbeprofil/kaufkraft — NICHT namentlich in den Karten-Text einbauen): ${(bundle.ads || []).join(", ")}

Manipulations-Trigger (NUR als Kontext für verletzlichkeit — NICHT namentlich in den Karten-Text):
${(bundle.triggers || []).map((t, i) => `${i + 1}. ${t}`).join("\n")}

${livePrompts.workshopNote}

WICHTIG: Du sollst NUR das categories-Objekt erstellen — KEIN ad_targeting,
KEIN manipulation_triggers, KEIN profileText. Diese werden in anderen Calls
generiert. Pro Karte 1–2 Sätze (20–30 Wörter), KURZ und knapp.

${CARDS_SCHEMA_VARIANT_B}`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Call 3 — profileText (Normal/Beast) wie heute live
 * ───────────────────────────────────────────────────────────────────────── */

const PROFILE_TEXT_SCHEMA_NORMAL = `

Antworte AUSSCHLIESSLICH mit validem JSON in diesem Format — NUR profileText:
{
  "profileText": "<5-8 Sätze, sachlich-direkt, 'du'-Form, konkret mit Marken und Triggers. KEIN Passiv, KEINE Disclaimer.>"
}

LÄNGE: 5–8 vollständige Sätze.
TON: sachlich, selbstsicher, ohne 'wahrscheinlich' oder 'möglicherweise'.
INHALT: Greife mindestens 2 Marken aus der Marken-Liste namentlich auf.
Greife mindestens 1 Manipulations-Trigger auf.
Halte dich strikt an hard_facts — NICHT abweichen.

KEIN Markdown, KEIN Fließtext außerhalb des JSON.
`;

const PROFILE_TEXT_SCHEMA_BEAST = `

Antworte AUSSCHLIESSLICH mit validem JSON in diesem Format — NUR profileText:
{
  "profileText": "<mindestens 10 Sätze, zynisch-konzern-pose, 'du'-Form, 'Wir wissen, dass du...', konkret mit Marken und persönlichen Schwächen. KEINE Disclaimer.>"
}

LÄNGE: mindestens 10 Sätze.
TON: zynisch, spöttisch, unterhaltsam, korporativ-kalt.
INHALT: Greife mindestens 2 Marken namentlich auf.
Greife mindestens 1 Manipulations-Trigger auf.
Benenne mindestens 2 unangenehme Wahrheiten, die das Bild stützt.
Halte dich strikt an hard_facts — NICHT abweichen.

KEIN Markdown, KEIN Fließtext außerhalb des JSON.
`;

function buildProfileTextPrompt(mode, bundle) {
  const isBeast = mode === "beast";
  const systemContext = isBeast ? livePrompts.systemBoost : livePrompts.systemNormal;
  const schema = isBeast ? PROFILE_TEXT_SCHEMA_BEAST : PROFILE_TEXT_SCHEMA_NORMAL;

  return `${systemContext}

${livePrompts.injectionWarning}

KONTEXT VOM BILDANALYST:

<bildbeschreibung>
${escapeXml(bundle.description || "")}
</bildbeschreibung>

<hard_facts_anker>
${JSON.stringify(bundle.hard_facts || {}, null, 2)}
</hard_facts_anker>

Werbemarken: ${(bundle.ads || []).join(", ")}

Manipulations-Trigger:
${(bundle.triggers || []).map((t, i) => `${i + 1}. ${t}`).join("\n")}

${livePrompts.workshopNote}

WICHTIG: Du sollst NUR das profileText-Feld erstellen.

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

module.exports = {
  largeBundlePrompt,
  buildCardsPrompt,
  buildProfileTextPrompt,
  _bundlePromptLength: largeBundlePrompt.length,
};
