const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für scripts/pruefe-fremd-meldungen.mjs (Befund OSS-2026-09-30-01).
 *
 * Die mitgelieferten Bibliotheken unter public/lib sieht weder Dependabot noch
 * npm audit. Das Skript gleicht sie nachts mit den Sicherheitsmeldungen der
 * Hersteller ab. Diese Tests belegen, dass es in jeder Ausfallart rot wird —
 * und dass es bei den uneinheitlichen Versionsangaben der Hersteller weder zu
 * nachsichtig noch grundlos streng ist. Die Fälle stammen aus echten Meldungen
 * von libheif und libde265 (Stand 30.09.2026).
 *
 * Kein Netz: Die Meldungen kommen über den Einspeisepunkt FREMD_MELDUNGEN.
 */

const SKRIPT = path.join(__dirname, "../../../scripts/pruefe-fremd-meldungen.mjs");
const REPO = path.join(__dirname, "../../..");

let basis;

function versionen({ leaflet = "1.9.4", exifr = "7.1.3", libheif = "1.23.5", libde265 = "1.1.3" } = {}) {
  const schreibe = (ordner, text) => {
    fs.mkdirSync(path.join(basis, ordner), { recursive: true });
    fs.writeFileSync(path.join(basis, ordner, "VERSION"), text);
  };
  schreibe("public/lib/leaflet", `Leaflet ${leaflet}\n`);
  schreibe("public/lib/exifr", `exifr ${exifr} (lite ESM bundle)\n`);
  schreibe("public/lib/libheif", `libheif ${libheif}\nlibde265 ${libde265}\n`);
  fs.mkdirSync(path.join(basis, "public/fonts/poppins"), { recursive: true });
}

function meldung(ghsa, bereich, behobenIn, weiteres = {}) {
  return {
    ghsa_id: ghsa,
    severity: "high",
    summary: `Testmeldung ${ghsa}`,
    html_url: `https://example.invalid/${ghsa}`,
    vulnerabilities: [{ vulnerable_version_range: bereich, patched_versions: behobenIn }],
    ...weiteres,
  };
}

/* Alle Quellen leer, einzelne per Überschreibung befüllt. */
function meldungen(ueberschreibung = {}, { exifr = "7.1.3", leaflet = "1.9.4" } = {}) {
  const daten = {
    "repo:Leaflet/Leaflet": [],
    "repo:MikeKovarik/exifr": [],
    "repo:strukturag/libheif": [],
    "repo:strukturag/libde265": [],
    [`npm:leaflet@${leaflet}`]: [],
    [`npm:exifr@${exifr}`]: [],
    "npm-paket:leaflet": true,
    "npm-paket:exifr": true,
    ...ueberschreibung,
  };
  const p = path.join(basis, "meldungen.json");
  fs.writeFileSync(p, JSON.stringify(daten));
  return p;
}

function ausnahmen(liste) {
  const p = path.join(basis, "ausnahmen.json");
  fs.writeFileSync(p, JSON.stringify({ ausnahmen: liste }));
  return p;
}

function lauf({ meldungenPfad, ausnahmenPfad, heute = "2026-09-30", repo = basis } = {}) {
  try {
    const aus = execFileSync("node", [SKRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        FREMD_BASIS: repo,
        FREMD_MELDUNGEN: meldungenPfad,
        FREMD_AUSNAHMEN: ausnahmenPfad || path.join(basis, "keine-ausnahmen.json"),
        FREMD_HEUTE: heute,
      },
    });
    return { code: 0, aus, fehler: "" };
  } catch (e) {
    return { code: e.status, aus: e.stdout || "", fehler: e.stderr || "" };
  }
}

beforeEach(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "fremd-meldungen-"));
});

afterEach(() => {
  fs.rmSync(basis, { recursive: true, force: true });
});

