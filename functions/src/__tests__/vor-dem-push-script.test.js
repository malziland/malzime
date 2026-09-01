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
  "npm ci --prefix functions": "Installation, keine Prüfung",
  "npm test": "Backend-Suite, läuft lokal so lang wie in der Pipeline (~2,5 min)",
  "npm run test:e2e": "E2E-Suite, dito (~3,5 min) — beides deckt scripts/pruefstand.sh ab",
  /* Die Mutationsprobe setzt je geaenderter Zeile eine Aenderung und laesst
     dafuer Tests laufen. Gemessen am 01.09.2026: Sekunden bei Modulen am
     Rand, ueber anderthalb Minuten je Mutation bei zentralen Dateien, an
     denen 18 Testdateien haengen. In der Pipeline laeuft sie neben den langen
     Suiten; vor dem Push wuerde sie aus 13 Sekunden Minuten machen — und eine
     Vorabpruefung, die Minuten braucht, wird umgangen. */
  "node scripts/pruefe-mutationen.mjs --zeitgrenze=3":
    "Mutationsprobe, Minuten statt Sekunden — laeuft im Job test-backend, " +
    "weil sie dort installierte Pakete vorfindet",
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
    /* BEFUND 31.08.2026 (Runde 3): Hier stand eine feste Liste mit drei
       Job-Namen. Als `secret-scan` ergaenzt wurde — ein echter Pflicht-Check —
       wurde der Test rot, obwohl die Ergaenzung richtig war. Eine Kopie der
       Pipeline-Namen im Test veraltet zwangslaeufig. Jetzt kommen sie aus der
       Pipeline-Datei selbst. */
    const ci = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".github", "workflows", "ci.yml"), "utf8");
    const ciJobs = [...ci.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(([, name]) => name);
    expect(ciJobs.length).toBeGreaterThan(3);
    const unbekannt = aufrufe
      .filter(([, , job]) => !ciJobs.includes(job))
      .map(([, beschreibung, job]) => `${beschreibung} → "${job}"`);
    expect(unbekannt).toEqual([]);
  });

  /* BEFUND 01.09.2026 (Pruefrunde 8, M-P2-4): Der Test darueber prueft nur
     EINE Richtung — dass jeder Schritt aus ci.yml auch im Skript steht.
     Entfernt jemand einen Schritt AUS ci.yml, ist die Bedingung trivial
     erfuellt, und nichts wird rot. Gemessen: `audit-gate.mjs`, `test-blind.py`
     und `format:check` liessen sich einzeln entfernen, die ganze Kette blieb
     gruen ("Alles gruen in 13 s", 27 ok-Schritte).

     Die Gegenrichtung schliesst das: Was das lokale Skript prueft, muss auch
     in der Pipeline laufen. Sonst prueft man vor dem Push etwas, das die
     Auslieferung gar nicht mehr verlangt. */
  test("jeder Schritt des Skripts steht auch in der Pipeline", () => {
    const yml = fs.readFileSync(WORKFLOW, "utf8");
    const skript = fs.readFileSync(SKRIPT, "utf8");

    /* Die `lauf`-Zeilen des Skripts nennen den Befehl ab dem dritten Feld. */
    const werkzeuge = new Set();
    for (const zeile of skript.split("\n")) {
      const m = zeile.match(/^lauf\s+"[^"]*"\s+"[^"]*"\s+(.+)$/);
      if (!m) continue;
      const name = m[1].match(/[\w./-]+\.(mjs|py|sh)|lint:frontend|format:check/);
      if (name) werkzeuge.add(name[0].replace(/^.*\//, ""));
    }
    expect(werkzeuge.size).toBeGreaterThan(8);

    /* Was lokal anders heisst als in der Pipeline, aber dasselbe prueft.
       Jeder Eintrag braucht den Beleg, WO die Pipeline es abdeckt. */
    const ANDERS_BENANNT = {
      "secret-scan-lokal.sh":
        "Die Pipeline hat dafuer den eigenen Job `secret-scan` mit der " +
        "gitleaks-Action (ci.yml:123-131) — ein Pflicht-Check. Lokal laeuft " +
        "die schnelle Variante ueber dasselbe Werkzeug.",
    };
    const fehlend = [...werkzeuge].filter((w) => !ANDERS_BENANNT[w]).filter((w) => !yml.includes(w));
    expect({
      hinweis: "diese Pruefungen laufen lokal, aber NICHT in der Pipeline",
      fehlend,
    }).toEqual({
      hinweis: "diese Pruefungen laufen lokal, aber NICHT in der Pipeline",
      fehlend: [],
    });
  });
});
