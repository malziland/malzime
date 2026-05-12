const { createSemaphore, withMistralSlot, getMistralStats, DEFAULT_MAX_CONCURRENT } = require("../throttle");

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
