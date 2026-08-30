"use strict";

/**
 * mistral.js — Mistral-Anbieter (einziger KI-Anbieter seit v1.6.0).
 *
 *   - describeImage(buffer, mimeType, remainingBudget, lang) → text | null
 *   - generateBothProfiles(description, exif, remainingBudget, lang) → { normal, boost }
 *
 * Architektur:
 *   - Describe: Mistral Large 3 (multimodal, sieht das Bild direkt)
 *   - Normal/Boost: Mistral Small 4 (text-only, schneller + billiger)
 *   - Fallback pro Profil: Large 3, falls Small 4 nicht parsebares JSON liefert
 *
 * API-Key kommt aus process.env.MISTRAL_API_KEY (Firebase Secret).
 */

const { MISTRAL_DESCRIBE_MODEL, MISTRAL_PROFILE_MODEL, MISTRAL_FALLBACK_MODEL, MISTRAL_ENDPOINT } = require("./config");
/* Betriebsprofil: liefert die geltenden Werte (Firestore-Profil oder Code). */
const { geltendeWerte } = require("./betriebsprofil");
const { loadPrompts } = require("./i18n");
const { parseSafely, STRING_BOUND_CATEGORY } = require("./json-repair");
const { withMistralSlot } = require("./throttle");
/* AUFGETEILT 31.08.2026: Das Auseinandernehmen der Antworten steht jetzt in
   einer eigenen Datei — reine Funktionen, kein Netz, kein Zustand. */
const {
  findeProfileTextWert,
  parseDescribeFooter,
  KARTEN_WERT_SCHLUESSEL,
  KARTEN_LABEL_SCHLUESSEL,
} = require("./mistral-antwort");

/* Wird beim Modul-Load via env-Variable gelesen. NICHT hartcodiert. */
function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    const e = new Error("MISTRAL_API_KEY environment variable not set");
    e.code = "no_api_key";
    throw e;
  }
  return key;
}

/* Für Tests: erlaubt fetch zu mocken ohne globalThis zu überschreiben. */
let fetchImpl = (...args) => fetch(...args);
function setFetchForTest(impl) {
  fetchImpl = impl || ((...args) => fetch(...args));
}

/* ── Rate-Limit-Detection (für Telemetrie + Fallback-Entscheidung) ── */

function isRateLimitError(err) {
  /* v1.10.6: Throttle-Queue-Timeout wird auch als Rate-Limit-Signal behandelt.
     Wenn unsere eigene Drossel in throttle.js auflaeuft, ist Mistral aus
     Pipeline-Sicht ueberlastet — Der Aufrufer soll das als
     blocked.overloaded melden, damit der Client den Auto-Retry triggert. */
  if (err && err.code === "throttle_timeout") return true;
  const msg = (err.message || "").toLowerCase();
  return err.status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limited");
}

/* ── Low-Level: HTTP-Call mit Timeout + Retry bei 429 ── */

/* REL-01: Jeder Mistral-HTTP-Call läuft durch die Per-Instance-Semaphore aus
   throttle.js. Damit kann eine einzelne Cloud-Function-Instanz bei einem
   Workshop-Burst (viele gleichzeitige Uploads, je 3 Mistral-Calls) nicht mehr
   beliebig viele Requests gleichzeitig gegen Mistrals RPS-Limit feuern —
   überzählige Calls warten geordnet auf einen freien Slot, statt sofort 429 zu
   kassieren. Der Slot wird über die kompletten 429-Retry-Backoffs gehalten,
   was den Burst zusätzlich entzerrt.

   v1.10.8: modelClass ("large"/"small") wird an withMistralSlot durchgereicht,
   damit der modell-bewusste Token-Bucket den richtigen Rate-Bucket waehlt
   (Large-Bucket taktet schneller als Small — Details und die heutige
   Tier-Wahrheit: throttle.js-Kopf, KA-07). */
function modelClassOf(model) {
  return /large/i.test(model || "") ? "large" : "small";
}

/* v2.5: Wie viele Eingabe-Tokens kamen aus dem Prompt-Cache (10% Preis statt
   100%)? Das ist die einzige belastbare Erfolgskontrolle fuers Caching — ohne
   diese Zahl waere die Ersparnis Behauptung statt Messung.
   Defensiv gegen mehrere Feldnamen: Mistral folgt weitgehend der
   OpenAI-Konvention (`prompt_tokens_details.cached_tokens`), garantiert das
   aber nicht vertraglich. Unbekanntes Feld => 0, nie ein Fehler. */
function readCachedTokens(usage) {
  const candidates = [
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
  ];
  const hit = candidates.find((v) => typeof v === "number");
  return hit || 0;
}

/* ── v3.0 Phase 1: Live-Text-Strom ────────────────────────────────────────
   Wird ein `onLiveText`-Callback uebergeben, laeuft der Mistral-Aufruf mit
   `stream: true` und wir lesen die Antwort als Server-Sent-Events mit. Der
   zurueckgegebene `result.text` ist BYTE-IDENTISCH zu dem, was der
   Nicht-Stream-Pfad liefern wuerde — json-repair & Co. laufen unveraendert
   erst am Ende auf dem Gesamtstring. Der einzige Zusatz: Waehrend die Antwort
   eintrifft, werden periodisch die bereits VOLLSTAENDIG angekommenen Teile
   BEIDER `profileText`-Werte extrahiert ({ standard, beast }) und an den
   Callback gegeben, damit der Worker sie ins Job-Dokument legen kann.

   Gemessen an der echten API (Phase-0-Messung 2026-08-11):
     - `stream: true` funktioniert zusammen mit `response_format` und
       `prompt_cache_key`; am Ende entsteht gueltiges JSON.
     - Format: Zeilen `data: {...}`, Text in `choices[0].delta.content`,
       Ende `data: [DONE]`, `usage` im letzten Chunk. ~1100-1200 Chunks mit
       im Schnitt 9 Zeichen (min 1, max ~180).
     - Chunk-Grenzen liegen mitten in Woertern, mitten in JSON-Escapes und
       potenziell mitten in Mehrbyte-Zeichen — deshalb TextDecoder mit
       `{stream: true}` und ein Escape-bewusster Scanner im Extraktor. */

/* Hoechstens alle ~2 Sekunden extrahieren: Die Extraktion scannt den bisher
   angekommenen Text von vorn — bei ~1150 Chunks pro Antwort waere ein Lauf pro
   Chunk unnoetige Rechenarbeit, und schnellere Wellen braeuchte ohnehin
   niemand (der Client pollt im 2-Sekunden-Takt). Fuer Tests umstellbar. */
let liveIntervalMs = 2000;
function _setLiveIntervalMsForTest(ms) {
  liveIntervalMs = typeof ms === "number" ? ms : 2000;
}

/* FEATURE-2026-08-29-01: Unter jedem Kartenschluessel steht der Text in `value`. */

/* KA-11: Die Modus-Schluessel, an denen die beiden profileText-Werte verankert
   werden. In gueltigem JSON koennen diese Zeichenfolgen INNERHALB eines
   String-Werts nie roh auftauchen (die Anfuehrungszeichen waeren dort `\"`) —
   dieselbe Escape-Garantie, auf der schon der profileText-Scanner beruht. */
const STANDARD_SCHLUESSEL = '"standard"';
const BEAST_SCHLUESSEL = '"beast"';

