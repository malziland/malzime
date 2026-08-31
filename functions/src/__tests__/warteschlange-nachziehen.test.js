"use strict";

/**
 * warteschlange-nachziehen.test.js
 *
 * Prueft `warteschlangeNachziehen()` — die Bruecke zwischen Einstellungssatz
 * und echter Cloud-Tasks-Queue.
 *
 * WARUM DIESE TESTS WICHTIG SIND: Alle anderen 26 Betriebswerte werden nur
 * GELESEN. Faellt Firestore aus, laeuft gar nichts — ein sauberer Zustand.
 * Dieser eine Wert wird GESCHRIEBEN, an ein fremdes System. Dabei entsteht ein
 * Zwischenzustand, den es sonst nirgends gibt: Bei uns steht X, bei Google
 * steht noch Y. Wer das nicht meldet, hat eine Einstellung, die luegt.
 */

const { setClientForTest, warteschlangeNachziehen } = require("../cloud-tasks");

/* Der echte Client redet mit Google. Hier eine Attrappe, die aufzeichnet,
   was sie gefragt wurde — und die auf Wunsch scheitert. */
function attrappe({ istRate, istParallel, schreibFehler, lesefehler } = {}) {
  const aufrufe = { gelesen: 0, geschrieben: 0, letztesUpdate: null };
  return {
    aufrufe,
    queuePath: (p, r, q) => `projects/${p}/locations/${r}/queues/${q}`,
    getQueue: async () => {
      aufrufe.gelesen += 1;
      if (lesefehler) throw new Error(lesefehler);
      return [
        {
          rateLimits: {
            maxDispatchesPerSecond: istRate,
            maxConcurrentDispatches: istParallel,
          },
        },
      ];
    },
    updateQueue: async (req) => {
      aufrufe.geschrieben += 1;
      aufrufe.letztesUpdate = req;
      if (schreibFehler) throw new Error(schreibFehler);
      return [{ rateLimits: req.queue.rateLimits }];
    },
  };
}

