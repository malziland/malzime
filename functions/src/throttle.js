"use strict";

/**
 * throttle.js — Per-Instance-Semaphore für Mistral-Bursts.
 *
 * Mistral-Scale-Tier hat 6 RPS Sustained-Limit. Wenn eine Cloud-Function-
 * Instanz mehrere Hybrid-Analysen parallel verarbeitet (Workshop-Klasse mit
 * 25 Schülern, alle laden gleichzeitig hoch), entstehen Burst-Spitzen die
 * 429-Errors triggern.
 *
 * Lösung: pro Instanz wird die Anzahl gleichzeitig in-flight Mistral-Calls
 * begrenzt. Eingehende Calls warten auf einen freien Slot statt sofort
 * 429-Retry-Backoff zu durchlaufen.
 *
 * Hinweis: Das ist eine PER-INSTANCE-Drossel. Bei N parallelen Function-
 * Instanzen multipliziert sich die effektive Last. Die Drossel ist daher
 * Best-Effort — die echte Defense ist mistral.js's eingebauter 429-Retry-
 * Mechanismus. Diese Schicht reduziert lediglich den Stress innerhalb einer
 * einzelnen Instanz.
 *
 * Implementierung: einfache FIFO-Queue mit max-concurrent-Limit.
 */

/* 6 ist konservativ und matched Mistrals 6 RPS Default-Limit auf Scale-Tier.
   Pro Analyse machen wir 3 Mistral-Calls (1 Describe + 2 Profile parallel) —
   damit kann eine einzelne Instanz alle 2-3 Sekunden eine vollständige
   Analyse durchschieben. Bei Cold-Start oder Workshop-Burst greift dann
   einfach mistral.js's Retry-Backoff. */
const DEFAULT_MAX_CONCURRENT = 6;

/* v1.10.6: Queue-Timeout von 90s auf 360s (6 Minuten) hochgesetzt.
   Hintergrund: Mistral braucht 60-90s pro Call, ein Slot wird also nur
   alle ~15s frei. Mit 45s/90s Queue-Timeout lief eine Anfrage in Position
   3+ schon mitten im Anstehen ins Out, ohne Mistral je angerufen zu haben.
   Mit 360s reicht es, dass der spaeteste Wartende immer noch durchkommt
   (~24 Plaetze × 15s = 360s). Cloud-Function-Timeout ist 540s, also
   bleibt nach dem Anstehen genug Zeit fuer den eigentlichen Mistral-Call. */
const DEFAULT_QUEUE_TIMEOUT_MS = 360000;

/**
 * Erzeugt einen neuen Semaphore.
 * Für Tests: man kann mehrere unabhängige Semaphoren erstellen.
 */
function createSemaphore(options = {}) {
  const maxConcurrent = options.maxConcurrent || DEFAULT_MAX_CONCURRENT;
  const queueTimeoutMs = options.queueTimeoutMs || DEFAULT_QUEUE_TIMEOUT_MS;

  let inFlight = 0;
  const waiters = [];

  /**
   * Wartet auf einen freien Slot. Returnt eine `release`-Funktion, die
   * der Caller aufrufen MUSS um den Slot freizugeben (auch im Error-Fall —
   * darum am besten try/finally).
   */
  async function acquire() {
    if (inFlight < maxConcurrent) {
      inFlight++;
      return makeRelease();
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timeoutId: null };

      waiter.timeoutId = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        const e = new Error(`Throttle queue timeout after ${queueTimeoutMs}ms`);
        e.code = "throttle_timeout";
        reject(e);
      }, queueTimeoutMs);

      waiters.push(waiter);
    });
  }

  function makeRelease() {
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      inFlight--;
      /* Ersten Waiter aufwecken, falls vorhanden */
      const next = waiters.shift();
      if (next) {
        clearTimeout(next.timeoutId);
        inFlight++;
        next.resolve(makeRelease());
      }
    };
  }

  function stats() {
    return { inFlight, queued: waiters.length, maxConcurrent };
  }

  return { acquire, stats };
}

/* Modul-globale Semaphore für die Mistral-Calls aus mistral.js / Hybrid-Pfad. */
const mistralSemaphore = createSemaphore();

