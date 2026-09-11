/**
 * Jeder eingelassene Auftrag steht GENAU EINMAL im Stundenfenster — auch wenn
 * der Zähler unter Andrang ausweicht.
 *
 * ANLASS (Nutzer, 11.09.2026): Die Statusseite zeigte „35 in der letzten
 * Stunde" und „36 heute", obwohl alle 36 Analysen fertig waren. „Ja,
 * natürlich sollen die Zahlen stimmen."
 *
 * BELEG (Lasttest 11.09.2026, 30 Aufträge gleichzeitig, Server-Logs und
 * stats/current): Neunmal griff nach dem Zeitlimit von zwei Sekunden das Netz
 * (`netz-hat-uebernommen`, `zeitlimit-kein-retry`). Acht dieser Transaktionen
 * schrieben ihren Zeitstempel später doch noch — bis zu 43 Sekunden danach.
 * Eine schrieb nie. Das Netz selbst schreibt nichts; dieser Auftrag fehlte im
 * Fenster für immer.
 *
 * NACHGESTELLT wird hier genau diese Abfolge, am Stundenzähler selbst: Die
 * Transaktion hängt (wie an der Dokumentsperre), das Zeitlimit greift, das
 * Netz lässt ein, und danach tut der Auftrag, was ein echter Auftrag tut —
 * seine Analyse beginnt. ABWEICHUNG vom echten Betrieb: Warum die eine
 * Transaktion nie schrieb (Wiederholungen des SDK erschöpft oder die Instanz
 * nach der Antwort gedrosselt), lässt sich lokal nicht erzwingen. Der Test
 * stellt deshalb beide Ausgänge nach — nie geschrieben und spät geschrieben —
 * und verlangt für beide dasselbe Ergebnis. Die Ursache kann ihn damit nicht
 * verdecken.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

let mockDb;
jest.mock("../db", () => ({ datenbank: () => mockDb }));

/* Nur `arrayUnion` wird hier gebraucht: Die Kulisse unten wertet ihn aus wie
   Firestore — ein Wert, der schon im Feld steht, kommt nicht ein zweites Mal
   hinein. */
jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    arrayUnion: (...werte) => ({ __arrayUnion: werte }),
    increment: (n) => ({ __increment: n }),
  },
}));

const { SATZ } = require("../test-satz");
const counter = require("../counter");

/* Ein Firestore mit EINEM Dokument stats/current. Wie sich jede Transaktion
   verhält, legt der Test der Reihe nach in `ablauf` fest:
     "sofort"          liest, rechnet, schreibt — der Normalfall
     "haengt"          kommt nie zurück (der eine von neun am 11.09.)
     "spaeter"         wartet auf die Sperre; ihr Rückruf läuft erst, wenn
                       nachlaeufe[i]() ihn anstößt — also NACH dem Zeitlimit
     "commit-spaeter"  der Rückruf lief schon VOR dem Zeitlimit, nur das
                       Schreiben ist noch unterwegs und kommt mit dem Nachlauf an
     "abgebrochen"     scheitert sofort mit ABORTED */
