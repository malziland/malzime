const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für scripts/changelog-oberste-version.sh und seine Anbindung in
 * .github/workflows/release.yml.
 *
 * Befund OPS-2026-08-12-30: Der Release-Wächter bestimmte die auszuliefernde
 * Version mit `grep -m1` nach dem Muster x.y.z — also mit der ersten Zeile im
 * CHANGELOG, die wie eine Versionsnummer aussieht. Steht darüber ein Abschnitt
 * [Unveröffentlicht] (in diesem Projekt der dokumentierte Normalzustand
 * zwischen zwei Deploys), dann ist diese erste Nummer eine BEREITS
 * AUSGELIEFERTE. Ändert sich die oberste Überschrift, hängt der Wächter den Tag
 * dieser alten Nummer auf den neuen Stand um: die OPS-002-Falle vom 2026-08-10,
 * nur durch eine andere Tür.
 *
 * Vor diesem Test las kein einziger Test irgendeine Datei unter
 * .github/workflows — die gesamte Auslieferungs-Automatik war ungeprüft.
 * Reine Textanalyse plus Skriptlauf mit Eingabe aus dem Speicher; kein Netz,
 * kein git, keine Schreibzugriffe.
 */

const SKRIPT = path.join(__dirname, "../../../scripts/changelog-oberste-version.sh");
const WORKFLOW = path.join(__dirname, "../../../.github/workflows/release.yml");

/* Führt das Skript mit dem übergebenen CHANGELOG-Inhalt auf stdin aus und
   liefert Rückgabewert und Ausgaben. execFileSync wirft bei jedem Wert != 0 —
   der Fehler trägt status/stdout/stderr, deshalb der Umweg über catch. */
function lauf(inhalt) {
  try {
    const aus = execFileSync("sh", [SKRIPT], { input: inhalt, encoding: "utf8" });
    return { code: 0, aus: aus.trim(), fehler: "" };
  } catch (e) {
    return {
      code: e.status,
      aus: (e.stdout || "").trim(),
      fehler: (e.stderr || "").trim(),
    };
  }
}

describe("changelog-oberste-version.sh", () => {
  test("Rückfall-Wächter OPS-2026-08-12-30: [Unveröffentlicht] über einer ausgelieferten Nummer liefert NIE diese Nummer", () => {
    const r = lauf(
      [
        "# Changelog",
        "",
        "## [Unveröffentlicht]",
        "",
        "- etwas in Arbeit",
        "",
        "## [3.0.9] — 2026-08-12",
        "",
        "- schon ausgeliefert",
        "",
      ].join("\n")
    );
    /* Das Kernversprechen: Die ausgelieferte Nummer darf nicht herauskommen.
       Käme sie heraus, würde der Workflow ihren Tag umhängen. */
    expect(r.aus).not.toBe("3.0.9");
    expect(r.aus).toBe("Unveröffentlicht");
    expect(r.code).toBe(1); // 1 = kein Release fällig, kein Fehler
  });

  test("stabile Version ganz oben löst einen Release aus", () => {
    const r = lauf("# Changelog\n\n## [3.1.0] — 2026-08-13\n\n- fertig\n");
    expect(r.code).toBe(0);
    expect(r.aus).toBe("3.1.0");
  });

  test("ein Vorabstand ist keine stabile Version", () => {
    const r = lauf("# Changelog\n\n## [3.1.0-rc1] — 2026-08-13\n\n- Probe\n");
    expect(r.code).toBe(1);
    expect(r.aus).toBe("3.1.0-rc1");
  });

  test("keine auswertbare Überschrift ist ein Messfehler (2), kein 'nichts zu tun' (0)", () => {
    const r = lauf("# Changelog\n\nnur Fließtext, keine Abschnitte\n");
    expect(r.code).toBe(2);
    expect(r.aus).toBe("");
    expect(r.fehler).toMatch(/keine Abschnitts-Ueberschrift/);
  });

  test("eine nicht lesbare Datei ist ebenfalls Messfehler 2", () => {
    let code = 0;
    try {
      execFileSync("sh", [SKRIPT, "/gibt/es/nicht/CHANGELOG.md"], { encoding: "utf8" });
    } catch (e) {
      code = e.status;
    }
    expect(code).toBe(2);
  });

  test("das echte CHANGELOG des Projekts ist auswertbar", () => {
    /* Fixtures beweisen nur die eigene Erfindung. Diese Probe läuft gegen das
       Material, das der Workflow tatsächlich liest (Lehre vom 2026-08-12). */
    const echt = fs.readFileSync(path.join(__dirname, "../../../CHANGELOG.md"), "utf8");
    const r = lauf(echt);
    expect(r.code).not.toBe(2);
    expect(r.aus).not.toBe("");
  });
});

describe("release.yml benutzt diese Auswertung auch wirklich", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");

  test("der Workflow ruft das Skript auf", () => {
    /* Ohne diese Kopplung wäre das Skript oben grün und der Workflow trotzdem
       kaputt — geprüft würde dann nur noch die eigene Erfindung. */
    expect(yaml).toMatch(/changelog-oberste-version\.sh/);
  });

  test("die alte Auswertung ist verschwunden und kommt nicht zurück", () => {
    const altesMuster = /grep -m1 -oE '\^## \\\[\[0-9\]\+/;
    expect(altesMuster.test(yaml)).toBe(false);
  });

  test("beide Auswertungsstellen (aktueller Stand und Eltern-Commit) gehen über das Skript", () => {
    /* Nur echte Aufrufe zählen. Kommentarzeilen erwähnen den Skriptnamen
       ebenfalls — würden sie mitgezählt, bliebe der Test auch dann grün, wenn
       ein Aufruf durch eine Erklärung ersetzt wird. */
    const aufrufe = yaml
      .split("\n")
      .filter((zeile) => !/^\s*#/.test(zeile))
      .filter((zeile) => /sh scripts\/changelog-oberste-version\.sh/.test(zeile));
    expect(aufrufe.length).toBe(2);
  });
});
