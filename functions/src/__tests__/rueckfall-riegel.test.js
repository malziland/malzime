/**
 * Die Riegel gegen den Rückfall.
 *
 * ANLASS (Rückbauprobe 30.08.2026, auf Anregung des Nutzers): Nachdem alle
 * Befunde des Audits behoben und alle 1017 Tests grün waren, wurde jeder Fix
 * absichtlich wieder zurückgebaut, um zu messen, ob die Testkette es merkt.
 *
 * SECHS VON ZEHN RÜCKBAUTEN BLIEBEN GRÜN.
 *
 * Das heißt: Sechs Fixes waren durch keinen einzigen Test gedeckt. Sie hätten
 * jederzeit still zurückfallen können — bei einem Merge, einem Refactoring,
 * einem unaufmerksamen Moment. Ein Fix ohne Test ist eine Momentaufnahme,
 * keine Eigenschaft des Systems.
 *
 * Am schwersten wogen die beiden Datenschutz-Obergrenzen: Sie waren
 * ausschließlich per `node -e` von Hand geprüft worden. Eine Prüfung, die
 * niemand wiederholt, ist keine.
 *
 * Diese Datei schließt alle sechs Lücken. Jeder Test hier entspricht genau
 * einer Rückbauprobe, die vorher grün blieb.
 */

const { SATZ } = require("../test-satz");

describe("Riegel 1-4: Die vier Datenschutzzusagen sind Obergrenzen", () => {
  /* Die Datenschutzerklärung nennt vier konkrete Fristen. Der
     Einstellungssatz darf sie nur VERKÜRZEN — sonst ließe sich eine
     öffentliche Zusage mit einem Datenbankeintrag brechen, ohne Commit und
     ohne Spur im Quelltext.

     Diese vier Tests sind der einzige automatische Schutz davor. Vorher gab
     es keinen. */
  const { _pruefe, _FELDER } = require("../betriebsprofil");

  test.each([
    ["adressfensterMs", 10 * 60 * 1000, "merkt sich deine IP für maximal 10 Minuten"],
    ["stundenfensterMinuten", 60, "die Zeitpunkte der Analysen der letzten 60 Minuten"],
    ["zustellfensterMs", 15 * 60 * 1000, "wenige Minuten nach der Abholung gelöscht"],
    ["jobAufbewahrungMs", 2 * 60 * 60 * 1000, "nie abgeholte spätestens nach rund 2 Stunden"],
  ])("%s: Obergrenze ist die Zusage (%i)", (feld, grenze, _zusage) => {
    /* Die Grenze steht exakt auf dem zugesagten Wert — nicht darüber. */
    expect(_FELDER[feld].max).toBe(grenze);
  });

  test.each([
    ["adressfensterMs", 10 * 60 * 1000],
    ["stundenfensterMinuten", 60],
    ["zustellfensterMs", 15 * 60 * 1000],
    ["jobAufbewahrungMs", 2 * 60 * 60 * 1000],
  ])("%s: ein Satz über der Zusage wird abgelehnt", (feld, grenze) => {
    /* Und die Grenze wirkt auch — eine Obergrenze in der Tabelle, die die
       Prüfung nicht anwendet, wäre wertlos. */
    expect(_pruefe({ ...SATZ, [feld]: grenze + 1 })).toMatch(new RegExp(feld));
  });

  test.each([
    ["adressfensterMs", 5 * 60 * 1000],
    ["stundenfensterMinuten", 30],
    ["zustellfensterMs", 5 * 60 * 1000],
    ["jobAufbewahrungMs", 60 * 60 * 1000],
  ])("%s: eine KÜRZERE Frist bleibt erlaubt", (feld, kuerzer) => {
    /* Verschärfen muss möglich bleiben — sonst wäre der Schutz ein Käfig. */
    expect(_pruefe({ ...SATZ, [feld]: kuerzer })).toBeNull();
  });
});

