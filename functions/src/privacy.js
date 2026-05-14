"use strict";

/**
 * privacy.js — OCR-basierte Datenschutz-Risiko-Erkennung.
 *
 * Seit v1.6.0 kommt der OCR-Text aus Mistrals Bildbeschreibung — konkret
 * aus der Zeile "Sichtbarer Text: <text>" am Ende der Antwort (vorgegeben
 * durch mistralDescribeAddendum in prompts.js).
 *
 * Erkannt werden:
 *   - Adressen (Straßennamen, Schulen) — nur aus der "Sichtbarer Text:"-Zeile
 *   - Telefonnummern (mit Filter gegen Stockfoto-Wasserzeichen) — dito
 *   - Kfz-Kennzeichen (deutsches/österreichisches Format) — aus der GANZEN
 *     Beschreibung, weil das Muster spezifisch genug für False-Positive-Freiheit ist
 */

/**
 * Extrahiert die "Sichtbarer Text: ..."-Zeile aus einer Mistral-Beschreibung.
 * Kommt mit Newlines mitten in der Aufzählung klar (greedy bis Ende oder bis
 * zur nächsten Doppel-Newline).
 *
 * @param {string} description
 * @returns {string}
 */
function extractVisibleText(description) {
  if (!description || typeof description !== "string") return "";
  /* Akzeptiert "Sichtbarer Text:" (de) und "Visible text:" (en) */
  const match = description.match(/(?:Sichtbarer Text|Visible text):\s*([^\n]*(?:\n(?!\n)[^\n]*)*)/i);
  if (!match) return "";
  return match[1].trim();
}

/**
 * Baut die Privacy-Risiko-Liste aus der Mistral-Bildbeschreibung.
 *
 * @param {{ visibleText?: string, fullDescription?: string }} args
 *   visibleText      — die extrahierte "Sichtbarer Text:"-Zeile (Adresse/Telefon)
 *   fullDescription  — die komplette Mistral-Beschreibung (Kfz-Kennzeichen)
 * @returns {string[]} — Liste von Risiko-Keys (z.B. "privacy.address")
 */
function buildPrivacyRisks({ visibleText, fullDescription }) {
  const risks = [];
  const text = (visibleText || "").toLowerCase();

  /* Adresse + Telefon: bewusst NUR auf der expliziten "Sichtbarer Text:"-Zeile,
     nicht auf der Beschreibungsprosa — sonst False Positives (Mistral schreibt
     "sie steht an einer Straße" → würde fälschlich privacy.address auslösen). */
  if (text) {
    if (text.includes("straße") || text.includes("str.") || text.includes("schule")) {
      risks.push("privacy.address");
    }

    /* Watermark-Filter: Stockfoto-Anbieter sollen NICHT als Telefon-Risiko gelten */
    const isWatermark = /shutterstock|getty|istock|depositphotos|alamy/i.test(text);
    if (!isWatermark && (/\b\d{2,3}[\s/-]?\d{6,8}\b/.test(text) || /\b0\d{2,4}[\s/-]?\d{5,8}\b/.test(text))) {
      risks.push("privacy.phone");
    }
  }

  /* Kfz-Kennzeichen: deutsches/österreichisches Format, z.B. "M-AB 1234".
     Das Muster ist spezifisch genug, dass es gefahrlos über die GANZE
     Beschreibung laufen kann — fängt damit auch Kennzeichen, die Mistral nur
     im Fließtext erwähnt statt in der "Sichtbarer Text:"-Zeile. */
  const plateScan = `${fullDescription || ""}\n${visibleText || ""}`;
  if (/\b[a-zäöü]{1,3}-[a-zäöü]{1,2} \d{1,4}\b/i.test(plateScan)) {
    risks.push("privacy.licensePlate");
  }

  return risks;
}

module.exports = { buildPrivacyRisks, extractVisibleText };
