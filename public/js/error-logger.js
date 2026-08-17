/**
 * error-logger.js — Anonymes Client-Error-Logging.
 *
 * Sendet strukturierte Fehler-Metadaten an /api/errors. DSGVO: keine PII,
 * keine IP-Speicherung serverseitig, keine Cookies, kein User-Tracking —
 * nur Fehler-Typ, Phase, Dauer, anonyme Hardware-/Netzwerk-Klassen + grober
 * User-Agent.
 *
 * ── Warum es hier eine Warteschlange gibt (v3.3.1, BUG-2026-08-17-04) ──
 *
 * Bis v3.3.0 ging die Meldung per `fetch` raus und ein Fehler dabei wurde
 * still verschluckt. Das klingt harmlos, ist aber die Stelle, an der sich die
 * Fehlererfassung selbst aushebelt: Der haeufigste Fehler dieser Anwendung ist
 * „Verbindung weg" — und die Meldung darueber muss ueber genau die Verbindung,
 * die weg ist. Die Fehlerklasse, die am dringendsten sichtbar sein muesste,
 * war damit die einzige, die systematisch unsichtbar blieb.
 *
 * Belegt an echten Daten: Im 30-Tage-Diagnose-Bucket lagen ganze ZWEI
 * Client-Fehler, obwohl im selben Zeitraum mehrere Nutzer Fehler gemeldet
 * hatten. Die Statistik sah sauber aus, weil das Messmittel bei genau diesem
 * Fehler mit ausfiel.
 *
 * ── Warum die Warteschlange NUR im Arbeitsspeicher liegt ──
 *
 * Eine erste Fassung legte misslungene Meldungen in den `sessionStorage`. Das
 * war der falsche Weg: Die Datenschutzerklaerung zaehlt abschliessend auf, was
 * dort liegt — ein sechster Eintrag haette bedeutet, den Rechtstext an eine
 * Funktion anzupassen. Die Reihenfolge ist umgekehrt: Der Rechtstext ist die
 * Vorgabe, der Code richtet sich danach.
 *
 * Deshalb lebt die Warteschlange als einfaches Array im Modul. Sie hinterlaesst
 * NICHTS im Browser, ueberdauert kein Neuladen und braucht keine Zeile in der
 * Datenschutzerklaerung — der Seite steht ohnehin frei, waehrend ihrer Laufzeit
 * Daten im Arbeitsspeicher zu halten (das Profil selbst liegt genauso dort).
 *
 * Was das kostet, ehrlich benannt: Wer den Tab schliesst oder neu laedt,
 * waehrend das Netz weg ist, dessen Meldung ist verloren. Abgedeckt ist der
 * Fall, der in den Logs tatsaechlich auftrat — die Verbindung kommt zurueck,
 * waehrend die Seite noch offen ist.
 */

import { collectClientContext, coarseUserAgent } from "./client-context.js";

const ERROR_ENDPOINT = "/api/errors";
/* Deckel gegen Endlos-Wachstum: Bei einem laengeren Netzausfall koennte sonst
   jeder Poll-Durchgang eine Meldung nachlegen. Die aeltesten fliegen zuerst —
   der juengste Fehler ist der, der zum aktuellen Zustand passt. */
const WARTESCHLANGE_MAX = 10;

/* Reiner Arbeitsspeicher — bewusst kein sessionStorage, kein localStorage.
   Siehe Modul-Kommentar. */
let warteschlange = [];

function zurueckstellen(payload) {
  warteschlange.push(payload);
  if (warteschlange.length > WARTESCHLANGE_MAX) {
    warteschlange = warteschlange.slice(-WARTESCHLANGE_MAX);
  }
}

/** Nur fuer Tests und die Selbstpruefung: aktueller Stand der Warteschlange. */
export function offeneMeldungen() {
  return warteschlange.slice();
}

