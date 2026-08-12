import { elements } from "./dom.js";
import { state } from "./state.js";
import { prepareImage } from "./exif.js";
import { startGeocoding } from "./geocoding.js";
import {
  setStatus,
  startScanAnim,
  stopScanAnim,
  showLimitBanner,
  showMaintenanceModal,
  showQueueWaiting,
  resetQueueWaiting,
} from "./ui.js";
import { renderCurrentMode } from "./render.js";
import * as liveAnzeige from "./live-anzeige.js";
import { speichereRcTicket, loescheRcTicket } from "./rc-ticket.js";
import * as realitaetsCheck from "./realitaets-check.js";
import { t, getLanguage } from "./i18n.js";
import { logClientError } from "./error-logger.js";
import { logTelemetry } from "./telemetry-logger.js";
import { generateTraceId } from "./client-context.js";

const PAGE_LOADED_AT = Date.now();
const MIN_INTERACTION_MS = 2000;

/* ── Wake-Lock ──────────────────────────────────────────────────────
   Verhindert, dass das Gerät während der (bis ~3 min langen) Analyse in
   Standby geht. Geht es schlafen, friert der Browser die Seite ein und die
   laufende fetch-Anfrage stirbt — der User sieht beim Aufwachen einen Fehler,
   obwohl der Server fertig gerechnet hat. Best-Effort: nicht jedes Gerät
   unterstützt die API, und ein manueller Power-Knopf-Druck sperrt trotzdem.

   v1.10.8: wakeLockStatus erfasst, ob/warum der Wake-Lock scheitert. Wird in
   der Telemetrie (Success + Error) mitgeschickt. Hintergrund: Der Wake-Lock
   greift offenbar auf keinem Geraet — bisher verschluckte das catch jeden
   Fehler stumm, wir hatten null Diagnose-Daten. Werte: "not-attempted",
   "unsupported", "acquired", "denied:<FehlerName>". */
let wakeLock = null;
let wakeLockStatus = "not-attempted";
/* v1.10.8: Guard gegen Doppel-Anfrage. acquireWakeLock wird jetzt aus dem
   User-Gesture-Kontext heraus aufgerufen (app.js handleNewFile, direkt im
   change/drop-Event) — und zusaetzlich als Fallback in analyzeImage. Der
   Guard stellt sicher, dass nur die ERSTE Anfrage zaehlt: ein zweiter Aufruf
   nach `await`-Punkten wuerde auf iOS mit NotAllowedError scheitern und den
   bereits gewonnenen Status ueberschreiben. */
let wakeLockRequested = false;

/* WICHTIG: iOS Safari erlaubt navigator.wakeLock.request("screen") nur,
   solange noch transiente User-Aktivierung besteht — also unmittelbar nach
   dem Tippen, VOR jedem `await`. Deshalb wird diese Funktion aus dem
   synchronen change/drop-Handler (app.js) aufgerufen, nicht erst tief in der
   asynchronen analyzeImage-Pipeline. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function acquireWakeLock() {
  if (wakeLockRequested) return;
  wakeLockRequested = true;
  if (!("wakeLock" in navigator)) {
    wakeLockStatus = "unsupported";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLockStatus = "acquired";
  } catch (err) {
    /* Verweigert/nicht verfügbar — kein Abbruch, läuft ohne Wake-Lock weiter. */
    wakeLock = null;
    wakeLockStatus = "denied:" + (err && err.name ? err.name : "unknown");
  }
}

