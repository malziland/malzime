"use strict";

/**
 * mistral-antwort.test.js
 *
 * BEFUND 31.08.2026 (unvorbelastetes Review): Die aus `mistral.js`
 * herausgeloeste Datei hatte KEINE eigene Testdatei. `parseDescribeFooter`
 * wird von `mistral.js` nicht einmal exportiert und war damit nur indirekt
 * abgedeckt — ueber Umwege, die beim naechsten Umbau wegfallen koennen.
 *
 * WAS HIER GEPRUEFT WIRD: Das Verhalten an den Kanten, nicht der Normalfall.
 * Diese Funktionen lesen ANGEFANGENE Antworten der KI — abgeschnittene
 * Zeichenketten, fehlende Bloecke, rohe Steuerzeichen. Genau dort entscheidet
 * sich, ob im Browser ein halber Satz erscheint oder ein Fehler.
 */

/* DIE RUECKGABEFORM, gegen den Code aufgenommen (31.08.2026):
     findeProfileTextWert -> null  ODER
                             { text, schluesselIdx, ende, abgeschlossen }
     parseDescribeFooter  -> { description, hardFacts, ads, triggers }
                             — immer ein Objekt, nie ein Wurf.

   `abgeschlossen` ist der wichtige Teil: Es sagt, ob der Wert im angefangenen
   JSON schon zu Ende geschrieben war. Die Aufrufer in mistral.js pruefen ihn
   ausdruecklich (Zeilen 174, 176), bevor sie den Text verwenden. */
const {
  findeProfileTextWert,
  parseDescribeFooter,
  KARTEN_WERT_SCHLUESSEL,
  KARTEN_LABEL_SCHLUESSEL,
} = require("../mistral-antwort");

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

