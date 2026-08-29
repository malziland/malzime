/**
 * betriebsprofil-wirkung.test.js — Kommt ein Profil im Analyse-Pfad an?
 *
 * Die Pruefungen in betriebsprofil.test.js zeigen, dass Profile korrekt
 * GELESEN werden. Das ist die halbe Wahrheit: Ein Schalter, der gelesen, aber
 * nicht benutzt wird, ist schlimmer als keiner — er weckt den Eindruck, man
 * koenne im Betrieb reagieren, waehrend in Wirklichkeit die alten Werte gelten.
 *
 * Hier wird deshalb der Weg bis zum echten Aufruf geprueft.
 */

const mockDoc = { daten: undefined };

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, codeWerte, _cacheLeeren } = require("../betriebsprofil");

function setze(daten) {
  mockDoc.daten = daten;
  _cacheLeeren();
}

describe("Ein Profil wirkt bis in den Analyse-Aufruf", () => {
  beforeEach(() => setze(undefined));

  test("ohne Profil gelten im Analyse-Pfad die Code-Werte", async () => {
    const { werte } = await geltendeWerte();
    expect(werte.singleLargeTimeoutMs).toBe(codeWerte().singleLargeTimeoutMs);
    expect(werte.singleLargeMaxTokens).toBe(codeWerte().singleLargeMaxTokens);
  });

  test("ein gueltiges Profil aendert Zeitgrenze UND Textmenge gemeinsam", async () => {
    /* Der Kern des Entwurfs: Die beiden gehoeren zusammen. Ein Profil, das
       nur eines von beiden setzt, ist erlaubt — dann bleibt das andere beim
       Code-Wert und die Kopplungspruefung entscheidet, ob das zusammenpasst. */
    setze({
      aktiv: "langsamer-anbieter",
      profile: { "langsamer-anbieter": { singleLargeTimeoutMs: 420000, singleLargeMaxTokens: 4000 } },
    });
    const { werte, quelle, profil } = await geltendeWerte();
    expect(quelle).toBe("firestore");
    expect(profil).toBe("langsamer-anbieter");
    expect(werte.singleLargeTimeoutMs).toBe(420000);
    expect(werte.singleLargeMaxTokens).toBe(4000);
  });

  test("DER FALL VOM 28.08.: Zeitgrenze hochdrehen wirkt ohne Auslieferung", async () => {
    /* Am 28.08. musste die Zeitgrenze von 150 auf 300 s — das kostete eine
       vollstaendige Auslieferung von rund 25 Minuten, mitten im Vorfall.
       Mit einem Profil ist es ein Feld.

       Geprueft wird der reale Sprung: 300 auf 420 s, mit passend
       mitgezogener Textmenge. */
    setze({
      aktiv: "notfall",
      profile: { notfall: { singleLargeTimeoutMs: 420000, singleLargeMaxTokens: 5000 } },
    });
    const { werte } = await geltendeWerte();
    expect(werte.singleLargeTimeoutMs).toBe(420000);
    expect(werte.singleLargeTimeoutMs).toBeGreaterThan(codeWerte().singleLargeTimeoutMs);
  });

  test("ein widerspruechliches Notfall-Profil wird ABGELEHNT, der Betrieb laeuft weiter", async () => {
    /* Der gefaehrliche Fall: Jemand dreht unter Druck die Zeitgrenze RUNTER
       und vergisst die Textmenge. Genau das war der Ausfall vom 17.08.
       Statt die Analysen zu toeten, gelten die bewaehrten Werte weiter. */
    setze({
      aktiv: "unter-druck",
      profile: { "unter-druck": { singleLargeTimeoutMs: 30000, singleLargeMaxTokens: 5000 } },
    });
    const { werte, quelle, grund } = await geltendeWerte();
    expect(quelle).toBe("code");
    expect(grund).toContain("abgelehnt");
    expect(werte.singleLargeTimeoutMs).toBe(codeWerte().singleLargeTimeoutMs);
  });
});
