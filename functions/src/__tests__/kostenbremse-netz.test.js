/**
 * Die Kostenbremse kann nicht mehr ausfallen.
 *
 * ANLASS (Nutzer, 30.08.2026): „Eine Kostenbremse ist dazu da, damit ich mich
 * darauf verlassen kann. Ich mag ja nicht auf einmal horrende Kosten haben."
 *
 * DER BEFUND: Der Stundenzähler schreibt alle Zeitstempel in EIN Firestore-
 * Dokument. Ein einzelnes Dokument verträgt etwa einen Schreibvorgang pro
 * Sekunde. Bei 170 gleichzeitigen Anfragen im Simulator brach die Transaktion
 * 225 Mal mit ABORTED ab, und die Bremse fiel 206 Mal aus — sie ließ durch.
 *
 * Das ist die schlechteste denkbare Eigenschaft für eine Kostenbremse: Sie
 * hält im Ruhezustand und versagt genau dann, wenn viel Geld ausgegeben wird.
 * Bei zwei Cent je Analyse und einem Andrang von tausenden Aufrufen geht es um
 * echtes Geld.
 *
 * DAS NETZ: Eine zweite Prüfung, die nichts schreibt und deshalb nicht an
 * derselben Ursache scheitern kann. Sie zählt die Aufträge der letzten Stunde
 * mit einer Aggregat-Abfrage — dieselbe Technik wie bei der Warteschlangen-
 * Position, und die kennt keine Sperren.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

let mockDb;
jest.mock("../db", () => ({ datenbank: () => mockDb }));

const { SATZ } = require("../test-satz");
const counter = require("../counter");

/* Ein Firestore, dessen Transaktionen IMMER mit ABORTED scheitern — genau die
   Lage, die im Simulator 206 Mal eintrat. */
function firestoreMitKontention(jobsInDerStunde) {
  return {
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
    collection: () => ({
      where: function () {
        return this;
      },
      count: () => ({ get: async () => ({ data: () => ({ count: jobsInDerStunde }) }) }),
      doc: () => ({ get: async () => ({ exists: false }) }),
    }),
    runTransaction: async () => {
      const fehler = new Error("10 ABORTED: Transaction lock timeout.");
      fehler.code = 10;
      throw fehler;
    },
  };
}

