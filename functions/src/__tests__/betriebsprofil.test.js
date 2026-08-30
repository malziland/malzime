/**
 * betriebsprofil.test.js — Betriebswerte aus Firestore, als benannte Saetze.
 *
 * HINTERGRUND: Der Vorschlag "einzelne Werte aus Firestore" wurde am
 * 18.08.2026 gestrichen, weil er die Kopplung zwischen Zeitgrenze und
 * Token-Menge aufgehoben haette — genau die Sicherung, die einen Ausfall am
 * 17.08. verhindert hat.
 *
 * Profile loesen das, aber nur unter einer Bedingung: Die Sicherung muss beim
 * LADEN laufen. Die Haelfte dieser Pruefungen dreht sich deshalb darum, dass
 * ein widerspruechliches Profil ABGELEHNT wird und die Code-Werte gelten.
 */

const mockDoc = { daten: undefined, fehler: null };

let leseZaehler = 0;

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        leseZaehler += 1;
        if (mockDoc.verzoegerung) await new Promise((f) => setTimeout(f, mockDoc.verzoegerung));
        if (mockDoc.fehler) throw new Error(mockDoc.fehler);
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, codeWerte, _pruefe, _cacheLeeren } = require("../betriebsprofil");

function setze(daten, fehler = null, verzoegerung = 0) {
  mockDoc.daten = daten;
  mockDoc.fehler = fehler;
  mockDoc.verzoegerung = verzoegerung;
  leseZaehler = 0;
  _cacheLeeren();
}

beforeEach(() => setze(undefined));

describe("Rueckfallebene — der schlechteste Fall ist der heutige Zustand", () => {
  test("ohne Dokument gelten die Code-Werte", async () => {
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.werte).toEqual(codeWerte());
    expect(e.grund).toBe("kein Dokument");
  });

  test("ohne benanntes aktives Profil gelten die Code-Werte", async () => {
    setze({ profile: { "t2-normal": { parallelitaet: 14 } } });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("kein aktives Profil");
  });

  test("zeigt das aktive Profil ins Leere, gelten die Code-Werte", async () => {
    setze({ aktiv: "gibt-es-nicht", profile: {} });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("nicht hinterlegt");
  });

  test("ist Firestore nicht lesbar, gelten die Code-Werte", async () => {
    /* Eine Netzwerkstoerung darf nie zu einem Betriebsausfall werden. */
    setze(undefined, "UNAVAILABLE");
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("nicht lesbar");
  });
});

describe("Die Sicherung wandert mit", () => {
  test("ein Profil, dessen Token-Menge nicht in die Zeit passt, wird ABGELEHNT", async () => {
    /* BUG-2026-08-17-01 in Profilform: 20000 Token brauchen bei der langsamsten
       gemessenen Geschwindigkeit weit mehr als 60 s. Genau diese Kombination
       hat am 17.08. Analysen getoetet, die das Token-Budget ausdruecklich
       zuliess.
       (Rueckbauprobe: Ohne den Aufruf von pruefe() in geltendeWerte() wird das
       Profil uebernommen -> quelle "firestore" -> ROT.) */
    setze({
      aktiv: "kaputt",
      profile: { kaputt: { singleLargeMaxTokens: 20000, singleLargeTimeoutMs: 60000 } },
    });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("abgelehnt");
    expect(e.werte).toEqual(codeWerte());
  });

  test("eine Einzelgrenze ueber dem Gesamtbudget wird abgelehnt", async () => {
    setze({
      aktiv: "zu-lang",
      profile: { "zu-lang": { singleLargeTimeoutMs: 500000, requestBudgetMs: 400000 } },
    });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("ueber requestBudgetMs");
  });

  test("ein Budget ueber dem Function-Limit wird abgelehnt", async () => {
    /* Google gibt der Function 540 s. Ein Budget darueber ist eine Zusage,
       die das System gar nicht halten kann. */
    setze({ aktiv: "zu-gross", profile: { "zu-gross": { requestBudgetMs: 600000 } } });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("Function-Limit");
  });

  test("unsinnige Werte werden abgelehnt, nicht uebernommen", () => {
    expect(_pruefe({ ...codeWerte(), parallelitaet: 0 })).toContain("parallelitaet");
    expect(_pruefe({ ...codeWerte(), stundenlimit: -5 })).toContain("stundenlimit");
    expect(_pruefe({ ...codeWerte(), adressLimit: "viele" })).toContain("adressLimit");
  });

  test("die Code-Werte selbst bestehen die Pruefung", () => {
    /* POSITIVKONTROLLE: Wuerde die Pruefung den eigenen Zustand ablehnen,
       waere sie zu streng und jedes Profil chancenlos. */
    expect(_pruefe(codeWerte())).toBeNull();
  });
});

