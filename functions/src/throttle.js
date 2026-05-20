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
 * Token-Bucket-Rate-Limiter — modell-bewusst seit v1.10.8.
 *
 * Hintergrund: Die Semaphore limitiert PARALLELITAET (max 6 in-flight), aber
 * nicht die RATE. Wenn mehrere Slots gleichzeitig frei werden, bursten neue
 * Calls in derselben Millisekunde gegen Mistrals RPS-Limit. Der Token-Bucket
 * entzerrt das: jeder Caller wartet, bis seit dem letzten Start des gleichen
 * Modell-Typs genug Zeit verstrichen ist.
 *
 * v1.10.8 — getrennte Buckets pro Modell-Typ: Das Mistral-Account-Dashboard
 * zeigt SEHR unterschiedliche Limits je Modell:
 *   - mistral-large-2512 (Describe + Profile-Fallback): 6 RPS, 2M TPM
 *   - mistral-small-2603 (Profile normal/boost):        1.67 RPS, 100K TPM
 * Ein gemeinsamer Bucket muss sich am LANGSAMSTEN Modell orientieren — wir
 * haetten also auch die Large-Describe-Calls auf 1.6 RPS gedrosselt, obwohl
 * Large 6 RPS koennte. Mit getrennten Buckets laeuft Describe ~3x schneller,
 * was den Wartezeit-Tail unter Workshop-Last spuerbar kuerzt.
 *
 * Intervalle (bei maxInstances=4, siehe index.js):
 *   - Large: 800ms/Instanz → 4 × 1.25 = 5 RPS gesamt, unter dem 6-RPS-Limit
 *   - Small: 2500ms/Instanz → 4 × 0.4 = 1.6 RPS gesamt, unter dem 1.67-Limit
 */
const LARGE_TOKEN_INTERVAL_MS = 800;
const SMALL_TOKEN_INTERVAL_MS = 2500;
/* Initial-Jitter beim allerersten Token-Acquire pro Instanz. Verhindert, dass
   mehrere frisch gestartete Cloud-Run-Instanzen ihren ersten Call in derselben
   Millisekunde feuern. */
const INITIAL_JITTER_MAX_MS = 2000;

/**
 * Erzeugt einen unabhaengigen Token-Bucket. Jeder Modell-Typ bekommt einen
 * eigenen, damit langsame Modelle nicht die schnellen ausbremsen.
 */
function createRateBucket(defaultIntervalMs) {
  let intervalMs = defaultIntervalMs;
  let initialJitterMs = INITIAL_JITTER_MAX_MS;
  let lastTokenAt = 0;
  let isFirstAcquire = true;
  let chain = Promise.resolve();

  async function acquire() {
    /* Serialisierung: jeder Aufruf wartet auf den vorherigen, dann pruefen wir
       wie viel Zeit seit dem letzten Token-Start verstrichen ist und warten
       den Rest des Intervalls ab. */
    const myTurn = chain.then(async () => {
      if (intervalMs <= 0) {
        lastTokenAt = Date.now();
        isFirstAcquire = false;
        return;
      }
      if (isFirstAcquire && initialJitterMs > 0) {
        const jitter = Math.random() * initialJitterMs;
        if (jitter > 0) await new Promise((r) => setTimeout(r, jitter));
        isFirstAcquire = false;
      }
      const now = Date.now();
      const wait = Math.max(0, intervalMs - (now - lastTokenAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastTokenAt = Date.now();
    });
    chain = myTurn.catch(() => {
      /* Fehler im Token-Loop nicht weitertragen — naechster Caller darf normal weiter */
    });
    return myTurn;
  }

  return {
    acquire,
    setIntervalMs(ms) {
      intervalMs = Math.max(0, ms || 0);
    },
    setInitialJitterMs(ms) {
      initialJitterMs = Math.max(0, ms || 0);
    },
    reset() {
      lastTokenAt = 0;
      isFirstAcquire = true;
      chain = Promise.resolve();
    },
  };
}

const largeBucket = createRateBucket(LARGE_TOKEN_INTERVAL_MS);
const smallBucket = createRateBucket(SMALL_TOKEN_INTERVAL_MS);

function bucketFor(modelClass) {
  return modelClass === "large" ? largeBucket : smallBucket;
}

/**
 * Wrapper-Helper: führt eine Mistral-Operation aus, sobald ein Slot frei ist
 * UND ein Rate-Token des passenden Modell-Typs verfuegbar ist. Slot wird IMMER
 * released — auch wenn die Operation wirft.
 *
 * @param {Function} fn         auszufuehrende Mistral-Operation
 * @param {string}   modelClass "large" oder "small" — bestimmt den Token-Bucket
 */
async function withMistralSlot(fn, modelClass) {
  const release = await mistralSemaphore.acquire();
  try {
    await bucketFor(modelClass).acquire();
    return await fn();
  } finally {
    release();
  }
}

function getMistralStats() {
  return mistralSemaphore.stats();
}

/* Fuer Tests: beide Buckets zugleich konfigurieren/zuruecksetzen — sonst
   serialisiert der Rate-Limiter parallele Test-Operationen auf Sekunden. */
function _setRateIntervalMs(ms) {
  largeBucket.setIntervalMs(ms);
  smallBucket.setIntervalMs(ms);
}

function _setInitialJitterMs(ms) {
  largeBucket.setInitialJitterMs(ms);
  smallBucket.setInitialJitterMs(ms);
}

function _resetRateBucket() {
  largeBucket.reset();
  smallBucket.reset();
}

module.exports = {
  createSemaphore,
  createRateBucket,
  withMistralSlot,
  getMistralStats,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_QUEUE_TIMEOUT_MS,
  LARGE_TOKEN_INTERVAL_MS,
  SMALL_TOKEN_INTERVAL_MS,
  INITIAL_JITTER_MAX_MS,
  _resetRateBucket,
  _setRateIntervalMs,
  _setInitialJitterMs,
};
