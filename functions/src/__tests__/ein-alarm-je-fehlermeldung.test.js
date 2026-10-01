/* Ein Alarm je gescheiterter Analyse (01.10.2026).

   Zusage an Christoph: Sieht ein Kind nach einer Analyse eine Fehlermeldung,
   kommt genau EINE Nachricht "Analyse gescheitert" — nicht keine, nicht zwei.
   Der Alarm haengt an einer Fehlerzeile mit `alert: "analyse-gescheitert"`
   (docs/ERROR-ALERTING.md); jede andere Zeile mit severity ERROR loest den
   Alarm "Fehler im Server" aus. Gezaehlt wird deshalb JEDE Fehlerzeile.

   VORHER (4.13.1): Eine unlesbare KI-Antwort endete als
   `blocked.profileBlocked` ohne jede Fehlerzeile (Befund T-05); ein doppelter
   Abriss schrieb `single-large-failed` UND haette mit der zentralen Zeile
   zwei Nachrichten ergeben; ein Tierfoto, dessen Nachfrage scheiterte, loeste
   einen Fehlalarm aus, obwohl das Kind sein Profil bekam.

   Echter Weg: Worker (handle-process-job), Pipeline, mistral.js mit
   nachgestellter Mistral-Antwort, jobs.js mit einer Firestore-Attrappe samt
   Transaktion. Nachgestellt sind nur Speicher, Zaehler und Warteschlange.
   Ohne Netzwerk, ohne Cloud. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const mockStore = new Map();
jest.mock("firebase-admin/firestore", () => {
  function docRef(id) {
    return {
      id,
      async get() {
        const data = mockStore.get(id);
        return { exists: data !== undefined, id, data: () => data };
      },
      async update(patch) {
        const cur = mockStore.get(id);
        if (cur === undefined) throw new Error("update on missing doc");
        mockStore.set(id, { ...cur, ...patch });
      },
    };
  }
  const db = {
    collection: () => ({ doc: (id) => docRef(id) }),
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        update(ref, patch) {
          mockStore.set(ref.id, { ...(mockStore.get(ref.id) || {}), ...patch });
        },
      });
    },
  };
  return { getFirestore: () => db, Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) } };
});
jest.mock("../queue-storage", () => ({ loadImage: jest.fn(), deleteImage: jest.fn() }));
jest.mock("../counter", () => ({
  incrementTotals: jest.fn(() => Promise.resolve()),
  releaseHourlySlot: jest.fn(() => Promise.resolve()),
  zaehlerNachtragen: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../cloud-tasks", () => ({ redispatchJobLocal: jest.fn() }));
jest.mock("../durchsatz", () => ({ merkeDauer: jest.fn(() => Promise.resolve()) }));
jest.mock("../feature-flags", () => ({ isBeastAdsCallEnabled: jest.fn(async () => false) }));

const { handleProcessJob } = require("../handle-process-job");
const { setFetchForTest } = require("../mistral");
const { REQUIRED_CARDS } = require("../mistral-antwort");
const jobs = require("../jobs");
const storage = require("../queue-storage");

const JOB_ID = "auftrag-4711";

function makeRes() {
  return {
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
}

function karten(prefix) {
  const out = {};
  for (const k of REQUIRED_CARDS) out[k] = { label: k, value: `${prefix} ${k}`, confidence: 0.8 };
  return out;
}
const MENSCH = JSON.stringify({
  subject: "HUMAN",
  visible_text: "",
  ad_targeting: ["A"],
  manipulation_triggers: ["T"],
  standard: { profileText: "Du bist sachlich beschrieben.", categories: karten("S") },
  beast: { profileText: "Du bist zynisch beschrieben.", categories: karten("B") },
});

/* Wie Mistral: als Strom, wenn danach gefragt wurde (der Worker fragt immer
   mit Live-Text, auch im Neuversuch), sonst in einem Stueck (die Nachfrage
   nach fehlenden Karten). */
const gestreamt = (init) => JSON.parse(init.body).stream === true;
function sse(text, abreissen) {
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      (abreissen
        ? ""
        : `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`)
  );
  let gesendet = false;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      pull(controller) {
        if (!gesendet) {
          gesendet = true;
          controller.enqueue(bytes);
          return;
        }
        if (!abreissen) return controller.close();
        const grund = new Error("other side closed");
        grund.code = "UND_ERR_SOCKET";
        controller.error(new TypeError("terminated", { cause: grund }));
      },
    }),
  };
}
const antwort = (text) => (init) =>
  gestreamt(init)
    ? sse(text, false)
    : {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: {} }),
      };
const abriss = (init) =>
  gestreamt(init)
    ? sse('{"subj', true)
    : {
        ok: true,
        status: 200,
        json: async () => {
          const grund = new Error("other side closed");
          grund.code = "UND_ERR_SOCKET";
          throw new TypeError("terminated", { cause: grund });
        },
      };

