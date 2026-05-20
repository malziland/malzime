/* Tests für jobs.js — Job-Verwaltung der Queue-Architektur (v2.0).
   Nutzt einen In-Memory-Firestore-Mock, damit die Tests echtes Verhalten
   prüfen (Status-Übergänge, Idempotenz, Positions-Zählung) statt nur
   Mock-Aufrufe abzuhaken. */

const mockStore = new Map();
const mockState = { nextId: 1 };

jest.mock("firebase-admin/firestore", () => {
  function matchCond(data, c) {
    const v = data[c.field];
    if (c.op === "==") return v === c.value;
    if (c.op === "<") return v < c.value;
    if (c.op === ">") return v > c.value;
    return false;
  }
  function docRef(id) {
    return {
      id,
      async set(data) {
        mockStore.set(id, { ...data });
      },
      async get() {
        const data = mockStore.get(id);
        return { exists: data !== undefined, id, data: () => data };
      },
      async update(patch) {
        const cur = mockStore.get(id);
        if (cur === undefined) throw new Error("update on missing doc");
        mockStore.set(id, { ...cur, ...patch });
      },
      async delete() {
        mockStore.delete(id);
      },
    };
  }
  function query(conditions, limitN) {
    return {
      where(field, op, value) {
        return query([...conditions, { field, op, value }], limitN);
      },
      limit(n) {
        return query(conditions, n);
      },
      count() {
        return {
          async get() {
            let count = 0;
            for (const data of mockStore.values()) {
              if (conditions.every((c) => matchCond(data, c))) count += 1;
            }
            return { data: () => ({ count }) };
          },
        };
      },
      async get() {
        let matched = [];
        for (const [id, data] of mockStore.entries()) {
          if (conditions.every((c) => matchCond(data, c))) matched.push({ id, data });
        }
        if (limitN != null) matched = matched.slice(0, limitN);
        return { docs: matched.map(({ id, data }) => ({ id, data: () => data })) };
      },
    };
  }
  function collectionRef() {
    return {
      doc(id) {
        if (id === undefined) return docRef("job-" + mockState.nextId++);
        return docRef(id);
      },
      where(field, op, value) {
        return query([{ field, op, value }]);
      },
    };
  }
  const db = {
    collection() {
      return collectionRef();
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, patch) {
          const cur = mockStore.get(ref.id) || {};
          mockStore.set(ref.id, { ...cur, ...patch });
        },
      };
      return fn(tx);
    },
  };
  return { getFirestore: () => db };
});

const jobs = require("../jobs");
const { LIVENESS_GRACE_MS, JOB_RETENTION_MS } = require("../config");

beforeEach(() => {
  mockStore.clear();
  mockState.nextId = 1;
});

/* ── createJob ────────────────────────────────────────────────── */

describe("createJob", () => {
  test("legt einen Job mit Status queued an und gibt eine jobId zurück", async () => {
    const id = await jobs.createJob({ lang: "de", traceId: "abc123", imagePath: "queue-uploads/x.jpg" });
    expect(typeof id).toBe("string");
    const job = await jobs.getJob(id);
    expect(job.status).toBe("queued");
    expect(job.lang).toBe("de");
    expect(job.traceId).toBe("abc123");
    expect(job.imagePath).toBe("queue-uploads/x.jpg");
    expect(job.result).toBeNull();
    expect(job.attempts).toBe(0);
    expect(typeof job.createdAt).toBe("number");
    /* Liveness: bei Anlage gilt der Client als anwesend. */
    expect(job.lastSeenAt).toBe(job.createdAt);
  });

  test("setzt Default-Sprache de wenn keine angegeben", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/y.jpg" });
    const job = await jobs.getJob(id);
    expect(job.lang).toBe("de");
    expect(job.traceId).toBeNull();
  });
});

/* ── getJob ───────────────────────────────────────────────────── */

describe("getJob", () => {
  test("gibt null zurück für einen nicht existierenden Job", async () => {
    expect(await jobs.getJob("does-not-exist")).toBeNull();
  });
});

/* ── claimJob (Idempotenz) ────────────────────────────────────── */

describe("claimJob", () => {
  test("übernimmt einen queued-Job: true, Status processing, attempts hochgezählt", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/a.jpg" });
    const claimed = await jobs.claimJob(id);
    expect(claimed).toBe(true);
    const job = await jobs.getJob(id);
    expect(job.status).toBe("processing");
    expect(job.attempts).toBe(1);
    expect(typeof job.startedAt).toBe("number");
  });

  test("zweiter Claim auf denselben Job gibt false (kein Doppel-Processing)", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/b.jpg" });
    expect(await jobs.claimJob(id)).toBe(true);
    expect(await jobs.claimJob(id)).toBe(false);
  });

  test("Claim auf nicht existierenden Job gibt false", async () => {
    expect(await jobs.claimJob("missing")).toBe(false);
  });

  test("Claim auf bereits abgeschlossenen Job gibt false", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/c.jpg" });
    await jobs.claimJob(id);
    await jobs.completeJob(id, { categories: {} });
    expect(await jobs.claimJob(id)).toBe(false);
  });
});