function kulisse(anfang) {
  const dok = { recentAnalyses: [...anfang], limit: SATZ.stundenlimit };
  const ablauf = [];
  const nachlaeufe = [];

  function anwenden(aenderung) {
    for (const [feld, wert] of Object.entries(aenderung)) {
      if (wert && wert.__arrayUnion) {
        const alt = Array.isArray(dok[feld]) ? dok[feld] : [];
        dok[feld] = [...alt, ...wert.__arrayUnion.filter((w) => !alt.includes(w))];
      } else {
        dok[feld] = wert;
      }
    }
  }
  const stand = () => ({ exists: true, data: () => JSON.parse(JSON.stringify(dok)) });

  async function rueckruf(fn) {
    const schreiben = [];
    const tx = {
      get: async () => stand(),
      update: (_ref, d) => schreiben.push(d),
      set: (_ref, d) => schreiben.push(d),
    };
    const ergebnis = await fn(tx);
    return { ergebnis, schreiben };
  }

  return {
    dok,
    ablauf,
    nachlaeufe,
    eintraege: () => [...dok.recentAnalyses],
    db: {
      doc: () => ({
        get: async () => stand(),
        set: async (d) => anwenden(d),
        update: async (d) => anwenden(d),
      }),
      runTransaction: (fn) => {
        const art = ablauf.shift() || "sofort";
        if (art === "sofort") {
          return rueckruf(fn).then(({ ergebnis, schreiben }) => {
            schreiben.forEach(anwenden);
            return ergebnis;
          });
        }
        if (art === "haengt") return new Promise(() => {});
        if (art === "abgebrochen") {
          const f = new Error("10 ABORTED: Transaction lock timeout.");
          f.code = 10;
          return Promise.reject(f);
        }
        if (art === "spaeter") {
          return new Promise((ok, nein) => {
            nachlaeufe.push(() =>
              rueckruf(fn)
                .then(({ ergebnis, schreiben }) => {
                  schreiben.forEach(anwenden);
                  ok(ergebnis);
                })
                .catch(nein)
            );
          });
        }
        if (art === "commit-spaeter") {
          return new Promise((ok, nein) => {
            rueckruf(fn).then(({ ergebnis, schreiben }) => {
              nachlaeufe.push(async () => {
                schreiben.forEach(anwenden);
                ok(ergebnis);
              });
            }, nein);
          });
        }
        throw new Error(`unbekannter Ablauf ${art}`);
      },
    },
  };
}

/* Was ein eingelassener Auftrag danach tut: Seine Analyse beginnt, und der
   Worker trägt die Marke des Einlasses nach, falls der Zähler ausgewichen war.
   Vor dem Fix gab es diesen Schritt nicht — der Test fällt dann an der
   Zählung, nicht an einer fehlenden Funktion. */
async function analyseBeginnt(einlass) {
  if (einlass.nachtragNoetig && typeof counter.zaehlerNachtragen === "function") {
    await counter.zaehlerNachtragen(einlass.stempel);
  }
}

const wieOft = (liste, wert) => liste.filter((x) => x === wert).length;

