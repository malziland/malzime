"use strict";

/**
 * mistral-http.js — mit Mistral reden.
 *
 * DRITTER SCHNITT aus mistral.js, 31.08.2026. Hier steht alles, was den
 * Netzzugriff betrifft und sonst nichts: Zugangsschluessel holen, Anfrage
 * stellen, Antwort lesen (auch als Strom), Zeitgrenzen einhalten, eine
 * Ueberlastmeldung erkennen.
 *
 * WARUM DAS EINE EIGENE DATEI IST: Die Aufrufer weiter oben — der
 * Ein-Aufruf-Weg, der Drei-Aufruf-Weg, die Beast-Werbung — teilen sich genau
 * diese Schicht. Sie stand mitten zwischen ihnen; wer eine Zeitgrenze aendern
 * wollte, musste an drei Stellen suchen, ob sie noch woanders gilt.
 *
 * DIE RICHTUNG STIMMT: Diese Datei ruft NICHTS von oben auf. Sie liest die
 * Betriebswerte aus dem Einstellungssatz und gibt Ergebnisse zurueck — mehr
 * nicht. Das Auseinandernehmen der Antworten liegt in mistral-antwort.js.
 */

const { extrahiereLiveText } = require("./mistral-antwort");

const { MISTRAL_ENDPOINT } = require("./config");
const { geltendeWerte } = require("./betriebsprofil");
const { withMistralSlot } = require("./throttle");

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

let fetchImpl = (...args) => fetch(...args);

function setFetchForTest(impl) {
  fetchImpl = impl || ((...args) => fetch(...args));
}

function isRateLimitError(err) {
  /* v1.10.6: Throttle-Queue-Timeout wird auch als Rate-Limit-Signal behandelt.
     Wenn unsere eigene Drossel in throttle.js auflaeuft, ist Mistral aus
     Pipeline-Sicht ueberlastet — Der Aufrufer soll das als
     blocked.overloaded melden, damit der Client den Auto-Retry triggert. */
  if (err && err.code === "throttle_timeout") return true;
  const msg = (err.message || "").toLowerCase();
  return err.status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limited");
}

function modelClassOf(model) {
  return /large/i.test(model || "") ? "large" : "small";
}

function readCachedTokens(usage) {
  const candidates = [
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
  ];
  const hit = candidates.find((v) => typeof v === "number");
  return hit || 0;
}

let liveIntervalMs = 2000;

function _setLiveIntervalMsForTest(ms) {
  liveIntervalMs = typeof ms === "number" ? ms : 2000;
}

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

module.exports = {
  /* Auch die Aufrufer weiter oben holen ihre Betriebswerte hierueber — sie
     brauchen dieselbe Pruefung "Satz da oder Abbruch". */
  betriebswerteOderAbbruch,
  callMistralRaw,
  callMistralRawUnthrottled,
  isRateLimitError,
  setFetchForTest,
  _setLiveIntervalMsForTest,
};
