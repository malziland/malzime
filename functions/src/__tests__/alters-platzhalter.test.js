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
  hatAltersversuch,
  alterNichtLesbarText,
  ersterSatz,
  untereAltersgrenze: _untereAltersgrenze,
  obereAltersgrenze,
  _VERSUCH_BIS,
  ankerAlsText,
  ankerZusatz,
} = require("../alters-lesbarkeit");
const DE = require("../locales/de/prompts");
const EN = require("../locales/en/prompts");
const { runSingleLargeCall, setFetchForTest, _extrahiereLiveText } = require("../mistral");
const { applyMinorSafety, SCHUTZ_ALTER } = require("../minor-safety");
const { REQUIRED_CARDS } = require("../mistral-antwort");
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

  test("beim Kürzen bleibt kein angeschnittenes Zahlwort stehen", () => {
    const text = `${". ".repeat(398)} achtzehn Jahre`;
    expect(text.indexOf("achtzehn")).toBeLessThan(800);
    expect(text.indexOf("achtzehn") + "achtzehn".length).toBeGreaterThan(800);
    expect(hatLesbaresAlter(text)).toBe(false);
  });

  test("ein Platzhalter weit hinten in einer langen Karte wird erkannt", () => {
    const lang = `weiblich, ~14 Jahre alt. ${"Text ".repeat(100)}Das zeigt ‹Zahl› Merkmale.`;
    expect(lang.indexOf("‹Zahl›")).toBeGreaterThan(300);
    expect(hatAltersPlatzhalter(lang)).toBe(true);
  });

  /* Letzte Prüfrunde 17.09.: weitere Wortformen. */
  test.each([
    ["Du bist weiblich, dreizehnjährig.", 13],
    ["weiblich, etwa fünfundzwanzig", 25],
    ["male, ~twenty-five", 25],
    ["Du bist ein Schulkind.", 8],
    ["You are a teenage girl.", 13],
    ["weiblich, jugendliches Gesicht", 13],
  ])("Wortform lesbar: %s", (text, alter) => {
    expect(istAlterUnlesbar(text)).toBe(false);
    expect(_untereAltersgrenze(text)).toBe(alter);
  });

  test("eine Kategorie zieht eine genannte Zahl nicht nach unten", () => {
    expect(_untereAltersgrenze("männlich, ~35 Jahre, jugendlich wirkend")).toBe(35);
  });

  test("„Alter“ in Anführungszeichen ist kein Platzhalter, „Zahl“ schon", () => {
    expect(hatAltersPlatzhalter("Deine Tasse sagt „Alter“.")).toBe(false);
    expect(hatAltersPlatzhalter('Your shirt says "age" is just a number.')).toBe(false);
    expect(hatAltersPlatzhalter("weiblich, ~„Zahl“ Jahre")).toBe(true);
    expect(hatAltersPlatzhalter("weiblich, ~‹Alter›")).toBe(true);
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
    /* Geschlecht aus der Karte, wenn der Anker keins nennt */
    expect(alterNichtLesbarText(["~‹Zahl› Jahre", "Du bist männlich, ~‹Zahl›"], DE)).toBe(
      "Du bist männlich. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
    );
    expect(alterNichtLesbarText(["Gender: female"], EN)).toBe(
      "You are female. Your age cannot be read reliably from this picture."
    );
    /* "nicht eindeutig" bekommt einen eigenen Satz */
    expect(alterNichtLesbarText(["Geschlecht nicht eindeutig erkennbar, ~‹Zahl›"], DE)).toBe(
      "Dein Geschlecht ist nicht eindeutig erkennbar. Dein Alter lässt sich aus diesem Bild nicht sicher ablesen."
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
    /* Der erste Satz beider Karten geht an den Filter, der Beleg-Satz nicht. */
    expect(r.alterAnker).toContain("Du bist weiblich, ~14 Jahre alt (Spanne 12-16).");
    expect(r.alterAnker).not.toContain("Runde Wangen");
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
    expect(r.alterAnker).toContain("Du bist weiblich, ~13 Jahre alt (Spanne 11-15).");
    expect(r.alterAnker).not.toContain("Zwei Merkmale");
    expect(_untereAltersgrenze(r.alterAnker)).toBe(11);
  });

  /* Letzte Prüfrunde 17.09.: Zahlen und Zahlwörter im Beleg-Satz sind kein
     Alter — sonst würde eine Erwachsene wegen "Trikot mit der Nummer acht"
     als Kind gefiltert. */
  test.each([
    ["Du bist weiblich, ~35 Jahre alt. Sie trägt ein Trikot mit der Nummer acht.", 35],
    ["Du bist männlich, ~30 Jahre alt. Er hat seine sieben Sachen dabei.", 30],
    ["You are female, ~33 years old. Ten fingers are visible.", 33],
  ])("Beleg-Satz zählt nicht: %s", async (karte, alter) => {
    const r = await lauf("weiblich", karte);
    expect(r.alterUnlesbar).toBe(false);
    expect(_untereAltersgrenze(r.alterAnker)).toBe(alter);
  });

  test("Beleg-Satz ohne Alter im ersten Satz: kein Alter, kein Fehlalarm", async () => {
    const r = await lauf("weiblich", "Du bist weiblich. Sie ist als Elf verkleidet.");
    expect(r.alterUnlesbar).toBe(false);
    expect(_untereAltersgrenze(r.alterAnker)).toBeNull();
  });

  test("Alter im ersten Satz lesbar, Platzhalter nur im Beleg-Satz: Alter bleibt, Platzhalter fällt weg", async () => {
    const r = await lauf("weiblich", "Du bist weiblich, ~13 Jahre alt. ‹Zahl› Merkmale zeigen das.");
    expect(r.alterUnlesbar).toBe(false);
    expect(r.normal.categories.alter_geschlecht.value).toBe("Du bist weiblich, ~13 Jahre alt");
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

/* ══════════════════════════════════════════════════════════════════════
   SEC-2026-10-03-02 — Stufe 2 greift auch, wenn das Alter hinter einem
   Abkürzungspunkt steht („ca. 13 Jahre“) oder nur als Wort genannt ist
   („ein Mädchen“, „Volksschulkind“).

   Geprüft wird über den echten Weg: runSingleLargeCall (mistral.js) →
   applyMinorSafety (minor-safety.js), verdrahtet wie job-pipelines.js.
   Gestellt ist nur die Antwort der KI. „Kredit bleibt“ ist die Wirkung,
   auf die es ankommt — nicht nur das Flag.

   Unverändert gilt (docs/SECURITY-MODEL.md, 17.09.2026): Als Altersangabe
   einer Karte zählt nur ihr erster Satz; eine Antwort ohne jeden
   Altersversuch bleibt ungefiltert.
   ══════════════════════════════════════════════════════════════════════ */
describe("SEC-2026-10-03-02 — Alter hinter einem Abkürzungspunkt oder nur als Wort", () => {
  const BELEG = " Deine Wangen sind noch rund, das Gesicht wirkt weich.";
  const NICHT_LESBAR_DE = "Dein Alter lässt sich aus diesem Bild nicht sicher ablesen.";

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

  function karten(alterWert) {
    const k = {};
    for (const name of REQUIRED_CARDS)
      k[name] = { label: name, value: "Du bist X. Das zeigt das Bild.", confidence: 0.8 };
    k.alter_geschlecht = { label: "Alter & Geschlecht", value: alterWert, confidence: 0.8 };
    return k;
  }

  /* anker === undefined: hard_facts fehlt ganz. */
  async function analyse(anker, karte, lang = "de") {
    const body = {
      subject: "HUMAN",
      visible_text: "",
      standard: {
        profileText: "Sachlich.",
        ad_targeting: ["Sofortkredit", "Lego Set"],
        manipulation_triggers: ["A."],
        categories: karten(karte),
      },
      beast: {
        profileText: "Zynisch.",
        ad_targeting: ["Klarna", "Pokemon Karten"],
        manipulation_triggers: ["B."],
        categories: karten(karte),
      },
    };
    if (anker !== undefined) body.hard_facts = { alter_geschlecht: anker, herkunft: "mitteleuropäisch" };
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
    const p = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, lang);
    const s = applyMinorSafety(p, {
      lang,
      alterText: p.alterAnker || undefined,
      alterUnlesbar: p.alterUnlesbar === true,
    });
    return {
      stufe2: s.minderjaehrig,
      alter: s.alter,
      unlesbar: s.alterUnlesbar,
      kreditBleibt: p.normal.ad_targeting.includes("Sofortkredit") || p.boost.ad_targeting.includes("Klarna"),
      harmlosBleibt: p.normal.ad_targeting.includes("Lego Set") && p.boost.ad_targeting.includes("Pokemon Karten"),
      karte: p.normal.categories.alter_geschlecht.value,
    };
  }

  describe("Satzende: ein Abkürzungspunkt oder ein Punkt zwischen Ziffern beendet den Alterssatz nicht", () => {
    test.each([
      [
        "Du bist weiblich, ca. 13 Jahre alt (Spanne 12-14)." + BELEG,
        "Du bist weiblich, ca. 13 Jahre alt (Spanne 12-14).",
      ],
      ["Du bist ein Mädchen, ungef. 14 Jahre." + BELEG, "Du bist ein Mädchen, ungef. 14 Jahre."],
      [
        "You are female, approx. 14 years old (range 12-16). Round cheeks.",
        "You are female, approx. 14 years old (range 12-16).",
      ],
      ["Du bist weiblich, max. 14 Jahre alt. Runde Wangen.", "Du bist weiblich, max. 14 Jahre alt."],
      ["Du bist weiblich, etwa 12.–14. Runde Wangen.", "Du bist weiblich, etwa 12.–14."],
      [
        "Du bist männlich, 1.80 groß, ~40 Jahre alt. Die Linien bleiben.",
        "Du bist männlich, 1.80 groß, ~40 Jahre alt.",
      ],
    ])("%s", (text, erster) => {
      expect(ersterSatz(text)).toBe(erster);
    });

    /* Gegenprobe: Ein echtes Satzende bleibt eines. Sonst läse der Filter
       Zahlen aus dem Beleg-Satz als Alter. */
    test.each([
      [
        "Du bist weiblich, ~35 Jahre alt. Sie trägt ein Trikot mit der Nummer acht.",
        "Du bist weiblich, ~35 Jahre alt.",
      ],
      ["Du bist etwa 35. 7 Kopflängen passen in die Körperhöhe.", "Du bist etwa 35."],
      ["Du bist Max. Deine Wangen sind rund.", "Du bist Max."],
      ["Monica. Sie lächelt.", "Monica."],
      ["Wirklich? Du bist 12.", "Wirklich?"],
      ["Hallo! Du bist 12.", "Hallo!"],
      ["Du bist weiblich, ca.", "Du bist weiblich, ca."],
      ["ohne Satzzeichen", "ohne Satzzeichen"],
      ["", ""],
    ])("echtes Satzende bleibt: %s", (text, erster) => {
      expect(ersterSatz(text)).toBe(erster);
    });

    test("bleibt bei sehr langen Texten schnell", () => {
      /* Kein echtes Satzende im ganzen Text: der ungünstigste Fall. */
      const lang = "ca. 1.2 ".repeat(20000);
      const start = Date.now();
      expect(ersterSatz(lang)).toHaveLength(lang.trim().length);
      expect(Date.now() - start).toBeLessThan(200);
    });
  });

  describe("Kontrollen: der Weg entscheidet richtig, wo er es schon tat", () => {
    test("Kind im Format des Prompts: Stufe 2 greift", async () => {
      const r = await analyse(
        "weiblich, ~13 Jahre alt (Spanne 12-14)",
        "Du bist weiblich, ~13 Jahre alt (Spanne 12-14)." + BELEG
      );
      expect(r).toMatchObject({ stufe2: true, alter: 12, unlesbar: false, kreditBleibt: false, harmlosBleibt: true });
    });

    test("Erwachsener im Format des Prompts: Stufe 2 greift nicht", async () => {
      const r = await analyse(
        "männlich, ~40 Jahre alt (Spanne 38-45)",
        "Du bist männlich, ~40 Jahre alt (Spanne 38-45)." + BELEG
      );
      expect(r).toMatchObject({ stufe2: false, alter: 38, unlesbar: false, kreditBleibt: true });
    });

    test("gar kein Altersversuch: bleibt ungefiltert", async () => {
      const r = await analyse(
        "Keine klaren Bildsignale.",
        "Es gibt keine klaren Bildsignale. Die Person ist von hinten zu sehen."
      );
      expect(r).toMatchObject({ stufe2: false, alter: null, unlesbar: false, kreditBleibt: true });
      expect(r.karte).toContain("von hinten zu sehen");
    });
  });

  describe("Alter hinter einem Abkürzungspunkt", () => {
    const KARTE_CA = "Du bist weiblich, ca. 13 Jahre alt (Spanne 12-14)." + BELEG;

    test.each([
      ["Anker fehlt", undefined],
      ["Anker nennt nur das Geschlecht", "weiblich"],
      ["Anker ist ein Objekt statt Text", { alter: 13, geschlecht: "weiblich" }],
    ])("%s, Karte mit „ca. 13 Jahre“: Stufe 2 greift, die Karte bleibt ganz", async (_name, anker) => {
      const r = await analyse(anker, KARTE_CA);
      expect(r).toMatchObject({ stufe2: true, alter: 12, unlesbar: false, kreditBleibt: false, harmlosBleibt: true });
      /* Kein Stück des Alterssatzes fehlt, keines steht doppelt. */
      expect(r.karte).toBe(KARTE_CA);
    });

    test("Anker mit „ca.“ und Zahl: die Karte wiederholt den Alterssatz nicht", async () => {
      const r = await analyse("weiblich, ca. 13 Jahre alt (Spanne 12-14)", KARTE_CA);
      expect(r).toMatchObject({ stufe2: true, alter: 12, kreditBleibt: false });
      expect(r.karte).toBe("weiblich, ca. 13 Jahre alt (Spanne 12-14)." + BELEG);
    });

    test("englisch „approx. 14 years old“", async () => {
      const r = await analyse(
        undefined,
        "You are female, approx. 14 years old (range 12-16). Your cheeks are still round.",
        "en"
      );
      expect(r).toMatchObject({ stufe2: true, alter: 12, unlesbar: false, kreditBleibt: false });
    });

    test("„ungef. 14 Jahre“ ohne brauchbaren Anker", async () => {
      const r = await analyse(undefined, "Du bist ein Mädchen, ungef. 14 Jahre." + BELEG);
      expect(r).toMatchObject({ stufe2: true, alter: 14, unlesbar: false, kreditBleibt: false });
    });

    /* Erfolgsweg: Die Reparatur macht aus einem Erwachsenen kein Kind. */
    test("Erwachsener mit „ca. 40 Jahre“: Alter wird gelesen, Stufe 2 greift nicht", async () => {
      const r = await analyse(undefined, "Du bist männlich, ca. 40 Jahre alt (Spanne 38-45). Die Linien bleiben.");
      expect(r).toMatchObject({ stufe2: false, alter: 38, unlesbar: false, kreditBleibt: true });
    });

    test("Erwachsene mit „ca.“: Zahlen im Beleg-Satz zählen weiterhin nicht", async () => {
      const r = await analyse(
        "weiblich",
        "Du bist weiblich, ca. 35 Jahre alt. Sie trägt ein Trikot mit der Nummer acht, 7 Kopflängen."
      );
      expect(r).toMatchObject({ stufe2: false, alter: 35, unlesbar: false, kreditBleibt: true });
    });
  });

  describe("Altersversuch außerhalb des ersten Satzes", () => {
    /* Der zweite Satz zählt nicht als Altersangabe — die 13 wird NICHT
       gelesen. Weil aber ein Altersversuch dasteht und an der Stelle, die
       zählt, kein Alter lesbar ist, gilt das Alter als nicht lesbar: Stufe 2
       greift, die Karte zeigt den festen Satz. */
    test.each([
      ["Du bist weiblich. Du bist etwa 13 Jahre alt." + BELEG],
      ["Du bist weiblich. Etwa 14 Jahre alt, Spanne 12-16." + BELEG],
    ])("%s", async (karte) => {
      const r = await analyse(undefined, karte);
      expect(r).toMatchObject({ stufe2: true, alter: null, unlesbar: true, kreditBleibt: false, harmlosBleibt: true });
      expect(r.karte).toBe(`Du bist weiblich. ${NICHT_LESBAR_DE}`);
    });

    /* Gegenprobe: Ohne Alterswort ist auch eine Zahl im Beleg-Satz kein
       Altersversuch. */
    test("Beleg-Satz mit Zahl, aber ohne Alterswort: bleibt ungefiltert", async () => {
      const r = await analyse("weiblich", "Du bist weiblich. Sie trägt ein Trikot mit der Nummer 8.");
      expect(r).toMatchObject({ stufe2: false, alter: null, unlesbar: false, kreditBleibt: true });
    });
  });

  describe("Alter nur als Wort", () => {
    test.each([
      ["weiblich, ein Mädchen", "Du bist ein Mädchen.", 8],
      ["weiblich, Volksschulkind", "Du bist ein Volksschulkind.", 8],
      ["männlich, Bub im Volksschulalter", "Du bist ein Bub im Volksschulalter.", 8],
      ["weiblich, Unterstufenschülerin", "Du bist eine Unterstufenschülerin.", 10],
      ["weiblich, Schülerin der Unterstufe", "Du bist eine Schülerin der Unterstufe.", 10],
      ["weiblich, Volksschülerin", "Du bist eine Volksschülerin.", 8],
      ["ein Mädchen im Volksschulalter", "Du bist ein Mädchen im Volksschulalter.", 8],
      ["männlich, ein kleiner Junge", "Du bist ein kleiner Junge.", 8],
      ["weiblich, Baby", "Du bist ein Baby.", 1],
    ])("Anker „%s“: Stufe 2 greift", async (anker, karte, alter) => {
      const r = await analyse(anker, karte + BELEG);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false, harmlosBleibt: true });
    });

    test.each([
      ["female, a young girl", "You are a young girl. Your cheeks are still round.", 8],
      ["male, a little boy", "You are a little boy. Your cheeks are still round.", 8],
      ["female, toddler", "You are a toddler. Your cheeks are still round.", 2],
      ["female, preteen", "You are a preteen. Your cheeks are still round.", 10],
      ["female, primary school pupil", "You are a primary school pupil. Your cheeks are still round.", 8],
    ])("englisch, Anker „%s“: Stufe 2 greift", async (anker, karte, alter) => {
      const r = await analyse(anker, karte, "en");
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false });
    });

    test("englisch, Anker fehlt, „You are a girl.“ im ersten Satz", async () => {
      const r = await analyse(
        undefined,
        "You are a girl. About 14 years old, range 12-16. Your cheeks are still round.",
        "en"
      );
      expect(r).toMatchObject({ stufe2: true, alter: 8, kreditBleibt: false });
    });

    /* „underage“ und „a minor“ sagen „unter 18“, nennen aber kein Alter:
       wie „minderjährig“ ein Altersversuch ohne lesbare Zahl. Ein
       Geburtsjahr ebenso — gerechnet wird damit nicht. */
    test.each([
      ["weiblich, minderjährig", "Du bist minderjährig.", "de"],
      ["female, underage", "You are underage.", "en"],
      ["female, a minor", "You are a minor.", "en"],
      ["weiblich, geboren 2012", "Du bist weiblich, geboren um 2012.", "de"],
    ])("Anker „%s“: Alter nicht lesbar, Stufe 2 greift", async (anker, karte, lang) => {
      const r = await analyse(anker, karte + " Round cheeks.", lang);
      expect(r).toMatchObject({ stufe2: true, alter: null, unlesbar: true, kreditBleibt: false });
    });
  });

  describe("Alterswörter: Erkennung und ihre Grenzen", () => {
    test.each([
      ["weiblich, ein Mädchen", 8],
      ["weiblich, Maedchen", 8],
      ["ein Schulmädchen", 8],
      ["zwei Mädels", 8],
      ["männlich, ein Bub", 8],
      ["zwei Buben", 8],
      ["männlich, ein kleiner Junge", 8],
      ["Du bist ein Junge.", 8],
      ["männlich, Junge", 8],
      ["zwei Jungs", 8],
      ["Volksschulkind", 8],
      ["im Volksschulalter", 8],
      ["Volksschüler", 8],
      ["weiblich, Schülerin", 10],
      ["Mittelschüler", 10],
      ["Schueler der Unterstufe", 10],
      ["female, a girl", 8],
      ["male, a boy", 8],
      ["a schoolchild", 10],
      ["a pupil", 10],
      ["elementary school age", 8],
      ["primary-school child", 8],
      ["a preteen", 10],
      ["a tween", 10],
      ["a toddler", 2],
      ["an infant", 1],
      ["ein Säugling", 1],
      ["weiblich, Baby", 1],
    ])("lesbar: %s", (text, alter) => {
      expect(_untereAltersgrenze(text)).toBe(alter);
      expect(hatLesbaresAlter(text)).toBe(true);
      expect(istAlterUnlesbar(text)).toBe(false);
    });

    /* Kein Kinderwort — weder ein Alter noch ein Altersversuch. */
    test.each([
      ["Junge Frau"],
      ["Junge, sportliche Frau"],
      ["weiblich, junge Erwachsene"],
      ["Jungen Erwachsenen sieht man das an."],
      ["female, with her boyfriend"],
      ["male, girlfriend next to him"],
      ["weiblich, Babyface"],
      ["a hubbub in between"],
      ["weiblich, mit Bubikopf"],
      ["Only minor details are visible."],
      ["minor wear on the jacket"],
      ["wide pupils, steady gaze"],
      ["Du bist wie geboren für die Bühne."],
      ["weiblich, geboren in Wien"],
      ["male, a born leader"],
    ])("kein Alter in: %s", (text) => {
      expect(_untereAltersgrenze(text)).toBeNull();
      expect(istAlterUnlesbar(text)).toBe(false);
    });

    test("eine genannte Zahl schlägt auch die neuen Wörter", () => {
      expect(_untereAltersgrenze("weiblich, ~30 Jahre, mädchenhaftes Gesicht")).toBe(30);
      expect(_untereAltersgrenze("männlich, ~35 Jahre, ewiger Schüler")).toBe(35);
      expect(_untereAltersgrenze("female, ~32, a girl at heart")).toBe(32);
    });

    /* „Mädchen“, „girl“, „Bub“ nennen keine Altersstufe: Steht eine dabei,
       gilt sie. */
    test.each([
      ["ein jugendliches Mädchen", 13],
      ["ein Mädchen in der Pubertät", 12],
      ["a teenage boy", 13],
      ["ein Bub, Schüler der Unterstufe", 10],
    ])("die genauere Angabe gilt: %s", (text, alter) => {
      expect(_untereAltersgrenze(text)).toBe(alter);
    });

    test.each([
      ["female, underage"],
      ["female, under-age"],
      ["female, a minor"],
      ["a minor."],
      ["minors"],
      ["weiblich, geboren 2012"],
      ["female, born in 2011"],
      ["männlich, Jahrgang 2013"],
    ])("Altersversuch ohne Zahl: %s", (text) => {
      expect(istAlterUnlesbar(text)).toBe(true);
      expect(hatLesbaresAlter(text)).toBe(false);
    });

    test("ein Geburtsjahr neben einem Alter: das Alter zählt", () => {
      expect(istAlterUnlesbar("weiblich, geboren 2012, also etwa 14")).toBe(false);
      expect(_untereAltersgrenze("weiblich, geboren 2012, also etwa 14")).toBe(14);
    });
  });

  /* ── Nachschärfung nach der fremden Prüfreihe (B-02) ──────────────────
     Die Regel bleibt: Als Altersangabe zählt der Anker, sonst der erste
     Satz; ohne jeden Altersversuch wird nicht gefiltert. Geschärft ist, was
     als Kindwort, als Satzende und als Altersversuch gilt. */
  describe("Nachschärfung nach der fremden Prüfreihe", () => {
    test.each([
      ["Du wirkst u. a. wegen der Wangen wie 12. Runde Wangen.", "Du wirkst u. a. wegen der Wangen wie 12."],
      ["Du bist im sog. Teenageralter. Runde Wangen.", "Du bist im sog. Teenageralter."],
      ["Weiblich, Jg. 2012. Runde Wangen.", "Weiblich, Jg. 2012."],
      ["Weiblich, geb. 2012. Runde Wangen.", "Weiblich, geb. 2012."],
      ["You are young, i.e. about 12. Round cheeks.", "You are young, i.e. about 12."],
      ["You look like, e.g., a 12 year old. Round cheeks.", "You look like, e.g., a 12 year old."],
      ["Du wirkst wie z. B. 12 Jahre alt. Runde Wangen.", "Du wirkst wie z. B. 12 Jahre alt."],
      ["Du wirkst wie z.B. 12 Jahre alt. Runde Wangen.", "Du wirkst wie z.B. 12 Jahre alt."],
      ["Du bist jung, d. h. etwa 12 Jahre. Runde Wangen.", "Du bist jung, d. h. etwa 12 Jahre."],
    ])("der Alterssatz endet nicht an der Abkürzung: %s", (text, erster) => {
      expect(ersterSatz(text)).toBe(erster);
    });

    /* Gegenprobe: „u. a.“ am Satzende bleibt ein Satzende — sonst läse der
       Filter Zahlen aus dem Beleg-Satz. */
    test.each([
      ["Du magst Sport, Musik u. a. Deine 7 Ringe glänzen.", "Du magst Sport, Musik u. a."],
      ["Du bist weiblich. Geb. 2012 steht auf dem Shirt.", "Du bist weiblich."],
    ])("echtes Satzende bleibt: %s", (text, erster) => {
      expect(ersterSatz(text)).toBe(erster);
    });

    /* Die Fälle der Prüfreihe, je mit dem Alter, das der Filter liest. */
    test.each([
      ["Du wirkst u. a. wegen der Wangen wie 12.", 12],
      ["Du bist im sog. Teenageralter.", 13],
      ["You are young, i.e. about 12.", 12],
      ["du bist ein junge.", 8],
      ["Du bist ein Bursche.", 13],
      ["Du bist ein fescher Bursch.", 13],
      ["Du bist ein Knabe.", 8],
      ["Du bist ein Gymnasiast.", 10],
      ["Du bist eine Gymnasiastin.", 10],
      ["Du gehst in die Unterstufe.", 10],
      ["Du gehst in die Oberstufe.", 14],
      ["Du bist ein Kindergartenkind.", 3],
      ["You are a kindergartner.", 3],
      ["You are a preschooler.", 3],
      ["Du bist ein Heranwachsender.", 13],
      ["Du wirkst kindlich.", 8],
      ["Du bist ein Dirndl.", 8],
      ["Du bist ein junges Dirndl.", 8],
      ["Du bist ein Lausbub.", 8],
      ["You are a middle school student.", 11],
      ["You are a high schooler.", 14],
      ["You are a high school student.", 14],
      ["You are a youngster.", 13],
      ["You are a juvenile.", 13],
      ["You are a youth.", 13],
      ["Du bist dreizehneinhalb.", 13],
    ])("Kindwort oder Kategorie: %s → %p", async (karte, alter) => {
      expect(_untereAltersgrenze(karte)).toBe(alter);
      const r = await analyse(undefined, karte + BELEG);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false, harmlosBleibt: true });
    });

    /* Gegenproben gegen Erwachsenen-Formen: kein Alter und kein
       Altersversuch. */
    test.each([
      ["Du trägst ein Dirndl."],
      ["Du stehst im Dirndl auf der Wiese."],
      ["Auf deinem Shirt steht Girl Boss."],
      ["Du siehst aus wie aus einer Boy Band."],
      ["Du hältst einen Game Boy in der Hand."],
      ["Auf deinem Shirt steht Girl Power."],
      ["Du gibst den Bad Boy."],
      ["Du posierst wie ein It-Girl."],
      ["Oh boy, was für ein Outfit."],
      ["Du wirkst burschikos."],
      ["Du bist in einer Burschenschaft."],
      ["Du hast ein Lausbubengesicht."],
      ["Du bist Gymnasiallehrerin."],
      ["Du bist Unterstufenlehrerin."],
      ["You are a high school teacher."],
      ["You are a middle school teacher."],
      ["Du bist High-School-Lehrer."],
      ["Du bist Kindergärtnerin."],
      ["You look youthful."],
      ["eine junge Frau"],
      ["ein junger Mann"],
      ["You are a university student."],
    ])("kein Kind in: %s", (text) => {
      expect(_untereAltersgrenze(text)).toBeNull();
      expect(hatAltersversuch(text)).toBe(false);
    });

    test.each([["Weiblich, Jg. 2012."], ["Weiblich, geb. 2012."], ["Weiblich, Jahrg. 2012."]])(
      "Geburtsjahr hinter einer Abkürzung: Altersversuch ohne lesbares Alter: %s",
      async (karte) => {
        expect(istAlterUnlesbar(karte)).toBe(true);
        const r = await analyse(undefined, karte + BELEG);
        expect(r).toMatchObject({ stufe2: true, alter: null, unlesbar: true, kreditBleibt: false });
      }
    );

    /* Dezimalzahlen: Die Stelle hinter dem Komma ist kein Alter. */
    test.each([
      ["Du bist 12,5 Jahre alt.", 12, 12],
      ["You are 12.5 years old.", 12, 12],
      ["Du bist weiblich, ~13,5 Jahre alt (Spanne 12,5-14,5).", 12, 14],
      ["Du bist männlich, 32,5 Jahre alt.", 32, 32],
    ])("%s → von %p bis %p", (text, von, bis) => {
      expect(_untereAltersgrenze(text)).toBe(von);
      expect(obereAltersgrenze(text)).toBe(bis);
    });

    test("32,5 Jahre: Erwachsener bleibt ungefiltert", async () => {
      const r = await analyse(undefined, "Du bist männlich, 32,5 Jahre alt. Die Linien bleiben.");
      expect(r).toMatchObject({ stufe2: false, alter: 32, unlesbar: false, kreditBleibt: true });
    });

    /* Altersversuch außerhalb des ersten Satzes: Kindwort oder Näherung mit
       kleiner Zahl ohne „Jahre“. An der Stelle, die zählt, ist kein Alter
       lesbar — das Alter gilt als nicht lesbar: Stufe 2, fester Satz. */
    test.each([
      [undefined, "Du bist weiblich. Ein Mädchen mit runden Wangen."],
      [undefined, "Du bist weiblich. Etwa 13, mit runden Wangen und Zahnspange."],
      ["weiblich", "Weiblich. Höchstens 12, die Zähne wirken gross fürs Gesicht."],
      [undefined, "Du bist weiblich. Ca. 9."],
      [undefined, "Du bist weiblich. Vielleicht 12 oder 13."],
      [undefined, "You are female. Around 12, with braces."],
      [undefined, "Du bist weiblich. Die Zahnspange passt zu einer Schülerin."],
      [undefined, "Du bist weiblich. ~13, runde Wangen."],
    ])("Anker %p, Karte „%s“: nicht lesbar, Stufe 2 greift", async (anker, karte) => {
      expect(hatAltersversuch(karte)).toBe(true);
      const r = await analyse(anker, karte);
      expect(r).toMatchObject({ stufe2: true, alter: null, unlesbar: true, kreditBleibt: false, harmlosBleibt: true });
      expect(r.karte).toContain(NICHT_LESBAR_DE);
    });

    /* Erwachsene MIT lesbarem Alter im Anker oder im ersten Satz bleiben
       unberührt — was auch immer im Beleg-Satz steht. */
    test.each([
      ["männlich, ~40 Jahre alt (Spanne 38-45)", "Du bist männlich, ~40 Jahre alt (Spanne 38-45). Etwa 7 Kopflängen."],
      ["weiblich, ~35 Jahre alt (Spanne 33-38)", "Du bist weiblich, ~35 Jahre alt. Ein Trikot mit der Nummer acht."],
      ["weiblich, ~40 Jahre alt (Spanne 38-45)", "Du bist weiblich, ~40 Jahre alt. Du hältst ein Kind an der Hand."],
      [undefined, "Du bist weiblich, ~40 Jahre alt (Spanne 38-45). Du trägst ein Baby im Tragetuch."],
      [undefined, "Du bist Kindergärtnerin, ~30 Jahre alt (Spanne 28-33). Etwa 12, höchstens 15 Kinder um dich."],
      [undefined, "Du bist ~45 Jahre alt (Spanne 42-48) und stehst vor Schülern. Ein Mädchen lacht."],
      ["männlich, ~50 Jahre alt (Spanne 48-53)", "Du bist ~50. Etwa 10, vielleicht 12 Jahre im selben Büro."],
    ])("Erwachsener mit Anker %p bleibt unberührt: %s", async (anker, karte) => {
      const r = await analyse(anker, karte);
      expect(r).toMatchObject({ stufe2: false, unlesbar: false, kreditBleibt: true });
      expect(r.alter).toBeGreaterThanOrEqual(26);
      expect(r.karte).not.toContain(NICHT_LESBAR_DE);
    });

    /* Kein Altersversuch: Zahl mit Einheit oder Zählwort, Uhrzeit,
       Körpergröße, Näherung über der Schutzgrenze. Bleibt ungefiltert. */
    test.each([
      ["Du bist weiblich. Etwa 7 Kopflängen passen in die Körperhöhe."],
      ["Du bist weiblich. Sie trägt ein Trikot mit der Nummer 8."],
      ["Du bist männlich. Aufgenommen um etwa 14:30."],
      ["Du bist männlich. Ca. 1,80 groß."],
      ["Du bist männlich. Etwa 20 % Akku."],
      ["Du bist männlich. Etwa 40, mit grauen Schläfen."],
      ["Du bist weiblich. Rund 10 Freunde stehen um dich."],
      ["Keine klaren Bildsignale. Die Person ist von hinten zu sehen."],
    ])("kein Altersversuch, bleibt ungefiltert: %s", async (karte) => {
      expect(hatAltersversuch(karte)).toBe(false);
      const r = await analyse("weiblich", karte);
      expect(r).toMatchObject({ stufe2: false, alter: null, unlesbar: false, kreditBleibt: true });
    });

    /* Getragene Richtung: Fehlt jedes lesbare Alter an den Stellen, die
       zählen, und nennt die Karte irgendwo ein Kind, wird geschützt — auch
       wenn das Kind nicht die Person selbst ist. */
    test.each([
      ["Du trägst ein Baby im Tragetuch.", 1, false],
      ["Du trägst eine Warnweste wie ein Schülerlotse.", 10, false],
      ["Keine klaren Bildsignale. Im Hintergrund spielt ein Kind.", null, true],
      ["Du bist weiblich. Du hältst ein Kind an der Hand.", null, true],
    ])("getragene Richtung, ohne lesbares Alter: %s", async (karte, alter, unlesbar) => {
      const r = await analyse(undefined, karte);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar, kreditBleibt: false });
    });

    test("die Grenze für „kleine Zahl“ ist die Schutzgrenze des Filters", () => {
      expect(_VERSUCH_BIS).toBe(SCHUTZ_ALTER);
      expect(hatAltersversuch(`Du bist weiblich. Etwa ${SCHUTZ_ALTER}, vielleicht.`)).toBe(true);
      expect(hatAltersversuch(`Du bist weiblich. Etwa ${SCHUTZ_ALTER + 1}, vielleicht.`)).toBe(false);
    });
  });

  /* ── Nachträge der zweiten Prüfreihe ────────────────────────────────── */
  describe("Nachträge der zweiten Prüfreihe", () => {
    /* a) Steht das Alterswort direkt hinter einer Näherungs-Abkürzung, endet
       der Alterssatz dort nicht — auch wenn es groß geschrieben ist. */
    test.each([
      ["Du bist ca. Volksschulalter. Milchzähne.", "Du bist ca. Volksschulalter.", 8],
      ["Du bist vermutl. Teenager. Zahnspange.", "Du bist vermutl. Teenager.", 13],
      ["Du bist evtl. Schülerin. Schulranzen.", "Du bist evtl. Schülerin.", 10],
      ["Du bist wahrsch. Jugendliche. Zahnspange.", "Du bist wahrsch. Jugendliche.", 13],
      ["Du bist ca. Dreizehn. Zahnspange.", "Du bist ca. Dreizehn.", 13],
      ["Du bist ca. Mitte zwanzig. Bart.", "Du bist ca. Mitte zwanzig.", 20],
      ["Du bist weibl. Teenager. Zahnspange.", "Du bist weibl. Teenager.", 13],
      ["Du bist männl. Jugendlicher. Flaum.", "Du bist männl. Jugendlicher.", 13],
    ])("Abkürzung vor dem Alterswort: %s", async (karte, erster, alter) => {
      expect(ersterSatz(karte)).toBe(erster);
      const r = await analyse(undefined, karte);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false, harmlosBleibt: true });
    });

    /* Gegenprobe: Trägt das nächste Wort kein Alter, bleibt die Abkürzung vor
       einem Großbuchstaben ein Satzende — ein Name ist keine Abkürzung. */
    test.each([
      ["Du bist Max. Deine Wangen sind rund.", "Du bist Max."],
      ["Du gibst max. Gas auf dem Rad.", "Du gibst max."],
      ["Du bist weiblich, ca. 13. Deine 7 Ringe glänzen.", "Du bist weiblich, ca. 13."],
    ])("echtes Satzende bleibt: %s", (text, erster) => {
      expect(ersterSatz(text)).toBe(erster);
    });

    /* Sichere Richtung: Ein Alter über der Schutzgrenze hinter der Abkürzung
       verlängert den Alterssatz nicht — es würde das Kindwort davor
       verdrängen (Zahl vor Kategorie). */
    test.each([
      ["Du bist ein Mädchen, ca. Dreißig Kerzen brennen hinter dir.", "Du bist ein Mädchen, ca.", 8],
      ["Du bist ein Teenager, max. Vierzig Leute stehen um dich.", "Du bist ein Teenager, max.", 13],
    ])("höheres Alter hinter der Abkürzung verlängert nicht: %s", async (karte, erster, alter) => {
      expect(ersterSatz(karte)).toBe(erster);
      const r = await analyse(undefined, karte);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false });
    });

    /* b) Weitere Wörter für Kinder und Jugendliche. */
    test.each([
      ["Du bist im Kindesalter.", 3],
      ["Du bist im Kindergartenalter.", 3],
      ["Du bist im Vorschulalter.", 3],
      ["Du bist im Kleinkindalter.", 3],
      ["Du gehst in den Kindergarten.", 3],
      ["Du bist im Schulalter.", 6],
      ["Du bist im Jugendalter.", 13],
      ["Du bist ein Erstklässler.", 6],
      ["Du bist eine Fünftklässlerin.", 6],
      ["Du bist ein Zwoelftklaessler.", 6],
      ["You are a first grader.", 6],
      ["You are a sixth-grader.", 6],
      ["Du bist ein Lehrling.", 15],
      ["Du bist Azubi.", 15],
      ["Du bist eine Auszubildende.", 15],
      ["You are an apprentice.", 15],
    ])("gelesen als Altersstufe: %s → %p", async (karte, alter) => {
      expect(_untereAltersgrenze(karte)).toBe(alter);
      const r = await analyse(undefined, `${karte} Das zeigt das Bild.`);
      expect(r).toMatchObject({ stufe2: true, alter, unlesbar: false, kreditBleibt: false });
    });

    /* Gegenproben gegen Erwachsenen-Formen und Alltagswörter. */
    test.each([
      ["Du bist Lehrlingsausbilder."],
      ["Du bist Kindergartenpädagogin."],
      ["Du bist Kindergärtnerin."],
      ["Du bist die Kindesmutter."],
      ["Du schiebst einen Kinderwagen."],
      ["Du bist von Kindesbeinen an sportlich."],
      ["You are a grader at the factory."],
    ])("kein Kind in: %s", (text) => {
      expect(_untereAltersgrenze(text)).toBeNull();
      expect(hatAltersversuch(text)).toBe(false);
    });

    /* „Sehr jung“ nennt kein Alter, ist aber ein Altersversuch: Ohne lesbares
       Alter greift der Schutz. */
    test.each([
      ["Du bist noch sehr jung. Milchzähne."],
      ["Du bist weiblich und sehr jung. Runde Wangen."],
      ["You look very young. Round cheeks."],
    ])("„sehr jung“ ohne lesbares Alter: %s", async (karte) => {
      expect(hatAltersversuch(karte)).toBe(true);
      const r = await analyse(undefined, karte);
      expect(r).toMatchObject({ stufe2: true, alter: null, unlesbar: true, kreditBleibt: false });
    });

    test.each([["Du bist jung geblieben. Graue Schläfen."], ["Du hast eine junge Katze auf dem Arm."]])(
      "kein Altersversuch: %s",
      (karte) => {
        expect(hatAltersversuch(karte)).toBe(false);
      }
    );

    test("„sehr jung“ ändert nichts, wenn der Anker ein Alter nennt", async () => {
      const r = await analyse("männlich, ~40 Jahre alt (Spanne 38-45)", "Du wirkst sehr jung für dein Alter.");
      expect(r).toMatchObject({ stufe2: false, alter: 38, unlesbar: false, kreditBleibt: true });
    });

    /* c) Der Altersanker ist laut Schema ein Text. Liefert die KI eine Zahl,
       eine Liste oder ein Objekt, wird der Inhalt gelesen statt verworfen. */
    test.each([
      [13, 13, true],
      [{ alter: 13, geschlecht: "weiblich" }, 13, true],
      [["weiblich", "13"], 13, true],
      [{ alter: "12-14" }, 12, true],
      [{ alter: { von: 12, bis: 14 } }, 12, true],
      [40, 40, false],
    ])("Anker als %p: gelesen wird %p", async (anker, alter, stufe2) => {
      const r = await analyse(anker, "Du bist weiblich. Zahnspange.");
      expect(r).toMatchObject({ stufe2, alter, unlesbar: false, kreditBleibt: !stufe2, harmlosBleibt: true });
      /* Angezeigt wird weiter nur ein Anker, der Text ist. */
      expect(r.karte).toBe("Du bist weiblich. Zahnspange.");
    });

    test.each([
      ["Text bleibt Text", "weiblich, 13", "weiblich, 13"],
      ["Zahl", 13, "13"],
      ["Liste", ["weiblich", 13], "weiblich, 13"],
      ["Objekt", { alter: 13, geschlecht: "weiblich" }, "alter 13, geschlecht weiblich"],
      ["nichts", null, ""],
      ["nichts", undefined, ""],
      ["Wahrheitswert", true, ""],
      ["leeres Objekt", {}, ""],
      ["keine endliche Zahl", NaN, ""],
    ])("ankerAlsText — %s", (_name, wert, erwartet) => {
      expect(ankerAlsText(wert)).toBe(erwartet);
    });

    test.each([
      ["senkt die Auslese: zählt", { alter: 13 }, "Du bist ~40 Jahre alt.", "alter 13"],
      ["hebt die Auslese an: zählt nicht", { alter: 40 }, "Du bist ein Mädchen.", ""],
      ["hebt die Auslese an: zählt nicht", 30, "Du bist ca. 13 Jahre alt.", ""],
      ["Karte ohne Alter: zählt", 40, "Du bist weiblich.", "40"],
      [
        "Anker ohne Alter: zählt (ändert nichts)",
        { geschlecht: "weiblich" },
        "Du bist ~13 Jahre alt.",
        "geschlecht weiblich",
      ],
      [
        "Anker mit Platzhalter: zählt (Alter nicht lesbar)",
        { alter: "~‹Zahl› Jahre" },
        "Du bist weiblich.",
        "alter ~‹Zahl› Jahre",
      ],
    ])("ankerZusatz — %s", (_name, wert, saetze, erwartet) => {
      expect(ankerZusatz(wert, saetze)).toBe(erwartet);
    });

    test("ankerAlsText begrenzt Tiefe und Länge", () => {
      expect(ankerAlsText({ a: { b: { c: { d: { e: 13 } } } } })).not.toContain("13");
      expect(ankerAlsText(Array.from({ length: 500 }, () => "weiblich")).length).toBeLessThanOrEqual(200);
    });

    /* Sichere Richtung: Ein Anker, der kein Text ist, wird nur mitgelesen. Er
       kann die Altersauslese der Karte senken, nie anheben — auch ein
       Kindwort ohne Zahl verdrängt er nicht. */
    test.each([
      [30, "Du bist weiblich, ca. 13 Jahre alt (Spanne 12-14). Zahnspange.", 12],
      [{ alter: 40 }, "Du bist ein Mädchen. Zahnspange.", 8],
      [40, "Du bist ein Teenager. Zahnspange.", 13],
      [{ alter: 13 }, "Du bist männlich, ~40 Jahre alt (Spanne 38-45). Graue Schläfen.", 13],
      [{ alter: 5 }, "Du bist ein Mädchen. Zahnspange.", 5],
    ])("Anker als %p neben der Karte „%s“: gelesen wird %p", async (anker, karte, alter) => {
      const r = await analyse(anker, karte);
      expect(r).toMatchObject({ alter, unlesbar: false, stufe2: alter <= SCHUTZ_ALTER });
      expect(r.karte).toBe(karte);
    });

    test("ein Anker ohne Alter, der kein Text ist, ändert nichts", async () => {
      const r = await analyse(
        { geschlecht: "weiblich" },
        "Keine klaren Bildsignale. Die Person ist von hinten zu sehen."
      );
      expect(r).toMatchObject({ stufe2: false, alter: null, unlesbar: false, kreditBleibt: true });
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Live-Anzeige und Endergebnis entscheiden über die Alterskarte mit
   derselben Regel: Es zählt der Anker, sonst der erste Satz der Karte.
   Zeigt das Endergebnis den festen Satz, war die Karte vorher nicht zu
   sehen — sie erscheint nicht erst mit einer Zahl und springt dann um.
   ══════════════════════════════════════════════════════════════════════ */
describe("Live-Anzeige und Endergebnis entscheiden über die Alterskarte gleich", () => {
  const BELEG = " Deine Wangen sind noch rund.";
  const FESTER_SATZ = "Dein Alter lässt sich aus diesem Bild nicht sicher ablesen.";

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

  function karten(alterWert) {
    const k = {};
    for (const name of REQUIRED_CARDS)
      k[name] = { label: name, value: "Du bist X. Das zeigt das Bild.", confidence: 0.8 };
    k.alter_geschlecht = { label: "Alter & Geschlecht", value: alterWert, confidence: 0.8 };
    return k;
  }

  /* anker === undefined: hard_facts fehlt ganz. */
  function antwort(anker, karteStandard, karteBeast = karteStandard) {
    const body = {};
    if (anker !== undefined) body.hard_facts = { alter_geschlecht: anker, herkunft: "mitteleuropäisch" };
    body.standard = {
      profileText: "Sachlich.",
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      categories: karten(karteStandard),
    };
    body.beast = {
      profileText: "Zynisch.",
      ad_targeting: ["B"],
      manipulation_triggers: ["U"],
      categories: karten(karteBeast),
    };
    return body;
  }

  const liveSichtbar = (karten) => karten.some((k) => k.schluessel === "alter_geschlecht");

  /* Der Strom kommt Zeichen für Zeichen an: Was war JEMALS live zu sehen? */
  function jemalsLive(json) {
    const gesehen = { standard: false, beast: false };
    for (let i = 1; i <= json.length; i++) {
      const teil = _extrahiereLiveText(json.slice(0, i));
      gesehen.standard = gesehen.standard || liveSichtbar(teil.kartenStandard);
      gesehen.beast = gesehen.beast || liveSichtbar(teil.kartenBeast);
    }
    return gesehen;
  }

  async function beides(body) {
    const live = _extrahiereLiveText(JSON.stringify(body));
    const jemals = jemalsLive(JSON.stringify(body));
    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    }));
    const fertig = await runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");
    return {
      liveStandard: liveSichtbar(live.kartenStandard),
      liveBeast: liveSichtbar(live.kartenBeast),
      jemalsStandard: jemals.standard,
      jemalsBeast: jemals.beast,
      /* Positivkontrolle der Messung: Andere Karten kommen live an. */
      liveAndereKarten: live.kartenStandard.length,
      festerSatz: fertig.normal.categories.alter_geschlecht.value.includes(FESTER_SATZ),
      festerSatzBeast: fertig.boost.categories.alter_geschlecht.value.includes(FESTER_SATZ),
      karte: fertig.normal.categories.alter_geschlecht.value,
      karteBeast: fertig.boost.categories.alter_geschlecht.value,
    };
  }

  const IM_ZWEITEN_SATZ = "Du bist weiblich. Du bist etwa 13 Jahre alt." + BELEG;

  /* [Fall, Anker, Karte, live sichtbar?, fester Satz am Ende?] */
  test.each([
    [
      "Format des Prompts",
      "weiblich, ~13 Jahre alt (Spanne 12-14)",
      "Du bist weiblich, ~13 Jahre alt (Spanne 12-14)." + BELEG,
      true,
      false,
    ],
    ["Anker fehlt, Karte im Format", undefined, "Du bist weiblich, ~13 Jahre alt (Spanne 12-14)." + BELEG, true, false],
    ["Anker fehlt, Karte mit „ca. 13 Jahre“", undefined, "Du bist weiblich, ca. 13 Jahre alt." + BELEG, true, false],
    ["Anker nennt nur ein Kinderwort", "weiblich, ein Mädchen", "Du bist ein Mädchen." + BELEG, true, false],
    [
      "kein Altersversuch",
      "Keine klaren Bildsignale.",
      "Es gibt keine klaren Bildsignale. Die Person ist von hinten zu sehen.",
      true,
      false,
    ],
    [
      "Anker lesbar, Beleg-Satz mit Alterswort ohne Zahl",
      "weiblich, ~13 Jahre alt",
      "Du bist weiblich. Seit Jahren im Verein.",
      true,
      false,
    ],
    ["Anker fehlt, Alter erst im zweiten Satz", undefined, IM_ZWEITEN_SATZ, false, true],
    ["Anker nennt nur das Geschlecht, Alter erst im zweiten Satz", "weiblich", IM_ZWEITEN_SATZ, false, true],
    /* Der Anker ist kein Text: live zählt er nicht (die Karte wartet), im
       Endergebnis wird er mitgelesen — das Alter ist damit lesbar, die Karte
       erscheint so, wie die KI sie schrieb. */
    [
      "Anker ist ein Objekt, Alter erst im zweiten Satz",
      { alter: 13, geschlecht: "weiblich" },
      IM_ZWEITEN_SATZ,
      false,
      false,
    ],
    [
      "Anker ist ein Objekt ohne Alter, Alter erst im zweiten Satz",
      { geschlecht: "weiblich" },
      IM_ZWEITEN_SATZ,
      false,
      true,
    ],
    ["Anker fehlt, Geburtsjahr statt Alter", undefined, "Du bist weiblich, geboren um 2012." + BELEG, false, true],
    ["Anker fehlt, Karte mit Platzhalter", undefined, "Du bist weiblich, ~‹Zahl› Jahre alt." + BELEG, false, true],
    [
      "Anker mit Platzhalter, Karte mit Zahl",
      "weiblich, ~‹Zahl› Jahre alt",
      "weiblich, ~13 Jahre alt." + BELEG,
      false,
      true,
    ],
    [
      "Anker ohne Zahl mit Alterswort",
      "weiblich, Alter unklar, Spanne offen",
      "Du bist weiblich." + BELEG,
      false,
      true,
    ],
    [
      "Anker fehlt, Kindwort erst im zweiten Satz",
      undefined,
      "Du bist weiblich. Ein Mädchen mit runden Wangen.",
      false,
      true,
    ],
    [
      "Anker fehlt, „etwa 13“ ohne „Jahre“ im zweiten Satz",
      undefined,
      "Du bist weiblich. Etwa 13, mit runden Wangen und Zahnspange.",
      false,
      true,
    ],
    ["Anker fehlt, Kindwort im ersten Satz", undefined, "Du bist ein Bursche." + BELEG, true, false],
    ["Anker fehlt, „u. a.“ im ersten Satz", undefined, "Du wirkst u. a. wegen der Wangen wie 12." + BELEG, true, false],
    [
      "Anker lesbar, Kind im Beleg-Satz",
      "weiblich, ~40 Jahre alt (Spanne 38-45)",
      "Du bist weiblich, ~40 Jahre alt. Du hältst ein Kind an der Hand.",
      true,
      false,
    ],
    [
      "kein Altersversuch, Zahl mit Zählwort im Beleg-Satz",
      "weiblich",
      "Du bist weiblich. Etwa 7 Kopflängen passen in die Körperhöhe.",
      true,
      false,
    ],
  ])("%s", async (_fall, anker, karte, live, festerSatz) => {
    const r = await beides(antwort(anker, karte));
    expect(r.liveAndereKarten).toBeGreaterThan(5);
    expect({ liveStandard: r.liveStandard, liveBeast: r.liveBeast, festerSatz: r.festerSatz }).toEqual({
      liveStandard: live,
      liveBeast: live,
      festerSatz,
    });
    /* Die Zusicherung selbst: nie erst sichtbar und am Ende der feste Satz —
       auch nicht zwischendurch, während der Strom ankommt. */
    expect(r.festerSatz && (r.liveStandard || r.jemalsStandard)).toBe(false);
    expect(r.festerSatzBeast && (r.liveBeast || r.jemalsBeast)).toBe(false);
  });

  /* Ein Platzhalter erscheint live nie, auch wenn der Anker lesbar ist; das
     Endergebnis setzt den Anker an die Stelle des ersten Satzes. */
  test("Anker lesbar, Karte mit Platzhalter: live verborgen, am Ende der Anker statt des Platzhalters", async () => {
    const r = await beides(antwort("weiblich, ~13 Jahre alt", "Du bist weiblich, ~‹Zahl› Jahre alt." + BELEG));
    expect(r).toMatchObject({ liveStandard: false, liveBeast: false, festerSatz: false });
    expect(r.karte).toBe("weiblich, ~13 Jahre alt." + BELEG);
  });

  /* Die Standard-Karte kommt vor der Beast-Karte an. Ob deren erster Satz
     ein Alter bringt, ist dann noch offen — sie bleibt verborgen, bis das
     Endergebnis da ist. */
  test("Alter nur im ersten Satz der Beast-Karte: Standard-Karte wartet auf das Endergebnis", async () => {
    const r = await beides(antwort(undefined, IM_ZWEITEN_SATZ, "Weiblich, ~13 Jahre alt. Leichte Beute."));
    expect(r).toMatchObject({ liveStandard: false, liveBeast: true, festerSatz: false });
    expect(r.karte).toBe(IM_ZWEITEN_SATZ);
  });

  /* Fehlt der Anker und trägt die Standard-Karte einen Platzhalter, die
     Beast-Karte aber ein Alter, bleibt nach dem Entfernen des Platzhalters
     nichts übrig. Dann steht der feste Satz da — nie eine Karte ohne Text. */
  test("Anker fehlt, Standard-Karte mit Platzhalter, Beast-Karte mit Alter: fester Satz statt leerer Karte", async () => {
    const r = await beides(
      antwort(undefined, "Du bist weiblich, ~‹Zahl› Jahre alt." + BELEG, "Weiblich, ~13 Jahre alt. Leichte Beute.")
    );
    expect(r).toMatchObject({ liveStandard: false, liveBeast: true, festerSatz: true, festerSatzBeast: false });
    expect(r.karte).toBe("Du bist weiblich. " + FESTER_SATZ);
    expect(r.karteBeast).toBe("Weiblich, ~13 Jahre alt. Leichte Beute.");
  });

  /* Umgekehrt ist die Standard-Karte schon da, wenn die Beast-Karte ankommt:
     Die Beast-Karte entscheidet mit beiden Karten, wie das Endergebnis. */
  const OHNE_ALTERSVERSUCH = "Es gibt keine klaren Bildsignale. Die Person ist von hinten zu sehen.";

  test("Standard-Karte mit Alter erst im zweiten Satz, Beast-Karte ohne Altersversuch: beide live verborgen", async () => {
    const r = await beides(antwort(undefined, IM_ZWEITEN_SATZ, OHNE_ALTERSVERSUCH));
    expect(r).toMatchObject({ liveStandard: false, liveBeast: false, festerSatz: true, festerSatzBeast: true });
  });

  test("Standard-Karte mit Alter im ersten Satz, Beast-Karte erst im zweiten: Beast-Karte erscheint und bleibt", async () => {
    const r = await beides(antwort(undefined, "Du bist weiblich, ~13 Jahre alt." + BELEG, IM_ZWEITEN_SATZ));
    expect(r).toMatchObject({ liveStandard: true, liveBeast: true, festerSatz: false, festerSatzBeast: false });
    expect(r.karteBeast).toBe(IM_ZWEITEN_SATZ);
  });

  /* hard_facts ist da, nennt aber kein Altersfeld: Der Kartenschlüssel
     „alter_geschlecht“ weiter hinten im Strom ist kein Anker — sonst gälte
     die Karte selbst als lesbarer Anker und erschiene mit der Zahl aus dem
     zweiten Satz. */
  test("hard_facts ohne Altersfeld, Alter erst im zweiten Satz der Karte: live verborgen, am Ende der feste Satz", async () => {
    const body = { hard_facts: { herkunft: "mitteleuropäisch" }, ...antwort(undefined, IM_ZWEITEN_SATZ) };
    /* Positivkontrolle: hard_facts steht im Strom vor den Profilen. */
    expect(JSON.stringify(body).indexOf('"hard_facts"')).toBeLessThan(JSON.stringify(body).indexOf('"standard"'));
    const r = await beides(body);
    expect(r).toMatchObject({ jemalsStandard: false, jemalsBeast: false, festerSatz: true, festerSatzBeast: true });
  });

  /* ── Bewusste Ausnahme (SECURITY-MODEL, Abschnitt 17.09.2026, Punkt 3) ──
     Die Standard-Karte kommt vor der Beast-Karte an. Zeigt erst die
     Beast-Karte einen Altersversuch ohne lesbares Alter, steht eine
     Standard-Karte ohne Altersversuch schon da und wechselt mit dem
     Endergebnis auf den festen Satz. Dasselbe gilt für einen Altersanker,
     der entgegen dem Schema erst hinter den Profilen steht. Die Tests halten
     fest, dass es diese Fälle sind — und dass die Beast-Karte selbst in den
     ersten drei nie erscheint. */
  const OHNE_ALTER = "Du bist weiblich. Runde Wangen.";

  test.each([
    [
      "Beast-Karte mit Alterswort ohne Zahl",
      undefined,
      OHNE_ALTER,
      "Du bist weiblich. Seit Jahren klebst du am Handy.",
    ],
    ["Beast-Karte mit Platzhalter", undefined, OHNE_ALTER, "Du bist weiblich, ~‹Zahl› Jahre alt."],
    [
      "Anker und Standard-Karte ohne Altersversuch, Beast-Karte mit Alterswort ohne Zahl",
      "Keine klaren Bildsignale.",
      "Keine klaren Bildsignale.",
      "Niemand zu sehen. Die Jacke hängt seit Jahren dort.",
    ],
  ])("bewusste Ausnahme — %s: Standard-Karte war zu sehen, am Ende der feste Satz", async (_fall, anker, s, b) => {
    const r = await beides(antwort(anker, s, b));
    expect(r).toMatchObject({ jemalsStandard: true, jemalsBeast: false, festerSatz: true, festerSatzBeast: true });
  });

  test("bewusste Ausnahme — Anker hinter den Profilen und nicht lesbar: beide Karten waren zu sehen, am Ende der feste Satz", async () => {
    const KIND = "Du bist weiblich, ~13 Jahre alt (Spanne 12-14).";
    const { hard_facts: _weg, ...profile } = antwort(undefined, KIND + BELEG, KIND + " Leichte Beute.");
    const body = { ...profile, hard_facts: { alter_geschlecht: "Du bist weiblich, ~‹Zahl› Jahre alt." } };
    /* Positivkontrolle: Der Anker steht im Strom wirklich hinter den Profilen. */
    expect(JSON.stringify(body).indexOf('"hard_facts"')).toBeGreaterThan(JSON.stringify(body).indexOf('"beast"'));
    const r = await beides(body);
    expect(r).toMatchObject({ jemalsStandard: true, jemalsBeast: true, festerSatz: true, festerSatzBeast: true });
    /* Live zählt nur, was VOR den Profilen steht: Eine Karte, die schon zu
       sehen war, nimmt die Live-Anzeige nicht zurück, wenn der Anker
       nachkommt. */
    expect(r).toMatchObject({ liveStandard: true, liveBeast: true });
  });

  /* Gegenprobe: Steht derselbe Anker dort, wo das Schema ihn vorsieht (vor
     den Profilen), erscheint keine der beiden Karten. */
  test("derselbe Anker vor den Profilen: beide Karten bleiben verborgen", async () => {
    const KIND = "Du bist weiblich, ~13 Jahre alt (Spanne 12-14).";
    const r = await beides(antwort("Du bist weiblich, ~‹Zahl› Jahre alt.", KIND + BELEG, KIND + " Leichte Beute."));
    expect(r).toMatchObject({ jemalsStandard: false, jemalsBeast: false, festerSatz: true, festerSatzBeast: true });
  });
});
