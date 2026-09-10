// @vitest-environment node
/* PRIV-2026-09-10-01 (Ursache): Daten gespeichert, die der Datenschutztext
   nicht beschreibt.

   Zwei Zeilen lagen knapp vier Wochen 30 Tage im Diagnose-Speicher, waehrend
   der Text von einem Tag sprach — unentdeckt, weil der Infrastruktur-Waechter
   den Speicher-Filter nur mit sich selbst verglich, nie mit dem Text.

   Diese Pruefung verbindet beide Seiten:
   (a) Jede Zeilenart im Filter des 30-Tage-Speichers braucht einen Eintrag in
       fixtures/datenschutz-deckung.json mit einem Stichwort, das im
       Datenschutztext steht.
   (b) Jedes Feld, das die Diagnose-Endpunkte annehmen, braucht dort ebenfalls
       einen Eintrag mit Stichwort. Die Felder stehen in der Tabelle selbst;
       dass sie GENAU der `_freigabeliste` von handle-errors.js und
       handle-telemetry.js entsprechen und der Handler kein weiteres Feld
       liest, belegt functions/src/__tests__/diagnose-freigabeliste.test.js.
       Dort, nicht hier: Die Handler brauchen Server-Pakete (firebase-admin),
       die der Frontend-Job der Pipeline nicht installiert (10.09.2026: lokal
       gruen, in der Pipeline "Cannot find module").

   Ein neuer Filter-Eintrag, ein neues Feld oder ein gestrichener Satz im Text
   macht diese Pruefung rot. GRENZE: Das Stichwort muss irgendwo im Text
   stehen, nicht in einem bestimmten Abschnitt.

   ENGLISCHE FASSUNG: Dieselben Stichwoerter, uebersetzt (`en` je Zeilenart,
   `stichwortEn` je Feld-Stichwort), muessen im englischen Text stehen. Eine
   fehlende Uebersetzung ist rot. Der Ausnahmeweg, der die englische Seite
   bis zur Freigabe des deutschen Textes offen liess, ist seit 10.09.2026
   geschlossen. */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const lies = (pfad) => readFileSync(join(WURZEL, pfad), "utf8");

/* Verglichen wird der sichtbare Text, nicht der Quelltext: Tags, Kommentare,
   Zeilenumbrueche und die Schreibweise von Umlauten (&auml; oder ä) sind
   Formatierung, keine Aussage. Dieselbe Umwandlung gilt fuer die Stichwoerter,
   damit sie in beiden Schreibweisen in der Tabelle stehen duerfen. */
const glatt = (text) => text.replace(/\s+/g, " ").trim();
const seitentext = (pfad) => glatt(new JSDOM(lies(pfad)).window.document.body.textContent);
const klartext = (stichwort) => glatt(JSDOM.fragment(stichwort).textContent);

const DECKUNG = JSON.parse(lies("public/__tests__/fixtures/datenschutz-deckung.json"));
const TEXT_DE = seitentext("public/datenschutz.html");
const TEXT_EN = seitentext("public/en/privacy.html");

/* Die EINE Soll-Definition des 30-Tage-Filters: `DIAG_SOLL` im
   Infrastruktur-Waechter. Gegen genau diesen Wert wird vor jeder Auslieferung
   der echte Speicher-Filter gemessen. */
function leseSoll(skript, variable) {
  return [...lies(skript).matchAll(new RegExp(`^${variable}='([^']*)'$`, "gm"))].map((t) => t[1]);
}

function zeilenarten(filter) {
  return filter.split(" OR ").map((klausel) => {
    const m = /^jsonPayload\.(?:type|step)="([a-z0-9-]+)"$/.exec(klausel.trim());
    if (!m) throw new Error(`Filter-Klausel nicht lesbar: ${klausel}`);
    return m[1];
  });
}

const SOLL = leseSoll("scripts/verify-infrastructure.sh", "DIAG_SOLL");
const ARTEN = SOLL.length === 1 ? zeilenarten(SOLL[0]) : [];

const FREIGABE = {
  "handle-errors": Object.keys(DECKUNG.felder["handle-errors"] || {}),
  "handle-telemetry": Object.keys(DECKUNG.felder["handle-telemetry"] || {}),
};