function releaseWakeLock() {
  /* Guard zuruecksetzen, damit die naechste Analyse wieder anfordern darf. */
  wakeLockRequested = false;
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

/* v3.0.0: Das frühere Hinweis-Pop-up vor der Analyse ist ersatzlos entfernt
   (Entscheidung des Inhabers: „dieses Pop-Up liest sowieso keiner durch") —
   die Analyse startet direkt bei der Foto-/Demo-Wahl. Die Einordnung „nichts
   davon ist wahr" trägt weiterhin die Disclaimer-Box auf der Seite, im
   Ergebnis und im PDF. */
export async function analyzeImage() {
  if (state.isAnalyzing) return;
  /* Voriges Ergebnis ist ab jetzt ungueltig — der Umschalter darf waehrend der
     neuen Analyse nicht mehr oben kleben (styles.css: html[data-has-result]). */
  document.documentElement.removeAttribute("data-has-result");
  /* Sofort sichtbares Feedback, bevor irgendetwas ueber die Leitung geht.
     FIX 1 (v3.0.1): mit Text — Auge+Balken standen sonst bis zur ersten
     Warteschlangen-Antwort mehrere Sekunden stumm da (der Upload dauert). */
  startScanAnim(false);
  elements.scanText.textContent = t("scan.upload");
  /* Kurz auf /api/stats warten: Dort stehen Wartungsmodus und Stundenlimit.
     Loest dank Timeout in app.js immer zeitnah auf. */
  if (state.statsReady) await state.statsReady;
  if (state.isAnalyzing) return;
  return analyzeImageQueued();
}

/* ── Warteschlange — der einzige Weg (seit v2.10) ────────────────────
   Bild an /api/enqueue, danach /api/job-status alle 2 s abfragen. Jede
   Abfrage ist zugleich der Lebenszeichen-Herzschlag (siehe Backend).

   Der frühere synchrone Weg — eine 30-60 s offene Verbindung — ist mit v2.10
   entfernt. Er war seit Mai 2026 nur noch Rückfall über ein Feature-Flag und
   hätte bei Stoßlast genau das Problem zurückgebracht, wegen dem die
   Warteschlange gebaut wurde: lange offene Verbindungen brechen weg, und der
   Bildschirm-Wachhalter greift auf iPhones nicht. */

const ENQUEUE_URL = "/api/enqueue";
const JOB_STATUS_URL = "/api/job-status";
const POLL_INTERVAL_MS = 2000;
const JOB_ID_STORAGE_KEY = "malzime.queueJobId";
const JOB_TOKEN_STORAGE_KEY = "malzime.queueResultToken"; /* PRIV-003: Abhol-Ticket */
const JOB_DELIVERED_AT_KEY = "malzime.queueErgebnisZeit"; /* PRIV-107: erste Zustellung */

/* PRIV-107 (Kurzaudit 2026-08-11): Absolute Frist, wie lange ein FERTIGES
   Ergebnis per Reload wiederholbar bleibt — gerechnet ab der ERSTEN
   Zustellung, nicht ab dem letzten Reload (sonst schöbe jedes Neuladen die
   Frist vor sich her). Die 3-Minuten-Übergabepause unten greift nur über den
   Sichtbarkeits-Wechsel des Tabs; ein Gerät, das mit durchgehend sichtbarem
   Tab weitergereicht wird, fiel bisher durch — bis der Job serverseitig nach
   ~2 h verfällt. Diese Frist schließt das Fenster auch für diesen Fall. */
const ERGEBNIS_WIEDERHOLUNG_MS = 15 * 60 * 1000;
/* Historischer Schlüssel des entfernten Hinweis-Pop-ups (bis v3.0.1) — wird
   beim Aufräumen weiterhin mitgelöscht, damit alte Tab-Stände keinen toten
   Eintrag behalten. */
const JOB_DISCLAIMER_ACK_KEY = "malzime.queueDisclaimerAcked";
/* Aufeinanderfolgende job-status-Fehler, die der Poll-Loop toleriert, bevor
   er aufgibt — ein Netz-Wackler darf den wartenden User nicht rauswerfen,
   das Ergebnis liegt serverseitig sicher. */
const MAX_POLL_FAILURES = 5;
/* Gesamt-Obergrenze fürs Pollen. Bei randvollem Stundenbudget kann die ehrliche
   Wartezeit darüber liegen (Extremfall: ~950 wartende Jobs ≈ 100 min ETA) —
   dieser Deckel ist der bewusste Schlussstrich, damit kein Tab stundenlang
   pollt. Der aufgegebene Job wird nach der Herzschlag-Karenz gereapt und gibt
   seinen Stunden-Slot zurück. */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000;
/* Timeouts für die Queue-Fetches: Der Client darf nie vor dem Server aufgeben
   (enqueue-Function 60 s, job-status 10 s), aber ein Fetch, der nie settelt
   (Netz-Blackhole auf Mobilgeräten), darf den Wartefluss nicht einfrieren —
   Ein haengender Aufruf blockiert die Warteschlange damit nicht. */
const ENQUEUE_TIMEOUT_MS = 90000;
const POLL_TIMEOUT_MS = 30000;

/* BUG-003 (offen seit dem KURZAUDIT 07/2026, geschlossen 08/2026): Der Timer
   lief frueher im `.finally()` der fetch-Promise aus — also sobald die
   Kopfzeilen da waren. Bricht die Verbindung danach mitten im Antwort-Rumpf ab,
   ohne sich zu schliessen (typisch beim Zellenwechsel im Schulgebaeude), settelt
   `resp.json()` nie und die Warteschleife friert lautlos ein.
   Jetzt laeuft der Timer weiter, bis der Rumpf gelesen ist: `fetchWithTimeout`
   liefert die Antwort samt einer `jsonMitTimeout()`-Methode, die den Abbruch
   mit abdeckt. */
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).then(
    (resp) => {
      const roh = typeof resp.json === "function" ? resp.json.bind(resp) : null;
      /* Bei Fehlerantworten ist der Rumpf klein und wird ueber clone() gelesen —
         da braucht es keinen laufenden Timer mehr. Nur im Erfolgsfall bleibt er
         scharf, bis der Rumpf tatsaechlich gelesen ist. */
      if (!resp.ok || !roh) clearTimeout(timer);
      resp.jsonMitTimeout = roh
        ? () => roh().finally(() => clearTimeout(timer))
        : () => Promise.reject(new Error("Antwort ohne JSON-Rumpf"));
      return resp;
    },
    (err) => {
      clearTimeout(timer);
      throw err;
    }
  );
}

function storeJobId(jobId, resultToken) {
  try {
    sessionStorage.setItem(JOB_ID_STORAGE_KEY, jobId);
    /* PRIV-003: Abhol-Ticket zusammen mit der jobId merken (überlebt Reload/Tab). */
    if (resultToken) sessionStorage.setItem(JOB_TOKEN_STORAGE_KEY, resultToken);
    /* Neuer Auftrag → die Zustell-Uhr des vorigen Ergebnisses gilt nicht mehr. */
    sessionStorage.removeItem(JOB_DELIVERED_AT_KEY);
  } catch (_) {
    /* sessionStorage kann im privaten Modus werfen — kein harter Fehler. */
  }
  /* KA-02: Neuer Auftrag → das Realitäts-Check-Ticket des vorigen Ergebnisses
     ist verbraucht oder hinfällig. */
  loescheRcTicket();
}

