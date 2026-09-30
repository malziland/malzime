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

test("G-04: Ablaufdatum in anderer Schreibweise ist ungültig und läuft nicht ewig", () => {
  const r = lauf({
    datenPfad: daten([{ lauf: "CI #903", hinweise: [{ annotation_level: "notice", message: UBUNTU }] }]),
    ausnahmenPfad: ausnahmen([{ ...ubuntuAusnahme, pruefen_bis: "20.11.2026" }]),
    heute: "2099-01-01",
  });
  expect(r.code).toBe(1);
  expect(r.aus).toContain("AUSNAHME UNGUELTIG");
  expect(r.aus).not.toContain("[Ausnahme]");
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

/* ── Der echte Netzweg (Befunde H-12, J-02, J-03) ────────────────────────────
   Die Tests oben speisen die Läufe fertig ein. Hier läuft der Code, der die
   Workflows einzeln abfragt, blättert, fremde und leere Läufe aussortiert und
   ungesehene Workflows meldet — gegen eine Attrappe von fetch. */
describe("pruefe-abkuendigungen: Netzweg", () => {
  const API = "https://api.github.com/repos/test/repo/actions";
  const eigenes = { full_name: "test/repo" };
  const fremdes = { full_name: "jemand/fork" };
  const lauf = (id, name, weiteres = {}) => ({
    id,
    name,
    run_number: 1,
    head_sha: "abcdef1234567",
    conclusion: "success",
    event: "push",
    head_repository: eigenes,
    ...weiteres,
  });
  const uebersprungen = (n, start) =>
    Array.from({ length: n }, (_, i) =>
      lauf(start + i, "Auto-Merge", { conclusion: "skipped", event: "pull_request" })
    );
  const seite = (wf, main, nr) =>
    `${API}/workflows/${wf}/runs?status=completed${main ? "&branch=main" : ""}&per_page=100&page=${nr}`;
  const leer = { workflow_runs: [] };

  function karte({ autoMergeHinweis = false, neuerWorkflow = false, ciMain = [lauf(11, "CI")] } = {}) {
    const workflows = [
      { id: 1, name: "CI", state: "active" },
      { id: 2, name: "Auto-Merge", state: "active" },
      { id: 4, name: "Alt", state: "disabled_manually" },
    ];
    if (neuerWorkflow) workflows.push({ id: 3, name: "Neu", state: "active" });
    return {
      [`${API}/workflows?per_page=100`]: { body: { workflows } },
      [seite(1, true, 1)]: { body: { workflow_runs: ciMain } },
      [seite(1, false, 1)]: { body: { workflow_runs: [lauf(12, "CI", { event: "pull_request" })] } },
      [`${API}/runs/11/jobs?per_page=100`]: { body: { jobs: [{ id: 111, name: "test" }] } },
      [`${API}/runs/12/jobs?per_page=100`]: { body: { jobs: [{ id: 121, name: "test" }] } },
      ["https://api.github.com/repos/test/repo/check-runs/111/annotations?per_page=100"]: { body: [] },
      ["https://api.github.com/repos/test/repo/check-runs/121/annotations?per_page=100"]: { body: [] },
      /* Auto-Merge läuft nie auf main — und auf Seite 1 stehen nur 100
         übersprungene Läufe; der zählende steht erst auf Seite 2 (J-02). */
      [seite(2, true, 1)]: { body: leer },
      [seite(2, false, 1)]: { body: { workflow_runs: uebersprungen(100, 1000) } },
      [seite(2, false, 2)]: {
        body: { workflow_runs: [...uebersprungen(3, 2000), lauf(22, "Auto-Merge", { event: "pull_request" })] },
      },
      [`${API}/runs/22/jobs?per_page=100`]: { body: { jobs: [{ id: 222, name: "automerge" }] } },
      ["https://api.github.com/repos/test/repo/check-runs/222/annotations?per_page=100"]: {
        body: autoMergeHinweis ? [{ annotation_level: "warning", message: NODE20 }] : [],
      },
      [seite(3, true, 1)]: { body: leer },
      [seite(3, false, 1)]: { body: leer },
    };
  }

  function netzLauf(k, ausnahmenListe = []) {
    const p = path.join(basis, "fetch.json");
    fs.writeFileSync(p, JSON.stringify(k));
    try {
      const aus = execFileSync("node", [SKRIPT], {
        encoding: "utf8",
        env: {
          ...process.env,
          FETCH_ATTRAPPE: p,
          GITHUB_REPOSITORY: "test/repo",
          ABKUENDIGUNG_DATEN: "",
          ABKUENDIGUNG_AUSNAHMEN: ausnahmen(ausnahmenListe),
          ABKUENDIGUNG_HEUTE: "2026-09-30",
        },
      });
      return { code: 0, aus };
    } catch (e) {
      return { code: e.status, aus: e.stdout || "", fehler: e.stderr || "" };
    }
  }

  test("J-02: der zählende Lauf hinter 103 übersprungenen wird gefunden — kein falscher UNGESEHEN-Alarm", () => {
    const r = netzLauf(karte());
    expect(r.code).toBe(0);
    expect(r.aus).toContain("Gelesen: 2 Lauf/Laeufe");
    expect(r.aus).not.toContain("UNGESEHEN");
  });

  test("Hinweis an diesem Lauf (nur im Pull Request) wird gefunden: rot", () => {
    const r = netzLauf(karte({ autoMergeHinweis: true }));
    expect(r.code).toBe(1);
    expect(r.aus).toContain("Node.js 20 is deprecated");
  });

  test("J-03: ein Fork-Lauf mit Zweig main und ein Lauf 'Freigabe nötig' zählen nicht als letzter Lauf auf main", () => {
    const k = karte({
      ciMain: [
        lauf(91, "CI", { head_repository: fremdes, event: "pull_request" }),
        lauf(92, "CI", { conclusion: "action_required" }),
        lauf(11, "CI"),
      ],
    });
    const r = netzLauf(k);
    /* Gelesen wurde Lauf 11 — für 91 und 92 hat die Attrappe keine Jobs, ein
       Zugriff darauf wäre ein Messfehler (rc 2). */
    expect(r.code).toBe(0);
  });

  test("ein aktiver Workflow ohne jeden zählenden Lauf ist UNGESEHEN: rot", () => {
    const r = netzLauf(karte({ neuerWorkflow: true }));
    expect(r.code).toBe(1);
    expect(r.aus).toContain('UNGESEHEN  Workflow "Neu"');
  });

  test("… mit begründeter Ausnahme: grün, aber sichtbar", () => {
    const r = netzLauf(karte({ neuerWorkflow: true }), [
      { ungesehen: "Neu", grund: "laeuft nur von Hand", eingetragen: "2026-09-30", pruefen_bis: "2027-03-31" },
    ]);
    expect(r.code).toBe(0);
    expect(r.aus).toContain("[Ausnahme] UNGESEHEN");
  });

  test("nicht aktive Workflows werden genannt, nicht still übergangen", () => {
    const r = netzLauf(karte());
    expect(r.aus).toContain("Nicht aktiv, uebergangen: Alt");
  });
});
