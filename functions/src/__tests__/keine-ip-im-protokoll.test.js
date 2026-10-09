"use strict";

/* Keine IP-Adresse in irgendeiner Ausgabe (TEST-2026-10-03-42, Datenschutz-Teil).

   Die Datenschutzerklaerung sagt zu: keine IP-Adresse im Protokoll. Der Server
   liest die Adresse des Aufrufers nur, um die Missbrauchsbremse zu fuehren
   (middleware.js, Arbeitsspeicher, rund 10 Minuten); hingeschrieben wird sie
   nirgends. Drei Handler lesen sie (getClientIp): handle-errors.js,
   handle-telemetry.js und handle-enqueue.js. In jedem steht die Adresse als
   Variable neben der Stelle, die die Protokollzeile baut — "nur kurz die Adresse
   mitloggen" waere eine Zeile Aenderung.

   Geprueft wird wie in analyse-aufruf-ohne-kennung.test.js: Gesucht wird der WERT
   der Adresse in ALLEN Ausgaben eines Aufrufs, nicht ein bestimmter Aufruf oder
   ein bestimmtes Feld. Auch der Anfang der Adresse zaehlt als Fund, damit eine
   gekuerzte Adresse ebenso auffaellt. Ausgaben sind:
     - alles, was ueber console.log/info/warn/error/debug geschrieben wird (Objekte
       aufgeklappt, sonst stuende dort nur "[object Object]"),
     - die Antwort an den Aufrufer (Status, Rumpf, Kopfzeilen),
     - jeder Aufruf an ein anderes Modul (Zaehler, Auftragsverwaltung, Bildspeicher,
       Warteschlange, Benachrichtigung) — dort wuerde die Adresse in die Datenbank
       oder an einen Dienst gehen.
   Jeder Weg durch jeden Handler wird gegangen, nicht nur der Erfolg.

   Dazu pruefen die Protokollzeilen selbst, dass sie nur Felder tragen, die dort
   hingehoeren. Das faengt auch eine Kennung, die aus der Adresse abgeleitet ist
   (etwa ein Pruefwert), die die Wertsuche nicht erkennen kann.

   Messmittel-Kontrollen (ein leeres Suchergebnis ist zuerst ein Verdacht gegen
   das Messmittel):
     1. Die Adresse erreicht den Handler wirklich: Nach dem Aufruf steht sie im
        Arbeitsspeicher der Bremse. Sonst waere die Pruefung leer gruen, etwa weil
        die Anfrage die Adresse unter einem falschen Namen traegt.
     2. Jeder Weg liefert die erwartete Antwort und, wo er etwas protokolliert, die
        erwartete Zeile.
     3. Die Suche findet eine Adresse in jedem Kanal, und sie findet sie in der
        echten Protokollzeile jedes Handlers, wenn der Aufrufer sie selbst in ein
        uebernommenes Feld schreibt. */

const fs = require("fs");
const path = require("path");
const util = require("util");

jest.mock("../betriebsprofil", () => {
  const m = require("../test-satz").betriebsprofilMock();
  return { ...m, geltendeWerte: jest.fn(m.geltendeWerte) };
});
jest.mock("../counter", () => ({
  getMaintenanceStatus: jest.fn(),
  checkAndIncrement: jest.fn(),
  releaseHourlySlot: jest.fn(),
  zaehleRealitaetsCheck: jest.fn(),
}));
jest.mock("../jobs", () => ({
  createJob: jest.fn(),
  failJob: jest.fn(),
  countQueuedJobs: jest.fn(),
  platzBestaetigen: jest.fn(),
  getJob: jest.fn(),
  abandonJob: jest.fn(),
  meldeGescheiterteAnalyse: jest.fn(),
  verbraucheRcTicket: jest.fn(),
}));
jest.mock("../queue-storage", () => ({ neuerBildPfad: jest.fn(), storeImage: jest.fn(), deleteImage: jest.fn() }));
jest.mock("../cloud-tasks", () => ({ enqueueJob: jest.fn() }));
jest.mock("../notify", () => ({ notifyLimitReached: jest.fn() }));
jest.mock("../feature-flags", () => ({ getFeatureFlags: jest.fn() }));
jest.mock("../durchsatz", () => ({ dauerJeAnalyse: jest.fn() }));

const { betriebsprofilMock, SATZ } = require("../test-satz");
const betriebsprofil = require("../betriebsprofil");
const counter = require("../counter");
const jobs = require("../jobs");
const storage = require("../queue-storage");
const tasks = require("../cloud-tasks");
const notify = require("../notify");
const flags = require("../feature-flags");
const durchsatz = require("../durchsatz");
const { _rateState } = require("../middleware");
const { MAX_UPLOAD_BYTES } = require("../config");
const { handleErrors, _freigabeliste: LISTE_ERRORS } = require("../handle-errors");
const { handleTelemetry, _freigabeliste: LISTE_TELEMETRIE } = require("../handle-telemetry");
const { handleEnqueue } = require("../handle-enqueue");

/* Dokumentationsadressen (RFC 5737 und RFC 3849): echte Adressformen, aber nie
   die eines wirklichen Aufrufers. `anfang` ist der Teil, der auch dann als Fund
   gilt, wenn nur eine gekuerzte Adresse hingeschrieben wuerde. */