describe("Stundenzähler: jeder eingelassene Auftrag genau einmal", () => {
  let k;
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    counter._netzMeldungZuruecksetzen();
    const t = Date.now();
    k = kulisse([t - 3000, t - 2000, t - 1000]);
    mockDb = k.db;
  });
  afterEach(() => jest.restoreAllMocks());

  test("Normalfall: der Eintrag ist die Marke des Auftrags, ein Nachtrag ist nicht nötig", async () => {
    const e = await counter.checkAndIncrement();
    expect(e.allowed).toBe(true);
    expect(e.nachtragNoetig).toBeFalsy();
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  });

  test("zwei Aufträge in derselben Millisekunde bekommen verschiedene Marken", async () => {
    /* Sonst hielte der Nachtrag den zweiten für den ersten und trüge ihn nicht
       ein — dieselbe Untererfassung, nur seltener. */
    const fest = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fest);
    const a = await counter.checkAndIncrement();
    const b = await counter.checkAndIncrement();
    expect(k.eintraege()).toHaveLength(5);
    expect(new Set(k.eintraege()).size).toBe(5);
    expect(a.stempel).not.toBe(b.stempel);
  });

  test("11.09.: Transaktion schreibt NIE — der Auftrag steht trotzdem im Fenster", async () => {
    k.ablauf.push("haengt");
    const e = await counter.checkAndIncrement();
    expect(e.allowed).toBe(true);
    expect(e.notbremse).toBe(true);

    await analyseBeginnt(e);
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);

  test("Transaktion schreibt SPÄTER, nach dem Nachtrag — trotzdem nur einmal", async () => {
    k.ablauf.push("spaeter");
    const e = await counter.checkAndIncrement();
    expect(e.notbremse).toBe(true);

    await analyseBeginnt(e);
    await k.nachlaeufe[0]();
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);

  test("Transaktion schreibt später, VOR dem Nachtrag — trotzdem nur einmal", async () => {
    k.ablauf.push("spaeter");
    const e = await counter.checkAndIncrement();

    await k.nachlaeufe[0]();
    await analyseBeginnt(e);
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);

  test("das Schreiben war beim Zeitlimit schon unterwegs — trotzdem nur einmal", async () => {
    k.ablauf.push("commit-spaeter");
    const e = await counter.checkAndIncrement();
    expect(e.notbremse).toBe(true);

    await analyseBeginnt(e);
    await k.nachlaeufe[0]();
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);

  test("drei Abbrüche in Folge, das Netz lässt ein — der Auftrag steht trotzdem im Fenster", async () => {
    k.ablauf.push("abgebrochen", "abgebrochen", "abgebrochen");
    const e = await counter.checkAndIncrement();
    expect(e.allowed).toBe(true);
    expect(e.notbremse).toBe(true);

    await analyseBeginnt(e);
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);

  test("ein Nachlauf nach mehr als einer Minute schreibt nicht mehr — der Nachtrag trägt", async () => {
    /* Eine gedrosselte Instanz kann eine alte Transaktion Minuten später
       fortsetzen. Bis dahin kann der Auftrag längst freigegeben sein (in einem
       anderen Prozess, den dieser nicht fragen kann). */
    k.ablauf.push("spaeter");
    const e = await counter.checkAndIncrement();
    const echt = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(echt + 61 * 1000);

    await k.nachlaeufe[0]();
    expect(k.eintraege()).toHaveLength(3);
    await analyseBeginnt(e);
    expect(k.eintraege()).toHaveLength(4);
    expect(wieOft(k.eintraege(), e.stempel)).toBe(1);
  }, 30000);
});

describe("Stundenzähler: Freigabe trifft genau den eigenen Eintrag", () => {
  let k;
  let anfang;
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    counter._netzMeldungZuruecksetzen();
    const t = Date.now();
    anfang = [t - 3000, t - 2000, t - 1000];
    k = kulisse(anfang);
    mockDb = k.db;
  });
  afterEach(() => jest.restoreAllMocks());

  test("gibt der ältere von zwei Aufträgen frei, bleibt der jüngere stehen", async () => {
    /* Vorher fiel immer der JÜNGSTE Eintrag (Prüfrunde 8, N-P3c). Die Anzahl
       stimmte, solange jeder eigene Eintrag da war — im Netz-Fall ist er das
       nicht, und dann nahm die Freigabe einem anderen Auftrag den Platz. */
    const a = await counter.checkAndIncrement();
    const b = await counter.checkAndIncrement();
    await counter.releaseHourlySlot(a.stempel);
    expect(k.eintraege()).toEqual([...anfang, b.stempel]);
  });

  test("Netz-Fall, Auftrag scheitert vor der Analyse: der späte Nachlauf trägt ihn nicht mehr ein", async () => {
    k.ablauf.push("spaeter");
    const e = await counter.checkAndIncrement();
    expect(e.notbremse).toBe(true);

    await counter.releaseHourlySlot(e.stempel);
    await k.nachlaeufe[0]();
    expect(k.eintraege()).toEqual(anfang);
  }, 30000);

  test("Netz-Fall, Auftrag abgewiesen: auch dann trägt der späte Nachlauf nichts ein", async () => {
    /* Das Netz sah das Fenster voll und wies ab. Rollt bis zum Nachlauf ein
       alter Eintrag hinaus, sähe die Transaktion Platz — der abgewiesene
       Auftrag darf trotzdem nicht zählen. */
    const t = Date.now();
    const voll = Array.from({ length: SATZ.stundenlimit }, (_, i) => t - 1000 - i);
    k = kulisse(voll);
    mockDb = k.db;
    k.ablauf.push("spaeter");
    const e = await counter.checkAndIncrement();
    expect(e.allowed).toBe(false);

    k.dok.recentAnalyses.pop();
    await k.nachlaeufe[0]();
    expect(k.eintraege()).toHaveLength(SATZ.stundenlimit - 1);
  }, 30000);

  test("Aufträge von vor dem Umbau (ohne Marke) geben weiter den jüngsten Eintrag frei", async () => {
    await counter.checkAndIncrement();
    await counter.releaseHourlySlot();
    expect(k.eintraege()).toEqual(anfang);
  });
});
