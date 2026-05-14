"use strict";

/**
 * json-repair.js — Defensive JSON-Parsing-Schicht für LLM-Outputs.
 *
 * LLMs liefern manchmal kaputtes JSON, obwohl der Inhalt vollständig ist:
 *   - Markdown-Fencing (```json ... ```)
 *   - Trailing Commas (`,}` oder `,]`)
 *   - Smart Quotes ("…" statt "...")
 *   - Unescapte Anführungszeichen in Strings
 *   - Truncation am max_tokens-Limit (mitten im Wort abgebrochen)
 *
 * Strategie: vier Reparatur-Stufen, von strikt bis großzügig. Wenn alle
 * scheitern, wird `null` zurückgegeben — der Aufrufer muss dann selbst
 * entscheiden, ob ein Retry mit härterem Prompt sinnvoll ist oder ob ein
 * Fallback-Anbieter greift.
 *
 * Test-Fixtures aus `compare-failed-mistral-large-3-*.txt` (Mistral hat
 * heute beide Failure-Modi gezeigt: Malformed-JSON und Truncation).
 */

let json5;
try {
  json5 = require("json5");
} catch (_e) {
  /* Falls json5 nicht installiert ist, läuft Stage 3 leer durch — kein Crash. */
  json5 = null;
}

/* Maximale Größe pro String-Feld nach Repair (SEC-004 Bounds). */
const STRING_BOUND_CATEGORY = 800;
const STRING_BOUND_AD_TARGETING = 300;
const STRING_BOUND_MANIPULATION = 500;
const STRING_BOUND_PROFILE_TEXT = 2000;

/* ── Stufe 1: Direkter Parse ──────────────────────────────────────── */

function tryParseDirect(text) {
  try {
    return { parsed: JSON.parse(text), stage: "direct" };
  } catch (e) {
    return { parsed: null, error: e };
  }
}

/* ── Stufe 2: Heuristische Reparaturen ─────────────────────────────── */

/* Escapet unescapte Inner-Quotes innerhalb eines JSON-Strings.
   Heuristik: Wenn ein `"` auftaucht während wir inString sind, prüfen wir das
   nächste nicht-Whitespace-Zeichen. Ist es `:`, `,`, `}`, `]` oder EOF, war es
   ein legitimes String-Ende. Alles andere (Buchstabe, Ziffer etc.) deutet auf
   eine "inner quote" innerhalb des Strings hin (Mistral macht das gelegentlich
   in Ausdrücken wie `"attraktiver"`). In dem Fall escapen wir den Quote. */
function escapeInnerQuotes(text) {
  let result = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      result += ch;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      if (inString) {
        /* Schaue auf nächstes nicht-Whitespace-Zeichen */
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const nextCh = text[j];
        if (j >= text.length || nextCh === ":" || nextCh === "," || nextCh === "}" || nextCh === "]") {
          /* Legitimes Ende eines Strings */
          inString = false;
          result += ch;
        } else {
          /* Inner Quote — escapen statt schließen */
          result += '\\"';
        }
      } else {
        inString = true;
        result += ch;
      }
      continue;
    }
    result += ch;
  }
  return result;
}

/* Escapet rohe Control-Characters (newline/carriage-return/tab) die INNERHALB
   eines JSON-Strings stehen. Mistral liefert manchmal unescaped \n im String,
   was JSON-strict invalid ist. Außerhalb von Strings bleiben sie unangetastet. */
function escapeControlCharsInStrings(text) {
  let result = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      result += ch;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      result += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    result += ch;
  }
  return result;
}

/* "Light"-Cleanup: behält alles Wesentliche, entfernt nur sicheren Müll.
   - Markdown-Fencing weg
   - Smart Quotes durch ASCII
   - Trailing Commas vor `}` und `]` (auch mit Leerzeichen davor)
   - Control-Chars in Strings escapen (häufig bei Mistral)
   Bleibt KOMPATIBEL mit Truncation-Recovery — schneidet NICHT zum letzten `}`. */
