/* server-paket.test.js — was als Server-Paket zu Google geht (OPS-2026-10-03-09).
 *
 * Beim Ausliefern packt die Firebase-CLI den Ordner `functions/` zu einem
 * Paket. Was hineinkommt, bestimmt allein die Liste `functions.ignore` in
 * firebase.json — nicht .gitignore, nicht der Sauberkeits-Riegel. Fehlt die
 * Liste, geht der ganze Ordner mit: Tests, Hilfsskripte, ein alter
 * Abdeckungsbericht und jede `.env`-Datei, die dort gerade liegt.
 *
 * Diese Datei haelt fest, was im Paket sein darf: genau die Programmdateien,
 * die auch der Fingerabdruck (`public/build-info.json`, Feld `serverDateien`)
 * ausweist, dazu die zwei Dateien, aus denen Google die Fremdpakete
 * installiert. Mehr nicht — und auch nicht weniger, sonst startet das Programm
 * nach der Auslieferung nicht.
 *
 * WIE GEMESSEN WIRD: Beide Listen entstehen aus den ECHTEN Skripten, in einem
 * Wegwerf-Verzeichnis mit einer Kopie des eingecheckten Standes:
 *   · der Fingerabdruck aus `scripts/build-info.mjs`,
 *   · die Paketliste aus `scripts/pruefe-auslieferbare-reste.mjs --paketliste`,
 *     das den Dateilauf des Werkzeugs nachbildet (firebase-tools, fsAsync.js:
 *     minimatch mit matchBase und dot auf den vollen Pfad).
 * Eine Kopie der Regeln hier im Test liefe auseinander, ohne dass es jemand
 * merkt. Kein Netz, kein Deploy, keine Schreibzugriffe im Projekt.
 *
 * Die Firebase-CLI selbst ist dafuer nicht noetig: `minimatch` liegt in
 * functions/node_modules (ueber eslint und jest). Das Werkzeug bringt eine
 * aeltere Fassung derselben Bibliothek mit; damit beide gleich urteilen,
 * laesst der Test nur Muster zu, die ein blosser Datei- oder Ordnername sind
 * (siehe "Form der Muster").
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const WURZEL = path.join(__dirname, "../../..");
const FUNCTIONS = path.join(WURZEL, "functions");
/* Die kopierten Skripte liegen im Wegwerf-Verzeichnis ohne node_modules;
   ueber NODE_PATH finden sie minimatch trotzdem. */
const MODULE = path.join(FUNCTIONS, "node_modules");

/* Was der Bau bei Google zusaetzlich zum Programm braucht. */
const BAU = ["package.json", "package-lock.json"];
/* Was das Programm beim Start liest, der Fingerabdruck aber nicht fuehrt: Er
   nennt nur .js-Dateien. `i18n.js` liest diese Datei beim Laden — fehlte sie
   im Paket, startete keine einzige Funktion. */
const LAUFZEIT_OHNE_FINGERABDRUCK = ["src/locales/manifest.json"];

/* Was auf einem Auslieferungsrechner unter functions/ liegen kann und NICHT
   ins Paket darf. Jede Zeile ist ein Fall, den die Liste abdecken muss. */
const RESTE = [
  ".env",
  ".env.local",
  ".env.malzime",
  ".env.default",
  ".DS_Store",
  "src/.DS_Store",
  "coverage/lcov.info",
  "coverage/lcov-report/prettify.js",
  "src/__tests__/neu.test.js",
  "src/locales/__tests__/tiefer.test.js",
  "scripts/neues-hilfsskript.js",
  "node_modules/irgendwas/index.js",
  "firebase-debug.log",
  "firebase-debug.1.log",
  "lasttest.log",
];

const angelegt = [];

function git(ordner, ...argumente) {
  return execFileSync("git", argumente, { cwd: ordner, encoding: "utf8", stdio: "pipe" });
}

/** Legt ein Wegwerf-Verzeichnis mit dem eingecheckten Stand von functions/ an.
 *  Inhalte kommen aus dem ARBEITSBAUM: Eine Aenderung an firebase.json oder an
 *  einem der beiden Skripte muss hier ankommen, sonst misst der Test die alte
 *  Fassung. */
