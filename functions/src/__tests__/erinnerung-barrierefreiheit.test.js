/**
 * erinnerung-barrierefreiheit.test.js — die Wochen-Erinnerung kennt auch die
 * halbjährliche Prüfung der Barrierefreiheit (DOC-2026-10-03-51).
 *
 * Die Erklärung zur Barrierefreiheit verspricht die ganze Prüfung samt
 * Handprüfung „mindestens halbjährlich" und nennt ihr Prüfdatum selbst. Ohne
 * Erinnerung merkt in sechs Monaten niemand, dass die Frist abläuft.
 *
 * Geprüft wird:
 *   - das Datum der ECHTEN Seite ist lesbar (ändert jemand die Wendung, kann
 *     die Erinnerung nichts mehr lesen — das soll hier auffallen, nicht erst
 *     im Februar);
 *   - der Push kommt drei Wochen vorher, nicht früher, und nennt die Schritte;
 *   - die zwei Zusagen stören einander nicht;
 *   - das Lebenszeichen sagt „Erfolg" nur, wenn BEIDE Fristen bewertet wurden.
 *
 * Kein Netz, keine echte Uhr, Datenbank im Arbeitsspeicher.
 */

jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));

const fs = require("fs");
const path = require("path");
const speicher = require("./hilfen/speicher-datenbank");
const {
  pruefeAlleZusagen,
  pruefeZusagen,
  baueMeldungBarrierefreiheit,
  LEBENSZEICHEN_DOC,
} = require("../handle-erinnerung");
const {
  leseBarrierefreiheitsPruefdatum,
  leseZdrPruefdatum,
  bewerteFrist,
  formatiereDatum,
  FRIST_TAGE,
  VORWARNUNG_TAGE,
  VORWARNUNG_HANDPRUEFUNG_TAGE,
} = require("../zusagen");

const WURZEL = path.join(__dirname, "../../..");
const TAG = 86400000;
/* Feste „Jetzt"-Zeit — Tests dürfen nicht von der Uhr abhängen. */
const JETZT = new Date(2027, 0, 20).getTime();

const DATENSCHUTZ = (datum) => `<p>… Zero Data Retention … zuletzt am ${datum} überprüft und dokumentiert; …</p>`;
const ERKLAERUNG = (datum) =>
  `<p>Erstellt am 17.&nbsp;August&nbsp;2026, zuletzt gepr&uuml;ft am ${datum}, auf Grundlage …</p>`;
const vorTagen = (tage) => formatiereDatum(new Date(JETZT - tage * TAG));
const FRISCH = vorTagen(10);

/** Stellt beide Seiten und den Push-Dienst. `null` als Seite = nicht erreichbar. */
function abrufAttrappe({ datenschutz = DATENSCHUTZ(FRISCH), erklaerung = ERKLAERUNG(FRISCH), protokoll = [] } = {}) {
  const seite = (html) =>
    html === null
      ? { ok: false, status: 503, text: async () => "" }
      : { ok: true, status: 200, text: async () => html };
  return async (url, optionen) => {
    if (String(url).endsWith("/datenschutz.html")) return seite(datenschutz);
    if (String(url).endsWith("/barrierefreiheit.html")) return seite(erklaerung);
    protokoll.push(JSON.parse(optionen.body));
    return { ok: true, status: 200, text: async () => "" };
  };
}

const lauf = (attrappe) =>
  pruefeAlleZusagen({ ntfyUrl: "https://ntfy.example/x", ntfyTopic: "t", abruf: attrappe, jetzt: JETZT });

beforeEach(() => {
  speicher.leeren();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Prüfdatum der Erklärung zur Barrierefreiheit", () => {
  const seite = fs.readFileSync(path.join(WURZEL, "public/barrierefreiheit.html"), "utf8");

  test("steht in der echten Seite und ist lesbar", () => {
    const datum = leseBarrierefreiheitsPruefdatum(seite);
    expect(datum).not.toBeNull();
    expect(formatiereDatum(datum)).toMatch(/^\d{1,2}\. [A-Za-zä]+ \d{4}$/);
  });

  test("liest beide Schreibweisen des Umlauts und des Leerzeichens", () => {
    expect(formatiereDatum(leseBarrierefreiheitsPruefdatum(ERKLAERUNG("23.&nbsp;August&nbsp;2026")))).toBe(
      "23. August 2026"
    );
    expect(formatiereDatum(leseBarrierefreiheitsPruefdatum("<p>zuletzt geprüft am 1. März 2027</p>"))).toBe(
      "1. März 2027"
    );
  });

  test("gibt null zurück, wenn die Wendung geändert wurde", () => {
    expect(leseBarrierefreiheitsPruefdatum("<p>zuletzt kontrolliert am 23. August 2026</p>")).toBeNull();
  });

  test("die zwei Muster lesen einander nicht", () => {
    expect(leseZdrPruefdatum(ERKLAERUNG("23.&nbsp;August&nbsp;2026"))).toBeNull();
    expect(leseBarrierefreiheitsPruefdatum(DATENSCHUTZ("11.&nbsp;August&nbsp;2026"))).toBeNull();
  });

  test("die Vorwarnzeit ist einstellbar; ohne Angabe gilt die bisherige Woche", () => {
    const datum = new Date(JETZT - (FRIST_TAGE - 14) * TAG);
    expect(bewerteFrist(datum, JETZT).faellig).toBe(false);
    expect(bewerteFrist(datum, JETZT, VORWARNUNG_HANDPRUEFUNG_TAGE).faellig).toBe(true);
    expect(VORWARNUNG_TAGE).toBe(7);
  });
});