const ADRESSEN = [
  { art: "IPv4", wert: "203.0.113.77", anfang: "203.0.113" },
  { art: "IPv6", wert: "2001:db8:85a3::8a2e:370:7334", anfang: "2001:db8:85a3" },
];

const SECRETS = {
  ntfyUrl: { value: () => "url" },
  ntfyTopic: { value: () => "topic" },
  adminSecret: { value: () => "secret" },
};

/* ── Messmittel: alle Ausgaben einsammeln und nach der Adresse durchsuchen ── */

const KONSOLE = ["log", "info", "warn", "error", "debug", "trace", "dir"];

/* Alles andere als ein Text wird aufgeklappt — auch verschachtelte Objekte,
   Fehler und Listen. */
function zeige(wert) {
  if (typeof wert === "string") return wert;
  return util.inspect(wert, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity });
}

/* Die Module, an die ein Handler schreibt, samt ihrer Attrappen-Funktionen. */
const ANDERE_MODULE = {
  counter,
  jobs,
  "queue-storage": storage,
  "cloud-tasks": tasks,
  notify,
  "feature-flags": flags,
  durchsatz,
  betriebsprofil,
};

let konsole;
let antworten;

function sammleKonsole() {
  konsole = [];
  for (const art of KONSOLE) {
    jest.spyOn(console, art).mockImplementation((...args) => {
      konsole.push({ kanal: `console.${art}`, text: args.map(zeige).join(" ") });
    });
  }
}

/* Die Antwort zeichnet jeden Aufruf auf, auch einen, den es heute nicht gibt
   (send, set, header ...). Sonst wuerde ein kuenftiger Aufruf den Handler in
   einen Fehler laufen lassen, statt die Adresse zu verraten. */
function neueAntwort() {
  const stand = { statusCode: null, body: null, aufrufe: [] };
  const antwort = new Proxy(stand, {
    get(ziel, name) {
      if (name in ziel) return ziel[name];
      if (typeof name !== "string" || name === "then") return undefined;
      return (...args) => {
        ziel.aufrufe.push([name, ...args]);
        if (name === "status") ziel.statusCode = args[0];
        if (name === "json") ziel.body = args[0];
        return antwort;
      };
    },
  });
  antworten.push(antwort);
  return antwort;
}

function aufrufeAnAndereModule() {
  const aufrufe = [];
  for (const [modul, funktionen] of Object.entries(ANDERE_MODULE)) {
    for (const [name, funktion] of Object.entries(funktionen)) {
      if (!jest.isMockFunction(funktion)) continue;
      for (const args of funktion.mock.calls) {
        aufrufe.push({ kanal: `Aufruf ${modul}.${name}`, text: args.map(zeige).join(" ") });
      }
    }
  }
  return aufrufe;
}

function alleAusgaben() {
  return [
    ...konsole,
    ...antworten.map((a, i) => ({ kanal: `Antwort ${i + 1}`, text: zeige(a.aufrufe) })),
    ...aufrufeAnAndereModule(),
  ];
}

/* Liefert jeden Fund mit Kanal und Umgebung; leer heisst: nirgends gefunden. */
function fundeDerAdresse(adresse) {
  const funde = [];
  for (const { kanal, text } of alleAusgaben()) {
    for (const nadel of [adresse.wert, adresse.anfang]) {
      const stelle = text.indexOf(nadel);
      if (stelle < 0) continue;
      funde.push(`${kanal}: ...${text.slice(Math.max(0, stelle - 40), stelle + nadel.length + 40)}...`);
      break;
    }
  }
  return funde;
}

function konsoleAlsText() {
  return konsole.map((z) => z.text).join("\n");
}

/* Die erste Protokollzeile, die das Stichwort enthaelt, als Objekt. */
function zeileMit(fragment) {
  const roh = konsole.map((z) => z.text).find((t) => t.includes(fragment));
  expect(roh).toBeDefined();
  return JSON.parse(roh);
}

/* Die Pfade aller Blaetter eines Objekts, verschachtelt mit Punkt:
   { client: { dpr: 2 } } -> ["client.dpr"]. */
function blattpfade(objekt, vorsatz = "") {
  return Object.entries(objekt).flatMap(([schluessel, wert]) =>
    wert && typeof wert === "object" && !Array.isArray(wert)
      ? blattpfade(wert, `${vorsatz}${schluessel}.`)
      : [`${vorsatz}${schluessel}`]
  );
}

/* ── Anfragen ── */

function anfrage(adresse, rumpf, optionen = {}) {
  return {
    method: optionen.methode || "POST",
    ip: adresse.wert,
    headers: {
      "content-type": "application/json",
      origin: "https://malzi.me",
      referer: "https://malzi.me/",
      "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36",
      /* So steht die Adresse hinter dem Lastverteiler: der Aufrufer, dann ein Zwischenknoten. */
      "x-forwarded-for": `${adresse.wert}, 10.0.0.1`,
      ...(optionen.kopf || {}),
    },
    body: rumpf,
    /* Multipart-Weg (TEST-2026-10-04-14): Die Laufzeit uebergibt den ganzen
       Rumpf vorab als `rawBody`; upload.js fuettert die Lese-Bibliothek damit. */
    ...(optionen.rohRumpf ? { rawBody: optionen.rohRumpf, on() {} } : {}),
  };
}