describe("parseDescribeFooter — die Anker am Ende der Beschreibung", () => {
  test("liest alle drei Bloecke", () => {
    const text = [
      "Ein Foto im Freien.",
      "HARD_FACTS:",
      "alter_geschlecht: 25-30 Jahre, maennlich",
      "herkunft: europaeisch",
      "ADS:",
      "Outdoor-Ausruestung",
      "Fitness-App",
      "TRIGGERS:",
      "FOMO",
    ].join("\n");
    const f = parseDescribeFooter(text);
    expect(f.hardFacts.alter_geschlecht).toBe("25-30 Jahre, maennlich");
    expect(f.ads).toContain("Outdoor-Ausruestung");
    expect(f.triggers).toContain("FOMO");
  });

  /* BEFUND 01.09.2026 (Runde 7, K-9/L-6): Die Laengengrenzen der beiden
     Bloecke waren von keinem Test beruehrt — `v.length <= 60` liess sich zu
     `< 60` aendern, ohne dass etwas rot wurde. Sie sind kein Schoenheitsmass:
     Eine ueberlange "Werbezeile" ist in Wahrheit ein Stueck Fliesstext, das
     die Antwort an dieser Stelle nicht haette liefern duerfen. Genau auf der
     Grenze entscheidet sich, ob ein Eintrag gehalten oder verworfen wird —
     also wird genau dort gemessen, einmal knapp darunter und einmal darueber. */
  describe("Laengengrenzen der Bloecke", () => {
    const zeile = (n) => "A".repeat(n);

    function baue(adsZeilen = [], triggerZeilen = []) {
      /* Ohne HARD_FACTS: gibt es gar keinen Footer — parseDescribeFooter
         liefert dann leere Anker, und die Grenzen waeren nie beruehrt. */
      return [
        "Ein Foto.",
        "HARD_FACTS:",
        "alter_geschlecht: 25-30 Jahre, maennlich",
        "ADS:",
        ...adsZeilen,
        "TRIGGERS:",
        ...triggerZeilen,
      ].join("\n");
    }

    test("eine Werbezeile mit genau 60 Zeichen wird gehalten", () => {
      const f = parseDescribeFooter(baue([zeile(60)]));
      expect(f.ads).toContain(zeile(60));
    });

    test("eine Werbezeile mit 61 Zeichen faellt heraus", () => {
      const f = parseDescribeFooter(baue([zeile(61)]));
      expect(f.ads).toHaveLength(0);
    });

    test("ein Ausloeser mit genau 250 Zeichen wird gehalten", () => {
      const f = parseDescribeFooter(baue([], [zeile(250)]));
      expect(f.triggers).toContain(zeile(250));
    });

    test("ein Ausloeser mit 251 Zeichen faellt heraus", () => {
      const f = parseDescribeFooter(baue([], [zeile(251)]));
      expect(f.triggers).toHaveLength(0);
    });

    test("die Grenze trifft nur den zu langen Eintrag, nicht den Block", () => {
      const f = parseDescribeFooter(baue(["Fitness-App", zeile(61), "Outdoor-Ausruestung"]));
      expect(f.ads).toEqual(["Fitness-App", "Outdoor-Ausruestung"]);
    });
  });

  test("FEHLENDE Bloecke ergeben leere Vorgaben, keinen Fehler", () => {
    /* Der dokumentierte Rueckfall: handle-process-job entscheidet dann, ob die
       Profil-Aufrufe die Felder selbst fuellen. Ein Wurf hier wuerde die ganze
       Analyse abbrechen. */
    const f = parseDescribeFooter("Nur eine Beschreibung, kein Anker.");
    expect(f).toBeTruthy();
    expect(f.ads).toEqual([]);
    expect(f.triggers).toEqual([]);
    expect(f.hardFacts).toEqual({});
    /* BEFUND aus der eigenen Rueckbauprobe (31.08.2026): Hier fehlte die
       Pruefung der Beschreibung. Ein Rueckbau von `text.trim()` auf `""` blieb
       deshalb unbemerkt — und dann waere die Bildbeschreibung verschwunden,
       sobald die KI keine Anker mitliefert. Genau der Fall, den dieser Test
       abdecken soll. */
    expect(f.description).toBe("Nur eine Beschreibung, kein Anker.");
  });

  test("auch OHNE Anker bleibt die Beschreibung vollstaendig erhalten", () => {
    /* Der Rueckfall ist der haeufigste Fehlerfall im Betrieb: Die KI liefert
       die Beschreibung, vergisst aber die Anker. Dann muss wenigstens der
       Fliesstext ankommen — sonst sieht das Kind eine leere Karte. */
    const lang =
      "Ein Mensch steht auf einem Berg. Im Hintergrund Wolken. " +
      "Die Kleidung wirkt sportlich, die Sonne steht tief.";
    expect(parseDescribeFooter(lang).description).toBe(lang);
  });

  test("leerer Text wirft nicht", () => {
    expect(() => parseDescribeFooter("")).not.toThrow();
  });

  test("ein halb geschriebener Anker wirft nicht", () => {
    expect(() => parseDescribeFooter("Text\nHARD_FACTS:\nalter_gesch")).not.toThrow();
  });

  test("die Beschreibung selbst bleibt ohne die Anker uebrig", () => {
    const text = "Die Beschreibung.\nHARD_FACTS:\nherkunft: europaeisch";
    const f = parseDescribeFooter(text);
    expect(f.description).toBe("Die Beschreibung.");
    expect(f.description).not.toContain("HARD_FACTS");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   OPS-2026-09-01 (Runde 6, G-12) — die Laengengrenzen im Footer.

   Mutationsprobe: `v.length <= 60` auf `<= 600` gesetzt -> alle 1211 Tests
   blieben gruen. Die Grenzen sind aber kein Zierrat: Der Footer kommt von
   der KI, und eine entgleiste Antwort wuerde sonst hundertzeilige "Werbung"
   in ein Kinderprofil schreiben. Die Kappung bei 12 bzw. 8 Eintraegen
   ebenso.
   ══════════════════════════════════════════════════════════════════════ */
describe("OPS-2026-09-01 — die Grenzen im Footer halten", () => {
  const { parseDescribeFooter } = require("../mistral-antwort");

  /* Der Footer beginnt fuer die Funktion erst bei HARD_FACTS: — davor steht
     die Beschreibung. Ohne diesen Marker liefert sie leere Anker zurueck. */
  function footer(ads, triggers) {
    return [
      "Beschreibung des Bildes.",
      "",
      "HARD_FACTS:",
      "alter_geschlecht: 30-40, weiblich",
      "herkunft: Europa",
      "ADS:",
      ...ads,
      "TRIGGERS:",
      ...triggers,
    ].join("\n");
  }

  test("zu lange Werbezeilen werden verworfen", () => {
    const kurz = "Sneaker im Angebot";
    const lang = "W".repeat(61);
    const e = parseDescribeFooter(footer([kurz, lang], []));
    expect(e.ads).toContain(kurz);
    expect(e.ads).not.toContain(lang);
  });

  test("zu lange Ausloeser werden verworfen", () => {
    const kurz = "Unsicherheit ueber das eigene Aussehen";
    const lang = "T".repeat(251);
    const e = parseDescribeFooter(footer([], [kurz, lang]));
    expect(e.triggers).toContain(kurz);
    expect(e.triggers).not.toContain(lang);
  });

  test("die Anzahl ist gedeckelt", () => {
    const viele = Array.from({ length: 30 }, (_, i) => `Werbung ${i}`);
    const vieleT = Array.from({ length: 30 }, (_, i) => `Ausloeser ${i}`);
    const e = parseDescribeFooter(footer(viele, vieleT));
    expect(e.ads.length).toBe(12);
    expect(e.triggers.length).toBe(8);
  });
});
