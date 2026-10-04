"use strict";

/* Riegel gegen Emulator-Laeufe am echten Foto-Speicher (TEST-2026-10-03-42,
   Datenschutz-Teil).

   Im Foto-Speicher liegen Bilder von Kindern, und zugesagt ist, dass sie nur fuer
   die Dauer der Analyse dort liegen. Laeuft ein Emulator, ist der echte Speicher
   immer der falsche Ort: Der Emulator holt sich bei angemeldetem Konto die echten
   Zugangsdaten, und die Fotos lagen im Betrieb, ohne dass ein Worker sie je
   abgeholt und geloescht haette. queue-storage.js erkennt einen Emulator an DREI
   Umgebungsvariablen, und jede von ihnen genuegt allein:

     FIRESTORE_EMULATOR_HOST   Firestore-Emulator
     FUNCTIONS_EMULATOR        Functions-Emulator (`npm run serve` startet nur
                               diesen; FIRESTORE_EMULATOR_HOST ist dabei NICHT
                               gesetzt, K_SERVICE dagegen schon)
     STORAGE_EMULATOR_HOST     Storage-Emulator

   Geprueft wird fuer jede Variable einzeln, dass bucket() — und damit storeImage,
   loadImage und deleteImage — den echten Speicher nicht waehlt. Den Beleg liefert
   eine Attrappe fuer firebase-admin/storage: `getStorage` darf nie aufgerufen
   werden. Bliebe der Riegel offen, ginge der Aufruf an die Attrappe und nicht an
   die Cloud; der Test kann also nie selbst etwas Echtes anfassen.

   Umgebung: lokale-schalter.js entscheidet, ob die lokale Ablage (QUEUE_LOCAL=1)
   gilt: im Emulator und am eigenen Rechner ja, in der Produktion nie (Cloud Run
   setzt K_SERVICE, der Emulator zusaetzlich FUNCTIONS_EMULATOR=true). Der Riegel
   ist der zweite Schutz: Ohne QUEUE_LOCAL=1 laeuft im Emulator nichts am echten
   Speicher vorbei. Jeder Test setzt die Umgebung vollstaendig selbst und
   stellt sie danach wieder her.

   Gegenprobe (Erfolgsweg): In der Produktion, ohne Emulator-Variable und ausserhalb
   von Jest, waehlt bucket() den Bucket QUEUE_BUCKET. Ein Riegel, der immer zu ist,
   waere so schlecht wie keiner. */

jest.mock("firebase-admin/storage", () => ({ getStorage: jest.fn() }));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getStorage } = require("firebase-admin/storage");
const { QUEUE_BUCKET } = require("../config");
const storage = require("../queue-storage");

/* Alles, was die Wahl des Speichers beeinflusst — und im Testlauf oder in der
   Umgebung des Entwicklers gesetzt sein koennte. */
const BERUEHRT = [
  "JEST_WORKER_ID",
  "FIRESTORE_EMULATOR_HOST",
  "FUNCTIONS_EMULATOR",
  "STORAGE_EMULATOR_HOST",
  "K_SERVICE",
  "QUEUE_LOCAL",
];

/* Die drei Wege, auf denen ein Emulator laeuft. Jede Zeile setzt NUR ihre eigene
   Variable (und, wie beim echten Functions-Emulator, K_SERVICE). */
