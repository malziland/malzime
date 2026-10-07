/**
 * doku-namen-gegen-quelltext.test.js — die Unterlagen nennen keine Funktion
 * und kein Feld, das es im Projekt nicht mehr gibt (DOC-2026-10-03-50, -53).
 *
 * Die Unterlagen nennen Funktionen, Felder und Schalter beim Namen, in
 * Rückstrichen. Wird im Programm etwas umbenannt oder ausgebaut, bleibt der
 * Name in der Doku stehen — sie beschreibt dann einen Weg, den es nicht mehr
 * gibt (am 07.10.2026 etwa `classifyDescription` und `extractVisibleText`,
 * Wochen nach ihrem Ausbau).
 *
 * Geprüft wird: Jeder Name in Höckerschrift, der in einer der Unterlagen in
 * Rückstrichen steht, kommt irgendwo im Projekt außerhalb der Unterlagen vor
 * (Programm, Tests, Skripte, Einstellungen). Mehr nicht — ob der Satz darum
 * herum stimmt, kann nur lesen, wer ihn liest.
 *
 * Namen fremder Schnittstellen (Google, GitHub) stehen in FREMDE_NAMEN, mit
 * dem Dienst, zu dem sie gehören.
 */

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "../../..");

const UNTERLAGEN = [
  "AGENTS.md",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY-MODEL.md",
  "docs/SETUP.md",
  "docs/SELF-HOSTING.md",
  "docs/RUNBOOK.md",
  "docs/FLAGS.md",
  "docs/BETRIEBSPROFILE.md",
  "docs/WAECHTER.md",
  "docs/ERROR-ALERTING.md",
  "docs/QUEUE-EMULATOR.md",
];

/* Wo ein Name vorkommen darf: alles, was das Projekt selbst ausmacht. */
const SUCHORTE = ["functions/src", "public/js", "public/__tests__", "scripts", "e2e", ".github"];
const EINZELDATEIEN = ["public/app.js", "firebase.json", "package.json", "functions/package.json", "firestore.rules"];
const ENDUNGEN = [".js", ".mjs", ".cjs", ".sh", ".py", ".json", ".yml", ".yaml", ".rules", ".txt"];
const UEBERGEHEN = new Set(["node_modules", "negativprobe", ".git", "__pycache__"]);

const FREMDE_NAMEN = {
  notificationRateLimit: "Feld einer Alarmregel bei Google Cloud Monitoring",
  requiredDnsUpdates: "Feld der Antwort von Firebase Hosting zu einer Domain",
};

function sammle(ordner, liste = []) {
  const voll = path.join(WURZEL, ordner);
  if (!fs.existsSync(voll)) return liste;
  for (const eintrag of fs.readdirSync(voll, { withFileTypes: true })) {
    if (UEBERGEHEN.has(eintrag.name)) continue;
    const rel = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) sammle(rel, liste);
    else if (ENDUNGEN.some((endung) => eintrag.name.endsWith(endung))) liste.push(rel);
  }
  return liste;
}

const projektText = [...SUCHORTE.flatMap((ordner) => sammle(ordner)), ...EINZELDATEIEN]
  .filter((datei) => fs.existsSync(path.join(WURZEL, datei)))
  .map((datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8"))
  .join("\n");

/* Höckerschrift: beginnt klein, hat mindestens einen Großbuchstaben mittendrin
   (`runSingleLargeCall`, `useBeastAdsCall`, `jobAufbewahrungMs`). Ein
   angehängtes "()" gehört nicht zum Namen. */
const NAME_IN_RUECKSTRICHEN = /`([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+)(?:\(\))?`/g;

function namenIn(text) {
  return [...text.matchAll(NAME_IN_RUECKSTRICHEN)].map((treffer) => treffer[1]);
}

const kommtVor = (name, text) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text);

/** Namen einer Unterlage, die im Projekt nicht vorkommen: ["datei:zeile name", …]. */
function verwaiste(datei, inhalt, text) {
  const funde = [];
  inhalt.split("\n").forEach((zeile, i) => {
    for (const name of namenIn(zeile)) {
      if (FREMDE_NAMEN[name] || kommtVor(name, text)) continue;
      funde.push(`${datei}:${i + 1} ${name}`);
    }
  });
  return funde;
}

test("Projekt und Unterlagen sind gelesen (Messmittel-Kontrolle)", () => {
  expect(projektText.length).toBeGreaterThan(500000);
  expect(kommtVor("runSingleLargeCall", projektText)).toBe(true);
  const alle = UNTERLAGEN.flatMap((datei) => namenIn(fs.readFileSync(path.join(WURZEL, datei), "utf8")));
  expect(new Set(alle).size).toBeGreaterThan(50);
});

test.each(UNTERLAGEN)("%s nennt keinen Namen, den es im Projekt nicht gibt", (datei) => {
  const inhalt = fs.readFileSync(path.join(WURZEL, datei), "utf8");
  expect(verwaiste(datei, inhalt, projektText)).toEqual([]);
});

test("jeder fremde Name wird noch gebraucht — sonst raus aus der Liste", () => {
  const alle = UNTERLAGEN.map((datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8")).join("\n");
  const unbenutzt = Object.keys(FREMDE_NAMEN).filter((name) => !namenIn(alle).includes(name));
  expect(unbenutzt).toEqual([]);
});

describe("Gegenprobe: die Prüfung wird rot", () => {
  test("ein ausgebauter Name wird gemeldet, mit Datei und Zeile", () => {
    /* Der Name wird hier zusammengesetzt — stuende er am Stueck in dieser
       Datei, kaeme er im Projekt vor und gaelte als vorhanden. */
    const name = ["ausgebaute", "Funktion", "Xyz"].join("");
    const inhalt = `Erste Zeile.\nDas Motiv liest \`${name}()\` aus der Kopfzeile.`;
    expect(verwaiste("probe.md", inhalt, projektText)).toEqual([`probe.md:2 ${name}`]);
  });

  test("ein Name, der nur als Teil eines längeren vorkommt, zählt nicht als vorhanden", () => {
    expect(kommtVor("handleEnq", "async function handleEnqueue(req, res) {}")).toBe(false);
    expect(kommtVor("handleEnqueue", "async function handleEnqueue(req, res) {}")).toBe(true);
  });
});
