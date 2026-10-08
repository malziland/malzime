"use strict";

/* Die GROESSE der beiden Fristen des Aufraeumdienstes (TEST-2026-10-03-42,
   Datenschutz-Teil).

     findZugestellteJobs   (jobs.js)  Ein abgeholtes Ergebnis bleibt hoechstens
                           `zustellfensterMs` in der Datenbank. Die Einstellung
                           ist auf 15 Minuten begrenzt (betriebsprofil.js); die
                           Datenschutzerklaerung nennt fuer das fertige Profil rund
                           15 Minuten nach der Abholung.
     findUeberfaelligeJobs (jobs.js)  Ein Auftrag, der nur dadurch am Leben bleibt,
                           dass sein Browser immer weiter nachfragt, gibt seinen
                           Platz nach `wartendesHoechstalterMs` frei — gerechnet ab
                           dem Anlegen, nicht ab der letzten Abfrage.

   wirkung-jeder-wert.test.js stellt fest, dass sich der Stichtag mit dem Wert
   VERSCHIEBT. Ein Stichtag, der hundertmal zu weit in der Vergangenheit liegt,
   erfuellt das ebenso. Hier wird die Groesse festgelegt: je Frist ein Auftrag
   knapp unter, genau auf und knapp ueber der Frist, mit drei verschiedenen Werten
   aus dem Einstellungssatz (kleinster, mittlerer, groesster erlaubter) — eine
   feste Zahl im Code kaeme so nicht durch.

   Grenzfall (ausschliesslich): Ein Auftrag ist erst dann ueberfaellig bzw. ein
   Ergebnis erst dann abgelaufen, wenn es AELTER ist als die Frist; genau auf der
   Frist gilt es noch nicht ("<" im Code). Die Beispiele liegen eine Sekunde
   darunter, genau auf der Frist und eine Sekunde darueber.

   Dazu, am Ende der Datei, die Frist fuer verlassene Auftraege
   (`isAbandoned`, `livenessGnadenfristMs`) mit derselben Grenze.

   Der Aufraeumdienst selbst (handle-reap.js) ist in handle-reap.test.js mit
   Attrappen fuer diese Funktionen geprueft; hier laufen die echten Funktionen
   gegen eine Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => ({
  ZUSAGE_LOESCHFRISTEN: jest.requireActual("../betriebsprofil").ZUSAGE_LOESCHFRISTEN,
  geltendeWerte: jest.fn(),
}));
jest.mock("../db", () => ({ datenbank: () => mockDatenbank }));

const { SATZ } = require("../test-satz");

/* ── Datenbank im Arbeitsspeicher (nur, was jobs.js hier braucht) ── */

const mockDokumente = new Map();
let mockZaehler = 0;

/* Wie Firestore: Bei Ungleichungen fallen Dokumente ohne Wert (fehlt oder null)
   heraus. */
function mockPasst(daten, bedingung) {
  const wert = daten[bedingung.feld];
  if (bedingung.op === "==") return wert === bedingung.wert;
  if (wert === null || wert === undefined) return false;
  if (bedingung.op === "<") return wert < bedingung.wert;
  if (bedingung.op === "<=") return wert <= bedingung.wert;
  if (bedingung.op === ">") return wert > bedingung.wert;
  if (bedingung.op === ">=") return wert >= bedingung.wert;
  throw new Error(`Vergleich "${bedingung.op}" ist in dieser Attrappe nicht nachgebildet`);
}

function mockAbfrage(bedingungen, grenze) {
  return {
    where: (feld, op, wert) => mockAbfrage([...bedingungen, { feld, op, wert }], grenze),
    limit: (n) => mockAbfrage(bedingungen, n),
    async get() {
      let treffer = [...mockDokumente.entries()].filter(([, daten]) => bedingungen.every((b) => mockPasst(daten, b)));
      if (grenze != null) treffer = treffer.slice(0, grenze);
      return { docs: treffer.map(([id, daten]) => ({ id, data: () => daten })) };
    },
  };
}

function mockDokument(id) {
  return {
    id,
    async set(daten) {
      mockDokumente.set(id, { ...daten });
    },
    async get() {
      const daten = mockDokumente.get(id);
      return { exists: daten !== undefined, id, data: () => daten };
    },
    async update(aenderung) {
      if (!mockDokumente.has(id)) throw new Error("update auf ein fehlendes Dokument");
      mockDokumente.set(id, { ...mockDokumente.get(id), ...aenderung });
    },
  };
}