describe("Push zur Barrierefreiheits-Prüfung", () => {
  test("nichts fällig: kein Push, beide Zusagen bewertet", async () => {
    const protokoll = [];
    const ergebnis = await lauf(abrufAttrappe({ protokoll }));
    expect(ergebnis.zdr).toEqual({ gesendet: false, grund: "nichts-faellig", tageBisFrist: FRIST_TAGE - 10 });
    expect(ergebnis.barrierefreiheit).toEqual({
      gesendet: false,
      grund: "nichts-faellig",
      tageBisFrist: FRIST_TAGE - 10,
    });
    expect(protokoll).toEqual([]);
  });

  test("einen Tag vor der Vorwarnzeit: noch kein Push", async () => {
    const protokoll = [];
    const erklaerung = ERKLAERUNG(vorTagen(FRIST_TAGE - VORWARNUNG_HANDPRUEFUNG_TAGE - 1));
    const ergebnis = await lauf(abrufAttrappe({ erklaerung, protokoll }));
    expect(ergebnis.barrierefreiheit.grund).toBe("nichts-faellig");
    expect(protokoll).toEqual([]);
  });

  test("drei Wochen vorher: genau ein Push mit den Schritten, die ZDR-Zusage bleibt still", async () => {
    const protokoll = [];
    const erklaerung = ERKLAERUNG(vorTagen(FRIST_TAGE - VORWARNUNG_HANDPRUEFUNG_TAGE));
    const ergebnis = await lauf(abrufAttrappe({ erklaerung, protokoll }));
    expect(ergebnis.barrierefreiheit).toEqual({
      gesendet: true,
      tageBisFrist: VORWARNUNG_HANDPRUEFUNG_TAGE,
      ueberfaellig: false,
    });
    expect(ergebnis.zdr.gesendet).toBe(false);
    expect(protokoll).toHaveLength(1);
    const push = protokoll[0];
    expect(push.title).toBe("malziME: Barrierefreiheits-Prüfung steht an");
    expect(push.priority).toBe(4);
    expect(push.message).toMatch(/fällig in 21 Tagen/);
    expect(push.message).toMatch(/Barrierefreiheit neu prüfen/);
    expect(push.message).toMatch(/von Hand prüfen/);
    expect(push.message).toMatch(/NIE ohne echte Prüfung/);
    expect(push.actions[0].url).toMatch(/\/barrierefreiheit$/);
    expect(push.actions[0].url).not.toMatch(/mistral/);
  });

  test("überfällig: höhere Priorität und anderer Titel", async () => {
    const protokoll = [];
    await lauf(abrufAttrappe({ erklaerung: ERKLAERUNG(vorTagen(FRIST_TAGE + 3)), protokoll }));
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0].title).toBe("malziME: Barrierefreiheits-Prüfung überfällig");
    expect(protokoll[0].priority).toBe(5);
    expect(protokoll[0].message).toMatch(/ÜBERFÄLLIG seit 3 Tagen/);
  });

  test("beide fällig: zwei Pushes, je mit eigenem Titel und eigenem Knopf", async () => {
    const protokoll = [];
    await lauf(
      abrufAttrappe({
        datenschutz: DATENSCHUTZ(vorTagen(FRIST_TAGE - 2)),
        erklaerung: ERKLAERUNG(vorTagen(FRIST_TAGE - 2)),
        protokoll,
      })
    );
    expect(protokoll.map((push) => push.title)).toEqual([
      "malziME: ZDR-Prüfung steht an",
      "malziME: Barrierefreiheits-Prüfung steht an",
    ]);
    expect(protokoll[0].actions[0].url).toMatch(/admin\.mistral\.ai/);
    expect(protokoll[1].actions[0].url).toMatch(/\/barrierefreiheit$/);
  });

  test("die Meldung nennt Datum, Alter und Frist", () => {
    const meldung = baueMeldungBarrierefreiheit({
      ueberfaellig: false,
      tageBisFrist: 5,
      tageAlt: 178,
      datumText: "23. August 2026",
    });
    expect(meldung.text).toMatch(/Zuletzt geprüft: 23\. August 2026 \(178 Tage her, Frist 183\)/);
  });
});

