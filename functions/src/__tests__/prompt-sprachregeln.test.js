/**
 * prompt-sprachregeln.test.js — Kein Pornografie-Slang in den Profilen.
 *
 * ANLASS (Workshop 16.09.2026): Bei einem Foto ohne Person schrieb das Modell
 * im Beast-Profiltext das Wort „porn" (Slang wie „Food-Porn"). Der
 * Kinderschutz-Filter in minor-safety.js hat es als harten Treffer gemeldet und
 * den Alarm ausgelöst — zu Recht: Das Werkzeug läuft in Schulklassen, und dort
 * hat das Wort auch als Scherz nichts verloren.
 *
 * Der Filter meldet Fließtext nur, er schneidet nichts heraus (siehe
 * minor-safety.js, Abschnitt Fließtext). Die Vorbeugung gehört deshalb in den
 * Prompt: eine ausdrückliche Regel bei den gemeinsamen Regeln beider Modi,
 * direkt neben dem „kaukasisch"-Verbot.
 *
 * Geprüft wird der Modul-Export, also genau der Text, der an Mistral geht.
 * Reine Textanalyse — kein Netzwerk, keine Cloud.
 */

const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");

const REGEL = {
  de: {
    zeile:
      '- Verwende NIEMALS Slang mit „Porn" oder „Porno" (etwa „Food-Porn") und keine anderen Wörter aus dem Bereich Pornografie — auch nicht als Scherz oder Fachbegriff. Das Tool läuft in Schulklassen.',
    /* Die Zeile, hinter der die Regel stehen soll — im Abschnitt, der für
       BEIDE Modi gilt. */
    nachbar: '- Verwende NIEMALS den Begriff „kaukasisch". Schreibe stattdessen „europäisch" oder „mitteleuropäisch".',
    abschnitt: "═══ GEMEINSAME REGELN FÜR BEIDE MODI ═══",
  },
  en: {
    zeile:
      '- NEVER use slang containing "porn" (such as "food porn") or any other pornographic terms — not even as a joke or a technical term. The tool is used in school classes.',
    nachbar: '- NEVER use the term "caucasian". Write "European" or "central European" instead.',
    abschnitt: "═══ COMMON RULES FOR BOTH MODES ═══",
  },
};

const ANALYSE = [
  ["de", de.singleLargePrompt],
  ["en", en.singleLargePrompt],
];

/* Liefert, was an der Regel nicht stimmt — leer heißt: alles in Ordnung.
   Eine eigene Funktion, damit die Gegenprobe unten genau dieselbe Prüfung
   gegen einen Text ohne die Regel laufen lassen kann. */
function befundePornoRegel(prompt, sprache) {
  const r = REGEL[sprache];
  if (!prompt.includes(r.zeile)) return ["fehlt"];
  const befunde = [];
  if (!prompt.includes(`${r.nachbar}\n${r.zeile}\n`)) befunde.push("nicht-neben-kaukasisch");
  /* Die Regel muss im Abschnitt für beide Modi stehen, also nach dessen
     Überschrift und vor dem nächsten Abschnitt. */
  const start = prompt.indexOf(r.abschnitt);
  const naechster = prompt.indexOf("═══", start + r.abschnitt.length);
  const stelle = prompt.indexOf(r.zeile);
  if (start < 0 || stelle < start || (naechster >= 0 && stelle > naechster)) befunde.push("falscher-abschnitt");
  return befunde;
}

describe("Kein Pornografie-Slang in den Profilen", () => {
  test.each(ANALYSE)("der Analyse-Prompt (%s) verbietet den Slang bei den gemeinsamen Regeln", (sprache, prompt) => {
    expect(typeof prompt).toBe("string");
    expect(befundePornoRegel(prompt, sprache)).toEqual([]);
  });

  test.each(ANALYSE)("GEGENPROBE (%s): die Prüfung erkennt eine fehlende oder verschobene Regel", (sprache, prompt) => {
    /* Ohne diese Gegenprobe könnte befundePornoRegel() immer [] liefern und
       der Test oben wäre grün, ohne etwas zu prüfen. */
    const r = REGEL[sprache];
    const ohne = prompt.replace(`${r.zeile}\n`, "");
    expect(befundePornoRegel(ohne, sprache)).toEqual(["fehlt"]);
    const verschoben = `${ohne}\n${r.zeile}\n`;
    expect(befundePornoRegel(verschoben, sprache)).toEqual(["nicht-neben-kaukasisch", "falscher-abschnitt"]);
  });
});