function pruefstand() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-paket-"));
  angelegt.push(ordner);
  const kopiere = (rel) => {
    const ziel = path.join(ordner, rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(WURZEL, rel), ziel);
  };
  for (const rel of [
    "firebase.json",
    ".gitignore",
    "scripts/build-info.mjs",
    "scripts/pruefe-auslieferbare-reste.mjs",
  ]) {
    kopiere(rel);
  }
  const eingecheckt = git(WURZEL, "ls-files", "-z", "--cached", "--", "functions").split("\0").filter(Boolean);
  for (const rel of eingecheckt) {
    if (fs.existsSync(path.join(WURZEL, rel))) kopiere(rel);
  }
  /* build-info.mjs verlangt mindestens eine Website-Datei. */
  fs.mkdirSync(path.join(ordner, "public"));
  fs.writeFileSync(path.join(ordner, "public", "index.html"), "<!doctype html><title>Pruefstand</title>\n");
  git(ordner, "init", "-q");
  git(ordner, "add", "-A");
  git(
    ordner,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "Pruefstand"
  );
  return ordner;
}

/** Fuehrt eines der kopierten Skripte im Wegwerf-Verzeichnis aus. */
function lauf(stand, skript, ...argumente) {
  try {
    const ausgabe = execFileSync(process.execPath, [path.join(stand, "scripts", skript), ...argumente], {
      cwd: stand,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, NODE_PATH: MODULE },
    });
    return { code: 0, ausgabe };
  } catch (e) {
    return { code: e.status, ausgabe: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

/** Die Dateiliste des Server-Pakets, wie das Werkzeug sie bildete. */
function paketliste(stand) {
  const r = lauf(stand, "pruefe-auslieferbare-reste.mjs", "--paketliste");
  if (r.code !== 0) throw new Error(`Paketliste nicht messbar (Code ${r.code}): ${r.ausgabe}`);
  return r.ausgabe.split("\n").filter(Boolean);
}

/** Die Server-Dateien, die der Fingerabdruck ausweist — als Pfade im Paket. */
function fingerabdruck(stand) {
  const r = lauf(stand, "build-info.mjs", "2026010101");
  if (r.code !== 0) throw new Error(`Fingerabdruck nicht erzeugbar (Code ${r.code}): ${r.ausgabe}`);
  const info = JSON.parse(fs.readFileSync(path.join(stand, "public", "build-info.json"), "utf8"));
  return Object.keys(info.serverDateien)
    .map((datei) => `src/${datei}`)
    .sort();
}

/** Legt Dateien unter functions/ des Wegwerf-Verzeichnisses an. */
function streue(stand, dateien) {
  for (const rel of dateien) {
    const ziel = path.join(stand, "functions", rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, "Probe\n");
  }
}

/** Schreibt firebase.json im Wegwerf-Verzeichnis mit geaenderter Liste. */
function mitListe(stand, aendern) {
  const datei = path.join(stand, "firebase.json");
  const konfig = JSON.parse(fs.readFileSync(datei, "utf8"));
  aendern(konfig.functions);
  fs.writeFileSync(datei, JSON.stringify(konfig, null, 2));
}

afterAll(() => {
  for (const ordner of angelegt) fs.rmSync(ordner, { recursive: true, force: true });
});

describe("Server-Paket: Umfang am eingecheckten Stand", () => {
  let stand;
  let paket;
  let programm;

  beforeAll(() => {
    stand = pruefstand();
    paket = paketliste(stand);
    programm = fingerabdruck(stand);
  }, 60000);

  test("beide Messungen sehen das Programm (Positivkontrolle)", () => {
    /* Eine leere oder verfehlte Liste liesse jeden Vergleich unten gruen. */
    expect(programm).toContain("src/index.js");
    expect(programm.length).toBeGreaterThan(20);
    expect(paket).toContain("src/index.js");
  });

  test("im Paket liegt genau das Programm aus dem Fingerabdruck, dazu die Bau-Dateien", () => {
    const soll = [...programm, ...BAU, ...LAUFZEIT_OHNE_FINGERABDRUCK].sort();
    /* Zwei Richtungen in einer Zusicherung: Eine Datei zu viel (Test,
       Hilfsskript, Konfiguration fuer Werkzeuge) faellt ebenso auf wie eine
       zu wenig (das Programm startete nicht). */
    expect(paket).toEqual(soll);
  });

  test("keine Testdatei, keine Umgebungsdatei, kein Hilfsskript", () => {
    const verboten = paket.filter(
      (p) =>
        p.split("/").includes("__tests__") ||
        p.split("/").some((teil) => teil.startsWith(".")) ||
        p.startsWith("scripts/") ||
        p.startsWith("coverage/") ||
        p.startsWith("node_modules/") ||
        /\.test\.js$/.test(p)
    );
    expect(verboten).toEqual([]);
  });

  test("das Paket laedt fuer sich allein und bietet dieselben Funktionen wie der Arbeitsbaum", () => {
    /* Der Trockenlauf des Werkzeugs laedt das Programm aus dem ganzen Ordner,
       nicht aus dem Paket. Schliesst die Liste eine Datei aus, die das
       Programm braucht, fiele das erst nach der Auslieferung auf. */
    const ziel = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-paket-lauf-"));
    angelegt.push(ziel);
    for (const rel of paket) {
      fs.mkdirSync(path.dirname(path.join(ziel, rel)), { recursive: true });
      fs.copyFileSync(path.join(stand, "functions", rel), path.join(ziel, rel));
    }
    fs.symlinkSync(MODULE, path.join(ziel, "node_modules"), "dir");
    const funktionen = (ordner) => {
      const einstieg = JSON.parse(fs.readFileSync(path.join(ordner, "package.json"), "utf8")).main;
      const ausgabe = execFileSync(
        process.execPath,
        ["-e", `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify("./" + einstieg)})).sort()))`],
        { cwd: ordner, encoding: "utf8", stdio: "pipe" }
      );
      return JSON.parse(ausgabe);
    };
    const imPaket = funktionen(ziel);
    expect(imPaket.length).toBeGreaterThan(5);
    expect(imPaket).toEqual(funktionen(FUNCTIONS));
  });
});

describe("Server-Paket: Reste auf dem Auslieferungsrechner bleiben draussen", () => {
  let stand;
  let ohneReste;

  beforeAll(() => {
    stand = pruefstand();
    ohneReste = paketliste(stand);
    streue(stand, RESTE);
  }, 60000);

  test("keiner der Reste aendert die Paketliste", () => {
    expect(paketliste(stand)).toEqual(ohneReste);
  });

  test("ohne die Liste gingen dieselben Reste mit — die Messung sieht sie also", () => {
    /* Gegenprobe: Faende der Dateilauf die gestreuten Dateien gar nicht, waere
       der Test darueber immer gruen. Ohne functions.ignore gilt die Vorgabe
       des Werkzeugs (nur node_modules und .git bleiben draussen). */
    const datei = path.join(stand, "firebase.json");
    const vorher = fs.readFileSync(datei, "utf8");
    try {
      mitListe(stand, (f) => delete f.ignore);
      const liste = paketliste(stand);
      expect(liste).toEqual(expect.arrayContaining([".env", ".env.local", ".env.malzime", ".DS_Store"]));
      expect(liste).toEqual(expect.arrayContaining(["coverage/lcov.info", "scripts/neues-hilfsskript.js"]));
      expect(liste).toEqual(expect.arrayContaining(["src/__tests__/neu.test.js", "lasttest.log"]));
      /* Was das Werkzeug auch ohne Liste weglaesst. */
      expect(liste).not.toContain("node_modules/irgendwas/index.js");
      expect(liste).not.toContain("firebase-debug.log");
      expect(liste).not.toContain("firebase-debug.1.log");
    } finally {
      fs.writeFileSync(datei, vorher);
    }
  });

  test("der Waechter meldet bei ausgeschlossenen Resten keinen Fund", () => {
    /* Sonst hielte jede .DS_Store die Auslieferung an. */
    const r = lauf(stand, "pruefe-auslieferbare-reste.mjs");
    expect(r.ausgabe).toMatch(/Server-Paket: functions\/ gegen \d+ ignore-Muster/);
    expect(r.code).toBe(0);
  });
});

describe("Server-Paket: der Waechter sieht, was die Liste nicht kennt", () => {
  let stand;

  beforeAll(() => {
    stand = pruefstand();
  }, 60000);

  /** Stellt einen Zustand her, misst und nimmt ihn wieder zurueck. */
  function mitDatei(rel, messen) {
    const ziel = path.join(stand, "functions", rel);
    const obersterNeuer = path.join(stand, "functions", rel.split("/")[0]);
    const gabEsSchon = fs.existsSync(obersterNeuer);
    streue(stand, [rel]);
    try {
      return messen();
    } finally {
      fs.rmSync(gabEsSchon ? ziel : obersterNeuer, { recursive: true, force: true });
    }
  }

  test("sauberer Stand: Rueckgabewert 0", () => {
    const r = lauf(stand, "pruefe-auslieferbare-reste.mjs");
    expect(r.ausgabe).toMatch(/davon nicht eingecheckt: 0/);
    expect(r.code).toBe(0);
  });

  test("ein Arbeitsordner, den git nicht kennt, ginge ins Paket: Rueckgabewert 1", () => {
    const r = mitDatei("w1/arbeit.js", () => lauf(stand, "pruefe-auslieferbare-reste.mjs"));
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/functions\/w1\/arbeit\.js/);
    expect(r.ausgabe).toMatch(/1 Datei\(en\) gingen ins Server-Paket/);
  });

  test("eine von git ignorierte Datei, die die Liste nicht nennt: Rueckgabewert 1", () => {
    /* Genau der Fall, den `git status --porcelain` nicht zeigt. */
    const r = mitDatei("loadtest-results-2026.json", () => {
      /* Messmittel-Probe: git ignoriert die Datei wirklich. */
      expect(git(stand, "status", "--porcelain").trim()).toBe("");
      return lauf(stand, "pruefe-auslieferbare-reste.mjs");
    });
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/functions\/loadtest-results-2026\.json/);
  });

  test("eine Liste, die das Programm ausschliesst, ist ein Fund und kein sauberes Paket", () => {
    const datei = path.join(stand, "firebase.json");
    const vorher = fs.readFileSync(datei, "utf8");
    try {
      mitListe(stand, (f) => f.ignore.push("index.js"));
      const r = lauf(stand, "pruefe-auslieferbare-reste.mjs");
      expect(r.code).toBe(1);
      expect(r.ausgabe).toMatch(/functions\/src\/index\.js/);
      expect(r.ausgabe).toMatch(/schliesst\s+zu viel aus/);
    } finally {
      fs.writeFileSync(datei, vorher);
    }
  });

  test("eine Liste, die alles ausschliesst, ist nicht messbar statt sauber", () => {
    const datei = path.join(stand, "firebase.json");
    const vorher = fs.readFileSync(datei, "utf8");
    try {
      mitListe(stand, (f) => f.ignore.push("*"));
      const r = lauf(stand, "pruefe-auslieferbare-reste.mjs");
      expect(r.code).toBe(2);
      expect(r.ausgabe).toMatch(/NICHT MESSBAR/);
    } finally {
      fs.writeFileSync(datei, vorher);
    }
  });

  test("ohne minimatch meldet der Waechter 'nicht messbar' statt 'sauber'", () => {
    let code = 0;
    let ausgabe = "";
    try {
      execFileSync(process.execPath, [path.join(stand, "scripts", "pruefe-auslieferbare-reste.mjs")], {
        cwd: stand,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, NODE_PATH: "" },
      });
    } catch (e) {
      code = e.status;
      ausgabe = `${e.stdout || ""}${e.stderr || ""}`;
    }
    expect(code).toBe(2);
    expect(ausgabe).toMatch(/NICHT MESSBAR: minimatch/);
  });
});

