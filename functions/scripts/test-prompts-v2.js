"use strict";

/**
 * test-prompts-v2.js — Prompt-Entwürfe für die neue Pipeline (Forschung).
 *
 * NUR FÜR DAS VERGLEICHSTOOL. Wird NICHT vom Production-Code geladen —
 * verifizierbar via `grep -r "test-prompts-v2" functions/src/`.
 *
 * Architektur, die hier durchgespielt wird:
 *   Call 1  Large-Bundle   — Beschreibung + Marken + Triggers + hard_facts
 *   Call 2  Karten         — 13 Schlagwort-Karten, Normal- und Beast-Variante
 *   Call 3  profileText    — kurzes Verdict, Normal- und Beast-Variante
 *
 * Alle Calls in Stufe 2 bekommen denselben Large-Output (description, ads,
 * triggers, hard_facts). Konsistenz-Anker ist hard_facts: alle vier Stufe-2-
 * Calls müssen sich daran halten.
 *
 * AGE_ANCHOR + GENDER_ANCHOR aus den Live-Prompts werden importiert, damit
 * die Alters-Kalibrierung identisch zur Production läuft (Vergleichbarkeit).
 */

/* AGE_ANCHOR + GENDER_ANCHOR werden direkt aus der Live-Prompt-Datei
   gelesen (siehe extractAnchors), damit Production-Kalibrierung 1:1
   in den Test einfließt. Kein require auf livePrompts nötig. */

/* AGE_ANCHOR/GENDER_ANCHOR sind im Live-Prompt eingebaut, nicht als separate
   Exports verfügbar. Wir extrahieren sie hier konservativ aus der Live-Datei,
   indem wir den describePrompt nehmen und davor abschneiden — das ist
   fragil, aber für ein lokales Test-Skript akzeptabel. Im Notfall kommen die
   Anker als Leer-Strings durch, dann verlieren die Test-Pipelines die
   Alters-Kalibrierung — das wäre sofort sichtbar. */
function extractAnchors() {
  /* Beide Anker sind am Ende des Live describePrompt angehängt. Wir lesen
     die Datei direkt, suchen die `const AGE_ANCHOR = \`` und
     `const GENDER_ANCHOR = \`` Blöcke. */
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.resolve(__dirname, "../src/locales/de/prompts.js"), "utf8");
  const ageMatch = src.match(/const AGE_ANCHOR = `([\s\S]*?)`;/);
  const genderMatch = src.match(/const GENDER_ANCHOR = `([\s\S]*?)`;/);
  return {
    AGE_ANCHOR: ageMatch ? ageMatch[1] : "",
    GENDER_ANCHOR: genderMatch ? genderMatch[1] : "",
  };
}
const { AGE_ANCHOR, GENDER_ANCHOR } = extractAnchors();

/* ─────────────────────────────────────────────────────────────────────────
 * Call 1 — Large 2512: Beschreibung + Marken + Triggers + hard_facts
 * ───────────────────────────────────────────────────────────────────────── */

