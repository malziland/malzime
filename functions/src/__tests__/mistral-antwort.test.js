"use strict";

/**
 * mistral-antwort.test.js
 *
 * BEFUND 31.08.2026 (unvorbelastetes Review): Die aus `mistral.js`
 * herausgeloeste Datei hatte KEINE eigene Testdatei.
 *
 * WAS HIER GEPRUEFT WIRD: Das Verhalten an den Kanten, nicht der Normalfall.
 * Diese Funktionen lesen ANGEFANGENE Antworten der KI — abgeschnittene
 * Zeichenketten, fehlende Bloecke, rohe Steuerzeichen. Genau dort entscheidet
 * sich, ob im Browser ein halber Satz erscheint oder ein Fehler.
 */

/* DIE RUECKGABEFORM, gegen den Code aufgenommen (31.08.2026):
     findeProfileTextWert -> null  ODER
                             { text, schluesselIdx, ende, abgeschlossen }

   `abgeschlossen` ist der wichtige Teil: Es sagt, ob der Wert im angefangenen
   JSON schon zu Ende geschrieben war. Die Aufrufer in mistral.js pruefen ihn
   ausdruecklich (Zeilen 174, 176), bevor sie den Text verwenden. */
const { findeProfileTextWert, KARTEN_WERT_SCHLUESSEL, KARTEN_LABEL_SCHLUESSEL } = require("../mistral-antwort");

describe("findeProfileTextWert — Text aus angefangenem JSON lesen", () => {
  test("liest den Wert hinter dem Schluessel", () => {
    const roh = '{"profileText": "Ein junger Mensch."}';
    const treffer = findeProfileTextWert(roh, 0);
    expect(treffer.text).toBe("Ein junger Mensch.");
    expect(treffer.abgeschlossen).toBe(true);
  });

  test("liefert auch aus einer ABGESCHNITTENEN Antwort, was schon da ist", () => {
    /* Der eigentliche Zweck: Waehrend die KI noch schreibt, soll der bisher
       angekommene Text angezeigt werden. Ein Parser, der auf das schliessende
       Anfuehrungszeichen wartet, liefert waehrend der ganzen Analyse nichts. */
    const roh = '{"profileText": "Ein junger Mensch, der gerade';
    const treffer = findeProfileTextWert(roh, 0);
    expect(treffer.text).toBe("Ein junger Mensch, der gerade");
    /* Und der Aufrufer erfaehrt, dass hier noch geschrieben wird. */
    expect(treffer.abgeschlossen).toBe(false);
  });

  test("versteht Escape-Folgen", () => {
    const roh = '{"profileText": "Zeile eins\\nZeile \\"zwei\\""}';
    const wert = findeProfileTextWert(roh, 0).text;
    expect(wert).toContain("Zeile eins");
    expect(wert).toContain('"zwei"');
  });

  test("schneidet eine UNVOLLSTAENDIGE Escape-Folge am Ende ab", () => {
    /* Waehrend die KI schreibt, kann ein Zeichen mitten in seiner
       Escape-Folge stecken (`\\u00e` statt `\\u00e4`). Gemessen am Code
       (31.08.2026): Die Folge wird VOLLSTAENDIG verworfen — es bleibt der
       Text davor. Sonst stuende im Browser ein Rueckstrich mit halber
       Zahlenfolge. */
    const roh = String.raw`{"profileText": "Text mit halbem \u00e`;
    const wert = findeProfileTextWert(roh, 0).text;
    expect(wert).toBe("Text mit halbem ");
    expect(wert).not.toContain("\\");
    expect(wert).not.toContain("u00e");
  });

  test("findet nichts, wenn der Schluessel fehlt", () => {
    expect(findeProfileTextWert('{"anderes": "x"}', 0)).toBeNull();
  });

  test("sucht ab der genannten Stelle, nicht von vorn", () => {
    /* Bei zwei Profilen im selben Strom (standard und beast) darf der zweite
       Aufruf nicht wieder den ersten Treffer liefern. */
    const roh = '{"standard": {"profileText": "erster"}, "beast": {"profileText": "zweiter"}}';
    const ersterIdx = roh.indexOf("standard");
    const zweiterIdx = roh.indexOf("beast");
    expect(findeProfileTextWert(roh, ersterIdx).text).toBe("erster");
    expect(findeProfileTextWert(roh, zweiterIdx).text).toBe("zweiter");
  });

  test("liest auch die Kartenfelder — mit den mitgelieferten Schluesseln", () => {
    const roh = '{"alter": {"label": "Alter", "value": "25-30 Jahre"}}';
    const idx = roh.indexOf("alter");
    expect(findeProfileTextWert(roh, idx, KARTEN_LABEL_SCHLUESSEL).text).toBe("Alter");
    expect(findeProfileTextWert(roh, idx, KARTEN_WERT_SCHLUESSEL).text).toBe("25-30 Jahre");
  });
});