function cleanLight(text) {
  let cleaned = String(text || "");

  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```/g, "");

  cleaned = cleaned.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'");

  cleaned = escapeControlCharsInStrings(cleaned);
  cleaned = escapeInnerQuotes(cleaned);

  /* Trailing Commas: greift auch wenn vorher Whitespace steht (z.B. `1 ,\n}`) */
  cleaned = cleaned.replace(/\s*,(\s*[}\]])/g, "$1");

  return cleaned.trim();
}

/* Full-Heuristic: cleanLight + Slice zum letzten `}`. Zerstört Truncation-Tail
   absichtlich, weil für vollständige JSONs typischer Output-Müll danach steht. */
function cleanHeuristic(text) {
  let cleaned = cleanLight(text);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function tryParseHeuristic(text) {
  const cleaned = cleanHeuristic(text);
  if (!cleaned) return { parsed: null, error: new Error("empty after cleanup") };
  try {
    return { parsed: JSON.parse(cleaned), stage: "heuristic", cleaned };
  } catch (e) {
    return { parsed: null, error: e, cleaned };
  }
}

/* ── Stufe 3: Toleranter Parser (json5) ─────────────────────────────── */

function tryParseLenient(cleanedText) {
  if (!json5) return { parsed: null, error: new Error("json5 not installed") };
  try {
    return { parsed: json5.parse(cleanedText), stage: "lenient" };
  } catch (e) {
    return { parsed: null, error: e };
  }
}

/* ── Stufe 4: Truncation-Recovery ──────────────────────────────────── */

/* Schnelltest: hat der Text unbalancierte Klammern oder endet er mitten in einem
   String? Wenn ja, ist Stufe 4 vor Stufe 2 sinnvoll, weil Stufe 2 sonst durch
   ihren "slice bis zum letzten }" wertvolle Daten vor dem Truncation-Punkt
   wegschneidet. */
function isLikelyTruncated(text) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth > 0 || inString;
}

/* Wenn der Output mitten im Wert abbricht: das letzte vollständig geschlossene
   Konstrukt (Object, Array oder String-Value) finden, alles danach abschneiden,
   dann alle offenen Klammern aus dem verbleibenden Stack in umgekehrter
   Reihenfolge anhängen.

   Stack-basiert: wir tracken offene Klammern und merken uns nach jedem Close
   und nach jedem fertigen String die Position als möglichen Cut-Point. */
function tryParseTruncated(cleanedText) {
  if (!cleanedText || !cleanedText.startsWith("{")) {
    return { parsed: null, error: new Error("not an object literal") };
  }

  const stack = []; /* '{' oder '[' */
  let inString = false;
  let escape = false;
  let lastCleanEnd = -1; /* Position NACH dem letzten sauber geschlossenen Wert */
  let stackAtCut = []; /* Snapshot des Stacks ZUM ZEITPUNKT von lastCleanEnd */

  for (let i = 0; i < cleanedText.length; i++) {
    const ch = cleanedText[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      /* String-Open und String-Close — wir markieren KEINEN cleanEnd hier,
         weil Strings sowohl Keys als auch Values sein können. Cut-Punkte
         sind nur sicher nach geschlossenen Containern oder Primitives. */
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      lastCleanEnd = i + 1;
      stackAtCut = stack.slice();
    } else if (/[\d.-]/.test(ch)) {
      /* Sind wir gerade in einem Number-Token? Lese bis zum nicht-Zahl-Char. */
      let j = i;
      while (j < cleanedText.length && /[\d.eE\-+]/.test(cleanedText[j])) j++;
      lastCleanEnd = j;
      stackAtCut = stack.slice();
      i = j - 1;
    } else if (ch === "t" || ch === "f" || ch === "n") {
      /* Literal-Tokens: true/false/null */
      const literal =
        ch === "t" && cleanedText.slice(i, i + 4) === "true"
          ? 4
          : ch === "f" && cleanedText.slice(i, i + 5) === "false"
            ? 5
            : ch === "n" && cleanedText.slice(i, i + 4) === "null"
              ? 4
              : 0;
      if (literal > 0) {
        lastCleanEnd = i + literal;
        stackAtCut = stack.slice();
        i += literal - 1;
      }
    }
  }

  if (lastCleanEnd === -1) {
    return { parsed: null, error: new Error("no safe cut point found") };
  }

  /* Slice bis zum letzten sauberen Ende */
  let truncated = cleanedText.slice(0, lastCleanEnd);

  /* Trailing Whitespace und Komma weg (zwischen letzter Value und Cut-Tail) */
  truncated = truncated.replace(/[,\s]+$/, "");

  /* Falls wir mitten in einem "key":value-Paar abgeschnitten haben (Stack zeigt
     `{` an, aber wir enden gerade nach einem String der ein KEY war, nicht
     value), müssen wir auch das halbfertige Pair entfernen. Pattern: enden
     mit `"...":` oder mit `"..."` ohne folgendes `:`. */
  /* Trim trailing `"...":` (key gefolgt von Doppelpunkt, kein value) */
  truncated = truncated.replace(/"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
  /* Trim verbleibendes Komma nach so einer Entfernung */
  truncated = truncated.replace(/[,\s]+$/, "");

  /* Stack ZUM ZEITPUNKT DES CUTS in umgekehrter Reihenfolge schließen
     (nicht den finalen Stack — der gilt für den vollen text, der hier
     bereits abgeschnitten wurde). */
  for (let i = stackAtCut.length - 1; i >= 0; i--) {
    truncated += stackAtCut[i] === "{" ? "}" : "]";
  }

  try {
    const parsed = JSON.parse(truncated);
    return { parsed, stage: "truncation-recovery" };
  } catch (e) {
    return { parsed: null, error: e };
  }
}

/* ── Output-Bounds (Schutz vor übergroßen Werten, identisch zu SEC-004) ── */

function applyBounds(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.categories && typeof parsed.categories === "object") {
    const catKeys = Object.keys(parsed.categories).slice(0, 20);
    const bounded = {};
    for (const key of catKeys) {
      const cat = parsed.categories[key];
      if (cat && typeof cat === "object") {
        bounded[key] = {
          label: typeof cat.label === "string" ? cat.label.slice(0, 200) : String(key),
          value: typeof cat.value === "string" ? cat.value.slice(0, STRING_BOUND_CATEGORY) : "",
          confidence: typeof cat.confidence === "number" ? Math.max(0, Math.min(1, cat.confidence)) : 0.5,
        };
      }
    }
    parsed.categories = bounded;
  } else {
    parsed.categories = {};
  }

  if (!Array.isArray(parsed.ad_targeting)) {
    parsed.ad_targeting = [];
  } else {
    parsed.ad_targeting = parsed.ad_targeting
      .filter((s) => typeof s === "string")
      .map((s) => s.slice(0, STRING_BOUND_AD_TARGETING))
      .slice(0, 20);
  }

  if (!Array.isArray(parsed.manipulation_triggers)) {
    parsed.manipulation_triggers = [];
  } else {
    parsed.manipulation_triggers = parsed.manipulation_triggers
      .filter((s) => typeof s === "string")
      .map((s) => s.slice(0, STRING_BOUND_MANIPULATION))
      .slice(0, 10);
  }

  if (typeof parsed.profileText !== "string") {
    parsed.profileText = "";
  } else {
    parsed.profileText = parsed.profileText.slice(0, STRING_BOUND_PROFILE_TEXT);
  }

  return parsed;
}

/* ── Hauptfunktion ──────────────────────────────────────────────────── */

/* parseSafely(text, options?)
   - text: raw LLM output (kann Markdown, kaputtes JSON etc. enthalten)
   - options.onRepair(stage, error?): wird pro versuchter Stufe aufgerufen.
     Hilfreich für Telemetrie ("welche Stufe musste eingreifen?").
   - options.requireSchema (default true): erzwingt Profil-Schema (categories etc.).
     Wenn das Schema fehlt, gilt der Parse als gescheitert.

   Rückgabe:
   - bei Erfolg: das geparste Profil (mit applyBounds gesäubert)
   - bei Misserfolg: null
*/
function parseSafely(text, options = {}) {
  const { onRepair = () => {}, requireSchema = true } = options;

  if (typeof text !== "string" || !text.trim()) {
    onRepair("none", new Error("empty input"));
    return null;
  }

  /* Stufe 1: direkt versuchen */
  const direct = tryParseDirect(text);
  if (direct.parsed != null) {
    if (!requireSchema || (direct.parsed && direct.parsed.categories)) {
      onRepair("direct");
      return applyBounds(direct.parsed);
    }
  } else {
    onRepair("direct-failed", direct.error);
  }

  /* Wenn der Text offensichtlich abgeschnitten ist (unbalancierte Klammern oder
     unclosed string), gehen wir DIREKT zu Stufe 4. Sonst würde Stufe 2 mit ihrem
     "slice bis zum letzten }" den Truncation-Tail zerstören und ad_targeting etc.
     gingen verloren. */
  const cleanedPreserved = cleanLight(text);
  if (isLikelyTruncated(cleanedPreserved)) {
    const truncated = tryParseTruncated(cleanedPreserved);
    if (truncated.parsed != null) {
      if (!requireSchema || (truncated.parsed && truncated.parsed.categories)) {
        onRepair("truncation-recovery");
        return applyBounds(truncated.parsed);
      }
    } else {
      onRepair("truncation-recovery-failed", truncated.error);
    }
  }

  /* Stufe 2: heuristisch (slice bis zum letzten `}`) */
  const heuristic = tryParseHeuristic(text);
  if (heuristic.parsed != null) {
    if (!requireSchema || (heuristic.parsed && heuristic.parsed.categories)) {
      onRepair("heuristic");
      return applyBounds(heuristic.parsed);
    }
  } else {
    onRepair("heuristic-failed", heuristic.error);
  }

  /* Stufe 3: json5 (tolerant) — operiert auf der heuristisch geslicten Variante,
     weil json5 nur Syntax-Toleranz bringt, kein Truncation-Healing. */
  const cleanedAggressive = heuristic.cleaned || cleanHeuristic(text);
  if (json5) {
    const lenient = tryParseLenient(cleanedAggressive);
    if (lenient.parsed != null) {
      if (!requireSchema || (lenient.parsed && lenient.parsed.categories)) {
        onRepair("lenient");
        return applyBounds(lenient.parsed);
      }
    } else {
      onRepair("lenient-failed", lenient.error);
    }
  }

  /* Stufe 4 als letzte Bremse — falls oben "looksTruncated" einen False-Negative
     hatte und wir bis hierhin sind, probieren wir's nochmal. */
  if (!isLikelyTruncated(cleanedPreserved)) {
    const truncated = tryParseTruncated(cleanedPreserved);
    if (truncated.parsed != null) {
      if (!requireSchema || (truncated.parsed && truncated.parsed.categories)) {
        onRepair("truncation-recovery");
        return applyBounds(truncated.parsed);
      }
    }
  }

  onRepair("all-failed");
  return null;
}

module.exports = {
  parseSafely,
  applyBounds,
  cleanHeuristic,
  /* Für gezielte Tests einzelner Stufen */
  _tryParseDirect: tryParseDirect,
  _tryParseHeuristic: tryParseHeuristic,
  _tryParseLenient: tryParseLenient,
  _tryParseTruncated: tryParseTruncated,
};
