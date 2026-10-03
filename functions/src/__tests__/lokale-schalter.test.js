"use strict";

/* OPS-2026-10-03-09: Schalter fuer lokale Laeufe (Attrappe statt KI, lokale
   Warteschlange, stumme Benachrichtigung) duerfen in der Produktion nie wirken
   — auch dann nicht, wenn sie dort versehentlich gesetzt sind.

   Geprueft wird dreifach:
     1. die Erkennung "laeuft in der Produktion" selbst,
     2. jede Lesestelle im Programm (Attrappe, Warteschlange, Benachrichtigung),
     3. der Einstiegspunkt index.js: Er startet in der Produktion gar nicht erst,
        wenn ein solcher Schalter gesetzt ist — eine Auslieferung mit falscher
        Einstellung scheitert damit sichtbar, statt still falsch zu laufen.
   Dazu ein Waechter ueber den Quelltext: Die drei Namen werden nirgends mehr
   direkt aus der Umgebung gelesen. */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

jest.mock("firebase-admin/app", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name) => ({ name, value: () => "" })),
}));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const SCHALTER = ["MISTRAL_MOCK", "QUEUE_LOCAL", "NTFY_STUMM"];
const BERUEHRT = ["K_SERVICE", "FUNCTIONS_EMULATOR", ...SCHALTER];

const PRODUKTION = { K_SERVICE: "enqueue" };
const EMULATOR = { K_SERVICE: "enqueue", FUNCTIONS_EMULATOR: "true" };
const LOKAL = {};

let vorher;

beforeEach(() => {
  vorher = {};
  for (const name of BERUEHRT) {
    vorher[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of BERUEHRT) {
    if (vorher[name] === undefined) delete process.env[name];
    else process.env[name] = vorher[name];
  }
  jest.resetModules();
});

function setze(werte) {
  for (const [name, wert] of Object.entries(werte)) process.env[name] = wert;
}

describe("Erkennung: laeuft das Programm in der Produktion?", () => {
  const { laeuftInProduktion } = require("../lokale-schalter");

  test.each([
    ["Cloud Run (K_SERVICE gesetzt, kein Emulator)", PRODUKTION, true],
    ["Emulator (setzt K_SERVICE UND FUNCTIONS_EMULATOR)", EMULATOR, false],
    ["Testlauf oder Skript am eigenen Rechner (nichts gesetzt)", LOKAL, false],
    [
      "FUNCTIONS_EMULATOR mit anderem Wert zaehlt nicht als Emulator",
      { K_SERVICE: "x", FUNCTIONS_EMULATOR: "1" },
      true,
    ],
  ])("%s", (_name, umgebung, erwartet) => {
    expect(laeuftInProduktion(umgebung)).toBe(erwartet);
  });
});

describe("lokalSchalterAn: ein lokaler Schalter wirkt nur ausserhalb der Produktion", () => {
  const { lokalSchalterAn, NUR_LOKAL } = require("../lokale-schalter");

  test("die Liste nennt genau die drei Schalter", () => {
    expect([...NUR_LOKAL].sort()).toEqual([...SCHALTER].sort());
  });

  test.each(SCHALTER)("%s=1 wirkt am eigenen Rechner und im Emulator", (name) => {
    expect(lokalSchalterAn(name, { ...LOKAL, [name]: "1" })).toBe(true);
    expect(lokalSchalterAn(name, { ...EMULATOR, [name]: "1" })).toBe(true);
  });

  test.each(SCHALTER)("%s=1 wirkt in der Produktion NICHT", (name) => {
    expect(lokalSchalterAn(name, { ...PRODUKTION, [name]: "1" })).toBe(false);
  });

  test.each(SCHALTER)("%s ohne den Wert 1 ist aus", (name) => {
    expect(lokalSchalterAn(name, { ...LOKAL })).toBe(false);
    expect(lokalSchalterAn(name, { ...LOKAL, [name]: "0" })).toBe(false);
    expect(lokalSchalterAn(name, { ...LOKAL, [name]: "true" })).toBe(false);
  });

  test("ein Name ausserhalb der Liste wird abgelehnt statt still gelesen", () => {
    expect(() => lokalSchalterAn("IRGENDWAS", { IRGENDWAS: "1" })).toThrow(/kein lokaler Schalter/);
  });
});

describe("Lesestellen im Programm", () => {
  test("Attrappe: am eigenen Rechner ja, in der Produktion nie", () => {
    setze({ MISTRAL_MOCK: "1" });
    jest.isolateModules(() => {
      expect(require("../job-helfer").getMistral()).toBe(require("../mistral-mock"));
    });
    setze(PRODUKTION);
    jest.isolateModules(() => {
      const mistral = require("../job-helfer").getMistral();
      expect(mistral).toBe(require("../mistral"));
      expect(mistral).not.toBe(require("../mistral-mock"));
    });
  });

  test("Erfolgsweg: ohne Schalter ist es immer die echte KI-Anbindung", () => {
    jest.isolateModules(() => {
      expect(require("../job-helfer").getMistral()).toBe(require("../mistral"));
    });
  });

  test("lokale Warteschlange: am eigenen Rechner ja, in der Produktion nie", () => {
    setze({ QUEUE_LOCAL: "1" });
    expect(require("../config").isLocalQueueMode()).toBe(true);
    setze(PRODUKTION);
    expect(require("../config").isLocalQueueMode()).toBe(false);
  });

  describe("Benachrichtigung", () => {
    const notify = require("../notify");
    let gesendet;

    beforeEach(() => {
      gesendet = [];
      notify.setFetchForTest(async (url, init) => {
        gesendet.push({ url, init });
        return { ok: true, text: async () => "" };
      });
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      notify.setFetchForTest(null);
      console.log.mockRestore();
    });

    const meldung = { ntfyUrl: "https://ntfy.invalid", ntfyTopic: "probe", text: "Probe" };

    test("NTFY_STUMM=1 am eigenen Rechner: nichts geht hinaus", async () => {
      setze({ NTFY_STUMM: "1" });
      expect(await notify.sendeNtfy(meldung)).toBe(false);
      expect(gesendet).toHaveLength(0);
    });

    test("NTFY_STUMM=1 in der Produktion: die Meldung geht trotzdem hinaus", async () => {
      setze({ ...PRODUKTION, NTFY_STUMM: "1" });
      expect(await notify.sendeNtfy(meldung)).toBe(true);
      expect(gesendet).toHaveLength(1);
    });

    test("Erfolgsweg: ohne Schalter geht die Meldung hinaus", async () => {
      expect(await notify.sendeNtfy(meldung)).toBe(true);
      expect(gesendet).toHaveLength(1);
    });
  });
});

describe("Einstiegspunkt index.js", () => {
  /* Am echten Programmstart geprueft, in einem eigenen Node-Prozess — so wie
     Cloud Run die Datei laedt. Die Umgebung wird vollstaendig vorgegeben, damit
     nichts aus dem Testlauf hineinwirkt. */
  function starteIndex(umgebung) {
    return spawnSync(process.execPath, ["-e", 'require("./src/index")'], {
      cwd: path.join(__dirname, "..", ".."),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...umgebung },
      encoding: "utf8",
      timeout: 60000,
    });
  }

  test.each(SCHALTER)("startet in der Produktion nicht, wenn %s=1 gesetzt ist", (name) => {
    const lauf = starteIndex({ ...PRODUKTION, [name]: "1" });
    expect(lauf.status).not.toBe(0);
    expect(lauf.stderr).toContain("Start verweigert");
    expect(lauf.stderr).toContain(name);
    expect(lauf.stderr).toMatch(/Produktion/);
  });

  test("nennt alle gesetzten Schalter auf einmal", () => {
    const lauf = starteIndex({ ...PRODUKTION, MISTRAL_MOCK: "1", NTFY_STUMM: "1" });
    expect(lauf.status).not.toBe(0);
    expect(lauf.stderr).toContain("MISTRAL_MOCK, NTFY_STUMM");
  });

  test("Erfolgsweg: startet in der Produktion ohne Schalter", () => {
    const lauf = starteIndex(PRODUKTION);
    expect(lauf.stderr).not.toContain("Start verweigert");
    expect(lauf.status).toBe(0);
  });

  test("startet im Emulator und am eigenen Rechner auch mit Schaltern", () => {
    const alle = Object.fromEntries(SCHALTER.map((name) => [name, "1"]));
    expect(starteIndex({ ...EMULATOR, ...alle }).status).toBe(0);
    expect(starteIndex({ ...LOKAL, ...alle }).status).toBe(0);
  });

  test("die Verweigerung steht vor allem anderen", () => {
    const quelle = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
    expect(ohneKommentare.startsWith('require("./lokale-schalter").verweigereLokalSchalterInProduktion();')).toBe(true);
  });
});

