/**
 * queue-storage-laden.test.js — Das Foto wird aus dem Zwischenspeicher
 * geladen, ohne dass der Server bei jeder Analyse warnt.
 *
 * ANLASS (01.10.2026, erster Workshop nach 4.13.0): Jede der 30 Analysen
 * schrieb "MaxListenersExceededWarning ... PassThrough" ins Protokoll; mit
 * 4.12.0 keine. Ursache gemessen: Der Download-Weg der Speicher-Bibliothek
 * (Hilfspaket teeny-request, index.js:194) haengt dieselben Zuhoerer mehrfach
 * an — ab etwa 64 KB, also bei jedem echten Foto. Schwerer wog, was die
 * Pruefung dabei fand: Antwortet der Speicher mit 429/5xx, stuerzt derselbe
 * Weg mit ERR_STREAM_UNABLE_TO_PIPE ab und reisst den Prozess mit — auch mit
 * 7.22. Der direkte Weg hat beides nicht (Tests unten, echter Node-Prozess).
 *
 * Hier laeuft die ECHTE Speicher-Bibliothek gegen einen lokalen Schein-
 * Speicher (kein Netz, keine Cloud). Die Anmeldung wird ersetzt, weil es
 * lokal keinen Google-Metadatendienst gibt.
 */
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");
const { Storage, CRC32C } = require("@google-cloud/storage");
const storage = require("../queue-storage");

const FOTO = crypto.randomBytes(300 * 1024); /* deutlich ueber 64 KB */
/* Pruefsummen wie bei Google — der alte Ladeweg der Bibliothek kontrolliert
   sie; ohne sie liefe die Gegenprobe in eine andere Fehlerart. */
const pruefsumme = new CRC32C();
pruefsumme.update(FOTO);
const HASH = `crc32c=${pruefsumme.toString()},md5=${crypto.createHash("md5").update(FOTO).digest("base64")}`;
let server;
let anfragen;
let antwortStatus;
let speicher;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    anfragen.push({ url: req.url, auth: req.headers.authorization });
    const status = antwortStatus.length ? antwortStatus.shift() : 200;
    /* Stoerungen wie im Netz: Verbindung kappen, bevor eine Antwort kommt;
       mitten im Bild abbrechen; falsche Bytes mit der Pruefsumme des echten
       Fotos schicken. */
    if (status === "haengt") {
      /* Antwortet nie — nur das Zeitlimit je Versuch beendet das. */
      return;
    }
    if (status === "abriss") {
      req.socket.destroy();
      return;
    }
    if (status === "mitte") {
      res.writeHead(200, { "content-type": "image/png", "content-length": FOTO.length, "x-goog-hash": HASH });
      res.write(FOTO.subarray(0, 100 * 1024));
      setTimeout(() => req.socket.destroy(), 20);
      return;
    }
    if (status === "falsch") {
      const falsch = Buffer.from(FOTO);
      falsch[1000] ^= 0xff;
      res.writeHead(200, { "content-type": "image/png", "content-length": falsch.length, "x-goog-hash": HASH });
      res.end(falsch);
      return;
    }
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end('{"error":{"code":' + status + "}}");
      return;
    }
    if (req.url.includes("alt=media")) {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": FOTO.length,
        "x-goog-hash": HASH,
        "x-goog-stored-content-encoding": "identity",
      });
      res.end(FOTO);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "queue-uploads/x.png", bucket: "fach", contentType: "image/png" }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
});
afterAll(() => new Promise((r) => server.close(r)));

let warnungen;
const merke = (w) => warnungen.push(w.name);
beforeEach(() => {
  anfragen = [];
  antwortStatus = [];
  warnungen = [];
  process.on("warning", merke);
  speicher = new Storage({ apiEndpoint: `http://127.0.0.1:${server.address().port}`, projectId: "p" });
  speicher.authClient.getAccessToken = async () => "test-zugang";
  storage.setBucketForTest(speicher.bucket("fach"));
  storage._setWartenForTest(async () => {});
});
afterEach(() => {
  storage._setVersuchZeitlimitForTest(null);
  process.removeListener("warning", merke);
  storage.setBucketForTest(null);
  storage._setWartenForTest(null);
});