describe("(a) 30-Tage-Speicher: jede Zeilenart steht im Datenschutztext", () => {
  /* Messmittel-Kontrolle: Findet der Leser die Soll-Definition nicht, waere
     jede Pruefung darunter leer und damit wertlos gruen. */
  test("die Soll-Definition steht genau einmal da und ist lesbar", () => {
    expect(SOLL).toHaveLength(1);
    expect(ARTEN).toContain("client-error");
    expect(ARTEN).toContain("minor-safety");
  });

  test("das Einrichtungsskript setzt denselben Filter wie die Soll-Definition", () => {
    expect(leseSoll("scripts/log-sink-analyse-zeilen.sh", "FILTER")).toEqual(SOLL);
  });

  test("der Seitentext ist lesbar (Messmittel-Kontrolle)", () => {
    expect(TEXT_DE).toContain("Datenschutz");
    expect(TEXT_DE).not.toContain("&auml;");
  });

  test.each(ARTEN)("%s: Eintrag in der Zuordnungstabelle, Stichwort im deutschen Text", (art) => {
    const eintrag = DECKUNG.zeilenarten[art];
    expect(eintrag, `Zeilenart ${art} fehlt in fixtures/datenschutz-deckung.json`).toBeDefined();
    expect(eintrag.de, `Zeilenart ${art}: deutsches Stichwort leer`).toBeTruthy();
    expect(
      TEXT_DE.includes(klartext(eintrag.de)),
      `Stichwort fuer ${art} fehlt in datenschutz.html: ${klartext(eintrag.de)}`
    ).toBe(true);
  });
});

describe("(b) Diagnose-Endpunkte: jedes angenommene Feld steht im Datenschutztext", () => {
  test("die Feldlisten der Tabelle sind gelesen (Messmittel-Kontrolle)", () => {
    expect(FREIGABE["handle-errors"]).toContain("traceId");
    expect(FREIGABE["handle-telemetry"]).toContain("meta.subject");
  });

  test("der Sammelsatz fuer zusammengefasste Felder steht im deutschen Text", () => {
    expect(
      TEXT_DE.includes(klartext(DECKUNG.zusammengefasstUnter)),
      `Sammelsatz fehlt in datenschutz.html: ${DECKUNG.zusammengefasstUnter}`
    ).toBe(true);
  });

  for (const [handler, felder] of Object.entries(FREIGABE)) {
    test.each(felder)(`${handler}: %s`, (feld) => {
      const stichwort = DECKUNG.felder[handler]?.[feld];
      expect(stichwort, `${handler}.${feld} fehlt in fixtures/datenschutz-deckung.json`).toBeTruthy();
      /* "zusammengefasst" ist durch den Sammelsatz-Test oben gedeckt. */
      if (stichwort === "zusammengefasst") return;
      expect(
        TEXT_DE.includes(klartext(stichwort)),
        `Stichwort fuer ${handler}.${feld} fehlt in datenschutz.html: ${klartext(stichwort)}`
      ).toBe(true);
    });
  }
});

describe("englische Fassung", () => {
  test("der englische Seitentext ist lesbar (Messmittel-Kontrolle)", () => {
    expect(TEXT_EN.toLowerCase()).toContain("privacy");
    expect(TEXT_EN).not.toContain("&nbsp;");
  });

  test.each(ARTEN)("%s: Stichwort im englischen Text", (art) => {
    const en = DECKUNG.zeilenarten[art]?.en;
    expect(en, `Zeilenart ${art}: englisches Stichwort fehlt`).toBeTruthy();
    expect(TEXT_EN.includes(klartext(en)), `Stichwort fuer ${art} fehlt in en/privacy.html: ${klartext(en)}`).toBe(
      true
    );
  });

  test("der Sammelsatz steht im englischen Text", () => {
    expect(
      TEXT_EN.includes(klartext(DECKUNG.zusammengefasstUnterEn)),
      `Sammelsatz fehlt in en/privacy.html: ${DECKUNG.zusammengefasstUnterEn}`
    ).toBe(true);
  });

  for (const [handler, felder] of Object.entries(FREIGABE)) {
    test.each(felder)(`${handler} (EN): %s`, (feld) => {
      const stichwort = DECKUNG.felder[handler]?.[feld];
      /* Dass es ueberhaupt einen Eintrag gibt, prueft der deutsche Teil. */
      if (!stichwort || stichwort === "zusammengefasst") return;
      const en = DECKUNG.stichwortEn?.[stichwort];
      expect(en, `Uebersetzung fuer "${stichwort}" fehlt in stichwortEn`).toBeTruthy();
      expect(TEXT_EN.includes(klartext(en)), `Stichwort fuer ${handler}.${feld} fehlt in en/privacy.html: ${en}`).toBe(
        true
      );
    });
  }
});
