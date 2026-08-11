/* Tests fuer jobs.setLiveText (v3.0 Phase 1) — der Firestore-Schreiber des
   Live-Text-Stroms. Nutzt wie jobs.test.js einen In-Memory-Firestore-Mock,
   damit echtes update()-Verhalten geprueft wird (inklusive des Fehlers beim
   Schreiben auf ein fehlendes Dokument). */

const mockStore = new Map();

jest.mock("firebase-admin/firestore", () => {
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
    };
  }
  return {
    getFirestore: () => ({
      collection() {
        return {
          doc(id) {
            return docRef(id);
          },
        };
      },
    }),
  };
});

const jobs = require("../jobs");

beforeEach(() => {
  mockStore.clear();
});

describe("setLiveText — schreibt die Live-Felder", () => {
  test("legt liveText (standard) und liveTextStand per update auf das Job-Dokument", async () => {
    mockStore.set("job-1", { status: "processing", lang: "de" });
    const vorher = Date.now();
    await jobs.setLiveText("job-1", { standard: "Du bist neugierig", beast: null });
    const doc = mockStore.get("job-1");
    expect(doc.liveText).toBe("Du bist neugierig");
    expect(typeof doc.liveTextStand).toBe("number");
    expect(doc.liveTextStand).toBeGreaterThanOrEqual(vorher);
    /* update, nicht set: die bestehenden Felder bleiben unangetastet. */
    expect(doc.status).toBe("processing");
    expect(doc.lang).toBe("de");
  });

  test("solange beast null ist, bleibt liveTextBeast dem Dokument fern", async () => {
    mockStore.set("job-1", { status: "processing" });
    await jobs.setLiveText("job-1", { standard: "Du bist", beast: null });
    expect(mockStore.get("job-1")).not.toHaveProperty("liveTextBeast");
  });

  test("EIN Schreibvorgang traegt beide Felder, sobald beast begonnen hat", async () => {
    mockStore.set("job-1", { status: "processing" });
    await jobs.setLiveText("job-1", { standard: "Standard-Text.", beast: "Du bist ein zynisches" });
    const doc = mockStore.get("job-1");
    expect(doc.liveText).toBe("Standard-Text.");
    expect(doc.liveTextBeast).toBe("Du bist ein zynisches");
  });

  test("deckelt BEIDE Texte auf je 4000 Zeichen (Schutz des Job-Dokuments)", async () => {
    mockStore.set("job-1", { status: "processing" });
    await jobs.setLiveText("job-1", { standard: "x".repeat(5000), beast: "y".repeat(5000) });
    expect(mockStore.get("job-1").liveText).toHaveLength(4000);
    expect(mockStore.get("job-1").liveTextBeast).toHaveLength(4000);
  });

  test("nicht-String-Eingaben werden zum leeren String bzw. weggelassen statt zu werfen", async () => {
    mockStore.set("job-1", { status: "processing" });
    await jobs.setLiveText("job-1", { standard: null, beast: 42 });
    expect(mockStore.get("job-1").liveText).toBe("");
    expect(mockStore.get("job-1")).not.toHaveProperty("liveTextBeast");
  });

  test("abwaertskompatibel: ein nackter String zaehlt als Standard-Text", async () => {
    mockStore.set("job-1", { status: "processing" });
    await jobs.setLiveText("job-1", "Du bist neugierig");
    expect(mockStore.get("job-1").liveText).toBe("Du bist neugierig");
    expect(mockStore.get("job-1")).not.toHaveProperty("liveTextBeast");
  });
});

describe("setLiveText — schluckt Fehler", () => {
  test("ein Firestore-Fehler (Dokument weg) laesst den Aufruf NICHT scheitern", async () => {
    /* Kein Dokument angelegt → update() wirft im Mock. Eine verpasste
       Live-Welle darf nie etwas kaputt machen. */
    await expect(jobs.setLiveText("gibt-es-nicht", { standard: "Text", beast: null })).resolves.toBeUndefined();
  });
});