const EMULATOREN = [
  ["Firestore-Emulator", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
  ["Functions-Emulator (npm run serve)", { K_SERVICE: "enqueue", FUNCTIONS_EMULATOR: "true" }],
  ["Storage-Emulator", { STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199" }],
];

const PRODUKTION = { K_SERVICE: "enqueue" };

const LOKALE_ABLAGE = path.join(os.tmpdir(), "malzime-queue-uploads");

let vorher;
let dienst;
let bucket;

/* Eine Attrappe fuer das, was getStorage() in der Cloud liefern wuerde. */
function neueSpeicherAttrappe() {
  const gespeichert = [];
  const fach = {
    name: QUEUE_BUCKET,
    gespeichert,
    file: (objektPfad) => ({
      save: jest.fn(async (buffer, optionen) => {
        gespeichert.push({ objektPfad, buffer, optionen });
      }),
      delete: jest.fn(async () => {}),
      download: jest.fn(async () => [Buffer.from("foto")]),
      getMetadata: jest.fn(async () => [{ contentType: "image/jpeg" }]),
    }),
  };
  return { fach, dienst: { bucket: jest.fn(() => fach) } };
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
  const attrappe = neueSpeicherAttrappe();
  dienst = attrappe.dienst;
  bucket = attrappe.fach;
  getStorage.mockReset().mockReturnValue(dienst);
  storage.setBucketForTest(null);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const name of BERUEHRT) {
    if (vorher[name] === undefined) delete process.env[name];
    else process.env[name] = vorher[name];
  }
  storage.setBucketForTest(null);
  jest.restoreAllMocks();
});

/* ═══════════════════ Emulator: der echte Speicher bleibt zu ═══════════════════ */

describe("Mit laufendem Emulator und ohne lokale Ablage bleibt der echte Foto-Speicher zu", () => {
  test.each(EMULATOREN)("%s: bucket() wirft, der Speicherdienst wird nicht einmal angefragt", (_name, umgebung) => {
    setzeUmgebung(umgebung);
    expect(() => storage._bucketFuerTest()).toThrow(/Emulator/i);
    expect(getStorage).not.toHaveBeenCalled();
  });

  test.each(EMULATOREN)("%s: storeImage legt kein Foto ab", async (_name, umgebung) => {
    setzeUmgebung(umgebung);
    await expect(storage.storeImage(Buffer.from("foto"), "image/jpeg")).rejects.toThrow(/Emulator/i);
    expect(getStorage).not.toHaveBeenCalled();
    expect(bucket.gespeichert).toEqual([]);
  });

  test.each(EMULATOREN)(
    "%s: loadImage und deleteImage fassen den echten Speicher nicht an",
    async (_name, umgebung) => {
      setzeUmgebung(umgebung);
      await expect(storage.loadImage("queue-uploads/x.jpg")).rejects.toThrow(/Emulator/i);
      /* Geloescht wurde nichts: die Rueckgabe sagt "gescheitert", nicht "erledigt". */
      await expect(storage.deleteImage("queue-uploads/x.jpg")).resolves.toBe(false);
      expect(getStorage).not.toHaveBeenCalled();
    }
  );

  test("auch mit allen drei Variablen zugleich bleibt er zu", () => {
    setzeUmgebung({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FUNCTIONS_EMULATOR: "true",
      STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
    });
    expect(() => storage._bucketFuerTest()).toThrow(/Emulator/i);
    expect(getStorage).not.toHaveBeenCalled();
  });
});

/* ═══════════════════ Erfolgsweg ═══════════════════ */

describe("Erfolgsweg: ohne Emulator wird der Bucket der Warteschlange gewaehlt", () => {
  test("Produktion (nur K_SERVICE): bucket() liefert den Bucket QUEUE_BUCKET", () => {
    setzeUmgebung(PRODUKTION);
    expect(storage._bucketFuerTest()).toBe(bucket);
    expect(getStorage).toHaveBeenCalledTimes(1);
    expect(dienst.bucket).toHaveBeenCalledWith(QUEUE_BUCKET);
  });

  test("Produktion: storeImage legt das Foto im Bucket ab", async () => {
    setzeUmgebung(PRODUKTION);
    const objektPfad = await storage.storeImage(Buffer.from("foto"), "image/jpeg");
    expect(objektPfad).toMatch(/^queue-uploads\/.+\.jpg$/);
    expect(bucket.gespeichert).toHaveLength(1);
    expect(bucket.gespeichert[0].objektPfad).toBe(objektPfad);
    expect(bucket.gespeichert[0].buffer.toString()).toBe("foto");
    expect(bucket.gespeichert[0].optionen).toEqual({ contentType: "image/jpeg", resumable: false });
  });

  test("Produktion mit versehentlich gesetztem QUEUE_LOCAL=1: das Foto geht trotzdem in den Bucket, nicht auf die Platte", async () => {
    setzeUmgebung({ ...PRODUKTION, QUEUE_LOCAL: "1" });
    const objektPfad = await storage.storeImage(Buffer.from("foto"), "image/jpeg");
    expect(bucket.gespeichert).toHaveLength(1);
    expect(getStorage).toHaveBeenCalledTimes(1);
    const lokaleDatei = path.join(LOKALE_ABLAGE, path.basename(objektPfad));
    try {
      expect(fs.existsSync(lokaleDatei)).toBe(false);
    } finally {
      fs.rmSync(lokaleDatei, { force: true });
    }
  });

  test("Functions-Emulator mit QUEUE_LOCAL=1: die lokale Ablage greift, der Speicherdienst bleibt unberuehrt", async () => {
    setzeUmgebung({ K_SERVICE: "enqueue", FUNCTIONS_EMULATOR: "true", QUEUE_LOCAL: "1" });
    const objektPfad = await storage.storeImage(Buffer.from("lokales-foto"), "image/png");
    try {
      expect(objektPfad).toMatch(/^queue-uploads\/.+\.png$/);
      expect(fs.existsSync(path.join(LOKALE_ABLAGE, path.basename(objektPfad)))).toBe(true);
      const geladen = await storage.loadImage(objektPfad);
      expect(geladen.buffer.toString()).toBe("lokales-foto");
      expect(geladen.mimeType).toBe("image/png");
    } finally {
      await expect(storage.deleteImage(objektPfad)).resolves.toBe(true);
    }
    expect(fs.existsSync(path.join(LOKALE_ABLAGE, path.basename(objektPfad)))).toBe(false);
    expect(getStorage).not.toHaveBeenCalled();
    expect(bucket.gespeichert).toEqual([]);
  });

  test.each(EMULATOREN)(
    "%s: mit hinterlegter Attrappe laeuft der Weg trotzdem (der Riegel sperrt keine Tests)",
    (_n, umgebung) => {
      setzeUmgebung(umgebung);
      const eigene = { name: "attrappe" };
      storage.setBucketForTest(eigene);
      expect(storage._bucketFuerTest()).toBe(eigene);
      expect(getStorage).not.toHaveBeenCalled();
    }
  );
});
