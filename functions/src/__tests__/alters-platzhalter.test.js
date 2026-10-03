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
  ersterSatz,
  untereAltersgrenze: _untereAltersgrenze,
} = require("../alters-lesbarkeit");
const DE = require("../locales/de/prompts");
const EN = require("../locales/en/prompts");
const { runSingleLargeCall, setFetchForTest, _extrahiereLiveText } = require("../mistral");
const { applyMinorSafety } = require("../minor-safety");
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
});