/* PRIV-107: Zeitpunkt der ERSTEN Zustellung festhalten. Bewusst nur setzen,
   wenn noch nichts gemerkt ist — ein Resume-Rerender darf die Frist nicht
   verlängern. */
function markiereErgebnisZustellung() {
  try {
    if (!sessionStorage.getItem(JOB_DELIVERED_AT_KEY)) {
      sessionStorage.setItem(JOB_DELIVERED_AT_KEY, String(Date.now()));
    }
  } catch (_) {
    /* ohne Speicher keine Frist — dann räumt weiterhin die 2-h-Job-Frist ab */
  }
}

/* PRIV-107: true, wenn die Wiederholungs-Frist eines zugestellten Ergebnisses
   abgelaufen ist. Ohne gemerkten Zeitpunkt (laufender Auftrag) immer false. */
function ergebnisFristAbgelaufen() {
  try {
    const roh = sessionStorage.getItem(JOB_DELIVERED_AT_KEY);
    if (!roh) return false;
    return Date.now() - Number(roh) > ERGEBNIS_WIEDERHOLUNG_MS;
  } catch (_) {
    return false;
  }
}

/* Auch von der Absturz-Wache genutzt: Haengt ein Absturz an einem bestimmten
   wiederaufgenommenen Auftrag, muss der weg, sonst wiederholt er sich endlos. */