/* Ein Formular-Rumpf (multipart/form-data) mit einem Foto und den Feldern, die
   der Browser auf diesem Weg mitschickt. `ohneDatei` und `endetImFeld` bauen
   die zwei Fehlerwege der Rumpf-Verarbeitung. */
const FORMULAR_GRENZE = "----formular-grenze";
const FORMULAR_KOPF = { "content-type": `multipart/form-data; boundary=${FORMULAR_GRENZE}` };
function formularRumpf({ ohneDatei = false, endetImFeld = false } = {}) {
  const feld = (name, wert) => `--${FORMULAR_GRENZE}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}`;
  /* Das Formular reisst mitten im zweiten Feld ab: kein Zeilenende, keine
     Abschlussgrenze. */
  if (endetImFeld) return Buffer.from(`${feld("lang", "de")}\r\n${feld("traceId", "vorgang-a")}`);
  const puffer = [Buffer.from(`${feld("lang", "de")}\r\n${feld("traceId", "vorgang-abc")}\r\n`)];
  if (!ohneDatei) {
    puffer.push(
      Buffer.from(
        `--${FORMULAR_GRENZE}\r\nContent-Disposition: form-data; name="image"; filename="foto.jpg"\r\n` +
          "Content-Type: image/jpeg\r\n\r\n"
      ),
      JPEG,
      Buffer.from("\r\n")
    );
  }
  puffer.push(Buffer.from(`--${FORMULAR_GRENZE}--\r\n`));
  return Buffer.concat(puffer);
}

/* Ein Rumpf, dessen Lesen einen Fehler wirft: erreicht den Fehlerzweig der Handler. */
function stolpernderRumpf() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Rumpf nicht lesbar");
      },
    }
  );
}

const VOLLE_FEHLERMELDUNG = {
  errorName: "Error",
  errorMessage: "read_failed",
  phase: "image-read",
  url: "/",
  userAgent: "Chrome 128 / Android",
  requestId: "1",
  traceId: "vorgang-abc",
  wakeLock: "aktiv",
  fileFormat: "decl:image/heic",
  errorDetail: "NotReadableError",
  zweiterLeseweg: "NotReadableError",
  kopfLesetest: "ok",
  dateizeit: "millisekunden",
  zeitsprung: "gleich",
  durationMs: 1234,
  httpStatus: 0,
  fileSizeKb: 4321,
  msSeitAuswahl: 812,
  online: true,
  hidden: false,
  timings: { prepareImageMs: 300, fetchMs: 10, parseMs: 5, renderMs: 40, totalMs: 1234 },
  client: {
    effectiveType: "4g",
    language: "de-AT",
    screen: "small",
    downlinkMbps: 9.5,
    rttMs: 100,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    dpr: 2.6,
    saveData: false,
    automatisiert: false,
  },
};

const VOLLE_ERFOLGSMELDUNG = {
  eventType: "analyze-success",
  url: "/",
  durationMs: 61234,
  online: true,
  hidden: false,
  timings: { prepareImageMs: 300, fetchMs: 100, enqueueMs: 900, parseMs: 5, renderMs: 40, totalMs: 61234 },
  meta: { subject: "HUMAN", mode: "multimodal", lang: "de", reason: "ok", maintenanceTriggered: false },
};

const REALITAETS_CHECK = {
  eventType: "realitaets-check",
  stufen: { alter: 1, geschlecht: 1, interessen: 0.5, charakter: 0, werbung: 0.5, manipulation: 1 },
  ticket: "ticket-1234",
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]);

function einlassRumpf(ueberschreiben = {}) {
  return {
    imageBase64: JPEG.toString("base64"),
    mimeType: "image/jpeg",
    lang: "de",
    traceId: "vorgang-abc",
    ...ueberschreiben,
  };
}

/* ── Zustand je Test ── */

function setzeSatz(ueberschreiben) {
  betriebsprofil.geltendeWerte.mockReset().mockImplementation(betriebsprofilMock(ueberschreiben).geltendeWerte);
}

function entferneSatz() {
  betriebsprofil.geltendeWerte.mockReset().mockResolvedValue({ werte: null, quelle: "keiner", grund: "fehlt" });
}

function leereBremse() {
  for (const eintrag of _rateState.values()) clearTimeout(eintrag.zeitgeber);
  _rateState.clear();
}

