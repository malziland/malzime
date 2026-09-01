"use strict";

/**
 * mistral-antwort.js — Antworten der KI auseinandernehmen.
 *
 * HERAUSGELOEST AUS mistral.js am 31.08.2026. Grund: Die Datei war auf 1681
 * Zeilen gewachsen und vermischte vier Dinge — mit Mistral reden, die Antwort
 * zerlegen, den Ein-Aufruf-Weg, den Drei-Aufruf-Weg. Wer eine Zeile im Parser
 * aendert, musste die ganze Datei lesen.
 *
 * Hier stehen ausschliesslich REINE FUNKTIONEN: Text rein, Daten raus. Kein
 * Netz, keine Zeitgrenzen, kein Zustand. Genau deshalb lassen sie sich als
 * Erstes trennen — sie haengen an nichts.
 */

/* Die Schluessel, nach denen im angefangenen JSON gesucht wird. Sie stehen
   hier und nicht beim Aufrufer: Sie beschreiben das FORMAT der Antwort, und
   das Format auseinanderzunehmen ist die Aufgabe dieser Datei. */
const PROFILE_TEXT_SCHLUESSEL = '"profileText"';
/* FEATURE-2026-08-29-01: Unter jedem Kartenschluessel steht der Text in `value`. */
const KARTEN_WERT_SCHLUESSEL = '"value"';
const KARTEN_LABEL_SCHLUESSEL = '"label"';

/**
 * Sucht ab `abIdx` das NAECHSTE `"profileText"`-Vorkommen im JSON-Praefix und
 * scannt dessen String-Wert escape-bewusst bis zum letzten KOMPLETT
 * angekommenen Zeichen. Ein Vorkommen — eine geprüfte Escape-Behandlung:
 * extrahiereLiveText ruft diese Funktion fuer das erste UND das zweite Feld,
 * statt den Scanner zu duplizieren.
 *
 * Rueckgabe:
 *   - `null`, solange der Wert noch nicht begonnen hat (Schluessel fehlt oder
 *     das oeffnende `"` ist noch nicht da),
 *   - sonst `{ text, schluesselIdx, ende, abgeschlossen }`:
 *       text          DEKODIERTER Klartext (JSON-Escapes wie \n, \" oder
 *                     \uXXXX sind zu echten Zeichen aufgeloest). Ein
 *                     UNVOLLSTAENDIGES Escape am Praefix-Ende (z.B. `\` oder
 *                     `\u00`) wird abgeschnitten — lieber ein Zeichen zu
 *                     wenig zeigen als kaputte Reste.
 *       schluesselIdx Index des gefundenen `"profileText"`-Schluessels —
 *                     der Verankerungs-Pruefpunkt (KA-11): Der Aufrufer
 *                     stellt damit sicher, dass zwischen Modus-Schluessel
 *                     und Fund kein ANDERER Modus-Schluessel liegt.
 *       ende          Index des schliessenden `"` (bzw. Praefix-Ende) — der
 *                     Startpunkt fuer die Suche nach dem naechsten Vorkommen.
 *       abgeschlossen true, wenn das schliessende `"` schon angekommen ist.
 */