/**
 * Extrahiert aus einem JSON-PRAEFIX (der noch mitten im Satz abbrechen kann)
 * die bereits vollstaendig angekommenen Teile BEIDER `profileText`-Werte.
 *
 * KA-11 (Kurzaudit 2026-08-12): Frueher galt schlicht „erstes Vorkommen =
 * Standard, zweites = Beast" — das hing allein am BEISPIEL-Schema im Prompt
 * (keine Garantie durch response_format). Haette das Modell die Bloecke je
 * vertauscht, waere der harte Beast-Text kurz als Standard-Profil erschienen.
 * Jetzt wird jeder Wert an seinem Modus-Schluessel VERANKERT: Der
 * Standard-Text zaehlt nur, wenn zwischen `"standard"` und dem Fund kein
 * `"beast"` liegt (und umgekehrt). Dreht das Modell die Reihenfolge, zeigt
 * der Live-Weg schlicht nichts Falsches — schlimmstenfalls bleibt das
 * Warte-Auge stehen; das Endergebnis parst ohnehin das komplette JSON.
 * Fuer die gemessene Normal-Reihenfolge ist das Ergebnis byte-identisch
 * zum bisherigen Verhalten.
 *
 * Rueckgabe: `{ standard, beast }` — jeweils der DEKODIERTE Klartext, oder
 * `null`, solange der jeweilige Wert noch nicht begonnen hat.
 */
/* FEATURE-2026-08-29-01: Fertige Kategorie-Karten aus dem laufenden Strom lesen.

   WARUM: Ein Profil besteht aus `profileText` UND 13 Karten, und der Prompt
   verlangt den Text ZUERST. Bis hierher wanderte nur der Text in die Live-
   Anzeige — die Karten entstanden unsichtbar. Gemessen am 28.08.: Standard-Text
   nach 34,6 s fertig, Beast-Text ab ~85 s. Dazwischen 50 Sekunden, in denen der
   Bildschirm stillsteht, obwohl die Hälfte der Arbeit genau dort passiert. Der
   Nutzer haelt das fuer das Ende ("es wirkt fertig, das liest ja keiner mehr").

   Zurueckgegeben werden NUR abgeschlossene Werte. Eine halb angekommene Karte
   zu zeigen waere schlechter als keine — sie wuerde sich beim naechsten Poll
   veraendern und wirkte wie ein Fehler. */
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

/* Loest JSON-String-Escapes zu echten Zeichen auf. Bewusst von Hand statt
   JSON.parse: Der Praefix ist zwar frei von UNVOLLSTAENDIGEN Escapes (der
   Scanner oben schneidet sie ab), aber ein Modell koennte z.B. ein rohes
   Steuerzeichen liefern — JSON.parse wuerfe dann, und ein Fehler hier darf
   den Live-Weg nie zum Aufruf-Fehler machen. */
/**
 * Liest eine Mistral-Antwort im SSE-Stream-Format zu Ende und liefert
 * dasselbe Ergebnis-Objekt wie der Nicht-Stream-Pfad. Nebenlaeufig wird
 * hoechstens alle `liveIntervalMs` der Live-Text extrahiert und an
 * `onLiveText` gegeben — Fehler im Callback oder in der Extraktion werden
 * still geschluckt, sie duerfen den Aufruf NIE scheitern lassen.
 */
async function leseStreamAntwort(res, onLiveText, httpStart, spur) {
  const reader = res.body.getReader();
  /* {stream: true}: haelt unvollstaendige Mehrbyte-Sequenzen (Umlaute,
     Emojis) zurueck, bis die restlichen Bytes im naechsten Chunk ankommen —
     ohne das entstuenden Ersatzzeichen mitten im Text. */
  const decoder = new TextDecoder("utf-8");
  let zeilenRest = ""; /* noch nicht durch \n abgeschlossene SSE-Rohdaten */
  let volltext = ""; /* alle delta.content-Stuecke in Ankunftsreihenfolge */
  let finishReason = "unknown";
  let usage = {};
  let letzteWelle = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    zeilenRest += decoder.decode(value, { stream: true });

    /* Nur KOMPLETTE Zeilen verarbeiten; der Rest wartet auf den naechsten
       Chunk. Ein \r vor dem \n (CRLF) wird mit abgeraeumt. */
    let umbruch;
    while ((umbruch = zeilenRest.indexOf("\n")) >= 0) {
      const zeile = zeilenRest.slice(0, umbruch).replace(/\r$/, "");
      zeilenRest = zeilenRest.slice(umbruch + 1);
      if (!zeile.startsWith("data:")) continue; /* Leerzeilen, Kommentare */
      const nutzlast = zeile.slice(5).trim();
      if (nutzlast === "[DONE]") continue; /* Ende-Marker traegt keine Daten */
      let chunk;
      try {
        chunk = JSON.parse(nutzlast);
      } catch (_) {
        continue; /* defensiv: eine unlesbare Zeile kippt nicht den Aufruf */
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string") {
        volltext += delta;
      } else if (Array.isArray(delta)) {
        /* Analog zum Nicht-Stream-Pfad: multimodale Antworten koennen den
           Text als Array von {type:"text"}-Teilen liefern. */
        volltext += delta
          .filter((teil) => teil && teil.type === "text")
          .map((teil) => teil.text)
          .join("");
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage; /* kommt im letzten Chunk */
    }

    /* BUG-2026-08-28-02: Der bereits gelesene Text wird nach aussen
       mitgefuehrt. Reisst die Uhr mitten im Strom, wirft der Reader einen
       AbortError und `volltext` waere sonst mit dem Stack-Frame verloren —
       obwohl darin ein fast vollstaendiges Ergebnis steht. */
    if (spur) spur.text = volltext;

    /* Live-Welle: gedrosselt, still bei Fehlern. Solange nicht einmal der
       Standard-Text begonnen hat (standard === null), gibt es nichts zu
       melden — Beast beginnt ohnehin erst nach dem Standard-Profil. */
    const jetzt = Date.now();
    if (jetzt - letzteWelle >= liveIntervalMs) {
      letzteWelle = jetzt;
      try {
        const live = extrahiereLiveText(volltext);
        /* Callback nicht awaiten (nebenlaeufig) — aber eine Rejection MUSS
           abgefangen werden, sonst stuerzt der Prozess ab. */
        if (live.standard !== null) Promise.resolve(onLiveText(live)).catch(() => {});
      } catch (_) {
        /* still: Der Live-Text ist reiner Komfort, nie Pflicht. */
      }
    }
  }

  /* Exakt dieselbe Ergebnisform wie der Nicht-Stream-Pfad — inklusive
     `trim()`, damit der Gesamtstring byte-identisch ist. */
  return {
    text: volltext.trim(),
    finishReason,
    promptTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    cachedTokens: readCachedTokens(usage),
    httpMs: Date.now() - httpStart,
  };
}

async function callMistralRaw(options) {
  /* waitMs misst, wie lange der Call auf einen freien Semaphore-Slot UND einen
     Token-Bucket-Tick gewartet hat — der reine Drossel-Anteil an der Wartezeit.
     httpMs (in callMistralRawUnthrottled gemessen) ist davon getrennt der reine
     Mistral-Roundtrip. Beide zusammen erlauben nach einem Workshop die Frage zu
     beantworten: bremst Mistral oder bremsen wir? */
  const t0 = Date.now();
  let waitMs = 0;
  /* Die Drosselwerte kommen aus dem Einstellungssatz und werden hier
     durchgereicht — an EINER Stelle, statt in jedem einzelnen Aufrufer. Der
     Satz liegt im Zwischenspeicher, der Aufruf kostet nichts. */
  const { werte } = await betriebswerteOderAbbruch();
  /* Die Zeitgrenze des Einzelaufrufs kommt aus dem Einstellungssatz. Ein
     Aufrufer darf sie ueberschreiben — der Single-Large-Pfad tut das, weil er
     eine eigene, laengere Grenze hat (singleLargeTimeoutMs). Wer nichts sagt,
     bekommt mistralTimeoutMs. Das ist KEIN Rueckfall auf einen Code-Wert:
     Beide Zahlen stehen im selben Satz, es gibt sie nur einmal. */
  const mitGrenze = options.timeoutCapMs == null ? { ...options, timeoutCapMs: werte.mistralTimeoutMs } : options;
  const result = await withMistralSlot(
    () => {
      waitMs = Date.now() - t0;
      return callMistralRawUnthrottled(mitGrenze);
    },
    modelClassOf(options.model),
    werte
  );
  return { ...result, waitMs };
}

