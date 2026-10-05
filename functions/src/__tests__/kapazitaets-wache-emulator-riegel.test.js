"use strict";

/* Riegel gegen Emulator-Laeufe an der echten Warteschlange: die Kapazitaets-Wache
   (TEST-2026-10-03-42, Zusatz zum Datenschutz-Teil).

   kapazitaets-wache.js hat einen eigenen Cloud-Tasks-Client, unabhaengig von dem in
   cloud-tasks.js, und mit ihm dieselbe Kette von Umgebungsvariablen: Laeuft ein
   Emulator, wird die echte Warteschlange nicht gelesen. Die Wache liest nur
   (getQueue), richtet also nichts an; der Riegel gehoert trotzdem hierher, damit die
   Sicherheit nicht daran haengt, dass nie jemand einen schreibenden Aufruf ergaenzt.

   Jede der drei Variablen genuegt allein:

     FIRESTORE_EMULATOR_HOST    Firestore-Emulator
     FUNCTIONS_EMULATOR         Functions-Emulator (`npm run serve`; FIRESTORE_EMULATOR_HOST
                                ist dabei NICHT gesetzt, K_SERVICE dagegen schon)
     CLOUD_TASKS_EMULATOR_HOST  Cloud-Tasks-Emulator

   Den Beleg liefert eine Attrappe fuer @google-cloud/tasks: Der Konstruktor des
   Clients darf in den Emulator-Zeilen nie aufgerufen werden. Bliebe der Riegel
   offen, entstuende ein Client der Attrappe und nicht einer gegen die Cloud; der
   Test kann also nie selbst etwas Echtes anfassen.

   Wie in queue-storage-emulator-riegel.test.js setzt jeder Test die Umgebung
   vollstaendig selbst (die Projektkennung gehoert dazu: ohne sie steigt die Wache
   mit "kein Projekt" aus, BEVOR der Riegel drankommt) und stellt sie danach
   wieder her. Die lokale Warteschlange (QUEUE_LOCAL=1, lokale-schalter.js) gilt im
   Emulator und am eigenen Rechner, in der Produktion nie.

   Gegenprobe (Erfolgsweg): In der Produktion liest die Wache die Warteschlange, mit
   hinterlegter Attrappe auch bei gesetzter Emulator-Variable. */

jest.mock("@google-cloud/tasks", () => ({ CloudTasksClient: jest.fn() }));
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { CloudTasksClient } = require("@google-cloud/tasks");
const { QUEUE_NAME, QUEUE_REGION } = require("../config");
const wache = require("../kapazitaets-wache");

const BERUEHRT = [
  "JEST_WORKER_ID",
  "FIRESTORE_EMULATOR_HOST",
  "FUNCTIONS_EMULATOR",
  "CLOUD_TASKS_EMULATOR_HOST",
  "STORAGE_EMULATOR_HOST",
  "K_SERVICE",
  "QUEUE_LOCAL",
  "GCLOUD_PROJECT",
  "GCP_PROJECT",
];

/* Jede Zeile setzt NUR ihre eigene Variable (und, wie beim echten
   Functions-Emulator, K_SERVICE). */
