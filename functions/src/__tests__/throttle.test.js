const {
  createSemaphore,
  withMistralSlot,
  getMistralStats,
  DEFAULT_MAX_CONCURRENT,
  _setRateIntervalMs,
  _resetRateBucket,
} = require("../throttle");

/* v1.10.6: Token-Bucket fuer Tests deaktivieren — der modul-globale Rate-Limiter
   (1 RPS in Production) wuerde alle Mehrfach-Operation-Tests auf je >=1s
   ausdehnen. Fuer Test-Isolation reicht es, die Pause zu deaktivieren; die
   Rate-Limit-Logik wird separat getestet. */
beforeEach(() => {
  _setRateIntervalMs(0);
  _resetRateBucket();
});

afterAll(() => {
  /* Wiederherstellen, falls andere Test-Files den Token-Bucket sehen */
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

describe("createSemaphore — basic acquire/release", () => {
  test("allows up to maxConcurrent calls without waiting", async () => {
    const sem = createSemaphore({ maxConcurrent: 3 });
    const releases = await Promise.all([sem.acquire(), sem.acquire(), sem.acquire()]);
    expect(sem.stats().inFlight).toBe(3);
    expect(sem.stats().queued).toBe(0);
    releases.forEach((r) => r());
    expect(sem.stats().inFlight).toBe(0);
  });

  test("queues additional calls beyond maxConcurrent", async () => {
    const sem = createSemaphore({ maxConcurrent: 2 });
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.stats().inFlight).toBe(2);

    /* Dritte acquire startet aber pendet */
    const thirdPromise = sem.acquire();
    /* Mikro-Wartezeit damit die Queue-Eintragung sichtbar wird */
    await new Promise((r) => setTimeout(r, 0));
    expect(sem.stats().queued).toBe(1);

    /* Slot freigeben → dritter Caller bekommt seinen Slot */
    r1();
    const r3 = await thirdPromise;
    expect(sem.stats().inFlight).toBe(2);
    expect(sem.stats().queued).toBe(0);

    r2();
    r3();
    expect(sem.stats().inFlight).toBe(0);
  });

  test("respects FIFO order in queue", async () => {
    const sem = createSemaphore({ maxConcurrent: 1 });
    const r1 = await sem.acquire();

    const order = [];
    const p2 = sem.acquire().then((r) => {
      order.push("second");
      return r;
    });
    const p3 = sem.acquire().then((r) => {
      order.push("third");
      return r;
    });

    r1(); /* Triggert zweiten */
    const r2 = await p2;
    expect(order).toEqual(["second"]);

    r2(); /* Triggert dritten */
    const r3 = await p3;
    expect(order).toEqual(["second", "third"]);
    r3();
  });

  test("release is idempotent", async () => {
    const sem = createSemaphore({ maxConcurrent: 1 });
    const release = await sem.acquire();
    release();
    release(); /* sollte nichts machen */
    expect(sem.stats().inFlight).toBe(0);
  });

  test("queue timeout rejects waiting acquire after configured ms", async () => {
    const sem = createSemaphore({ maxConcurrent: 1, queueTimeoutMs: 50 });
    const release = await sem.acquire();
    await expect(sem.acquire()).rejects.toMatchObject({ code: "throttle_timeout" });
    expect(sem.stats().inFlight).toBe(1);
    expect(sem.stats().queued).toBe(0);
    release();
  });
});

describe("withMistralSlot wrapper", () => {
  test("releases the slot after successful operation", async () => {
    const before = getMistralStats().inFlight;
    const result = await withMistralSlot(async () => "ok");
    expect(result).toBe("ok");
    expect(getMistralStats().inFlight).toBe(before);
  });

  test("releases the slot when operation throws", async () => {
    const before = getMistralStats().inFlight;
    await expect(
      withMistralSlot(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(getMistralStats().inFlight).toBe(before);
  });

  test("allows multiple concurrent operations within limit", async () => {
    let maxObservedInFlight = 0;
    const ops = Array.from({ length: 5 }, () =>
      withMistralSlot(async () => {
        maxObservedInFlight = Math.max(maxObservedInFlight, getMistralStats().inFlight);
        await new Promise((r) => setTimeout(r, 10));
      })
    );
    await Promise.all(ops);
    /* Mindestens 2 parallel sollten gesehen worden sein */
    expect(maxObservedInFlight).toBeGreaterThanOrEqual(2);
    /* Aber nie über das Default-Limit */
    expect(maxObservedInFlight).toBeLessThanOrEqual(DEFAULT_MAX_CONCURRENT);
    expect(getMistralStats().inFlight).toBe(0);
  });
});

describe("module constants", () => {
  test("DEFAULT_MAX_CONCURRENT matches Mistral Scale-Tier RPS limit", () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(6);
  });
});

describe("token-bucket rate limiter (v1.10.6)", () => {
  test("verteilt mehrere parallele Slot-Operationen auf das Interval", async () => {
    /* Interval bewusst klein, damit der Test schnell laeuft, aber gross genug
       um den Effekt messen zu koennen. */
    _setRateIntervalMs(200);
    _resetRateBucket();

    const startTimes = [];
    const ops = Array.from({ length: 5 }, () =>
      withMistralSlot(async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 10));
      })
    );
    const begin = Date.now();
    await Promise.all(ops);
    const elapsed = Date.now() - begin;

    /* 5 Ops bei 200ms Interval = mind. 4 × 200ms = 800ms Spread.
       (Erste Op darf sofort starten, dann je 200ms.) */
    expect(elapsed).toBeGreaterThanOrEqual(800);
    /* Start-Zeitpunkte sollten je ~200ms auseinander liegen */
    expect(startTimes.length).toBe(5);
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i] - startTimes[i - 1]).toBeGreaterThanOrEqual(180);
    }

    _setRateIntervalMs(0); /* zurueck zu „deaktiviert" fuer andere Tests */
  }, 10000);
});
