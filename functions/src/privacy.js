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
 *   - Kfz-Kennzeichen (deutsches Format, österreichisches Regel- und
 *     Wunschformat) — aus der GANZEN Beschreibung, weil die Muster spezifisch
 *     genug für False-Positive-Freiheit sind
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
  /* 12 Main Street · 45 Elm Road · 3 Park Avenue · 12 Main St. · 45 Elm Rd. ·
     3 Park Ave. — die Abkuerzung nur mit Punkt und nur hinter Hausnummer und
     Name ("St" ohne Punkt steht auf zu vielen Aufdrucken). */
  /(?<![\p{L}\d])\d{1,5}[a-z]?\s+(?:[\p{L}'.-]+\s+){1,2}(?:street|road|avenue|st\.|rd\.|ave\.)(?!\p{L})/u,
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
/* Schulformen, die in Oesterreich als Kuerzel auf Schulkleidung und Schildern
   stehen ("HTL Mödling", "HAK Bregenz"). Verglichen wird am Original, nicht
   klein geschrieben: als ganzes Wort in Grossbuchstaben. */
const SCHUL_KUERZEL = /(?<![\p{L}\d])(?:HTL|HAK|HLW|HBLA|NMS|BORG|BRG)(?![\p{L}\d])/u;

/* Kfz-Kennzeichen. Verglichen wird am Original (Grossbuchstaben), damit Prosa
   nicht trifft ("am 12 uhr").
   - deutsches Format und oesterreichisches Wunschkennzeichen: M-AB 1234
   - oesterreichisches Regelformat (Bezirk, Ziffern, Buchstaben): W-12345 X,
     GU-123 AB, L-1234A. Mit Bindestrich ab zwei Ziffern; mit Leerzeichen oder
     Mittelpunkt statt Bindestrich erst ab drei Ziffern — sonst traefe ein
     Groessen-Etikett ("EU 42 UK"). */
const KENNZEICHEN = [
  /\b[a-zäöü]{1,3}-[a-zäöü]{1,2} \d{1,4}\b/i,
  /(?<![\p{L}\d-])[A-ZÄÖÜ]{1,2}-\d{2,5} ?[A-Z]{1,3}(?![\p{L}\d])/u,
  /(?<![\p{L}\d-])[A-ZÄÖÜ]{1,2}[ ·]\d{3,5} ?[A-Z]{1,3}(?![\p{L}\d])/u,
];

const TELEFON_IN_GRUPPEN = [
  /(?<![\d.,]|\d[\s/-])0\d{1,4}(?:[\s/-]\d{2,8}){2,5}(?!\d)/g,
  /\+\d{1,3}(?:[\s/-]?\(?\d{1,5}\)?){2,6}(?!\d)/g,
  /\(\d{2,5}\)\s?\d{2,4}(?:[\s/-]\d{2,4}){1,3}(?!\d)/g,
  /* 555-123-4567 (nordamerikanisch, ohne Klammern) */
  /(?<![\d-])\d{3}-\d{3}-\d{4}(?![\d-])/g,
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
    if (
      ADRESS_WOERTER.some((wort) => text.includes(wort)) ||
      ADRESS_MUSTER.some((muster) => muster.test(text)) ||
      SCHUL_KUERZEL.test(visibleText)
    ) {
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
    /* Das erste Muster trifft nicht mitten in einer laengeren, mit Bindestrichen
       gegliederten Nummer — sonst waere eine ISBN auf einem Buchruecken eine
       Telefonnummer ("978-3-16-148410-0"). */
    if (
      !isWatermark &&
      (/(?<!\d-)\b\d{2,3}[\s/-]?\d{6,8}\b(?!-\d)/.test(text) ||
        /\b0\d{2,4}[\s/-]?\d{5,8}\b/.test(text) ||
        hatTelefonInGruppen(text))
    ) {
      risks.push("privacy.phone");
    }
  }

  /* Kfz-Kennzeichen (Muster oben): spezifisch genug, dass sie gefahrlos über
     die GANZE Beschreibung laufen können — fängt damit auch Kennzeichen, die
     Mistral nur im Fließtext erwähnt statt im sichtbaren Text. */
  const plateScan = `${fullDescription || ""}\n${visibleText || ""}`;
  if (KENNZEICHEN.some((muster) => muster.test(plateScan))) {
    risks.push("privacy.licensePlate");
  }

  return risks;
}

module.exports = { buildPrivacyRisks };