describe("Riegel 5: Die Zeitgrenze der KI-Aufrufe ist Pflicht", () => {
  /* Rückbauprobe 1 blieb grün: Ein Rückfall auf eine fest eingebaute
     Zeitgrenze (90000) wäre unbemerkt geblieben, weil ein anderer Riegel
     vorher greift. Hier wird die Funktion direkt geprüft. */
  jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

  test("callMistralRaw ohne Zeitgrenze bricht ab statt zu raten", async () => {
    /* Der Schluessel-Riegel greift vorher — hier geht es um die Zeitgrenze. */
    const vorher = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = "probe-schluessel";
    const mistral = require("../mistral");
    const roh = mistral._callMistralRawUnthrottled || mistral._callMistralRaw;
    if (!roh) {
      throw new Error(
        "callMistralRawUnthrottled ist nicht exportiert — dieser Riegel kann nicht prüfen. " +
          "Das ist ein Fund, kein Grund zum Überspringen."
      );
    }
    try {
      await expect(roh({ model: "x", messages: [], maxTokens: 1, temperature: 0 })).rejects.toThrow(
        /timeoutCapMs fehlt/
      );
    } finally {
      if (vorher === undefined) delete process.env.MISTRAL_API_KEY;
      else process.env.MISTRAL_API_KEY = vorher;
    }
  });
});

describe("Riegel 6: Die Karenzfrist ist Pflicht", () => {
  /* Rückbauprobe 2 blieb grün: `isAbandoned` hätte still auf 480000
     zurückfallen können. Kein Test rief die Funktion ohne Frist auf. */
  const jobs = require("../jobs");

  test("isAbandoned ohne Frist wirft, statt eine anzunehmen", () => {
    expect(() => jobs.isAbandoned({ status: "queued", lastSeenAt: 0 })).toThrow(
      /livenessGnadenfristMs/
    );
  });

  test("isAbandoned nutzt die ÜBERGEBENE Frist, nicht eine eigene", () => {
    /* Der stärkere Nachweis: Dieselbe Lage, zwei Fristen, zwei Ergebnisse.
       Ein fest eingebauter Wert könnte das nicht leisten. */
    const job = { status: "queued", lastSeenAt: Date.now() - 5 * 60 * 1000 };
    expect(jobs.isAbandoned(job, 10 * 60 * 1000)).toBe(false);
    expect(jobs.isAbandoned(job, 1 * 60 * 1000)).toBe(true);
  });
});

describe("Riegel 7: Rate-Limit-Grenze und -Fenster sind Pflicht", () => {
  /* Rückbauprobe 8 blieb grün. */
  const { checkRateLimit } = require("../middleware");

  test("ohne Grenze wirft es, statt 500 anzunehmen", () => {
    expect(() => checkRateLimit("schluessel-" + Date.now())).toThrow(/adressLimit/);
  });

  test("ohne Fenster wirft es, statt 10 Minuten anzunehmen", () => {
    expect(() => checkRateLimit("schluessel-" + Date.now(), 500)).toThrow(/adressfensterMs/);
  });

  test("es nutzt die ÜBERGEBENE Grenze, nicht eine eigene", () => {
    const p = "grenze-probe-" + Date.now() + "-";
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(true);
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(true);
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(false);
  });
});

describe("Riegel 8: Die Laufzeit-Wache misst gegen die übergebene Grenze", () => {
  /* Rückbauprobe 10 blieb grün: Die Wache hätte gegen eine fest eingebaute
     Grenze (300000) messen können, ohne dass ein Test es merkt. Nach einer
     Umstellung der Zeitgrenze hätte sie gemeldet, alles sei in Ordnung. */
  const { _bewerte } = require("../laufzeit-wache");

  /* 15 Läufe zu je 250 s. Gegen eine Grenze von 300 s liegen sie bei 83 % —
     deutlich über der Meldeschwelle. Gegen 600 s bei 42 % — darunter. */
  const tage = [
    { d: "2026-08-28", w: Array(15).fill(250) },
    { d: "2026-08-29", w: Array(15).fill(250) },
    { d: "2026-08-30", w: Array(15).fill(250) },
  ];

  test("bei enger Grenze schlägt sie an", () => {
    expect(_bewerte(tage, 300000).grund).toBe("nah-an-der-zeitgrenze");
  });

  test("bei weiter Grenze schlägt sie NICHT an — dieselben Läufe", () => {
    expect(_bewerte(tage, 600000).grund).not.toBe("nah-an-der-zeitgrenze");
  });
});

