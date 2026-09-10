"use strict";

/**
 * throttle.js — Per-Instance-Semaphore für Mistral-Bursts.
 *
 * RATE-LIMITS, STAND 2026-08-11 (KA-07): Mistral vergibt Limits als
 * STUFEN-SYSTEM nach kumuliertem Umsatz (T1 = 0,25 req/s bis 20 $; T2/T3/T4
 * darüber) — die früher hier notierten „6 RPS" stammen vom Mai-Dashboard und
 * sind ÜBERHOLT. Die reale Durchsatzbremse ist heute die Tier-Stufe, in der
 * Praxis gehalten durch `queueRatePerSekunde` im Einstellungssatz (die
 * globale Bremse der Warteschlange). Vor jeder Änderung an Nebenläufigkeit
 * oder dem Intervall unten: Tier-Stufe im Mistral-Dashboard prüfen, nicht
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

/* Wie viele Calls je Instanz gleichzeitig laufen, steht im Einstellungssatz
   (`drosselMaxParallel`) — eine konservative Parallelitäts-Decke: Die echte
   Raten-Grenze setzen Tier-Stufe und Warteschlange. Bei Cold-Start oder
   Workshop-Burst greift zusätzlich der Retry-Backoff in mistral-http.js. */

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

/* Modul-globale Semaphore für die Mistral-Calls aus mistral-http.js. */
const mistralSemaphore = createSemaphore();

/**
 * Token-Bucket-Rate-Limiter.
 *
 * Hintergrund: Die Semaphore limitiert PARALLELITAET (`drosselMaxParallel`),
 * aber nicht die RATE. Wenn mehrere Slots gleichzeitig frei werden, bursten
 * neue Calls in derselben Millisekunde gegen Mistrals Limit. Der Token-Bucket
 * entzerrt das: Jeder Caller wartet, bis seit dem letzten Start genug Zeit
 * verstrichen ist (`tokenAbstandGrossMs`). Er zaehlt nur je Instanz — die
 * verlaessliche Bremse ueber alle Instanzen ist `queueRatePerSekunde` in der
 * Warteschlange (KA-07: Mistral vergibt Limits als Stufen, T1 = 0,25 req/s
 * org-weit). Wer hier schneller drehen will, prueft ZUERST die Tier-Stufe im
 * Mistral-Dashboard.
 *
 * Bis 10.09.2026 gab es je Modell-Typ einen eigenen Bucket (v1.10.8); seit dem
 * Ausbau des Drei-Aufruf-Wegs gibt es nur noch ein Modell und einen Bucket.
 */
/* Initial-Jitter beim allerersten Token-Acquire pro Instanz. Verhindert, dass
   mehrere frisch gestartete Cloud-Run-Instanzen ihren ersten Call in derselben
   Millisekunde feuern. */
const INITIAL_JITTER_MAX_MS = 2000;

/**
 * Erzeugt einen unabhaengigen Token-Bucket (im Betrieb genau einer je
 * Instanz; Tests erzeugen eigene).
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
/* EIN Takt fuer alle Aufrufe: Mistral zaehlt Anfragen, nicht deren Groesse,
   und seit dem Ausbau des Drei-Aufruf-Wegs (10.09.2026) gibt es nur noch ein
   Modell. Bis dahin gab es einen zweiten Takt fuer das kleine Modell. */
const rateBucket = createRateBucket(0);

/**
 * Wrapper-Helper: führt eine Mistral-Operation aus, sobald ein Slot frei ist
 * UND ein Rate-Token verfuegbar ist. Slot wird IMMER released — auch wenn
 * die Operation wirft.
 *
 * @param {Function} fn     auszufuehrende Mistral-Operation
 * @param {object}   werte  Einstellungssatz (Drosselwerte)
 */
/* Uebernimmt die Drosselwerte aus dem Einstellungssatz. Wird vor jedem
   Mistral-Aufruf gerufen; die Setter gab es schon, sie wurden bisher nur von
   Tests benutzt. So gibt es die Zahlen nur EINMAL — im Satz. */
function drosselEinstellen(werte) {
  if (!werte) return;
  mistralSemaphore.setMaxConcurrent(werte.drosselMaxParallel);
  mistralSemaphore.setQueueTimeoutMs(werte.drosselWartelimitMs);
  rateBucket.setIntervalMs(werte.tokenAbstandGrossMs);
}

async function withMistralSlot(fn, werte) {
  drosselEinstellen(werte);
  const release = await mistralSemaphore.acquire();
  try {
    await rateBucket.acquire();
    return await fn();
  } finally {
    release();
  }
}

function getMistralStats() {
  return mistralSemaphore.stats();
}

/* Fuer Tests: den Takt konfigurieren/zuruecksetzen — sonst
   serialisiert der Rate-Limiter parallele Test-Operationen auf Sekunden. */
function _setRateIntervalMs(ms) {
  rateBucket.setIntervalMs(ms);
}

function _resetRateBucket() {
  rateBucket.reset();
}

module.exports = {
  createSemaphore,
  createRateBucket,
  withMistralSlot,
  getMistralStats,
  INITIAL_JITTER_MAX_MS,
  _resetRateBucket,
  _setRateIntervalMs,
};
