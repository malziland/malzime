/**
 * Die Einlassgrenze hält auch bei gleichzeitigem Andrang.
 *
 * BUG-2026-08-30-14 — gefunden im Simulator, nicht durch Lesen.
 *
 * DER FEHLER: Der Einlass zählte die Warteschlange und legte den Auftrag erst
 * mehrere Schritte später an. Bei gleichzeitigem Andrang sahen alle Anfragen
 * denselben Stand und kamen alle durch. Gemessen: 200 Wartende bei einer
 * Grenze von 155 — 29 % darüber. Die Letzten warten damit über dem
 * 30-Minuten-Deckel des Browsers und sehen einen Fehler, obwohl ihr Auftrag
 * läuft.
 *
 * Der Befund war ALT: Der Diff gegen main zeigt, dass die Prüfung nie anders
 * war. Der Firestore-Umbau hat ihn nur sichtbar gemacht. Repariert wurde er
 * trotzdem — „war vorher schon kaputt" ist keine Begründung, etwas stehen zu
 * lassen.
 *
 * DIE PRÜFUNG HIER: Ein nachgebautes Firestore, das Transaktionen ernst nimmt
 * (nacheinander, wie die echte Datenbank). Hundert gleichzeitige Anfragen auf
 * zehn Plätze — es dürfen genau zehn durchkommen.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

/* Ein Firestore-Ersatz, der Transaktionen SERIALISIERT — genau das ist die
   Eigenschaft, auf der die Reparatur beruht. Ein Mock, der alle Transaktionen
   gleichzeitig laufen ließe, würde den Fehler nachbauen statt ihn zu prüfen. */
function firestoreErsatz(startWert) {
  const speicher = new Map();
  if (startWert !== undefined) speicher.set("stats/warteschlange", { wartend: startWert });
  let kette = Promise.resolve();
  let transaktionen = 0;

  const machDoc = (pfad) => ({
    get: async () => ({
      exists: speicher.has(pfad),
      data: () => speicher.get(pfad) || {},
    }),
    set: async (daten, opt) => {
      const alt = opt && opt.merge ? speicher.get(pfad) || {} : {};
      speicher.set(pfad, { ...alt, ...daten });
    },
  });

  return {
    _speicher: speicher,
    _transaktionen: () => transaktionen,
    doc: machDoc,
    collection: (name) => ({
      doc: (id) => machDoc(`${name}/${id || "neu"}`),
      where: function () {
        return this;
      },
      limit: function () {
        return this;
      },
      get: async () => ({ docs: [], empty: true }),
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    }),
    runTransaction: (fn) => {
      /* Serialisiert: jede Transaktion wartet auf die vorige. */
      const meine = kette.then(async () => {
        transaktionen += 1;
        const tx = {
          get: async (ref) => ref.get(),
          set: (ref, daten, opt) => ref.set(daten, opt),
          update: (ref, daten) => ref.set(daten, { merge: true }),
        };
        return fn(tx);
      });
      kette = meine.catch(() => {});
      return meine;
    },
  };
}

let mockDb;
jest.mock("../db", () => ({ datenbank: () => mockDb }));

const jobs = require("../jobs");

describe("Platzreservierung — die Grenze hält auch bei Andrang", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("HUNDERT gleichzeitige Anfragen auf ZEHN Plätze: genau zehn kommen durch", async () => {
    mockDb = firestoreErsatz(0);
    const ergebnisse = await Promise.all(Array.from({ length: 100 }, () => jobs.platzReservieren(10)));
    const durch = ergebnisse.filter((e) => e.ok).length;
    /* GENAU zehn. Nicht "ungefähr" — der Sinn der Reparatur ist, dass es
       keine Grauzone mehr gibt. */
    expect(durch).toBe(10);
    expect(mockDb._speicher.get("stats/warteschlange").wartend).toBe(10);
  });

  test("die Reihenfolge ist egal — auch bei 500 auf 155", async () => {
    mockDb = firestoreErsatz(0);
    const ergebnisse = await Promise.all(Array.from({ length: 500 }, () => jobs.platzReservieren(155)));
    expect(ergebnisse.filter((e) => e.ok).length).toBe(155);
  });

  test("ein abgewiesener Aufruf verändert NICHTS", async () => {
    mockDb = firestoreErsatz(10);
    const vorher = mockDb._speicher.get("stats/warteschlange").wartend;
    const e = await jobs.platzReservieren(10);
    expect(e.ok).toBe(false);
    expect(mockDb._speicher.get("stats/warteschlange").wartend).toBe(vorher);
  });

  test("freigegebene Plätze stehen sofort wieder zur Verfügung", async () => {
    mockDb = firestoreErsatz(0);
    await Promise.all(Array.from({ length: 5 }, () => jobs.platzReservieren(5)));
    expect((await jobs.platzReservieren(5)).ok).toBe(false);
    await jobs.platzFreigeben();
    expect((await jobs.platzReservieren(5)).ok).toBe(true);
  });

  test("der Zähler geht nie unter null", async () => {
    mockDb = firestoreErsatz(0);
    await jobs.platzFreigeben();
    await jobs.platzFreigeben();
    expect(mockDb._speicher.get("stats/warteschlange").wartend).toBe(0);
  });

  test("ohne Grenze wird gar nicht erst reserviert", async () => {
    mockDb = firestoreErsatz(0);
    await expect(jobs.platzReservieren(undefined)).rejects.toThrow(/warteschlangeTiefe/);
    await expect(jobs.platzReservieren(0)).rejects.toThrow(/warteschlangeTiefe/);
  });

  test("bei Datenbankfehler wird eingelassen, aber laut protokolliert", async () => {
    /* FAIL-OPEN mit Alarm: Eine Kapazitätsbremse darf nie zum Totalausfall
       werden. Aber sie darf auch nicht still ausfallen. */
    const fehler = [];
    console.error.mockImplementation((z) => fehler.push(String(z)));
    mockDb = {
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
      runTransaction: async () => {
        throw new Error("Firestore weg");
      },
    };
    const e = await jobs.platzReservieren(10);
    expect(e.ok).toBe(true);
    expect(fehler.join(" ")).toContain("platzreservierung-fehlgeschlagen");
  });

  test("der Abgleich setzt den Zähler auf die wirkliche Zahl", async () => {
    /* Das Netz gegen Drift: Geht eine Rückgabe verloren, steht der Zähler zu
       hoch — und würde Leute abweisen, obwohl Platz ist. */
    mockDb = firestoreErsatz(99);
    mockDb.collection = () => ({
      where: function () {
        return this;
      },
      count: () => ({ get: async () => ({ data: () => ({ count: 7 }) }) }),
    });
    const e = await jobs.platzAbgleichen();
    expect(e.vorher).toBe(99);
    expect(e.jetzt).toBe(7);
    expect(mockDb._speicher.get("stats/warteschlange").wartend).toBe(7);
  });
});
