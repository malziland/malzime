"use strict";

/* Jeder Meldungs-Schluessel, den der Server an den Browser gibt, hat einen Text
   in BEIDEN Sprachdateien (TEST-2026-10-03-42).

   Der Server schickt keine Saetze, sondern Schluessel: `blocked.*` als Grund
   eines blockierten Ergebnisses, `privacy.*` als Hinweis auf lesbare
   Angaben im Bild. Den Satz dazu holt der Browser aus public/locales/. Fehlt
   dort ein Schluessel, sieht das Kind den rohen Schluessel statt einer
   Meldung — und keine Pruefung haette es bemerkt.

   Gesucht wird im Quelltext des Servers nach den Schluesseln als Zeichenkette;
   ein neuer Schluessel faellt damit von selbst unter die Pruefung. */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");
const WURZEL = path.join(SRC, "..", "..");
const MUSTER = /["'`]((?:blocked|privacy)\.[A-Za-z][A-Za-z0-9]*)["'`]/g;

function schluesselImServer() {
  const funde = new Map();
  for (const name of fs.readdirSync(SRC).filter((n) => n.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(SRC, name), "utf8");
    for (const treffer of text.matchAll(MUSTER)) {
      if (!funde.has(treffer[1])) funde.set(treffer[1], name);
    }
  }
  return funde;
}

const sprachdatei = (sprache) =>
  JSON.parse(fs.readFileSync(path.join(WURZEL, "public", "locales", `${sprache}.json`), "utf8"));

const FUNDE = schluesselImServer();

test("Messmittel: die Suche findet die bekannten Schluessel", () => {
  expect([...FUNDE.keys()]).toEqual(
    expect.arrayContaining([
      "blocked.apiError",
      "blocked.overloaded",
      "blocked.profileBlocked",
      "blocked.configMissing",
      "privacy.address",
      "privacy.phone",
      "privacy.licensePlate",
    ])
  );
});

test("Messmittel: das Muster erkennt einen Schluessel in allen drei Schreibweisen", () => {
  const beispiel = 'a("blocked.neu"); b(\'privacy.neu\'); c(`blocked.drei`); d("blockiert.nicht"); e("blocked.");';
  expect([...beispiel.matchAll(MUSTER)].map((t) => t[1])).toEqual(["blocked.neu", "privacy.neu", "blocked.drei"]);
});

describe.each([["de"], ["en"]])("Sprachdatei %s", (sprache) => {
  const texte = sprachdatei(sprache);

  test.each([...FUNDE.entries()])("%s (aus %s) hat einen Text", (schluessel) => {
    expect(typeof texte[schluessel]).toBe("string");
    expect(texte[schluessel].trim().length).toBeGreaterThan(0);
  });
});
