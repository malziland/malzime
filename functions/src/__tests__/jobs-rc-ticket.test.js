"use strict";

/* KA-02 (Kurzaudit 2026-08-12): Tests fuer das Realitaets-Check-Einmal-Ticket
   in jobs.js — markDelivered legt den Hash ab, verbraucheRcTicket entwertet
   ihn in einer Transaktion. In-Memory-Firestore-Mock wie jobs-livetext, hier
   zusaetzlich mit where()/limit()/get() und runTransaction. */

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
        return { exists: data !== undefined, id, data: () => data, ref: docRef(id) };
      },
      async update(patch) {
        const cur = mockStore.get(id);
        if (cur === undefined) throw new Error("update on missing doc");
        mockStore.set(id, { ...cur, ...patch });
      },
    };
  }
  function query(feld, wert) {
    return {
      limit() {
        return this;
      },
      async get() {
        const docs = [];
        for (const [id, data] of mockStore) {
          if (data[feld] === wert) {
            docs.push({ id, exists: true, data: () => data, ref: docRef(id) });
          }
        }
        return { empty: docs.length === 0, docs };
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
          where(feld, op, wert) {
            return query(feld, wert);
          },
        };
      },
      async runTransaction(fn) {
        /* Der Mock ist single-threaded — get/update laufen direkt gegen den
           Store; genau das braucht die Doppel-Entwertungs-Probe unten. */
        return fn({
          get: (ref) => ref.get(),
          update: (ref, patch) => {
            const cur = mockStore.get(ref.id);
            if (cur === undefined) throw new Error("update on missing doc");
            mockStore.set(ref.id, { ...cur, ...patch });
          },
        });
      },
    }),
  };
});

const jobs = require("../jobs");
const { sha256Hex } = require("../auth");

beforeEach(() => {
  mockStore.clear();
});

describe("markDelivered — legt den Ticket-Hash mit ab", () => {
  test("mit Hash: deliveredAt UND rcTicketHash landen im Dokument", async () => {
    mockStore.set("job-1", { status: "done" });
    const hash = sha256Hex("mein-ticket");
    await jobs.markDelivered("job-1", hash);
    const doc = mockStore.get("job-1");
    expect(typeof doc.deliveredAt).toBe("number");
    expect(doc.rcTicketHash).toBe(hash);
    /* Das Ticket selbst steht NIE im Dokument. */
    expect(JSON.stringify(doc)).not.toContain("mein-ticket");
  });

  test("ohne Hash (alter Aufrufstil): nur deliveredAt — kein leeres Hash-Feld", async () => {
    mockStore.set("job-1", { status: "done" });
    await jobs.markDelivered("job-1");
    const doc = mockStore.get("job-1");
    expect(typeof doc.deliveredAt).toBe("number");
    expect("rcTicketHash" in doc).toBe(false);
  });
});

describe("verbraucheRcTicket — genau eine Stimme je Analyse", () => {
  test("gueltiger Hash: true, und der Hash ist danach entwertet (null)", async () => {
    const hash = sha256Hex("ticket-a");
    mockStore.set("job-1", { status: "done", rcTicketHash: hash });
    await expect(jobs.verbraucheRcTicket(hash)).resolves.toBe(true);
    expect(mockStore.get("job-1").rcTicketHash).toBeNull();
  });

  test("zweite Entwertung desselben Hashes: false — die Suche findet null nie wieder", async () => {
    const hash = sha256Hex("ticket-a");
    mockStore.set("job-1", { status: "done", rcTicketHash: hash });
    await expect(jobs.verbraucheRcTicket(hash)).resolves.toBe(true);
    await expect(jobs.verbraucheRcTicket(hash)).resolves.toBe(false);
  });

  test("unbekannter Hash: false, nichts veraendert", async () => {
    mockStore.set("job-1", { status: "done", rcTicketHash: sha256Hex("echt") });
    await expect(jobs.verbraucheRcTicket(sha256Hex("geraten"))).resolves.toBe(false);
    expect(mockStore.get("job-1").rcTicketHash).toBe(sha256Hex("echt"));
  });

  test("leerer/nicht-string Hash: false ohne Datenbank-Suche", async () => {
    await expect(jobs.verbraucheRcTicket("")).resolves.toBe(false);
    await expect(jobs.verbraucheRcTicket(null)).resolves.toBe(false);
    await expect(jobs.verbraucheRcTicket(undefined)).resolves.toBe(false);
  });

  test("Job vom Reaper geloescht (PRIV-107b), Ticket kommt zu spaet: false statt Fehler", async () => {
    const hash = sha256Hex("ticket-a");
    mockStore.set("job-1", { status: "done", rcTicketHash: hash });
    mockStore.delete("job-1"); /* 15-Minuten-Frist abgelaufen, Dokument weg */
    await expect(jobs.verbraucheRcTicket(hash)).resolves.toBe(false);
  });

  test("Hash aendert sich zwischen Suche und Transaktion (Doppel-Einreichung): die Transaktion prueft erneut", async () => {
    const hash = sha256Hex("ticket-a");
    mockStore.set("job-1", { status: "done", rcTicketHash: hash });
    /* Die parallele Einreichung hat gewonnen und den Hash schon entwertet —
       nachgestellt ueber ein bereits-null-Feld mit noch auffindbarem Job:
       Die Query unten findet nichts mehr, die Transaktions-Pruefung
       (doc.data().rcTicketHash !== hash) waere die zweite Verteidigung. */
    mockStore.set("job-1", { status: "done", rcTicketHash: null });
    await expect(jobs.verbraucheRcTicket(hash)).resolves.toBe(false);
  });
});