export function clearStoredJobId() {
  try {
    sessionStorage.removeItem(JOB_ID_STORAGE_KEY);
    sessionStorage.removeItem(JOB_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(JOB_DISCLAIMER_ACK_KEY);
    sessionStorage.removeItem(JOB_DELIVERED_AT_KEY);
  } catch (_) {
    /* dito */
  }
  /* KA-02: Zum Tab-Stand gehört auch das Realitäts-Check-Ticket. */
  loescheRcTicket();
}

/** Gibt eine offene jobId aus einem früheren Seitenbesuch zurück (oder null). */
export function getStoredJobId() {
  try {
    return sessionStorage.getItem(JOB_ID_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

/** PRIV-003: Gibt das gespeicherte Abhol-Ticket zurück (oder null). */
function getStoredResultToken() {
  try {
    return sessionStorage.getItem(JOB_TOKEN_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

/**
 * Wartet bis zum nächsten Poll — weckt aber sofort auf, sobald der Tab wieder
 * sichtbar wird. Hintergrund: Browser drosseln Timer in versteckten Tabs
 * massiv (am Handy frieren sie ganz ein). Ohne dieses Aufwecken holt ein
 * zurückkehrender Nutzer sein längst fertiges Ergebnis erst nach der
 * gedrosselten Verzögerung ab — das fühlt sich wie Minuten totes Warten an.
 * Mit dem visibilitychange-Wecker erscheint das Ergebnis ~1 s nach Rückkehr.
 * Der Listener wird pro Wartezyklus sauber wieder abgemeldet.
 */
function waitForNextPoll(ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const onVisible = () => {
      if (document.visibilityState === "visible") finish();
    };
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    }
    timer = setTimeout(finish, ms);
    document.addEventListener("visibilitychange", onVisible);
  });
}

/**
 * Pollt /api/job-status bis zu einem Terminal-Status. Jeder Poll erneuert
 * serverseitig den Liveness-Herzschlag des Jobs.
 * @param {boolean} [liveErlaubt] v3.0: Live-Text-Wellen aus processing-
 *        Antworten an die Live-Anzeige durchreichen. Nur der frische Upload
 *        setzt das — die Wiederaufnahme nach einem Reload bleibt bewusst beim
 *        heutigen Verhalten (Scan-Animation bis zum fertigen Ergebnis).
 * @returns {Promise<object|null>} {result} | {error,reason} | {abandoned}
 *          — oder null, wenn ein neuer Upload den Lauf abgelöst hat.
 */
async function pollJob(jobId, myId, resultToken, pollImmediately = false, liveErlaubt = false) {
  let failures = 0;
  let firstPoll = true;
  const pollStart = Date.now();
  for (;;) {
    if (state.requestId !== myId) return null;
    /* Beim Reload-Resume sofort EINMAL fragen statt erst nach 2s — ein bereits
       fertiges Ergebnis ist dann in ~0,3s da, der „Nachdenk"-Balken blitzt nur
       kurz auf statt 2s zu laufen. Danach normaler 2s-Takt. */
    if (!(firstPoll && pollImmediately)) {
      await waitForNextPoll(POLL_INTERVAL_MS);
    }
    firstPoll = false;
    if (state.requestId !== myId) return null;
    /* Hängt der Job dauerhaft → nicht endlos weiterpollen. */
    if (Date.now() - pollStart > MAX_POLL_DURATION_MS) {
      return { error: t("error.timeout") };
    }

    let data;
    try {
      const tokenParam = resultToken ? `&token=${encodeURIComponent(resultToken)}` : "";
      const resp = await fetchWithTimeout(
        `${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}${tokenParam}`,
        {},
        POLL_TIMEOUT_MS
      );
      if (!resp.ok) {
        /* 404 = Job existiert nicht (mehr) — kein transienter Fehler. */
        if (resp.status === 404) return { error: t("error.queueFailed") };
        throw new Error(`HTTP ${resp.status}`);
      }
      data = await resp.jsonMitTimeout();
      failures = 0;
      /* Zeitstempel des letzten erfolgreichen Polls: Daran erkennt die
         Wiederaufnahme, ob diese Schleife noch lebt oder in einem eingefrorenen
         fetch feststeckt. */
      state.lastPollOk = Date.now();
    } catch (_) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        /* transient: Die Verbindung ist weg, NICHT der Job. Der läuft
           serverseitig weiter und das Ergebnis liegt rund zwei Stunden bereit.
           Der Aufrufer darf die Job-Nummer deshalb nicht wegwerfen — sonst ist
           das fertige Profil unerreichbar, obwohl es existiert. */
        return { error: t("error.connectionLost"), transient: true };
      }
      continue;
    }

    if (state.requestId !== myId) return null;

    switch (data.status) {
      case "queued":
        showQueueWaiting("queued", data.position, data.etaSeconds);
        break;
      case "processing":
        showQueueWaiting("processing");
        /* v3.0: Liefert der Server schon Live-Text (Flag useLiveText), tippt
           die Live-Anzeige ihn mit — sie versteckt beim ersten Zeichen selbst
           die Scan-Animation. Beide Felder gehen als EINE Welle ans Modul:
           `standard` (liveText) und, sobald das Modell es schreibt, das
           Beast-Profil (liveTextBeast) — angezeigt wird dort der Puffer des
           gerade gewählten Modus. Ohne liveText-Feld ist das ein No-Op und
           alles bleibt exakt wie heute. */
        if (liveErlaubt && typeof data.liveText === "string") {
          liveAnzeige.welle({
            standard: data.liveText,
            beast: typeof data.liveTextBeast === "string" ? data.liveTextBeast : null,
          });
        }
        break;
      case "done":
        /* KA-02: Das Einmal-Ticket für den Realitäts-Check kommt genau mit
           der ersten Auslieferung (danach nie wieder) — sofort merken, damit
           es Reload und Tab-Wiederaufnahme im 15-Minuten-Fenster überlebt. */
        if (typeof data.rcTicket === "string") speichereRcTicket(data.rcTicket);
        return { result: data.result };
      case "failed":
        return { error: t("error.queueFailed"), reason: data.errorReason };
      case "abandoned":
        return { abandoned: true };
      default:
        return { error: t("error.queueFailed") };
    }
  }
}

/* Wie lange ohne erfolgreiche Statusabfrage, bis der Durchgang als
   steckengeblieben gilt. Zwei normale Abfrage-Intervalle plus Puffer — kurz
   genug, dass niemand lange vor einer toten Seite sitzt, lang genug, dass ein
   kurzer Tab-Wechsel keinen Neustart ausloest. */
const STECKENGEBLIEBEN_MS = 8000;

/**
 * Holt das Ergebnis nach, wenn die Seite aus dem Hintergrund zurueckkommt.
 *
 * WARUM DAS NOETIG IST: Sperrt man das Handy, friert der Browser die Seite
 * ein — nicht nur die laufende Netzwerkanfrage, sondern die JavaScript-
 * Ausfuehrung insgesamt. Beim Zurueckkommen kann die Abfrage-Schleife in einem
 * fetch feststecken, der nie zurueckkommt: kein Fehler, kein Ergebnis, kein
 * Spinner. Ein erster Anlauf hat nur die Fehlerzaehlung angefasst und genau
 * diesen stillen toten Zustand erzeugt.
 *
 * Deshalb wird hier nicht repariert, sondern neu aufgesetzt: Ist seit der
 * letzten erfolgreichen Statusabfrage zu viel Zeit vergangen, startet der
 * Durchgang neu. Der Job laeuft serverseitig ohnehin unabhaengig vom Browser
 * weiter und das Ergebnis liegt rund zwei Stunden bereit — genau dafuer wurde
 * die Warteschlange gebaut.
 */
/* PRIV-004 (Audit 2026-08-10): Obergrenze, wie lange ein fertiges Ergebnis im
   Tab abrufbar bleibt.

   Nach einer erfolgreichen Analyse bleiben Job-Nummer und Abhol-Ticket bewusst
   stehen, damit ein Neuladen das Profil wiederholt. Im Klassenzimmer wird ein
   Tablet aber weitergereicht, ohne den Tab zu schliessen — und dann sieht das
   naechste Kind das Profil des vorigen, inklusive Altersschaetzung und
   Manipulations-Triggern — ein fremdes Profil hat auf einem weitergereichten
   Geraet nichts verloren.

   Das Sicherheitsmodell fuehrte diesen Fall als abgedeckt ("Ticket lebt im Tab
   und stirbt mit ihm") — aber der Dritte im Klassenzimmer ist derselbe Tab.

   Kompromiss: Ein kurzer App-Wechsel aendert nichts (Reload-Wiederholung bleibt
   erhalten), eine laengere Pause laesst das Ticket fallen. Ein weitergereichtes
   Geraet liegt praktisch immer laenger als das hier still. */
const UEBERGABE_PAUSE_MS = 3 * 60 * 1000;
let seitWannVerborgen = 0;

export function initHintergrundWiederaufnahme() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      seitWannVerborgen = Date.now();
      return;
    }

    /* War die Seite lange genug weg, gilt das Geraet als weitergereicht. */
    if (seitWannVerborgen && Date.now() - seitWannVerborgen > UEBERGABE_PAUSE_MS) {
      seitWannVerborgen = 0;
      clearStoredJobId();
      return;
    }
    seitWannVerborgen = 0;

    /* UX-001: Ist gerade ein Upload unterwegs, der noch keine Job-Nummer hat,
       niemals dazwischenfunken. Sonst verdraengt die Wiederaufnahme den
       laufenden Durchgang (ueber state.requestId) und rendert das VORIGE
       Ergebnis neben dem NEUEN Foto — waehrend das neue Foto nie hochgeladen
       wird. Dieselbe Sperre schliesst das Fenster beim Warten auf /api/stats. */
    if (state.uploadLaeuft) return;

    if (!getStoredJobId()) return;

    /* Laeuft die Schleife normal weiter, nichts tun — der visibilitychange-
       Wecker in waitForNextPoll holt das Ergebnis von selbst.
       UX-002: Auch nach einer FERTIGEN Analyse nichts tun. Die Job-Nummer
       bleibt dann bewusst stehen (Reload soll das Ergebnis wiederholen), aber
       `isAnalyzing` ist false — ohne diese Bedingung loeste jeder Tab-Wechsel
       eine volle Wiederaufnahme samt Sprung an den Seitenanfang aus. */
    if (!state.isAnalyzing) return;

    const stillSeit = Date.now() - (state.lastPollOk || 0);
    if (stillSeit < STECKENGEBLIEBEN_MS) return;

    resumeQueueJob({ force: true });
  });
}

