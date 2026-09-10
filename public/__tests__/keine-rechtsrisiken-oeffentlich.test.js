/**
 * keine-rechtsrisiken-oeffentlich.test.js — Abwaegungen ueber Rechtsrisiken
 * gehoeren nicht in oeffentliche Dateien.
 *
 * ANLASS (08.09.2026): Die Patentlage des HEIC-Formats (HEVC) stand samt
 * "Betreiberentscheidung: Das Risiko wird getragen" in docs/SECURITY-MODEL.md
 * und THIRD-PARTY.md — im oeffentlichen Repository. Ein solcher Text hilft im
 * Streitfall der Gegenseite. Transparenz schulden wir bei Datenschutz und
 * Lizenzen (Pflichtangaben), nicht bei der eigenen Risikoabwaegung. Die gehoert
 * in docs/handover/ (nicht im Repository) oder nirgendwohin.
 *
 * Geprueft werden alle oeffentlichen Texte: Doku, README, THIRD-PARTY,
 * CHANGELOG, Website, eigener Code, Sprachdateien. Ausgenommen: fremde
 * Lizenztexte (public/lib, public/fonts — dort ist "PATENT" Teil der Lizenz),
 * docs/handover (privat), docs/audit (privat und gitignoriert — der Test
 * unten haelt fest, dass es so bleibt) und Testdateien (Positivkontrolle
 * unten).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MUSTER = /patent|rechtsrisiko|risiko wird getragen|haftungsrisiko|risk is (accepted|borne)/i;
const AUSGENOMMEN = [
  /^docs\/handover\//,
  /^docs\/audit\//,
  /^public\/lib\//,
  /^public\/fonts\//,
  /__tests__\//,
  /node_modules/,
];

function dateien(wurzel, endungen) {
  const raus = [];
  for (const name of readdirSync(wurzel)) {
    const voll = join(wurzel, name);
    const rel = relative(REPO, voll);
    if (AUSGENOMMEN.some((m) => m.test(rel))) continue;
    if (statSync(voll).isDirectory()) raus.push(...dateien(voll, endungen));
    else if (endungen.some((e) => name.endsWith(e))) raus.push(rel);
  }
  return raus;
}

const OEFFENTLICH = [
  ...dateien(join(REPO, "docs"), [".md"]),
  ...["README.md", "THIRD-PARTY.md", "CHANGELOG.md", "TRADEMARKS.md"].filter((f) => {
    try {
      return statSync(join(REPO, f)).isFile();
    } catch (_) {
      return false;
    }
  }),
  ...dateien(join(REPO, "public"), [".html", ".js", ".json", ".txt"]),
  ...dateien(join(REPO, "functions", "src"), [".js"]),
];

describe("Rechtsrisiko-Abwaegungen stehen in keiner oeffentlichen Datei", () => {
  it("es gibt Dateien zu pruefen (Messmittel-Probe)", () => {
    expect(OEFFENTLICH.length).toBeGreaterThan(50);
    expect(OEFFENTLICH).toContain("docs/SECURITY-MODEL.md");
    expect(OEFFENTLICH).toContain("THIRD-PARTY.md");
  });

  it("docs/audit/ ist wirklich gitignoriert — sonst waere die Ausnahme ein Loch", () => {
    /* Die Audit-Berichte bleiben privat (docs/audit/, nicht im Repository).
       Nur deshalb duerfen sie hier fehlen. Faellt die Ignorier-Regel weg,
       muss dieser Test rot werden, bevor ein Bericht oeffentlich wird. */
    const regeln = readFileSync(join(REPO, ".gitignore"), "utf8")
      .split("\n")
      .map((z) => z.trim());
    expect(regeln).toContain("docs/audit/");
  });

  it("das Muster erkennt den Text vom 08.09.2026 (Positivkontrolle)", () => {
    expect(MUSTER.test("Betreiberentscheidung: Das Risiko wird getragen")).toBe(true);
    expect(MUSTER.test("dessen Verfahren patentiert sind")).toBe(true);
    expect(MUSTER.test("Lizenz: GNU Lesser General Public License")).toBe(false);
  });

  it.each(OEFFENTLICH)("%s", (rel) => {
    const text = readFileSync(join(REPO, rel), "utf8");
    const treffer = text.split("\n").filter((z) => MUSTER.test(z));
    expect(treffer, `Rechtsrisiko-Formulierung in ${rel} — gehoert nach docs/handover/, nicht ins Repository`).toEqual(
      []
    );
  });
});
