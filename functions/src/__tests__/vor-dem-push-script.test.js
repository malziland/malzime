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

/* Diese Schritte der billigen Jobs gehören bewusst NICHT ins lokale Skript.
   Jeder mit Grund — eine Ausnahme, die man nicht liest, ist ein Loch. Und
   jeder Eintrag muss einen Schritt nennen, den es dort gibt (Test unten). */
const BEWUSST_DRAUSSEN = {
  "npm ci": "Installation, keine Prüfung",
  "npm ci --prefix functions": "Installation, keine Prüfung",
  "npm test": "Backend-Suite, läuft lokal so lang wie in der Pipeline (~2,5 min) — deckt scripts/pruefstand.sh ab",
};

/* Die langen Suiten fehlen im lokalen Skript mit Absicht. Welcher Pflicht-Job
   der Pipeline sie faehrt, steht hier — der Test weiter unten verlangt den
   Befehl als Schritt genau dieses Jobs (OPS-2026-10-03-12). Die Browser-
   Durchlaeufe stehen nur hier: Ihr Job `test-e2e` gehoert nicht zu den
   billigen Jobs, die der Vergleich "Pipeline -> Skript" liest. */
const LANGE_SUITEN = {
  "npm test": {
    job: "test-backend",
    grund: "Server-Suite, läuft lokal so lang wie in der Pipeline (~2,5 min) — deckt scripts/pruefstand.sh ab",
  },
  "npm run test:e2e": {
    job: "test-e2e",
    grund: "Browser-Durchläufe (~3,5 min), feste Ports — deckt scripts/pruefstand.sh ab",
  },
};

/** Die Schritte JEDES Jobs der Workflow-Datei: `run:`-Befehle im Wortlaut,
 *  Actions als "uses: owner/repo". Kommentarzeilen zaehlen nicht — der
 *  Kommentar ueber einem Schritt nennt meist genau den Namen, um den es geht. */