/* DATENSCHUTZ-ENTSCHEIDUNG (bewusst): Nach einem Reload zeigen wir das
   hochgeladene Foto NICHT wieder. Es wird unmittelbar nach der Analyse
   serverseitig gelöscht und absichtlich NIRGENDS — auch nicht im Browser —
   zwischengespeichert; Datensparsamkeit hat Vorrang. Statt einer leeren Lücke
   setzen wir an die Stelle des Fotos einen kurzen, positiven Datenschutz-
   Hinweis: der „verschwundene" Anblick wird so zum Lerneffekt. */
function showPhotoDeletedNotice() {
  if (!elements.imagePreview) return;
  const note = document.createElement("div");
  note.className = "photo-deleted-note";
  note.setAttribute("role", "note");

  /* Das Schloss-Symbol kommt rein dekorativ aus dem CSS (::before) — so bleibt
     kein hartcodierter Text im JS (i18n-Guardian), und Screenreader lesen es
     nicht vor. Der eigentliche Text läuft über t() (DE/EN). */
  const text = document.createElement("span");
  text.className = "photo-deleted-text";
  const strong = document.createElement("strong");
  strong.textContent = t("reload.photoTitle");
  text.appendChild(strong);
  text.appendChild(document.createTextNode(" " + t("reload.photoBody")));

  note.appendChild(text);
  elements.imagePreview.innerHTML = "";
  elements.imagePreview.appendChild(note);
}

/**
 * Rendert das fertige Queue-Ergebnis (renderCurrentMode → Success-Telemetrie).
 * v3.0.0: Lief Live-Text, wird VOR dem Rendern der Rest-Puffer im
 * Schnellvorlauf ausgetippt — deshalb async. Das Rendern samt Verdecken der
 * Enthüllung bleibt danach synchron im selben Frame.
 */
async function renderQueueResult(data, myId, traceId, timings) {
  /* PRIV-107: Ab der ersten Zustellung läuft die Wiederholungs-Frist. */
  markiereErgebnisZustellung();
  if (!data) {
    /* Nie halben Live-Text stehen lassen — Karte weg, normale Fehlermeldung. */
    liveAnzeige.abbrechen();
    setStatus(t("error.queueFailed"), traceId);
    return;
  }
  /* Client-seitige Daten injizieren — GPS/dateTimeOriginal erreichen nie unsere
     Server. Nach einem Reload fehlt state.lastPrepared; dann bleibt GPS leer. */
  if (!data.exif) data.exif = {};
  if (state.lastPrepared && state.lastPrepared.gps) {
    data.exif.gpsLatitude = state.lastPrepared.gps.latitude;
    data.exif.gpsLongitude = state.lastPrepared.gps.longitude;
  }
  if (state.lastPrepared && state.lastPrepared.dateTimeOriginal) {
    data.exif.dateTimeOriginal = state.lastPrepared.dateTimeOriginal;
  }

  const renderStart = Date.now();
  const finishRender = () => {
    if (state.requestId !== myId) return;
    state.lastData = data;
    renderCurrentMode(data);
    /* v3.1: Realitäts-Check VOR der Enthüllung aufbauen — bei einem echten
       Menschen-Profil wird die Karte sichtbar und die Enthüllung staffelt
       sie zwischen Manipulations- und Datenwert-Box mit ein; bei Tier-
       Profil, blocked oder leerem Profil bleibt sie versteckt. */
    realitaetsCheck.neuesErgebnis(data);
    /* v3.0: Lief für diesen Job Live-Text, wird das eben Gerenderte im selben
       Frame verdeckt und gestaffelt enthüllt (live-anzeige.js). Lief KEINER
       (Flag aus, Tier-Profil, blocked, Resume nach Reload), räumt abbrechen()
       höchstens eine verwaiste Live-Karte weg — der heutige Pfad bleibt
       Pixel für Pixel unverändert. */
    const liveEnthuellung = liveAnzeige.hatLiveGelaufen() && data.profiles && data.meta?.mode !== "animal";
    if (liveEnthuellung) {
      liveAnzeige.starteEnthuellung();
    } else {
      liveAnzeige.abbrechen();
    }
    setStatus("");
    /* Kein Sprung nach oben mitten in der Enthüllung — der Blick bleibt bei
       der Live-Karte („das wirkt irgendwie unnatürlich", Live-Test 11.08.).
       Ohne Live-Lauf bleibt das alte Verhalten unverändert. */
    if (!liveEnthuellung) window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      if (elements.resultsPanel) elements.resultsPanel.focus({ preventScroll: true });
    }, 300);
    const meta = data.meta || {};
    logTelemetry("analyze-success", {
      traceId,
      durationMs: timings.totalMs,
      timings: { ...timings, renderMs: Date.now() - renderStart },
      meta: {
        subject: typeof meta.subject === "string" ? meta.subject : undefined,
        mode: typeof meta.mode === "string" ? meta.mode : undefined,
        lang: getLanguage(),
        wakeLock: wakeLockStatus,
        queue: true,
      },
    });
  };

  /* v3.0.0: Erst den ungetippten Rest im Schnellvorlauf zu Ende tippen (ohne
     Live-Lauf löst das sofort auf), DANN rendern — sonst bricht das Tippen
     mitten im Wort ab und das Ergebnis springt hart ins Bild. */
  await liveAnzeige.schnellVorlauf();
  if (state.requestId !== myId) return;
  finishRender();
}

