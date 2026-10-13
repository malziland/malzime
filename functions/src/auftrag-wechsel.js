"use strict";

/**
 * auftrag-wechsel.js — was am Analyse-Auftrag von Analyse zu Analyse wechselt.
 *
 * Zwei Dinge, beide gewuerfelt, beide mit vorgebbarer Nummer fuer Tests und
 * Messungen:
 *   - die Marken-Sperre hinter dem Bild (seit v2.7),
 *   - die Formvorlage am Ende des Auftrags (seit 13.10.2026).
 *
 * HERAUSGELOEST AUS mistral.js am 13.10.2026. mistral.js fuehrt den Aufruf und
 * setzt die Antwort zusammen; welche Sperrliste und welche Vorlage diesmal
 * mitgehen, ist eine andere Frage und aendert sich aus anderen Gruenden. Was
 * hier NICHT hingehoert: alles, was den Inhalt einer Antwort vorgibt. Die
 * Messreihe vom 13.10.2026 hat gezeigt, dass gewuerfelte Inhalte (dort: die
 * Felder der Werbung) unpassende Ergebnisse erzwingen.
 */

const { loadPrompts } = require("./i18n");

/* ── Marken-Sperre (v2.7) ─────────────────────────────────────────────────
   Mistral folgt Beispielen, nicht Regeln. Solange konkrete Marken im Prompt
   standen, kamen sie auch zurueck: bei einem Radsport-Foto lieferte die alte
   Fassung ALLE acht Marken aus der Beispielliste. Die Beispiele sind deshalb
   ersatzlos aus dem Prompt geflogen (nur noch Format-Platzhalter) — und hier
   steht eine ROTIERENDE Sperrliste dagegen, damit das Modell nicht einfach
   einen neuen Liebling entwickelt.

   Set 0 sind die im alten Prompt verbrannten Dauerbrenner; die weiteren Sets
   decken die Marken ab, die erfahrungsgemaess als Zweitwahl nachruecken, damit
   die Rotation nicht bloss von Anker A auf Anker B umschaltet.

   Gemessen (84 Analysen, 2026-08-09): Anteil Werbe-Eintraege aus den
   Prompt-Beispielen 7,5 % -> 0,9 %, verschiedene Marken 95 -> 270,
   Sperrlisten-Verstoesse 0. */
const BRAND_BLOCKLIST_SETS = [
  ["Garmin", "Rapha", "Wahoo", "Specialized", "Komoot", "Ortlieb", "Red Bull", "Apple Watch", "Nike Metcon"],
  ["Garmin", "Rapha", "Wahoo", "Specialized", "Nike", "Adidas", "Apple", "Samsung", "Puma"],
  ["Garmin", "Komoot", "Ortlieb", "Red Bull", "Zalando", "H&M", "Zara", "Douglas", "Sephora"],
  [
    "Garmin",
    "Rapha",
    "Apple Watch",
    "Lululemon",
    "Under Armour",
    "The North Face",
    "Patagonia",
    "Salomon",
    "On Running",
  ],
  ["Garmin", "Wahoo", "Specialized", "Nike", "L'Oréal", "Maybelline", "Nivea", "Rituals", "Yves Rocher"],
  ["Garmin", "Red Bull", "Apple", "PlayStation", "Nintendo", "Xbox", "Netflix", "Spotify", "TikTok"],
];

function buildBrandBlocklistBlock(lang, index) {
  /* Ohne vorgegebenen Index zufaellig rotieren. Determinismus ist hier nicht
     noetig (es geht nur um Abwechslung), aber Tests koennen ihn vorgeben. */
  const i =
    typeof index === "number" && Number.isFinite(index)
      ? Math.abs(Math.trunc(index))
      : Math.floor(Math.random() * BRAND_BLOCKLIST_SETS.length);
  const set = BRAND_BLOCKLIST_SETS[i % BRAND_BLOCKLIST_SETS.length];

  /* Der Text selbst liegt in den Locale-Dateien — Backend-JS bleibt frei von
     hartcodierter Sprache (i18n-Guardian). */
  const prompts = loadPrompts(lang || "de");
  return prompts.brandBlocklistBlock(set.join(", "));
}

/* ── Wechselnde Formvorlage (13.10.2026) ──────────────────────────────────
   Der Auftrag endet mit einem ausgefuellten Beispiel. Solange es genau eines
   gab, praegte es jede Antwort und wurde bei aehnlichen Fotos abgeschrieben
   (Messung und Regeln in locales/de/muster.js). Je Analyse geht deshalb eine
   von mehreren Vorlagen mit. Anders als ein gewuerfelter Inhalt gibt die
   Vorlage nichts vor, was im Ergebnis stehen soll — sie zeigt nur die Form.
   Der Teil davor ist in allen Auftraegen derselbe. */
function waehleAuftrag(prompts, index) {
  const varianten = prompts.singleLargePromptVarianten;
  /* Ohne vorgegebene Nummer zufaellig; Tests und Messungen geben sie vor. */
  const i =
    typeof index === "number" && Number.isFinite(index)
      ? Math.abs(Math.trunc(index))
      : Math.floor(Math.random() * varianten.length);
  return varianten[i % varianten.length];
}

module.exports = { BRAND_BLOCKLIST_SETS, buildBrandBlocklistBlock, waehleAuftrag };
