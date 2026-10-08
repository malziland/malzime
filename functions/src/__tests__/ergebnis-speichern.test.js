"use strict";

/* Ein fertiges Ergebnis geht nicht verloren, weil sein Speichern einmal
   scheitert (BUG-2026-10-03-30).

   Vorher schrieb der Verarbeiter nach EINEM Schreibfehler "technischer Fehler"
   ueber die fertige, bezahlte Analyse — und die Meldung nannte als Grund die KI
   statt der Datenbank. Jetzt wird derselbe Schreibvorgang mit demselben
   Ergebnis bis zu zweimal wiederholt; erst dann kommt das Ersatz-Ergebnis, und
   die Meldung nennt den Grund "ergebnis_speichern".

   Echte Module: Verarbeiter und Auftragsverwaltung, gegen eine Datenbank im
   Arbeitsspeicher. Nachgestellt sind die Analyse selbst (sie liefert ein
   fertiges Ergebnis), Zaehler, Messung und Foto-Ablage. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
jest.mock("../counter", () => ({
  incrementTotals: jest.fn(async () => {}),
  releaseHourlySlot: jest.fn(async () => {}),
  zaehlerNachtragen: jest.fn(async () => true),
}));
jest.mock("../durchsatz", () => ({ merkeDauer: jest.fn(async () => {}) }));
jest.mock("../job-pipelines", () => ({ runPipeline: jest.fn() }));
jest.mock("../queue-storage", () => ({ deleteImage: jest.fn(async () => true) }));
jest.mock("../cloud-tasks", () => ({ redispatchJobLocal: jest.fn() }));

const speicher = require("./hilfen/speicher-datenbank");
const counter = require("../counter");
const durchsatz = require("../durchsatz");
const pipelines = require("../job-pipelines");
const storage = require("../queue-storage");
const { handleProcessJob } = require("../handle-process-job");

const JOB = "B".repeat(20);
const PROFIL = {
  profiles: {
    normal: { profileText: "Du wirkst aufmerksam.", categories: {} },
    boost: { profileText: "Du bist berechenbar.", categories: {} },
  },
  privacyRisks: [],
  exif: {},
  meta: { traceId: null, mode: "human" },
};

function antwort() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const verarbeiten = () => {
  const res = antwort();
  return handleProcessJob({ method: "POST", body: { jobId: JOB }, headers: {} }, res).then(() => res);
};
const auftrag = () => speicher.lies(`jobs/${JOB}`);

let fehlerZeilen;
let warnung;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));
const meldungen = () =>
  zeilen(fehlerZeilen)
    .filter((zeile) => zeile.alert === "analyse-gescheitert")
    .map((zeile) => zeile.grund);

/* Das Speichern des Ergebnisses ist die ZWEITE Transaktion des Verarbeiters
   (die erste uebernimmt den Auftrag). `fehlschlaege` so viele davon scheitern,
   `wann` entscheidet: bevor geschrieben wird oder erst danach (die Bestaetigung
   kommt nicht an). */
function speichernScheitert(fehlschlaege, wann = "transaktion") {
  let transaktionen = 0;
  let uebrig = fehlschlaege;
  speicher.vor(({ art }) => {
    if (art === "transaktion") transaktionen += 1;
    if (art === wann && transaktionen >= 2 && uebrig > 0) {
      uebrig -= 1;
      throw new Error(`DEADLINE_EXCEEDED jobs/${JOB}`);
    }
  });
}

