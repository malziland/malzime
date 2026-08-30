/* Tests für handle-enqueue.js — Annahme-Endpoint der Queue-Architektur.
   Die externen Module (Counter, Storage, Cloud Tasks, Jobs) sind gemockt;
   getestet wird die Validierungs-Logik und der Annahme-Ablauf des Handlers. */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(),
  checkAndIncrement: jest.fn(),
  releaseHourlySlot: jest.fn(() => Promise.resolve()),
}));
jest.mock("../middleware", () => ({
  getClientIp: jest.fn(() => "1.2.3.4"),
  checkRateLimit: jest.fn(() => true),
}));
jest.mock("../jobs", () => ({
  createJob: jest.fn(),
  failJob: jest.fn(),
  countQueuedJobs: jest.fn(() => Promise.resolve(0)),
  /* UMGESTELLT (BUG-2026-08-30-14): Der Einlass zaehlt nicht mehr und legt
     spaeter an, sondern reserviert den Platz ATOMAR. Der Mock bildet das ab:
     `ok: false` heisst "kein Platz". */
  platzReservieren: jest.fn(async () => ({ ok: true, wartende: 1, grenze: 155 })),
  platzFreigeben: jest.fn(async () => {}),
  /* ZWEITE STUFE der Einlassgrenze. Diese drei fehlten zuerst — die Tests
     liefen dadurch NICHT durch die neue Pruefung, sondern in ihren
     Notfallpfad, und meldeten trotzdem gruen. Ein Mock, der eine Funktion
     nicht kennt, prueft den Weg dahinter nicht. */
  platzBestaetigen: jest.fn(async () => true),
  getJob: jest.fn(async (id) => ({ id, status: "queued", createdAt: Date.now() })),
  abandonJob: jest.fn(async () => true),
}));
/* OHNE DIESE ZWEI scheiterte die Ermittlung der Einlassgrenze still (echtes
   Firestore nicht erreichbar), der Code fiel in seinen Notfallpfad, und die
   Vorpruefung wurde nie erreicht — der Test meldete 200 statt 429 und ich
   suchte den Fehler im Produktivcode. */
jest.mock("../feature-flags", () => ({
  getFeatureFlags: jest.fn(async () => ({ useGemesseneDauer: false })),
  isSingleLargeCallEnabled: jest.fn(async () => true),
}));
jest.mock("../durchsatz", () => ({
  dauerJeAnalyse: jest.fn(async () => ({ sekunden: 65, gemessen: false, frisch: false })),
}));
jest.mock("../queue-storage", () => ({
  storeImage: jest.fn(),
  deleteImage: jest.fn(),
}));
jest.mock("../cloud-tasks", () => ({
  enqueueJob: jest.fn(),
}));
jest.mock("../notify", () => ({
  notifyLimitReached: jest.fn(() => Promise.resolve()),
}));

const { handleEnqueue, detectImageType } = require("../handle-enqueue");
const counter = require("../counter");
const middleware = require("../middleware");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const tasks = require("../cloud-tasks");

const VALID_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

const SECRETS = {
  ntfyUrl: { value: () => "url" },
  ntfyTopic: { value: () => "topic" },
  adminSecret: { value: () => "secret" },
};

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}

function jsonReq(bodyOverrides = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://malzi.me" },
    body: {
      imageBase64: VALID_JPEG.toString("base64"),
      mimeType: "image/jpeg",
      lang: "de",
      ...bodyOverrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  counter.getMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
  counter.checkAndIncrement.mockResolvedValue({ allowed: true, justReached: false, count: 1, limit: 1500 });
  middleware.checkRateLimit.mockReturnValue(true);
  /* createJob liefert die jobId (Signatur unveraendert — siehe Abwaegung in jobs.js)



     */
  jobs.createJob.mockResolvedValue("job-abc");
  jobs.failJob.mockResolvedValue();
  storage.storeImage.mockResolvedValue("queue-uploads/test.jpg");
  storage.deleteImage.mockResolvedValue();
  tasks.enqueueJob.mockResolvedValue("projects/p/locations/l/queues/q/tasks/t");
});

/* ── detectImageType (Magic Bytes) ───────────────────────────────── */

