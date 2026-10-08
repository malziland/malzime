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
  /* Mozartgasse 3 · Linzer Weg 7 · Hauptplatz 3 · Praterallee 1 · Kärntner
     Ring 12 · Dr.-Karl-Renner-Ring 3 · Handelskai 94 · Franz-Josefs-Kai 27 ·
     Linke Wienzeile 4.
     "Ring", "Kai" und "Zeile" stecken in zu vielen anderen Woertern und
     zaehlen deshalb nur in engen Formen: "Ring" als eigenes Wort hinter einem
     Namen auf "-er" oder hinter einem Bindestrich; "Kai" hinter einem
     Bindestrich oder als Ende eines laengeren Worts; von "Zeile" nur die
     Wienzeile. Kein Strassenname: SPRING 2025, ENGINEERING 1985, Hering 3,50,
     Schlagzeile 1, AKAI 4000, KAI 12, Sitzplatz 12, Parkplatz 2, Wanderweg 601.
     BEWUSST NICHT: zusammengeschriebene Ring-Namen ("Opernring 2") — sie sind
     von "Spring 24" und "Touring 500" nicht zu unterscheiden.
     Jede Alternative beginnt an einem festen Wort; die Bedingung davor steht
     in einer Rueckschau fester Laenge. So rechnet das Muster auch ueber eine
     endlose Buchstabenkette nur einmal je Stelle. */
  /(?:gasse|(?<!wander|rad|rund|lehr|pilger|reit|höhen|hoehen)weg|\p{L}(?<!sitz|park|steh|stell|start|liege|camping|lager)platz|(?<=\p{L}{3}er |\p{L}{3}-)ring|allee|wienzeile|(?<=\p{L}{3}|-)kai)\s+\d{1,4}(?!\d)/u,
  /* 12 Main Street · 45 Elm Road · 3 Park Avenue · 12 Main St. · 45 Elm Rd. ·
     3 Park Ave. · 45 Elm Rd. Apt 3 — die Abkuerzung nur mit Punkt und nur
     hinter Hausnummer und Name. "St." zaehlt nur, wenn kein Wort folgt: In
     oesterreichischen Texten ist es fast immer Sankt ("12 Monkeys St. Pauli",
     "3 km St. Pölten"). BEWUSST NICHT deshalb: "12 Main St. Springfield". */
  /(?<![\p{L}\d])\d{1,5}[a-z]?\s+(?:[\p{L}'.-]+\s+){1,2}(?:street|road|avenue|st\.(?!\s*\p{L})|(?:rd|ave)\.)(?!\p{L})/u,
  /* Mill Road 12 */
  /(?<!\p{L})(?:street|road|avenue)\s+\d{1,5}(?!\d)/u,
  /* Springfield Elementary School · Oxford High School. "school" allein
     zaehlt nicht: Es steht als Aufdruck auf Kleidung ("Old School",
     "Back to School"); "High School Musical" ist ein Filmtitel. */
  /(?<!\p{L})(?:elementary|primary|middle|high|grammar|secondary|public|community|international)\s+school(?!\p{L})(?!\s+musical)/u,
];

/* Schulformen, die in Oesterreich als Kuerzel auf Schulkleidung und Schildern
   stehen ("HTL Mödling", "HTL-Mödling", "HAK/HAS Wien", "BHAK Wien 10").
   Verglichen wird am Original, nicht klein geschrieben: als ganzes Wort in
   Grossbuchstaben, und nur mit einem Ort oder einer Zahl dahinter (nach
   Leerraum oder Bindestrich) — das Kuerzel allein steht auch auf
   Markenkleidung ("BORG"). "BORG" zaehlt nie hinter "BJÖRN", auch nicht ueber
   einen Zeilenumbruch. */
const SCHUL_KUERZEL =
  /(?<![\p{L}\d])(?:HTL|HAK|HLW|HBLA|NMS|BHAK|BHAS|HTBLA|HTBLuVA|HTBLVA|BRG|(?<!BJ[ÖO]RN\s{1,3})BORG)(?:\/(?:HAS|HAK|BHAS|BHAK))?(?:\s+|-)(?:\p{Lu}\p{L}+|\d{1,4}(?!\d))/u;

/* Kfz-Kennzeichen. Die Muster laufen ueber die ganze Beschreibung und muessen
   deshalb eng sein.
   - deutsches Format und Wunschkennzeichen mit ein bis zwei Buchstaben:
     M-AB 1234. Zwei Wochentage mit Bindestrich sind Oeffnungszeiten ("MO-FR
     08-12"), "Kfz-Nr 12" ist eine Nummer — beides kein Kennzeichen.
   - oesterreichisches Regelformat (Bezirk, Bindestrich, Ziffern, Buchstaben),
     nur in Grossbuchstaben, damit Prosa nicht trifft: W-12345 X, GU-123 AB,
     L-1234A, WU-47 XY. Ein einzelner Bezirksbuchstabe braucht mindestens drei
     Ziffern — sonst traefe "U-21 EM".
   BEWUSST NICHT: dieselbe Form mit Leerzeichen statt Bindestrich ("W 12345
     X"). Sie ist von Aufdrucken und Etiketten nicht zu unterscheiden ("NY
     1984 USA", "EU 164 CM"). Ebenso Wunschkennzeichen mit drei und mehr
     Buchstaben ("W-MAX 1") — das Muster traefe "T-SHIRT 2". */
const WOCHENTAG = "(?:mo|di|mi|do|fr|sa|so|mon|tue|wed|thu|fri|sat|sun)";
const KENNZEICHEN = [
  new RegExp(`\\b(?!${WOCHENTAG}-${WOCHENTAG}\\b)[a-zäöü]{1,3}-(?!nr\\b)[a-zäöü]{1,2} \\d{1,4}\\b`, "i"),
  /(?<![\p{L}\d-])(?:[A-ZÄÖÜ]-\d{3,5}|[A-ZÄÖÜ]{2}-\d{1,5}) ?[A-Z]{1,3}(?![\p{L}\d])/u,
];

/* Festnetz mit Schraegstrich und Durchwahl, wie es auf Firmen- und
   Schulschildern steht: 01/58858-0 · 0732 / 77 20-0. Die Durchwahl gehoert
   dazu — ohne sie waere "03/2026" (ein Monat) eine Nummer —, und die Nummer
   davor hat fuenf Ziffern oder Gruppen ("03/2026-04" ist eine Heftnummer). */
const FESTNETZ_MIT_DURCHWAHL = /(?<![\d/.-])0\d{1,4}\s?\/\s?(?:\d{5,10}|\d{2,4}(?: \d{2,4}){1,3})-\d{1,4}(?![\d-])/;

/* Telefonnummern in Zifferngruppen: 0664 123 45 67 · +43 (0)664 123 45 67 ·
   (555) 123-4567. Eine Gruppe hat mindestens zwei Ziffern (ein Lineal
   "0 1 2 3" ist keine Nummer), die ganze Nummer 9 bis 15 (ein Datum hat
   weniger, eine Kontonummer mehr), und sie beginnt nicht mitten in einer
   laengeren Ziffernfolge. */
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
       Telefonnummer ("978-3-16-148410-0") — und es verlangt ein Trennzeichen:
       Eine blosse Ziffernfolge ist ebenso gut ein Datum oder ein Strichcode
       ("20261007"). Am Stueck zaehlt eine Nummer nur mit fuehrender Null
       (zweites Muster). */
    if (
      !isWatermark &&
      (/(?<!\d-)\b\d{2,3}[\s/-]\d{6,8}\b(?!-\d)/.test(text) ||
        /\b0\d{2,4}[\s/-]?\d{5,8}\b/.test(text) ||
        hatTelefonInGruppen(text) ||
        FESTNETZ_MIT_DURCHWAHL.test(text))
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