let ausgabe;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MISTRAL_MOCK;
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  mockStore.clear();
  mockStore.set(JOB_ID, {
    status: "queued",
    createdAt: Date.now() - 1000,
    lang: "de",
    imagePath: "queue-uploads/x.jpg",
    exif: {},
  });
  storage.loadImage.mockResolvedValue({ buffer: Buffer.from("bild"), mimeType: "image/jpeg" });
  storage.deleteImage.mockResolvedValue();
  ausgabe = [];
  for (const art of ["log", "info", "warn", "error"]) {
    jest.spyOn(console, art).mockImplementation((...args) => ausgabe.push({ art, text: args.map(String).join(" ") }));
  }
});
afterEach(() => {
  setFetchForTest(null);
  jest.restoreAllMocks();
});

/* Mistral der Reihe nach: Jede Antwort gilt fuer einen Aufruf mit Bild. */
function mistralAntwortet(...folge) {
  let i = 0;
  setFetchForTest(async (_url, init) => folge[Math.min(i++, folge.length - 1)](init));
}

async function lauf() {
  await handleProcessJob({ method: "POST", body: { jobId: JOB_ID } }, makeRes());
  return ausgabe;
}

/* Jede Zeile mit severity ERROR — gleich, ob ueber console.error ohne Feld
   (Cloud Run setzt dann ERROR) oder mit ausdruecklichem Feld. */
function fehlerzeilen() {
  return ausgabe
    .filter((z) => z.art === "error" || /"severity":"ERROR"/.test(z.text))
    .map((z) => {
      try {
        return JSON.parse(z.text);
      } catch (_) {
        return { roh: z.text };
      }
    });
}

describe("Fehlermeldung beim Kind: genau eine Fehlerzeile, und es ist die des Alarms", () => {
  test.each([
    ["unlesbare KI-Antwort (Befund T-05)", ["kaputt"], "blocked.profileBlocked"],
    ["Verbindung reisst zweimal ab", ["abriss", "abriss"], "blocked.apiError"],
    ["Mistral meldet einen Fehler (400)", ["http400"], "blocked.apiError"],
    ["Antwort ohne Profil, die Nachfrage scheitert", ["leer", "abriss"], "blocked.profileBlocked"],
  ])("%s", async (_fall, folge, grund) => {
    const bausteine = {
      kaputt: antwort("das ist kein json {{{"),
      abriss,
      http400: () => ({ ok: false, status: 400, text: async () => '{"message":"bad"}' }),
      leer: antwort(JSON.stringify({ subject: "HUMAN" })),
    };
    mistralAntwortet(...folge.map((n) => bausteine[n]));
    await lauf();

    expect(mockStore.get(JOB_ID).result.blockedReason).toBe(grund);
    const fehler = fehlerzeilen();
    expect(fehler).toEqual([{ severity: "ERROR", alert: "analyse-gescheitert", step: "analyse-ausgang", grund }]);
    /* Ohne Kennung (AB HIER KEINE KENNUNG IM LOG). */
    expect(JSON.stringify(fehler)).not.toContain(JOB_ID);
  });

  test("das Foto laesst sich nicht laden", async () => {
    storage.loadImage.mockRejectedValue(new Error("Speicher weg"));
    await lauf();
    expect(mockStore.get(JOB_ID).result.blockedReason).toBe("blocked.apiError");
    expect(fehlerzeilen()).toEqual([
      { severity: "ERROR", alert: "analyse-gescheitert", step: "analyse-ausgang", grund: "blocked.apiError" },
    ]);
  });
});

/* Befund U-02 (Pruefrunde 01.10.2026): Ein gerettetes Teilergebnis traegt das
   Standard-Profil, das Beast-Profil fehlt, und die Nachfrage nach den
   fehlenden Karten scheitert. Im Beast-Modus sieht das Kind dann "Die KI hat
   ein leeres Profil zurueckgeliefert" — auch das ist eine Fehlermeldung. */
describe("Teilergebnis mit leerem Profil", () => {
  test("Standard gerettet, Beast leer, Nachfrage scheitert: eine Nachricht mit Grund profil_leer_beast", async () => {
    const nurStandard =
      JSON.stringify({
        subject: "HUMAN",
        visible_text: "",
        standard: { profileText: "Du bist gerettet.", categories: karten("S") },
      }).slice(0, -1) + ',"beast":{"profileT';
    mistralAntwortet((init) => (gestreamt(init) ? sse(nurStandard, true) : abriss(init)), abriss);
    await lauf();

    const ergebnis = mockStore.get(JOB_ID).result;
    expect(ergebnis.meta.mode).toBe("multimodal");
    expect(ergebnis.profiles.normal.profileText).toBe("Du bist gerettet.");
    expect(Object.keys(ergebnis.profiles.boost.categories)).toHaveLength(0);
    expect(fehlerzeilen()).toEqual([
      { severity: "ERROR", alert: "analyse-gescheitert", step: "analyse-ausgang", grund: "profil_leer_beast" },
    ]);
  });

  test.each([
    ["Standard leer", { normal: {}, boost: { profileText: "Du bist." } }, "profil_leer_standard"],
    ["Beast leer", { normal: { categories: { a: {} } }, boost: { profileText: "  " } }, "profil_leer_beast"],
    ["beide gefuellt", { normal: { profileText: "Du." }, boost: { categories: { a: {} } } }, null],
  ])("completeJob: %s", async (_fall, profiles, grund) => {
    mockStore.set(JOB_ID, { status: "processing" });
    await jobs.completeJob(JOB_ID, { profiles, meta: { mode: "multimodal" } });
    expect(fehlerzeilen()).toEqual(
      grund ? [{ severity: "ERROR", alert: "analyse-gescheitert", step: "analyse-ausgang", grund }] : []
    );
  });

  test("Tierprofil: nie eine Nachricht, auch nicht bei leerem Feld", async () => {
    mockStore.set(JOB_ID, { status: "processing" });
    await jobs.completeJob(JOB_ID, { profiles: { normal: {}, boost: {} }, meta: { mode: "animal" } });
    expect(fehlerzeilen()).toEqual([]);
  });
});

