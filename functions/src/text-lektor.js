"use strict";

/**
 * text-lektor.js — bereinigt die seriöse Zusammenfassung in einem kurzen
 * Aufruf ohne Foto (Begründung: locales/de/lektor.js). Beast bleibt unberührt.
 *
 * Der Lektor ist Beiwerk: Scheitert er oder liefert er etwas, das nicht wie
 * derselbe Text aussieht, bleibt der ursprüngliche Text stehen. Die Grenzen
 * fangen ab, was sonst im Ergebnis stünde: eine Absage statt des Textes, ein
 * abgebrochener Rest oder ein frei neu geschriebener Text.
 */

const { LEKTOR_MODELL, LEKTOR_MAX_TOKENS, LEKTOR_ZEITGRENZE_MS } = require("./config");
const { callMistralRaw } = require("./mistral-http");
const { escapeXml, beginntWieAbsage } = require("./mistral-antwort");
const { loadPrompts } = require("./i18n");

const MINDESTANTEIL = 0.6;
const HOECHSTANTEIL = 1.15;
const VERBOGEN_ANTEIL = 0.35;

/* Nur was escapeXml erzeugt hat, wird zurückgeholt: Sonst stünde im Ergebnis
   „Salt &amp; Lake“ statt „Salt & Lake“. */
function ohneMaskierung(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function abstand(a, b) {
  let zeile = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const naechste = [i];
    for (let j = 1; j <= b.length; j += 1) {
      naechste[j] = Math.min(naechste[j - 1] + 1, zeile[j] + 1, zeile[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    zeile = naechste;
  }
  return zeile[b.length];
}

const woerter = (text) => text.toLowerCase().match(/[\p{L}-]{6,}/gu) || [];

/* Der Lektor soll streichen, nicht buchstabieren: Gemessen wurde aus
   „Angriffsfläche“ das Fehlwort „Angstsfläche“. Ein neues Wort, das einem alten
   ähnelt, ohne nur eine andere Endung zu haben, gilt deshalb als verbogen. */
function hatVerbogenesWort(neu, alt) {
  const bekannt = new Set(woerter(alt));
  return woerter(neu).some(
    (wort) =>
      !bekannt.has(wort) &&
      [...bekannt].some((a) => {
        const stamm = Math.min(a.length, wort.length) - 3;
        if (a.slice(0, stamm) === wort.slice(0, stamm)) return false;
        return abstand(a, wort) <= Math.max(a.length, wort.length) * VERBOGEN_ANTEIL;
      })
  );
}

function brauchbar(neu, alt) {
  if (!neu || /<\/?text>/.test(neu) || beginntWieAbsage(neu) || hatVerbogenesWort(neu, alt)) return false;
  return neu.length >= alt.length * MINDESTANTEIL && neu.length <= alt.length * HOECHSTANTEIL;
}

async function textBereinigen(text, lang, messung = null) {
  if (typeof text !== "string" || !text.trim()) return null;
  const prompts = loadPrompts(lang || "de");
  if (typeof prompts.lektorSystem !== "string" || typeof prompts.lektorUser !== "function") return null;
  try {
    const result = await callMistralRaw({
      model: LEKTOR_MODELL,
      messages: [
        { role: "system", content: prompts.lektorSystem },
        { role: "user", content: prompts.lektorUser(escapeXml(text)) },
      ],
      maxTokens: LEKTOR_MAX_TOKENS,
      temperature: 0.1,
      timeoutMs: LEKTOR_ZEITGRENZE_MS,
      cacheKey: `malzime-lektor-${lang || "de"}`,
    });
    const neu = ohneMaskierung(String(result.text || "").trim());
    const ok = brauchbar(neu, text);
    console.log(
      JSON.stringify({
        step: "mistral-lektor",
        status: ok ? "ok" : "verworfen",
        laengeAlt: text.length,
        laengeNeu: neu.length,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
      })
    );
    if (messung) messung.lektor = ok ? "ok" : "verworfen";
    return ok ? neu : null;
  } catch (err) {
    console.log(JSON.stringify({ step: "mistral-lektor", status: "fehler", error: err.message }));
    if (messung) messung.lektor = "fehler";
    return null;
  }
}

module.exports = { textBereinigen };