describe("Waechter ueber den Quelltext", () => {
  const SRC = path.join(__dirname, "..");
  const AUSGENOMMEN = new Set(["__tests__", "scripts", "node_modules"]);

  function programmDateien(ordner) {
    const aus = [];
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (AUSGENOMMEN.has(eintrag.name)) continue;
      const voll = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) aus.push(...programmDateien(voll));
      else if (eintrag.name.endsWith(".js")) aus.push(voll);
    }
    return aus;
  }

  /* Der Name als ganzes Wort: MISTRAL_MOCK_DELAY_MS oder QUEUE_LOCAL_CONCURRENCY
     sind andere Variablen und bleiben erlaubt. */
  const DIREKT = new RegExp(`process\\.env\\.(${SCHALTER.join("|")})(?![A-Z0-9_])`);

  test("die Suche findet ueberhaupt etwas (Positivkontrolle)", () => {
    expect(DIREKT.test('if (process.env.MISTRAL_MOCK === "1") {')).toBe(true);
    expect(DIREKT.test("Number(process.env.MISTRAL_MOCK_DELAY_MS)")).toBe(false);
    expect(programmDateien(SRC).length).toBeGreaterThan(20);
  });

  test("kein Programmteil liest einen lokalen Schalter direkt aus der Umgebung", () => {
    const treffer = [];
    for (const datei of programmDateien(SRC)) {
      fs.readFileSync(datei, "utf8")
        .split("\n")
        .forEach((zeile, i) => {
          if (DIREKT.test(zeile)) treffer.push(`${path.relative(SRC, datei)}:${i + 1}`);
        });
    }
    expect(treffer).toEqual([]);
  });
});