beforeEach(() => {
  setzeSatz();
  counter.getMaintenanceStatus.mockReset().mockResolvedValue({ enabled: false, message: "" });
  counter.checkAndIncrement.mockReset().mockResolvedValue({ allowed: true, justReached: false, count: 1, limit: 500 });
  counter.releaseHourlySlot.mockReset().mockResolvedValue();
  counter.zaehleRealitaetsCheck.mockReset().mockResolvedValue();
  jobs.createJob.mockReset().mockResolvedValue("auftrag-1");
  jobs.failJob.mockReset().mockResolvedValue();
  jobs.countQueuedJobs.mockReset().mockResolvedValue(0);
  jobs.platzBestaetigen.mockReset().mockResolvedValue(true);
  jobs.getJob.mockReset().mockImplementation(async (id) => ({ id, status: "queued", createdAt: Date.now() }));
  jobs.abandonJob.mockReset().mockResolvedValue(true);
  jobs.meldeGescheiterteAnalyse.mockReset();
  jobs.verbraucheRcTicket.mockReset().mockResolvedValue(true);
  storage.neuerBildPfad.mockReset().mockReturnValue("queue-uploads/x.jpg");
  storage.storeImage.mockReset().mockResolvedValue("queue-uploads/x.jpg");
  storage.deleteImage.mockReset().mockResolvedValue(true);
  tasks.enqueueJob.mockReset().mockResolvedValue("projects/p/locations/l/queues/q/tasks/t");
  notify.notifyLimitReached.mockReset().mockResolvedValue();
  flags.getFeatureFlags.mockReset().mockResolvedValue({ useGemesseneDauer: false });
  durchsatz.dauerJeAnalyse.mockReset().mockResolvedValue({ sekunden: 65, gemessen: false, frisch: false });
  leereBremse();
  antworten = [];
  sammleKonsole();
});

afterEach(() => {
  jest.restoreAllMocks();
  leereBremse();
});

/* Ein Weg durch einen Handler:
     name           Beschreibung
     status         erwartete Antwort des (letzten) Aufrufs
     zeile          Text, der in der Konsolenausgabe stehen muss (fehlt: der Weg schreibt nichts)
     bremse         steht die Adresse danach im Arbeitsspeicher der Bremse? (Standard: ja)
     aufrufe        wie oft derselbe Aufruf kommt (2: der zweite trifft auf das Limit)
     rumpf, kopf, methode   die Anfrage
     vorbereiten    stellt die Attrappen auf diesen Weg ein */
function gehe(handler, wege, ...zusatz) {
  describe.each(ADRESSEN)("Adresse $art", (adresse) => {
    test.each(wege)("$name", async (weg) => {
      if (weg.vorbereiten) weg.vorbereiten();
      let antwort;
      for (let i = 0; i < (weg.aufrufe || 1); i++) {
        antwort = neueAntwort();
        await handler(anfrage(adresse, weg.rumpf, weg), antwort, ...zusatz);
      }
      /* Kontrolle 2: der beabsichtigte Weg wurde gegangen. */
      expect(antwort.statusCode).toBe(weg.status);
      if (weg.zeile) expect(konsoleAlsText()).toContain(weg.zeile);
      /* Kontrolle 1: der Handler hat die Adresse gesehen. */
      expect(_rateState.has(adresse.wert)).toBe(weg.bremse !== false);
      expect(fundeDerAdresse(adresse)).toEqual([]);
    });
  });
}

/* ═══════════════════ handle-errors.js ═══════════════════ */

describe("Fehlermeldungen des Browsers: keine Adresse in irgendeiner Ausgabe", () => {
  gehe(handleErrors, [
    {
      name: "Normalfall: Meldung mit allen erlaubten Feldern",
      status: 204,
      zeile: '"type":"client-error"',
      rumpf: VOLLE_FEHLERMELDUNG,
    },
    { name: "Aufruf mit falscher Methode", status: 405, methode: "GET", bremse: false },
    {
      name: "Zu viele Aufrufe derselben Adresse",
      status: 429,
      aufrufe: 2,
      zeile: '"type":"client-error"',
      rumpf: VOLLE_FEHLERMELDUNG,
      vorbereiten: () => setzeSatz({ adressLimit: 1 }),
    },
    { name: "Rumpf ist kein gueltiges JSON", status: 400, rumpf: "{kaputt" },
    { name: "Rumpf fehlt", status: 400, rumpf: null },
    {
      name: "Der Handler stolpert beim Lesen des Rumpfs",
      status: 204,
      zeile: "errors-handler-failed",
      rumpf: stolpernderRumpf(),
    },
    {
      name: "Einstellungssatz fehlt",
      status: 204,
      zeile: "errors-handler-failed",
      bremse: false,
      rumpf: VOLLE_FEHLERMELDUNG,
      vorbereiten: entferneSatz,
    },
  ]);
});

/* ═══════════════════ handle-telemetry.js ═══════════════════ */

describe("Erfolgsmeldungen des Browsers: keine Adresse in irgendeiner Ausgabe", () => {
  gehe(handleTelemetry, [
    {
      name: "Normalfall: Erfolgsmeldung mit allen erlaubten Feldern",
      status: 204,
      zeile: '"type":"client-telemetry"',
      rumpf: VOLLE_ERFOLGSMELDUNG,
    },
    {
      name: "Realitaets-Check mit gueltigem Ticket",
      status: 204,
      zeile: '"eventType":"realitaets-check"',
      rumpf: REALITAETS_CHECK,
    },
    {
      name: "Realitaets-Check mit abgelehntem Ticket",
      status: 204,
      rumpf: REALITAETS_CHECK,
      vorbereiten: () => jobs.verbraucheRcTicket.mockResolvedValue(false),
    },
    { name: "Aufruf mit falscher Methode", status: 405, methode: "GET", bremse: false },
    {
      name: "Zu viele Aufrufe derselben Adresse",
      status: 429,
      aufrufe: 2,
      zeile: '"type":"client-telemetry"',
      rumpf: VOLLE_ERFOLGSMELDUNG,
      vorbereiten: () => setzeSatz({ adressLimit: 1 }),
    },
    { name: "Rumpf ist kein gueltiges JSON", status: 400, rumpf: "{kaputt" },
    { name: "Rumpf fehlt", status: 400, rumpf: null },
    {
      name: "Der Handler stolpert beim Lesen des Rumpfs",
      status: 204,
      zeile: "telemetry-handler-failed",
      rumpf: stolpernderRumpf(),
    },
    {
      name: "Einstellungssatz fehlt",
      status: 204,
      zeile: "telemetry-handler-failed",
      bremse: false,
      rumpf: VOLLE_ERFOLGSMELDUNG,
      vorbereiten: entferneSatz,
    },
  ]);
});

