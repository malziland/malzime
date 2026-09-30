const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Wächter für scripts/pruefe-abkuendigungen.mjs (Befund OPS-2026-09-30-03).
 *
 * GitHub hat bei jedem Lauf gewarnt, dass ein Baustein auf das abgekündigte
 * Node 20 zielt — gelesen hat es niemand, die Läufe waren grün. Das Skript
 * liest diese Hinweise nachts. Die Tests belegen, dass es die echten Texte vom
 * September 2026 erkennt, Ausnahmen nur mit Begründung und nur bis zum
 * Ablaufdatum gelten, und dass "nichts gelesen" nie als "alles gut" endet.
 *
 * Kein Netz: Die Läufe kommen über den Einspeisepunkt ABKUENDIGUNG_DATEN.
 */

const SKRIPT = path.join(__dirname, "../../../scripts/pruefe-abkuendigungen.mjs");
const REPO = path.join(__dirname, "../../..");

/* Wörtlich aus CI-Lauf 36640625061 (29.09.2026). */
const NODE20 =
  "Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065.";
const UBUNTU =
  "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026. For more information, see https://github.com/actions/runner-images/issues/14748";

let basis;

beforeEach(() => {
  basis = fs.mkdtempSync(path.join(os.tmpdir(), "abkuendigungen-"));
});

afterEach(() => {
  fs.rmSync(basis, { recursive: true, force: true });
});

function daten(laeufe) {
  const p = path.join(basis, "laeufe.json");
  fs.writeFileSync(p, JSON.stringify(laeufe));
  return p;
}

function ausnahmen(liste) {
  const p = path.join(basis, "ausnahmen.json");
  fs.writeFileSync(p, JSON.stringify({ ausnahmen: liste }));
  return p;
}

function lauf({ datenPfad, ausnahmenPfad, heute = "2026-09-30" }) {
  try {
    const aus = execFileSync("node", [SKRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        ABKUENDIGUNG_DATEN: datenPfad,
        ABKUENDIGUNG_AUSNAHMEN: ausnahmenPfad || path.join(basis, "keine.json"),
        ABKUENDIGUNG_HEUTE: heute,
      },
    });
    return { code: 0, aus, fehler: "" };
  } catch (e) {
    return { code: e.status, aus: e.stdout || "", fehler: e.stderr || "" };
  }
}

const ubuntuAusnahme = {
  muster: "The ubuntu-latest label will migrate to Ubuntu 26",
  grund: "GitHub stellt selbst um",
  eingetragen: "2026-09-30",
  pruefen_bis: "2026-11-20",
};

test("die echte Node-20-Warnung wird erkannt: rot", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [{ annotation_level: "warning", message: NODE20 }] }]),
  });
  expect(r.code).toBe(1);
  expect(r.aus).toContain("Node.js 20 is deprecated");
});

test("der echte Ubuntu-Hinweis (Stufe notice) wird erkannt: rot ohne Ausnahme", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [{ annotation_level: "notice", message: UBUNTU }] }]),
  });
  expect(r.code).toBe(1);
});

test("mit gültiger Ausnahme: grün, aber sichtbar ausgegeben", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [{ annotation_level: "notice", message: UBUNTU }] }]),
    ausnahmenPfad: ausnahmen([ubuntuAusnahme]),
  });
  expect(r.code).toBe(0);
  expect(r.aus).toContain("[Ausnahme]");
});

test("nach dem Ablaufdatum: wieder rot", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [{ annotation_level: "notice", message: UBUNTU }] }]),
    ausnahmenPfad: ausnahmen([ubuntuAusnahme]),
    heute: "2026-11-21",
  });
  expect(r.code).toBe(1);
});

test("Ausnahme ohne Begründung ist ungültig", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [] }]),
    ausnahmenPfad: ausnahmen([{ ...ubuntuAusnahme, grund: "" }]),
  });
  expect(r.code).toBe(1);
  expect(r.aus).toContain("AUSNAHME UNGUELTIG");
});

test("eine Ausnahme deckt nur ihren eigenen Hinweis", () => {
  const r = lauf({
    datenPfad: daten([
      {
        lauf: "CI #903",
        hinweise: [
          { annotation_level: "notice", message: UBUNTU },
          { annotation_level: "warning", message: NODE20 },
        ],
      },
    ]),
    ausnahmenPfad: ausnahmen([ubuntuAusnahme]),
  });
  expect(r.code).toBe(1);
  expect(r.aus).toContain("Node.js 20 is deprecated");
});

test("gewöhnliche Testfehler sind kein Abkündigungshinweis", () => {
  const r = lauf({
    datenPfad: daten([
      { lauf: "CI #904", hinweise: [{ annotation_level: "failure", message: "expect(received).toBe(expected)" }] },
    ]),
  });
  expect(r.code).toBe(0);
});

test("kein einziger Lauf gelesen: 2, nicht grün", () => {
  const r = lauf({ datenPfad: daten([]) });
  expect(r.code).toBe(2);
  expect(r.fehler).toContain("MESSUNG NICHT DURCHFUEHRBAR");
});

test("die echte Ausnahmeliste ist vollständig ausgefüllt", () => {
  const echt = JSON.parse(fs.readFileSync(path.join(REPO, ".github/abkuendigungen-ausnahmen.json"), "utf8"));
  for (const a of echt.ausnahmen) {
    for (const feld of ["muster", "grund", "eingetragen", "pruefen_bis"]) {
      expect(a[feld]).toBeTruthy();
    }
    expect(a.pruefen_bis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