function findeProfileTextWert(jsonPraefix, abIdx, schluessel = PROFILE_TEXT_SCHLUESSEL) {
  const schluesselIdx = jsonPraefix.indexOf(schluessel, abIdx);
  if (schluesselIdx < 0) return null;

  /* Nach dem Schluessel muss `: "` folgen (beliebiger Whitespace erlaubt).
     Solange das oeffnende Anfuehrungszeichen nicht da ist, hat der Wert nicht
     begonnen — dann gibt es auch nichts zu zeigen. */
  const nachSchluessel = jsonPraefix.slice(schluesselIdx + schluessel.length);
  const wertBeginn = nachSchluessel.match(/^\s*:\s*"/);
  if (!wertBeginn) return null;
  const start = schluesselIdx + schluessel.length + wertBeginn[0].length;

  /* Escape-bewusster Scan bis zum letzten KOMPLETT angekommenen Zeichen.
     Ein rohes `"` ohne fuehrenden Backslash beendet den Wert; `\X` sind zwei
     Zeichen, `\uXXXX` sechs. Bricht der Praefix mitten in einem Escape ab,
     endet der brauchbare Teil VOR dem Backslash. */
  let i = start;
  let ende = jsonPraefix.length; /* Praefix endet mitten im Wert (Normalfall) */
  let abgeschlossen = false;
  while (i < jsonPraefix.length) {
    const zeichen = jsonPraefix[i];
    if (zeichen === '"') {
      ende = i; /* unescaptes Ende — der Wert ist komplett angekommen */
      abgeschlossen = true;
      break;
    }
    if (zeichen === "\\") {
      if (i + 1 >= jsonPraefix.length) {
        ende = i; /* nackter Backslash am Ende → unvollstaendig, abschneiden */
        break;
      }
      if (jsonPraefix[i + 1] === "u") {
        if (i + 6 > jsonPraefix.length) {
          ende = i; /* \uXX… ohne alle vier Hex-Ziffern → abschneiden */
          break;
        }
        i += 6;
        continue;
      }
      i += 2; /* zweistelliges Escape wie \" \\ \n — komplett da */
      continue;
    }
    i += 1;
  }

  return { text: dekodiereJsonEscapes(jsonPraefix.slice(start, ende)), schluesselIdx, ende, abgeschlossen };
}

function dekodiereJsonEscapes(roh) {
  const einfacheEscapes = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
  let klartext = "";
  for (let i = 0; i < roh.length; i++) {
    const zeichen = roh[i];
    if (zeichen !== "\\") {
      klartext += zeichen;
      continue;
    }
    const naechstes = roh[i + 1];
    if (naechstes === "u") {
      const code = parseInt(roh.slice(i + 2, i + 6), 16);
      if (Number.isFinite(code)) {
        /* fromCharCode arbeitet auf UTF-16-Einheiten: zwei aufeinander
           folgende \uXXXX-Escapes eines Emojis ergeben so automatisch das
           richtige Surrogat-Paar. */
        klartext += String.fromCharCode(code);
        i += 5;
      } else {
        i += 1; /* kaputtes Escape — still ueberspringen statt werfen */
      }
      continue;
    }
    if (naechstes !== undefined && einfacheEscapes[naechstes] !== undefined) {
      klartext += einfacheEscapes[naechstes];
      i += 1;
      continue;
    }
    if (naechstes !== undefined) {
      klartext += naechstes; /* unbekanntes Escape: Zeichen woertlich uebernehmen */
      i += 1;
    }
  }
  /* Endet der Text mit einer einsamen hohen Surrogathälfte (halbes Emoji aus
     einem \uXXXX-Paar, dessen zweite Haelfte noch unterwegs ist), schneiden
     wir sie ab — sonst landet ein kaputtes Zeichen im Live-Text. */
  return klartext.replace(/[\uD800-\uDBFF]$/, "");
}

/* ── Footer-Parser (v2.1) ──
   Extrahiert die strukturierten Anker-Blöcke (HARD_FACTS, ADS, TRIGGERS) am Ende
   der Bildbeschreibung. Diese werden vom Describe-Prompt (mistralDescribeAddendum)
   eingeleitet und liefern beide Profile-Calls einen konsistenten Anker:
     - alter_geschlecht + herkunft werden wortgenau übernommen → Normal/Beast-Konsistenz
     - ads + triggers werden zentral am Job-Result gesetzt → identisch in beiden Modi

   Fallback-Verhalten: Wenn ein Block fehlt oder kaputt ist, gibt der Parser leere
   Defaults zurück — handle-process-job.js entscheidet dann, ob die Profile-Calls
   diese Felder ersatzweise selbst füllen müssen (alter Verhalten). */
function parseDescribeFooter(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { description: "", hardFacts: {}, ads: [], triggers: [] };
  }

  /* Wir splitten den Text in Description + Footer. Marker ist das erste
     Auftreten von "HARD_FACTS:" am Zeilenanfang (case-sensitive — Mistral hält
     sich an den exakten Marker). */
  const hardFactsIdx = text.search(/(^|\n)HARD_FACTS:/);
  if (hardFactsIdx < 0) {
    /* Kein Footer gefunden — alter Live-Stil oder Mistral hat sich nicht ans
       Format gehalten. Beschreibung bleibt der ganze Text, Anker leer. */
    return { description: text.trim(), hardFacts: {}, ads: [], triggers: [] };
  }

  const description = text.slice(0, hardFactsIdx).trim();
  const footer = text.slice(hardFactsIdx);

  /* Hard-Facts-Block parsen — nur die zwei fixierten Felder. */
  const hardFacts = {};
  const hfBlock = (footer.match(/HARD_FACTS:\s*([\s\S]*?)(?:\n\s*(?:ADS:|TRIGGERS:)|$)/) || ["", ""])[1];
  for (const line of hfBlock.split(/\n/)) {
    const m = line.match(/^\s*(alter_geschlecht|herkunft)\s*:\s*(.+?)\s*$/i);
    if (m) hardFacts[m[1].toLowerCase()] = m[2].trim();
  }

  /* ADS-Block: jede nicht-leere Zeile nach "ADS:" bis vor "TRIGGERS:" ist ein Eintrag. */
  const ads = [];
  const adsBlock = (footer.match(/ADS:\s*([\s\S]*?)(?:\n\s*TRIGGERS:|$)/) || ["", ""])[1];
  for (const raw of adsBlock.split(/\n/)) {
    const v = raw.trim();
    if (v && !v.startsWith("<") && v.length <= 60) ads.push(v);
  }

  /* TRIGGERS-Block: jede nicht-leere Zeile nach "TRIGGERS:" bis Ende. */
  const triggers = [];
  const trBlock = (footer.match(/TRIGGERS:\s*([\s\S]*)$/) || ["", ""])[1];
  for (const raw of trBlock.split(/\n/)) {
    const v = raw.trim();
    if (v && !v.startsWith("<") && v.length <= 250) triggers.push(v);
  }

  return { description, hardFacts, ads: ads.slice(0, 12), triggers: triggers.slice(0, 8) };
}