/**
 * Schickt eine Meldung ab. Gelingt das nicht, wandert sie in die
 * Warteschlange.
 *
 * `keepalive` sorgt dafuer, dass der Beacon auch beim Tab-Schliessen noch
 * durchgeht. Beachte: `fetch` lehnt einen echten Netzfehler mit einer
 * abgelehnten Promise ab — ein HTTP-Fehlerstatus dagegen gilt als Erfolg.
 * Beides wird hier getrennt behandelt, sonst zaehlte ein 500er als zugestellt.
 */
function senden(payload) {
  return fetch(ERROR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  })
    .then((resp) => {
      /* 4xx bedeutet: Der Server WILL diese Meldung nicht (Whitelist, Format).
         Sie erneut zu schicken, wuerde nur die Warteschlange verstopfen. 5xx
         dagegen ist ein voruebergehendes Serverproblem — die heben wir auf. */
      if (resp && !resp.ok && resp.status >= 500) throw new Error(`HTTP ${resp.status}`);
      return true;
    })
    .catch(() => {
      zurueckstellen(payload);
      return false;
    });
}

/**
 * Schickt zurueckgestellte Meldungen nach. Wird beim Ereignis „wieder online"
 * und beim Verlassen der Seite gerufen.
 *
 * Die Warteschlange wird VOR dem Senden geleert und eine misslungene Meldung
 * von `senden()` wieder zurueckgelegt. Andernfalls koennte ein Fehlschlag
 * mitten in der Schleife Meldungen doppelt ablegen.
 *
 * @returns {Promise<number>} Anzahl der erfolgreich zugestellten Meldungen.
 */
export function fehlerNachschicken() {
  if (warteschlange.length === 0) return Promise.resolve(0);
  const offen = warteschlange;
  warteschlange = [];
  return Promise.all(offen.map((p) => senden(p))).then((ergebnisse) => ergebnisse.filter(Boolean).length);
}

/** Verdrahtet das Nachschicken. Wird einmal beim Seitenstart gerufen. */
export function initFehlerNachsendung() {
  window.addEventListener("online", () => {
    fehlerNachschicken();
  });
  /* Letzter Versuch, bevor die Seite geht. `keepalive` in senden() haelt die
     Anfrage am Leben, auch wenn das Dokument schon abgebaut wird. Ist das Netz
     weiterhin weg, ist die Meldung verloren — das ist der bewusst getragene
     Preis dafuer, nichts im Browser zu hinterlassen. */
  window.addEventListener("pagehide", () => {
    fehlerNachschicken();
  });
}

export function logClientError(error, context = {}) {
  try {
    const clientCtx = collectClientContext();

    const payload = {
      errorName: (error && error.name) || "Error",
      errorMessage: ((error && error.message) || "").slice(0, 500),
      phase: typeof context.phase === "string" ? context.phase : "unknown",
      durationMs: typeof context.durationMs === "number" && isFinite(context.durationMs) ? context.durationMs : 0,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hidden: typeof document !== "undefined" ? document.hidden : false,
      userAgent: coarseUserAgent(),
      url: (typeof location !== "undefined" && location.pathname) || "",
      requestId: typeof context.requestId === "string" ? context.requestId : null,
      traceId: typeof context.traceId === "string" ? context.traceId : null,
      httpStatus: typeof context.httpStatus === "number" ? context.httpStatus : null,
      wakeLock: typeof context.wakeLock === "string" ? context.wakeLock : null,
      fileFormat: typeof context.fileFormat === "string" ? context.fileFormat : null,
      errorDetail: typeof context.errorDetail === "string" ? context.errorDetail : null,
      fileSizeKb: typeof context.fileSizeKb === "number" && isFinite(context.fileSizeKb) ? context.fileSizeKb : null,
      timings: context.timings && typeof context.timings === "object" ? context.timings : null,
      client: clientCtx,
    };

    /* Ist das Geraet nachweislich offline, gar nicht erst senden: Der Versuch
       scheitert ohnehin und die Warteschlange ist der schnellere Weg. */
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      zurueckstellen(payload);
      return;
    }

    senden(payload);
  } catch (_) {
    /* niemals werfen */
  }
}