describe("pruefe-fremd-meldungen: Grundfall", () => {
  test("keine Meldungen: grün, und es wurde wirklich etwas geprüft", () => {
    versionen();
    const r = lauf({ meldungenPfad: meldungen() });
    expect(r.code).toBe(0);
    expect(r.aus).toContain("Beobachtet: 4 Bibliotheksteile");
    expect(r.aus).toContain("libheif 1.23.5");
    expect(r.aus).toContain("libde265 1.1.3");
  });

  test("die echten VERSION-Dateien im Repository sind lesbar", () => {
    /* Fällt, sobald jemand eine VERSION-Datei so umschreibt, dass die Zeile
       mit der Version nicht mehr passt — sonst bräche erst der Nachtlauf. */
    const r = lauf({ meldungenPfad: meldungen(), repo: REPO });
    expect(r.fehler).toBe("");
    expect(r.code).toBe(0);
    expect(r.aus).toContain("Beobachtet: 4 Bibliotheksteile");
  });
});

describe("pruefe-fremd-meldungen: Versionsangaben der Hersteller", () => {
  test("Bereich schließt unsere Version ein: rot; nach der Reparatur: grün", () => {
    const m = { "repo:strukturag/libheif": [meldung("GHSA-a", "<= 1.23.2", "1.23.3")] };
    versionen({ libheif: "1.23.2" });
    const vorher = lauf({ meldungenPfad: meldungen(m) });
    expect(vorher.code).toBe(1);
    expect(vorher.aus).toContain("BETROFFEN  libheif 1.23.2  GHSA-a");

    versionen({ libheif: "1.23.5" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(0);
  });

  test("Schreibweise ohne Leerzeichen und mit 'v' wird gelesen", () => {
    const m = { "repo:strukturag/libde265": [meldung("GHSA-b", "<=1.1.1", "v1.1.2")] };
    versionen({ libde265: "1.1.1" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(1);
    versionen({ libde265: "1.1.3" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(0);
  });

  test("nur Untergrenze angegeben, Reparatur getrennt: danach nicht betroffen", () => {
    const m = { "repo:strukturag/libheif": [meldung("GHSA-c", ">= 1.20.0", "v1.23.1")] };
    versionen({ libheif: "1.21.0" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(1);
    versionen({ libheif: "1.23.5" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(0);
  });

  test("unsere Version liegt UNTER dem Bereich: der Fehler existierte noch nicht", () => {
    const m = { "repo:strukturag/libde265": [meldung("GHSA-d", ">= 1.0.16, <= 1.1.2", "1.1.3")] };
    versionen({ libde265: "1.0.15" });
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(0);
  });

  test("widersprüchlich (Bereich darunter, Reparatur darüber): unklar = rot", () => {
    const m = { "repo:strukturag/libheif": [meldung("GHSA-e", "1.17.0", "1.23.3")] };
    versionen({ libheif: "1.23.2" });
    const r = lauf({ meldungenPfad: meldungen(m) });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNKLAR  libheif 1.23.2  GHSA-e");
  });

  test("keine auswertbare Angabe: unklar = rot", () => {
    const m = {
      "repo:strukturag/libheif": [meldung("GHSA-f", "current main at b12b733; fixed version unknown", "")],
    };
    versionen();
    const r = lauf({ meldungenPfad: meldungen(m) });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNKLAR  libheif 1.23.5  GHSA-f");
  });

  test("G-03: nackte Fundversion unter unserer, ohne Reparatur: unklar = rot", () => {
    /* libheif schreibt "1.17.0" im Sinn von "gefunden in"; ohne Reparaturangabe
       lässt sich für eine spätere Version nichts ausschließen. */
    const m = { "repo:strukturag/libheif": [meldung("GHSA-k", "1.23.4", "")] };
    versionen({ libheif: "1.23.5" });
    const r = lauf({ meldungenPfad: meldungen(m) });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNKLAR  libheif 1.23.5  GHSA-k");
  });

  test("G-03: Reparatur in mehreren Linien — es zählt nur unsere Linie (Haupt- und Nebenversion)", () => {
    versionen({ libheif: "1.23.5" });
    /* Reparatur in 1.17.7 (fremde Linie) und 1.23.6 (unsere Linie, über uns): betroffen. */
    const betroffen = { "repo:strukturag/libheif": [meldung("GHSA-l", "<= 1.23.5", "1.17.7, 1.23.6")] };
    const r1 = lauf({ meldungenPfad: meldungen(betroffen) });
    expect(r1.code).toBe(1);
    expect(r1.aus).toContain("BETROFFEN  libheif 1.23.5  GHSA-l");
    /* Reparatur unserer Linie liegt auf oder unter uns: nicht betroffen. */
    const behoben = { "repo:strukturag/libheif": [meldung("GHSA-l", ">= 1.20.0", "1.17.7, 1.23.5")] };
    expect(lauf({ meldungenPfad: meldungen(behoben) }).code).toBe(0);
    /* Nur fremde Linien genannt, Bereich schließt uns ein: betroffen. */
    const fremd = { "repo:strukturag/libheif": [meldung("GHSA-l", "<= 1.23.5", "1.17.7, 1.22.9")] };
    expect(lauf({ meldungenPfad: meldungen(fremd) }).code).toBe(1);
  });

  test("Meldung ohne Einträge: unklar = rot", () => {
    const leer = { ...meldung("GHSA-g", "", ""), vulnerabilities: [] };
    versionen();
    expect(lauf({ meldungenPfad: meldungen({ "repo:strukturag/libheif": [leer] }) }).code).toBe(1);
  });

  test("zurückgezogene Meldung zählt nicht", () => {
    const m = {
      "repo:strukturag/libheif": [meldung("GHSA-h", "<= 1.23.5", "1.23.6", { withdrawn_at: "2026-09-01" })],
    };
    versionen();
    expect(lauf({ meldungenPfad: meldungen(m) }).code).toBe(0);
  });

  test("G-09: npm-Paket gibt es nicht — 2, nicht grün (eine leere Antwort hieße sonst 'sauber')", () => {
    versionen();
    const r = lauf({ meldungenPfad: meldungen({ "npm-paket:leaflet": false }) });
    expect(r.code).toBe(2);
    expect(r.fehler).toContain('npm-Paket "leaflet" gibt es nicht');
  });

  test("Treffer aus der npm-Datenbank zählt als betroffen", () => {
    const m = { "npm:leaflet@1.9.4": [meldung("GHSA-i", "< 1.9.5", "1.9.5")] };
    versionen();
    const r = lauf({ meldungenPfad: meldungen(m) });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("BETROFFEN  Leaflet 1.9.4  GHSA-i");
  });
});

describe("pruefe-fremd-meldungen: Ausnahmen", () => {
  const unklar = { "repo:strukturag/libheif": [meldung("GHSA-j", "current main", "")] };
  const eintrag = {
    ghsa: "GHSA-j",
    bibliothek: "libheif",
    version: "1.23.5",
    grund: "am Quelltext belegt",
    eingetragen: "2026-09-30",
    pruefen_bis: "2027-03-31",
  };

  test("gültige Ausnahme: grün, aber sichtbar ausgegeben", () => {
    versionen();
    const r = lauf({ meldungenPfad: meldungen(unklar), ausnahmenPfad: ausnahmen([eintrag]) });
    expect(r.code).toBe(0);
    expect(r.aus).toContain("[Ausnahme]");
    expect(r.aus).toContain("ausgenommen bis 2027-03-31");
  });

  test("abgelaufene Ausnahme: wieder rot", () => {
    versionen();
    const r = lauf({ meldungenPfad: meldungen(unklar), ausnahmenPfad: ausnahmen([eintrag]), heute: "2027-04-01" });
    expect(r.code).toBe(1);
  });

  test("Ausnahme für eine andere Bibliothek greift nicht", () => {
    versionen();
    const r = lauf({
      meldungenPfad: meldungen(unklar),
      ausnahmenPfad: ausnahmen([{ ...eintrag, bibliothek: "libde265" }]),
    });
    expect(r.code).toBe(1);
  });

  test("G-04: Ablaufdatum in anderer Schreibweise ist ungültig und läuft nicht ewig", () => {
    versionen();
    const r = lauf({
      meldungenPfad: meldungen(unklar),
      ausnahmenPfad: ausnahmen([{ ...eintrag, pruefen_bis: "31.12.2026" }]),
      heute: "2099-01-01",
    });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("AUSNAHME UNGUELTIG");
    expect(r.aus).not.toContain("[Ausnahme]");
  });

  test("G-04: unmögliches Datum (2027-02-30) ist ungültig", () => {
    versionen();
    const r = lauf({
      meldungenPfad: meldungen(unklar),
      ausnahmenPfad: ausnahmen([{ ...eintrag, pruefen_bis: "2027-02-30" }]),
    });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("AUSNAHME UNGUELTIG");
  });

  test("G-12: Ausnahme gilt nur für die Version, an der sie begründet ist", () => {
    versionen({ libheif: "1.23.6" });
    const r = lauf({ meldungenPfad: meldungen(unklar), ausnahmenPfad: ausnahmen([eintrag]) });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNKLAR  libheif 1.23.6  GHSA-j");
    expect(r.aus).not.toContain("[Ausnahme]");
  });

  test("Ausnahme ohne Begründung ist ungültig", () => {
    versionen();
    const r = lauf({
      meldungenPfad: meldungen(unklar),
      ausnahmenPfad: ausnahmen([{ ...eintrag, grund: "" }]),
    });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("AUSNAHME UNGUELTIG");
  });

  test("die echte Ausnahmeliste ist vollständig ausgefüllt", () => {
    const echt = JSON.parse(fs.readFileSync(path.join(REPO, ".github/fremd-meldungen-ausnahmen.json"), "utf8"));
    for (const a of echt.ausnahmen) {
      for (const feld of ["ghsa", "bibliothek", "version", "grund", "eingetragen", "pruefen_bis"]) {
        expect(a[feld]).toBeTruthy();
      }
      expect(a.pruefen_bis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("pruefe-fremd-meldungen: Deckung und Messfehler", () => {
  test("neuer Ordner unter public/lib ohne Beobachtung: rot", () => {
    versionen();
    fs.mkdirSync(path.join(basis, "public/lib/neu"), { recursive: true });
    const r = lauf({ meldungenPfad: meldungen() });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNGEDECKT  public/lib/neu");
  });

  test("G-13: einzeln abgelegte Datei unter public/lib ohne Beobachtung: rot", () => {
    versionen();
    fs.writeFileSync(path.join(basis, "public/lib/fremd-bibliothek.min.js"), "/* fremd */\n");
    const r = lauf({ meldungenPfad: meldungen() });
    expect(r.code).toBe(1);
    expect(r.aus).toContain("UNGEDECKT  public/lib/fremd-bibliothek.min.js");
  });

  test("G-13: die eigene Prüfsummen-Datei ist kein Fremdcode", () => {
    versionen();
    fs.writeFileSync(path.join(basis, "public/lib/PRUEFSUMMEN.json"), "{}\n");
    expect(lauf({ meldungenPfad: meldungen() }).code).toBe(0);
  });

  test("VERSION-Zeile nicht lesbar: 2, nicht grün", () => {
    versionen();
    fs.writeFileSync(path.join(basis, "public/lib/libheif/VERSION"), "libheif-js 1.23.2\n");
    const r = lauf({ meldungenPfad: meldungen() });
    expect(r.code).toBe(2);
    expect(r.fehler).toContain("MESSUNG NICHT DURCHFUEHRBAR");
  });

  test("Quelle fehlt (Abfrage gescheitert): 2, nicht grün", () => {
    versionen();
    const p = path.join(basis, "unvollstaendig.json");
    fs.writeFileSync(p, JSON.stringify({ "repo:Leaflet/Leaflet": [] }));
    expect(lauf({ meldungenPfad: p }).code).toBe(2);
  });
});