const mockDatenbank = {
  collection: () => ({
    doc: (id) => mockDokument(id === undefined ? `auftrag-${++mockZaehler}` : id),
    where: (feld, op, wert) => mockAbfrage([{ feld, op, wert }]),
  }),
};

const betriebsprofil = require("../betriebsprofil");
const jobs = require("../jobs");

/* ── Hilfen ── */

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const SEKUNDE = 1000;
const MINUTE = 60 * SEKUNDE;

function setzeSatz(ueberschreiben) {
  betriebsprofil.geltendeWerte.mockReset().mockResolvedValue({
    werte: { ...SATZ, ...ueberschreiben },
    quelle: "firestore",
    profil: "test",
    grund: null,
  });
}

/* Die Uhr steht fest; jobs.js liest sie nur ueber Date.now(). */
function uhrStehtBei(ms) {
  Date.now.mockReturnValue(ms);
}

const idsVon = (liste) => liste.map((job) => job.id).sort();

beforeEach(() => {
  mockDokumente.clear();
  mockZaehler = 0;
  jest.spyOn(Date, "now").mockReturnValue(T0);
  setzeSatz();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ═══════════════════ Zustellfenster: abgeholte Ergebnisse ═══════════════════ */

/* Kleinster, mittlerer und groesster Wert, den der Einstellungssatz erlaubt
   (betriebsprofil.js: 1 bis 15 Minuten). */
const ZUSTELLFENSTER = [[1 * MINUTE], [5 * MINUTE], [15 * MINUTE]];

describe("findZugestellteJobs: ein abgeholtes Ergebnis laeuft nach dem Zustellfenster ab", () => {
  test.each(ZUSTELLFENSTER)(
    "Fenster %s ms: knapp darunter bleibt es, genau auf der Frist noch, eine Sekunde darueber ist es dran",
    async (fenster) => {
      setzeSatz({ zustellfensterMs: fenster });
      /* Der Auftrag wird zehn Minuten VOR der Abholung angelegt: Die Frist laeuft ab
         der Abholung, nicht ab dem Anlegen. */
      const id = await jobs.createJob({ lang: "de", imagePath: "queue-uploads/a.jpg" });
      const abholung = T0 + 10 * MINUTE;
      uhrStehtBei(abholung);
      await jobs.markDelivered(id);

      uhrStehtBei(abholung + fenster - SEKUNDE);
      expect(await jobs.findZugestellteJobs()).toEqual([]);

      uhrStehtBei(abholung + fenster);
      expect(await jobs.findZugestellteJobs()).toEqual([]);

      uhrStehtBei(abholung + fenster + SEKUNDE);
      expect(idsVon(await jobs.findZugestellteJobs())).toEqual([id]);
    }
  );

  test("der Wert kommt aus dem Einstellungssatz: dieselbe Lage, zwei Saetze, zwei Urteile", async () => {
    const id = await jobs.createJob({ lang: "de" });
    await jobs.markDelivered(id);
    /* Zehn Minuten nach der Abholung. */
    uhrStehtBei(T0 + 10 * MINUTE);

    setzeSatz({ zustellfensterMs: 5 * MINUTE });
    expect(idsVon(await jobs.findZugestellteJobs())).toEqual([id]);

    setzeSatz({ zustellfensterMs: 15 * MINUTE });
    expect(await jobs.findZugestellteJobs()).toEqual([]);
  });

  test("mehrere Auftraege: nur die abgelaufenen, und nur ueber die Abholung", async () => {
    const fenster = SATZ.zustellfensterMs;
    const alt = await jobs.createJob({ lang: "de" });
    const frisch = await jobs.createJob({ lang: "de" });
    const nieAbgeholt = await jobs.createJob({ lang: "de" });
    uhrStehtBei(T0);
    await jobs.markDelivered(alt);
    uhrStehtBei(T0 + fenster);
    await jobs.markDelivered(frisch);

    /* Eine Sekunde nach Ablauf des ersten Fensters: nur der erste ist dran. Der nie
       abgeholte Auftrag ist aelter als jedes Fenster und trotzdem nicht dabei —
       sein Ende regelt eine andere Frist. */
    uhrStehtBei(T0 + fenster + SEKUNDE);
    expect(idsVon(await jobs.findZugestellteJobs())).toEqual([alt]);
    expect(mockDokumente.get(nieAbgeholt).deliveredAt).toBeNull();

    /* Eine Sekunde nach Ablauf des zweiten Fensters: beide abgeholten. */
    uhrStehtBei(T0 + 2 * fenster + SEKUNDE);
    expect(idsVon(await jobs.findZugestellteJobs())).toEqual([alt, frisch].sort());
  });

  /* PRIV-2026-10-03-26: Das Loeschen haengt nicht am Einstellungssatz. Fehlt er,
     gilt die zugesagte Obergrenze selbst (15 Minuten ab Abholung) — mit derselben
     Grenze wie oben. */
  test("ohne Einstellungssatz gilt die zugesagte Obergrenze von 15 Minuten", async () => {
    const id = await jobs.createJob({ lang: "de" });
    await jobs.markDelivered(id);
    betriebsprofil.geltendeWerte.mockReset().mockResolvedValue({ werte: null, quelle: "keiner", grund: "fehlt" });

    uhrStehtBei(T0 + 15 * MINUTE - SEKUNDE);
    expect(await jobs.findZugestellteJobs()).toEqual([]);

    uhrStehtBei(T0 + 15 * MINUTE);
    expect(await jobs.findZugestellteJobs()).toEqual([]);

    uhrStehtBei(T0 + 15 * MINUTE + SEKUNDE);
    expect(idsVon(await jobs.findZugestellteJobs())).toEqual([id]);
  });
});

/* ═══════════════════ Hoechstalter: nur durch Nachfragen am Leben ═══════════════════ */

/* Kleinster, mittlerer (Betriebswert) und groesster erlaubter Wert
   (betriebsprofil.js: 1 Minute bis 24 Stunden). */
const HOECHSTALTER = [[1 * MINUTE], [35 * MINUTE], [24 * 60 * MINUTE]];

describe("findUeberfaelligeJobs: ein nur durch Nachfragen am Leben gehaltener Auftrag gibt seinen Platz frei", () => {
  test.each(HOECHSTALTER)(
    "Hoechstalter %s ms: knapp darunter bleibt er, genau auf der Frist noch, eine Sekunde darueber ist er dran",
    async (hoechstalter) => {
      setzeSatz({ wartendesHoechstalterMs: hoechstalter });
      const id = await jobs.createJob({ lang: "de", imagePath: "queue-uploads/w.jpg" });

      uhrStehtBei(T0 + hoechstalter - SEKUNDE);
      await jobs.touchJob(id);
      expect(await jobs.findUeberfaelligeJobs()).toEqual([]);

      uhrStehtBei(T0 + hoechstalter);
      await jobs.touchJob(id);
      expect(await jobs.findUeberfaelligeJobs()).toEqual([]);

      /* Der Browser hat gerade erst nachgefragt (frischer Herzschlag) — der Auftrag
         ist trotzdem zu alt. */
      uhrStehtBei(T0 + hoechstalter + SEKUNDE);
      await jobs.touchJob(id);
      expect(mockDokumente.get(id).lastSeenAt).toBe(T0 + hoechstalter + SEKUNDE);
      expect(idsVon(await jobs.findUeberfaelligeJobs())).toEqual([id]);
    }
  );

  test("der Wert kommt aus dem Einstellungssatz: dieselbe Lage, zwei Saetze, zwei Urteile", async () => {
    const id = await jobs.createJob({ lang: "de" });
    /* Zehn Minuten nach dem Anlegen. */
    uhrStehtBei(T0 + 10 * MINUTE);

    setzeSatz({ wartendesHoechstalterMs: 5 * MINUTE });
    expect(idsVon(await jobs.findUeberfaelligeJobs())).toEqual([id]);

    setzeSatz({ wartendesHoechstalterMs: 35 * MINUTE });
    expect(await jobs.findUeberfaelligeJobs()).toEqual([]);
  });

  test("nur wartende Auftraege: wer schon verarbeitet wird oder fertig ist, zaehlt nicht", async () => {
    const hoechstalter = SATZ.wartendesHoechstalterMs;
    const wartend = await jobs.createJob({ lang: "de" });
    const andere = {};
    for (const status of ["processing", "done", "failed", "abandoned"]) {
      andere[status] = await jobs.createJob({ lang: "de" });
      mockDokumente.get(andere[status]).status = status;
    }
    uhrStehtBei(T0 + hoechstalter + SEKUNDE);
    /* Kontrolle: Alle fuenf sind gleich alt; nur der wartende wird geliefert. */
    expect(Object.keys(andere)).toHaveLength(4);
    expect(idsVon(await jobs.findUeberfaelligeJobs())).toEqual([wartend]);
  });

  test("ein junger Auftrag ohne Herzschlag ist nicht ueberfaellig (das ist ein anderer Fall: verlassen)", async () => {
    const id = await jobs.createJob({ lang: "de" });
    /* Der Herzschlag ist uralt, der Auftrag aber noch jung. */
    mockDokumente.get(id).lastSeenAt = T0 - 24 * 60 * MINUTE;
    uhrStehtBei(T0 + SATZ.wartendesHoechstalterMs - SEKUNDE);
    expect(await jobs.findUeberfaelligeJobs()).toEqual([]);
  });

  test("ohne Einstellungssatz keine Antwort statt einer Ersatzfrist", async () => {
    betriebsprofil.geltendeWerte.mockReset().mockResolvedValue({ werte: null, quelle: "keiner", grund: "fehlt" });
    await expect(jobs.findUeberfaelligeJobs()).rejects.toThrow(/Betriebswerte fehlen/);
  });
});

/* Nachlauf 04.10.2026: Die dritte Frist dieser Datei. Ein wartender Auftrag
   gilt als verlassen, wenn sein Browser laenger als `livenessGnadenfristMs`
   nicht nachgefragt hat. Die Funktion war in den Tests der Handler nur als
   Attrappe vertreten; ihre Grenze (ausschliesslich: erst AELTER als die Frist)
   hielt kein Test. */
describe("isAbandoned: verlassen ist ein wartender Auftrag erst, wenn sein Herzschlag aelter ist als die Gnadenfrist", () => {
  const FRISTEN = [
    ["Wert aus dem Einstellungssatz", SATZ.livenessGnadenfristMs],
    ["doppelter Wert", SATZ.livenessGnadenfristMs * 2],
  ];

  test.each(FRISTEN)("%s: eine Sekunde darunter, genau auf der Frist, eine Millisekunde darueber", (_name, frist) => {
    const job = { status: "queued", createdAt: T0 - MINUTE, lastSeenAt: T0 };
    uhrStehtBei(T0 + frist - SEKUNDE);
    expect(jobs.isAbandoned(job, frist)).toBe(false);
    uhrStehtBei(T0 + frist);
    expect(jobs.isAbandoned(job, frist)).toBe(false);
    uhrStehtBei(T0 + frist + 1);
    expect(jobs.isAbandoned(job, frist)).toBe(true);
  });

  test("ohne Herzschlag zaehlt der Zeitpunkt des Anlegens", () => {
    const frist = SATZ.livenessGnadenfristMs;
    const job = { status: "queued", createdAt: T0 };
    uhrStehtBei(T0 + frist);
    expect(jobs.isAbandoned(job, frist)).toBe(false);
    uhrStehtBei(T0 + frist + 1);
    expect(jobs.isAbandoned(job, frist)).toBe(true);
  });

  test("nur wartende Auftraege: wer verarbeitet wird oder fertig ist, gilt nie als verlassen", () => {
    const frist = SATZ.livenessGnadenfristMs;
    uhrStehtBei(T0 + frist * 10);
    for (const status of ["processing", "done", "failed", "abandoned"]) {
      expect(jobs.isAbandoned({ status, createdAt: T0, lastSeenAt: T0 }, frist)).toBe(false);
    }
    /* Kontrolle: Derselbe Auftrag im Wartezustand gilt als verlassen. */
    expect(jobs.isAbandoned({ status: "queued", createdAt: T0, lastSeenAt: T0 }, frist)).toBe(true);
  });

  test("ohne Frist keine Antwort statt einer Ersatzfrist", () => {
    const job = { status: "queued", createdAt: T0, lastSeenAt: T0 };
    expect(() => jobs.isAbandoned(job)).toThrow(/livenessGnadenfristMs fehlt/);
    expect(() => jobs.isAbandoned(job, 0)).toThrow(/livenessGnadenfristMs fehlt/);
  });
});
