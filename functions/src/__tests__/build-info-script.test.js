const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für den Live-Beweis: scripts/build-info.mjs und scripts/pruefe-live.sh.
 *
 * Wozu das Ganze: Offener Quelltext beweist für sich genommen nichts — er
 * sagt, was laufen KÖNNTE, nicht was läuft. `build-info.json` schließt die
 * Lücke für den Teil, auf dem die Datenschutz-Zusagen dieses Projekts beruhen:
 * das Frontend. Jede ausgelieferte Datei bekommt eine Prüfsumme, und wer will,
 * rechnet sie nach.
 *
 * Die zwei Stellen, an denen so etwas still kaputtgeht:
 *
 *   1. Die Reihenfolge im Deploy. Läuft die Erzeugung VOR der
 *      Cache-Buster-Ersetzung, stehen dort die Prüfsummen des Zustands davor —
 *      und jede Nachprüfung meldet Abweichungen, wo keine sind. Ein Beweis,
 *      der falsch Alarm schlägt, wird nach kurzer Zeit ignoriert.
 *   2. Die Ausschlussliste. `firebase.json` liefert bestimmte Dateien nicht
 *      aus. Stünden sie im Fingerabdruck, behauptete er etwas über Dateien,
 *      die auf dem Server nie existiert haben.
 *
 * Reine Textanalyse plus ein Lauf gegen ein Wegwerf-Verzeichnis. Kein Netz,
 * kein Deploy, keine Schreibzugriffe im Projekt.
 */

const WURZEL = path.join(__dirname, "../../..");
const DEPLOY = path.join(WURZEL, "scripts/deploy.sh");
const ERZEUGER = path.join(WURZEL, "scripts/build-info.mjs");
const PRUEFER = path.join(WURZEL, "scripts/pruefe-live.sh");

describe("build-info im Deploy", () => {
  const deploy = () => fs.readFileSync(DEPLOY, "utf8");

  test("der Deploy erzeugt den Fingerabdruck überhaupt", () => {
    expect(deploy()).toContain("build-info.mjs");
  });

  test("und zwar NACH der Cache-Buster-Ersetzung", () => {
    const zeilen = deploy().split("\n");
    const ersetzung = zeilen.findIndex((z) => /sed -i.*\?v=/.test(z));
    const erzeugung = zeilen.findIndex((z) => z.includes("build-info.mjs"));

    /* Positivkontrolle für die Messung: Findet sie eine der beiden Stellen
       nicht, ist nicht die Reihenfolge in Ordnung, sondern der Test blind. */
    expect(ersetzung).toBeGreaterThan(-1);
    expect(erzeugung).toBeGreaterThan(-1);

    expect({
      hinweis: "build-info.mjs muss NACH der Buster-Ersetzung stehen",
      reihenfolgeStimmt: ersetzung < erzeugung,
    }).toEqual({
      hinweis: "build-info.mjs muss NACH der Buster-Ersetzung stehen",
      reihenfolgeStimmt: true,
    });
  });

  test("ein Fehlschlag bricht den Deploy ab, statt still weiterzulaufen", () => {
    const stelle = deploy().split("build-info.mjs")[1] || "";
    expect(stelle.slice(0, 200)).toMatch(/exit 1/);
  });
});

describe("build-info.mjs", () => {
  let ordner;

  beforeEach(() => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), "buildinfo-"));
  });
  afterEach(() => {
    fs.rmSync(ordner, { recursive: true, force: true });
  });

  test("die Ausschlüsse werden aus firebase.json GELESEN, nicht abgeschrieben", () => {
    /* Eine Kopie der Liste im Skript würde beim nächsten Eintrag in
       firebase.json auseinanderlaufen — und niemand merkte es. */
    const quelle = fs.readFileSync(ERZEUGER, "utf8");
    expect(quelle).toContain("firebase.json");
    expect(quelle).toMatch(/hosting\.ignore|hosting\.ignore-Liste|ignore/);

    /* Gegenprobe: Die PROJEKTBEZOGENEN Muster stehen NICHT im Skript.
       Allgemeine Musterformen (versteckte Dateien, node_modules) sind dagegen
       Vergleichs-Logik — der Uebersetzer muss die Form erkennen, um sie
       anwenden zu koennen. Sie aendern sich nicht, wenn jemand einen Ordner
       zur Ausschlussliste hinzufuegt.
       (Die Formen stehen unten als Zeichenketten; im Kommentar wuerde die
       Folge Stern-Schraegstrich den Kommentarblock beenden.) */
    const FORMEN = new Set(["firebase.json", "**/.*", "**/node_modules/**"]);
    const konfig = JSON.parse(fs.readFileSync(path.join(WURZEL, "firebase.json"), "utf8"));
    const hosting = Array.isArray(konfig.hosting) ? konfig.hosting[0] : konfig.hosting;
    const abgeschrieben = hosting.ignore.filter((m) => !FORMEN.has(m) && quelle.includes(`"${m}"`));
    expect(abgeschrieben).toEqual([]);
  });

  test("der Fingerabdruck enthält sich nicht selbst", () => {
    const info = JSON.parse(fs.readFileSync(path.join(WURZEL, "public/build-info.json"), "utf8"));
    expect(Object.keys(info.dateien)).not.toContain("build-info.json");
  });

  test("und keine Datei, die Firebase gar nicht ausliefert", () => {
    const info = JSON.parse(fs.readFileSync(path.join(WURZEL, "public/build-info.json"), "utf8"));
    const verboten = Object.keys(info.dateien).filter(
      (p) =>
        p.includes("__tests__/") ||
        p.startsWith("img/demo/original/") ||
        p === "lib/PRUEFSUMMEN.json" ||
        p.split("/").some((t) => t.startsWith("."))
    );
    expect(verboten).toEqual([]);
  });

  test("eine unsinnige Version wird abgelehnt (Exit 2, nicht 1)", () => {
    /* Ein Aufrufproblem ist kein Befund. */
    let code = 0;
    try {
      execFileSync("node", [ERZEUGER, "keine-version"], { stdio: "pipe" });
    } catch (e) {
      code = e.status;
    }
    expect(code).toBe(2);
  });
});

describe("pruefe-live.sh", () => {
  const quelle = () => fs.readFileSync(PRUEFER, "utf8");

  test("trennt Messproblem (2) von Befund (1)", () => {
    const q = quelle();
    expect(q).toMatch(/exit 2/);
    expect(q).toMatch(/exit 1/);
    expect(q).toMatch(/exit 0/);
  });

  test("erkennt HTML statt JSON als Messproblem", () => {
    /* Firebase liefert bei unbekannten Pfaden die Startseite mit Status 200
       aus. Ohne diese Prüfung meldete das Skript „unlesbar" statt „gibt es
       dort nicht". */
    expect(quelle()).toMatch(/doctype|<html/i);
  });

  test("null geladene Dateien gelten als Messproblem, nicht als Erfolg", () => {
    /* Ein leeres Ergebnis ist zuerst ein Verdacht gegen das Messmittel. */
    expect(quelle()).toMatch(/GEPRUEFT.*-eq 0/s);
  });

  test("ist ausführbar", () => {
    expect(fs.statSync(PRUEFER).mode & 0o111).toBeGreaterThan(0);
  });
});