test("ein echtes Foto laden: gleiche Bytes, richtiger Typ, EINE Anfrage, KEINE Warnung", () => {
  /* In einem echten Node-Prozess (siehe hilfen/foto-laden-probe.cjs) — in
     Jest liesse sich der alte Ladeweg nicht einmal ausfuehren. */
  const aus = execFileSync(process.execPath, [path.join(__dirname, "hilfen", "foto-laden-probe.cjs")], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const ergebnis = JSON.parse(aus.trim().split("\n").pop());
  expect(ergebnis.fehler).toBeUndefined();
  expect(ergebnis.bytesGleich).toBe(true);
  expect(ergebnis.mimeType).toBe("image/png");
  expect(ergebnis.warnungen).not.toContain("MaxListenersExceededWarning");
  expect(ergebnis.anfragen).toBe(1);
});

test("Speicher antwortet erst 429, dann 200: geladen, ohne Absturz (echter Node-Prozess)", () => {
  const aus = execFileSync(process.execPath, [path.join(__dirname, "hilfen", "foto-laden-probe.cjs")], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, PROBE_STATUS: "429,200" },
  });
  const ergebnis = JSON.parse(aus.trim().split("\n").pop());
  expect(ergebnis.fehler).toBeUndefined();
  expect(ergebnis.bytesGleich).toBe(true);
  expect(ergebnis.anfragen).toBe(2);
});

test("eine Anfrage, mit Anmeldung, an die Objekt-Adresse des Fachs", async () => {
  await storage.loadImage("queue-uploads/x.png");
  expect(anfragen).toHaveLength(1);
  expect(anfragen[0].url).toBe("/storage/v1/b/fach/o/queue-uploads%2Fx.png?alt=media");
  expect(anfragen[0].auth).toBe("Bearer test-zugang");
});

test("voruebergehende Stoerung (503) wird wiederholt — der alte Bibliotheksweg brach hier den Prozess ab", async () => {
  antwortStatus = [503, 503];
  const geladen = await storage.loadImage("queue-uploads/x.png");
  expect(Buffer.compare(geladen.buffer, FOTO)).toBe(0);
  expect(anfragen).toHaveLength(3);
});

test("ein fehlendes Foto (404) meldet code 404 und wird nicht wiederholt", async () => {
  antwortStatus = [404];
  await expect(storage.loadImage("queue-uploads/weg.png")).rejects.toMatchObject({ code: 404 });
  expect(anfragen).toHaveLength(1);
});

test("hoechstens so oft wie die Bibliothek (3 Wiederholungen), dann Fehler", async () => {
  antwortStatus = [503, 503, 503, 503, 503];
  await expect(storage.loadImage("queue-uploads/x.png")).rejects.toMatchObject({ code: 503 });
  expect(anfragen).toHaveLength(4);
});

test("Abriss, bevor eine Antwort kommt: wiederholt, dann geladen", async () => {
  antwortStatus = ["abriss"];
  const geladen = await storage.loadImage("queue-uploads/x.png");
  expect(Buffer.compare(geladen.buffer, FOTO)).toBe(0);
  expect(anfragen).toHaveLength(2);
});

test("Abriss mitten im Bild: kein halbes Foto, sondern ein neuer Versuch", async () => {
  antwortStatus = ["mitte"];
  const geladen = await storage.loadImage("queue-uploads/x.png");
  expect(Buffer.compare(geladen.buffer, FOTO)).toBe(0);
  expect(anfragen).toHaveLength(2);
});

test("falsche Bytes (Pruefsumme stimmt nicht): neu laden statt weitergeben", async () => {
  antwortStatus = ["falsch"];
  const geladen = await storage.loadImage("queue-uploads/x.png");
  expect(Buffer.compare(geladen.buffer, FOTO)).toBe(0);
  expect(anfragen).toHaveLength(2);
});

test("bleiben die Bytes falsch: Fehler CONTENT_DOWNLOAD_MISMATCH, nie ein verfaelschtes Foto", async () => {
  antwortStatus = ["falsch", "falsch", "falsch", "falsch"];
  await expect(storage.loadImage("queue-uploads/x.png")).rejects.toMatchObject({ code: "CONTENT_DOWNLOAD_MISMATCH" });
  expect(anfragen).toHaveLength(4);
});

test("Pausen zwischen den Versuchen wie in der Bibliothek (2 s, 4 s, 8 s plus Zufall bis 1 s)", async () => {
  const pausen = [];
  storage._setWartenForTest(async (ms) => pausen.push(ms));
  antwortStatus = [503, 503, 503];
  await storage.loadImage("queue-uploads/x.png");
  expect(pausen).toHaveLength(3);
  [2000, 4000, 8000].forEach((basis, i) => {
    expect(pausen[i]).toBeGreaterThanOrEqual(basis);
    expect(pausen[i]).toBeLessThan(basis + 1000);
  });
});

