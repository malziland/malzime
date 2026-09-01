/**
 * cloud-tasks-riegel.test.js — haelt der Riegel, der die Produktion schuetzt?
 *
 * VORFALL 30.08.2026: Ein Testlauf stellte die Produktions-Warteschlange um
 * (7/0,5 und 14/0,5 — die Werte aus test-satz.js). Zehn Stunden lang lief die
 * Auslieferung auf vierfachem Tempo gegen Mistrals Grenze; am Morgen kamen
 * zwei Ueberlastmeldungen, und ein Nutzer sah eine Fehlermeldung. Daraufhin
 * entstand `testUmgebungGrund()` in cloud-tasks.js.
 *
 * BEFUND 01.09.2026 (Mutationsprobe): Der Riegel selbst war von KEINEM Test
 * gedeckt. Beide Bedingungen liessen sich umdrehen — `&&` zu `||` in
 * `if (emulator && !clientOverride)` —, ohne dass ein einziger Test rot wurde.
 * Der Riegel funktionierte, aber nichts hielt ihn fest. Ein Schutz, den man
 * versehentlich entfernen kann, ohne dass es auffaellt, ist ein Schutz auf
 * Zeit.
 *
 * Geprueft wird die Entscheidung selbst: Wann sagt der Riegel "nein", und
 * wann laesst er durch?
 */

const cloudTasks = require("../cloud-tasks");

const ALT = { ...process.env };

/** Eine Attrappe, die aufzeichnet, ob die Warteschlange angefasst wurde. */
function attrappe() {
  const aufrufe = [];
  return {
    aufrufe,
    queuePath: (p, r, n) => `projects/${p}/locations/${r}/queues/${n}`,
    async createTask(anfrage) {
      aufrufe.push(["createTask", anfrage]);
      return [{ name: "task-1" }];
    },
    async getQueue() {
      aufrufe.push(["getQueue"]);
      return [{ rateLimits: { maxDispatchesPerSecond: 0.125, maxConcurrentDispatches: 4 } }];
    },
    async updateQueue(anfrage) {
      aufrufe.push(["updateQueue", anfrage]);
      return [{ rateLimits: { maxDispatchesPerSecond: 0.125, maxConcurrentDispatches: 4 } }];
    },
  };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  /* Ohne Projektkennung steigt warteschlangeNachziehen mit "kein Projekt
     bekannt" aus, BEVOR der Riegel drankommt — die Pruefung haette dann den
     falschen Ausgang gemessen und waere aus dem falschen Grund gruen. */
  process.env.GCLOUD_PROJECT = "malzime-test";
});

afterEach(() => {
  process.env = { ...ALT };
  cloudTasks.setClientForTest(null);
  jest.restoreAllMocks();
});

describe("Aus einem Testlauf wird die echte Warteschlange nie angefasst", () => {
  test("ohne Attrappe fasst warteschlangeNachziehen die Queue nicht an", async () => {
    /* JEST_WORKER_ID setzt Jest selbst — genau die Lage eines gewoehnlichen
       Laufs. Ohne hinterlegte Attrappe muss der Riegel greifen. */
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    cloudTasks.setClientForTest(null);

    const ergebnis = await cloudTasks.warteschlangeNachziehen({
      parallelitaet: 99,
      queueRatePerSekunde: 9,
    });

    expect(ergebnis.ok).toBe(false);
    expect(String(ergebnis.grund)).toMatch(/Test|Attrappe/i);
  });

  test("mit Attrappe laeuft der Weg durch — der Riegel ist nicht dauerhaft zu", async () => {
    /* Gegenprobe. Ohne sie koennte der Riegel auf "immer nein" stehen, und
       nichts wuerde belegen, dass die Warteschlange im Betrieb ueberhaupt
       nachgezogen wird. */
    const a = attrappe();
    cloudTasks.setClientForTest(a);

    const ergebnis = await cloudTasks.warteschlangeNachziehen({
      parallelitaet: 4,
      queueRatePerSekunde: 0.125,
    });

    expect(ergebnis.ok).toBe(true);
    expect(a.aufrufe.some(([name]) => name === "getQueue")).toBe(true);
  });

  test("auch enqueueJob kommt ohne Attrappe nicht an die echte Queue", async () => {
    /* BEFUND Runde 2: Der Riegel stand einmal NUR in warteschlangeNachziehen.
       enqueueJob — der Weg jedes echten Auftrags — hatte ihn nicht. */
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.CLOUD_TASKS_EMULATOR_HOST;
    cloudTasks.setClientForTest(null);

    await expect(cloudTasks.enqueueJob("job-1")).rejects.toThrow(/Test|Attrappe/i);
  });
});

describe("Der Emulator-Zweig", () => {
  /* Diese Faelle pruefen die ENTSCHEIDUNG isoliert, nicht ueber
     `warteschlangeNachziehen`. Grund: Dort greift der Jest-Riegel zuerst und
     verdeckt den Emulator-Zweig — die erste Fassung dieser Datei mass genau
     das und blieb deshalb gruen, obwohl die Emulator-Erkennung mutiert war.
     Den Jest-Riegel abzuschalten, um daran vorbeizukommen, waere gefaehrlich:
     Bei kaputter Bedingung ginge der Aufruf an die ECHTE Warteschlange. */
  test.each([
    ["FIRESTORE_EMULATOR_HOST", "localhost:8080"],
    ["FUNCTIONS_EMULATOR", "true"],
    ["CLOUD_TASKS_EMULATOR_HOST", "localhost:9090"],
  ])("%s allein genuegt, damit die echte Queue tabu ist", (name, wert) => {
    /* Deckt `||` gegen `&&` ab: Mit `&&` muessten ALLE DREI gesetzt sein,
       damit der Emulator erkannt wird — ein Lauf mit nur einer Variablen
       ginge dann an die echte Warteschlange. */
    const alt = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID; // sonst antwortet der Jest-Riegel
    process.env[name] = wert;
    try {
      const grund = cloudTasks._testUmgebungGrund(null);
      expect(grund).toMatch(/Emulator/i);
    } finally {
      if (alt !== undefined) process.env.JEST_WORKER_ID = alt;
    }
  });

  test("ohne jede Emulator-Variable und ohne Jest greift der Riegel NICHT", () => {
    /* Gegenprobe: Sonst koennte die Erkennung auf "immer Emulator" stehen,
       und die Warteschlange liesse sich im Betrieb nie nachziehen. */
    const alt = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.CLOUD_TASKS_EMULATOR_HOST;
    try {
      expect(cloudTasks._testUmgebungGrund(null)).toBeNull();
    } finally {
      if (alt !== undefined) process.env.JEST_WORKER_ID = alt;
    }
  });

  test("aus einem Testlauf ohne Attrappe greift er immer", () => {
    expect(cloudTasks._testUmgebungGrund(null)).toMatch(/Test|Attrappe/i);
  });

  test("mit Attrappe wirkt der Emulator-Zweig nicht sperrend", async () => {
    /* Deckt `&&` gegen `||` in `if (emulator && !clientOverride)` ab: Mit
       `||` wuerde eine gesetzte Emulator-Variable auch dann sperren, wenn
       eine Attrappe hinterlegt ist — der Lokal-Modus koennte dann seine
       eigenen Tests nicht mehr fahren. */
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    const a = attrappe();
    cloudTasks.setClientForTest(a);

    const ergebnis = await cloudTasks.warteschlangeNachziehen({
      parallelitaet: 4,
      queueRatePerSekunde: 0.125,
    });

    expect(ergebnis.ok).toBe(true);
  });
});