describe("Kostenbremse — sie hält auch, wenn der Zähler ausfällt", () => {
  let fehlerZeilen;
  beforeEach(() => {
    fehlerZeilen = [];
    jest.spyOn(console, "error").mockImplementation((z) => fehlerZeilen.push(String(z)));
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("Zähler ausgefallen, Limit erreicht: es wird BLOCKIERT, nicht durchgelassen", async () => {
    /* Das ist der Kern. Vorher stand hier: allowed = true, immer. */
    mockDb = firestoreMitKontention(SATZ.stundenlimit + 50);
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(false);
    expect(e.notbremse).toBe(true);
    expect(fehlerZeilen.join(" ")).toContain("notbremse-gegriffen");
  }, 30000);

  test("Zähler ausgefallen, Limit NICHT erreicht: es läuft weiter", async () => {
    /* Das Netz darf den Betrieb nicht anhalten, wenn gar kein Andrang ist. */
    mockDb = firestoreMitKontention(3);
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(true);
    expect(e.count).toBe(3);
  }, 30000);

  test("die Grenze des Netzes ist die aus dem Einstellungssatz", async () => {
    /* Nicht eine eigene Zahl — sonst gäbe es die Kostengrenze zweimal.
       Das Zeitlimit ist erhöht, weil JEDER Aufruf erst die fünf
       Wiederholungen des Zählers durchläuft (rund 4,5 Sekunden). Genau die
       machen die Bremse im Betrieb robust. */
    mockDb = firestoreMitKontention(SATZ.stundenlimit - 1);
    expect((await counter.checkAndIncrement()).allowed).toBe(true);
    mockDb = firestoreMitKontention(SATZ.stundenlimit);
    expect((await counter.checkAndIncrement()).allowed).toBe(false);
  }, 30000);

  test("reißt AUCH das Netz, wird das laut gemeldet", async () => {
    /* Dann bleibt nur fail-open — aber niemand darf glauben, es sei alles gut. */
    mockDb = {
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
      collection: () => ({
        where: function () {
          return this;
        },
        count: () => ({
          get: async () => {
            throw new Error("Firestore vollstaendig weg");
          },
        }),
      }),
      runTransaction: async () => {
        const f = new Error("ABORTED");
        f.code = 10;
        throw f;
      },
    };
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(true); /* fail-open als letzte Stufe */
    expect(fehlerZeilen.join(" ")).toContain("notbremse-fehlgeschlagen");
    expect(fehlerZeilen.join(" ")).toContain("KEINE Kostenbremse aktiv");
  }, 30000);

  test("wenn das Netz übernimmt, gibt es KEINEN Fehleralarm", async () => {
    /* BEFUND aus dem Simulator (30.08.2026): Nach dem Einbau des Netzes
       meldete der Code weiterhin 169 Mal "globale Kostenbremse momentan
       inaktiv" — obwohl das Netz jedes Mal korrekt entschieden hatte. Der
       Text war falsch, und 169 Fehlalarme pro Workshop hätten die eine echte
       Meldung unauffindbar gemacht.

       Ein Alarm, der bei Normalbetrieb feuert, ist schlimmer als keiner:
       Man gewöhnt sich an ihn und übersieht den Ernstfall. */
    mockDb = firestoreMitKontention(5);
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(true);
    expect(e.notbremse).toBe(true);
    /* KEIN counter-fail-open, solange das Netz trägt. */
    expect(fehlerZeilen.join(" ")).not.toContain("counter-fail-open");
  }, 30000);

  test("blockiert das Netz, wird das SEHR WOHL gemeldet", async () => {
    /* Die andere Richtung: Wenn die Notbremse wirklich eingreift, ist das ein
       Betriebszustand, von dem der Betreiber erfahren muss. */
    mockDb = firestoreMitKontention(SATZ.stundenlimit + 10);
    await counter.checkAndIncrement();
    expect(fehlerZeilen.join(" ")).toContain("notbremse-gegriffen");
  }, 30000);

  test("ein HÄNGENDER Zähler wird nach zwei Sekunden abgebrochen", async () => {
    /* GEMESSEN im Simulator (30.08.2026): Ohne eigenes Zeitlimit hingen 75 %
       der Anfragen 54 Sekunden. Nicht wegen der eigenen Wiederholungen — die
       warten 240 ms —, sondern weil Firestore selbst sehr lange auf die
       Dokumentsperre wartet, bevor es aufgibt.

       Hier hängt die Transaktion für immer. Der Test muss trotzdem in
       überschaubarer Zeit zurückkommen: Das Zeitlimit greift, danach das Netz. */
    mockDb = {
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
      collection: () => ({
        where: function () {
          return this;
        },
        count: () => ({ get: async () => ({ data: () => ({ count: 7 }) }) }),
        doc: () => ({ get: async () => ({ exists: false }) }),
      }),
      /* Hängt für immer — wie eine Transaktion, die auf eine Sperre wartet. */
      runTransaction: () => new Promise(() => {}),
    };
    const start = Date.now();
    const e = await counter.checkAndIncrement();
    const dauer = Date.now() - start;

    expect(e.notbremse).toBe(true);
    expect(e.count).toBe(7);
    /* Zwei Sekunden Zeitlimit, zwei Wiederholungen, etwas Wartezeit dazwischen:
       unter zehn Sekunden. Ohne das Zeitlimit käme der Aufruf NIE zurück. */
    expect(dauer).toBeLessThan(10000);
  }, 30000);

  test("das Netz kostet nichts, solange der Zähler läuft", async () => {
    /* Es darf nur im Ausfall greifen — sonst zahlt jeder Upload für einen
       Fall, der fast nie eintritt. */
    let aggregateAbgefragt = 0;
    mockDb = {
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
      collection: () => ({
        where: function () {
          return this;
        },
        count: () => ({
          get: async () => {
            aggregateAbgefragt += 1;
            return { data: () => ({ count: 0 }) };
          },
        }),
        doc: () => ({ get: async () => ({ exists: false }) }),
      }),
      runTransaction: async (fn) =>
        fn({
          get: async () => ({ exists: true, data: () => ({ recentAnalyses: [], limit: SATZ.stundenlimit }) }),
          set: () => {},
          update: () => {},
        }),
    };
    await counter.checkAndIncrement();
    expect(aggregateAbgefragt).toBe(0);
  });
});
