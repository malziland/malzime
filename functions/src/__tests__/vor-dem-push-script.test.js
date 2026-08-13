const fs = require("fs");
const path = require("path");

/**
 * Wächter für scripts/vor-dem-push.sh.
 *
 * Das Skript fährt die billigen Prüfungen der Pipeline lokal ab, damit ein
 * vergessener Formatlauf nicht erst nach dreieinhalb Minuten Wartezeit
 * auffällt. Sein einziger Wert liegt in der Deckungsgleichheit: Kommt in der
 * Pipeline ein Schritt dazu und hier nicht, ist das Skript ab dann eine
 * Beruhigungspille — es sagt „alles grün" für etwas, das es nicht mehr prüft.
 *
 * Genau diese Fehlerklasse ist in diesem Projekt schon aufgetreten
 * (`DOC-2026-08-12-07`): Ein Wächter prüfte die EXISTENZ eines CI-Jobs, nicht
 * die ZUORDNUNG — und blieb grün, während die Zuordnung falsch war.
 *
 * Reine Textanalyse beider Dateien. Kein Netz, kein Lauf, keine Schreibzugriffe.
 */

const WURZEL = path.join(__dirname, "../../..");
const WORKFLOW = path.join(WURZEL, ".github/workflows/ci.yml");
const SKRIPT = path.join(WURZEL, "scripts/vor-dem-push.sh");

/* Diese Schritte gehören bewusst NICHT ins lokale Skript. Jeder mit Grund —
   eine Ausnahme, die man nicht liest, ist ein Loch. */
const BEWUSST_DRAUSSEN = {
  "npm ci": "Installation, keine Prüfung",
  "npm test": "Backend-Suite, läuft lokal so lang wie in der Pipeline (~2,5 min)",
  "npm run test:e2e": "E2E-Suite, dito (~3,5 min) — beides deckt scripts/pruefstand.sh ab",
};

/** Alle `- run:`-Schritte der drei billigen Jobs aus der Workflow-Datei. */
function billigeSchritte() {
  const yml = fs.readFileSync(WORKFLOW, "utf8");
  const zeilen = yml.split("\n");
  const jobs = ["test-frontend:", "test-backend:", "pruefungen:"];
  const schritte = [];
  let inJob = false;

  for (const zeile of zeilen) {
    const jobKopf = zeile.match(/^ {2}([a-z-]+):\s*$/);
    if (jobKopf) {
      inJob = jobs.includes(`${jobKopf[1]}:`);
      continue;
    }
    if (!inJob) continue;
    const run = zeile.match(/^\s+- run:\s+(.+?)\s*$/);
    if (run) schritte.push(run[1]);
  }
  return schritte;
}

describe("vor-dem-push.sh deckt die billigen Pipeline-Schritte ab", () => {
  test("die Workflow-Datei liefert überhaupt Schritte", () => {
    /* Positivkontrolle für die Messung selbst: Findet das Auslesen nichts,
       ist nicht die Abdeckung in Ordnung, sondern der Test blind. */
    expect(billigeSchritte().length).toBeGreaterThan(8);
  });

  test("jeder billige Schritt der Pipeline steht auch im Skript", () => {
    const skript = fs.readFileSync(SKRIPT, "utf8");
    const fehlend = [];

    for (const schritt of billigeSchritte()) {
      if (BEWUSST_DRAUSSEN[schritt]) continue;

      /* Der Vergleich läuft über den Kern des Befehls, nicht über die ganze
         Zeile: Das Skript ruft `npm run --silent lint:frontend` statt
         `npm run lint:frontend` und wechselt für die Backend-Schritte das
         Verzeichnis. */
      const kern = schritt
        .replace(/^npm run\s+/, "")
        .replace(/^node\s+\.\.\//, "")
        .replace(/^node\s+/, "")
        .replace(/^python3\s+/, "")
        .replace(/^sh\s+/, "")
        .replace(/\s+\.$/, "")
        .trim();

      if (!skript.includes(kern)) fehlend.push(`${schritt}  (gesucht: "${kern}")`);
    }

    /* Jest kennt keine Zusatz-Meldung an expect() — der Hinweis steht deshalb
       IM erwarteten Wert, damit er im Fehlschlag sichtbar ist. */
    expect({
      hinweis: "fehlende Schritte aufnehmen oder mit Grund in BEWUSST_DRAUSSEN eintragen",
      fehlend,
    }).toEqual({
      hinweis: "fehlende Schritte aufnehmen oder mit Grund in BEWUSST_DRAUSSEN eintragen",
      fehlend: [],
    });
  });

  test("jede Ausnahme trägt eine Begründung", () => {
    for (const [schritt, grund] of Object.entries(BEWUSST_DRAUSSEN)) {
      expect({ schritt, typ: typeof grund }).toEqual({ schritt, typ: "string" });
      expect({ schritt, langGenug: grund.length > 10 }).toEqual({ schritt, langGenug: true });
    }
  });

  test("jeder Schritt nennt den Pipeline-Job, der ohne ihn rot würde", () => {
    /* Ohne diese Angabe muss man raten, wo es in der Pipeline knallt. */
    const skript = fs.readFileSync(SKRIPT, "utf8");
    const aufrufe = [...skript.matchAll(/^lauf "([^"]+)" "([^"]+)"/gm)];
    expect(aufrufe.length).toBeGreaterThan(8);
    const unbekannt = aufrufe
      .filter(([, , job]) => !["test-frontend", "test-backend", "pruefungen"].includes(job))
      .map(([, beschreibung, job]) => `${beschreibung} → "${job}"`);
    expect(unbekannt).toEqual([]);
  });
});