async function callMistralRawUnthrottled({
  model,
  messages,
  maxTokens,
  temperature,
  forceJSON,
  timeoutMs,
  timeoutCapMs,
  cacheKey,
  onLiveText,
}) {
  const apiKey = getApiKey();

  /* v3.0 Phase 1: NUR mit Callback wird gestreamt. Ohne `onLiveText` ist der
     Request-Body bitgenau der heutige — das ist die Rueckfall-Garantie des
     Flags (Standard aus = kein `stream: true`, nirgends). */
  const streamen = typeof onLiveText === "function";

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (streamen) body.stream = true;
  if (forceJSON) body.response_format = { type: "json_object" };
  /* v2.5: Prompt-Caching. `prompt_cache_key` erhoeht die Chance, dass Mistral
     den immer gleichen Prompt-ANFANG (unser statischer Anweisungstext, ~9.500
     der 10.821 Eingabe-Tokens) wiederverwendet statt neu zu berechnen —
     gecachte Tokens kosten 10% des normalen Eingabepreises.
     WICHTIG, drei Punkte:
       1. Gecacht wird nur VORARBEIT am statischen Text, nie die Antwort. Jedes
          Foto wird weiterhin komplett neu analysiert — Qualitaet unveraendert.
       2. Das Bild steht im messages-Array HINTER dem Text und ist pro Anfrage
          verschieden. Es liegt damit ausserhalb des cachebaren Praefix und
          landet nie im Cache (Datenschutz).
       3. Der Key ist ein KONSTANTER Text pro Prompt-Variante — niemals Job-ID
          oder etwas Nutzerbezogenes, sonst waeren Anfragen verknuepfbar.
     Ohne Key (Flag aus) verhaelt sich der Call exakt wie vor v2.5. */
  if (cacheKey) body.prompt_cache_key = cacheKey;

  /* v1.10.6: Von 2 auf 1 Retry reduziert. Hintergrund: Bei Workshop-Bursts
     hat die alte 2-Retry-Strategie den 429-Stau verstaerkt — drei Wellen
     gegen dasselbe Rate-Limit. Jetzt 1 Retry mit 2s Wartezeit; bleibt es
     dabei, wird die Anfrage als Ueberlast nach oben propagiert und der
     Client kann via Auto-Retry sauber zurueckkommen. */
  const backoffs = [2000];
  let lastError;

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const controller = new AbortController();
    /* v1.10.6 Fix: Cap bei MISTRAL_TIMEOUT_MS (90s). Verhindert, dass ein
       grosses REQUEST_BUDGET_MS (480s) den Timeout fuer Einzel-Calls mit
       hochzieht. Das Outer-Budget gilt fuer die GESAMTE Pipeline, nicht fuer
       Einzelaufrufe. Ein einzelner haengender Mistral-Call soll nach 90s
       abbrechen, damit der Client-seitige Auto-Retry greift, statt 8 Minuten
       Spinner zu zeigen. */
    /* BUG-2026-08-13-37: `timeoutMs || MISTRAL_TIMEOUT_MS` verwandelte ein
       erschöpftes Budget (exakt 0) in den vollen Timeout — der Aufruf, der laut
       Restbudget gar nicht mehr stattfinden dürfte, bekam 90 s und konnte das
       Function-Timeout reißen. Jetzt: nur `null`/`undefined` fällt auf den
       Default; ein Budget ≤ 0 bricht sofort ab. */
    /* BUG-2026-08-17-01: Die Obergrenze ist jetzt pro Aufruf setzbar. Die
       allgemeinen 90 s passen zu den kurzen Aufrufen (describe, beast-ads);
       der Single-Large-Call schreibt zwei vollstaendige Profile in EINEM Zug
       und bekommt deshalb sein eigenes, gemessenes Budget mit. Ohne
       `timeoutCapMs` bleibt alles exakt wie vorher. */
    /* Die Obergrenze ist Pflicht — sie kommt aus dem Einstellungssatz. */
    if (typeof timeoutCapMs !== "number" || !(timeoutCapMs > 0)) {
      throw new Error("callMistral: timeoutCapMs fehlt (mistralTimeoutMs aus dem Einstellungssatz)");
    }
    const cap = timeoutCapMs;
    const budget = timeoutMs == null ? cap : timeoutMs;
    if (budget <= 0) {
      const err = new Error("Mistral-Budget erschoepft");
      err.code = "timeout";
      throw err;
    }
    const effectiveTimeout = Math.min(budget, cap);
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    const httpStart = Date.now();
    let res;
    try {
      res = await fetchImpl(MISTRAL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const e = new Error(`Mistral request timeout after ${effectiveTimeout}ms`);
        e.code = "timeout";
        throw e;
      }
      throw err;
    }
    /* Im Stream-Modus bleibt der Timeout SCHARF, bis der Stream zu Ende
       gelesen ist: `fetch` liefert dort schon bei den Headern zurueck, die
       eigentliche Antwort trudelt danach ueber Minuten ein. Ohne den aktiven
       Waechter koennte ein haengender Stream den Worker endlos festhalten. */
    if (!streamen) clearTimeout(timeoutId);

    if (res.status === 429 && attempt < backoffs.length) {
      if (streamen) clearTimeout(timeoutId);
      /* KA-09 (Kurzaudit 2026-08-12): Den nie gelesenen Antwortrumpf aktiv
         verwerfen, sonst bleibt die Verbindung bis zum Speicherbereiniger
         offen — bei Workshop-Bursts mit vielen 429ern unnötiger Ballast. */
      try {
        if (res.body && typeof res.body.cancel === "function") await res.body.cancel();
      } catch (_) {
        /* Verwerfen ist best effort — ein Fehler hier ändert nichts am Retry. */
      }
      lastError = new Error("Mistral 429 rate limited");
      lastError.status = 429;
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
      continue;
    }

    if (!res.ok) {
      if (streamen) clearTimeout(timeoutId);
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch (_) {
        /* ignore */
      }
      const e = new Error(`Mistral HTTP ${res.status}: ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`);
      e.status = res.status;
      throw e;
    }

    if (streamen) {
      /* Stream-Fehler sind normale Aufruf-Fehler: Ein Abbruch durch unseren
         Timeout wirft im Reader einen AbortError (Phase-0-Messung) und wird
         hier — wie beim Nicht-Stream-fetch — zum `timeout`-Fehler; alles
         andere propagiert unveraendert in die bestehende Fehlerbehandlung. */
      const spur = {};
      try {
        return await leseStreamAntwort(res, onLiveText, httpStart, spur);
      } catch (err) {
        if (err && err.name === "AbortError") {
          const e = new Error(`Mistral request timeout after ${effectiveTimeout}ms`);
          e.code = "timeout";
          /* BUG-2026-08-28-02: Was bis zum Abbruch ankam, faehrt mit. */
          e.teiltext = spur.text || "";
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    let text = "";
    const msgContent = choice?.message?.content;
    if (typeof msgContent === "string") {
      text = msgContent;
    } else if (Array.isArray(msgContent)) {
      text = msgContent
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
    const usage = json.usage || {};
    return {
      text: text.trim(),
      finishReason: choice?.finish_reason || "unknown",
      promptTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      cachedTokens: readCachedTokens(usage),
      httpMs: Date.now() - httpStart,
    };
  }

  /* Wenn wir hier landen, sind alle Retry-Versuche fehlgeschlagen mit 429 */
  throw lastError || new Error("Mistral request failed");
}

/* ── Public: describeImage (multimodal via Large 3) ──────────────── */

async function describeImage(imageBuffer, mimeType, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const addendum = prompts.mistralDescribeAddendum || "";

  let lastError = null;

  /* Versuch 1: regulärer Describe-Prompt */
  try {
    const result = await tryDescribeWithPrompt(
      prompts.describePrompt + addendum,
      imageBuffer,
      mimeType,
      remainingBudget
    );
    if (result && result.text) return result.text;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err; /* Rate-Limit sofort durchreichen */
    lastError = err;
  }

  /* Versuch 2: Fallback-Prompt (weniger triggerig) */
  try {
    const fallback = await tryDescribeWithPrompt(
      prompts.describeFallback + addendum,
      imageBuffer,
      mimeType,
      remainingBudget
    );
    if (fallback && fallback.text) return fallback.text;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    lastError = err;
  }

  /* Beide Versuche durch. Trat ein echter API-/Netzwerk-Fehler auf, werfen wir
     ihn (→ blocked.apiError im Caller). Liefen beide Versuche sauber durch, aber
     mit leerem Text, geben wir null zurück (→ blocked.safetyFilter). */
  if (lastError) throw lastError;
  return null;
}

async function tryDescribeWithPrompt(prompt, imageBuffer, mimeType, remainingBudget) {
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: dataUrl },
      ],
    },
  ];

  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL,
      messages,
      maxTokens: (await betriebswerteOderAbbruch()).werte.describeMaxTokens,
      /* v2.0.4: 0.2 → 0.1. Reduziert Run-to-Run-Schwankungen bei Alter/Geschlecht
         (Memory-Eintrag bestätigt Schwankungen als modellbedingt). Niedrigere
         Temperatur macht das Modell deterministischer ohne Token-Mehrkosten. */
      temperature: 0.1,
      forceJSON: false,
      timeoutMs: budget,
    });
    console.log(
      JSON.stringify({
        step: "mistral-describe",
        model: MISTRAL_DESCRIBE_MODEL,
        status: result.text ? "ok" : "empty",
        finishReason: result.finishReason,
        length: result.text.length,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
      })
    );
    return result;
  } catch (err) {
    console.log(
      JSON.stringify({ step: "mistral-describe", model: MISTRAL_DESCRIBE_MODEL, status: "error", error: err.message })
    );
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    /* Echte API-/Netzwerk-Fehler als api_error markiert weiterwerfen. describeImage
       sammelt den Fehler, versucht noch den Fallback-Prompt und propagiert ihn am
       Ende — damit der Caller blocked.apiError statt blocked.safetyFilter zeigt. */
    const e = new Error(`Mistral describe failed: ${err.message}`);
    e.code = "api_error";
    throw e;
  }
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
/* ── Public: generateBothProfiles ────────────────────────────────── */

