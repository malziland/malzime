/**
 * Web-Schicht-Tests: echter HTTP-Server, echtes Express, echter Upload-Parser.
 *
 * WARUM ES DIESE DATEI GIBT
 * Alle uebrigen Backend-Tests ersetzen `onRequest` durch eine Attrappe und
 * rufen die Handler direkt auf. Sie ueberspringen damit die komplette
 * Express-Schicht — Multipart-Streaming, Body-Parsing und Query-Parsing werden
 * von ihnen NICHT abgedeckt. Beim Sprung Express 4 -> 5 (v2.4.3) war deshalb
 * kein einziger Test in der Lage, eine Regression in genau dieser Schicht zu
 * bemerken; die Pruefung lief ueber einen wegwerfbaren Prueftstand.
 * Diese Datei macht daraus eine dauerhafte Absicherung.
 *
 * Der zweite Fall (`rawBody`) bildet die Firebase-Produktionslaufzeit nach:
 * Dort ist der Request-Stream bereits ausgelesen, der Body liegt nur noch als
 * `req.rawBody` vor. Ohne die entsprechende Behandlung in `upload.js` ist der
 * in README zugesagte multipart-Weg auf `POST /analyze` faktisch tot.
 */

const express = require("express");
const { parseMultipart, parseJsonBody } = require("../upload");

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

const GRENZE = "----malziMEjest0001";

function multipart(felder, datei) {
  const teile = [];
  for (const [k, v] of Object.entries(felder)) {
    teile.push(Buffer.from(`--${GRENZE}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (datei) {
    teile.push(
      Buffer.from(
        `--${GRENZE}\r\nContent-Disposition: form-data; name="image"; filename="${datei.name}"\r\n` +
          `Content-Type: ${datei.type}\r\n\r\n`
      ),
      datei.buffer,
      Buffer.from("\r\n")
    );
  }
  teile.push(Buffer.from(`--${GRENZE}--\r\n`));
  return { body: Buffer.concat(teile), contentType: `multipart/form-data; boundary=${GRENZE}` };
}

/**
 * @param {boolean} rawBodyModus  true = Firebase-Produktionslaufzeit nachbilden
 *                                (Stream leergelesen, Body nur als req.rawBody)
 */
function serverStarten(rawBodyModus) {
  const app = express();

  if (rawBodyModus) {
    // Body vorab komplett auslesen, als `rawBody` ablegen und JSON gleich mit
    // parsen — exakt das, was die Cloud-Functions-Laufzeit tut. Der Stream ist
    // danach erschoepft, `express.json()` kaeme zu spaet.
    app.use((req, _res, next) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        req.rawBody = Buffer.concat(chunks);
        if ((req.headers["content-type"] || "").includes("application/json")) {
          try {
            req.body = JSON.parse(req.rawBody.toString("utf8"));
          } catch {
            req.body = {};
          }
        }
        next();
      });
    });
  }

  app.post("/upload", async (req, res) => {
    try {
      const { fields, file } = await parseMultipart(req);
      res.status(200).json({
        ok: true,
        fields,
        bytes: file.size,
        mime: file.mimeType,
        unveraendert: file.buffer.equals(JPEG),
      });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, code: e.code });
    }
  });

  // Ohne rawBody muss Express selbst parsen; mit rawBody hat es das Zwischenstueck
  // oben schon getan (wie in der Produktion).
  const jsonParser = rawBodyModus ? (_req, _res, next) => next() : express.json({ limit: "10mb" });

  app.post("/json", jsonParser, (req, res) => {
    try {
      res.status(200).json({ ok: true, body: parseJsonBody(req) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, code: e.code });
    }
  });

  app.get("/query", (req, res) => {
    res.status(200).json({ jobId: req.query.jobId, typ: typeof req.query.jobId, token: req.query.token });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, basis: `http://127.0.0.1:${server.address().port}` }));
  });
}

// Beide Betriebsarten durchlaufen dieselben Zusicherungen.
describe.each([
  ["Stream (blankes Express / Selbst-Hosting)", false],
  ["rawBody (Firebase-Produktionslaufzeit)", true],
])("Web-Schicht — %s", (_name, rawBodyModus) => {
  let server;
  let basis;

  beforeAll(async () => {
    ({ server, basis } = await serverStarten(rawBodyModus));
  });

  afterAll(() => new Promise((r) => server.close(r)));

  test("Multipart-Upload kommt vollstaendig und unveraendert an", async () => {
    const { body, contentType } = multipart(
      { lang: "de", traceId: "abc" },
      { name: "t.jpg", type: "image/jpeg", buffer: JPEG }
    );
    const r = await fetch(`${basis}/upload`, { method: "POST", headers: { "content-type": contentType }, body });
    const j = await r.json();

    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.unveraendert).toBe(true);
    expect(j.bytes).toBe(JPEG.length);
    expect(j.mime).toBe("image/jpeg");
    expect(j.fields).toEqual({ lang: "de", traceId: "abc" });
  });

  test("grosse Datei ueber mehrere Chunks bleibt byte-genau", async () => {
    const gross = Buffer.concat([JPEG, Buffer.alloc(600 * 1024, 0x41)]);
    const { body, contentType } = multipart({ lang: "de" }, { name: "g.jpg", type: "image/jpeg", buffer: gross });
    const r = await fetch(`${basis}/upload`, { method: "POST", headers: { "content-type": contentType }, body });
    const j = await r.json();

    expect(r.status).toBe(200);
    expect(j.bytes).toBe(gross.length);
  });

  test("falscher Content-Type wird abgewiesen", async () => {
    const r = await fetch(`${basis}/upload`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    const j = await r.json();

    expect(r.status).toBe(400);
    expect(j.code).toBe("unsupported_content_type");
  });

  test("Multipart ohne Bild meldet missing_image", async () => {
    const { body, contentType } = multipart({ lang: "de" }, null);
    const r = await fetch(`${basis}/upload`, { method: "POST", headers: { "content-type": contentType }, body });
    const j = await r.json();

    expect(r.status).toBe(400);
    expect(j.code).toBe("missing_image");
  });

  test("JSON-Body wird geparst (Pfad des echten Frontends)", async () => {
    const r = await fetch(`${basis}/json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: "de", imageBase64: JPEG.toString("base64") }),
    });
    const j = await r.json();

    expect(r.status).toBe(200);
    expect(j.body.lang).toBe("de");
    expect(j.body.imageBase64).toBe(JPEG.toString("base64"));
  });

  test("req.query liefert Strings (Express-5-Parserwechsel)", async () => {
    const r = await fetch(`${basis}/query?jobId=abc123&token=xyz`);
    const j = await r.json();

    expect(j.typ).toBe("string");
    expect(j.jobId).toBe("abc123");
    expect(j.token).toBe("xyz");
  });
});
