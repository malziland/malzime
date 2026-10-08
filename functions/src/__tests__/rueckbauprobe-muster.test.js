/**
 * rueckbauprobe-muster.test.js — jedes Muster der Rückbauprobe steht noch im
 * Programm.
 *
 * scripts/rueckbauprobe-betriebswerte.sh baut zehn behobene Befunde zur Probe
 * wieder ein und sieht nach, ob die Tests es merken. Die Stelle findet sie über
 * ein Stück Quelltext. Wird die Stelle umgebaut oder zieht sie in eine andere
 * Datei, findet die Probe sie nicht mehr und misst nichts. Das fiel dreimal
 * erst spät auf (31.08., 10.09. und 08.10.2026 — zuletzt nach einer
 * Auslieferung), weil die Probe nur im Prüfstand-Lauf fährt.
 *
 * Geprüft wird hier bei jedem Testlauf, in Millisekunden: Jede Probe nennt eine
 * Datei, die es gibt; ihr Muster steht darin; der Rückbau ändert etwas; jede
 * genannte Testdatei gibt es. Ob die Tests den Rückbau dann merken, misst
 * weiterhin nur die Probe selbst.
 *
 * Wer eine dieser Stellen umbaut, zieht die Probe im selben Commit nach.
 */

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "../../..");
/* Die Probe wechselt nach functions/ — ihre Pfade gelten von dort. */
const FUNCTIONS = path.join(WURZEL, "functions");
const SKRIPT = fs.readFileSync(path.join(WURZEL, "scripts/rueckbauprobe-betriebswerte.sh"), "utf8");

/* Ein Aufruf: probe "Name" \ "Datei" \ 'Muster' \ 'Rückbau' \ "Testdateien".
   Muster und Rückbau stehen in einfachen Anführungszeichen und dürfen über
   mehrere Zeilen gehen. */
const AUFRUF = /^probe "([^"]+)" \\\n\s+"([^"]+)" \\\n\s+'([^']*)' \\\n\s+'([^']*)' \\\n\s+"([^"]+)"$/gm;

const PROBEN = [...SKRIPT.matchAll(AUFRUF)].map(([, name, datei, muster, rueckbau, suiten]) => ({
  name,
  datei,
  muster,
  rueckbau,
  suiten: suiten.split(/\s+/).filter(Boolean),
}));

const liesAusFunctions = (datei) => {
  const voll = path.join(FUNCTIONS, datei);
  return fs.existsSync(voll) ? fs.readFileSync(voll, "utf8") : null;
};

/** Woran eine Probe scheitern würde, bevor sie etwas misst: ["…", …]. */
function fehlstellen(probe, lies = liesAusFunctions) {
  const funde = [];
  const inhalt = lies(probe.datei);
  if (inhalt === null) funde.push(`Datei fehlt: ${probe.datei}`);
  else if (!inhalt.includes(probe.muster)) funde.push(`Muster steht nicht in ${probe.datei}`);
  if (probe.muster === probe.rueckbau) funde.push("Rückbau ändert nichts");
  for (const suite of probe.suiten) {
    if (lies(suite) === null) funde.push(`Testdatei fehlt: ${suite}`);
  }
  return funde;
}

test("jeder Aufruf der Probe ist gelesen (Messmittel-Kontrolle)", () => {
  const aufrufe = SKRIPT.split("\n").filter((zeile) => zeile.startsWith('probe "')).length;
  const angesagt = SKRIPT.match(/Alle (\d+) Rueckbauten werden bemerkt/);
  expect(PROBEN.length).toBeGreaterThanOrEqual(10);
  expect(PROBEN.length).toBe(aufrufe);
  expect(angesagt).not.toBeNull();
  expect(PROBEN.length).toBe(Number(angesagt[1]));
});

test.each(PROBEN.map((probe) => [probe.name, probe]))("%s — die Probe findet ihre Stelle", (_name, probe) => {
  expect(fehlstellen(probe)).toEqual([]);
});

describe("Gegenprobe: die Prüfung wird rot", () => {
  const echte = PROBEN[0];

  test("ein Muster, das nach einem Umbau nicht mehr im Programm steht", () => {
    const umgebaut = { ...echte, muster: `${echte.muster} /* nach dem Umbau anders */` };
    expect(fehlstellen(umgebaut)).toEqual([`Muster steht nicht in ${echte.datei}`]);
  });

  test("eine Stelle, die in eine andere Datei gezogen ist", () => {
    const gewandert = { ...echte, datei: "src/handle-enqueue.js" };
    expect(fehlstellen(gewandert)).toEqual(["Muster steht nicht in src/handle-enqueue.js"]);
  });

  test("eine Datei oder Testdatei, die es nicht mehr gibt", () => {
    const ohneDatei = { ...echte, datei: "src/gibt-es-nicht.js" };
    expect(fehlstellen(ohneDatei)).toEqual(["Datei fehlt: src/gibt-es-nicht.js"]);
    const ohneSuite = { ...echte, suiten: ["src/__tests__/gibt-es-nicht.test.js"] };
    expect(fehlstellen(ohneSuite)).toEqual(["Testdatei fehlt: src/__tests__/gibt-es-nicht.test.js"]);
  });

  test("ein Rückbau, der nichts ändert", () => {
    expect(fehlstellen({ ...echte, rueckbau: echte.muster })).toEqual(["Rückbau ändert nichts"]);
  });
});
