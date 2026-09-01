/**
 * Die Kostenbremse kann nicht mehr ausfallen — und ihr Netz misst dasselbe
 * wie der Zähler.
 *
 * ANLASS (Nutzer, 30.08.2026): „Eine Kostenbremse ist dazu da, damit ich mich
 * darauf verlassen kann. Ich mag ja nicht auf einmal horrende Kosten haben."
 *
 * DER ERSTE BEFUND (30.08.): Der Stundenzähler schreibt alle Zeitstempel in EIN
 * Firestore-Dokument. Ein einzelnes Dokument verträgt etwa einen Schreibvorgang
 * pro Sekunde. Bei 170 gleichzeitigen Anfragen im Simulator brach die
 * Transaktion 225 Mal mit ABORTED ab, und die Bremse fiel 206 Mal aus.
 *
 * DER ZWEITE BEFUND (BIZ-2026-09-01-01, Audit vom 01.09.): Das Netz, das
 * daraufhin gebaut wurde, zählte die AUFTRÄGE der letzten Stunde — aber der
 * Aufräumer löscht zugestellte Aufträge 15 Minuten nach der Zustellung. Unter
 * Andrang sah das Netz damit nur rund ein Viertel der Stunde und erreichte das
 * Limit nie. Obendrein rechnete es mit dem Grundlimit statt mit einem laufenden
 * Boost. Ein Ersatzweg, der etwas anderes misst als der Hauptweg, ist keiner.
 *
 * DAS NETZ SEITDEM: Es liest dasselbe Dokument wie der Zähler — mit einem
 * einfachen Lesezugriff AUSSERHALB der Transaktion, der von der Schreibsperre
 * nicht aufgehalten wird — und wendet dieselben Regeln an: dasselbe Fenster,
 * dasselbe wirksame Limit inklusive Boost. Es schreibt nichts und kann deshalb
 * nicht an derselben Ursache scheitern wie die Transaktion.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

let mockDb;
jest.mock("../db", () => ({ datenbank: () => mockDb }));

const { SATZ } = require("../test-satz");
const counter = require("../counter");

/* Ein Firestore, dessen Transaktionen IMMER mit ABORTED scheitern — genau die
   Lage, die im Simulator 206 Mal eintrat. Das Dokument `stats/current` ist
   ausserhalb der Transaktion lesbar (so verhält sich Firestore: eine Sperre
   hält Schreiber auf, nicht Leser).

   `zeitstempel`          Einträge im rollenden Fenster (alle frisch)
   `limit`, `limitBis`    ein laufender oder abgelaufener Boost im Dokument
   `auftraegeInDerStunde` was eine Zählung der Auftrags-Dokumente ergäbe —
                          standardmässig gleich `zeitstempel`; der Reproduktions-
                          test setzt sie bewusst NIEDRIGER (Aufräumer war da)
   `dokumentLesbar`       false = auch der einfache Lesezugriff scheitert */
