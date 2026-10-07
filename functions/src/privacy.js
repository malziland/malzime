"use strict";

/**
 * privacy.js — OCR-basierte Datenschutz-Risiko-Erkennung.
 *
 * Der OCR-Text kommt aus dem Feld `visible_text` der KI-Antwort;
 * job-pipelines.js reicht den Wert des Feldes herein. Ausgewertet wird nur
 * dieses Feld — eine Zeile "Sichtbarer Text:" im Profiltext zaehlt nicht.
 *
 * Erkannt werden:
 *   - Adressen (Straßennamen deutsch, österreichisch und englisch, Schulen) —
 *     nur aus dem sichtbaren Text
 *   - Telefonnummern, am Stück oder in Zifferngruppen (mit Filter gegen
 *     Stockfoto-Wasserzeichen) — dito
 *   - Kfz-Kennzeichen (deutsches/österreichisches Format) — aus der GANZEN
 *     Beschreibung, weil das Muster spezifisch genug für False-Positive-Freiheit ist
 */

/* Woran der sichtbare Text eine Adresse oder einen Schulbezug verraet. Was
   auf dem Foto steht, haengt nicht an der Sprache der Seite: Die Liste kennt
   deutsche, oesterreichische und englische Formen (BUG-2026-10-03-06).
   Verglichen wird klein geschrieben; "STRASSE" auf einem Schild wird so zu
   "strasse". */
const ADRESS_WOERTER = ["straße", "strasse", "str.", "schule", "gymnasium"];

/* Strassenwoerter, die auch in Alltagswoertern oder Aufdrucken stecken
   ("unterwegs", "Sportplatz", "Platz 3", "Streetwear", "Street Food"), zaehlen
   nur zusammen mit einer Hausnummer. */
const ADRESS_MUSTER = [
  /* Mozartgasse 3 · Linzer Weg 7 · Hauptplatz 3 */
  /(?:gasse|weg|\p{L}platz)\s+\d{1,4}(?!\d)/u,
  /* 12 Main Street · 45 Elm Road · 3 Park Avenue */
  /(?<![\p{L}\d])\d{1,5}[a-z]?\s+(?:[\p{L}'.-]+\s+){1,2}(?:street|road|avenue)(?!\p{L})/u,
  /* Mill Road 12 */
  /(?<!\p{L})(?:street|road|avenue)\s+\d{1,5}(?!\d)/u,
  /* Springfield Elementary School · Oxford High School. "school" allein
     zaehlt nicht: Es steht als Aufdruck auf Kleidung ("Old School",
     "Back to School"); "High School Musical" ist ein Filmtitel. */
  /(?<!\p{L})(?:elementary|primary|middle|high|grammar|secondary|public|community|international)\s+school(?!\p{L})(?!\s+musical)/u,
];

/* Telefonnummern in Zifferngruppen: 0664 123 45 67 · +43 (0)664 123 45 67 ·
   (555) 123-4567. Eine Gruppe hat mindestens zwei Ziffern (ein Lineal
   "0 1 2 3" ist keine Nummer), die ganze Nummer 9 bis 15 (ein Datum hat
   weniger, eine Kontonummer mehr), und sie beginnt nicht mitten in einer
   laengeren Ziffernfolge. */
const TELEFON_IN_GRUPPEN = [
  /(?<![\d.,]|\d[\s/-])0\d{1,4}(?:[\s/-]\d{2,8}){2,5}(?!\d)/g,
  /\+\d{1,3}(?:[\s/-]?\(?\d{1,5}\)?){2,6}(?!\d)/g,
  /\(\d{2,5}\)\s?\d{2,4}(?:[\s/-]\d{2,4}){1,3}(?!\d)/g,
];
function hatTelefonInGruppen(text) {
  return TELEFON_IN_GRUPPEN.some((muster) =>
    (text.match(muster) || []).some((treffer) => {
      const ziffern = treffer.replace(/\D/g, "").length;
      return ziffern >= 9 && ziffern <= 15;
    })
  );
}

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
    if (ADRESS_WOERTER.some((wort) => text.includes(wort)) || ADRESS_MUSTER.some((muster) => muster.test(text))) {
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
    if (
      !isWatermark &&
      (/\b\d{2,3}[\s/-]?\d{6,8}\b/.test(text) || /\b0\d{2,4}[\s/-]?\d{5,8}\b/.test(text) || hatTelefonInGruppen(text))
    ) {
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