beforeEach(() => {
  speicher.leeren();
  jest.clearAllMocks();
  speicher.lege(`jobs/${JOB}`, {
    status: "queued",
    createdAt: Date.now() - 5000,
    lastSeenAt: Date.now() - 1000,
    imagePath: "queue-uploads/x.jpg",
    exif: {},
    traceId: null,
  });
  pipelines.runPipeline.mockReset().mockResolvedValue({ result: PROFIL, success: true });
  jest.spyOn(console, "log").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
  fehlerZeilen = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("das Speichern des fertigen Ergebnisses scheitert", () => {
  test.each([[1], [2]])("%i-mal: der naechste Versuch speichert das fertige Profil", async (fehlschlaege) => {
    speichernScheitert(fehlschlaege);

    const res = await verarbeiten();

    expect(res.body).toEqual({ ok: true });
    expect(auftrag().status).toBe("done");
    expect(auftrag().result).toEqual(PROFIL);
    /* Eine Analyse, einmal gezaehlt, einmal gemessen — und keine Fehlermeldung. */
    expect(pipelines.runPipeline).toHaveBeenCalledTimes(1);
    expect(counter.incrementTotals).toHaveBeenCalledTimes(1);
    expect(durchsatz.merkeDauer).toHaveBeenCalledTimes(1);
    expect(meldungen()).toEqual([]);
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/x.jpg");
  });

  test("dreimal: erst dann das Ersatz-Ergebnis — und die Meldung nennt das Speichern, nicht die KI", async () => {
    speichernScheitert(3);

    const res = await verarbeiten();

    expect(res.body).toEqual({ ok: true });
    expect(auftrag().status).toBe("done");
    /* Das Kind sieht "technischer Fehler" wie bisher. */
    expect(auftrag().result).toMatchObject({
      profiles: null,
      blockedReason: "blocked.apiError",
      meta: { mode: "blocked" },
    });
    expect(meldungen()).toEqual(["ergebnis_speichern"]);
    expect(counter.incrementTotals).not.toHaveBeenCalled();
    expect(durchsatz.merkeDauer).not.toHaveBeenCalled();
    expect(pipelines.runPipeline).toHaveBeenCalledTimes(1);
  });

  test("jeder gescheiterte Versuch steht als Warnung im Protokoll, ohne Kennung und ohne Fehlertext", async () => {
    speichernScheitert(2);

    await verarbeiten();

    const warnungen = zeilen(warnung).filter((zeile) => zeile.warning === "ergebnis-speichern-fehlgeschlagen");
    expect(warnungen).toEqual([
      {
        severity: "WARNING",
        step: "process-job",
        warning: "ergebnis-speichern-fehlgeschlagen",
        versuch: 1,
        code: null,
        art: "Error",
      },
      {
        severity: "WARNING",
        step: "process-job",
        warning: "ergebnis-speichern-fehlgeschlagen",
        versuch: 2,
        code: null,
        art: "Error",
      },
    ]);
    expect(JSON.stringify([...zeilen(warnung), ...zeilen(fehlerZeilen)])).not.toContain(JOB);
  });

  test("die Bestaetigung der Datenbank kommt nicht an: die Wiederholung erkennt den eigenen Stand", async () => {
    speichernScheitert(1, "transaktion-ende");

    const res = await verarbeiten();

    expect(res.body).toEqual({ ok: true });
    expect(auftrag().result).toEqual(PROFIL);
    expect(counter.incrementTotals).toHaveBeenCalledTimes(1);
    expect(zeilen(warnung).map((zeile) => zeile.error)).not.toContain("ergebnis-verworfen-job-bereits-terminal");
    expect(meldungen()).toEqual([]);
  });
});

describe("Bestand", () => {
  test("ohne Stoerung: ein Schreibvorgang, das Profil steht", async () => {
    const res = await verarbeiten();

    expect(res.body).toEqual({ ok: true });
    expect(auftrag().result).toEqual(PROFIL);
    expect(speicher.protokoll.filter((eintrag) => eintrag.art === "transaktion")).toHaveLength(2);
    expect(warnung).not.toHaveBeenCalled();
    expect(meldungen()).toEqual([]);
  });

  test("hat inzwischen ein anderer den Auftrag beendet, wird das Ergebnis verworfen und nicht gezaehlt", async () => {
    pipelines.runPipeline.mockImplementation(async () => {
      speicher.lege(`jobs/${JOB}`, { ...auftrag(), status: "failed", errorReason: "processing_timeout" });
      return { result: PROFIL, success: true };
    });

    const res = await verarbeiten();

    expect(res.body).toEqual({ ok: false, reason: "already_terminal" });
    expect(auftrag().status).toBe("failed");
    expect(counter.incrementTotals).not.toHaveBeenCalled();
    expect(zeilen(warnung).map((zeile) => zeile.error)).toContain("ergebnis-verworfen-job-bereits-terminal");
  });

  test("scheitert die Analyse selbst, nennt die Meldung weiter die KI", async () => {
    pipelines.runPipeline.mockRejectedValue(new Error("unerwartet"));

    await verarbeiten();

    expect(auftrag().result).toMatchObject({ profiles: null, blockedReason: "blocked.apiError" });
    expect(meldungen()).toEqual(["blocked.apiError"]);
  });
});