describe("Server-Paket: Form der Muster in firebase.json", () => {
  const liste = JSON.parse(fs.readFileSync(path.join(WURZEL, "firebase.json"), "utf8")).functions.ignore;

  test("die Liste gibt es, und sie nennt die Grundeintraege des Werkzeugs selbst", () => {
    /* Ist functions.ignore gesetzt, gilt GENAU diese Liste — die Vorgabe des
       Werkzeugs (node_modules, .git) entfaellt dann. */
    expect(Array.isArray(liste)).toBe(true);
    expect(liste).toEqual(expect.arrayContaining(["node_modules", ".git"]));
  });

  test("jedes Muster ist ein blosser Name: Buchstaben, Ziffern, Punkt, Strich, Stern", () => {
    /* Solche Muster vergleicht das Werkzeug auf jeder Ebene mit dem Datei-
       oder Ordnernamen (matchBase). Ein Muster mit Schraegstrich gaelte
       dagegen fuer den VOLLEN Pfad ab der Wurzel des Rechners und traefe
       nichts; Klammern und Ausrufezeichen wertet die aeltere minimatch-Fassung
       des Werkzeugs nicht in jedem Fall so aus wie die Fassung, mit der hier
       gemessen wird. */
    const ungeeignet = liste.filter((muster) => !/^[A-Za-z0-9_.*-]+$/.test(muster));
    expect(ungeeignet).toEqual([]);
  });
});