/* ═══════════════════ handle-enqueue.js ═══════════════════ */

const EINLASS_WEGE = [
  {
    name: "Normalfall: Foto angenommen",
    status: 200,
    zeile: '"step":"enqueue","status":"ok"',
    rumpf: einlassRumpf(),
  },
  { name: "Aufruf mit falscher Methode", status: 405, methode: "GET", bremse: false },
  {
    name: "Wartungsmodus (vor dem Lesen der Adresse)",
    status: 503,
    bremse: false,
    rumpf: einlassRumpf(),
    vorbereiten: () => counter.getMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Wartung" }),
  },
  {
    name: "Einstellungssatz fehlt",
    status: 503,
    zeile: "kein-einstellungssatz",
    bremse: false,
    rumpf: einlassRumpf(),
    vorbereiten: entferneSatz,
  },
  {
    name: "Zu viele Aufrufe derselben Adresse",
    status: 429,
    aufrufe: 2,
    zeile: '"step":"enqueue","status":"ok"',
    rumpf: einlassRumpf(),
    vorbereiten: () => setzeSatz({ adressLimit: 1 }),
  },
  {
    name: "Rumpf laut Kopfzeile zu gross",
    status: 413,
    zeile: "body-too-large",
    rumpf: einlassRumpf(),
    kopf: { "content-length": String(MAX_UPLOAD_BYTES * 2) },
  },
  {
    name: "Aufruf ohne Browser-Herkunft",
    status: 200,
    zeile: "no-browser-origin",
    rumpf: einlassRumpf(),
    kopf: { origin: "", referer: "" },
  },
  { name: "Honigtopf-Feld ausgefuellt", status: 403, rumpf: einlassRumpf({ website: "spam" }) },
  {
    name: "Bilddaten mit unzulaessigen Zeichen",
    status: 400,
    rumpf: einlassRumpf({ imageBase64: "###kein-base64###" }),
  },
  {
    name: "Bild ist laut Inhalt gar kein Bild",
    status: 400,
    rumpf: einlassRumpf({ imageBase64: Buffer.alloc(40).toString("base64") }),
  },
  {
    name: "Bildart laut Inhalt weicht von der Angabe ab",
    status: 400,
    zeile: "mime-mismatch",
    rumpf: einlassRumpf({ imageBase64: PNG.toString("base64") }),
  },
  {
    name: "Bild ueber der Groessengrenze",
    status: 413,
    rumpf: einlassRumpf({ imageBase64: "A".repeat(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 16) }),
  },
  {
    name: "Warteschlange schon voll (Vorpruefung)",
    status: 429,
    zeile: "queue-too-deep",
    rumpf: einlassRumpf(),
    vorbereiten: () => jobs.countQueuedJobs.mockResolvedValue(SATZ.warteschlangeTiefe + 1),
  },
  {
    name: "Warteschlange nachtraeglich voll (zweite Stufe)",
    status: 429,
    zeile: "queue-too-deep-nachtraeglich",
    rumpf: einlassRumpf(),
    vorbereiten: () => jobs.platzBestaetigen.mockResolvedValue(false),
  },
  {
    name: "Stundenlimit erreicht, Benachrichtigung geht hinaus",
    status: 429,
    rumpf: einlassRumpf(),
    vorbereiten: () =>
      counter.checkAndIncrement.mockResolvedValue({
        allowed: false,
        justReached: true,
        retryAfterSeconds: 120,
        count: SATZ.stundenlimit,
        limit: SATZ.stundenlimit,
      }),
  },
  {
    name: "Speichern oder Anlegen scheitert",
    status: 503,
    zeile: "store-or-create-failed",
    rumpf: einlassRumpf(),
    vorbereiten: () => storage.storeImage.mockRejectedValue(new Error("Speicher nicht erreichbar")),
  },
  /* TEST-2026-10-04-14: der Formular-Weg (multipart/form-data) der Fotoannahme.
     Er laeuft durch upload.js (parseMultipart) und bekommt dabei ALLE
     Kopfzeilen der Anfrage in die Hand — auch die mit der Adresse. */
  {
    name: "Formular-Weg: Foto angenommen",
    status: 200,
    zeile: '"step":"enqueue","status":"ok"',
    kopf: FORMULAR_KOPF,
    rohRumpf: formularRumpf(),
  },
  {
    name: "Formular-Weg: kein Foto im Formular",
    status: 400,
    zeile: '"code":"missing_image"',
    kopf: FORMULAR_KOPF,
    rohRumpf: formularRumpf({ ohneDatei: true }),
  },
  {
    name: "Formular-Weg: das Formular reisst mitten in einem Feld ab",
    status: 400,
    zeile: '"code":"bad_multipart"',
    kopf: FORMULAR_KOPF,
    rohRumpf: formularRumpf({ endetImFeld: true }),
  },
  {
    name: "Einreihen in die Warteschlange scheitert",
    status: 503,
    zeile: "enqueue-failed",
    rumpf: einlassRumpf(),
    vorbereiten: () => tasks.enqueueJob.mockRejectedValue(new Error("Warteschlange nicht erreichbar")),
  },
  {
    name: "Platzbestaetigung wirft einen Fehler (Annahme laeuft weiter)",
    status: 200,
    zeile: "platz-bestaetigung-fehlgeschlagen",
    rumpf: einlassRumpf(),
    vorbereiten: () => jobs.getJob.mockRejectedValue(Object.assign(new Error("Datenbank weg"), { code: 14 })),
  },
  {
    name: "Einlassgrenze nicht ermittelbar (Annahme laeuft weiter)",
    status: 200,
    zeile: "einlassgrenze-nicht-ermittelbar",
    rumpf: einlassRumpf(),
    vorbereiten: () => jobs.countQueuedJobs.mockRejectedValue(new Error("Zeitgrenze")),
  },
  {
    name: "Unerwarteter Fehler im Handler",
    status: 500,
    zeile: '"status":"error"',
    rumpf: einlassRumpf(),
    vorbereiten: () => counter.checkAndIncrement.mockRejectedValue(new Error("Zaehler nicht erreichbar")),
  },
];