const EMULATOREN = [
  ["Firestore-Emulator", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
  ["Functions-Emulator (npm run serve)", { K_SERVICE: "enqueue", FUNCTIONS_EMULATOR: "true" }],
  ["Cloud-Tasks-Emulator", { CLOUD_TASKS_EMULATOR_HOST: "127.0.0.1:9090" }],
];

const PRODUKTION = { K_SERVICE: "enqueue" };
const PROJEKT = "malzime-test";
const QUEUE_PFAD = `projects/${PROJEKT}/locations/${QUEUE_REGION}/queues/${QUEUE_NAME}`;

let vorher;
let client;

/* Das, was ein echter Client aus der Cloud lesen wuerde. */
function neuerClient() {
  return {
    queuePath: jest.fn((projekt, region, name) => `projects/${projekt}/locations/${region}/queues/${name}`),
    getQueue: jest.fn(async () => [{ rateLimits: { maxConcurrentDispatches: 4, maxDispatchesPerSecond: 0.125 } }]),
  };
}

function setzeUmgebung(werte) {
  for (const [name, wert] of Object.entries(werte)) process.env[name] = wert;
}

beforeEach(() => {
  vorher = {};
  for (const name of BERUEHRT) {
    vorher[name] = process.env[name];
    delete process.env[name];
  }
  process.env.GCLOUD_PROJECT = PROJEKT;
  client = neuerClient();
  CloudTasksClient.mockReset().mockImplementation(() => client);
  wache.setClientForTest(null);
});

afterEach(() => {
  for (const name of BERUEHRT) {
    if (vorher[name] === undefined) delete process.env[name];
    else process.env[name] = vorher[name];
  }
  wache.setClientForTest(null);
});

/* ═══════════════════ Emulator: die echte Warteschlange bleibt ungelesen ═══════════════════ */

describe("Mit laufendem Emulator liest die Wache die echte Warteschlange nicht", () => {
  test.each(EMULATOREN)("%s: der Client wird gar nicht erst gebaut", (_name, umgebung) => {
    setzeUmgebung(umgebung);
    expect(() => wache._getClientFuerTest()).toThrow(/Emulator/i);
    expect(CloudTasksClient).not.toHaveBeenCalled();
  });

  test.each(EMULATOREN)(
    "%s: Parallelitaet und Rate sind nicht messbar, getQueue wird nicht gerufen",
    async (_name, umgebung) => {
      setzeUmgebung(umgebung);
      await expect(wache.echteParallelitaet()).resolves.toBeNull();
      await expect(wache.echteRate()).resolves.toBeNull();
      expect(CloudTasksClient).not.toHaveBeenCalled();
      expect(client.getQueue).not.toHaveBeenCalled();
    }
  );

  test("auch mit allen drei Variablen zugleich bleibt sie ungelesen", async () => {
    setzeUmgebung({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FUNCTIONS_EMULATOR: "true",
      CLOUD_TASKS_EMULATOR_HOST: "127.0.0.1:9090",
    });
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
    expect(CloudTasksClient).not.toHaveBeenCalled();
  });
});

/* ═══════════════════ Erfolgsweg ═══════════════════ */

describe("Erfolgsweg: ohne Emulator liest die Wache die Warteschlange", () => {
  test("Produktion (nur K_SERVICE): Parallelitaet und Rate kommen aus der Warteschlange", async () => {
    setzeUmgebung(PRODUKTION);
    await expect(wache.echteParallelitaet()).resolves.toBe(4);
    await expect(wache.echteRate()).resolves.toBe(0.125);
    expect(CloudTasksClient).toHaveBeenCalled();
    expect(client.getQueue).toHaveBeenCalledWith({ name: QUEUE_PFAD });
  });

  test("Produktion mit versehentlich gesetztem QUEUE_LOCAL=1: sie wird trotzdem gelesen", async () => {
    setzeUmgebung({ ...PRODUKTION, QUEUE_LOCAL: "1" });
    await expect(wache.echteParallelitaet()).resolves.toBe(4);
    expect(client.getQueue).toHaveBeenCalledTimes(1);
  });

  test("Functions-Emulator mit QUEUE_LOCAL=1: lokaler Modus, es wird nichts gelesen und nichts gebaut", async () => {
    setzeUmgebung({ K_SERVICE: "enqueue", FUNCTIONS_EMULATOR: "true", QUEUE_LOCAL: "1" });
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
    expect(CloudTasksClient).not.toHaveBeenCalled();
    expect(client.getQueue).not.toHaveBeenCalled();
  });

  test.each(EMULATOREN)(
    "%s: mit hinterlegter Attrappe laeuft das Lesen trotzdem (der Riegel sperrt keine Tests)",
    async (_name, umgebung) => {
      setzeUmgebung(umgebung);
      wache.setClientForTest(client);
      await expect(wache.echteParallelitaet()).resolves.toBe(4);
      expect(client.getQueue).toHaveBeenCalledWith({ name: QUEUE_PFAD });
      expect(CloudTasksClient).not.toHaveBeenCalled();
    }
  );
});
