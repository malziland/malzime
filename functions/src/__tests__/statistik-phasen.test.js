"use strict";

/* Die Phasen der Browser-Fehler werden im Tageszaehler zu Feldnamen. Damit
   eine oeffentliche Schnittstelle das Dokument nicht mit freien Werten
   aufblaehen kann, kennt statistik.js eine feste Liste (PHASEN); alles andere
   zaehlt als "andere". Diese Pruefung haelt die Liste mit dem Browser-Code
   gleich: Jede Phase, die public/js schickt, steht in der Liste — sonst
   verschwaende eine neue Phase still in "andere". Positivkontrolle: Die Suche
   muss die bekannten Stellen finden. */

const fs = require("fs");
const path = require("path");
const { PHASEN } = require("../statistik");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const DATEIEN = [
  ...fs
    .readdirSync(path.join(WURZEL, "public", "js"))
    .filter((d) => d.endsWith(".js"))
    .map((d) => path.join(WURZEL, "public", "js", d)),
  path.join(WURZEL, "public", "app.js"),
];

/* Phasen-Literale: in Zeilen mit `phase:` / `phase =` / `const phase` und als
   zweiter Wert von meldeSichtbarenFehler(...). */
function gefundenePhasen() {
  const gefunden = new Set();
  for (const datei of DATEIEN) {
    for (const zeile of fs.readFileSync(datei, "utf8").split("\n")) {
      if (/\bphase\s*[:=]/.test(zeile) || /\bconst phase\b/.test(zeile)) {
        for (const m of zeile.matchAll(/"([a-z][a-z0-9-]{1,49})"/g)) gefunden.add(m[1]);
      }
      const melde = zeile.match(/meldeSichtbarenFehler\(\s*"[^"]*"\s*,\s*"([a-z][a-z0-9-]{1,49})"/);
      if (melde) gefunden.add(melde[1]);
    }
  }
  /* Kein Phasenname, sondern ein Typvergleich in error-logger.js. */
  gefunden.delete("string");
  return gefunden;
}

test("Positivkontrolle: die Suche findet bekannte Phasen", () => {
  const g = gefundenePhasen();
  for (const bekannt of ["queue-poll", "uebergabe-pause", "auswahl-leer-nach-foto", "resume-nach-abriss"]) {
    expect(g).toContain(bekannt);
  }
  expect(g.size).toBeGreaterThan(15);
});

test("jede Phase aus dem Browser-Code steht in PHASEN", () => {
  const fehlend = [...gefundenePhasen()].filter((p) => !PHASEN.includes(p)).sort();
  expect(fehlend).toEqual([]);
});