/* Befund S-05: Die echte Verdrahtung (firebase-admin) muss den direkten Weg
   nehmen — sonst fiele das Laden still auf den alten, abstuerzenden Weg
   zurueck, und alle Tests oben blieben gruen. Ohne Netz: nur Aufbau. */
test("das Fach aus firebase-admin nimmt den direkten Weg", () => {
  const { initializeApp, getApps } = require("firebase-admin/app");
  const { getStorage } = require("firebase-admin/storage");
  const app = getApps().find((a) => a.name === "verdrahtung") || initializeApp({ projectId: "p" }, "verdrahtung");
  const fach = getStorage(app).bucket("fach-probe");
  expect(storage._hatSpeicherDienst(fach)).toBe(true);
});

/* Befund S-13: Haengt der Speicher, beendet das Zeitlimit je Versuch das
   Warten, und es wird neu versucht. */
test("ein haengender Speicher: Zeitlimit je Versuch, dann neuer Versuch", async () => {
  storage._setVersuchZeitlimitForTest(300);
  antwortStatus = ["haengt"];
  const geladen = await storage.loadImage("queue-uploads/x.png");
  expect(Buffer.compare(geladen.buffer, FOTO)).toBe(0);
  expect(anfragen).toHaveLength(2);
});

/* Befund Q-01: Scheitert das Laden endgueltig, steht der Grund im Protokoll —
   ohne Pfad und ohne Kennung. Seit 01.10.2026 als WARNUNG: Den Alarm loest
   der Ausgang des Auftrags aus (ein-alarm-je-fehlermeldung.test.js), eine
   Fehlerzeile hier waere eine zweite Nachricht. */
test("endgueltig gescheitert: Warnung mit Grund, ohne Pfad, keine Fehlerzeile", async () => {
  const fehler = [];
  const fehlerSpion = jest.spyOn(console, "error").mockImplementation(() => {});
  const spion = jest.spyOn(console, "warn").mockImplementation((t) => fehler.push(String(t)));
  try {
    antwortStatus = [404];
    await expect(storage.loadImage("queue-uploads/geheim-123.png")).rejects.toMatchObject({ code: 404 });
    const zeile = fehler.map((t) => JSON.parse(t)).find((z) => z.step === "bild-laden");
    expect(zeile).toMatchObject({ severity: "WARNING", step: "bild-laden", fehler: "404" });
    expect(zeile.alert).toBeUndefined();
    expect(fehlerSpion).not.toHaveBeenCalled();
    expect(fehler.join("\n")).not.toMatch(/queue-uploads|geheim-123/);
  } finally {
    spion.mockRestore();
    fehlerSpion.mockRestore();
  }
});

/* Befunde T-02/T-03: Die Fehlerart steht nur in fester Form im Protokoll. */
test("Zeitueberschreitung als 'TimeoutError' (nicht als Altcode 23)", async () => {
  const fehler = [];
  const spion = jest.spyOn(console, "warn").mockImplementation((t) => fehler.push(String(t)));
  try {
    storage._setVersuchZeitlimitForTest(200);
    antwortStatus = ["haengt", "haengt", "haengt", "haengt"];
    await expect(storage.loadImage("queue-uploads/x.png")).rejects.toMatchObject({ name: "TimeoutError" });
    const zeile = fehler.map((t) => JSON.parse(t)).find((z) => z.step === "bild-laden");
    expect(zeile.fehler).toBe("TimeoutError");
  } finally {
    spion.mockRestore();
  }
}, 15000);

test("ein frei formulierter Fehlercode kommt nie ins Protokoll", async () => {
  const fehler = [];
  const spion = jest.spyOn(console, "warn").mockImplementation((t) => fehler.push(String(t)));
  try {
    speicher.authClient.getAccessToken = async () => {
      const e = new Error("Anmeldung gescheitert");
      e.code = "ECONNREFUSED 169.254.169.254:80 queue-uploads/x.png";
      throw e;
    };
    await expect(storage.loadImage("queue-uploads/x.png")).rejects.toBeDefined();
    const zeile = fehler.map((t) => JSON.parse(t)).find((z) => z.step === "bild-laden");
    expect(zeile.fehler).toBe("unbekannt");
    expect(fehler.join("\n")).not.toMatch(/169\.254|queue-uploads/);
  } finally {
    spion.mockRestore();
  }
});