async function analyzeImageQueued() {
  state.isAnalyzing = true;
  /* UX-001 (Audit 2026-08-10): Ab hier gehoert der Bildschirm dem NEUEN Foto.
     Die Job-Nummer des vorigen Durchgangs bleibt nach einem Erfolg bewusst
     stehen (damit ein Reload das Ergebnis wiederholen kann) — sie darf aber
     nicht mehr abgeholt werden, sobald ein neues Foto unterwegs ist. Ohne diese
     zwei Zeilen holte ein Tab-Wechsel waehrend des Uploads das ALTE Ergebnis
     und zeigte es neben dem NEUEN Foto; das neue Foto wurde nie hochgeladen. */
  clearStoredJobId();
  state.uploadLaeuft = true;
  state.lastPollOk = Date.now();

  const myId = ++state.requestId;
  const analyzeStartTime = Date.now();
  const traceId = generateTraceId();
  state.lastTraceId = traceId;
  const timings = {};

  setStatus("");
  /* v3.0: Reste eines vorigen Live-Erlebnisses (Karte, Verdeckungen) räumen —
     dieser Durchgang beginnt sauber, gelaufen ist für ihn noch nichts. */
  liveAnzeige.zuruecksetzen();
  /* v3.1: Neues Foto = der Realitäts-Check des vorigen Ergebnisses ist
     hinfällig — Antworten, Sperre, Ergebnis und Karte vollständig zurück. */
  realitaetsCheck.zuruecksetzen();
  elements.facts.innerHTML = "";
  elements.privacy.innerHTML = "";
  elements.gpsMap.innerHTML = "";
  elements.targeting.innerHTML = "";
  elements.dataValue.innerHTML = "";
  elements.simulation.innerHTML = "";
  elements.exportPdf.classList.add("export-btn--hidden");

  /* Warte-Animation starten — Phase wird in showQueueWaiting weitergeschaltet:
     queued zeigt die Position, processing die gewohnten Analyse-Meldungen.
     FIX 1 (v3.0.1): Bis zur ersten Warteschlangen-Antwort steht der Upload-
     Hinweis statt eines leeren Texts — es darf ab der ersten Sekunde nie leer
     sein (der Foto-Upload dauert mehrere Sekunden). */
  resetQueueWaiting();
  startScanAnim(false);
  elements.scanText.textContent = t("scan.upload");
  /* v3.0.3 Blick-Führung: Ab jetzt gehört der Blick diesem Lauf — die
     Übernahme-Wache startet EINMAL pro Analyse (ein eigener Scroll des
     Nutzers stoppt alle automatischen Bewegungen dauerhaft), und das Auge
     wird ins Bild geholt, falls es unter der Sichtkante liegt (am Handy
     sieht man sonst nur das Foto, aber nicht, dass etwas passiert). Die
     Wiederaufnahme nach einem Neuladen bleibt bewusst ohne Führung. */
  liveAnzeige.fuehrungStarten();
  liveAnzeige.augeInsBild();

  const file = state.lastFile || elements.fileInput.files[0];
  if (!file) {
    stopScanAnim();
    setStatus(t("error.noFile"));
    state.isAnalyzing = false;
    state.uploadLaeuft = false;
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    stopScanAnim();
    setStatus(t("error.fileTooLarge"));
    state.isAnalyzing = false;
    state.uploadLaeuft = false;
    return;
  }
  /* Honeypot — Bots füllen unsichtbare Felder aus */
  const hp = document.getElementById("website");
  if (hp && hp.value) {
    stopScanAnim();
    state.isAnalyzing = false;
    state.uploadLaeuft = false;
    return;
  }
  /* Mindest-Interaktionszeit — kein Mensch lädt in < 2s hoch */
  if (Date.now() - PAGE_LOADED_AT < MIN_INTERACTION_MS) {
    await sleep(MIN_INTERACTION_MS - (Date.now() - PAGE_LOADED_AT));
  }

  try {
    await acquireWakeLock();

    /* Bild komprimieren + EXIF extrahieren (client-seitig) */
    const prepareStart = Date.now();
    if (!state.lastPrepared) {
      state.lastPrepared = await prepareImage(file);
    }
    timings.prepareImageMs = Date.now() - prepareStart;
    if (state.requestId !== myId) return;

    /* Geocoding parallel starten wenn GPS vorhanden */
    if (state.lastPrepared.gps) {
      startGeocoding(state.lastPrepared.gps.latitude, state.lastPrepared.gps.longitude);
    }

    /* ── Job einreihen ── */
    const enqueueStart = Date.now();
    const enqueueResp = await fetchWithTimeout(
      ENQUEUE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: state.lastPrepared.imageBase64,
          exif: state.lastPrepared.exif,
          mimeType: "image/jpeg",
          filename: "upload.jpg",
          lang: getLanguage(),
          traceId,
        }),
      },
      ENQUEUE_TIMEOUT_MS
    );
    timings.enqueueMs = Date.now() - enqueueStart;
    if (state.requestId !== myId) return;

    if (!enqueueResp.ok) {
      stopScanAnim();
      let parsed = null;
      try {
        parsed = await enqueueResp.clone().json();
      } catch (_) {
        /* kein JSON-Body */
      }
      if (enqueueResp.status === 429 && parsed && parsed.blocked === "limit") {
        showLimitBanner(parsed.retryAfterSeconds || 600);
        setStatus(t("error.rateLimit"), traceId);
      } else if (enqueueResp.status === 503 && parsed && parsed.maintenance) {
        showMaintenanceModal(parsed.message);
      } else if (enqueueResp.status === 413) {
        setStatus(t("error.imageTooLarge"), traceId);
      } else if (enqueueResp.status === 400) {
        setStatus(t("error.invalidFormat"), traceId);
      } else {
        setStatus(t("error.serverBusy"), traceId);
      }
      logClientError(new Error(`enqueue HTTP ${enqueueResp.status}`), {
        phase: "queue-enqueue",
        durationMs: Date.now() - analyzeStartTime,
        requestId: String(myId),
        traceId,
        httpStatus: enqueueResp.status,
        wakeLock: wakeLockStatus,
      });
      return;
    }

    const enqueueData = await enqueueResp.jsonMitTimeout();
    const jobId = enqueueData && enqueueData.jobId;
    if (!jobId) {
      stopScanAnim();
      setStatus(t("error.queueFailed"), traceId);
      return;
    }
    /* PRIV-003: Abhol-Ticket vom Server merken + bei jedem Poll mitschicken. */
    const resultToken = enqueueData.resultToken || null;
    storeJobId(jobId, resultToken);
    /* Ab hier gibt es wieder eine Job-Nummer, die zum aktuellen Foto gehoert —
       die Hintergrund-Wiederaufnahme darf also wieder uebernehmen. */
    state.uploadLaeuft = false;

    /* ── Auf das Ergebnis pollen (jeder Poll = Liveness-Herzschlag) ──
       liveErlaubt: nur hier, beim frischen Upload, darf die Live-Anzeige
       mittippen (v3.0) — die Wiederaufnahme unten bleibt beim heutigen Bild. */
    const outcome = await pollJob(jobId, myId, resultToken, false, true);
    if (state.requestId !== myId) return;

    stopScanAnim();
    elements.scanText.textContent = "";

    if (!outcome) return;

    if (outcome.abandoned) {
      /* v3.0: nie halben Live-Text stehen lassen — Karte samt Text weg. */
      liveAnzeige.abbrechen();
      clearStoredJobId();
      setStatus(t("error.queueAbandoned"), traceId);
      return;
    }
    if (outcome.error) {
      /* v3.0: dito — der Fehler gehört auf den heutigen, ungestörten Weg. */
      liveAnzeige.abbrechen();
      /* Nur aufräumen, wenn der Job WIRKLICH weg ist (404, failed, abgelaufen).
         Bei einem Verbindungsabbruch bleibt die Nummer stehen: Sie ist der
         einzige Weg zurück zum fertigen Ergebnis — über die automatische
         Wiederaufnahme oder ein Neuladen der Seite. */
      if (!outcome.transient) clearStoredJobId();
      setStatus(outcome.error, traceId);
      logClientError(new Error(outcome.reason || "queue_failed"), {
        phase: "queue-poll",
        durationMs: Date.now() - analyzeStartTime,
        requestId: String(myId),
        traceId,
        wakeLock: wakeLockStatus,
      });
      return;
    }

    /* Erfolg: jobId + Abhol-Ticket bewusst NICHT löschen. So holt ein Reload
       der Seite das Ergebnis erneut ab — es liegt serverseitig noch bis zu 2 h
       (PRIV-004) und ist durch das Ticket geschützt. Das ist der häufigste
       „Mein Profil ist nach dem Neuladen weg"-Fall. Überschrieben wird der
       Eintrag vom nächsten Upload; ist der Job serverseitig schon weg, räumt
       resumeQueueJob beim nächsten Seitenstart still auf. */
    timings.totalMs = Date.now() - analyzeStartTime;
    /* Das Ergebnis rendert direkt in die Dramaturgie hinein — nach dem
       Schnellvorlauf des restlichen Live-Texts (v3.0.0, daher await). */
    await renderQueueResult(outcome.result, myId, traceId, timings);
  } catch (err) {
    if (state.requestId !== myId) return;
    /* v3.0: auch beim harten Fehler keinen halben Live-Text stehen lassen. */
    liveAnzeige.abbrechen();
    stopScanAnim();
    elements.scanText.textContent = "";

    let phase;
    if (err.message === "read_failed") {
      phase = "image-read";
      setStatus(t("error.readFailed"), traceId);
    } else if (err.message === "image_decode_failed") {
      phase = "image-decode";
      setStatus(t("error.decodeFailed"), traceId);
    } else if (!navigator.onLine) {
      phase = "offline";
      setStatus(t("error.offline"), traceId);
    } else {
      phase = "queue-network";
      setStatus(t("error.networkError"), traceId);
    }
    logClientError(err, {
      phase,
      durationMs: Date.now() - analyzeStartTime,
      requestId: String(myId),
      traceId,
      wakeLock: wakeLockStatus,
      fileFormat: err.fileFormat,
      errorDetail: err.errorDetail,
      fileSizeKb: err.fileSizeKb,
    });
  } finally {
    releaseWakeLock();
    if (state.requestId === myId) {
      state.isAnalyzing = false;
      state.uploadLaeuft = false;
    }
  }
}

