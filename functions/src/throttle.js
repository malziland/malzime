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

/* Wenn ein Slot nach diesem Timeout nicht frei wurde, geben wir auf —
   sonst staut sich die Queue endlos. Cloud-Function-Limit ist 120s, also
   nicht zu nah dran. */
const DEFAULT_QUEUE_TIMEOUT_MS = 90000;

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
 * Wrapper-Helper: führt eine Mistral-Operation aus, sobald ein Slot frei ist.
 * Slot wird IMMER released — auch wenn die Operation wirft.
 */
async function withMistralSlot(fn) {
  const release = await mistralSemaphore.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function getMistralStats() {
  return mistralSemaphore.stats();
}

module.exports = {
  createSemaphore,
  withMistralSlot,
  getMistralStats,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_QUEUE_TIMEOUT_MS,
};