describe("detectImageType", () => {
  test("erkennt JPEG, PNG, GIF und WEBP", () => {
    expect(detectImageType(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(20)]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]))).toBe("image/png");
    expect(detectImageType(Buffer.concat([Buffer.from("GIF8"), Buffer.alloc(20)]))).toBe("image/gif");
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe(
      "image/webp"
    );
  });

  test("lehnt zu kurze und unbekannte Buffer ab", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.alloc(20))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });
});

/* ── Frühe Abweisungen ───────────────────────────────────────────── */

describe("handleEnqueue — Abweisungen", () => {
  test("nicht-POST → 405", async () => {
    const res = makeRes();
    await handleEnqueue({ method: "GET", headers: {} }, res, SECRETS);
    expect(res.statusCode).toBe(405);
  });

  test("Maintenance-Modus → 503", async () => {
    counter.getMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Wartung" });
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.maintenance).toBe(true);
  });

  test("Rate-Limit überschritten → 429", async () => {
    middleware.checkRateLimit.mockReturnValue(false);
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(429);
  });

  test("Honeypot ausgefüllt → 403", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ website: "spam" }), res, SECRETS);
    expect(res.statusCode).toBe(403);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  test("fehlendes Bild → 400", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ imageBase64: undefined }), res, SECRETS);
    expect(res.statusCode).toBe(400);
  });

  test("ungültige Magic Bytes → 400", async () => {
    const res = makeRes();
    const bogus = Buffer.alloc(40).toString("base64");
    await handleEnqueue(jsonReq({ imageBase64: bogus }), res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(storage.storeImage).not.toHaveBeenCalled();
  });

  test("Stundenlimit erreicht → 429 blocked:limit, kein Job angelegt", async () => {
    counter.checkAndIncrement.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(429);
    expect(res.body.blocked).toBe("limit");
    expect(jobs.createJob).not.toHaveBeenCalled();
  });
});

/* ── Erfolgsfall ─────────────────────────────────────────────────── */

describe("handleEnqueue — Erfolgsfall", () => {
  test("gültige Anfrage → 200 mit jobId, Bild gespeichert, Job eingereiht", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBe("job-abc");
    /* PRIV-003: enqueue gibt zusätzlich ein Abhol-Ticket zurück. */
    expect(typeof res.body.resultToken).toBe("string");
    expect(res.body.resultToken.length).toBeGreaterThan(0);
    expect(storage.storeImage).toHaveBeenCalledTimes(1);
    expect(jobs.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "de",
        traceId: null,
        imagePath: "queue-uploads/test.jpg",
        exif: {},
      })
    );
    expect(tasks.enqueueJob).toHaveBeenCalledWith("job-abc");
  });

  test("Kamera-EXIF (make/model) wird sanitisiert an den Job durchgereicht", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ exif: { make: "Apple", model: "iPhone 15", gps: "geheim" } }), res, SECRETS);
    expect(jobs.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ exif: { make: "Apple", model: "iPhone 15" } })
    );
  });

  test("gültige Trace-ID wird übernommen", async () => {
    const res = makeRes();
    await handleEnqueue(jsonReq({ traceId: "abc123XYZ" }), res, SECRETS);
    expect(jobs.createJob).toHaveBeenCalledWith(expect.objectContaining({ traceId: "abc123XYZ" }));
    expect(res.headers["X-Trace-Id"]).toBe("abc123XYZ");
  });
});

/* ── Cloud-Tasks-Ausfall ─────────────────────────────────────────── */

