"use strict";

/**
 * throttle.js — Per-Instance-Semaphore für Mistral-Bursts.
 *
 * RATE-LIMITS, STAND 2026-08-11 (KA-07): Mistral vergibt Limits als
 * STUFEN-SYSTEM nach kumuliertem Umsatz (T1 = 0,25 req/s bis 20 $; T2/T3/T4
 * darüber) — die früher hier notierten „6 RPS" stammen vom Mai-Dashboard und
 * sind ÜBERHOLT. Die reale Durchsatzbremse ist heute die Tier-Stufe, in der
 * Praxis gehalten durch die Cloud-Tasks-Nebenläufigkeit (7 gleichzeitige
 * Jobs à ~55 s ≈ 0,25 req/s). Vor jeder Änderung an Nebenläufigkeit oder
 * den Intervallen unten: Tier-Stufe im Mistral-Dashboard prüfen, nicht
 * Kommentare zitieren.
 *
 * Wenn eine Cloud-Function-Instanz mehrere Analysen parallel verarbeitet
 * (Workshop-Klasse mit 25 Schülern, alle laden gleichzeitig hoch), entstehen
 * Burst-Spitzen, die 429-Errors triggern.
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

/* 6 gleichzeitige Calls je Instanz — historisch am alten 6-RPS-Dashboard-Wert
   ausgerichtet (überholt, s. Datei-Kopf), heute schlicht eine konservative
   Parallelitäts-Decke: Die echte Raten-Grenze setzen Tier-Stufe und
   Cloud-Tasks-Nebenläufigkeit. Bei Cold-Start oder Workshop-Burst greift
   zusätzlich mistral.js' Retry-Backoff. */

/* v1.10.6: Queue-Timeout von 90s auf 360s (6 Minuten) hochgesetzt.
   Hintergrund: Mistral braucht 60-90s pro Call, ein Slot wird also nur
   alle ~15s frei. Mit 45s/90s Queue-Timeout lief eine Anfrage in Position
   3+ schon mitten im Anstehen ins Out, ohne Mistral je angerufen zu haben.
   Mit 360s reicht es, dass der spaeteste Wartende immer noch durchkommt
   (~24 Plaetze × 15s = 360s). Cloud-Function-Timeout ist 540s, also
   bleibt nach dem Anstehen genug Zeit fuer den eigentlichen Mistral-Call. */

/**
 * Erzeugt einen neuen Semaphore.
 * Für Tests: man kann mehrere unabhängige Semaphoren erstellen.
 */
function createSemaphore(options = {}) {
  /* Startwerte nur fuer den Moment zwischen Modulladen und erstem Aufruf —
     danach setzt drosselEinstellen() die Werte aus dem Einstellungssatz.
     Sie sind bewusst eng: Wer nie eingestellt wird, drosselt lieber zu viel. */
  let maxConcurrent = options.maxConcurrent || 1;
  let queueTimeoutMs = options.queueTimeoutMs || 60000;

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

  /* Setter, damit die Werte aus dem Einstellungssatz greifen koennen. Ein
     Semaphore lebt so lange wie die Instanz — ohne sie waere eine Umstellung
     erst nach einem Neustart wirksam geworden. */
  function setMaxConcurrent(n) {
    if (typeof n === "number" && n > 0) maxConcurrent = n;
  }
  function setQueueTimeoutMs(ms) {
    if (typeof ms === "number" && ms > 0) queueTimeoutMs = ms;
  }

  return { acquire, stats, setMaxConcurrent, setQueueTimeoutMs };
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
 * v1.10.8 — getrennte Buckets pro Modell-Typ: Das damalige Account-Dashboard
 * (Mai 2026) zeigte sehr unterschiedliche Limits je Modell; ein gemeinsamer
 * Bucket haette sich am LANGSAMSTEN orientieren muessen. Die getrennten
 * Buckets bleiben sinnvoll (Describe soll nicht hinter Profile-Calls warten),
 * aber die Intervalle unten stammen aus der Mai-Rechnung — KA-07: Heute gilt
 * das TIER-System (T1 = 0,25 req/s org-weit, s. config.js). Die Intervalle
 * sind damit KEINE Garantie mehr, unter dem Limit zu bleiben; das
 * uebernimmt real die Cloud-Tasks-Nebenlaeufigkeit (7). Wer hier schneller
 * drehen will, prueft ZUERST die Tier-Stufe im Mistral-Dashboard.
 */
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

/* Startwert 0 = keine Drosselung, bis der Einstellungssatz sie setzt. Der
   Semaphore davor laesst in diesem Moment ohnehin nur einen Aufruf durch. */
const largeBucket = createRateBucket(0);
const smallBucket = createRateBucket(0);

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
/* Uebernimmt die Drosselwerte aus dem Einstellungssatz. Wird vor jedem
   Mistral-Aufruf gerufen; die Setter gab es schon, sie wurden bisher nur von
   Tests benutzt. So gibt es die Zahlen nur EINMAL — im Satz. */
function drosselEinstellen(werte) {
  if (!werte) return;
  mistralSemaphore.setMaxConcurrent(werte.drosselMaxParallel);
  mistralSemaphore.setQueueTimeoutMs(werte.drosselWartelimitMs);
  largeBucket.setIntervalMs(werte.tokenAbstandGrossMs);
  smallBucket.setIntervalMs(werte.tokenAbstandKleinMs);
}

async function withMistralSlot(fn, modelClass, werte) {
  drosselEinstellen(werte);
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
  INITIAL_JITTER_MAX_MS,
  _resetRateBucket,
  _setRateIntervalMs,
  _setInitialJitterMs,
};