/* ── completeJob / failJob ────────────────────────────────────── */

describe("completeJob / failJob", () => {
  test("completeJob: Status done, Ergebnis gespeichert", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/d.jpg" });
    await jobs.claimJob(id);
    await jobs.completeJob(id, { profileText: "Test" });
    const job = await jobs.getJob(id);
    expect(job.status).toBe("done");
    expect(job.result).toEqual({ profileText: "Test" });
    expect(job.errorReason).toBeNull();
    expect(typeof job.finishedAt).toBe("number");
  });

  test("failJob: Status failed, Grund gespeichert (auf 300 Zeichen begrenzt)", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/e.jpg" });
    await jobs.claimJob(id);
    await jobs.failJob(id, "Mistral HTTP 429");
    const job = await jobs.getJob(id);
    expect(job.status).toBe("failed");
    expect(job.errorReason).toBe("Mistral HTTP 429");
  });

  test("failJob: nicht-String-Grund wird zu 'unknown'", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/f.jpg" });
    await jobs.failJob(id, undefined);
    const job = await jobs.getJob(id);
    expect(job.errorReason).toBe("unknown");
  });
});

/* ── getQueuePosition ─────────────────────────────────────────── */

describe("getQueuePosition", () => {
  test("zählt die queued-Jobs, die vor dem aktuellen erstellt wurden", async () => {
    const id1 = await jobs.createJob({ imagePath: "queue-uploads/1.jpg" });
    const id2 = await jobs.createJob({ imagePath: "queue-uploads/2.jpg" });
    const id3 = await jobs.createJob({ imagePath: "queue-uploads/3.jpg" });
    /* createdAt auf eindeutige, aufsteigende Werte setzen (Tests laufen
       schneller als die Millisekunden-Auflösung). */
    mockStore.get(id1).createdAt = 1000;
    mockStore.get(id2).createdAt = 2000;
    mockStore.get(id3).createdAt = 3000;

    expect(await jobs.getQueuePosition(await jobs.getJob(id1))).toBe(0); // als nächstes dran
    expect(await jobs.getQueuePosition(await jobs.getJob(id2))).toBe(1);
    expect(await jobs.getQueuePosition(await jobs.getJob(id3))).toBe(2);
  });

  test("gibt 0 zurück für einen Job, der nicht mehr queued ist", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/g.jpg" });
    await jobs.claimJob(id);
    expect(await jobs.getQueuePosition(await jobs.getJob(id))).toBe(0);
  });

  test("gibt 0 zurück für null", async () => {
    expect(await jobs.getQueuePosition(null)).toBe(0);
  });

  test("bereits abgearbeitete Jobs zählen nicht zur Position", async () => {
    const idDone = await jobs.createJob({ imagePath: "queue-uploads/h.jpg" });
    const idWaiting = await jobs.createJob({ imagePath: "queue-uploads/i.jpg" });
    mockStore.get(idDone).createdAt = 1000;
    mockStore.get(idWaiting).createdAt = 2000;
    await jobs.claimJob(idDone);
    await jobs.completeJob(idDone, {});
    /* idDone ist jetzt done → zählt nicht mehr als „vor mir wartend" */
    expect(await jobs.getQueuePosition(await jobs.getJob(idWaiting))).toBe(0);
  });
});

/* ── markFailedIfStale ────────────────────────────────────────── */

describe("markFailedIfStale", () => {
  test("frischer processing-Job bleibt unverändert", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/j.jpg" });
    await jobs.claimJob(id);
    const job = await jobs.getJob(id);
    const result = await jobs.markFailedIfStale(job);
    expect(result.status).toBe("processing");
  });

  test("processing-Job über dem Timeout wird auf failed gesetzt", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/k.jpg" });
    await jobs.claimJob(id);
    /* startedAt künstlich weit in die Vergangenheit setzen */
    mockStore.get(id).startedAt = Date.now() - jobs.PROCESSING_TIMEOUT_MS - 1000;
    const job = await jobs.getJob(id);
    const result = await jobs.markFailedIfStale(job);
    expect(result.status).toBe("failed");
    expect(result.errorReason).toBe("processing_timeout");
    /* auch im Store persistiert */
    expect((await jobs.getJob(id)).status).toBe("failed");
  });

  test("queued-Job (nicht processing) wird nicht angefasst", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/l.jpg" });
    const job = await jobs.getJob(id);
    const result = await jobs.markFailedIfStale(job);
    expect(result.status).toBe("queued");
  });
});

/* ── Client-Liveness ──────────────────────────────────────────── */

describe("touchJob", () => {
  test("aktualisiert den Liveness-Herzschlag lastSeenAt", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/m.jpg" });
    mockStore.get(id).lastSeenAt = 1000; // künstlich alt
    await jobs.touchJob(id);
    expect(mockStore.get(id).lastSeenAt).toBeGreaterThan(1000);
  });
});