describe("Fotoannahme: keine Adresse in irgendeiner Ausgabe", () => {
  gehe(handleEnqueue, EINLASS_WEGE, SECRETS);
});

/* ═══════════════ Die Protokollzeilen tragen nur ihre Felder ═══════════════ */

describe("Protokollzeilen: nur Felder, die dort hingehoeren", () => {
  const adresse = ADRESSEN[0];

  test("Fehlermeldung: jedes Feld der Zeile steht auf der Freigabeliste", async () => {
    await handleErrors(anfrage(adresse, VOLLE_FEHLERMELDUNG), neueAntwort());
    const pfade = blattpfade(zeileMit('"type":"client-error"'));
    /* Kontrolle: Die Zeile ist nicht leer, die Pruefung vergleicht also etwas. */
    expect(pfade.length).toBeGreaterThan(20);
    expect(pfade.filter((p) => p !== "type" && !LISTE_ERRORS.includes(p))).toEqual([]);
  });

  test("Erfolgsmeldung: jedes Feld der Zeile steht auf der Freigabeliste", async () => {
    await handleTelemetry(anfrage(adresse, VOLLE_ERFOLGSMELDUNG), neueAntwort());
    const pfade = blattpfade(zeileMit('"type":"client-telemetry"'));
    expect(pfade.length).toBeGreaterThan(10);
    expect(pfade.filter((p) => p !== "type" && !LISTE_TELEMETRIE.includes(p))).toEqual([]);
  });

  test("Realitaets-Check: die Zeile traegt nur die Stufen und den berechneten Wert", async () => {
    await handleTelemetry(anfrage(adresse, REALITAETS_CHECK), neueAntwort());
    const pfade = blattpfade(zeileMit('"eventType":"realitaets-check"'));
    expect(pfade.sort()).toEqual(
      [
        "type",
        "eventType",
        "score",
        "stufen.alter",
        "stufen.geschlecht",
        "stufen.interessen",
        "stufen.charakter",
        "stufen.werbung",
        "stufen.manipulation",
      ].sort()
    );
  });

  test("Fotoannahme: die Erfolgszeile traegt genau Zufallsnummer, Schritt und Ergebnis", async () => {
    const antwort = neueAntwort();
    await handleEnqueue(anfrage(adresse, einlassRumpf()), antwort, SECRETS);
    expect(antwort.statusCode).toBe(200);
    expect(Object.keys(zeileMit('"step":"enqueue"')).sort()).toEqual(["requestId", "status", "step"]);
  });
});

/* ═══════════════ Erfolgsweg: die Adresse bleibt der Schluessel der Bremse ═══════════════ */

describe("Erfolgsweg: die Adresse dient weiter der Missbrauchsbremse", () => {
  const [a, b] = [
    { wert: "203.0.113.10", anfang: "203.0.113" },
    { wert: "203.0.113.11", anfang: "203.0.113" },
  ];

  test.each([
    ["Fehlermeldungen", handleErrors, VOLLE_FEHLERMELDUNG, [], 204],
    ["Erfolgsmeldungen", handleTelemetry, VOLLE_ERFOLGSMELDUNG, [], 204],
    ["Fotoannahme", handleEnqueue, einlassRumpf(), [SECRETS], 200],
  ])("%s: zwei Adressen, zwei getrennte Zaehler", async (_name, handler, rumpf, zusatz, erfolg) => {
    setzeSatz({ adressLimit: 1 });
    const status = async (adresse) => {
      const antwort = neueAntwort();
      await handler(anfrage(adresse, rumpf), antwort, ...zusatz);
      return antwort.statusCode;
    };
    expect(await status(a)).toBe(erfolg);
    /* Dieselbe Adresse hat ihr Limit (1) verbraucht ... */
    expect(await status(a)).toBe(429);
    /* ... eine andere Adresse hat ihren eigenen Zaehler. */
    expect(await status(b)).toBe(erfolg);
    /* Im Arbeitsspeicher der Bremse stehen beide, und nur dort. */
    expect([..._rateState.keys()].sort()).toEqual([a.wert, b.wert]);
  });
});