/* NUR was ausserhalb gebraucht wird. `dekodiereJsonEscapes` und
   `PROFILE_TEXT_SCHLUESSEL` sind hausintern — sie standen hier, weil sie beim
   Herausloesen mitgewandert sind, und niemand hat sie je von aussen gerufen.
   Ein Export ohne Nutzer ist ein Versprechen, das nichts einloest: Er sieht
   nach oeffentlicher Schnittstelle aus und bindet damit die Freiheit, das
   Innere zu aendern. (Gefunden 31.08.2026 beim Abgleich gegen den Code —
   nicht gegen eine Liste.) */

/* HERGEZOGEN AUS mistral.js am 31.08.2026: Diese Liste beschreibt, welche
   Karten eine vollstaendige Antwort enthalten muss — also das FORMAT der
   Antwort. Beide Seiten brauchen sie: das Parsing, um die Karten zu finden,
   und der Aufrufer, um fehlende nachzufordern. Sie steht deshalb hier und
   wird exportiert, statt an zwei Stellen zu leben. */
const REQUIRED_CARDS = [
  "alter_geschlecht",
  "herkunft",
  "einkommen",
  "bildung",
  "beziehungsstatus",
  "interessen",
  "persoenlichkeit",
  "charakterzuege",
  "politisch",
  "gesundheit",
  "kaufkraft",
  "verletzlichkeit",
  "werbeprofil",
];

/* ── Live-Text und Karten aus dem laufenden Strom ─────────────────────────
   HERGEZOGEN AUS mistral.js am 31.08.2026, zweiter Schnitt.

   Das ist Parsing, kein Netzzugriff: Aus dem bisher angekommenen JSON-Praefix
   wird gelesen, was schon lesbar ist — waehrend die KI noch schreibt. Die
   Aufrufer stehen in der HTTP-Schicht, aber die Arbeit gehoert hierher. */

const STANDARD_SCHLUESSEL = '"standard"';

const BEAST_SCHLUESSEL = '"beast"';

function extrahiereKarten(jsonPraefix, vonIdx, bisIdx) {
  if (typeof jsonPraefix !== "string" || vonIdx < 0) return [];
  const bereich = bisIdx > vonIdx ? jsonPraefix.slice(0, bisIdx) : jsonPraefix;
  const fertige = [];
  for (const schluessel of REQUIRED_CARDS) {
    const marke = `"${schluessel}"`;
    const idx = bereich.indexOf(marke, vonIdx);
    if (idx < 0) continue;
    /* Das Schema legt `label` VOR `value` — beide muessen komplett sein, sonst
       stuende eine Karte ohne Beschriftung oder mit halbem Satz da. */
    const bezeichnung = findeProfileTextWert(bereich, idx, KARTEN_LABEL_SCHLUESSEL);
    if (!bezeichnung || !bezeichnung.abgeschlossen || !bezeichnung.text) continue;
    const wert = findeProfileTextWert(bereich, idx, KARTEN_WERT_SCHLUESSEL);
    if (!wert || !wert.abgeschlossen || !wert.text) continue;
    /* Liegt zwischen dem Kartenschluessel und dem gefundenen `"value"` ein
       ANDERER Kartenschluessel, gehoert der Wert zur naechsten Karte — diese
       hier hat dann selbst noch keinen. Dieselbe Verankerung wie bei
       standard/beast, nur eine Ebene tiefer. */
    const dazwischen = bereich.slice(idx + marke.length, wert.schluesselIdx);
    if (REQUIRED_CARDS.some((k) => k !== schluessel && dazwischen.includes(`"${k}"`))) continue;
    fertige.push({ schluessel, bezeichnung: bezeichnung.text, wert: wert.text });
  }
  return fertige;
}

