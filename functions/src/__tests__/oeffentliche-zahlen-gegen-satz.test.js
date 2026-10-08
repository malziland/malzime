/**
 * Stimmen die Zahlen, die oeffentliche Seiten nennen, mit dem Einstellungssatz?
 * (DOC-2026-10-03-53)
 *
 * ZWEI ZAHLEN DER NUTZUNGSBEDINGUNGEN lassen sich im Betrieb ohne Auslieferung
 * umstellen: die Begrenzung je IP-Adresse und das Stundenlimit. Die
 * Fakten-Waechter lesen kein HTML, und ihre Muster treffen diesen Wortlaut
 * nicht. Hier werden beide Sprachfassungen gegen den Satz gehalten, der in die
 * Produktion geschrieben wird (produktiv-satz.js) — wie in
 * satz-gegen-doku.test.js. Was in Firestore TATSAECHLICH liegt, kennt keine
 * Testumgebung; den Abgleich dazu macht verify-infrastructure.sh vor jedem
 * Deploy.
 *
 * DAZU DIE VIER OBERGRENZEN, die docs/BETRIEBSPROFILE.md als oeffentliche
 * Zusagen fuehrt: Jede Zeile der Tabelle dort nennt Feld, Obergrenze, Seite
 * und Wortlaut. Geprueft wird, dass die Obergrenze die der Feldliste ist und
 * dass der Wortlaut auf der genannten Seite steht — damit die Doku nicht
 * wieder einen Satz zitiert, den es auf der Seite nicht mehr gibt.
 */

const fs = require("fs");
const pfad = require("path");
const { T1_NORMAL: SATZ } = require("../produktiv-satz");
const { PFLICHTFELDER, _FELDER } = require("../betriebsprofil");

const WURZEL = pfad.join(__dirname, "..", "..", "..");

/* Der sichtbare Text einer Seite: Tags weg, das geschuetzte Leerzeichen als
   Leerzeichen, Leerraum zusammengezogen. Mehr braucht es nicht — die
   gesuchten Stellen tragen keine weiteren Zeichen-Kuerzel. */
function seitentext(relativ) {
  return fs
    .readFileSync(pfad.join(WURZEL, relativ), "utf8")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

describe("Nutzungsbedingungen nennen die Grenzen des Einstellungssatzes", () => {
  const FASSUNGEN = [
    {
      seite: "public/nutzungsbedingungen.html",
      jeAdresse: /rund (\d+) Anfragen pro (\d+) Minuten je IP/,
      jeStunde: /harte Grenze von (\d+) Analysen pro Stunde/,
    },
    {
      seite: "public/en/terms.html",
      jeAdresse: /roughly (\d+) requests per (\d+) minutes per IP/,
      jeStunde: /hard limit of (\d+) analyses per hour/,
    },
  ];

  test.each(FASSUNGEN)("$seite: Begrenzung je IP-Adresse", ({ seite, jeAdresse }) => {
    const treffer = seitentext(seite).match(jeAdresse);
    /* Messmittel zuerst: Findet das Muster den Satz ueberhaupt? */
    expect(treffer).not.toBeNull();
    expect(Number(treffer[1])).toBe(SATZ.adressLimit);
    expect(Number(treffer[2]) * 60 * 1000).toBe(SATZ.adressfensterMs);
  });

  test.each(FASSUNGEN)("$seite: Stundenlimit", ({ seite, jeStunde }) => {
    const treffer = seitentext(seite).match(jeStunde);
    expect(treffer).not.toBeNull();
    expect(Number(treffer[1])).toBe(SATZ.stundenlimit);
    /* "pro Stunde" stimmt nur, solange das Fenster eine Stunde ist. */
    expect(SATZ.stundenfensterMinuten).toBe(60);
  });
});

describe("docs/BETRIEBSPROFILE.md: die vier Obergrenzen, die Zusagen sind", () => {
  const MS = { Minuten: 60 * 1000, Stunden: 60 * 60 * 1000 };

  /* Zeilen der Tabelle: | `feld` | hoechstens 2 Stunden | `public/…html` | „Wortlaut“ | */
  function zusagenAusDoku() {
    const text = fs.readFileSync(pfad.join(WURZEL, "docs", "BETRIEBSPROFILE.md"), "utf8");
    const zeilen = [];
    for (const zeile of text.split("\n")) {
      const m = zeile.match(
        /^\|\s*`([a-zA-Z]+)`\s*\|\s*höchstens (\d+) (Minuten|Stunden)\s*\|\s*`(public\/[^`]+)`\s*\|\s*„([^“]+)“\s*\|$/
      );
      if (m) zeilen.push({ feld: m[1], zahl: Number(m[2]), einheit: m[3], seite: m[4], wortlaut: m[5] });
    }
    return zeilen;
  }

  const zusagen = zusagenAusDoku();

  test("die Tabelle ist lesbar und nennt genau die vier Felder (Messmittel-Probe)", () => {
    expect(zusagen.map((z) => z.feld).sort()).toEqual(
      ["adressfensterMs", "jobAufbewahrungMs", "stundenfensterMinuten", "zustellfensterMs"].sort()
    );
    for (const z of zusagen) expect(PFLICHTFELDER).toContain(z.feld);
  });

  test("jede genannte Obergrenze ist die der Feldliste", () => {
    for (const z of zusagen) {
      /* Ein Feld ist in Minuten gefuehrt, die anderen in Millisekunden. */
      const inFeldEinheit = z.feld.endsWith("Minuten") ? (z.zahl * MS[z.einheit]) / MS.Minuten : z.zahl * MS[z.einheit];
      expect({ feld: z.feld, max: inFeldEinheit }).toEqual({ feld: z.feld, max: _FELDER[z.feld].max });
    }
  });

  test("jeder Wortlaut steht auf der genannten Seite", () => {
    const fehlt = zusagen
      .filter((z) => !seitentext(z.seite).includes(z.wortlaut))
      .map((z) => `${z.seite}: ${z.wortlaut}`);
    expect(fehlt).toEqual([]);
  });
});