/* ═══════════════ Kamera-Angaben und Dateiname beim Einlass ═══════════════ */

describe("Fotoannahme: von den Kamera-Angaben kommen nur Hersteller und Modell weiter", () => {
  const ORT_BREITE = "48.2082";
  const ORT_LAENGE = "16.3738";
  const AUFNAHMEDATUM = "2026:10:01 10:00:00";
  const DATEINAME = "Max_Mustermann_Geburtstag.jpg";

  function rumpfMitKameraAngaben(exif) {
    return einlassRumpf({
      exif,
      gps: { latitude: Number(ORT_BREITE), longitude: Number(ORT_LAENGE) },
      dateTimeOriginal: AUFNAHMEDATUM,
      filename: DATEINAME,
    });
  }

  test("Ort, Aufnahmedatum, Programmname und Dateiname erreichen weder Protokoll noch Auftrag", async () => {
    const exif = {
      make: "samsung",
      model: "SM-A546B",
      gpsLatitude: Number(ORT_BREITE),
      gpsLongitude: Number(ORT_LAENGE),
      dateTimeOriginal: AUFNAHMEDATUM,
      software: "Bearbeitungsprogramm-Marke",
    };
    const antwort = neueAntwort();
    await handleEnqueue(anfrage(ADRESSEN[0], rumpfMitKameraAngaben(exif)), antwort, SECRETS);
    expect(antwort.statusCode).toBe(200);
    /* Der Auftrag bekommt genau Hersteller und Modell. */
    expect(jobs.createJob).toHaveBeenCalledTimes(1);
    expect(jobs.createJob.mock.calls[0][0].exif).toEqual({ make: "samsung", model: "SM-A546B" });
    /* Und nirgends sonst steht einer der Werte. */
    const alles = alleAusgaben()
      .map((a) => a.text)
      .join("\n");
    for (const wert of [ORT_BREITE, ORT_LAENGE, "2026:10:01", "Max_Mustermann", "Bearbeitungsprogramm-Marke"]) {
      expect(alles).not.toContain(wert);
    }
  });

  test("Hersteller und Modell werden auf 100 Zeichen gekuerzt; Zahlen und Listen werden verworfen", async () => {
    await handleEnqueue(
      anfrage(ADRESSEN[0], rumpfMitKameraAngaben({ make: "m".repeat(150), model: "x".repeat(150) })),
      neueAntwort(),
      SECRETS
    );
    expect(jobs.createJob.mock.calls[0][0].exif).toEqual({ make: "m".repeat(100), model: "x".repeat(100) });

    jobs.createJob.mockClear();
    await handleEnqueue(
      anfrage(ADRESSEN[0], rumpfMitKameraAngaben({ make: 42, model: ["a"] })),
      neueAntwort(),
      SECRETS
    );
    expect(jobs.createJob.mock.calls[0][0].exif).toEqual({});
  });
});

/* ═══════════════ Messmittel-Kontrolle 3: die Suche findet die Adresse ═══════════════ */

describe("Messmittel: die Suche findet die Adresse, wenn sie da ist", () => {
  const adresse = ADRESSEN[0];

  test.each([
    ["console.log mit Text", () => console.log(`Aufrufer ${adresse.wert}`), "console.log"],
    ["console.warn mit Text", () => console.warn(`Aufrufer ${adresse.wert}`), "console.warn"],
    ["console.error mit Fehler", () => console.error(new Error(`Aufrufer ${adresse.wert}`)), "console.error"],
    [
      "console.info mit verschachteltem Objekt",
      () => console.info({ aufrufer: { adresse: adresse.wert } }),
      "console.info",
    ],
    ["Antwort-Rumpf", () => neueAntwort().status(200).json({ ip: adresse.wert }), "Antwort 1"],
    ["Antwort-Kopfzeile", () => neueAntwort().setHeader("X-Aufrufer", adresse.wert), "Antwort 1"],
    [
      "Aufruf an den Zaehler",
      () => counter.checkAndIncrement({ ip: adresse.wert }),
      "Aufruf counter.checkAndIncrement",
    ],
    [
      "Aufruf an die Auftragsverwaltung",
      () => jobs.createJob({ exif: { ort: adresse.wert } }),
      "Aufruf jobs.createJob",
    ],
    [
      "Aufruf an die Benachrichtigung",
      () => notify.notifyLimitReached(adresse.wert),
      "Aufruf notify.notifyLimitReached",
    ],
    ["nur der Anfang der Adresse", () => console.log(`Netz ${adresse.anfang}.0`), "console.log"],
  ])("%s", (_name, schreibe, kanal) => {
    schreibe();
    const funde = fundeDerAdresse(adresse);
    expect(funde).toHaveLength(1);
    expect(funde[0].startsWith(`${kanal}:`)).toBe(true);
  });

  test("ohne Ausgabe mit der Adresse bleibt die Suche leer", () => {
    console.log("Aufrufer unbekannt");
    neueAntwort().status(204).end();
    counter.checkAndIncrement({ ip: "unknown" });
    expect(fundeDerAdresse(adresse)).toEqual([]);
  });

  /* Die echte Zeile jedes Handlers: Schreibt der Aufrufer die Adresse selbst in
     ein Feld, das der Handler uebernimmt, steht sie in der Zeile — und die Suche
     sieht sie dort. Damit ist belegt, dass die Konsolenausgabe der Handler
     wirklich mitgelesen wird. */
  test.each([
    ["Fehlermeldungen", handleErrors, { errorMessage: `von ${adresse.wert}` }, []],
    ["Erfolgsmeldungen", handleTelemetry, { eventType: "analyze-success", url: `/?von=${adresse.wert}` }, []],
  ])(
    "%s: eine selbst mitgeschickte Adresse steht in der Zeile und wird gefunden",
    async (_n, handler, rumpf, zusatz) => {
      await handler(anfrage(adresse, rumpf), neueAntwort(), ...zusatz);
      const funde = fundeDerAdresse(adresse);
      expect(funde).toHaveLength(1);
      expect(funde[0].startsWith("console.")).toBe(true);
    }
  );

  test("Fotoannahme: ein Fehlertext mit der Adresse landet in der Zeile und wird gefunden", async () => {
    storage.storeImage.mockRejectedValue(new Error(`Speicher: ${adresse.wert}`));
    await handleEnqueue(anfrage(adresse, einlassRumpf()), neueAntwort(), SECRETS);
    expect(fundeDerAdresse(adresse).some((f) => f.startsWith("console.log:"))).toBe(true);
  });
});