function firestoreMitKontention({
  zeitstempel = 0,
  limit,
  limitBis,
  auftraegeInDerStunde,
  dokumentLesbar = true,
} = {}) {
  const jetzt = Date.now();
  const daten = { recentAnalyses: Array.from({ length: zeitstempel }, () => jetzt - 1000) };
  if (limit !== undefined) daten.limit = limit;
  if (limitBis !== undefined) daten.limitBis = limitBis;
  const anzahl = auftraegeInDerStunde === undefined ? zeitstempel : auftraegeInDerStunde;
  let direkteLesungen = 0;
  return {
    _direkteLesungen: () => direkteLesungen,
    doc: () => ({
      get: async () => {
        direkteLesungen += 1;
        if (!dokumentLesbar) throw new Error("Firestore vollstaendig weg");
        return { exists: true, data: () => daten };
      },
    }),
    collection: () => ({
      where: function () {
        return this;
      },
      count: () => ({ get: async () => ({ data: () => ({ count: anzahl }) }) }),
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
    /* Der Netz-Pfad meldet „Limit erreicht" höchstens einmal je Instanz und
       Frist — jeder Test beginnt mit frischer Frist. */
    if (typeof counter._netzMeldungZuruecksetzen === "function") counter._netzMeldungZuruecksetzen();
  });
  afterEach(() => jest.restoreAllMocks());

  test("Zähler ausgefallen, Limit erreicht: es wird BLOCKIERT, nicht durchgelassen", async () => {
    /* Das ist der Kern. Vorher stand hier: allowed = true, immer. */
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit + 50 });
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(false);
    expect(e.notbremse).toBe(true);
    expect(fehlerZeilen.join(" ")).toContain("notbremse-gegriffen");
  }, 30000);

  test("Zähler ausgefallen, Limit NICHT erreicht: es läuft weiter", async () => {
    /* Das Netz darf den Betrieb nicht anhalten, wenn gar kein Andrang ist. */
    mockDb = firestoreMitKontention({ zeitstempel: 3 });
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(true);
    expect(e.count).toBe(3);
  }, 30000);

  test("BIZ-2026-09-01-01: Aufträge, die der Aufräumer schon gelöscht hat, zählen trotzdem", async () => {
    /* DER REPRODUKTIONSTEST. Das Dokument trägt so viele Zeitstempel wie das
       Limit — die Stunde ist voll. Von den zugehörigen Auftrags-Dokumenten
       existiert nur noch eines, weil der Aufräumer zugestellte Aufträge nach
       15 Minuten löscht. Ein Netz, das Aufträge zählt, sieht 1 und lässt
       durch. Das richtige Netz sieht die Zeitstempel und blockiert. */
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit, auftraegeInDerStunde: 1 });
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(false);
    expect(e.notbremse).toBe(true);
  }, 30000);

  test("die Grenze des Netzes ist die WIRKSAME — auch ein laufender Boost gilt", async () => {
    /* Nicht eine eigene Zahl, und nicht nur die aus dem Einstellungssatz:
       Ein Boost hebt das Limit im Dokument mit Ablaufdatum. Der Zähler
       respektiert ihn — das Netz muss es genauso tun, sonst hat dieselbe
       Bremse zwei Grenzen, und welche gilt, hängt vom Aufrufweg ab. */
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit - 1 });
    expect((await counter.checkAndIncrement()).allowed).toBe(true);
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit });
    expect((await counter.checkAndIncrement()).allowed).toBe(false);

    /* Boost läuft: doppeltes Limit, gültig bis in einer Stunde. */
    mockDb = firestoreMitKontention({
      zeitstempel: SATZ.stundenlimit + 10,
      limit: SATZ.stundenlimit * 2,
      limitBis: Date.now() + 60 * 60 * 1000,
    });
    const mitBoost = await counter.checkAndIncrement();
    expect(mitBoost.allowed).toBe(true);
    expect(mitBoost.limit).toBe(SATZ.stundenlimit * 2);

    /* Boost abgelaufen UND nicht mehr gebraucht: der Grundwert gilt wieder. */
    mockDb = firestoreMitKontention({
      zeitstempel: SATZ.stundenlimit - 5,
      limit: SATZ.stundenlimit * 2,
      limitBis: Date.now() - 1000,
    });
    expect((await counter.checkAndIncrement()).limit).toBe(SATZ.stundenlimit);
  }, 30000);

  test("erreicht das Netz das Limit, wird das EINMAL gemeldet — nicht bei jedem Aufruf", async () => {
    /* Der Zähler-Pfad meldet `justReached` genau beim Eintrag, der das Limit
       füllt; daran hängt die Push-Nachricht mit dem Boost-Knopf. Der Netz-Pfad
       schreibt nichts — ohne eigene Frist sähe jeder Aufruf denselben Stand und
       meldete erneut. Bei Andrang wären das Dutzende Nachrichten. */
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit - 1 });
    const erster = await counter.checkAndIncrement();
    const zweiter = await counter.checkAndIncrement();
    expect(erster.allowed).toBe(true);
    expect(erster.justReached).toBe(true);
    expect(zweiter.justReached).toBe(false);
  }, 30000);

  test("reißt AUCH das Netz, wird das laut gemeldet", async () => {
    /* Dann bleibt nur fail-open — aber niemand darf glauben, es sei alles gut. */
    mockDb = firestoreMitKontention({ zeitstempel: 5, dokumentLesbar: false });
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
    mockDb = firestoreMitKontention({ zeitstempel: 5 });
    const e = await counter.checkAndIncrement();

    expect(e.allowed).toBe(true);
    expect(e.notbremse).toBe(true);
    /* KEIN counter-fail-open, solange das Netz trägt. */
    expect(fehlerZeilen.join(" ")).not.toContain("counter-fail-open");
  }, 30000);

  test("blockiert das Netz, wird das SEHR WOHL gemeldet", async () => {
    /* Die andere Richtung: Wenn die Notbremse wirklich eingreift, ist das ein
       Betriebszustand, von dem der Betreiber erfahren muss. */
    mockDb = firestoreMitKontention({ zeitstempel: SATZ.stundenlimit + 10 });
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
    mockDb = firestoreMitKontention({ zeitstempel: 7 });
    /* Hängt für immer — wie eine Transaktion, die auf eine Sperre wartet. */
    mockDb.runTransaction = () => new Promise(() => {});
    const start = Date.now();
    const e = await counter.checkAndIncrement();
    const dauer = Date.now() - start;

    expect(e.notbremse).toBe(true);
    expect(e.count).toBe(7);
    /* Zwei Sekunden Zeitlimit, keine Wiederholung nach dem Zeitlimit (4.6.2):
       unter zehn Sekunden. Ohne das Zeitlimit käme der Aufruf NIE zurück. */
    expect(dauer).toBeLessThan(10000);
  }, 30000);

  test("das Netz kostet nichts, solange der Zähler läuft", async () => {
    /* Es darf nur im Ausfall greifen — sonst zahlt jeder Upload für einen
       Fall, der fast nie eintritt. Gemessen wird der einfache Lesezugriff auf
       das Dokument ausserhalb der Transaktion. */
    mockDb = firestoreMitKontention({ zeitstempel: 0 });
    mockDb.runTransaction = async (fn) =>
      fn({
        get: async () => ({ exists: true, data: () => ({ recentAnalyses: [], limit: SATZ.stundenlimit }) }),
        set: () => {},
        update: () => {},
      });
    await counter.checkAndIncrement();
    expect(mockDb._direkteLesungen()).toBe(0);
  });
});
