import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Absturz-Wache (2026-08-11).

   ANLASS: Safaris Meldung „Auf https://malzi.me/ ist wiederholt ein Problem
   aufgetreten" auf einem iPhone. Sechs Ursachen wurden geprüft und
   ausgeschlossen — das Ereignis selbst ist unsichtbar, weil beim Auftreten
   kein eigener Code mehr läuft und deshalb auch keine Meldung ankommt.

   PRÄZISIERT (Kurzaudit 2026-08-11, BUG-104): Ein Start zählt nur, wenn der
   vorige Durchlauf UNSAUBER endete — beim normalen Neuladen meldet sich die
   Seite über pagehide ab, ein Absturz tut das nicht. Drei schnelle manuelle
   Neuladungen (im Workshop normal) lösen damit nichts mehr aus und verwerfen
   vor allem keinen laufenden Auftrag mehr.

   Diese Prüfungen halten beide Aufgaben der Wache fest: melden UND die
   Schleife brechen. Und ebenso wichtig: dass sie im Normalbetrieb SCHWEIGT.
   Eine Wache, die bei jedem zweiten Neuladen anschlägt, wird ignoriert und
   ist damit wertlos. */

const meldungen = [];
vi.mock("../js/error-logger.js", () => ({
  logClientError: (fehler, kontext) => meldungen.push({ fehler, kontext }),
}));

const { initAbsturzWache, merkePhase } = await import("../js/absturz-wache.js");

/* Ein Absturz ist schlicht: Start ohne folgende Abmeldung. Der nächste
   init-Aufruf sieht dann die fehlende Abmeldung des Vorgängers. */
function sauberBeenden() {
  window.dispatchEvent(new Event("pagehide"));
}

describe("Absturz-Wache", () => {
  let jetzt;

  beforeEach(() => {
    sessionStorage.clear();
    meldungen.length = 0;
    jetzt = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => jetzt);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schweigt beim allerersten Start", () => {
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(0);
  });

  it("drei schnelle manuelle Neuladungen lösen NICHTS aus (BUG-104)", () => {
    /* Ungeduldiges Neuladen während der Wartezeit ist im Workshop normal —
       jeder Durchlauf meldet sich sauber ab, also zählt keiner. */
    const verwirfAuftrag = vi.fn();
    for (let i = 0; i < 4; i++) {
      expect(initAbsturzWache({ verwirfAuftrag })).toBe(false);
      sauberBeenden();
      jetzt += 3000;
    }
    expect(meldungen).toHaveLength(0);
    expect(verwirfAuftrag).not.toHaveBeenCalled();
  });

  it("schlägt an, wenn drei Starts binnen einer Minute auf Abstürze folgen", () => {
    initAbsturzWache({}); /* Start 1 — endet unsauber (kein pagehide) */
    jetzt += 3000;
    expect(initAbsturzWache({})).toBe(false); /* 1. Absturz-Start */
    jetzt += 3000;
    expect(initAbsturzWache({})).toBe(false); /* 2. Absturz-Start */
    jetzt += 3000;
    expect(initAbsturzWache({})).toBe(true); /* 3. Absturz-Start → Schleife */
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0].kontext.phase).toBe("absturz-schleife");
  });

  it("ein sauberes Neuladen zwischendurch zählt nicht mit", () => {
    initAbsturzWache({});
    jetzt += 2000;
    initAbsturzWache({}); /* Absturz-Start 1 */
    sauberBeenden(); /* dieser Durchlauf endet sauber */
    jetzt += 2000;
    initAbsturzWache({}); /* zählt NICHT — Vorgänger sauber */
    jetzt += 2000;
    expect(initAbsturzWache({})).toBe(false); /* erst Absturz-Start 2 */
    expect(meldungen).toHaveLength(0);
  });

  it("verwirft den gemerkten Auftrag, um die Schleife zu brechen", () => {
    const verwirfAuftrag = vi.fn();
    for (let i = 0; i < 4; i++) {
      initAbsturzWache({ verwirfAuftrag });
      jetzt += 3000;
    }
    expect(verwirfAuftrag).toHaveBeenCalledTimes(1);
  });

  it("meldet die zuletzt erreichte Phase mit", () => {
    initAbsturzWache({});
    merkePhase("i18n");
    for (let i = 0; i < 3; i++) {
      jetzt += 2000;
      initAbsturzWache({});
    }
    expect(meldungen[0].kontext.errorDetail).toContain("letztePhase=i18n");
  });

  it("meldet, ob ein Auftrag offen war — die wichtigste Spur", () => {
    sessionStorage.setItem("malzime.queueJobId", "job-123");
    for (let i = 0; i < 4; i++) {
      initAbsturzWache({});
      jetzt += 2000;
    }
    expect(meldungen[0].kontext.errorDetail).toContain("offenerAuftrag=true");
  });

  it("meldet nur EINMAL, nicht bei jedem weiteren Start", () => {
    for (let i = 0; i < 4; i++) {
      initAbsturzWache({});
      jetzt += 2000;
    }
    expect(meldungen).toHaveLength(1);
    /* Der Zähler ist zurückgesetzt — der nächste Absturz-Start beginnt bei
       eins und bleibt still. */
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(1);
  });

  it("zählt Absturz-Starts nicht mit, die länger als eine Minute her sind", () => {
    initAbsturzWache({});
    jetzt += 5000;
    initAbsturzWache({}); /* Absturz-Start 1 */
    jetzt += 30_000;
    initAbsturzWache({}); /* Absturz-Start 2 */
    /* Absturz-Start 1 fällt jetzt aus dem Fenster. */
    jetzt += 40_000;
    expect(initAbsturzWache({})).toBe(false);
    expect(meldungen).toHaveLength(0);
  });

  it("nach Rückkehr aus dem Rückwärtscache zählt der nächste Absturz wieder", () => {
    /* pagehide meldet ab — kommt die Seite aber aus dem bfcache zurück, läuft
       das Modul nicht erneut. pageshow(persisted) muss neu anmelden, sonst
       wäre der nächste echte Absturz als „sauber beendet" getarnt. */
    initAbsturzWache({});
    sauberBeenden();
    const zurueck = new Event("pageshow");
    Object.defineProperty(zurueck, "persisted", { value: true });
    window.dispatchEvent(zurueck);
    /* Ab hier: Durchlauf lebt wieder, stürzt dann dreimal ab. */
    jetzt += 2000;
    initAbsturzWache({});
    jetzt += 2000;
    initAbsturzWache({});
    jetzt += 2000;
    expect(initAbsturzWache({})).toBe(true);
    expect(meldungen).toHaveLength(1);
  });

  it("ein defekter Speicher legt den Seitenstart nicht lahm", () => {
    const lesen = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const schreiben = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => initAbsturzWache({})).not.toThrow();
    expect(initAbsturzWache({})).toBe(false);

    lesen.mockRestore();
    schreiben.mockRestore();
  });

  it("ein Fehler beim Aufräumen verhindert die Meldung nicht", () => {
    /* Sonst wäre der Fall, in dem die Selbstheilung scheitert, genau der Fall,
       über den wir nichts erfahren. */
    const verwirfAuftrag = vi.fn(() => {
      throw new Error("kaputt");
    });
    for (let i = 0; i < 3; i++) {
      initAbsturzWache({ verwirfAuftrag });
      jetzt += 2000;
    }
    expect(() => initAbsturzWache({ verwirfAuftrag })).not.toThrow();
    expect(meldungen).toHaveLength(1);
  });
});