/* ═══════════════ Waechter: jede Stelle, die die Adresse liest, steht hier ═══════════════ */

describe("Waechter: wer die Adresse des Aufrufers liest", () => {
  const SRC = path.join(__dirname, "..");
  const AUSGENOMMEN = new Set(["__tests__", "scripts", "node_modules"]);

  /* Alle Programmdateien unter src/, auch in Unterordnern. */
  function programmDateien(ordner) {
    const gefunden = [];
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (AUSGENOMMEN.has(eintrag.name)) continue;
      const voll = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) gefunden.push(...programmDateien(voll));
      else if (eintrag.name.endsWith(".js")) gefunden.push(voll);
    }
    return gefunden;
  }

  const LIEST_ADRESSE = /\bgetClientIp\b|\breq\.ips?\b|x-forwarded-for|remoteAddress|x-real-ip/i;

  test("die Suche erkennt einen Leser (Positivkontrolle)", () => {
    expect(LIEST_ADRESSE.test("const ip = getClientIp(req);")).toBe(true);
    expect(LIEST_ADRESSE.test('req.headers["X-Forwarded-For"]')).toBe(true);
    expect(LIEST_ADRESSE.test("const wert = req.body.ip;")).toBe(false);
    expect(programmDateien(SRC).length).toBeGreaterThan(20);
  });

  /* Die Suche oben sieht nur, was ueber console.* hinausgeht. Ein anderer
     Ausgabeweg (direkt auf stdout/stderr, die Logger-Bibliothek von Firebase)
     waere fuer sie unsichtbar — dann muss das Messmittel erweitert werden. */
  test("das Programm schreibt nur ueber console.* hinaus", () => {
    const ANDERER_WEG = /process\.(stdout|stderr)\b|firebase-functions\/logger|\bwinston\b|\bpino\b|\bbunyan\b/;
    expect(ANDERER_WEG.test("process.stdout.write(zeile)")).toBe(true);
    expect(ANDERER_WEG.test('require("firebase-functions/logger")')).toBe(true);
    expect(ANDERER_WEG.test("console.log(zeile)")).toBe(false);
    const andere = programmDateien(SRC)
      .filter((datei) => ANDERER_WEG.test(fs.readFileSync(datei, "utf8")))
      .map((datei) => path.relative(SRC, datei));
    expect(andere).toEqual([]);
  });

  test("nur der Einlass und die gemeinsame Annahme der Meldungen lesen sie", () => {
    const leser = programmDateien(SRC)
      .filter((datei) => path.basename(datei) !== "middleware.js")
      .filter((datei) => LIEST_ADRESSE.test(fs.readFileSync(datei, "utf8")))
      .map((datei) => path.relative(SRC, datei))
      .sort();
    /* Kommt ein weiterer Leser dazu: hier eintragen UND einen Weg-Katalog wie oben
       fuer ihn anlegen — sonst koennte er die Adresse hinschreiben, ohne dass es
       jemand merkt. middleware.js ist ausgenommen: Dort liegt die Definition, und
       ein Weg ueber die echte Bremse laeuft in jedem Weg-Katalog oben mit.
       meldungs-annahme.js liest sie fuer BEIDE Annahmestellen der Meldungen
       (handle-errors.js, handle-telemetry.js; STRUCT-2026-10-03-56): Deren
       Weg-Kataloge oben laufen durch dieses Modul. */
    expect(leser).toEqual(["handle-enqueue.js", "meldungs-annahme.js"]);
  });
});