async function generateBothProfiles(imageDescription, exifData, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");

  /* v2.1: Footer aus der Beschreibung extrahieren — liefert die strukturierten
     Anker für Konsistenz zwischen Normal- und Beast-Modus. */
  const { description: cleanDescription, hardFacts, ads, triggers } = parseDescribeFooter(imageDescription);

  /* Mistral bekommt nur die (bereinigte) Beschreibung. EXIF-Kameradaten
     (make/model) bleiben sinnvoll und werden mitgegeben. */
  const { dateTimeOriginal: _dateTimeOriginal, ...exifWithoutDate } = exifData || {};
  const exifContext =
    Object.keys(exifWithoutDate).length > 0 ? `\n${prompts.labelExif}: ${JSON.stringify(exifWithoutDate)}` : "";

  const normalPrompt = buildProfilePrompt(
    prompts,
    prompts.systemNormal,
    cleanDescription,
    exifContext,
    prompts.jsonSchemaNormal,
    hardFacts
  );
  const boostPrompt = buildProfilePrompt(
    prompts,
    prompts.systemBoost,
    cleanDescription,
    exifContext,
    prompts.jsonSchemaBoost,
    hardFacts
  );

  const [normal, boost] = await Promise.all([
    runProfile(normalPrompt, 0.7, "normal", remainingBudget),
    /* v2.1 (2026-05-23 nachmittags): Beast-Temperatur 1.0 -> 0.8. Hintergrund:
       Beim ersten v2.1-Live-Test schrieb Beast trotz Längen-Vorgabe (20-30 Wörter)
       jede Karte mit 5-8 Sätzen und schnitt am max_tokens-Limit ab. Niedrigere
       Temperatur macht Mistral disziplinierter beim Schema-Einhalten, der zynische
       Beast-Ton kommt aus dem systemBoost-Prompt (nicht aus der Temperatur). */
    runProfile(boostPrompt, 0.8, "boost", remainingBudget),
  ]);

  /* Konsistenz-Anker durchsetzen: Profile-Calls könnten trotz Prompt-Pflicht
     die Hard-Facts ignorieren. Wir überschreiben alter_geschlecht/herkunft
     server-seitig, damit Normal und Beast garantiert dieselben Werte zeigen. */
  function enforceHardFacts(profile) {
    if (!profile || !profile.categories) return profile;
    if (hardFacts.alter_geschlecht && profile.categories.alter_geschlecht) {
      profile.categories.alter_geschlecht.value = hardFacts.alter_geschlecht;
    }
    if (hardFacts.herkunft && profile.categories.herkunft) {
      profile.categories.herkunft.value = hardFacts.herkunft;
    }
    return profile;
  }
  enforceHardFacts(normal);
  enforceHardFacts(boost);

  /* Marken und Triggers vom Large in BEIDE Modi schreiben — sie sind
     modus-übergreifend identisch. Profile-Calls liefern sie nicht mehr;
     wir setzen sie hier zentral. Falls der Footer leer war (alter Live-Stil
     oder Parse-Fehler), bleiben ad_targeting/manipulation_triggers, die das
     Profil eventuell trotzdem geliefert hat, als Fallback erhalten. */
  function applyTopLevelAdsTriggers(profile) {
    if (!profile) return profile;
    if (ads.length > 0) profile.ad_targeting = ads;
    if (triggers.length > 0) profile.manipulation_triggers = triggers;
    return profile;
  }
  applyTopLevelAdsTriggers(normal);
  applyTopLevelAdsTriggers(boost);

  return { normal, boost };
}

