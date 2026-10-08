"use strict";

/**
 * handle-errors.js — Anonymes Client-Error-Logging.
 *
 * DSGVO: keine PII, keine IP-Speicherung, keine Cookies, keine persistente
 * Speicherung. Felder sind whitelist-validiert + laengenbegrenzt. Logs landen
 * in Cloud Logging und werden ueber die konfigurierte Retention automatisch
 * geloescht. Rate-Limit identisch zur restlichen API.
 *
 * Loggt mit severity ERROR. Gegenstueck: handle-telemetry.js fuer Success-
 * Events mit severity INFO.
 */

/* Rumpfpruefung, Wertgrenze und Messwert-Pruefung teilt diese Annahmestelle
   mit handle-telemetry.js; hier stehen nur ihre eigenen Feldlisten. */
const { rumpfAnnehmen, einfacheFelder, messwerte } = require("./meldungs-annahme");

const STRING_FIELDS = {
  errorName: 100,
  errorMessage: 500,
  phase: 50,
  url: 200,
  /* Client sendet nur noch den vergröberten UA ("Chrome 126 / Android");
     das knappe Limit ist das zweite Netz gegen volle UA-Strings alter Clients. */
  userAgent: 80,
  requestId: 50,
  traceId: 50,
  wakeLock: 40,
  fileFormat: 40,
  errorDetail: 60,
  /* Lesefehler-Diagnose (08.09.2026): Ergebnis des zweiten Lesewegs als
     Stichwort ("ok:940kb" oder ein Fehlername). Kein Dateiname, kein Inhalt. */
  zweiterLeseweg: 40,
  /* Kopf-Lesetest (16.09.2026): Liess sich wenigstens der Anfang der Datei
     lesen? "ok", "leer" oder ein Fehlername. Trennt "Geraet gibt die Datei gar
     nicht heraus" von "nicht vollstaendig". Kein Inhalt, kein Dateiname. */
  kopfLesetest: 40,
};
/* `msSeitAuswahl`: Zeit zwischen Dateiauswahl und Leseversuch (08.09.2026). */
const NUMBER_FIELDS = ["durationMs", "httpStatus", "fileSizeKb", "msSeitAuswahl"];
const BOOLEAN_FIELDS = ["online", "hidden"];

/* OHNE `enqueueMs` (Hochlade-Dauer), anders als bei den Erfolgsmeldungen —
   bewusst: Kein Fehlermelder des Browsers schickt Messwerte mit. Wer das
   aendert, nimmt ein neues Feld in den 30-Tage-Speicher auf: dann hier
   ergaenzen UND in public/__tests__/fixtures/datenschutz-deckung.json
   (STRUCT-2026-10-03-56; meldungen-gemeinsame-annahme.test.js haelt den
   Unterschied fest). */
const TIMING_KEYS = ["prepareImageMs", "fetchMs", "parseMs", "renderMs", "totalMs"];

/* Geraete- und Netzangaben: nur, was der Datenschutztext fuer die
   Fehlermeldungen nennt (Bildschirmgroesse als Klasse, Sprache, Netz).
   Arbeitsspeicher, Prozessorkerne und Pixeldichte nennt er nicht — sie stehen
   deshalb nicht auf der Liste und werden verworfen, auch wenn ein aelterer
   Browser sie noch schickt (PRIV-2026-10-03-39,
   fehlermeldung-geraeteangaben.test.js). */
const CLIENT_STRING_KEYS = { effectiveType: 20, language: 10, screen: 30 };
const CLIENT_NUMBER_KEYS = ["downlinkMbps", "rttMs"];
/* `automatisiert` = navigator.webdriver des Browsers (07.09.2026): Zehn
   "demo-image-load"-Meldungen in 30 Tagen stammten von automatisierten
   Browsern — erkennbar erst nach einer Stunde Messen. Ein Ja/Nein-Wert ohne
   Personenbezug; gefiltert wird nichts. */
const CLIENT_BOOL_KEYS = ["saveData", "automatisiert"];

function sanitizeClient(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [key, maxLen] of Object.entries(CLIENT_STRING_KEYS)) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, maxLen);
  }
  for (const key of CLIENT_NUMBER_KEYS) {
    if (typeof raw[key] === "number" && isFinite(raw[key])) out[key] = raw[key];
  }
  for (const key of CLIENT_BOOL_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function handleErrors(req, res) {
  try {
    const angenommen = await rumpfAnnehmen(req, res);
    if (!angenommen) return;
    const { body } = angenommen;

    const sanitized = { type: "client-error" };

    /* Fehlermeldungen lassen -1 als kleinste Zahl zu (wie seit jeher). */
    einfacheFelder(body, sanitized, {
      texte: STRING_FIELDS,
      zahlen: NUMBER_FIELDS,
      wahrheitswerte: BOOLEAN_FIELDS,
      kleinsteZahl: -1,
    });

    const timings = messwerte(body.timings, TIMING_KEYS);
    if (timings) sanitized.timings = timings;

    const client = sanitizeClient(body.client);
    if (client) sanitized.client = client;

    /* console.error → severity ERROR in Cloud Logging → alarmierbar. */
    console.error(JSON.stringify(sanitized));

    res.status(204).end();
  } catch (err) {
    console.log(JSON.stringify({ warning: "errors-handler-failed", error: err.message }));
    res.status(204).end();
  }
}

/* PRIV-2026-09-10-01 (Ursache): Jedes Feld, das dieser Endpunkt annimmt und
   damit bis zu 30 Tage im Diagnose-Speicher ablegt, als eine flache Liste
   (verschachtelte Felder mit Praefix). Nur fuer die Pruefungen:
   public/__tests__/datenschutz-deckung.test.js verlangt fuer jedes Feld eine
   Stelle im Datenschutztext, diagnose-freigabeliste.test.js belegt am echten
   Handler, dass er kein Feld liest, das hier fehlt. */
const _freigabeliste = [
  ...Object.keys(STRING_FIELDS),
  ...NUMBER_FIELDS,
  ...BOOLEAN_FIELDS,
  ...TIMING_KEYS.map((k) => `timings.${k}`),
  ...[...Object.keys(CLIENT_STRING_KEYS), ...CLIENT_NUMBER_KEYS, ...CLIENT_BOOL_KEYS].map((k) => `client.${k}`),
];

module.exports = { handleErrors, _freigabeliste };