describe("ohneWerbeAbsagen — eine Absage der KI wird nie ein Werbe-Kaertchen", () => {
  const { istWerbeAbsage, ohneWerbeAbsagen } = require("../mistral-antwort");

  /* Wortlaut aus der Messung vom 31.10.2026 (Large 4, Fotos von Kindern). */
  test.each([
    "Ich kann diese Anfrage nicht erfüllen.",
    "Ich kann diese Anfrage nicht ausführen. Es geht hier um die Erstellung manipulativer Werbeziele.",
    "Das Profil beschreibt ein etwa 5-jähriges Kind, und die Aufgabe besteht ausdrücklich darin, dessen Verletzlichkeit auszunutzen.",
    "Ich erstelle diese Werbeliste nicht.",
    "Ich möchte das nicht.",
    "I cannot help with this request.",
    "Sorry, that is not possible.",
  ])("erkennt als Absage: %s", (satz) => {
    expect(istWerbeAbsage(satz)).toBe(true);
  });

  test.each(["Pokémon Karten", "iRobot Roomba", "i-Size Kindersitz", "Ich", "Die drei ??? Kids", "Toniebox Hörfigur"])(
    "laesst echte Eintraege stehen: %s",
    (eintrag) => {
      expect(istWerbeAbsage(eintrag)).toBe(false);
    }
  );

  test("Grenze: acht Woerter bleiben, neun fallen", () => {
    expect(istWerbeAbsage("a b c d e f g h")).toBe(false);
    expect(istWerbeAbsage("a b c d e f g h i")).toBe(true);
  });

  test("filtert die Liste und vertraegt fremde Formen", () => {
    expect(ohneWerbeAbsagen(["Lego", "Ich kann das nicht.", "", null, 3])).toEqual(["Lego"]);
    expect(ohneWerbeAbsagen(undefined)).toEqual([]);
    expect(ohneWerbeAbsagen("Lego")).toEqual([]);
  });
});

describe("modellEinstellungen — was je Modell am Aufruf anders ist", () => {
  const { modellEinstellungen } = require("../config");

  test("Large 3 bleibt unveraendert", () => {
    expect(modellEinstellungen("mistral-large-2512")).toEqual({
      aufrufZusatz: {},
      werbeMaxTokens: 600,
      werbeZeitgrenzeMs: 30_000,
    });
  });

  test("Large 4 denkt auf der kleinsten Stufe und hat Platz fuer die Werbung", () => {
    expect(modellEinstellungen("mistral-large-4").aufrufZusatz).toEqual({ reasoning_effort: "low" });
    expect(modellEinstellungen("mistral-large-4").werbeMaxTokens).toBe(4000);
  });

  test("ein unbekanntes Modell bekommt keinen Zusatz", () => {
    expect(modellEinstellungen("mistral-unbekannt").aufrufZusatz).toEqual({});
  });
});

describe("Kinder bis 13: keine Dating- und Kreditkarten-Texte im Auftrag", () => {
  test.each([
    ["de", "Bei Kindern bis 13 Jahre zusätzlich", "KEINE Dating-Apps", "KEINE Kreditkarten"],
    ["en", "For children up to 13 years, additionally", "NO dating apps", "NO credit cards"],
  ])("%s", (sprache, kopf, dating, karte) => {
    const { singleLargePromptVarianten } = require(`../locales/${sprache}/prompts`);
    for (const vorlage of singleLargePromptVarianten) {
      const text = typeof vorlage === "function" ? vorlage({}) : String(vorlage);
      expect(text).toContain(kopf);
      expect(text).toContain(dating);
      expect(text).toContain(karte);
    }
  });
});

describe("neuversuchNachZeitgrenze — ein stiller zweiter Versuch nur bei Large 4", () => {
  const { neuversuchNachZeitgrenze: pruefe } = require("../verbindungsfehler");
  const { modellEinstellungen } = require("../config");
  const zeit = { code: "timeout" };
  const large4 = modellEinstellungen("mistral-large-4");

  test("Large 4 nach Zeitgrenze mit Budget: ja", () => {
    expect(pruefe(zeit, large4, () => 60_000)).toBe(true);
  });
  test("zu wenig Budget: nein (knapp unter der Grenze)", () => {
    expect(pruefe(zeit, large4, () => 59_999)).toBe(false);
  });
  test("Large 3 bleibt wie bisher", () => {
    expect(pruefe(zeit, modellEinstellungen("mistral-large-2512"), () => 300_000)).toBe(false);
  });
  test("anderer Fehler: nein", () => {
    expect(pruefe({ code: "x" }, large4, () => 300_000)).toBe(false);
  });
});