function buildProfilePrompt(prompts, systemContext, imageDescription, exifContext, schema, hardFacts) {
  const safeDesc = escapeXml(imageDescription || "");
  const safeExif = exifContext ? escapeXml(exifContext) : "";
  /* Hard-Facts werden zusätzlich als expliziter, gut sichtbarer Block oberhalb
     der Beschreibung eingefügt — Mistral folgt expliziten Anker-Blöcken besser
     als regex-eingebetteten Anweisungen im Schema. */
  const hardFactsBlock =
    hardFacts && (hardFacts.alter_geschlecht || hardFacts.herkunft)
      ? `\n<hard_facts_anker>\n${[
          hardFacts.alter_geschlecht ? `alter_geschlecht: ${escapeXml(hardFacts.alter_geschlecht)}` : "",
          hardFacts.herkunft ? `herkunft: ${escapeXml(hardFacts.herkunft)}` : "",
        ]
          .filter(Boolean)
          .join("\n")}\n</hard_facts_anker>\n`
      : "";
  return `${systemContext}${hardFactsBlock}
${prompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>${safeExif ? `\n<exif_daten>${safeExif}</exif_daten>` : ""}

${prompts.workshopNote}
${schema}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* v2.1: Vollständigkeits-Check. Mistral hat sich in Live-Tests trotz Schema-
   Pflicht "alle 13 Karten" gelegentlich entschieden, früh aufzuhören —
   `finishReason: "stop"`, aber categories enthielt nur 7 von 13. Wir prüfen
   das clientseitig und triggern einen Retry mit explizitem Hinweis auf die
   fehlenden Karten. */
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

function findMissingCards(parsed) {
  if (!parsed || !parsed.categories || typeof parsed.categories !== "object") {
    return REQUIRED_CARDS.slice();
  }
  return REQUIRED_CARDS.filter((key) => !parsed.categories[key] || !parsed.categories[key].value);
}

async function runProfile(prompt, temperature, mode, remainingBudget) {
  const messages = [{ role: "user", content: prompt }];

  /* Versuch 1: Small 4 als Hybrid-Default. v1.10.6: rate_limit/throttle_timeout
     wird hochpropagiert, sonst probieren wir noch Large 3 als Fallback. */
  let small4Result = null;
  try {
    small4Result = await tryProfileCall({
      model: MISTRAL_PROFILE_MODEL,
      messages,
      temperature,
      mode,
      remainingBudget,
      isFallback: false,
    });
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    /* andere Fehler: weiter zum Fallback */
  }

  /* v2.1: Vollständigkeits-Check für den Small-4-Output. Wenn Karten fehlen,
     Retry mit explizitem Hinweis. NUR ein Retry — danach geht's mit dem
     unvollständigen Ergebnis weiter oder über den Large-Fallback. */
  if (small4Result) {
    const missing = findMissingCards(small4Result);
    if (missing.length === 0) return small4Result;
    if (missing.length < REQUIRED_CARDS.length) {
      console.log(
        JSON.stringify({
          step: `mistral-profile-${mode}`,
          status: "incomplete-retry",
          missingCards: missing,
          deliveredCards: REQUIRED_CARDS.length - missing.length,
        })
      );
      const retryPrompt = `${prompt}\n\nHINWEIS: Im letzten Versuch hast du folgende Karten ausgelassen: ${missing.join(", ")}. Liefere bitte ALLE 13 Karten im categories-Objekt — keine darf fehlen.`;
      try {
        const retryResult = await tryProfileCall({
          model: MISTRAL_PROFILE_MODEL,
          messages: [{ role: "user", content: retryPrompt }],
          temperature,
          mode,
          remainingBudget,
          isFallback: false,
        });
        /* Wenn Retry alle 13 hat → nehmen. Sonst: das vollständigere Ergebnis
           der beiden behalten (oder small4Result als Basis, mit den im Retry
           neu gelieferten Karten ergänzt). */
        if (retryResult) {
          const retryMissing = findMissingCards(retryResult);
          if (retryMissing.length < missing.length) {
            /* Retry war besser — mergen: small4Result als Basis,
               fehlende Karten aus Retry ergänzen. So gehen keine Werte
               verloren falls Mistral im Retry andere Karten ausgelassen hat. */
            if (!small4Result.categories) small4Result.categories = {};
            for (const key of REQUIRED_CARDS) {
              if (!small4Result.categories[key] && retryResult.categories && retryResult.categories[key]) {
                small4Result.categories[key] = retryResult.categories[key];
              }
            }
            /* profileText aus Retry übernehmen, falls Original-Versuch keinen hatte */
            if (!small4Result.profileText && retryResult.profileText) {
              small4Result.profileText = retryResult.profileText;
            }
          }
        }
      } catch (err) {
        /* Retry-Fehler nicht propagieren — wir haben ja schon small4Result */
        console.log(
          JSON.stringify({
            step: `mistral-profile-${mode}`,
            status: "incomplete-retry-failed",
            error: err.message,
          })
        );
      }
      return small4Result;
    }
  }

  /* Versuch 2: Large 3 als Fallback wenn Small 4 ausfällt. v1.10.6: bei
     rate_limit jetzt auch hier durchreichen statt schlucken. */
  try {
    const large3 = await tryProfileCall({
      model: MISTRAL_FALLBACK_MODEL,
      messages,
      temperature,
      mode,
      remainingBudget,
      isFallback: true,
    });
    return large3;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    return null;
  }
}

async function tryProfileCall({ model, messages, temperature, mode, remainingBudget, isFallback }) {
  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model,
      messages,
      maxTokens: (await betriebswerteOderAbbruch()).werte.profileMaxTokens,
      temperature,
      forceJSON: true,
      timeoutMs: budget,
    });

    if (!result.text) {
      console.log(
        JSON.stringify({ step: `mistral-profile-${mode}`, model, status: "empty", finishReason: result.finishReason })
      );
      return null;
    }

    const stages = [];
    const parsed = parseSafely(result.text, {
      onRepair: (stage, err) => {
        stages.push(stage + (err ? `:${err.name || "Error"}` : ""));
      },
    });

    if (!parsed) {
      console.log(
        JSON.stringify({
          step: `mistral-profile-${mode}`,
          model,
          status: "parse-failed",
          finishReason: result.finishReason,
          repairStages: stages,
        })
      );
      return null;
    }

    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "ok",
        finishReason: result.finishReason,
        isFallback,
        repairStages: stages,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
      })
    );
    return parsed;
  } catch (err) {
    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "error",
        error: err.message,
        isFallback,
      })
    );
    /* v1.10.6: Rate-Limit/Throttle-Ueberlast nicht schlucken — sonst maskiert
       sich blocked.overloaded als generischer blocked.profileBlocked und der
       Client weiss nicht, dass ein Auto-Retry helfen wuerde. */
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    return null;
  }
}

/* ── v2.2: Single-Large-Call ──
   Macht in EINEM mistral-large-2512-Call:
     Bild sehen + Beschreibung + hard_facts + ads + triggers + Standard + Beast.
   Ersetzt die 3-Call-Pipeline (Describe + 2× Profile) durch einen Aufruf.
   Token-Einsparung in lokalen Tests (3 Bilder): ~70% (21.300 → ~5.700).
   Liefert dasselbe { normal, boost }-Shape wie generateBothProfiles —
   handle-process-job.js braucht nichts anzupassen außer dem Branch.
   Kosten-Hinweis: alle Tokens landen im teureren Large 2512 statt im billigen
   Small 2603 — Mehrkosten ~+6% gegenüber heutiger Pipeline (siehe CHANGELOG). */

/* MISTRAL_SINGLE_LARGE_MAX_TOKENS steht seit v3.3.1 in `config.js`, direkt
   neben MISTRAL_SINGLE_LARGE_TIMEOUT_MS: Die beiden Werte sind nur gemeinsam
   richtig, und getrennt aufgestellt sah jeder fuer sich plausibel aus. */

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

async function runSingleLargeCall(imageBuffer, mimeType, remainingBudget, lang, opts = {}) {
  const prompts = loadPrompts(lang || "de");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;

  /* v2.5: Cache-Schluessel pro Sprache — de und en haben verschiedene Prompts
     und damit verschiedene Praefixe. Ein gemeinsamer Key wuerde die Trefferquote
     nur verwaessern. Konstant, ohne Nutzerbezug (siehe callMistralRawUnthrottled). */
  const cacheKey = opts.usePromptCache ? `malzime-single-large-${lang || "de"}` : null;

  /* v2.5: Nachrichten-Aufbau haengt vom Caching ab — MESSERGEBNIS, nicht Theorie:
       ohne Cache: user[ text, bild ]        (Struktur bis v2.4, unveraendert)
       mit Cache:  system(text) + user[bild]
     Gemessen an der echten API mit wechselnden Bildern:
       - Text+Bild in EINER user-Message  => 0% Treffer (Mistral cacht einen
         multimodalen content-Array offenbar nur als Ganzes; da das Bild pro
         Anfrage wechselt, faellt der komplette Praefix aus dem Cache).
       - Text als eigene system-Message    => 82-100% Treffer.
       - Text als eigene *user*-Message    => 0% Treffer. Der Rollenwechsel ist
         also nicht umgehbar, blosses Auftrennen genuegt nicht.
     Qualitaetsgegenprobe (3 Demo-Bilder, volle Analysen, beide Strukturen):
     identische hard_facts, 0 fehlende Karten, gleiche Ausgabelaenge.
     Die alte Struktur bleibt der Pfad bei ausgeschaltetem Flag — damit ist der
     Rueckfall bitgenau der Stand vor v2.5. */
  /* v2.7: Marken-Sperre gegen Wiederholung. Sie sitzt bewusst HINTER dem Bild
     in der user-Message — dort war ohnehin nie Cache, die Rotation kostet also
     KEINEN Treffer. Waere sie im system-Teil, wechselte der statische Anfang
     bei jeder Analyse und die Trefferquote fiele auf 0 (siehe v2.5-Messung
     oben). Statisch oben, dynamisch unten. */
  const blocklistBlock = buildBrandBlocklistBlock(lang, opts.blocklistIndex);

  const messages = cacheKey
    ? [
        { role: "system", content: prompts.singleLargePrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: dataUrl },
            { type: "text", text: blocklistBlock },
          ],
        },
      ]
    : [
        {
          role: "user",
          content: [
            { type: "text", text: prompts.singleLargePrompt },
            { type: "image_url", image_url: dataUrl },
            { type: "text", text: blocklistBlock },
          ],
        },
      ];

  /* v3.0 Phase 1: Live-Text-Callback — optional von aussen (Worker) gesetzt.
     Er laeuft NUR im ersten Versuch mit: Ein Retry findet ausschliesslich
     statt, wenn der erste Versuch bereits ein parsebares (nur unvollstaendiges)
     Ergebnis geliefert hat — dessen Standard-Profiltext ist dann laengst
     komplett angekommen. Den Retry auch noch zu streamen wuerde den bereits
     gezeigten Live-Text nur mit einer NEUEN Modellantwort ueberschreiben. */
  const onLiveText = typeof opts.onLiveText === "function" ? opts.onLiveText : null;

  /* Erster Versuch */
  let parsed = await callSingleLarge(messages, remainingBudget, "first", cacheKey, onLiveText);
  let missing = parsed
    ? collectMissingForBothModes(parsed)
    : { standard: REQUIRED_CARDS.slice(), beast: REQUIRED_CARDS.slice() };

  /* Retry bei Unvollständigkeit — analog zu runProfile. Nur ein Retry. */
  const stillIncomplete = missing.standard.length > 0 || missing.beast.length > 0;
  if (stillIncomplete && parsed) {
    const hint =
      `\n\nHINWEIS: Im letzten Versuch hast du folgende Karten ausgelassen — bitte liefere ALLE 13 Karten in BEIDEN modes (standard + beast).` +
      (missing.standard.length > 0 ? `\nStandard fehlt: ${missing.standard.join(", ")}.` : "") +
      (missing.beast.length > 0 ? `\nBeast fehlt: ${missing.beast.join(", ")}.` : "");
    console.log(
      JSON.stringify({
        step: "mistral-single-large",
        status: "incomplete-retry",
        missingStandard: missing.standard,
        missingBeast: missing.beast,
      })
    );
    /* v2.5: Im Cache-Pfad gehoert der Hinweis in die user-Message, NICHT in die
       system-Message — sonst aendert sich der statische Anfang und der Treffer
       faellt aus. Statisch oben, dynamisch unten. */
    /* Die Marken-Sperre gilt auch im Retry — sonst duerfte das Modell im
       zweiten Anlauf wieder auf die verbrauchten Marken zurueckfallen.
       Bleibt im dynamischen Teil, der statische Anfang ist bitgleich. */
    const retryMessages = cacheKey
      ? [
          { role: "system", content: prompts.singleLargePrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: dataUrl },
              { type: "text", text: blocklistBlock + hint },
            ],
          },
        ]
      : [
          {
            role: "user",
            content: [
              { type: "text", text: prompts.singleLargePrompt + hint },
              { type: "image_url", image_url: dataUrl },
              { type: "text", text: blocklistBlock },
            ],
          },
        ];
    try {
      /* Gleicher cacheKey wie im ersten Versuch — der statische Anfang ist in
         beiden Versuchen bitgleich, der Cache traegt also auch den Retry. */
      const retryParsed = await callSingleLarge(retryMessages, remainingBudget, "retry", cacheKey);
      if (retryParsed) {
        /* Fehlende Karten aus Retry in Originalergebnis mergen (analog runProfile) */
        for (const mode of ["standard", "beast"]) {
          if (!parsed[mode]) parsed[mode] = retryParsed[mode];
          else if (retryParsed[mode]) {
            if (!parsed[mode].categories) parsed[mode].categories = {};
            const retryCats = retryParsed[mode].categories || {};
            for (const key of REQUIRED_CARDS) {
              if (!parsed[mode].categories[key] && retryCats[key]) {
                parsed[mode].categories[key] = retryCats[key];
              }
            }
            if (!parsed[mode].profileText && retryParsed[mode].profileText) {
              parsed[mode].profileText = retryParsed[mode].profileText;
            }
          }
        }
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "mistral-single-large",
          status: "incomplete-retry-failed",
          error: err.message,
        })
      );
    }
  }

  if (!parsed) return { normal: null, boost: null, subject: "", visibleText: "" };

  /* Hard-Facts server-seitig in beide Modi überschreiben — exakt wie in
     generateBothProfiles. Mistral kann die Vorgabe ignorieren; hier garantieren
     wir Konsistenz. */
  const hardFacts = parsed.hard_facts || {};
  const ads = Array.isArray(parsed.ad_targeting) ? parsed.ad_targeting : [];
  const triggers = Array.isArray(parsed.manipulation_triggers) ? parsed.manipulation_triggers : [];

  /* BIZ-001 (Audit 2026-08-10): Der Anker aus hard_facts wird VORANGESTELLT,
     nicht mehr eingesetzt. Vorher ueberschrieb er den ganzen Kartenwert — und
     warf damit den zweiten Satz weg, den der Prompt ausdruecklich verlangt:
     das konkrete, im Workshop vorfuehrbare Merkmal ("Deine Wangen sind noch
     rund und die Zaehne wirken gross fuers Gesicht"). Die v2.9-Messung
     "100 % Antworten mit konkretem Merkmal" wurde an der Modellantwort
     erhoben, nicht am ausgelieferten Ergebnis — auf der Karte kam sie nie an.
     Nebeneffekt vorher: Standard- und Beast-Modus zeigten an dieser Karte
     denselben nackten Anker. */
  const ANKER_MAX = 120;
  function mitAnkerVoran(anker, modellwert) {
    const a = String(anker || "")
      .trim()
      .replace(/[.\s]+$/, "");
    if (!a) return String(modellwert || "");
    /* Der erste Satz der Modellantwort SOLL der Anker sein — er wird durch die
       verbindliche Fassung ersetzt, alles DANACH bleibt erhalten.
       Hat die Antwort gar keinen Satzabschluss, gibt es auch keinen zweiten
       Satz: dann bleibt es beim reinen Anker wie bisher, statt den Anker
       doppelt zu schreiben. */
    const m = String(modellwert || "").match(/^[^.!?]*[.!?]\s*(.+)$/s);
    const rest = m ? m[1].trim() : "";
    /* BUG-2026-08-20-26: Der Anker wird NACH applyBounds vorangestellt und umging
       damit die Laengengrenze der Karte. Ein praepariertes Foto (Prompt-Injection
       ueber Bildinhalt) oder ein durchdrehendes Modell konnte so einen bis zu
       fuenfstellig langen Wert auf die Karte bringen — nachgemessen: 5000 Zeichen
       statt der zugesagten 800. Kein XSS (das Frontend maskiert), aber eine
       Anzeige, die die Seite sprengt, und eine Zusage, die nicht mehr stimmt.
       Der Anker selbst ist von Natur aus kurz ("34, weiblich"); 120 Zeichen sind
       grosszuegig. Danach gilt dieselbe Grenze wie fuer jeden Kartenwert. */
    const ankerKurz = a.slice(0, ANKER_MAX);
    const zusammen = rest ? `${ankerKurz}. ${rest}` : ankerKurz;
    return zusammen.slice(0, STRING_BOUND_CATEGORY);
  }

  function buildProfile(modeKey) {
    const src = parsed[modeKey];
    if (!src || !src.categories) return null;
    if (hardFacts.alter_geschlecht && src.categories.alter_geschlecht) {
      src.categories.alter_geschlecht.value = mitAnkerVoran(
        hardFacts.alter_geschlecht,
        src.categories.alter_geschlecht.value
      );
    }
    if (hardFacts.herkunft && src.categories.herkunft) {
      src.categories.herkunft.value = mitAnkerVoran(hardFacts.herkunft, src.categories.herkunft.value);
    }
    /* v2.7: ad_targeting kommt jetzt PRO MODUS aus dem Modell — Standard zeigt
       den passenden Lebensstil, Beast beutet die benannte Schwachstelle aus.
       Vorher landete eine einzige Liste in beiden Modi, was den Beast-Modus
       didaktisch entwertete (zynischer Text, brave Werbung darunter).
       Rueckfall auf die obere Liste, falls das Modell die alte Form liefert —
       dann ist es wie frueher, statt gar keiner Werbung. */
    const modeAds = Array.isArray(src.ad_targeting) && src.ad_targeting.length > 0 ? src.ad_targeting : ads;

    /* v2.8: manipulation_triggers ebenfalls pro Modus. Sie stehen im Frontend
       direkt neben der Werbung (public/js/render.js) — identische Trigger neben
       unterschiedlicher Werbung wirken widerspruechlich. Standard bleibt
       sachlich-aufklaerend, Beast beschreibt dieselben Hebel aus Taetersicht.
       Gleicher Rueckfall wie bei der Werbung: liefert das Modell die alte Form,
       gilt die obere Liste fuer beide Modi. */
    const modeTriggers =
      Array.isArray(src.manipulation_triggers) && src.manipulation_triggers.length > 0
        ? src.manipulation_triggers
        : triggers;

    return {
      categories: src.categories,
      profileText: src.profileText || "",
      ad_targeting: modeAds,
      manipulation_triggers: modeTriggers,
    };
  }

  /* v2.2.x (Audit PRIV-002): subject + visible_text aus dem KI-JSON mitgeben,
     damit die Datenschutz-Warnung + das Tier-Easter-Egg im Single-Large-Pfad
     wieder funktionieren (server-seitige Verdrahtung in handle-process-job.js). */
  const subject = typeof parsed.subject === "string" ? parsed.subject.trim().toUpperCase().slice(0, 20) : "";
  const visibleText = typeof parsed.visible_text === "string" ? parsed.visible_text.slice(0, 500) : "";

  return {
    normal: buildProfile("standard"),
    boost: buildProfile("beast"),
    subject,
    visibleText,
    /* Der verbindliche Altersanker aus hard_facts, getrennt von der Karte.
       Der Kinderschutz-Filter liest sein Alter hieraus statt aus dem
       Kartentext — seit BIZ-001 steht dort naemlich auch der Beleg-Satz, und
       eine Zahl darin ("der Kopf passt 7-mal in die Koerperhoehe") wuerde die
       Altersauslese sonst nach unten ziehen. */
    alterAnker: hardFacts.alter_geschlecht || null,
  };
}

/* ── v2.8: Zweiter Aufruf nur fuer die Beast-Werbung ──────────────────────
   Bekommt KEIN Bild, sondern nur den fertigen Beast-Text. Fuenf A/B-Messungen
   haben gezeigt, dass die Werbung im gemeinsamen Aufruf an der Produktwelt des
   Fotos klebt statt an der Schwachstelle — das Bild ueberstrahlt jede
   Textanweisung. Ohne Bild sank die Produktwelt-Ueberlappung von 41 % auf 11 %.

   Der Aufruf ist klein (~870 Tokens) und laeuft auf demselben Modell wie die
   Analyse. Faellt er aus, bleibt die Werbung aus dem Hauptaufruf stehen — eine
   Analyse darf daran NIE scheitern. */
async function generateBeastAds(boostProfile, standardAds, lang, opts = {}) {
  const cachenErlaubt = opts.usePromptCache !== false;
  if (!boostProfile || !boostProfile.categories) return null;
  const prompts = loadPrompts(lang || "de");
  if (typeof prompts.beastAdsSystem !== "string" || typeof prompts.beastAdsUser !== "function") return null;

  /* SEC-2026-08-12-18: Maskieren wie im ersten Aufruf. Alle diese Werte stammen
     mittelbar aus dem hochgeladenen Bild — ein Foto mit lesbarem Text kann
     Saetze ins Profil tragen, die hier wie Anweisungen aussehen. Ohne escapeXml
     koennte ein praepariertes Foto die Blockgrenze schliessen und den Rest des
     Prompts als eigene Anweisung fortsetzen. Warnung und Blockgrenzen stehen in
     der Prompt-Vorlage (beastAdsUser). */
  const c = boostProfile.categories;
  const nutzerteil = prompts.beastAdsUser({
    alter: escapeXml(c.alter_geschlecht?.value || ""),
    verletzlichkeit: escapeXml(c.verletzlichkeit?.value || ""),
    gesundheit: escapeXml(c.gesundheit?.value || ""),
    kaufkraft: escapeXml(c.kaufkraft?.value || ""),
    profileText: escapeXml((boostProfile.profileText || "").slice(0, 700)),
    standardAds: escapeXml((Array.isArray(standardAds) ? standardAds : []).join(", ")),
  });

  try {
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL /* Large 2512 — gleiches Modell wie die Analyse */,
      /* OPS-008: system = konstante Anweisungen, user = nur das Profil.
         Der Cache greift ausschliesslich auf einem konstanten Anfang. */
      messages: [
        { role: "system", content: prompts.beastAdsSystem },
        { role: "user", content: nutzerteil },
      ],
      maxTokens: 600,
      temperature: 0.5,
      forceJSON: true,
      timeoutMs: 30_000,
      /* Der Cache-Schluessel wird nur gesetzt, wenn das Flag es erlaubt —
         sonst behauptete RUNBOOK-Hebel 3b faelschlich, nach dem Umlegen werde
         "weder ein prompt_cache_key gesendet noch der Nachrichten-Aufbau
         umgestellt" (Audit OPS-008). */
      cacheKey: cachenErlaubt ? `malzime-beast-ads-${lang || "de"}` : null,
    });
    const parsed = parseSafely(result.text, { requireSchema: false });
    const ads = Array.isArray(parsed?.ad_targeting)
      ? parsed.ad_targeting.filter((e) => typeof e === "string" && e.trim()).slice(0, 12)
      : [];
    console.log(
      JSON.stringify({
        step: "mistral-beast-ads",
        status: ads.length ? "ok" : "empty",
        count: ads.length,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens,
        httpMs: result.httpMs,
      })
    );
    return ads.length ? ads : null;
  } catch (err) {
    /* Bewusst still: Der Hauptpfad hat bereits eine Werbeliste. */
    /* OPS-004 (Audit 2026-08-10): console.error statt console.log — das ergibt
       severity ERROR in Cloud Logging und faellt damit unter die bestehende
       Alarm-Policy. Vorher war ein dauerhaft fehlschlagender Zweitaufruf
       voellig unsichtbar: Der Fallback greift, der Nutzer merkt nichts, und
       jede Analyse liefe still mit der schlechteren Werbung aus dem
       Hauptaufruf. Der Fallback selbst bleibt unveraendert richtig. */
    console.error(
      JSON.stringify({
        severity: "ERROR",
        alert: "beast-ads-failed",
        step: "mistral-beast-ads",
        status: "failed",
        error: err.message,
      })
    );
    return null;
  }
}

function collectMissingForBothModes(parsed) {
  return {
    standard: parsed.standard ? findMissingCards(parsed.standard) : REQUIRED_CARDS.slice(),
    beast: parsed.beast ? findMissingCards(parsed.beast) : REQUIRED_CARDS.slice(),
  };
}

/* BUG-2026-08-28-02: Traegt ein geretteter Profilblock ueberhaupt Text? Reine
   Formpruefung — ohne sie wuerde ein leeres Geruest als Rettung durchgehen. */
function hatProfilText(block) {
  return Boolean(block && typeof block.profileText === "string" && block.profileText.trim().length > 0);
}

/**
 * Die geltenden Betriebswerte, oder ein klarer Abbruch.
 *
 * Seit 30.08.2026 stehen sie ausschliesslich in der Datenbank. Fehlen sie,
 * kann keine Analyse laufen — ohne Zeitgrenze und Textmenge weiss niemand,
 * wie lange und wie viel erlaubt ist. Das scheitert LAUT und mit Grund, statt
 * still mit irgendwelchen Zahlen weiterzumachen.
 */
async function betriebswerteOderAbbruch() {
  const { werte, profil, grund } = await geltendeWerte();
  if (!werte) {
    const fehler = new Error(`Betriebswerte fehlen: ${grund || "unbekannt"}`);
    fehler.code = "config_missing";
    throw fehler;
  }
  return { werte, profil: profil || null };
}

async function callSingleLarge(messages, remainingBudget, attemptLabel, cacheKey, onLiveText) {
  /* VOR dem try: Der Fehlerpfad protokolliert das Profil ebenfalls, und eine
     im try angelegte Variable gibt es im catch nicht. Genau daran sind beim
     ersten Anlauf zwei Pruefungen umgefallen. */
  let aktivesProfil = null;
  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    /* Betriebsprofil (30.08.2026): Zeitgrenze und Textmenge kommen aus dem
       aktiven Profil, wenn eines hinterlegt und gueltig ist — sonst aus dem
       Code. `geltendeWerte()` liefert IMMER einen brauchbaren Satz: Fehlt das
       Dokument, ist es unlesbar oder besteht das Profil die Kopplungspruefung
       nicht, sind es die Code-Werte. Der schlechteste Fall ist damit der
       Zustand von vorher, nie ein schlechterer.

       Die beiden Werte gehoeren zusammen und werden deshalb GEMEINSAM
       gelesen — genau daran waere ein einzelner Firestore-Schalter
       gescheitert (BUG-2026-08-17-01). */
    const { werte: betriebswerte, profil } = await betriebswerteOderAbbruch();
    aktivesProfil = profil;
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL /* Large 2512 — multimodal, 2M TPM */,
      messages,
      maxTokens: betriebswerte.singleLargeMaxTokens,
      temperature: 0.5 /* Kompromiss zwischen Standard (0.3) und Beast (0.8) */,
      forceJSON: true,
      timeoutMs: budget,
      /* BUG-2026-08-17-01: eigenes Zeitbudget statt der allgemeinen 90 s —
         siehe Herleitung an der Konstante in config.js. */
      timeoutCapMs: betriebswerte.singleLargeTimeoutMs,
      cacheKey,
      /* v3.0 Phase 1: Nur gesetzt, wenn der Worker das Live-Text-Flag an hat.
         Ohne Callback bleibt der Request bitgenau der heutige (kein stream). */
      onLiveText: onLiveText || undefined,
    });
    const stages = [];
    const parsed = parseSafely(result.text, {
      requireSchema: false /* unser Schema unterscheidet sich vom Live-Schema (categories sitzt unter standard/beast) */,
      onRepair: (stage, err) => stages.push(stage + (err ? `:${err.name || "Error"}` : "")),
    });
    console.log(
      JSON.stringify({
        step: "mistral-single-large",
        /* Befund aus dem zweiten Review (30.08.2026): Ohne diese Angabe war im
           Fehlerfall nicht feststellbar, mit welchen Werten die Analyse lief —
           bei einem Vorfall die erste Frage. `null` heisst: kein Profil aktiv,
           es galten die Code-Werte. */
        profil: aktivesProfil || null,
        model: MISTRAL_DESCRIBE_MODEL,
        attempt: attemptLabel,
        status: parsed ? "ok" : "parse-failed",
        finishReason: result.finishReason,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        /* v2.5: Erfolgskontrolle Prompt-Cache. cachedTokens/promptTokens ist die
           Trefferquote; 0 bei ausgeschaltetem Flag ODER Cache-Miss. */
        cachedTokens: result.cachedTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
        repairStages: stages,
      })
    );
    return parsed;
  } catch (err) {
    /* BUG-2026-08-28-02: Rettung vor dem Fehlerpfad. Reisst die Uhr, steht im
       Strom oft ein fast vollstaendiges Ergebnis — am 28.08. lagen bei jedem
       gescheiterten Lauf beide Profiltexte fertig in Firestore und wurden
       trotzdem verworfen. `parseSafely` bringt die Reparatur fuer
       abgeschnittenes JSON bereits mit (Stufe truncation-recovery); sie war
       hier nur nie erreichbar, weil der Teiltext mit dem Stack-Frame starb.
       Greift die Rettung nicht, laeuft alles exakt wie bisher weiter. */
    if (err && err.code === "timeout" && typeof err.teiltext === "string" && err.teiltext.length > 0) {
      const rettungsStufen = [];
      const gerettet = parseSafely(err.teiltext, {
        requireSchema: false,
        onRepair: (stufe, e) => rettungsStufen.push(stufe + (e ? `:${e.name || "Error"}` : "")),
      });
      const brauchbar = gerettet && (hatProfilText(gerettet.standard) || hatProfilText(gerettet.beast));
      console.log(
        JSON.stringify({
          step: "single-large-rettung",
          attempt: attemptLabel,
          status: brauchbar ? "gerettet" : "nicht-rettbar",
          teiltextZeichen: err.teiltext.length,
          repairStages: rettungsStufen,
        })
      );
      if (brauchbar) return gerettet;
    }

    /* BUG-2026-08-17-06: console.error statt console.log — das ergibt severity
       ERROR in Cloud Logging und faellt damit unter die bestehende
       Alarm-Policy (dieselbe Begruendung wie OPS-004 beim Werbe-Ersatzaufruf).

       Vorher war die Lage absurd herum: Der NEBENSAECHLICHE Ersatzaufruf fuer
       die Werbeliste schlug Alarm, waehrend die Analyse selbst still starb.
       Zwei abgebrochene Laeufe (11.08. und 14.08.2026) haben so niemanden
       erreicht — gefunden wurden sie erst, weil ein Nutzer sich beschwerte.
       Genau das ist die Frage aus KERN 4: Wer wuerde es merken, wenn das hier
       falsch waere? Bis hierher: niemand. */
    console.error(
      JSON.stringify({
        severity: "ERROR",
        alert: "single-large-failed",
        step: "mistral-single-large",
        /* Befund aus dem zweiten Review (30.08.2026): Ohne diese Angabe war im
           Fehlerfall nicht feststellbar, mit welchen Werten die Analyse lief —
           bei einem Vorfall die erste Frage. `null` heisst: kein Profil aktiv,
           es galten die Code-Werte. */
        profil: aktivesProfil || null,
        attempt: attemptLabel,
        status: "error",
        error: err.message,
        /* `timeout` trennt „das Modell war zu langsam" von „die API war weg" —
           ohne diese Unterscheidung ist am Alarm nicht zu erkennen, ob eine
           Zeitgrenze zu knapp sitzt oder Mistral eine Stoerung hat. */
        errorCode: err.code || null,
      })
    );
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    throw err;
  }
}

module.exports = {
  describeImage,
  generateBothProfiles,
  runSingleLargeCall,
  generateBeastAds,
  isRateLimitError,
  /* Für Tests */
  setFetchForTest,
  _callMistralRaw: callMistralRaw,
  /* Fuer die Rueckfall-Pruefung exportiert (30.08.2026): callMistralRaw setzt
     die Zeitgrenze aus dem Einstellungssatz, bevor es hierher durchreicht —
     ein Rueckfall auf eine feste Zahl WEITER INNEN waere von aussen deshalb
     nicht sichtbar. Die Rueckbauprobe blieb genau daran gruen. */
  _callMistralRawUnthrottled: callMistralRawUnthrottled,
  _buildBrandBlocklistBlock: buildBrandBlocklistBlock,
  _BRAND_BLOCKLIST_SETS: BRAND_BLOCKLIST_SETS,
  _extrahiereLiveText: extrahiereLiveText,
  _setLiveIntervalMsForTest,
};