describe("warteschlangeNachziehen", () => {
  const alteUmgebung = process.env.GCLOUD_PROJECT;

  beforeEach(() => {
    process.env.GCLOUD_PROJECT = "malzime-test";
  });

  afterEach(() => {
    setClientForTest(null);
    if (alteUmgebung === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = alteUmgebung;
  });

  test("setzt Rate und Parallelitaet, wenn die Queue abweicht", async () => {
    const a = attrappe({ istRate: 3, istParallel: 7 });
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.ok).toBe(true);
    expect(r.geaendert).toBe(true);
    expect(r.rate).toBe(0.125);
    expect(r.parallel).toBe(4);
    /* Der alte Stand gehoert in die Meldung — sonst weiss niemand, was sich
       geaendert hat. */
    expect(r.vorherRate).toBe(3);
    expect(r.vorherParallel).toBe(7);
    expect(a.aufrufe.geschrieben).toBe(1);
  });

  test("schreibt NICHT, wenn die Queue schon richtig steht", async () => {
    const a = attrappe({ istRate: 0.125, istParallel: 4 });
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.ok).toBe(true);
    expect(r.geaendert).toBe(false);
    expect(a.aufrufe.geschrieben).toBe(0);
  });

  test("nennt beide Felder in der updateMask", async () => {
    /* Ohne updateMask setzt Google die uebrigen Felder der Queue zurueck —
       maxBurstSize und die Wiederholregeln inbegriffen. */
    const a = attrappe({ istRate: 3, istParallel: 7 });
    setClientForTest(a);

    await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    const pfade = a.aufrufe.letztesUpdate.updateMask.paths;
    expect(pfade).toContain("rate_limits.max_dispatches_per_second");
    expect(pfade).toContain("rate_limits.max_concurrent_dispatches");
    expect(pfade).toHaveLength(2);
  });

  test("wirft nicht, wenn das Schreiben scheitert — meldet es aber", async () => {
    const a = attrappe({ istRate: 3, istParallel: 7, schreibFehler: "PERMISSION_DENIED" });
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.ok).toBe(false);
    expect(r.grund).toContain("PERMISSION_DENIED");
  });

  test("wirft nicht, wenn das Lesen scheitert", async () => {
    const a = attrappe({ lesefehler: "UNAVAILABLE" });
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.ok).toBe(false);
    expect(r.grund).toContain("UNAVAILABLE");
    /* Wichtig: Kein Schreibversuch auf unbekanntem Stand. */
    expect(a.aufrufe.geschrieben).toBe(0);
  });

  test("meldet den TATSAECHLICH gesetzten Stand, nicht den gewuenschten", async () => {
    /* Negativprobe gegen den eigenen Test: Wenn Google etwas anderes setzt,
       als wir wollten, muss das durchschlagen. Ein Rueckgabewert, der nur den
       Wunsch wiederholt, waere wertlos. */
    const a = attrappe({ istRate: 3, istParallel: 7 });
    a.updateQueue = async () => [{ rateLimits: { maxDispatchesPerSecond: 1, maxConcurrentDispatches: 9 } }];
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.rate).toBe(1);
    expect(r.parallel).toBe(9);
  });

  test("RIEGEL: aus einem Test heraus wird die echte Queue NIE angefasst", async () => {
    /* VORFALL 30./31.08.2026: Ein Testlauf hat die PRODUKTIONS-Warteschlange
       umgestellt — dreimal, auf die Werte aus test-satz.js (7/0,5 und 14/0,5).
       Zehn Stunden lang lief die Auslieferung damit auf vierfachem Tempo gegen
       Mistrals Grenze; am Morgen kamen die ersten Ueberlastmeldungen bei
       echten Nutzern an.

       Der einzelne Test, der die Attrappe vergass, ist austauschbar. Dieser
       Riegel ist es nicht: Er greift fuer jeden Pfad, auch fuer den, den
       morgen jemand neu schreibt.

       Nachgemessen am 31.08.: Vorher 4/0,125 — Versuch, auf 99/9 zu stellen —
       nachher 4/0,125. */
    setClientForTest(null); /* KEINE Attrappe: der echte Client */
    process.env.GCLOUD_PROJECT = "malzime"; /* das echte Projekt */

    const r = await warteschlangeNachziehen({ parallelitaet: 99, queueRatePerSekunde: 9 });

    expect(r.ok).toBe(false);
    expect(r.grund).toContain("Test");
    expect(r.grund).toContain("setClientForTest");
  });

  test("ohne Projektkennung wird nichts angefasst", async () => {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    const a = attrappe({ istRate: 3, istParallel: 7 });
    setClientForTest(a);

    const r = await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });

    expect(r.ok).toBe(false);
    expect(a.aufrufe.gelesen).toBe(0);
    expect(a.aufrufe.geschrieben).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   OPS-2026-08-31-05 — der Riegel muss auch den EMULATOR kennen.

   Der Riegel gegen Jest allein genuegt nicht: Der Lasttest faehrt den
   Firebase-Emulator und laesst darin die echten Funktionen laufen. Jest laeuft
   dabei nicht — der Emulator holt sich bei angemeldetem Konto aber die
   Produktions-Zugangsdaten. Genau dieser Weg hat am 31.08. dazu gefuehrt, dass
   4.056 Testbilder im echten Bildspeicher lagen.
   ══════════════════════════════════════════════════════════════════════ */
describe("OPS-2026-08-31-05 — Emulator fasst die echte Warteschlange nicht an", () => {
  test("mit laufendem Emulator wird nicht gesetzt", async () => {
    jest.resetModules();
    const frisch = require("../cloud-tasks");
    frisch.setClientForTest(null);
    const alterJest = process.env.JEST_WORKER_ID;
    const alterEmu = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.JEST_WORKER_ID;
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    try {
      const r = await frisch.warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });
      expect(r.ok).toBe(false);
      expect(r.grund).toMatch(/Emulator/i);
    } finally {
      if (alterJest !== undefined) process.env.JEST_WORKER_ID = alterJest;
      if (alterEmu === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = alterEmu;
    }
  });
});