function extrahiereLiveText(jsonPraefix) {
  /* Dieselbe Form wie im Normalfall — ein Aufrufer, der `kartenStandard.length`
     liest, darf hier nicht ueber `undefined` stolpern. */
  if (typeof jsonPraefix !== "string") return { standard: null, beast: null, kartenStandard: [], kartenBeast: [] };

  const standardIdx = jsonPraefix.indexOf(STANDARD_SCHLUESSEL);
  const beastIdx = jsonPraefix.indexOf(BEAST_SCHLUESSEL);

  /* Standard: erst ab dem eigenen Modus-Schluessel suchen — ein profileText
     VOR `"standard"` kann nie das Standard-Profil sein. Liegt zwischen dem
     Schluessel und dem Fund ein `"beast"`, gehoert der Fund zum Beast-Block
     (Standard hat dann selbst noch keinen profileText geliefert). */
  let erster = standardIdx >= 0 ? findeProfileTextWert(jsonPraefix, standardIdx) : null;
  if (erster) {
    const beastDazwischen = jsonPraefix.indexOf(BEAST_SCHLUESSEL, standardIdx + 1);
    if (beastDazwischen >= 0 && beastDazwischen < erster.schluesselIdx) erster = null;
  }

  /* Beast: symmetrisch verankert. */
  let zweiter = null;
  if (beastIdx >= 0) {
    const kandidat = findeProfileTextWert(jsonPraefix, beastIdx);
    if (kandidat) {
      const standardDazwischen = jsonPraefix.indexOf(STANDARD_SCHLUESSEL, beastIdx + 1);
      if (!(standardDazwischen >= 0 && standardDazwischen < kandidat.schluesselIdx)) zweiter = kandidat;
    }
  }

  /* FEATURE-2026-08-29-01: Karten additiv dazu. `standard` und `beast` bleiben
     unveraendert — alte Aufrufer merken nichts. */
  const standardBis = beastIdx > standardIdx ? beastIdx : -1;
  return {
    standard: erster ? erster.text : null,
    beast: zweiter ? zweiter.text : null,
    kartenStandard: extrahiereKarten(jsonPraefix, standardIdx, standardBis),
    kartenBeast: extrahiereKarten(jsonPraefix, beastIdx, -1),
  };
}

/* HERGEZOGEN 31.08.2026: Welche Karten in einer Antwort fehlen — das ist
   Auswertung, und beide Wege (Ein-Aufruf und Drei-Aufruf) brauchen sie. */
function findMissingCards(parsed) {
  if (!parsed || !parsed.categories || typeof parsed.categories !== "object") {
    return REQUIRED_CARDS.slice();
  }
  return REQUIRED_CARDS.filter((key) => !parsed.categories[key] || !parsed.categories[key].value);
}

/* HERGEZOGEN 31.08.2026: Ein reines Textwerkzeug — es sichert Text ab, bevor
   er in einen Prompt geht, damit ein Foto-Text nicht wie eine Anweisung an die
   KI aussieht. Beide Wege brauchen es (Ein-Aufruf und Drei-Aufruf), es gehoert
   also keinem von beiden. Diese Datei ist der Ort fuer Funktionen, die nur
   Text verarbeiten und sonst nichts. */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = {
  findeProfileTextWert,
  parseDescribeFooter,
  extrahiereLiveText,
  KARTEN_WERT_SCHLUESSEL,
  KARTEN_LABEL_SCHLUESSEL,
  STANDARD_SCHLUESSEL,
  BEAST_SCHLUESSEL,
  REQUIRED_CARDS,
  findMissingCards,
  escapeXml,
};
