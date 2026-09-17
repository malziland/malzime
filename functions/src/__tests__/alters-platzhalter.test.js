/**
 * alters-platzhalter.test.js — Nicht lesbares Alter.
 *
 * HINTERGRUND (17.09.2026): Das Formatbeispiel im Prompt zeigt das Alter nur
 * noch als "~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)", weil eine Beispielzahl
 * die Schätzungen anzog. Schreibt das Modell die Vorlage ab (in welcher
 * Klammer auch immer) oder nennt es ein Alter ohne Ziffer, gilt das Alter als
 * nicht lesbar:
 *   - Die Alterskarte zeigt einen festen Satz, nie "‹Zahl›" und nie einen
 *     geflickten Text mit Lücken — auch nicht in der Live-Anzeige.
 *   - Der Kinderschutz-Filter bekommt `alterUnlesbar` und lässt Stufe 2
 *     greifen (minor-safety.test.js, job-pipelines-profile.test.js).
 * Zwei Gegenprüfungen am 17.09. haben die Lücken gefunden, die hier
 * festgehalten sind (andere Klammern, fehlende Tilde, Anker ohne Alter,
 * Fehlalarme, lange Texte).
 */

/* Der Einstellungssatz als Kulisse, wie in mistral.test.js — sonst bricht
   jeder Aufruf mit "Betriebswerte fehlen" ab, was hier nicht Thema ist. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { hatAltersPlatzhalter, istAlterUnlesbar, hatLesbaresAlter, alterNichtLesbarText } = require("../minor-safety");
const DE = require("../locales/de/prompts");
const EN = require("../locales/en/prompts");
const { runSingleLargeCall, setFetchForTest, _extrahiereLiveText } = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

describe("Erkennung", () => {
  test.each([
    ["männlich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)"],
    ["female, ~‹number› years old (range ‹number›-‹number›)"],
    ["männlich, ~<Zahl> Jahre alt (Spanne <Zahl>-<Zahl>)"],
    ["männlich, ~[Zahl] Jahre alt"],
    ["männlich, ~{Zahl} Jahre alt"],
    ["männlich, ~«Zahl» Jahre alt"],
    ["männlich, ~Zahl Jahre alt (Spanne Zahl-Zahl)"],
    ["männlich, Zahl Jahre alt."],
    ["weiblich, etwa Zahl, Spanne Zahl bis Zahl"],
    ["Du bist ein ‹Zahl›-jähriger Junge."],
    ["aged ‹number› to ‹number›"],
    ["zwischen Zahl und 16"],
  ])("Platzhalter: %s", (text) => {
    expect(hatAltersPlatzhalter(text)).toBe(true);
    expect(istAlterUnlesbar(text)).toBe(true);
    expect(hatLesbaresAlter(text)).toBe(false);
  });

  test.each([["weiblich, ~dreizehn Jahre alt"], ["male, in his teens, range unclear"]])(
    "Altersversuch ohne Ziffer ist unlesbar: %s",
    (text) => {
      expect(hatAltersPlatzhalter(text)).toBe(false);
      expect(istAlterUnlesbar(text)).toBe(true);
    }
  );

  test.each([
    ["weiblich, ~14 Jahre alt (Spanne 12-16)"],
    ["male, ~44 years old (range 40-48). A number of fine lines show it."],
    ["Die Zahl der Pickel sagt nichts, die Anzahl der Linien auch nicht, ~30 Jahre."],
    ["weiblich, ~‹40› Jahre alt (Spanne ‹35›-‹45›)"],
    ["weiblich (Spanne ‹13-17›)"],
    ["dein Style ist ‹cool›, ~22 Jahre"],
  ])("lesbar: %s", (text) => {
    expect(hatAltersPlatzhalter(text)).toBe(false);
    expect(istAlterUnlesbar(text)).toBe(false);
    expect(hatLesbaresAlter(text)).toBe(true);
  });

  test.each([["Keine klaren Bildsignale."], ["weiblich"], [""], [null]])(
    "kein Altersversuch ist NICHT unlesbar: %s",
    (text) => {
      expect(istAlterUnlesbar(text)).toBe(false);
    }
  );

  test("bleibt auch bei sehr langen Texten schnell", () => {
    const lang = "(" + "Spanne x ".repeat(2000) + " Zahl";
    const start = Date.now();
    istAlterUnlesbar(lang);
    hatAltersPlatzhalter(lang);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("fester Satz übernimmt das Geschlecht, wenn es vorn klar dasteht", () => {
    expect(alterNichtLesbarText("weiblich, ~‹Zahl› Jahre", DE)).toBe(
      "Du bist weiblich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
    expect(alterNichtLesbarText("Du bist männlich, ~Zahl", DE)).toBe(
      "Du bist männlich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
    expect(alterNichtLesbarText("female, ~‹number›", EN)).toBe(
      "You are female. Your age cannot be read reliably from this picture."
    );
    expect(alterNichtLesbarText("~‹Zahl› Jahre", DE)).toBe(
      "Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
  });
});

describe("Fertige Karte und Werte für den Filter", () => {
  const KARTEN = [
    "alter_geschlecht",
    "herkunft",
    "einkommen",
    "bildung",
    "beziehungsstatus",
    "interessen",
    "persoenlichkeit",
    "charakterzuege",
    "politisch",
    "gesundheit",
    "kaufkraft",
    "verletzlichkeit",
    "werbeprofil",
  ];
  const kategorien = (prefix) =>
    Object.fromEntries(KARTEN.map((k) => [k, { label: k, value: `${prefix} ${k}`, confidence: 0.8 }]));

  const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
  beforeEach(() => {
    process.env.MISTRAL_API_KEY = "test-key-not-real";
    _setRateIntervalMs(0);
    _resetRateBucket();
  });
  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
    setFetchForTest(null);
  });

  async function lauf(anker, kartenwert, lang = "de") {
    const body = {
      hard_facts: { alter_geschlecht: anker, herkunft: "mitteleuropäisch" },
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      standard: { profileText: "Text.", categories: kategorien("Standard") },
      beast: { profileText: "Text.", categories: kategorien("Beast") },
    };
    body.standard.categories.alter_geschlecht.value = kartenwert;
    body.beast.categories.alter_geschlecht.value = kartenwert;
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
    return runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, lang);
  }

  test("abgeschriebene Vorlage: fester Satz auf beiden Karten, Filter bekommt alterUnlesbar", async () => {
    const r = await lauf(
      "weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)",
      "Du bist weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›). Zwei Merkmale bestätigen genau diese Altersspanne."
    );
    for (const profil of [r.normal, r.boost]) {
      expect(profil.categories.alter_geschlecht.value).toBe(
        "Du bist weiblich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
      );
    }
    expect(r.alterUnlesbar).toBe(true);
  });

  test("englisch: fester Satz auf Englisch", async () => {
    const r = await lauf("female, ~<number> years old", "You are female, ~<number> years old. Round cheeks.", "en");
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "You are female. Your age cannot be read reliably from this picture."
    );
    expect(r.alterUnlesbar).toBe(true);
  });

  test("Anker ohne Alter, Karte mit Platzhalter: trotzdem unlesbar (Gegenprüfung Fall B)", async () => {
    const r = await lauf("weiblich", "Du bist weiblich, ~‹Zahl› Jahre alt. Runde Wangen.");
    expect(r.alterUnlesbar).toBe(true);
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "Du bist weiblich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
  });

  test("ohne hard_facts-Alter: der Filter bekommt die unveränderte Karte mit Zahl", async () => {
    const r = await lauf("", "Du bist weiblich, ~14 Jahre alt (Spanne 12-16). Runde Wangen.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.alterAnker).toBe("Du bist weiblich, ~14 Jahre alt (Spanne 12-16). Runde Wangen.");
  });

  test("Anker lesbar, nur der Beleg-Satz mit Platzhalter: der Anker steht allein", async () => {
    const r = await lauf("weiblich, ~14 Jahre alt (Spanne 12-16)", "Du bist weiblich. ‹Zahl› Merkmale zeigen das.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe("weiblich, ~14 Jahre alt (Spanne 12-16)");
  });

  test("Alter in Worten ohne Ziffer: unlesbar", async () => {
    const r = await lauf("weiblich, ~dreizehn Jahre alt", "Du bist weiblich, ~dreizehn Jahre alt. Runde Wangen.");
    expect(r.alterUnlesbar).toBe(true);
  });

  test("ohne Platzhalter bleibt alles wie bisher", async () => {
    const r = await lauf("männlich, ~38 (Spanne 35-42)", "Du bist männlich, etwa 38. Die Linien bleiben sichtbar.");
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "männlich, ~38 (Spanne 35-42). Die Linien bleiben sichtbar."
    );
    expect(r.alterAnker).toBe("männlich, ~38 (Spanne 35-42)");
    expect(r.alterUnlesbar).toBe(false);
  });

  test("keine Altersangabe überhaupt: nicht unlesbar (Regel: ohne Alter nicht filtern)", async () => {
    const r = await lauf("", "Keine klaren Bildsignale.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe("Keine klaren Bildsignale.");
  });
});

describe("Live-Anzeige", () => {
  function strom(wert) {
    return JSON.stringify({
      standard: {
        profileText: "Text.",
        categories: {
          alter_geschlecht: { label: "Alter & Geschlecht", value: wert, confidence: 0.8 },
          herkunft: { label: "Herkunft", value: "Text ‹nicht Alter›", confidence: 0.7 },
        },
      },
    });
  }

  test("eine Alterskarte mit Platzhalter erscheint live gar nicht, andere Karten schon", () => {
    const { kartenStandard } = _extrahiereLiveText(strom("weiblich, ~‹Zahl› Jahre alt. Runde Wangen."));
    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["herkunft"]);
    expect(kartenStandard[0].wert).toBe("Text ‹nicht Alter›");
  });

  test("eine lesbare Alterskarte erscheint live unverändert", () => {
    const { kartenStandard } = _extrahiereLiveText(strom("weiblich, ~14 Jahre alt. Runde Wangen."));
    expect(kartenStandard[0].wert).toBe("weiblich, ~14 Jahre alt. Runde Wangen.");
  });

  test("ein halb angekommener Alterswert erscheint gar nicht", () => {
    const voll = strom("weiblich, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›). Runde Wangen.");
    for (const marke of ["(Spanne ‹", "‹Zahl›-‹Za", "Runde"]) {
      const { kartenStandard } = _extrahiereLiveText(voll.slice(0, voll.indexOf(marke) + marke.length));
      expect(kartenStandard).toEqual([]);
    }
  });
});
