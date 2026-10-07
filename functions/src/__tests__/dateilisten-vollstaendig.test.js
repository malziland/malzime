/**
 * dateilisten-vollstaendig.test.js — die Dateilisten für Mitwirkende nennen
 * jede Programmdatei (DOC-2026-10-04-16).
 *
 * AGENTS.md, README.md und docs/ARCHITECTURE.md führen je eine Liste der
 * Programmdateien mit einem Satz dazu, was die Datei tut. Diese Listen liest,
 * wer am Projekt arbeitet, zuerst — Mensch wie Werkzeug. Am 04.10.2026 fehlten
 * in einer davon 14 Server-Dateien, am 07.10. nach den Aufteilungen 57 Zeilen
 * über alle drei: Eine neue Datei entsteht, die Liste bleibt, und nichts wird
 * rot.
 *
 * Geprüft wird: Jede Datei unter functions/src/*.js und public/js/*.js hat in
 * jeder Liste GENAU eine Zeile, die mit ihrem Namen beginnt. Keine Zeile =
 * vergessen, zwei Zeilen = beim Umbenennen stehen geblieben.
 *
 * Wer eine Programmdatei anlegt, umbenennt oder löscht, zieht die drei Listen
 * im selben Commit nach.
 */

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "../../..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\n");
const dateienIn = (ordner) =>
  fs
    .readdirSync(path.join(WURZEL, ordner))
    .filter((name) => name.endsWith(".js"))
    .sort();

const SERVER = dateienIn("functions/src");
const BROWSER = dateienIn("public/js");

const maskiert = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Wie eine Zeile der jeweiligen Liste beginnt. Nach dem Namen folgt ein
   Leerzeichen, ein Rückstrich oder das Zeilenende — sonst zählte "stats.js"
   auch in der Zeile von "handle-stats.js". */
const LISTEN = [
  ["AGENTS.md", "Server", SERVER, (name) => new RegExp(`^  ${maskiert(name)}( |$)`)],
  ["AGENTS.md", "Browser", BROWSER, (name) => new RegExp(`^    ${maskiert(name)}( |$)`)],
  ["README.md", "Server", SERVER, (name) => new RegExp(`^  ${maskiert(name)}( |$)`)],
  ["docs/ARCHITECTURE.md", "Server", SERVER, (name) => new RegExp(`^\\| \`${maskiert(name)}\``)],
  ["docs/ARCHITECTURE.md", "Browser", BROWSER, (name) => new RegExp(`^\\| \`js/${maskiert(name)}\``)],
];

/** Dateien, die in der Liste nicht genau einmal stehen: ["name: 0 Zeilen", …]. */
function abweichungen(zeilen, dateien, muster) {
  return dateien
    .map((name) => [name, zeilen.filter((zeile) => muster(name).test(zeile)).length])
    .filter(([, anzahl]) => anzahl !== 1)
    .map(([name, anzahl]) => `${name}: ${anzahl} Zeilen`);
}

test("die Ordner sind gelesen (Messmittel-Kontrolle)", () => {
  expect(SERVER).toContain("index.js");
  expect(SERVER.length).toBeGreaterThan(40);
  expect(BROWSER).toContain("api.js");
  expect(BROWSER.length).toBeGreaterThan(20);
});

test.each(LISTEN)("%s nennt jede %s-Datei genau einmal", (datei, _art, dateien, muster) => {
  expect(abweichungen(lies(datei), dateien, muster)).toEqual([]);
});

describe("Gegenprobe: die Prüfung wird rot", () => {
  const [datei, , , muster] = LISTEN[0];

  test("eine Datei, die es nicht gibt, fehlt in der Liste", () => {
    expect(abweichungen(lies(datei), ["gibt-es-nicht.js"], muster)).toEqual(["gibt-es-nicht.js: 0 Zeilen"]);
  });

  test("eine doppelte Zeile wird gemeldet", () => {
    const zeilen = lies(datei);
    const zeile = zeilen.find((z) => muster("index.js").test(z));
    expect(abweichungen([...zeilen, zeile], ["index.js"], muster)).toEqual(["index.js: 2 Zeilen"]);
  });

  test("ein Name, der nur am Ende eines anderen steht, zählt nicht", () => {
    expect(abweichungen(["  handle-stats.js  Stats-Handler"], ["stats.js"], muster)).toEqual(["stats.js: 0 Zeilen"]);
  });
});
