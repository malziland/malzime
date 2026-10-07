"use strict";

/* Drei Schutzstellen der Auftragsverwaltung, die kein Test hielt
   (TEST-2026-10-03-42):

     abandonJob         bricht nur einen WARTENDEN Auftrag ab. Ohne die Pruefung
                        wuerde der Aufraeumdienst einen Auftrag abbrechen, den ein
                        Verarbeiter gerade uebernommen hat — Ergebnis verloren,
                        Analyse umsonst bezahlt.
     verbraucheRcTicket prueft das Einmal-Ticket IN der Transaktion noch einmal.
                        Ohne die Pruefung zaehlten zwei gleichzeitige
                        Einloesungen desselben Tickets beide.
     platzBestaetigen   der Platz genau AUF der Grenze ist schon einer zu viel
                        (Grenze ausschliesslich: Platz 0 bis Grenze - 1 bleiben).

   Echte Auftragsverwaltung gegen eine Datenbank im Arbeitsspeicher. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));

const speicher = require("./hilfen/speicher-datenbank");
const jobs = require("../jobs");

beforeEach(() => {
  speicher.leeren();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("abandonJob: nur ein wartender Auftrag wird abgebrochen", () => {
  test("wartend → abgebrochen", async () => {
    speicher.lege("jobs/a", { status: "queued" });

    expect(await jobs.abandonJob("a")).toBe(true);
    expect(speicher.lies("jobs/a").status).toBe("abandoned");
  });

  test.each([["processing"], ["done"], ["failed"], ["abandoned"]])("Stand %s → bleibt, wie er ist", async (status) => {
    speicher.lege("jobs/a", { status, result: "unveraendert" });

    expect(await jobs.abandonJob("a")).toBe(false);
    expect(speicher.lies("jobs/a")).toEqual({ status, result: "unveraendert" });
  });

  test("ein Auftrag, den es nicht gibt → false", async () => {
    expect(await jobs.abandonJob("gibt-es-nicht")).toBe(false);
  });
});

describe("verbraucheRcTicket: die zweite Pruefung in der Transaktion", () => {
  test("ein gueltiges Ticket wird einmal eingeloest und ist danach wertlos", async () => {
    speicher.lege("jobs/a", { status: "done", rcTicketHash: "hash-1" });

    expect(await jobs.verbraucheRcTicket("hash-1")).toBe(true);
    expect(speicher.lies("jobs/a").rcTicketHash).toBeNull();
    expect(await jobs.verbraucheRcTicket("hash-1")).toBe(false);
  });

  test("wird das Ticket zwischen Suche und Transaktion von einer anderen Einloesung entwertet, zaehlt diese nicht", async () => {
    speicher.lege("jobs/a", { status: "done", rcTicketHash: "hash-1" });
    /* Die Suche hat den Auftrag schon gefunden; bevor die Transaktion liest,
       war eine andere Einloesung schneller. */
    speicher.vor(({ art }) => {
      if (art === "transaktion") speicher.lege("jobs/a", { status: "done", rcTicketHash: null });
    });

    expect(await jobs.verbraucheRcTicket("hash-1")).toBe(false);
  });

  test("ist der Auftrag zwischen Suche und Transaktion geloescht worden, zaehlt die Einloesung nicht", async () => {
    speicher.lege("jobs/a", { status: "done", rcTicketHash: "hash-1" });
    speicher.vor(async ({ art }) => {
      if (art === "transaktion") await speicher.datenbank.doc("jobs/a").delete();
    });

    expect(await jobs.verbraucheRcTicket("hash-1")).toBe(false);
  });
});

describe("platzBestaetigen: die Grenze (ausschliesslich)", () => {
  const GRENZE = 5;
  const wartende = (anzahl) => {
    for (let i = 0; i < anzahl; i += 1) speicher.lege(`jobs/vor-${i}`, { status: "queued", createdAt: 100 + i });
  };
  const ich = { id: "ich", status: "queued", createdAt: 1000 };

  test("vier warten vor mir (Platz 4 von 5): bestaetigt", async () => {
    wartende(GRENZE - 1);

    expect(await jobs.platzBestaetigen(ich, GRENZE)).toBe(true);
  });

  test("fuenf warten vor mir (Platz 5 von 5): zu spaet", async () => {
    wartende(GRENZE);

    expect(await jobs.platzBestaetigen(ich, GRENZE)).toBe(false);
  });
});
