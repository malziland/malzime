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

  /* DOC-2026-08-13-FE-09: Die Upload-Obergrenze steht an fünf Stellen ohne
     kanonische Quelle (config.js, api.js, beide Locales, index.html). Aktuell
     deckungsgleich — dieser Wächter hält sie es. Kanonisch ist MAX_UPLOAD_BYTES
     in config.js; alle nutzersichtbaren „… MB"-Angaben müssen dieselbe MB-Zahl
     nennen. */
  test("die Upload-Obergrenze ist an allen fünf Stellen dieselbe MB-Zahl", () => {
    const bytes = lies("functions/src/config.js").match(/MAX_UPLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(bytes).not.toBeNull();
    const mb = Number(bytes[1]);

    // Frontend-Konstante (api.js): dieselbe Byte-Rechnung.
    const apiMb = lies("public/js/api.js").match(/file\.size\s*>\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(apiMb).not.toBeNull();
    expect(Number(apiMb[1])).toBe(mb);

    // Nutzersichtbare Texte: jede „… MB"-Angabe im Upload-Kontext nennt dieselbe Zahl.
    const quellen = ["public/index.html", "public/locales/de.json", "public/locales/en.json"];
    const abweichend = [];
    for (const q of quellen) {
      const zahlen = [...lies(q).matchAll(/(\d+)\s*MB/g)].map((m) => Number(m[1]));
      for (const z of zahlen) if (z !== mb) abweichend.push(`${q}: ${z} MB statt ${mb}`);
    }
    expect(abweichend).toEqual([]);
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

  /* DOC-2026-08-12-07: Die Matrix nannte einen CI-Job `aussentext`, den es nie
     gab — der Job hieß von Anfang an anders. Ein Nachweis, der auf einen Job
     zeigt, den niemand finden kann, ist kein Nachweis, sondern eine Fußnote.
     Das ist maschinell entscheidbar, also entscheidet es ab jetzt eine
     Maschine. */
  test("jeder in der Verifikationsmatrix genannte CI-Job existiert auch", () => {
    const matrix = lies("docs/VERIFICATION.md");
    const ci = lies(".github/workflows/ci.yml");

    /* Job-Namen stehen in ci.yml auf genau zwei Einrückungsebenen tief unter
       `jobs:` — Schlüssel wie `push:` oder `schedule:` stehen unter `on:` und
       kommen hier nicht vor, weil erst ab der Zeile `jobs:` gelesen wird. */
    const abJobs = ci.slice(ci.indexOf("\njobs:"));
    const echte = new Set([...abJobs.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]));
    const genannt = new Set([...matrix.matchAll(/CI-Job `([a-z][a-z0-9-]*)`/g)].map((m) => m[1]));

    /* Positivkontrollen: Ohne sie wäre der Test auch grün, wenn eine der
       beiden Suchen ins Leere liefe — dann verglichen wir zwei leere Mengen
       und nennten das Übereinstimmung. */
    expect(echte.size).toBeGreaterThan(3);
    expect(genannt.size).toBeGreaterThan(3);

    expect([...genannt].filter((j) => !echte.has(j))).toEqual([]);
  });

  /* KURZAUDIT 2026-08-13, Rückfall von DOC-2026-08-12-07: Die Korrektur der
     Matrix hat das audit-gate dem falschen Job zugeschrieben — und der Test
     darüber konnte das nicht sehen, weil er nur prüft, OB ein genannter Job
     existiert. Ein Test auf "X existiert" ersetzt keinen Test auf "X gehört
     zu Y". Deshalb hier die Zuordnung: Jede Prüfskript-Datei, die eine
     Matrixzelle einem CI-Job zuschreibt, muss im Block genau dieses Jobs
     auftauchen. */
  test("jede einem CI-Job zugeschriebene Prüfskript-Datei läuft auch in diesem Job", () => {
    const matrix = lies("docs/VERIFICATION.md");
    const ci = lies(".github/workflows/ci.yml");

    /* ci.yml in Job-Blöcke zerlegen (Namen auf Einrückungstiefe 2 unter jobs:). */
    const abJobs = ci.slice(ci.indexOf("\njobs:"));
    const bloecke = {};
    let aktuell = null;
    for (const zeile of abJobs.split("\n")) {
      const kopf = zeile.match(/^ {2}([a-z][a-z0-9-]*):$/);
      if (kopf) {
        aktuell = kopf[1];
        bloecke[aktuell] = "";
      } else if (aktuell) {
        bloecke[aktuell] += zeile + "\n";
      }
    }

    /* Tabellenzellen mit "CI-Job `name`": darin genannte Skript-Dateinamen
       müssen im Block dieses Jobs vorkommen. Verglichen wird der Basisname —
       die Matrix nennt den lokalen Aufruf, die CI läuft teils aus einem
       Unterverzeichnis mit ../-Pfaden. */
    const fehlzuordnungen = [];
    for (const zelle of matrix.split("|")) {
      const job = zelle.match(/CI-Job `([a-z][a-z0-9-]*)`/);
      if (!job || !(job[1] in bloecke)) continue;
      const skripte = zelle.match(/[\w./-]+\.(?:mjs|sh|py)\b/g) || [];
      for (const s of skripte) {
        const basis = s.split("/").pop();
        if (!bloecke[job[1]].includes(basis)) {
          fehlzuordnungen.push(`${basis} ist ${job[1]} zugeschrieben, läuft dort aber nicht`);
        }
      }
    }

    /* Positivkontrolle: Mindestens eine Zuordnung muss gefunden worden sein,
       sonst prüft der Test gegen die leere Menge. */
    const zuordnungen = (matrix.match(/CI-Job `[a-z][a-z0-9-]*`[^|]*\.(?:mjs|sh|py)\b/g) || []).length;
    expect(zuordnungen).toBeGreaterThan(0);

    expect(fehlzuordnungen).toEqual([]);
  });
});