describe("die zwei Zusagen stören einander nicht", () => {
  test("Erklärung nicht erreichbar: die ZDR-Zusage wird trotzdem geprüft und gemeldet", async () => {
    const protokoll = [];
    const ergebnis = await lauf(
      abrufAttrappe({ datenschutz: DATENSCHUTZ(vorTagen(FRIST_TAGE - 2)), erklaerung: null, protokoll })
    );
    expect(ergebnis.barrierefreiheit).toEqual({ gesendet: false, grund: "seite-nicht-lesbar" });
    expect(ergebnis.zdr.gesendet).toBe(true);
    expect(protokoll).toHaveLength(1);
  });

  test("Datenschutzerklärung nicht erreichbar: die Barrierefreiheits-Zusage wird trotzdem geprüft und gemeldet", async () => {
    const protokoll = [];
    const ergebnis = await lauf(
      abrufAttrappe({ datenschutz: null, erklaerung: ERKLAERUNG(vorTagen(FRIST_TAGE - 2)), protokoll })
    );
    expect(ergebnis.zdr).toEqual({ gesendet: false, grund: "seite-nicht-lesbar" });
    expect(ergebnis.barrierefreiheit.gesendet).toBe(true);
    expect(protokoll).toHaveLength(1);
  });

  test("wirft der Abruf für eine Seite, läuft die andere weiter", async () => {
    const protokoll = [];
    const attrappe = abrufAttrappe({ erklaerung: ERKLAERUNG(vorTagen(FRIST_TAGE - 2)), protokoll });
    const ergebnis = await lauf(async (url, optionen) => {
      if (String(url).endsWith("/datenschutz.html")) throw new Error("Netz weg");
      return attrappe(url, optionen);
    });
    expect(ergebnis.zdr).toEqual({ gesendet: false, grund: "fehler" });
    expect(ergebnis.barrierefreiheit.gesendet).toBe(true);
  });

  test("pruefeZusagen gibt weiter nur das Ergebnis der ZDR-Zusage zurück", async () => {
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe(),
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "nichts-faellig", tageBisFrist: FRIST_TAGE - 10 });
  });
});

describe("Lebenszeichen: Erfolg nur, wenn BEIDE Fristen bewertet wurden", () => {
  test("beide bewertet: letzterLauf und letzterErfolg", async () => {
    await lauf(abrufAttrappe());
    const zeichen = speicher.lies(LEBENSZEICHEN_DOC);
    expect(typeof zeichen.letzterLauf).toBe("number");
    expect(typeof zeichen.letzterErfolg).toBe("number");
  });

  test.each([
    ["Erklärung nicht erreichbar", { erklaerung: null }],
    ["Prüfdatum der Erklärung nicht lesbar", { erklaerung: "<p>ohne Datum</p>" }],
    ["Datenschutzerklärung nicht erreichbar", { datenschutz: null }],
    ["Prüfdatum der Datenschutzerklärung nicht lesbar", { datenschutz: "<p>ohne Datum</p>" }],
  ])("%s: nur letzterLauf, kein letzterErfolg", async (_name, seiten) => {
    await lauf(abrufAttrappe(seiten));
    const zeichen = speicher.lies(LEBENSZEICHEN_DOC);
    expect(typeof zeichen.letzterLauf).toBe("number");
    expect(zeichen).not.toHaveProperty("letzterErfolg");
  });

  test("ein gescheiterter Push ändert nichts am Erfolg — die Frist wurde ja bewertet", async () => {
    const attrappe = abrufAttrappe({ erklaerung: ERKLAERUNG(vorTagen(FRIST_TAGE - 2)) });
    const ergebnis = await lauf(async (url, optionen) => {
      if (String(url).startsWith("https://ntfy.example")) return { ok: false, status: 500, text: async () => "" };
      return attrappe(url, optionen);
    });
    expect(ergebnis.barrierefreiheit).toEqual({ gesendet: false, grund: "ntfy-fehlgeschlagen" });
    expect(speicher.lies(LEBENSZEICHEN_DOC)).toHaveProperty("letzterErfolg");
  });
});
