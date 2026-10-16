"use strict";

/* Auswertungswerkzeug der dauerhaften Zaehler (scripts/zaehler-auswerten.js,
   16.10.2026): Wiener Tag, Bloecke (Luecke von MEHR als 30 Minuten trennt),
   Vergleich zweier Zeitraeume — ohne Datenbank, ueber --datei. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const werkzeug = require("../../../scripts/zaehler-auswerten");

const MIN = 60 * 1000;
/* 16.10.2026, 09:00 Wien (Sommerzeit) = 07:00 UTC */
const NEUN_UHR = Date.UTC(2026, 9, 16, 7, 0);
const SPAETER = Date.UTC(2026, 11, 1); // "jetzt" fuer die Tests: lange danach

const fenster = (beginn, felder) => ({ id: `f-${beginn}`, art: "fenster", beginn, ...felder });

describe("Wiener Tag", () => {
  test("Mitternacht im Sommer (UTC+2) und im Winter (UTC+1)", () => {
    expect(werkzeug.wienerMitternacht("2026-10-16")).toBe(Date.UTC(2026, 9, 15, 22, 0));
    expect(werkzeug.wienerMitternacht("2026-12-01")).toBe(Date.UTC(2026, 10, 30, 23, 0));
  });

  test("der Tag der Zeitumstellung hat 25 Stunden", () => {
    const z = werkzeug.zeitraum("2026-10-25");
    expect(z.bis - z.von).toBe(25 * 60 * MIN);
  });

  test("Zeitraum von..bis schliesst beide Tage ein", () => {
    expect(werkzeug.zeitraum("2026-10-14..2026-10-16").tage).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
  });
});

describe("Bloecke: Luecke von MEHR als 30 Minuten trennt", () => {
  test("genau 30 Minuten Luecke: derselbe Block", () => {
    const b = werkzeug.bloecke([
      fenster(NEUN_UHR, { eingereiht: 3 }),
      fenster(NEUN_UHR + 40 * MIN, { eingereiht: 2 }), // Ende 09:10, Beginn 09:40 -> 30 min
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].summe.eingereiht).toBe(5);
  });

  test("40 Minuten Luecke (die naechste moegliche): neuer Block", () => {
    const b = werkzeug.bloecke([fenster(NEUN_UHR, { eingereiht: 3 }), fenster(NEUN_UHR + 50 * MIN, { eingereiht: 2 })]);
    expect(b).toHaveLength(2);
  });

  test("Fenster nur mit Abweisungen zaehlen als aktiv, leere nicht", () => {
    const b = werkzeug.bloecke([
      fenster(NEUN_UHR, { abgewiesen: { stundenlimit: 4 } }),
      fenster(NEUN_UHR + 10 * MIN, {}),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].bis).toBe(NEUN_UHR + 10 * MIN);
  });
});

describe("Ausgabe ueber --datei", () => {
  let datei;
  beforeAll(() => {
    datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zaehler-")), "docs.json");
    fs.writeFileSync(
      datei,
      JSON.stringify([
        fenster(NEUN_UHR, {
          eingereiht: 10,
          fertig: 8,
          gescheitert: { overloaded: 1 },
          verworfen: 1,
          abgeholt: 7,
          nieAbgeholt: 2,
          abgewiesen: { stundenlimit: 3 },
          wartezeit: { unter30s: 6, unter1min: 3 },
          gesamtzeit: { unter2min: 8 },
          kiDauer: { unter2min: 9 },
          kiWiederholungen: 2,
        }),
        fenster(NEUN_UHR + 2 * 60 * MIN, { eingereiht: 4, fertig: 4, wartezeit: { laenger: 4 } }),
        {
          id: "tag-2026-10-16",
          art: "tag",
          tag: "2026-10-16",
          browserFehler: { "queue-poll": { android: 2, appleTelefon: 1 } },
          kiText: { eingabe: 900, zwischenspeicher: 300, ausgabe: 400 },
        },
        fenster(Date.UTC(2026, 9, 14, 7, 0), { eingereiht: 5, fertig: 5, wartezeit: { unter30s: 5 } }),
      ])
    );
  });

  test("tag: Summen, Gruende, Klassen, Browser-Fehler, Textmenge", async () => {
    const text = (await werkzeug.main(["tag", "2026-10-16", "--datei", datei], SPAETER)).join("\n");
    expect(text).toContain("Zaehler 2026-10-16 (Wiener Zeit): 2 Fenster mit Werten, 1 Tagesdokument(e)");
    expect(text).toContain("eingereiht: 14");
    expect(text).toContain("fertig: 12");
    expect(text).toContain("overloaded: 1");
    expect(text).toContain("stundenlimit: 3");
    expect(text).toContain("abgeholt: 7 · nie abgeholt: 2");
    expect(text).toMatch(/>= 8 min\s+4\s+31 %/);
    expect(text).toContain("queue-poll: 3 (android 2, appleTelefon 1)");
    expect(text).toContain("Eingabe 900 (davon Zwischenspeicher 300), Ausgabe 400");
    expect(text).not.toContain("HINWEIS");
  });

  test("tag ohne Zaehler sagt es ausdruecklich", async () => {
    const text = (await werkzeug.main(["tag", "2026-10-10", "--datei", datei], SPAETER)).join("\n");
    expect(text).toContain("keine Zaehler in diesem Zeitraum");
  });

  test("bloecke: zwei Bloecke mit Wiener Uhrzeit", async () => {
    const text = (await werkzeug.main(["bloecke", "2026-10-16", "--datei", datei], SPAETER)).join("\n");
    expect(text).toContain("Bloecke am 2026-10-16 (Luecke > 30 min trennt): 2");
    expect(text).toContain("Block 1: 09:00–09:10 · eingereiht 10");
    expect(text).toContain("Block 2: 11:00–11:10 · eingereiht 4");
  });

  test("vergleich: zwei Zeitraeume nebeneinander", async () => {
    const text = (
      await werkzeug.main(["vergleich", "2026-10-14", "2026-10-15..2026-10-16", "--datei", datei], SPAETER)
    ).join("\n");
    expect(text).toMatch(/eingereiht\s+5\s+14/);
    expect(text).toMatch(/Anteil fertig\s+100 %\s+86 %/);
  });

  test("juengste zwei Stunden: Hinweis auf unvollstaendige Zaehlung", async () => {
    const text = (await werkzeug.main(["tag", "2026-10-16", "--datei", datei], NEUN_UHR + 60 * MIN)).join("\n");
    expect(text).toContain("HINWEIS: Der Zeitraum reicht in die juengsten zwei Stunden");
  });

  test("falscher Aufruf wirft mit Anleitung", async () => {
    await expect(werkzeug.main(["unsinn", "--datei", datei])).rejects.toThrow(
      /Aufruf: node scripts\/zaehler-auswerten.js/
    );
  });
});