describe("Kein Alarm, wenn das Kind sein Ergebnis bekommt", () => {
  test("Erfolg", async () => {
    mistralAntwortet(antwort(MENSCH));
    await lauf();
    expect(mockStore.get(JOB_ID).result.meta.mode).not.toBe("blocked");
    expect(fehlerzeilen()).toEqual([]);
  });

  test("Abriss, dann gelingt der Neuversuch", async () => {
    mistralAntwortet(abriss, antwort(MENSCH));
    await lauf();
    expect(mockStore.get(JOB_ID).result.profiles.normal.profileText).toBe("Du bist sachlich beschrieben.");
    expect(fehlerzeilen()).toEqual([]);
  });

  test("Tierfoto ohne Karten, die Nachfrage scheitert: Tierprofil, kein Fehlalarm", async () => {
    mistralAntwortet(
      antwort(JSON.stringify({ subject: "ANIMAL_ONLY", standard: { profileText: "Ein Hund mit Fell und Schnauze." } })),
      abriss
    );
    await lauf();
    expect(mockStore.get(JOB_ID).result.meta.mode).toBe("animal");
    expect(fehlerzeilen()).toEqual([]);
  });
});

describe("Auftrag scheitert, weil der Worker nicht fertig wurde", () => {
  /* Der Aufraeumdienst und die Statusabfrage setzen einen haengenden Auftrag
     auf `failed` — das Kind sieht "Es ist ein Fehler aufgetreten". */
  test("failJob: eine Fehlerzeile, nur beim tatsaechlichen Wechsel", async () => {
    mockStore.set(JOB_ID, { status: "processing" });
    expect(await jobs.failJob(JOB_ID, "processing_timeout")).toBe(true);
    expect(await jobs.failJob(JOB_ID, "processing_timeout")).toBe(false);
    expect(fehlerzeilen()).toEqual([
      { severity: "ERROR", alert: "analyse-gescheitert", step: "analyse-ausgang", grund: "processing_timeout" },
    ]);
  });

  test("ein nachlaufender Worker, dessen Auftrag schon gescheitert ist, alarmiert nicht ein zweites Mal", async () => {
    mockStore.set(JOB_ID, { status: "processing" });
    await jobs.failJob(JOB_ID, "processing_timeout");
    /* Der Worker liefert ein blockiertes Ergebnis nach — der Uebergang greift
       nicht mehr, das Kind hat die Fehlermeldung schon. */
    const blockiert = { blockedReason: "blocked.apiError", meta: { mode: "blocked" } };
    expect(await jobs.completeJob(JOB_ID, blockiert)).toBe(false);
    expect(fehlerzeilen()).toHaveLength(1);
  });

  /* Absturz des Workers: Cloud Tasks stellt erneut zu, der Auftrag steht noch
     auf `processing`. Bis 4.13.1 eine Fehlerzeile ("Fehler im Server") — mit
     dem spaeteren `failed` waeren das zwei Nachrichten fuer eine
     Fehlermeldung, bei falschem Verdacht eine ganz ohne. */
  test("Absturzverdacht: Warnung, die Nachricht kommt mit dem Scheitern des Auftrags", async () => {
    mockStore.set(JOB_ID, { status: "processing", startedAt: Date.now() - 1000 });
    await handleProcessJob(
      { method: "POST", body: { jobId: JOB_ID }, headers: { "x-cloudtasks-taskretrycount": "1" } },
      makeRes()
    );
    expect(ausgabe.some((z) => z.text.includes("worker-abgestuerzt-verdacht"))).toBe(true);
    expect(fehlerzeilen()).toEqual([]);
    await jobs.failJob(JOB_ID, "processing_timeout");
    expect(fehlerzeilen()).toHaveLength(1);
  });

  test("ein Grund, der keine feste Kennung ist, kommt nicht ins Protokoll", async () => {
    mockStore.set(JOB_ID, { status: "processing" });
    await jobs.failJob(JOB_ID, "Mistral HTTP 429 bei 10.0.0.1");
    expect(fehlerzeilen()[0].grund).toBe("unbekannt");
  });
});