const largeBundlePrompt = `Du bist ein KI-Bildanalyst. Erstelle aus dem Foto einen strukturierten JSON-Output mit vier Feldern. Alle Felder sind Pflicht.

ANTWORTE AUSSCHLIESSLICH ALS VALIDES JSON in genau diesem Format:
{
  "description": "<freie Bildbeschreibung in Deutsch, siehe Vorgaben unten>",
  "ads": ["<Marke 1>", "<Marke 2>", ...],
  "triggers": ["<Trigger 1>", "<Trigger 2>", ...],
  "hard_facts": {
    "alter": "<Alter mit Spanne, z.B. 'männlich, ~38 (Spanne 35-42)'>",
    "geschlecht": "<männlich/weiblich/ambig>",
    "herkunft": "<z.B. mitteleuropäisch, südasiatisch, etc.>",
    "einkommen_band": "<z.B. '€ 45.000–60.000 brutto'>",
    "bildung": "<z.B. 'Hochschulabschluss, technisch'>",
    "beziehungsstatus": "<z.B. 'liiert, keine sichtbaren Kinder'>",
    "lebensphase": "<z.B. 'berufstätig im Karrierefenster, sportbezogene Freizeit'>"
  }
}

REGELN PRO FELD:

description — Eine detaillierte Bildbeschreibung in Deutsch wie für blinde Nutzer:
- Alle sichtbaren Personen (Geschlecht, Hautton präzise, Gesichtszüge, Haare, Kleidung, Haltung)
- Sichtbare Logos, Markennamen, Texte WORTGENAU
- Objekte, Umgebung, Stimmung
- Lege dich auf EINE konkrete Altersspanne fest (z.B. "Geschätzte Altersspanne: 42-50 Jahre")
- KEINE Warnungen, KEINE Disclaimer

ads — Liste von 6–8 Marken-Schlagworten (je 1–3 Wörter):
- Konkret und plausibel, basierend auf sichtbaren Logos UND ableitbarem Konsum-/Lifestyle-Level
- Beispiele für Format: "Garmin Edge 1040", "Rapha Pro Team", "Red Bull Energy"
- Wenn keine konkreten Logos sichtbar: Marken aus dem ableitbaren Segment

triggers — 4–6 Manipulations-Trigger (je 1–2 Sätze, max. 20 Wörter):
- Bildspezifisch, NICHT generisch
- Beziehen sich auf sichtbare Interessen, Verhaltensmuster, Schwachstellen
- Vielfältig (nicht 4× FOMO)

hard_facts — DER KONSISTENZ-ANKER:
- Knappe, kanonische Grundfakten. Werden von allen nachfolgenden Klassifikatoren wortwörtlich übernommen.
- Im Zweifel zur oberen Altersspanne tendieren.
- KEIN "kaukasisch" verwenden — schreibe "europäisch" oder "mitteleuropäisch".
- einkommen_band orientiert sich am österreichischen/mitteleuropäischen Lohnniveau (Median Vollzeit ca. € 3.900 brutto).

${AGE_ANCHOR}
${GENDER_ANCHOR}
`;

/* ─────────────────────────────────────────────────────────────────────────
 * Call 2a / 2b — Karten als Schlagworte (Normal- und Beast-Variante)
 *
 * Bekommt: description, ads, triggers, hard_facts vom Large.
 * Aufgabe: 13 Karten mit Schlagwort-Wert (8–15 Wörter) + confidence.
 * ───────────────────────────────────────────────────────────────────────── */

