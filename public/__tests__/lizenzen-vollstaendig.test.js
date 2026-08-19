import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ── Fremde Bestandteile brauchen ihren vollständigen Lizenztext ───────────
 *
 * ANLASS 2026-08-19, vom Nutzer angestoßen: „Man kann nicht fremde Lizenzen
 * irgendwie aufnehmen und diese verändern oder falsch verwenden. Das ist eine
 * ganz, ganz wichtige Sache."
 *
 * Er hatte recht, und der Ist-Zustand gab ihm recht: Leaflet lag mit einer
 * Copyright-Zeile im minifizierten Kopf da, sonst nichts — die BSD-Bedingungen
 * und der Haftungsausschluss fehlten. exifr hatte gar nichts. Beide Lizenzen
 * verlangen ausdrücklich, dass ihr Text bei der Weitergabe MITGELIEFERT wird;
 * eine Nennung des Namens genügt nicht.
 *
 * Diese Prüfung sorgt dafür, dass das beim nächsten Einbau nicht wieder
 * passieren kann. Sie prüft die STRUKTUR, nicht den Wortlaut — den Wortlaut
 * bewachen die Prüfsummen in public/lib/PRUEFSUMMEN.json.
 */

/* Dateinamen, unter denen ein Lizenztext liegen darf. */
const LIZENZDATEIEN = ["LICENSE", "LICENSE.txt", "LICENSE.md", "LICENCE", "COPYING", "OFL.txt"];

/* Ordner, in denen fremde Bestandteile liegen. */
const BEREICHE = ["public/lib", "public/fonts"];

function bestandteile() {
  const raus = [];
  for (const bereich of BEREICHE) {
    const wurzel = path.join(REPO, bereich);
    if (!fs.existsSync(wurzel)) continue;
    for (const name of fs.readdirSync(wurzel)) {
      const voll = path.join(wurzel, name);
      if (!fs.statSync(voll).isDirectory()) continue;
      raus.push({ name, rel: `${bereich}/${name}`, pfad: voll });
    }
  }
  return raus;
}

const ALLE = bestandteile();

describe("Fremde Bestandteile: Lizenzen", () => {
  it("es gibt überhaupt welche zu prüfen", () => {
    /* POSITIVKONTROLLE: Findet die Suche nichts, wäre alles Folgende ein
       perfektes Ergebnis für nichts. Drei sind es aktuell — Leaflet, exifr,
       Poppins. */
    expect(ALLE.map((b) => b.rel).sort()).toEqual(["public/fonts/poppins", "public/lib/exifr", "public/lib/leaflet"]);
  });

  it.each(ALLE)("$rel bringt eine Lizenzdatei mit", ({ pfad, rel }) => {
    const gefunden = LIZENZDATEIEN.filter((n) => fs.existsSync(path.join(pfad, n)));
    expect(
      gefunden,
      `${rel} hat keine Lizenzdatei. Erlaubt: ${LIZENZDATEIEN.join(", ")}. ` +
        `Der Name allein genügt nicht — der Originaltext muss mitgeliefert werden.`
    ).not.toHaveLength(0);
  });

  it.each(ALLE)("$rel: der Lizenztext ist vollständig, nicht nur eine Zeile", ({ pfad, rel }) => {
    const datei = LIZENZDATEIEN.map((n) => path.join(pfad, n)).find((p) => fs.existsSync(p));
    const text = fs.readFileSync(datei, "utf8");

    /* Jede hier vorkommende Lizenz (MIT, BSD, OFL) schliesst die Gewährleistung
       aus. Fehlt dieser Teil, ist nur der Kopf kopiert worden. */
    expect(/WARRANT/i.test(text), `${rel}: im Lizenztext fehlt der Haftungsausschluss`).toBe(true);

    /* Und sie erteilt eine Erlaubnis oder nennt Bedingungen. */
    expect(
      /Permission is hereby granted|Redistribution and use|PERMISSION AND CONDITIONS/i.test(text),
      `${rel}: im Lizenztext fehlt der erteilende Teil`
    ).toBe(true);

    expect(text.length, `${rel}: der Lizenztext ist verdächtig kurz (${text.length} Zeichen)`).toBeGreaterThan(400);
  });

  it.each(ALLE)("$rel steht in THIRD-PARTY.md", ({ rel, name }) => {
    /* Eine Datei im Ordner nützt nichts, wenn niemand weiss, dass es sie gibt.
       THIRD-PARTY.md ist die Stelle, an der man nachsieht. */
    const uebersicht = fs.readFileSync(path.join(REPO, "THIRD-PARTY.md"), "utf8");
    expect(
      uebersicht.includes(rel) || uebersicht.toLowerCase().includes(name.toLowerCase()),
      `${rel} ist in THIRD-PARTY.md nicht aufgeführt`
    ).toBe(true);
  });

  it("die eigene MIT-Lizenz nennt die Ausnahmen nicht stillschweigend", () => {
    /* Wer README liest, muss erfahren, dass „MIT" nicht für alles im
       Repository gilt. */
    const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
    expect(readme).toContain("THIRD-PARTY.md");
  });
});
