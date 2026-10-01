/**
 * queue-storage-laden.test.js — Das Foto wird aus dem Zwischenspeicher
 * geladen, ohne dass der Server bei jeder Analyse warnt.
 *
 * ANLASS (01.10.2026, erster Workshop nach 4.13.0): Jede der 30 Analysen
 * schrieb "MaxListenersExceededWarning ... PassThrough" ins Protokoll; mit
 * 4.12.0 keine. Ursache gemessen: Die Speicher-Bibliothek 8 (Hilfspaket
 * teeny-request 11, index.js:194) haengt beim Herunterladen dieselben
 * Zuhoerer mehrfach an — ab etwa 64 KB, also bei jedem echten Foto. Harmlos
 * (eine Anfrage, Daten gleich, kein Speicherwachstum ueber 1000 Downloads),
 * aber eine Warnung, die IMMER kommt, verdeckt die eine, die zaehlt.
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

test("eine Anfrage, mit Anmeldung, an die Objekt-Adresse des Fachs", async () => {
  await storage.loadImage("queue-uploads/x.png");
  expect(anfragen).toHaveLength(1);
  expect(anfragen[0].url).toBe("/storage/v1/b/fach/o/queue-uploads%2Fx.png?alt=media");
  expect(anfragen[0].auth).toBe("Bearer test-zugang");
});

test("voruebergehende Stoerung (503) wird wiederholt wie in der Bibliothek", async () => {
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