describe("Ein gueltiges Profil greift", () => {
  test("ein vollstaendiges Profil wird uebernommen", async () => {
    setze({
      aktiv: "t2-normal",
      profile: { "t2-normal": { parallelitaet: 14, stundenlimit: 1000 } },
    });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("firestore");
    expect(e.profil).toBe("t2-normal");
    expect(e.werte.parallelitaet).toBe(14);
    expect(e.werte.stundenlimit).toBe(1000);
  });

  test("fehlende Felder bleiben beim Code-Wert", async () => {
    /* Ein unvollstaendiges Profil ist brauchbar, nicht gefaehrlich: Wer nur
       die Parallelitaet umstellt, soll nicht alle anderen Werte abschreiben
       muessen. */
    setze({ aktiv: "nur-eins", profile: { "nur-eins": { parallelitaet: 3 } } });
    const e = await geltendeWerte();
    expect(e.werte.parallelitaet).toBe(3);
    expect(e.werte.stundenlimit).toBe(codeWerte().stundenlimit);
    expect(e.werte.singleLargeTimeoutMs).toBe(codeWerte().singleLargeTimeoutMs);
  });

  test("unbekannte Felder werden ignoriert", async () => {
    /* Ein Tippfehler im Profil darf nichts kaputt machen und nichts
       Unerwartetes einschleusen. */
    setze({
      aktiv: "mit-tippfehler",
      profile: { "mit-tippfehler": { parallelitaet: 5, uploadGrenze: 999999999, modell: "gpt-4" } },
    });
    const e = await geltendeWerte();
    expect(e.quelle).toBe("firestore");
    expect(e.werte.parallelitaet).toBe(5);
    expect(e.werte.uploadGrenze).toBeUndefined();
    expect(e.werte.modell).toBeUndefined();
  });
});

describe("Review-Befunde vom 30.08.", () => {
  test("BEFUND 1: eine haengende Datenbank blockiert die Analyse NICHT", async () => {
    /* Diese Funktion sitzt im Analyse-Pfad. Ohne Zeitlimit haette ein
       haengender Firestore-Aufruf den Start JEDER Analyse blockiert — statt
       still auf die Code-Werte zurueckzufallen, waere die Anwendung
       stehengeblieben. Damit waere die ganze Rueckfallebene wertlos gewesen.

       Hier: Die Datenbank braucht 5 s, das Zeitlimit liegt bei 2 s.

       (Rueckbauprobe: Ohne Promise.race dauert der Aufruf ueber 5 s und der
       Zeitvergleich unten wird ROT.) */
    setze({ aktiv: "egal", profile: { egal: { parallelitaet: 9 } } }, null, 5000);
    const start = Date.now();
    const e = await geltendeWerte();
    const gedauert = Date.now() - start;

    expect(gedauert).toBeLessThan(4000);
    expect(e.quelle).toBe("code");
    expect(e.grund).toContain("nicht lesbar");
    expect(e.werte).toEqual(codeWerte());
  }, 10000);

  test("BEFUND 3: unsinnige Kapazitaeten werden abgelehnt, sinnvolle nicht", async () => {
    /* Im Review aufgefallen: `parallelitaet: 99999` ging durch. Alle anderen
       Unsinnswerte fing die Kopplungsrechnung ab, dieser nicht — er haette die
       Wartezeit-Ansage und die Einlassgrenze absurd gemacht.

       Die Grenzen sind bewusst weit: Ein Tarifwechsel auf 14 parallele
       Analysen muss durchgehen, ein Tippfehler nicht.

       (Rueckbauprobe: Ohne die GRENZEN-Pruefung wird 99999 uebernommen -> ROT.) */
    setze({ aktiv: "unfug", profile: { unfug: { parallelitaet: 99999 } } });
    const abgelehnt = await geltendeWerte();
    expect(abgelehnt.quelle).toBe("code");
    expect(abgelehnt.grund).toContain("plausiblen Bereichs");

    setze({ aktiv: "t2", profile: { t2: { parallelitaet: 14, stundenlimit: 1000 } } });
    const angenommen = await geltendeWerte();
    expect(angenommen.quelle).toBe("firestore");
    expect(angenommen.werte.parallelitaet).toBe(14);
  });

  test("BEFUND 2: der Zwischenspeicher greift — nicht jeder Aufruf liest die Datenbank", async () => {
    /* Ohne Zwischenspeicher laege bei jedem Analyse-Start ein zusaetzlicher
       Firestore-Aufruf an. Bei einem Workshop mit 1000 Analysen am Vormittag
       waeren das 1000 vermeidbare Lesevorgaenge — Kosten und Latenz ohne
       Gegenwert, weil sich Profile im Minutentakt nicht aendern. */
    setze({ aktiv: "t2", profile: { t2: { parallelitaet: 14 } } });
    const a = await geltendeWerte();
    const b = await geltendeWerte();
    const c = await geltendeWerte();

    expect(a.werte.parallelitaet).toBe(14);
    expect(b.werte.parallelitaet).toBe(14);
    expect(c.werte.parallelitaet).toBe(14);
    expect(leseZaehler).toBe(1);
  });
});
