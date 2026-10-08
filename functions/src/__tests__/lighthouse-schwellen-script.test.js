const fs = require("fs");
const path = require("path");

/**
 * Wächter für die Schwellen des Lighthouse-Laufs (OPS-2026-10-03-19).
 *
 * Der Job `lighthouse` der Pipeline misst nach jedem Push auf main die
 * ausgelieferte Seite. Vom ersten Tag an bis zum 07.10.2026 prüfte er dabei
 * nichts: Die Datei hinter `budgetPath` hatte ein Format, das das Werkzeug
 * ablehnt, und die Action wertet diesen Fehlschlag nicht aus — der Schritt
 * blieb grün, was immer gemessen wurde.
 *
 * Die Schwellen stehen jetzt als Zusicherungen in `.github/lighthouserc.json`.
 * Dieser Test hält fest, dass der Job sie auch wirklich bekommt und dass jede
 * der vier Wertungen eine Schwelle der Stufe „error" hat — nur die macht den
 * Schritt rot. Reine Textanalyse; den Lauf selbst (Netz, Browser) fährt die
 * Pipeline.
 */

const WURZEL = path.join(__dirname, "../../..");
const CI = fs.readFileSync(path.join(WURZEL, ".github/workflows/ci.yml"), "utf8");
const DATEI = ".github/lighthouserc.json";
const WERTUNGEN = ["performance", "accessibility", "best-practices", "seo"];

/** Der Block des Jobs `lighthouse` aus ci.yml, ohne Kommentarzeilen. */
function lighthouseJob() {
  const zeilen = CI.split("\n").filter((zeile) => !/^\s*#/.test(zeile));
  const anfang = zeilen.findIndex((zeile) => /^ {2}lighthouse:\s*$/.test(zeile));
  if (anfang < 0) return "";
  const ende = zeilen.findIndex((zeile, i) => i > anfang && /^ {2}[a-z0-9-]+:\s*$/.test(zeile));
  return zeilen.slice(anfang, ende < 0 ? undefined : ende).join("\n");
}

/** Alle Zusicherungen der Datei: je Wertung die Liste [Stufe, Schwelle]. */
function zusicherungen() {
  const rc = JSON.parse(fs.readFileSync(path.join(WURZEL, DATEI), "utf8"));
  const assert = rc.ci.assert;
  const bloecke = [assert.assertions || {}, ...(assert.assertMatrix || []).map((eintrag) => eintrag.assertions || {})];
  const jeWertung = {};
  for (const block of bloecke) {
    for (const [schluessel, wert] of Object.entries(block)) {
      const name = schluessel.replace(/^categories:/, "");
      const [stufe, optionen] = Array.isArray(wert) ? wert : [wert, {}];
      (jeWertung[name] = jeWertung[name] || []).push({ stufe, minScore: (optionen || {}).minScore });
    }
  }
  return jeWertung;
}

describe("Lighthouse-Lauf der Pipeline: die Schwellen werden wirklich geprüft", () => {
  test("der Job bekommt die Datei mit den Zusicherungen — nicht mehr die Budget-Datei", () => {
    const job = lighthouseJob();
    /* Positivkontrolle: Der Job wird gelesen. */
    expect(job).toMatch(/uses: treosh\/lighthouse-ci-action@[0-9a-f]{40}/);
    expect(job).toMatch(new RegExp(`^\\s+configPath: ${DATEI.replace(/\./g, "\\.")}$`, "m"));
    /* Mit `budgetPath` wertet die Action die Zusicherungen der Datei gar nicht
       aus — sie nimmt dann nur das Budget. */
    expect(job).not.toMatch(/budgetPath/);
  });

  test("jede der vier Wertungen hat eine Schwelle der Stufe error", () => {
    const jeWertung = zusicherungen();
    for (const wertung of WERTUNGEN) {
      const harte = (jeWertung[wertung] || []).filter((z) => z.stufe === "error");
      expect({ wertung, harteSchwellen: harte.length }).toEqual({ wertung, harteSchwellen: 1 });
      /* Lighthouse wertet von 0 bis 1. Eine Schwelle von 0 prüfte nichts, eine
         über 1 wäre nie erfüllbar. */
      expect({ wertung, inGrenzen: harte[0].minScore > 0 && harte[0].minScore <= 1 }).toEqual({
        wertung,
        inGrenzen: true,
      });
    }
  });

  test("Barrierefreiheit, Best Practices und SEO: unter 100 wird der Schritt rot", () => {
    const jeWertung = zusicherungen();
    for (const wertung of ["accessibility", "best-practices", "seo"]) {
      expect({ wertung, schwellen: jeWertung[wertung] }).toEqual({
        wertung,
        schwellen: [{ stufe: "error", minScore: 1 }],
      });
    }
  });

  test("Performance: rot unter 80, Warnung unter 90 — die Warnung ersetzt die harte Schwelle nicht", () => {
    const stufen = Object.fromEntries(zusicherungen().performance.map((z) => [z.stufe, z.minScore]));
    expect(stufen).toEqual({ error: 0.8, warn: 0.9 });
  });

  test("gemessen wird jede Seite dreimal", () => {
    const rc = JSON.parse(fs.readFileSync(path.join(WURZEL, DATEI), "utf8"));
    expect(rc.ci.collect.numberOfRuns).toBe(3);
  });

  test("die Datei im abgelehnten Format gibt es nicht mehr", () => {
    expect(fs.existsSync(path.join(WURZEL, ".github/lighthouse-budget.json"))).toBe(false);
  });
});
