const fs = require("fs");
const path = require("path");

/**
 * Drift-Wächter für die Dokumentation (Konzept „Richtung 100", 2026-08-12).
 *
 * Die Doku-Bereinigung vom 2026-08-12 (Codex-Konsens, PR #107) hat feste
 * Testzahlen aus dem README entfernt und die Verifikationsmatrix als
 * datierten Prüfstand gerahmt. Dieser Test sorgt dafür, dass diese Ordnung
 * nicht schleichend zurückdriftet:
 *
 *  1. Das README darf keine festen Testzahlen mehr behaupten — der
 *     verbindliche Stand ist der letzte CI-Lauf.
 *  2. Interne Markdown-Links (README + docs/) müssen auf existierende
 *     Dateien zeigen — tote Verweise sind genau die Drift, die ein
 *     öffentliches Repo unglaubwürdig macht.
 *  3. Die drei Suiten-Zeilen der Verifikationsmatrix müssen datiert sein
 *     (Format des Stemplers scripts/pruefstand.sh).
 *
 * Reine Textanalyse — kein Netzwerk, keine Cloud.
 */

const WURZEL = path.join(__dirname, "../../..");

function lies(datei) {
  return fs.readFileSync(path.join(WURZEL, datei), "utf8");
}

describe("Doku-Drift-Wächter", () => {
  test("README behauptet keine festen Testzahlen", () => {
    const treffer = lies("README.md").match(/\b\d+\s+Tests?\b/g) || [];
    expect(treffer).toEqual([]);
  });

  test("interne Markdown-Links in README und docs/ zeigen auf existierende Dateien", () => {
    const dateien = ["README.md"].concat(
      fs
        .readdirSync(path.join(WURZEL, "docs"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => path.join("docs", name))
    );

    const tote = [];
    for (const datei of dateien) {
      const inhalt = lies(datei);
      /* [Text](ziel) — nur relative Datei-Links; http(s), mailto und
         reine Anker (#…) sind nicht unsere Baustelle. */
      for (const treffer of inhalt.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const ziel = treffer[1];
        if (/^(https?:|mailto:|#)/.test(ziel)) continue;
        const ohneAnker = ziel.split("#")[0];
        if (!ohneAnker) continue;
        const aufgeloest = path.resolve(WURZEL, path.dirname(datei), ohneAnker);
        if (!fs.existsSync(aufgeloest)) tote.push(`${datei} → ${ziel}`);
      }
    }
    expect(tote).toEqual([]);
  });

  test("die drei Suiten-Zeilen der Verifikationsmatrix sind datiert (Stempler-Format)", () => {
    const matrix = lies("docs/VERIFICATION.md");
    for (const zeile of ["Backend-Unit-Tests", "Frontend-Unit-Tests", "E2E kritischster Nutzerfluss"]) {
      const muster = new RegExp(`\\| ${zeile}[^\\n]*\\d{4}-\\d{2}-\\d{2}[^\\n]*\\|`);
      expect(matrix).toMatch(muster);
    }
  });
});