function buildCardsPrompt(mode, largeBundle) {
  const isNormal = mode === "normal";
  const toneHeader = isNormal
    ? `Du bist ein sachlicher Datenbroker-Klassifikator. Ordne die Person in 13 Kategorien ein. Pro Kategorie: knapper Schlagwort-Wert (8–15 Wörter), nüchtern-direkt, keine "Basierend auf"-Floskeln.`
    : `Du bist ein zynisch-überspitzter Datenbroker-Klassifikator. Ordne die Person in 13 Kategorien ein. Pro Kategorie: knapper Schlagwort-Wert (8–15 Wörter), schonungslos, mit Fokus auf Verwertbarkeit/Schwachstelle. Keine Erklärungen.`;

  return `${toneHeader}

KONTEXT VOM BILDANALYST:
Beschreibung: ${largeBundle.description}

Werbemarken: ${(largeBundle.ads || []).join(", ")}

Manipulations-Trigger:
${(largeBundle.triggers || []).map((t, i) => `${i + 1}. ${t}`).join("\n")}

HARD_FACTS (verbindlich — diese Werte MÜSSEN in den entsprechenden Karten exakt übernommen werden, NICHT abweichen):
${JSON.stringify(largeBundle.hard_facts || {}, null, 2)}

WICHTIG: alter_geschlecht, herkunft, einkommen, bildung, beziehungsstatus müssen die Werte aus hard_facts wortgenau widerspiegeln. Du darfst sie verfeinern oder härter formulieren (besonders im Beast-Modus), aber NICHT mit anderem Alter, Geschlecht oder Einkommens-Band antworten.

ANTWORTE AUSSCHLIESSLICH ALS VALIDES JSON in diesem Format:
{
  "categories": {
    "alter_geschlecht": { "value": "...", "confidence": 0.0-1.0 },
    "herkunft":         { "value": "...", "confidence": 0.0-1.0 },
    "einkommen":        { "value": "...", "confidence": 0.0-1.0 },
    "bildung":          { "value": "...", "confidence": 0.0-1.0 },
    "beziehungsstatus": { "value": "...", "confidence": 0.0-1.0 },
    "interessen":       { "value": "...", "confidence": 0.0-1.0 },
    "persoenlichkeit":  { "value": "...", "confidence": 0.0-1.0 },
    "charakterzuege":   { "value": "...", "confidence": 0.0-1.0 },
    "politisch":        { "value": "...", "confidence": 0.0-1.0 },
    "gesundheit":       { "value": "...", "confidence": 0.0-1.0 },
    "kaufkraft":        { "value": "...", "confidence": 0.0-1.0 },
    "verletzlichkeit":  { "value": "...", "confidence": 0.0-1.0 },
    "werbeprofil":      { "value": "...", "confidence": 0.0-1.0 }
  }
}

KEIN Fließtext. KEINE Erklärungen außerhalb des JSON. KEIN Markdown. Nur das JSON-Objekt.`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Call 3a / 3b — profileText (Normal- und Beast-Variante)
 *
 * Bekommt: description, ads, triggers, hard_facts vom Large.
 * Bekommt KEINE Karten — bleibt unabhängig vom Karten-Modell.
 * Aufgabe: knappes Verdict, 100–150 Wörter.
 * ───────────────────────────────────────────────────────────────────────── */

function buildProfileTextPrompt(mode, largeBundle) {
  const isNormal = mode === "normal";
  const systemHeader = isNormal
    ? `Du bist ein sachlicher Datenbroker-Analyst. Schreibe ein Verdict in zweiter Person, nüchtern-direkt. Sprich die Person mit "du" an. 100–150 Wörter. Beziehe dich konkret auf sichtbare Marken und genannte Trigger. KEIN Passiv, KEINE Disclaimer, KEINE "möglicherweise"/"vielleicht".`
    : `Du bist ein zynisch-überspitzter Algorithmus eines Tech-Konzerns. Schreibe ein Verdict im Stil "Wir wissen, dass du...", "Wir verkaufen dir...", "Wir nutzen aus, dass du...". 100–150 Wörter. Beziehe dich konkret auf Marken und Trigger. Schonungslos, aber bildbelegt — keine Spekulation ohne sichtbaren Anker.`;

  return `${systemHeader}

VERBINDLICHE GRUNDFAKTEN (hard_facts) — diese MÜSSEN sich im Verdict widerspiegeln, nicht abweichen:
${JSON.stringify(largeBundle.hard_facts || {}, null, 2)}

BILDBESCHREIBUNG:
${largeBundle.description}

SICHTBARE MARKEN (greife mindestens 2 namentlich auf):
${(largeBundle.ads || []).join(", ")}

MANIPULATIONS-TRIGGER (greife mindestens 1 auf):
${(largeBundle.triggers || []).map((t, i) => `${i + 1}. ${t}`).join("\n")}

ANTWORTE AUSSCHLIESSLICH ALS VALIDES JSON in diesem Format:
{ "profileText": "<dein Verdict, 100-150 Wörter>" }

KEIN Markdown, KEIN Fließtext außerhalb des JSON.`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Exports
 * ───────────────────────────────────────────────────────────────────────── */

module.exports = {
  largeBundlePrompt,
  buildCardsPrompt,
  buildProfileTextPrompt,
  /* für Debugging: zeigen welche Anker geladen wurden */
  _anchorLengths: {
    age: AGE_ANCHOR.length,
    gender: GENDER_ANCHOR.length,
  },
};
