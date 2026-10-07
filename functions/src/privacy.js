"use strict";

/**
 * privacy.js — OCR-basierte Datenschutz-Risiko-Erkennung.
 *
 * Der OCR-Text kommt aus dem Feld `visible_text` der KI-Antwort;
 * job-pipelines.js reicht den Wert des Feldes herein. Ausgewertet wird nur
 * dieses Feld — eine Zeile "Sichtbarer Text:" im Profiltext zaehlt nicht.
 *
 * Erkannt werden:
 *   - Adressen (Straßennamen, Schulen) — nur aus dem sichtbaren Text
 *   - Telefonnummern (mit Filter gegen Stockfoto-Wasserzeichen) — dito
 *   - Kfz-Kennzeichen (deutsches/österreichisches Format) — aus der GANZEN
 *     Beschreibung, weil das Muster spezifisch genug für False-Positive-Freiheit ist
 */

/**
 * Baut die Privacy-Risiko-Liste aus der Mistral-Bildbeschreibung.
 *
 * @param {{ visibleText?: string, fullDescription?: string }} args
 *   visibleText      — der Wert des Feldes `visible_text` (Adresse/Telefon)
 *   fullDescription  — Profiltext und Kartenwerte (Kfz-Kennzeichen)
 * @returns {string[]} — Liste von Risiko-Keys (z.B. "privacy.address")
 */
function buildPrivacyRisks({ visibleText, fullDescription }) {
  const risks = [];
  const text = (visibleText || "").toLowerCase();

  /* Adresse + Telefon: bewusst NUR auf dem sichtbaren Text,
     nicht auf der Beschreibungsprosa — sonst False Positives (Mistral schreibt
     "sie steht an einer Straße" → würde fälschlich privacy.address auslösen). */
  if (text) {
    if (text.includes("straße") || text.includes("str.") || text.includes("schule")) {
      risks.push("privacy.address");
    }

    /* Watermark-Filter: Stockfoto-Anbieter sollen NICHT als Telefon-Risiko gelten.
       Seit 2026-08-17 auch die EIGENE KI-Kennzeichnung: Sie ist in die Demo-Fotos
       gebrannt (Pflicht nach Art. 50 EU-KI-Verordnung) und damit fuer das Modell
       sichtbarer Text wie jeder andere. Der Prompt weist sie bereits ab; dies ist
       der zweite Riegel, falls das Modell sie doch meldet. */
    const isWatermark = /shutterstock|getty|istock|depositphotos|alamy|ki erstellt|ai generated|ki-generiert/i.test(
      text
    );
    if (!isWatermark && (/\b\d{2,3}[\s/-]?\d{6,8}\b/.test(text) || /\b0\d{2,4}[\s/-]?\d{5,8}\b/.test(text))) {
      risks.push("privacy.phone");
    }
  }

  /* Kfz-Kennzeichen: deutsches/österreichisches Format, z.B. "M-AB 1234".
     Das Muster ist spezifisch genug, dass es gefahrlos über die GANZE
     Beschreibung laufen kann — fängt damit auch Kennzeichen, die Mistral nur
     im Fließtext erwähnt statt im sichtbaren Text. */
  const plateScan = `${fullDescription || ""}\n${visibleText || ""}`;
  if (/\b[a-zäöü]{1,3}-[a-zäöü]{1,2} \d{1,4}\b/i.test(plateScan)) {
    risks.push("privacy.licensePlate");
  }

  return risks;
}

module.exports = { buildPrivacyRisks };