/**
 * Token-Bucket-Rate-Limiter — v1.10.6 Fix nach Lasttest-Erkenntnis.
 *
 * Hintergrund: Die Semaphore limitiert PARALLELITAET (max 6 in-flight), aber
 * nicht die RATE. Wenn 6 Slots gleichzeitig frei sind und 6 neue Anfragen
 * reinkommen, bursten alle in derselben Millisekunde gegen Mistral → 6 RPS
 * Instant-Burst. × 6 Cloud-Run-Instanzen = bis zu 36 RPS Burst.
 * Mistrals Scale-Tier-Limit: 6 RPS sustained.
 *
 * Loesung: Pro Instanz darf maximal 1 Mistral-Call pro Sekunde *gestartet*
 * werden (1 RPS). 6 Instanzen × 1 RPS = 6 RPS — passt genau auf Mistrals Limit.
 * Slots bleiben weiter parallel (6 in-flight), aber der Start neuer Calls wird
 * geordnet entzerrt.
 *
 * Implementierung: serialisierte Warteschlange, jeder Caller darf erst dann
 * weiter, wenn seit dem letzten Token-Start TOKEN_INTERVAL_MS verstrichen sind.
 */
/* v1.10.7: 1500ms → 2500ms. Hintergrund: Mistral-Account-Dashboard zeigt
   fuer mistral-small-2603 (unser aktives Profile-Modell) ein RPS-Limit
   von 1.67/s (nicht 6/s wie urspruenglich angenommen). Mit 2500ms-Interval
   und max 4 Instanzen ergibt das 4 × 0.4 = 1.6 RPS gesamt, sicher unter
   1.67 RPS. Eliminiert die strukturelle 429-Quelle, kostet pro Mistral-Call
   ~1s zusaetzliche Wartezeit unter Last. */
const TOKEN_INTERVAL_MS = 2500;
/* v1.10.6: Initial-Jitter beim allerersten Token-Acquire pro Instanz.
   Verhindert, dass mehrere Instanzen gleichzeitig cold-starten und
   alle ihren ersten Mistral-Call in derselben Millisekunde feuern.
   Random 0-2000ms entzerrt diesen Cold-Start-Burst zuverlaessig. */
const INITIAL_JITTER_MAX_MS = 2000;
let currentTokenIntervalMs = TOKEN_INTERVAL_MS;
let currentInitialJitterMs = INITIAL_JITTER_MAX_MS;
let lastTokenAt = 0;
let isFirstAcquire = true;
let tokenChain = Promise.resolve();

async function acquireRateToken() {
  /* Serialisierung: jeder Aufruf wartet auf den vorherigen, dann pruefen wir
     wie viel Zeit seit dem letzten Token-Start verstrichen ist und warten
     den Rest des Intervalls ab. Beim allerersten Call dieser Instanz wird
     zusaetzlich ein Initial-Jitter eingehaengt. */
  const myTurn = tokenChain.then(async () => {
    if (currentTokenIntervalMs <= 0) {
      lastTokenAt = Date.now();
      isFirstAcquire = false;
      return;
    }
    if (isFirstAcquire && currentInitialJitterMs > 0) {
      const jitter = Math.random() * currentInitialJitterMs;
      if (jitter > 0) await new Promise((r) => setTimeout(r, jitter));
      isFirstAcquire = false;
    }
    const now = Date.now();
    const wait = Math.max(0, currentTokenIntervalMs - (now - lastTokenAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastTokenAt = Date.now();
  });
  tokenChain = myTurn.catch(() => {
    /* Fehler im Token-Loop nicht weitertragen — naechster Caller darf normal weiter */
  });
  return myTurn;
}

/* Fuer Tests: erlaubt den Rate-Limit-Cap zu deaktivieren oder verkuerzen,
   damit Test-Suites nicht von 1-Sekunden-Pausen serialisiert werden. */
function _setRateIntervalMs(ms) {
  currentTokenIntervalMs = Math.max(0, ms || 0);
}

/* Fuer Tests: Initial-Jitter deaktivieren, damit Tests nicht durch
   Zufalls-Pausen ueberraschend ausbremsen. */
function _setInitialJitterMs(ms) {
  currentInitialJitterMs = Math.max(0, ms || 0);
}

/**
 * Wrapper-Helper: führt eine Mistral-Operation aus, sobald ein Slot frei ist
 * UND ein Rate-Token verfuegbar ist. Slot wird IMMER released — auch wenn die
 * Operation wirft.
 */
async function withMistralSlot(fn) {
  const release = await mistralSemaphore.acquire();
  try {
    await acquireRateToken();
    return await fn();
  } finally {
    release();
  }
}

function getMistralStats() {
  return mistralSemaphore.stats();
}

/* Fuer Tests: erlaubt den Token-Bucket zu resetten, damit Test-Reihenfolge
   nicht stoert. */
function _resetRateBucket() {
  lastTokenAt = 0;
  isFirstAcquire = true;
  tokenChain = Promise.resolve();
}

module.exports = {
  createSemaphore,
  withMistralSlot,
  getMistralStats,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_QUEUE_TIMEOUT_MS,
  TOKEN_INTERVAL_MS,
  INITIAL_JITTER_MAX_MS,
  _resetRateBucket,
  _setRateIntervalMs,
  _setInitialJitterMs,
};