describe("Riegel 9: Die Wache holt die Grenze aus dem Satz, nicht aus dem Code", () => {
  /* Der Test darüber prüft die Bewertungsfunktion mit zwei Grenzen. Er merkt
     aber NICHT, wenn der Aufrufer eine feste Zahl übergibt — genau daran
     blieb Rückbauprobe 10 grün.
     Hier wird deshalb der ganze Weg geprüft: Ein Einstellungssatz mit einer
     ungewöhnlichen Zeitgrenze muss sich im Ergebnis der Wache zeigen. */
  const SATZ_GRENZE_MS = 100000; /* 100 s — keine Zahl, die im Code steht */

  beforeEach(() => jest.resetModules());
  afterEach(() => jest.restoreAllMocks());

  function wacheMitGrenze(grenzeMs, tage) {
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({
        werte: { ...require("../test-satz").SATZ, singleLargeTimeoutMs: grenzeMs },
        quelle: "firestore",
        profil: "probe",
        grund: null,
      }),
    }));
    jest.doMock("../durchsatz", () => ({ tagesHistorie: async () => tage }));
    jest.doMock("../db", () => ({
      datenbank: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }),
    }));
    return require("../laufzeit-wache");
  }

  /* Läufe zu 85 s: über 80 % von 100 s (Meldeschwelle), aber weit unter
     80 % von 300 s. Der Unterschied kann nur aus dem Satz kommen. */
  const tage = [
    { d: "2026-08-28", w: Array(15).fill(85) },
    { d: "2026-08-29", w: Array(15).fill(85) },
    { d: "2026-08-30", w: Array(15).fill(85) },
  ];

  test("enge Grenze im Satz: die Wache meldet", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const gemeldet = [];
    const { pruefeLaufzeit } = wacheMitGrenze(SATZ_GRENZE_MS, tage);
    await pruefeLaufzeit({ melder: async (t) => gemeldet.push(t), jetzt: Date.now() });
    /* Die Wache meldet erst am zweiten auffälligen Tag in Folge — geprüft wird
       deshalb der Befund, nicht der Versand. */
    const { _bewerte } = wacheMitGrenze(SATZ_GRENZE_MS, tage);
    expect(_bewerte(tage, SATZ_GRENZE_MS).grund).toBe("nah-an-der-zeitgrenze");
  });

  test("dieselben Läufe, weite Grenze im Satz: die Wache schweigt", async () => {
    const { _bewerte } = wacheMitGrenze(300000, tage);
    expect(_bewerte(tage, 300000).grund).not.toBe("nah-an-der-zeitgrenze");
  });

  /* DER EIGENTLICHE RIEGEL — geprüft wird die WIRKUNG, nicht der Aufruf.
     Eine erste Fassung zählte nur mit, ob `geltendeWerte()` gerufen wurde.
     Das reichte nicht: Beim Rückbau wird der Wert weiterhin gelesen, nur
     nicht mehr benutzt. Der Test blieb grün.

     Jetzt entscheidet allein die Zeitgrenze im Satz über das Ergebnis:
     Dieselben Läufe (85 s), zweimal geprüft, einmal gegen 100 s und einmal
     gegen 300 s. Nimmt der Aufrufer eine feste Zahl, sind beide Ergebnisse
     gleich — und der Test wird rot. */
  async function wacheLaufenLassen(grenzeMs) {
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({
        werte: { ...require("../test-satz").SATZ, singleLargeTimeoutMs: grenzeMs },
        quelle: "firestore",
        profil: "probe",
        grund: null,
      }),
    }));
    jest.doMock("../durchsatz", () => ({ tagesHistorie: async () => tage }));
    /* Vortag bereits auffällig: Die Wache meldet erst am zweiten Tag in
       Folge. Ohne diesen Zustand käme nie eine Meldung zustande, und der
       Test würde in beiden Fällen dasselbe sehen — also nichts messen. */
    const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    jest.doMock("../db", () => ({
      datenbank: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ auffaelligSeit: gestern, gemeldetAm: null }) }),
          set: async () => {},
        }),
      }),
    }));
    const gemeldet = [];
    const { pruefeLaufzeit } = require("../laufzeit-wache");
    const e = await pruefeLaufzeit({ melder: async (t) => gemeldet.push(t), jetzt: Date.now() });
    return { ergebnis: e, gemeldet };
  }

  test("die Grenze aus dem Satz entscheidet über die Meldung", async () => {
    const eng = await wacheLaufenLassen(SATZ_GRENZE_MS); /* 100 s: 85 s sind 85 % */
    const weit = await wacheLaufenLassen(300000); /* 300 s: 85 s sind 28 % */

    expect(eng.ergebnis.gemeldet).toBe(true);
    expect(weit.ergebnis.gemeldet).toBe(false);
  });
});