describe("abandonJob", () => {
  test("setzt den Job auf abandoned mit finishedAt", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/n.jpg" });
    await jobs.abandonJob(id);
    const job = await jobs.getJob(id);
    expect(job.status).toBe("abandoned");
    expect(typeof job.finishedAt).toBe("number");
  });
});

describe("isAbandoned", () => {
  test("true für einen queued-Job, dessen Herzschlag älter als das Karenz-Fenster ist", () => {
    expect(jobs.isAbandoned({ status: "queued", lastSeenAt: Date.now() - LIVENESS_GRACE_MS - 1000 })).toBe(true);
  });

  test("false für einen frisch gepollten queued-Job", () => {
    expect(jobs.isAbandoned({ status: "queued", lastSeenAt: Date.now() })).toBe(false);
  });

  test("false für nicht-wartende Jobs und null", () => {
    expect(jobs.isAbandoned({ status: "processing", lastSeenAt: 0 })).toBe(false);
    expect(jobs.isAbandoned({ status: "done", lastSeenAt: 0 })).toBe(false);
    expect(jobs.isAbandoned(null)).toBe(false);
  });
});

describe("findAbandonedJobs", () => {
  test("liefert nur queued-Jobs mit altem Herzschlag", async () => {
    const old1 = await jobs.createJob({ imagePath: "queue-uploads/1.jpg" });
    const old2 = await jobs.createJob({ imagePath: "queue-uploads/2.jpg" });
    const fresh = await jobs.createJob({ imagePath: "queue-uploads/3.jpg" });
    mockStore.get(old1).lastSeenAt = Date.now() - LIVENESS_GRACE_MS - 5000;
    mockStore.get(old2).lastSeenAt = Date.now() - LIVENESS_GRACE_MS - 5000;

    const found = await jobs.findAbandonedJobs();
    expect(found.map((j) => j.id).sort()).toEqual([old1, old2].sort());
    expect(found.some((j) => j.id === fresh)).toBe(false);
  });

  test("ein bereits übernommener Job (processing) zählt nicht", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/4.jpg" });
    mockStore.get(id).lastSeenAt = Date.now() - LIVENESS_GRACE_MS - 5000;
    await jobs.claimJob(id);
    expect(await jobs.findAbandonedJobs()).toEqual([]);
  });

  test("limit deckelt die Batch-Größe", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await jobs.createJob({ imagePath: `queue-uploads/x${i}.jpg` });
      mockStore.get(id).lastSeenAt = 1000;
    }
    expect((await jobs.findAbandonedJobs(3)).length).toBe(3);
  });
});

describe("findStaleProcessingJobs", () => {
  test("liefert nur processing-Jobs über dem Verarbeitungs-Timeout", async () => {
    const stale = await jobs.createJob({ imagePath: "queue-uploads/s.jpg" });
    const fresh = await jobs.createJob({ imagePath: "queue-uploads/f.jpg" });
    await jobs.claimJob(stale);
    await jobs.claimJob(fresh);
    mockStore.get(stale).startedAt = Date.now() - jobs.PROCESSING_TIMEOUT_MS - 5000;

    const found = await jobs.findStaleProcessingJobs();
    expect(found.map((j) => j.id)).toEqual([stale]);
  });

  test("ein wartender (queued) Job zählt nicht", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/q.jpg" });
    mockStore.get(id).startedAt = Date.now() - jobs.PROCESSING_TIMEOUT_MS - 5000;
    expect(await jobs.findStaleProcessingJobs()).toEqual([]);
  });
});

/* ── findExpiredJobs / deleteJob ──────────────────────────────── */

describe("findExpiredJobs", () => {
  test("liefert nur Job-Dokumente über dem Aufbewahrungsfenster — Status egal", async () => {
    const oldDone = await jobs.createJob({ imagePath: "queue-uploads/o.jpg" });
    const oldQueued = await jobs.createJob({ imagePath: "queue-uploads/p.jpg" });
    const fresh = await jobs.createJob({ imagePath: "queue-uploads/r.jpg" });
    mockStore.get(oldDone).createdAt = Date.now() - JOB_RETENTION_MS - 5000;
    mockStore.get(oldDone).status = "done";
    mockStore.get(oldQueued).createdAt = Date.now() - JOB_RETENTION_MS - 5000;

    const found = await jobs.findExpiredJobs();
    expect(found.map((j) => j.id).sort()).toEqual([oldDone, oldQueued].sort());
    expect(found.some((j) => j.id === fresh)).toBe(false);
  });

  test("limit deckelt die Batch-Größe", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await jobs.createJob({ imagePath: `queue-uploads/e${i}.jpg` });
      mockStore.get(id).createdAt = Date.now() - JOB_RETENTION_MS - 5000;
    }
    expect((await jobs.findExpiredJobs(3)).length).toBe(3);
  });
});

describe("deleteJob", () => {
  test("löscht das Job-Dokument endgültig", async () => {
    const id = await jobs.createJob({ imagePath: "queue-uploads/del.jpg" });
    expect(await jobs.getJob(id)).not.toBeNull();
    await jobs.deleteJob(id);
    expect(await jobs.getJob(id)).toBeNull();
  });
});