describe("handleEnqueue — Cloud-Tasks-Ausfall", () => {
  test("schlägt enqueueJob fehl → 503, Job auf failed gesetzt, Bild gelöscht", async () => {
    tasks.enqueueJob.mockRejectedValue(new Error("tasks unavailable"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("enqueue_failed");
    expect(jobs.failJob).toHaveBeenCalledWith("job-abc", "enqueue_failed");
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/test.jpg");
  });
});

/* ── Storage-/Firestore-Ausfall nach gezogenem Stunden-Slot ──────── */

describe("handleEnqueue — Ausfall zwischen Slot und Task", () => {
  test("schlägt storeImage fehl → 503, Slot zurückgegeben, kein deleteImage nötig", async () => {
    storage.storeImage.mockRejectedValue(new Error("gcs down"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("store_failed");
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(1);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
  });

  test("schlägt createJob fehl → 503, Slot zurückgegeben UND Bild-Waise gelöscht", async () => {
    jobs.createJob.mockRejectedValue(new Error("firestore blip"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("store_failed");
    expect(counter.releaseHourlySlot).toHaveBeenCalledTimes(1);
    expect(storage.deleteImage).toHaveBeenCalledWith("queue-uploads/test.jpg");
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Audit 2026-08-10 — SEC-002 und ARCH-001
   ══════════════════════════════════════════════════════════════════════ */

describe("SEC-002 — Größe aus der Kopfzeile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    counter.getMaintenanceStatus.mockResolvedValue({ enabled: false });
    counter.checkAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
    jobs.platzBestaetigen.mockResolvedValue(true);
    middleware.checkRateLimit.mockReturnValue(true);
  });

  test("übergroßer Rumpf wird mit 413 abgelehnt, bevor gezählt oder gespeichert wird", async () => {
    /* Die Laufzeit liest den Rumpf VORAB vollständig ein — gemessen rund
       170 MB Arbeitsspeicher je gleichzeitiger Anfrage bei 512 MiB Grenze.
       Die Prüfung weiter unten kommt dafür zu spät. */
    const req = jsonReq();
    req.headers["content-length"] = String(40 * 1024 * 1024); /* 40 MB */
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);

    expect(res.statusCode).toBe(413);
    expect(counter.checkAndIncrement).not.toHaveBeenCalled();
    expect(storage.storeImage).not.toHaveBeenCalled();
  });

  test("normale Größe geht durch (Positivkontrolle)", async () => {
    const req = jsonReq();
    req.headers["content-length"] = String(200 * 1024);
    jobs.createJob.mockResolvedValue({ id: "job-1", resultToken: "tok" });
    storage.storeImage.mockResolvedValue("pfad.jpg");
    tasks.enqueueJob.mockResolvedValue();
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);

    expect(res.statusCode).not.toBe(413);
    expect(counter.checkAndIncrement).toHaveBeenCalled();
  });
});

describe("ARCH-001 — Warteschlangen-Tiefe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    counter.getMaintenanceStatus.mockResolvedValue({ enabled: false });
    counter.checkAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
    middleware.checkRateLimit.mockReturnValue(true);
    storage.storeImage.mockResolvedValue("pfad.jpg");
    jobs.createJob.mockResolvedValue({ id: "job-1", resultToken: "tok" });
    tasks.enqueueJob.mockResolvedValue();
  });

  test("bei zu tiefer Warteschlange wird ehrlich abgelehnt — ohne Stunden-Platz zu verbrauchen", async () => {
    /* Ohne diese Bremse nimmt der Einlass Aufträge an, die den 30-Minuten-
       Deckel des Browsers garantiert überschreiten: Der Teilnehmer sieht einen
       Timeout, der Job läuft trotzdem und kostet Geld. */
    /* Die VORPRUEFUNG lehnt ab — bevor ein Bild gespeichert wird.
       Datenschutz: Ein Foto, das nie analysiert wird, soll nie auf unserem
       Speicher liegen. */
    /* Die Grenze wird aus der gemessenen Dauer gerechnet und ist im Test
       nicht zwingend warteschlangeTiefe. Ein absurd hoher Zaehlerstand liegt
       sicher darueber — geprueft wird die ABLEHNUNG, nicht die genaue Zahl. */
    jobs.countQueuedJobs.mockResolvedValue(99999);
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.statusCode).toBe(429);
    expect(res.body.blocked).toBe("queueFull");
    expect(counter.checkAndIncrement).not.toHaveBeenCalled();
    expect(storage.storeImage).not.toHaveBeenCalled();
  });

  test("knapp unter der Grenze geht durch (Positivkontrolle)", async () => {
    jobs.countQueuedJobs.mockResolvedValue(0);
    jobs.platzBestaetigen.mockResolvedValue(true);
    ({});
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.body && res.body.blocked).not.toBe("queueFull");
    expect(counter.checkAndIncrement).toHaveBeenCalled();
  });

  test("klemmt die Abfrage, wird angenommen statt blockiert (fail-open)", async () => {
    /* Eine Kapazitätsbremse darf nie zum Ausfall eskalieren. */
    jobs.platzBestaetigen.mockRejectedValue(new Error("Firestore weg"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.body && res.body.blocked).not.toBe("queueFull");
    expect(counter.checkAndIncrement).toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   TEST-002 (Audit 2026-08-10) — mit v2.10.0 verlorene Zusicherungen.

   Der Abbau des synchronen Pfads hat `index.test.js` (595 Zeilen) ersatzlos
   entfernt. Ein Teil der dortigen Prüfungen betraf aber Verhalten, das in
   handle-enqueue.js UNVERÄNDERT weiterlebt: Zeichensatz-Prüfung des Base64,
   413-Grenze, MIME-Liste, 100-Zeichen-Kappung der EXIF-Werte und die
   Reihenfolge „Honeypot vor Zähler". Suchbefehle über den gesamten übrigen
   Testbestand ergaben für jede dieser Zusicherungen null Treffer — sie sind
   hier nachgezogen.
   ══════════════════════════════════════════════════════════════════════ */

describe("TEST-002 — nachgezogene Upload-Prüfungen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    counter.getMaintenanceStatus.mockResolvedValue({ enabled: false });
    counter.checkAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
    jobs.platzBestaetigen.mockResolvedValue(true);
    jobs.createJob.mockResolvedValue({ id: "job-1", resultToken: "tok" });
    middleware.checkRateLimit.mockReturnValue(true);
    storage.storeImage.mockResolvedValue("pfad.jpg");
    tasks.enqueueJob.mockResolvedValue();
  });

  test("Base64 mit Fremdzeichen → 400, nichts wird gezählt", async () => {
    const req = jsonReq({ imageBase64: "<script>alert(1)</script>" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Invalid image data");
    expect(counter.checkAndIncrement).not.toHaveBeenCalled();
  });

  test("überlanges Base64 → 413", async () => {
    const req = jsonReq({ imageBase64: "A".repeat(40 * 1024 * 1024) });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(413);
    expect(res.body.error).toBe("File too large");
  });

  test("nicht erlaubter MIME-Typ → 400", async () => {
    const req = jsonReq({ mimeType: "image/tiff" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid file type");
  });

  /* SEC-2026-08-12-19: Der erkannte Typ wurde nur auf "irgendein Bild" geprüft
     und dann verworfen — die Behauptung des Aufrufers reiste ungeprüft weiter,
     bis in die Daten-URL an die KI. */
  test("GIF-Bytes mit der Behauptung image/jpeg → 400, nichts wird gezählt", async () => {
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
    const req = jsonReq({ imageBase64: gif.toString("base64"), mimeType: "image/jpeg" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid file type");
    expect(counter.checkAndIncrement).not.toHaveBeenCalled();
    expect(storage.storeImage).not.toHaveBeenCalled();
  });

  test("PNG-Bytes mit der Behauptung image/webp → 400", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
    const req = jsonReq({ imageBase64: png.toString("base64"), mimeType: "image/webp" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid file type");
  });

  test("Gegenprobe: passt der Typ zu den Bytes, läuft es durch", async () => {
    /* Ohne diese Probe wäre auch eine Prüfung grün, die ALLES ablehnt — und der
       eigene Upload-Weg wäre tot, ohne dass ein Test es bemerkt. */
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
    const req = jsonReq({ imageBase64: png.toString("base64"), mimeType: "image/png" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(200);
    expect(storage.storeImage).toHaveBeenCalled();
  });

  test("EXIF-Werte werden auf 100 Zeichen gekappt (SEC-006 aus dem Juni-Audit)", async () => {
    const req = jsonReq({ exif: { make: "M".repeat(500), model: "X".repeat(500) } });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    const uebergeben = jobs.createJob.mock.calls[0][0].exif;
    expect(uebergeben.make).toHaveLength(100);
    expect(uebergeben.model).toHaveLength(100);
  });

  test("Honeypot läuft VOR dem Zähler — ein Bot verbraucht kein Budget", async () => {
    /* Bräche die Reihenfolge, verbrennt jeder Bot-Aufruf einen Platz des
       Stundenlimits. Ein einziger Scanner-Lauf könnte damit ein
       Workshop-Kontingent leeren, bevor die erste Klasse hochlädt. */
    const req = jsonReq({ website: "ich-bin-ein-bot" });
    const res = makeRes();
    await handleEnqueue(req, res, SECRETS);
    expect(res.statusCode).toBe(403);
    expect(counter.checkAndIncrement).not.toHaveBeenCalled();
    expect(storage.storeImage).not.toHaveBeenCalled();
  });
});

describe("Einlassgrenze, zweite Stufe (BUG-2026-08-30-14)", () => {
  /* Die atomare Reservierung fängt den Normalbetrieb ab. Unter echtem Andrang
   * scheitert sie an einer Firestore-Eigenschaft — ein einzelnes Dokument
   * verträgt etwa einen Schreibvorgang pro Sekunde, und bei 170 gleichzeitigen
   * Anfragen wirft die Datenbank ABORTED. Im Simulator geschah das 167 Mal,
   * und die Notbremse ließ alle durch: 177 Wartende bei Grenze 155.
   *
   * Die zweite Stufe zählt nur und kennt deshalb keine Kollisionen. Sie ist
   * der Grund, warum die Grenze jetzt hält — und sie war bis zu diesem Test
   * im Zusammenspiel ungeprüft. */
  beforeEach(() => {
    jest.clearAllMocks();
    counter.checkAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
    middleware.checkRateLimit.mockReturnValue(true);
    storage.storeImage.mockResolvedValue("pfad.jpg");
    jobs.createJob.mockResolvedValue("job-abc");
    /* IM GRENZBEREICH: Die zweite Stufe laeuft erst ab 80 % der Grenze — sie
       kostet zwei Datenbankzugriffe und soll den Alltag nicht belasten.
       140 von 155 sind 90 %, also wird geprueft. */
    jobs.platzReservieren.mockResolvedValue({ ok: true, wartende: 140, grenze: 155 });
    jobs.getJob.mockResolvedValue({ id: "job-abc", status: "queued", createdAt: Date.now() });
    tasks.enqueueJob.mockResolvedValue();
  });

  test("zu spät gekommen: der Auftrag wird zurückgenommen, nicht durchgelassen", async () => {
    jobs.platzBestaetigen.mockResolvedValue(false);
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.statusCode).toBe(429);
    expect(res.body.blocked).toBe("queueFull");
    /* Und es bleibt nichts liegen: */
    expect(jobs.abandonJob).toHaveBeenCalledWith("job-abc");
    expect(storage.deleteImage).toHaveBeenCalledWith("pfad.jpg");
    expect(counter.releaseHourlySlot).toHaveBeenCalled();
    /* Vor allem: Der Auftrag wird NICHT in die Verarbeitung geschickt. */
    expect(tasks.enqueueJob).not.toHaveBeenCalled();
  });

  test("rechtzeitig: der Auftrag läuft normal weiter", async () => {
    jobs.platzBestaetigen.mockResolvedValue(true);
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.statusCode).toBe(200);
    expect(tasks.enqueueJob).toHaveBeenCalledWith("job-abc");
    expect(jobs.abandonJob).not.toHaveBeenCalled();
  });

  test("die Stufe wird WIRKLICH durchlaufen — nicht stillschweigend übersprungen", async () => {
    /* Der Riegel gegen den blinden Fleck von vorhin: Fehlte getJob im Mock,
       lief der Code in seinen Notfallpfad und der Test blieb grün, ohne die
       Prüfung je berührt zu haben. */
    jobs.platzBestaetigen.mockResolvedValue(true);
    await handleEnqueue(jsonReq(), makeRes(), SECRETS);
    expect(jobs.platzBestaetigen).toHaveBeenCalled();
    expect(jobs.getJob).toHaveBeenCalledWith("job-abc");
  });

  test("bei einem Fehler in der Stufe wird eingelassen, nicht blockiert", async () => {
    /* Fail-open: Eine Kapazitätsbremse darf nie zum Totalausfall werden.
       Der Fehler geht laut ins Protokoll, der Nutzer bekommt seine Analyse. */
    const fehler = [];
    jest.spyOn(console, "error").mockImplementation((z) => fehler.push(String(z)));
    jobs.platzBestaetigen.mockRejectedValue(new Error("Firestore weg"));
    const res = makeRes();
    await handleEnqueue(jsonReq(), res, SECRETS);

    expect(res.statusCode).toBe(200);
    expect(fehler.join(" ")).toContain("platz-bestaetigung-fehlgeschlagen");
    jest.restoreAllMocks();
  });
});
