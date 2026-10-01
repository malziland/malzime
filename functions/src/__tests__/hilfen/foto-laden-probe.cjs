/* Laedt ein Foto ueber queue-storage.loadImage in einem ECHTEN Node-Prozess
   (nicht in Jest: Dort laesst sich das Hilfspaket der Speicher-Bibliothek gar
   nicht laden — der alte Ladeweg waere dort nicht messbar). Gegen einen
   lokalen Schein-Speicher mit Pruefsummen wie bei Google. Ausgabe: eine
   JSON-Zeile mit Bytevergleich, Bildtyp, Anfragen und Warnungen. */
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Storage, CRC32C } = require("@google-cloud/storage");
const storage = require(path.join(__dirname, "..", "..", "queue-storage"));

const FOTO = crypto.randomBytes(300 * 1024);
const pruefsumme = new CRC32C();
pruefsumme.update(FOTO);
const HASH = `crc32c=${pruefsumme.toString()},md5=${crypto.createHash("md5").update(FOTO).digest("base64")}`;
const warnungen = [];
process.on("warning", (w) => warnungen.push(w.name));
let anfragen = 0;
const server = http.createServer((req, res) => {
  anfragen += 1;
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
server.listen(0, "127.0.0.1", async () => {
  const dienst = new Storage({ apiEndpoint: `http://127.0.0.1:${server.address().port}`, projectId: "p" });
  dienst.authClient.getAccessToken = async () => "test-zugang";
  storage.setBucketForTest(dienst.bucket("fach"));
  let ergebnis;
  try {
    const geladen = await storage.loadImage("queue-uploads/x.png");
    await new Promise((r) => setTimeout(r, 100)); /* Warnungen kommen einen Takt spaeter */
    ergebnis = {
      bytesGleich: Buffer.compare(geladen.buffer, FOTO) === 0,
      mimeType: geladen.mimeType,
      anfragen,
      warnungen,
    };
  } catch (err) {
    ergebnis = { fehler: String(err && err.message) };
  }
  console.log(JSON.stringify(ergebnis));
  server.close();
});
