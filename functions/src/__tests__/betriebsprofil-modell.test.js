/**
 * betriebsprofil-modell.test.js — Das Modell wird im Einstellungssatz gewaehlt.
 *
 * HINTERGRUND (19.11.2026): Mistral Large 4 wurde ab 17.11. rund viermal so
 * langsam, der Rueckweg auf Large 3 brauchte eine Auslieferung. Vorgabe
 * Christoph: Das Modell soll im Betrieb umschaltbar sein. Seither waehlt das
 * Feld `modell` im Dokument config/betriebsprofil, welches Modell rechnet —
 * nur eines aus ERLAUBTE_MODELLE, und nur, wenn der aktive Satz dazu passt.
 */

const mockDoc = { daten: undefined, wirft: false };

jest.mock("../db", () => ({
  datenbank: () => ({
    doc: () => ({
      async get() {
        if (mockDoc.wirft) throw new Error("UNAVAILABLE");
        return { exists: mockDoc.daten !== undefined, data: () => mockDoc.daten };
      },
    }),
  }),
}));

const { geltendeWerte, _cacheLeeren } = require("../betriebsprofil");
const { MISTRAL_MODEL, ERLAUBTE_MODELLE } = require("../config");
const { SATZ } = require("../test-satz");
const { PROFILE, AKTIV } = require("../produktiv-satz");

const setze = (d) => {
  mockDoc.daten = d;
  _cacheLeeren();
};

let fehler;
let ausgabe;
beforeEach(() => {
  ausgabe = jest.spyOn(console, "log").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  ausgabe.mockRestore();
  fehler.mockRestore();
});

describe("Feld modell im Einstellungssatz", () => {
  test("fehlt es, gilt das Modell aus config.js", async () => {
    setze({ aktiv: "t", profile: { t: SATZ } });
    const stand = await geltendeWerte();
    expect(stand.werte).not.toBeNull();
    expect(stand.modell).toBe(MISTRAL_MODEL);
  });

  test.each(ERLAUBTE_MODELLE)("%s mit dem produktiven Satz wird angenommen und protokolliert", async (modell) => {
    setze({ aktiv: AKTIV, modell, profile: PROFILE });
    const stand = await geltendeWerte();
    expect(stand.werte).not.toBeNull();
    expect(stand.modell).toBe(modell);
    const zeile = JSON.parse(ausgabe.mock.calls[0][0]);
    expect(zeile).toMatchObject({ step: "betriebsprofil", modell });
  });

  test.each([["mistral-small-latest"], ["Mistral-Large-4"], [""], [42], [null]])(
    "ein nicht erlaubtes Modell (%p) legt den Satz still, mit Grund im Protokoll",
    async (modell) => {
      setze({ aktiv: AKTIV, modell, profile: PROFILE });
      const stand = await geltendeWerte();
      expect(stand.werte).toBeNull();
      expect(stand.grund).toMatch(/nicht erlaubt/);
      expect(JSON.parse(fehler.mock.calls[0][0]).grund).toMatch(/nicht erlaubt/);
    }
  );

  test("passt der Satz nicht zum Modell, wird er abgelehnt (Large 4 braucht mehr Text)", async () => {
    /* Der Testsatz erlaubt weniger Text, als Large 4 braucht. */
    setze({ aktiv: "t", modell: "mistral-large-4", profile: { t: SATZ } });
    const stand = await geltendeWerte();
    expect(stand.werte).toBeNull();
    expect(stand.grund).toMatch(/singleLargeMaxTokens .* zu klein/);
    /* Derselbe Satz mit Large 3 ist in Ordnung. */
    setze({ aktiv: "t", modell: "mistral-large-2512", profile: { t: SATZ } });
    expect((await geltendeWerte()).werte).not.toBeNull();
  });
});

/* Abnahme 19.11.2026, P2-2: Ist der Satz nur GERADE nicht lesbar, gilt der
   letzte gueltige Stand weiter — MIT seinem Modell. Sonst fielen neue
   Analysen waehrend einer Stoerung still auf die Vorgabe aus config.js
   zurueck, mit anderer Zeitgrenze und ohne Neuversuch. */
test("Lesefehler: das zuletzt gelesene Modell (Large 4) gilt weiter", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const echt = Date.now;
  try {
    setze({ aktiv: AKTIV, profile: PROFILE, modell: "mistral-large-4" });
    expect((await geltendeWerte()).modell).toBe("mistral-large-4");
    mockDoc.wirft = true;
    const spaeter = echt() + 31_000;
    Date.now = () => spaeter;
    const stand = await geltendeWerte();
    expect(stand.letzterStand).toBe(true);
    expect(stand.modell).toBe("mistral-large-4");
  } finally {
    Date.now = echt;
    mockDoc.wirft = false;
    warn.mockRestore();
  }
});