function schritteJeJob() {
  const jobs = {};
  let job = null;
  for (const zeile of fs.readFileSync(WORKFLOW, "utf8").split("\n")) {
    if (/^\s*#/.test(zeile)) continue;
    const kopf = zeile.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (kopf) {
      job = kopf[1];
      jobs[job] = [];
      continue;
    }
    if (!job) continue;
    const run = zeile.match(/^\s+(?:- )?run:\s+(.+?)\s*$/);
    if (run) jobs[job].push(run[1]);
    const uses = zeile.match(/^\s+(?:- )?uses:\s+([^@\s]+)/);
    if (uses) jobs[job].push(`uses: ${uses[1]}`);
  }
  return jobs;
}

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

  test("jede Ausnahme nennt einen Schritt, den es in den billigen Jobs der Pipeline gibt", () => {
    /* TEST-2026-10-04-17: Ein Eintrag ohne Gegenstand ist eine Ausnahme auf
       Vorrat — der nächste Schritt, der zufällig so heißt, erbte sie, ohne dass
       jemand entschieden hätte. */
    const schritte = billigeSchritte();
    for (const schritt of Object.keys(BEWUSST_DRAUSSEN)) {
      expect({ schritt, gebraucht: schritte.includes(schritt) }).toEqual({ schritt, gebraucht: true });
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

  /* Die Gegenrichtung (seit 01.09.2026, Pruefrunde 8, M-P2-4): Der Test weiter
     oben verlangt, dass jeder Schritt aus ci.yml auch im Skript steht. Entfernt
     jemand einen Schritt AUS ci.yml, ist das trivial erfuellt. Deshalb muss
     umgekehrt alles, was das lokale Skript prueft, auch in der Pipeline laufen.

     OPS-2026-10-03-12: Verglichen wird der BEFEHL jeder `lauf`-Zeile mit den
     Schritten des Jobs, den die Zeile selbst nennt — wortgleich, nach zwei
     Angleichungen (unten). Eine Suche nach dem blossen Skriptnamen in der
     ganzen Datei genuegt nicht: Sie findet den Namen auch im Kommentar ueber
     einem geloeschten Schritt, und Befehle ohne Skriptnamen (`npm run lint`,
     `npm run test:frontend`) sieht sie gar nicht. */

  /** Die `lauf`-Zeilen des Skripts: Beschreibung, Pipeline-Job, Befehl. Eine
   *  Zeile, die mit einem Backslash endet, geht in der naechsten weiter. */
  function laufZeilen() {
    const zeilen = fs.readFileSync(SKRIPT, "utf8").split("\n");
    const aufrufe = [];
    for (let i = 0; i < zeilen.length; i++) {
      const m = zeilen[i].match(/^\s*lauf\s+"([^"]*)"\s+"([^"]*)"\s+(.+)$/);
      if (!m) continue;
      let befehl = m[3];
      while (befehl.endsWith("\\") && i + 1 < zeilen.length) {
        i += 1;
        befehl = `${befehl.slice(0, -1).trim()} ${zeilen[i].trim()}`;
      }
      aufrufe.push({ beschreibung: m[1], job: m[2], befehl: befehl.trim() });
    }
    return aufrufe;
  }

  /** Gleicht einen lokalen Befehl an die Schreibweise der Pipeline an. */
  function wieInDerPipeline(befehl, job) {
    let b = befehl;
    /* Der Job test-backend arbeitet im Ordner functions/ — lokal steht dafuer
       ein `cd functions &&` oder `--prefix functions` davor. */
    const imOrdner = b.match(/^sh -c 'cd functions && (.+)'$/);
    if (imOrdner) b = imOrdner[1];
    if (job === "test-backend") b = b.replace(" --prefix functions", "");
    /* Lokal ohne das Rauschen von npm, und die Installation nur als Probe. */
    return b.replace(" --silent", "").replace(" --dry-run", "");
  }

  /* Was lokal anders heisst als in der Pipeline, aber dasselbe prueft: der
     lokale Befehl, der Schritt, der dafuer im SELBEN Job der Pipeline stehen
     muss, und der Grund. */
  /* TEST-2026-10-04-29: Drei Pruefungen lesen das ganze Verzeichnis. Lokal
     bekommen sie einen Spiegel mit dem, was git kennt — am Arbeitsrechner
     liegen im Projektordner auch ausgenommene Ordner, die es in der Pipeline
     nicht gibt. */
  const NUR_GIT_BEKANNT = Object.fromEntries(
    ["fakten-drift", "stiller-fehlschlag", "test-blind"].map((name) => [
      `python3 scripts/nur-git-bekannt.py python3 scripts/pruefungen/checks/${name}.py`,
      {
        pipeline: `python3 scripts/pruefungen/checks/${name}.py .`,
        grund: "Dieselbe Pruefung; lokal ueber einen Spiegel mit dem, was git kennt (TEST-2026-10-04-29).",
      },
    ])
  );

  const ANDERS_BENANNT = {
    ...NUR_GIT_BEKANNT,
    "sh scripts/secret-scan-lokal.sh": {
      pipeline: "uses: gitleaks/gitleaks-action",
      grund:
        "Die Pipeline hat dafuer den eigenen Job `secret-scan` mit der gitleaks-Action — ein " +
        "Pflicht-Check. Lokal laeuft die schnelle Variante ueber dasselbe Werkzeug.",
    },
    "npm test -- vor-dem-push-script.test doku-drift": {
      pipeline: "npm test",
      grund:
        "Lokal nur die zwei Testdateien, die ci.yml gegen dieses Skript halten, und nur bei " +
        "geaenderter Pipeline. Die Pipeline faehrt die ganze Server-Suite.",
    },
  };

  /* Was es in der Pipeline bewusst NICHT gibt. */
  const NUR_LOKAL = {
    "node scripts/pruefe-pipeline-schritte.mjs":
      "Fuehrt geaenderte Pipeline-Schritte vor dem Push aus. In der Pipeline liefe er gegen sich selbst.",
  };

  test("jeder Schritt des Skripts steht auch in der Pipeline — im Job, den er nennt", () => {
    const schritte = schritteJeJob();
    const aufrufe = laufZeilen();
    /* Positivkontrolle fuer die Messung: Liest sie die `lauf`-Zeilen nicht
       mehr, waere die Liste der fehlenden Schritte leer — und der Test gruen. */
    expect(aufrufe.length).toBeGreaterThan(25);

    const fehlend = [];
    for (const { beschreibung, job, befehl } of aufrufe) {
      const angeglichen = wieInDerPipeline(befehl, job);
      if (NUR_LOKAL[angeglichen]) continue;
      const erwartet = ANDERS_BENANNT[angeglichen] ? ANDERS_BENANNT[angeglichen].pipeline : angeglichen;
      /* In test-backend steht der Pfad zum Abhaengigkeits-Gate mit `../`
         davor, weil der Job in functions/ arbeitet. */
      const imJob = (schritte[job] || []).map((s) => s.replace(/^node \.\.\/scripts\//, "node scripts/"));
      if (!imJob.includes(erwartet)) fehlend.push(`${beschreibung}: Job ${job} fuehrt "${erwartet}" nicht aus`);
    }
    expect({
      hinweis: "diese Pruefungen laufen lokal, aber NICHT (mehr) im genannten Job der Pipeline",
      fehlend,
    }).toEqual({
      hinweis: "diese Pruefungen laufen lokal, aber NICHT (mehr) im genannten Job der Pipeline",
      fehlend: [],
    });
  });

  test("jede Abweichung zwischen Skript und Pipeline traegt eine Begruendung und wird gebraucht", () => {
    const angeglichen = laufZeilen().map(({ befehl, job }) => wieInDerPipeline(befehl, job));
    for (const [befehl, { pipeline, grund }] of Object.entries(ANDERS_BENANNT)) {
      expect({ befehl, pipeline: typeof pipeline, langGenug: grund.length > 20 }).toEqual({
        befehl,
        pipeline: "string",
        langGenug: true,
      });
      /* Ein Eintrag, den keine `lauf`-Zeile mehr braucht, ist eine Ausnahme
         ohne Gegenstand — die naechste Zeile, die zufaellig so heisst, erbte sie. */
      expect({ befehl, gebraucht: angeglichen.includes(befehl) }).toEqual({ befehl, gebraucht: true });
    }
    for (const [befehl, grund] of Object.entries(NUR_LOKAL)) {
      expect({ befehl, langGenug: grund.length > 20, gebraucht: angeglichen.includes(befehl) }).toEqual({
        befehl,
        langGenug: true,
        gebraucht: true,
      });
    }
  });

  /* OPS-2026-10-03-12: Die Server-Suite und die Browser-Durchlaeufe stehen
     nicht im lokalen Skript — die beiden Vergleiche oben sehen sie deshalb in
     keiner Richtung. Ihre Zeilen liessen sich aus ci.yml streichen, die Jobs
     blieben gruen. Der zweite Halt dafuer ist der Vertrag in
     scripts/pruefe-deploy-riegel.py (laeuft im Job `pruefungen`); dieser Test
     laeuft im Job `test-backend`. */
  test("die langen Suiten, die lokal bewusst fehlen, faehrt die Pipeline — jede in ihrem Pflicht-Job", () => {
    const schritte = schritteJeJob();
    /* Positivkontrolle: Die Jobs werden ueberhaupt gelesen. */
    expect(Object.keys(schritte).length).toBeGreaterThan(5);
    const skript = fs.readFileSync(SKRIPT, "utf8");
    for (const [befehl, { job, grund }] of Object.entries(LANGE_SUITEN)) {
      /* Wer hier steht, ist eine bewusste Auslassung — mit Begruendung, und im
         lokalen Skript gibt es ihn wirklich nicht als eigenen Schritt. */
      expect({ befehl, begruendet: typeof grund === "string" && grund.length > 10 }).toEqual({
        befehl,
        begruendet: true,
      });
      expect({ befehl, lokal: new RegExp(`^lauf .* ${befehl}$`, "m").test(skript) }).toEqual({ befehl, lokal: false });
      expect({ job, befehl, alsSchritt: (schritte[job] || []).includes(befehl) }).toEqual({
        job,
        befehl,
        alsSchritt: true,
      });
    }
  });
});