/**
 * Holt nach einem Seiten-Neuladen ein noch offenes Queue-Ergebnis ab: Liegt
 * eine jobId aus einem früheren Seitenbesuch in sessionStorage, wird das
 * Polling fortgesetzt und das Ergebnis angezeigt. Das eliminiert die
 * „Geister-Durchläufe" — der User bekommt sein Profil auch dann, wenn er die
 * Seite versehentlich neu geladen oder kurz verlassen hat. Wird beim
 * Seitenstart aufgerufen; ohne offene jobId ein No-Op.
 */
export async function resumeQueueJob({ force = false } = {}) {
  const jobId = getStoredJobId();
  if (!jobId) return;
  /* PRIV-107: Ein bereits zugestelltes Ergebnis ist nur 15 Minuten lang per
     Reload wiederholbar. Danach still aufräumen — das Gerät gilt als
     weitergereicht, die nächste Person startet sauber. */
  if (ergebnisFristAbgelaufen()) {
    clearStoredJobId();
    return;
  }
  /* Normalerweise nicht dazwischenfunken, wenn gerade eine Analyse laeuft.
     force=true kommt von der Hintergrund-Wiederaufnahme: Dort ist der laufende
     Durchgang nachweislich stehengeblieben, und ein neuer Anlauf ist der Sinn
     der Sache. Das ++state.requestId unten beendet den alten sauber. */
  if (state.isAnalyzing && !force) return;
  /* PRIV-003: das gespeicherte Abhol-Ticket mitnehmen (überlebt den Reload). */
  const resultToken = getStoredResultToken();

  state.isAnalyzing = true;
  const myId = ++state.requestId;
  const traceId = generateTraceId();
  const startTime = Date.now();

  /* state.lastPrepared ist nach einem Reload leer — GPS kann nicht mehr
     injiziert werden (verlässt den Browser ohnehin nie). Das Profil selbst
     liegt vollständig serverseitig. */
  /* v3.0: Die Wiederaufnahme bleibt bewusst beim heutigen Bild (Scan-Animation
     bis zum fertigen Ergebnis). Ein eventuell mitten im Tippen eingefrorener
     Live-Lauf wird hier restlos weggeräumt — nie halben Text stehen lassen. */
  liveAnzeige.zuruecksetzen();
  resetQueueWaiting();
  startScanAnim(false);
  /* FIX 1 (v3.0.1): Auch die Wiederaufnahme startet nie mit leerem Text. */
  elements.scanText.textContent = t("scan.resume");

  try {
    /* pollImmediately=true: das fertige Ergebnis sofort holen, ohne 2s-Vorlauf. */
    const outcome = await pollJob(jobId, myId, resultToken, true);
    if (state.requestId !== myId) return;

    stopScanAnim();
    elements.scanText.textContent = "";

    /* Resume ist eine stille Hintergrund-Wiederherstellung beim Seitenstart.
       Ist der Job weg oder fehlgeschlagen (abgelaufen / abgebrochen / nach 2 h
       serverseitig gelöscht → 404), den User NICHT mit einer Fehlermeldung
       erschrecken: still aufräumen und die normale Startseite zeigen. */
    if (!outcome || outcome.abandoned || outcome.error) {
      clearStoredJobId();
      setStatus("");
      return;
    }
    /* Erfolg: Ticket behalten, damit auch ein weiterer Reload das Ergebnis
       wieder zeigt (bis zum nächsten Upload oder bis der Job serverseitig
       abläuft). */
    /* Foto ist nach einem Reload weg (Datenschutz, s. showPhotoDeletedNotice) →
       an seine Stelle den positiven Datenschutz-Hinweis setzen.

       ABER NUR DANN. Bei der Wiederaufnahme aus dem Hintergrund lief die Seite
       durchgehend, das Foto steht also noch im Fenster — es hier zu entfernen
       wäre ein unnötiger Verlust: Der Nutzer hat sein Bild gerade eben selbst
       ausgewählt und will es neben dem Ergebnis sehen. Datenschutzrechtlich
       ändert das nichts, denn gespeichert wird nach wie vor nirgends etwas;
       es wird nur nicht weggeworfen, was ohnehin schon angezeigt wird. */
    if (!elements.imagePreview?.querySelector("img")) showPhotoDeletedNotice();
    await renderQueueResult(outcome.result, myId, traceId, { totalMs: Date.now() - startTime });
  } catch (err) {
    if (state.requestId !== myId) return;
    clearStoredJobId();
    stopScanAnim();
    elements.scanText.textContent = "";
    setStatus(""); /* stiller Fehler beim Seitenstart — kein Banner */
    logClientError(err, { phase: "queue-resume", requestId: String(myId), traceId });
  } finally {
    if (state.requestId === myId) state.isAnalyzing = false;
  }
}
