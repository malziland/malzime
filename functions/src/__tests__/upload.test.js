const { Readable } = require("stream");
const { parseMultipart, parseJsonBody } = require("../upload");

/* ── Helper: Multipart-Request als Stream ── */

function buildMultipart(parts, boundary = "----TestBound123") {
  const chunks = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    if (part.filename) {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`);
      chunks.push(`Content-Type: ${part.type || "application/octet-stream"}\r\n\r\n`);
    } else {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`);
    }
    chunks.push(part.data || "");
    chunks.push("\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return { body: Buffer.from(chunks.join("")), boundary };
}

function createMultipartReq(parts, boundary = "----TestBound123") {
  const mp = buildMultipart(parts, boundary);
  const req = new Readable({ read() {} });
  req.headers = { "content-type": `multipart/form-data; boundary=${mp.boundary}` };
  process.nextTick(() => {
    req.push(mp.body);
    req.push(null);
  });
  return req;
}

/* ── parseJsonBody ── */

describe("parseJsonBody", () => {
  test("returns null for non-JSON content type", () => {
    const req = { headers: { "content-type": "multipart/form-data" }, body: {} };
    expect(parseJsonBody(req)).toBeNull();
  });

  test("returns body for valid JSON request", () => {
    const body = { imageBase64: "abc", mimeType: "image/jpeg" };
    const req = { headers: { "content-type": "application/json" }, body };
    expect(parseJsonBody(req)).toBe(body);
  });

  test("throws for JSON content-type with no body", () => {
    const req = { headers: { "content-type": "application/json" }, body: null };
    expect(() => parseJsonBody(req)).toThrow("Invalid JSON body");
  });

  test("thrown error has status 400", () => {
    const req = { headers: { "content-type": "application/json" }, body: "string" };
    try {
      parseJsonBody(req);
      fail("should have thrown");
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.code).toBe("bad_json");
    }
  });

  test("returns null when content-type header is missing", () => {
    const req = { headers: {}, body: {} };
    expect(parseJsonBody(req)).toBeNull();
  });

  test("accepts charset variant in content-type", () => {
    const body = { imageBase64: "abc" };
    const req = { headers: { "content-type": "application/json; charset=utf-8" }, body };
    expect(parseJsonBody(req)).toBe(body);
  });
});

/* ── parseMultipart ── */

describe("parseMultipart", () => {
  test("parses valid multipart with file and fields", async () => {
    const req = createMultipartReq([
      { name: "lang", data: "de" },
      { name: "image", filename: "photo.jpg", type: "image/jpeg", data: "FAKEJPEGDATA" },
    ]);
    const result = await parseMultipart(req);
    expect(result.fields.lang).toBe("de");
    expect(result.file.buffer).toBeInstanceOf(Buffer);
    expect(result.file.buffer.toString()).toBe("FAKEJPEGDATA");
    expect(result.file.mimeType).toBe("image/jpeg");
    expect(result.file.filename).toBe("photo.jpg");
    expect(result.file.size).toBe(12);
  });

  test("parses multiple fields", async () => {
    const req = createMultipartReq([
      { name: "lang", data: "en" },
      { name: "mode", data: "boost" },
      { name: "image", filename: "test.png", type: "image/png", data: "PNG" },
    ]);
    const result = await parseMultipart(req);
    expect(result.fields.lang).toBe("en");
    expect(result.fields.mode).toBe("boost");
  });

  test("rejects non-multipart content type", async () => {
    const req = new Readable({ read() {} });
    req.headers = { "content-type": "application/json" };
    process.nextTick(() => {
      req.push(null);
    });
    await expect(parseMultipart(req)).rejects.toMatchObject({
      status: 400,
      code: "unsupported_content_type",
    });
  });

  test("rejects when no file is uploaded", async () => {
    const req = createMultipartReq([{ name: "lang", data: "de" }]);
    await expect(parseMultipart(req)).rejects.toMatchObject({
      status: 400,
      code: "missing_image",
    });
  });

  test("rejects on request abort", async () => {
    const req = new Readable({ read() {} });
    req.headers = { "content-type": "multipart/form-data; boundary=----TestBound123" };
    process.nextTick(() => req.emit("aborted"));
    await expect(parseMultipart(req)).rejects.toMatchObject({
      status: 400,
      code: "bad_multipart",
    });
  });

  test("rejects on request error", async () => {
    const req = new Readable({ read() {} });
    req.headers = { "content-type": "multipart/form-data; boundary=----TestBound123" };
    process.nextTick(() => req.emit("error", new Error("connection reset")));
    await expect(parseMultipart(req)).rejects.toMatchObject({
      status: 400,
      code: "bad_multipart",
    });
  });

  test("handles empty file data", async () => {
    const req = createMultipartReq([{ name: "image", filename: "empty.jpg", type: "image/jpeg", data: "" }]);
    const result = await parseMultipart(req);
    expect(result.file.buffer.length).toBe(0);
    expect(result.file.size).toBe(0);
  });
});

describe("Formular reißt ab", () => {
  /* Ein Upload, der mitten in der Datei endet (Verbindung weg), meldet die
     Bibliothek ZWEIMAL: am Formular und am Datei-Strom. Ein Fehler am
     Datei-Strom ohne Abnehmer ist eine ungefangene Ausnahme — die Laufzeit
     beendet dann die ganze Instanz, samt allen Uploads, die gerade über sie
     laufen. Jest wertet eine ungefangene Ausnahme als Fehlschlag des Tests. */
  const GRENZE = "----g";
  const kopf = Buffer.from(
    `--${GRENZE}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const anfrage = (rawBody) => ({
    headers: { "content-type": `multipart/form-data; boundary=${GRENZE}` },
    rawBody,
    on() {},
  });
  const kurzWarten = () => new Promise((weiter) => setTimeout(weiter, 30));

  test.each([
    ["mitten in der Datei", Buffer.concat([kopf, Buffer.alloc(100, 1)])],
    ["nach der Datei, ohne Abschlussgrenze", Buffer.concat([kopf, Buffer.alloc(100, 1), Buffer.from("\r\n")])],
  ])("%s: abgelehnt, keine ungefangene Ausnahme", async (_name, rumpf) => {
    await expect(parseMultipart(anfrage(rumpf))).rejects.toMatchObject({ status: 400, code: "bad_multipart" });
    await kurzWarten();
  });

  test("Gegenprobe: das vollständige Formular wird angenommen", async () => {
    const rumpf = Buffer.concat([kopf, Buffer.alloc(100, 1), Buffer.from(`\r\n--${GRENZE}--\r\n`)]);
    const ergebnis = await parseMultipart(anfrage(rumpf));
    expect(ergebnis.file.size).toBe(100);
  });
});
