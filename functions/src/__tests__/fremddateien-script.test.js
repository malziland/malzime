const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für scripts/pruefe-fremddateien.mjs (Befund OSS-2026-08-12-22).
 *
 * Die selbst gehosteten Fremdbibliotheken (exifr, Leaflet, die Schriften)
 * hatten keinen Unveränderheits-Nachweis. Eine Änderung an 147 KB
 * minifiziertem Einzeiler fällt in einem Pull-Request niemandem auf —
 * ausgerechnet exifr liest die GPS-Daten, deren Nichtweitergabe die Kernzusage
 * dieses Projekts ist.
 *
 * Dieser Test beweist nicht, dass die Dateien heute stimmen (das tut der
 * CI-Lauf selbst), sondern dass der Prüfer überhaupt rot werden KANN — und
 * zwar in allen vier Ausfallarten. Ein Prüfer, von dem das niemand weiß, ist
 * eine Behauptung.
 *
 * Kein Netz, keine Schreibzugriffe im Repository: alles läuft in einem
 * Wegwerf-Verzeichnis über die dafür vorgesehenen Einspeisepunkte.
 */

const SKRIPT = path.join(__dirname, "../../../scripts/pruefe-fremddateien.mjs");
const ECHTE_LISTE = path.join(__dirname, "../../../public/lib/PRUEFSUMMEN.json");

let basis;

beforeEach(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "fremddateien-"));
  fs.mkdirSync(path.join(basis, "public/lib"), { recursive: true });
  fs.writeFileSync(path.join(basis, "public/lib/beispiel.js"), "console.log(1);\n");
});

afterEach(() => {
  fs.rmSync(basis, { recursive: true, force: true });
});

function liste(inhalt) {
  const p = path.join(basis, "public/lib/PRUEFSUMMEN.json");
  fs.writeFileSync(p, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
  return p;
}

function lauf(listenPfad, argumente = []) {
  try {
    const aus = execFileSync("node", [SKRIPT, ...argumente], {
      encoding: "utf8",
      env: { ...process.env, PRUEFSUMMEN_BASIS: basis, PRUEFSUMMEN_DATEI: listenPfad },
    });
    return { code: 0, aus, fehler: "" };
  } catch (e) {
    return { code: e.status, aus: e.stdout || "", fehler: e.stderr || "" };
  }
}

/* Die Prüfsumme der oben angelegten Beispieldatei, vom Skript selbst erzeugt —
   bewusst nicht von Hand hingeschrieben, sonst prüfte der Test nur, ob ich
   richtig abgetippt habe. */
function sollwertAusSkript() {
  const p = liste({ dateien: { "public/lib/beispiel.js": "sha256:noch-unbekannt" } });
  lauf(p, ["--aktualisieren"]);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

describe("pruefe-fremddateien.mjs", () => {
  test("unveränderte Datei: grün", () => {
    const daten = sollwertAusSkript();
    const r = lauf(liste(daten));
    expect(r.code).toBe(0);
    expect(r.aus).toMatch(/alle Fremddateien unveraendert/);
  });

  test("ein einziges verändertes Zeichen: rot", () => {
    const daten = sollwertAusSkript();
    const p = liste(daten);
    fs.appendFileSync(path.join(basis, "public/lib/beispiel.js"), "/*x*/");
    const r = lauf(p);
    expect(r.code).toBe(1);
    expect(r.fehler).toMatch(/ABWEICHUNG/);
  });

  test("verschwundene Datei: rot, nicht still grün", () => {
    const daten = sollwertAusSkript();
    const p = liste(daten);
    fs.rmSync(path.join(basis, "public/lib/beispiel.js"));
    const r = lauf(p);
    expect(r.code).toBe(1);
    expect(r.fehler).toMatch(/FEHLEN/);
  });

  test("leere Sollwert-Liste ist ein Messfehler (2), kein bestandener Lauf (0)", () => {
    /* KERN 5c: Leer ist nicht dasselbe wie sauber. Genau hier ist ein Prüfer
       am gefährlichsten — er meldet grün, ohne etwas verglichen zu haben. */
    const r = lauf(liste({ dateien: {} }));
    expect(r.code).toBe(2);
  });

  test("unlesbare Sollwert-Liste: Messfehler (2)", () => {
    expect(lauf(liste("kein json")).code).toBe(2);
  });

  test("fehlende Sollwert-Liste: Messfehler (2)", () => {
    expect(lauf(path.join(basis, "gibt-es-nicht.json")).code).toBe(2);
  });

  test("das Manifest wird nicht mit auf die Website ausgeliefert", () => {
    /* Es liegt bei den Dateien, die es beschreibt — das ist gut auffindbar.
       Auf der Website hat es aber nichts verloren: Es ist Werkzeugdaten, kein
       Seiteninhalt. Ohne diesen Test faellt eine geaenderte ignore-Liste
       niemandem auf. */
    const hosting = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../firebase.json"), "utf8")).hosting;
    expect(hosting.ignore).toContain("lib/PRUEFSUMMEN.json");
  });

  test("die echte Liste deckt exifr, Leaflet und die Schriften ab", () => {
    /* Der Prüfer kann nur melden, was in der Liste steht. Fiele eine
       Bibliothek stillschweigend heraus, bliebe er grün und der Schutz weg. */
    const daten = JSON.parse(fs.readFileSync(ECHTE_LISTE, "utf8"));
    const pfade = Object.keys(daten.dateien).join("\n");
    expect(pfade).toMatch(/exifr/);
    expect(pfade).toMatch(/leaflet/i);
    expect(pfade).toMatch(/fonts/);
  });

  test("jede vom Repository verfolgte Fremddatei steht in der Liste", () => {
    /* Die schärfere Frage: nicht ob etwas drinsteht, sondern ob etwas fehlt.
       Eine neu hinzugefügte Fremddatei ohne Prüfsumme wäre sonst ungeschützt,
       ohne dass irgendwo etwas rot wird. Beim ersten Lauf fand genau das drei
       Lücken: beide VERSION-Marker und die Schriftlizenz OFL.txt.

       Gefragt wird git, nicht der Dateibaum — geschützt werden muss, was
       ausgeliefert wird, und lokaler Krempel wie .DS_Store gehört nicht dazu.
       Dieselbe Lehre wie beim Formulierungs-Prüfer (TEST-2026-08-12-29): Ein
       Prüfer, der den Arbeitsbaum liest, misst lokal etwas anderes als in der
       CI. */
    const wurzel = path.join(__dirname, "../../..");
    const verfolgt = execFileSync("git", ["ls-files", "public/lib", "public/fonts"], {
      cwd: wurzel,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((p) => !p.endsWith("PRUEFSUMMEN.json"));

    const daten = JSON.parse(fs.readFileSync(ECHTE_LISTE, "utf8"));
    expect(verfolgt.length).toBeGreaterThan(0); // Positivkontrolle: git hat geantwortet
    expect(verfolgt.filter((p) => !(p in daten.dateien))).toEqual([]);
    /* Und umgekehrt: kein Karteileichen-Eintrag für eine Datei, die es nicht
       mehr gibt — sonst wäre die Liste irgendwann rot aus dem falschen Grund. */
    expect(Object.keys(daten.dateien).filter((p) => !verfolgt.includes(p))).toEqual([]);
  });
});
