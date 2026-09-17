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

const {
  hatAltersPlatzhalter,
  istAlterUnlesbar,
  hatLesbaresAlter,
  alterNichtLesbarText,
  untereAltersgrenze: _untereAltersgrenze,
} = require("../alters-lesbarkeit");
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

  test.each([["weiblich, Alter unklar, Spanne offen"], ["male, age range unclear"]])(
    "Altersversuch ohne Zahl ist unlesbar: %s",
    (text) => {
      expect(hatAltersPlatzhalter(text)).toBe(false);
      expect(istAlterUnlesbar(text)).toBe(true);
    }
  );

  /* Gegenprüfung Runde 3: Zahlwörter sind eine lesbare Angabe. */
  test.each([
    ["weiblich, etwa dreizehn.", 13],
    ["weiblich, ~dreizehn Jahre alt", 13],
    ["männlich, Mitte vierzig", 40],
    ["male, in his teens", 13],
    ["female, in her forties", 40],
    ["weiblich, achtzehn Jahre", 18],
  ])("Zahlwort ist lesbar: %s", (text, alter) => {
    expect(istAlterUnlesbar(text)).toBe(false);
    expect(hatLesbaresAlter(text)).toBe(true);
    expect(_untereAltersgrenze(text)).toBe(alter);
  });

  test.each([
    ["weiblich, 13jährig", 13],
    ["female, ~13yo", 13],
    ["weiblich, Teenager", 13],
    ["female, early teens", 13],
    ["weiblich, noch ein Kind", 8],
    ["Spanne 12 bis 15", 12],
    ["range 12 to 15", 12],
  ])("lesbar (Runde 3): %s", (text, alter) => {
    expect(istAlterUnlesbar(text)).toBe(false);
    expect(_untereAltersgrenze(text)).toBe(alter);
  });

  test.each([
    ["Du bist weiblich. Deine Frisur ist spannend."],
    ["Du bist weiblich. Die Jahreszeit ist Winter."],
    ["Keine klaren Bildsignale für eine sichere Altersspanne."],
    ["You are female with a kind smile."],
  ])("kein Altersversuch (Runde 3): %s", (text) => {
    expect(istAlterUnlesbar(text)).toBe(false);
    expect(_untereAltersgrenze(text)).toBeNull();
  });

  test.each([["female, ~(number)."], ["weiblich, ~„Zahl“ Jahre alt."], ["weiblich, ~'Zahl'"]])(
    "weitere Klammern (Runde 3): %s",
    (text) => {
      expect(hatAltersPlatzhalter(text)).toBe(true);
    }
  );

  test("ein Platzhalter weit hinten in einer langen Karte wird erkannt", () => {
    const lang = `weiblich, ~14 Jahre alt. ${"Text ".repeat(100)}Das zeigt ‹Zahl› Merkmale.`;
    expect(lang.indexOf("‹Zahl›")).toBeGreaterThan(300);
    expect(hatAltersPlatzhalter(lang)).toBe(true);
  });

  test.each([["Achtsam und oft ruhig."], ["Die Achtzigerjahre-Jacke."]])("kein Zahlwort in: %s", (text) => {
    expect(_untereAltersgrenze(text)).toBeNull();
  });

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
    /* Beide unveränderten Karten gehen an den Filter; die niedrigste Zahl zählt. */
    expect(r.alterAnker).toContain("Du bist weiblich, ~14 Jahre alt (Spanne 12-16). Runde Wangen.");
    expect(_untereAltersgrenze(r.alterAnker)).toBe(12);
  });

  test("Anker lesbar, nur der Beleg-Satz mit Platzhalter: der Anker steht allein", async () => {
    const r = await lauf("weiblich, ~14 Jahre alt (Spanne 12-16)", "Du bist weiblich. ‹Zahl› Merkmale zeigen das.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe("weiblich, ~14 Jahre alt (Spanne 12-16)");
  });

  test("Alter in Worten: lesbar, die Karte bleibt", async () => {
    const r = await lauf("weiblich, ~dreizehn Jahre alt", "Du bist weiblich, ~dreizehn Jahre alt. Runde Wangen.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe("weiblich, ~dreizehn Jahre alt. Runde Wangen.");
  });

  test("Anker nur Geschlecht, Karte mit Alter: das Alter bleibt auf der Karte (Runde 3)", async () => {
    const r = await lauf("weiblich", "Du bist weiblich, ~13 Jahre alt (Spanne 11-15). Zwei Merkmale zeigen das.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "Du bist weiblich, ~13 Jahre alt (Spanne 11-15). Zwei Merkmale zeigen das."
    );
    expect(r.alterAnker).toContain("Du bist weiblich, ~13 Jahre alt (Spanne 11-15). Zwei Merkmale zeigen das.");
    expect(_untereAltersgrenze(r.alterAnker)).toBe(11);
  });

  test("Altersversuch ohne Zahl: fester Satz und unlesbar", async () => {
    const r = await lauf("weiblich, Alter unklar, Spanne offen", "Du bist weiblich. Runde Wangen.");
    expect(r.alterUnlesbar).toBe(true);
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "Du bist weiblich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
  });

  test("ohne Platzhalter bleibt alles wie bisher", async () => {
    const r = await lauf("männlich, ~38 (Spanne 35-42)", "Du bist männlich, etwa 38. Die Linien bleiben sichtbar.");
    expect(r.normal.categories.alter_geschlecht.value).toBe(
      "männlich, ~38 (Spanne 35-42). Die Linien bleiben sichtbar."
    );
    expect(r.alterAnker).toBe("männlich, ~38 (Spanne 35-42)");
    expect(r.alterUnlesbar).toBe(false);
  });

  test("REGRESSION Runde 3: Alter in Worten im Anker, Karten ohne Alter — der Filter bekommt den Anker", async () => {
    const r = await lauf(
      "weiblich, ~dreizehn Jahre alt (Spanne zwölf bis fünfzehn)",
      "Du bist weiblich. Runde Wangen."
    );
    expect(r.alterUnlesbar).toBe(false);
    expect(r.alterAnker).toBe("weiblich, ~dreizehn Jahre alt (Spanne zwölf bis fünfzehn)");
    expect(_untereAltersgrenze(r.alterAnker)).toBe(12);
  });

  test("Anker ohne Alter: auch eine Zahl nur in der Beast-Karte zählt", async () => {
    const body = {
      hard_facts: { alter_geschlecht: "", herkunft: "x" },
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      standard: { profileText: "Text.", categories: kategorien("Standard") },
      beast: { profileText: "Text.", categories: kategorien("Beast") },
    };
    body.standard.categories.alter_geschlecht.value = "Du bist weiblich. Runde Wangen.";
    body.beast.categories.alter_geschlecht.value = "Weiblich, ~9 Jahre alt. Leichte Beute.";
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(_untereAltersgrenze(r.alterAnker)).toBe(9);
  });

  test("Anker ohne Alter: ein Platzhalter nur in der Beast-Karte macht das Alter unlesbar", async () => {
    const body = {
      hard_facts: { alter_geschlecht: "weiblich", herkunft: "x" },
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      standard: { profileText: "Text.", categories: kategorien("Standard") },
      beast: { profileText: "Text.", categories: kategorien("Beast") },
    };
    body.standard.categories.alter_geschlecht.value = "Du bist weiblich. Runde Wangen.";
    body.beast.categories.alter_geschlecht.value = "Weiblich, ~‹Zahl› Jahre alt. Leichte Beute.";
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
    const r = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    expect(r.alterUnlesbar).toBe(true);
  });

  test("Ziffern in Klammern erscheinen auf der Karte ohne Klammern", async () => {
    const r = await lauf("weiblich, ~‹14› Jahre alt (Spanne ‹12›-‹16›)", "Du bist weiblich. Runde Wangen.");
    expect(r.normal.categories.alter_geschlecht.value).toBe("weiblich, ~14 Jahre alt (Spanne 12-16). Runde Wangen.");
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

  test("eine Alterskarte ohne Zahl, aber mit Altersversuch erscheint live ebenfalls nicht (Runde 3)", () => {
    const { kartenStandard } = _extrahiereLiveText(strom("weiblich, Alter unklar, Spanne offen. Runde Wangen."));
    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["herkunft"]);
  });

  test("Anker unlesbar, Karte mit Zahl: die Alterskarte erscheint live nicht (Runde 3)", () => {
    const text = JSON.stringify({
      hard_facts: { alter_geschlecht: "weiblich, ~‹Zahl› Jahre alt", herkunft: "x" },
      standard: {
        profileText: "Text.",
        categories: {
          alter_geschlecht: {
            label: "Alter & Geschlecht",
            value: "weiblich, ~13 Jahre alt. Runde Wangen.",
            confidence: 0.8,
          },
          herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.7 },
        },
      },
    });
    const { kartenStandard } = _extrahiereLiveText(text);
    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["herkunft"]);
  });

  test("Anker lesbar, Karte mit Zahl: die Alterskarte erscheint live", () => {
    const text = JSON.stringify({
      hard_facts: { alter_geschlecht: "weiblich, ~13 Jahre alt", herkunft: "x" },
      standard: {
        profileText: "Text.",
        categories: {
          alter_geschlecht: {
            label: "Alter & Geschlecht",
            value: "weiblich, ~13 Jahre alt. Runde Wangen.",
            confidence: 0.8,
          },
        },
      },
    });
    const { kartenStandard } = _extrahiereLiveText(text);
    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["alter_geschlecht"]);
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
