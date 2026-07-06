import { elements } from "./dom.js";
import { state } from "./state.js";
import { prepareImage } from "./exif.js";
import { startGeocoding } from "./geocoding.js";
import {
  setStatus,
  startScanAnim,
  stopScanAnim,
  showDisclaimerModal,
  showLimitBanner,
  showMaintenanceModal,
  showQueueWaiting,
  resetQueueWaiting,
} from "./ui.js";
import { renderCurrentMode } from "./render.js";
import { t, getLanguage } from "./i18n.js";
import { logClientError } from "./error-logger.js";
import { logTelemetry } from "./telemetry-logger.js";
import { generateTraceId } from "./client-context.js";

const PAGE_LOADED_AT = Date.now();
const MIN_INTERACTION_MS = 2000;
/* Direkt-Aufruf via Custom Domain `api.malzi.me` → Cloud Run Domain Mapping
   auf die analyze-Function. Umgeht den Firebase-Hosting-Rewrite-Edge-Timeout
   (~60s) und nutzt stattdessen den Cloud-Run-Function-Timeout (540s seit
   v1.10.6, siehe functions/src/index.js). CORS regelt firebase-functions/v2
   automatisch via `cors: ALLOWED_ORIGINS`. Custom Domain SSL: Lets Encrypt via Google. */
const ANALYZE_URL = "https://api.malzi.me";
/* v1.10.6: FETCH_TIMEOUT_MS auf 540s erhoeht — matched neues Cloud-Function-Timeout.
   So koennen Auto-Retry-Zyklen unter Last vollstaendig durchlaufen. */
const FETCH_TIMEOUT_MS = 540000;
/* v1.10.6: Auto-Retry bei Server-Ueberlast.
   - MAX_AUTO_RETRIES=3 ergibt insgesamt bis zu 4 Versuche pro analyzeImage-Aufruf.
   - RETRY_WAIT_BASE_MS=8000: 8s Basis-Wartezeit, plus +/- 2s Jitter pro Versuch.
     Jitter entzerrt synchrone Retry-Wellen, damit nicht alle Clients zugleich
     wieder zuschlagen — gibt dem Server-Throttle Zeit, Slots durchzubringen.
   - Triggert auf HTTP 503/429 (ohne maintenance/limit-Body) und auf
     blockedReason="blocked.overloaded" im 200er-Body (Heartbeat-Pfad). */
const MAX_AUTO_RETRIES = 3;
const RETRY_WAIT_BASE_MS = 8000;
const RETRY_WAIT_JITTER_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryWaitMs() {
  /* Random in [base-jitter, base+jitter]. Z.B. 6000..10000ms bei base=8000, jitter=2000. */
  return RETRY_WAIT_BASE_MS + (Math.random() * 2 - 1) * RETRY_WAIT_JITTER_MS;
}

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

export async function analyzeImage() {
  if (state.isAnalyzing) return;
  /* Sofort sichtbares Feedback — die Scan-Animation läuft schon, während wir
     ggf. noch kurz auf das Feature-Flag warten. */
  startScanAnim(false);
  /* Feature-Flag muss feststehen, bevor Sync vs. Queue entschieden wird.
     Der /api/stats-Aufruf beim Seitenstart setzt es; ist er noch nicht durch
     (sehr schneller Upload), hier darauf warten. state.statsReady löst dank
     Timeout immer zeitnah auf. */
  if (state.statsReady) await state.statsReady;
  if (state.isAnalyzing) return;
  /* Queue-Modus: ist das Feature-Flag an, läuft die Analyse über die
     Warteschlange statt über die lange synchrone Verbindung. Der gesamte
     synchrone Pfad unten bleibt davon unberührt. */
  if (state.useQueue) return analyzeImageQueued();
  state.isAnalyzing = true;

  /* BUG-001/002: Jeder Analyse-Lauf bekommt eine eindeutige ID.
     Stale catch/finally/Callbacks prüfen ob sie noch "aktuell" sind. */
  const myId = ++state.requestId;
  const analyzeStartTime = Date.now();
  const traceId = generateTraceId();
  state.lastTraceId = traceId;

  /* Strukturierte Timings — werden bei Success-Telemetrie + Error-Logging mitgesendet. */
  const timings = {};

  setStatus("");
  elements.facts.innerHTML = "";
  elements.privacy.innerHTML = "";
  elements.gpsMap.innerHTML = "";
  elements.targeting.innerHTML = "";
  elements.dataValue.innerHTML = "";
  elements.simulation.innerHTML = "";
  elements.exportPdf.classList.add("export-btn--hidden");

  startScanAnim();

  const file = state.lastFile || elements.fileInput.files[0];
  if (!file) {
    stopScanAnim();
    setStatus(t("error.noFile"));
    state.isAnalyzing = false;
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    stopScanAnim();
    setStatus(t("error.fileTooLarge"));
    state.isAnalyzing = false;
    return;
  }

  /* Honeypot — Bots füllen unsichtbare Felder aus */
  const hp = document.getElementById("website");
  if (hp && hp.value) {
    stopScanAnim();
    state.isAnalyzing = false;
    return;
  }

  /* Mindest-Interaktionszeit — kein Mensch lädt in < 2s hoch */
  if (Date.now() - PAGE_LOADED_AT < MIN_INTERACTION_MS) {
    const remaining = MIN_INTERACTION_MS - (Date.now() - PAGE_LOADED_AT);
    await new Promise((r) => setTimeout(r, remaining));
  }

  /* BUG-001: timeoutId VOR try deklarieren → im catch/finally erreichbar */
  let timeoutId;
  try {
    /* Wake-Lock anfordern — Bildschirm bleibt während der Analyse an. */
    await acquireWakeLock();

    /* Bild komprimieren + EXIF extrahieren (client-seitig) */
    const prepareStart = Date.now();
    if (!state.lastPrepared) {
      state.lastPrepared = await prepareImage(file);
    }
    timings.prepareImageMs = Date.now() - prepareStart;

    /* BUG-012: Nach prepareImage prüfen ob inzwischen ein neuer Lauf gestartet wurde
       (handleNewFile setzt isAnalyzing=false + neuen requestId) */
    if (state.requestId !== myId) return;

    /* Geocoding sofort starten wenn GPS vorhanden — läuft parallel zur Analyse */
    if (state.lastPrepared.gps) {
      startGeocoding(state.lastPrepared.gps.latitude, state.lastPrepared.gps.longitude);
    }

    /* v1.10.6 — Auto-Retry-Loop bei Server-Ueberlast.
       Wiederholt das fetch (max 2x) wenn:
       - HTTP 429/503 OHNE maintenance/limit-Body (echte Ueberlast, kein Hard-Block)
       - HTTP 200 mit blockedReason="blocked.overloaded" (Heartbeat-Pfad: Backend
         hat 200 committed, danach in der Pipeline Ueberlast erkannt)
       Maintenance, Hard-Limit, andere 4xx/5xx werden NICHT retried — die sind
       entweder dauerhaft (400/413/Maintenance) oder explizit user-facing
       (Stundenlimit erreicht). */
    let response;
    let data = null;
    let httpFailureHandled = false;

    for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
      if (attempt > 0) {
        setStatus(t("status.serverBusyRetrying"), traceId);
        await sleep(retryWaitMs());
        if (state.requestId !== myId) return;
      }

      const controller = new AbortController();
      state.currentAbortController = controller;
      timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const fetchStart = Date.now();
      response = await fetch(ANALYZE_URL, {
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
        signal: controller.signal,
      });
      timings.fetchMs = Date.now() - fetchStart;

      clearTimeout(timeoutId);
      state.currentAbortController = null;
      /* Spinner laeuft weiter — bei chunked transfer (Heartbeat) returnt fetch
         sofort nach den Headers, der Body kommt erst spaeter ueber response.json().
         Wuerden wir hier stoppen, sieht der User mid-Pipeline einen leeren Bildschirm. */

      if (state.requestId !== myId) return;

      /* Retryable Server-Ueberlast erkennen */
      if (response.status === 429 || response.status === 503) {
        let parsedBody = null;
        try {
          parsedBody = await response.clone().json();
        } catch (_) {
          /* parse failed — fall through */
        }
        const isHardLimit = parsedBody && parsedBody.blocked === "limit";
        const isMaintenance = parsedBody && parsedBody.maintenance;
        if (!isHardLimit && !isMaintenance && attempt < MAX_AUTO_RETRIES) {
          continue; /* Auto-Retry */
        }
      }

      /* Nicht-OK-Statuscodes: bestehende Fehlerbehandlung */
      if (!response.ok) {
        stopScanAnim();
        let msg = t("error.generic");
        if (response.status === 429) {
          try {
            const body = await response.clone().json();
            if (body.blocked === "limit") {
              showLimitBanner(body.retryAfterSeconds || 600);
              setStatus(t("error.rateLimit"), traceId);
              httpFailureHandled = true;
              break;
            }
          } catch (_) {
            /* parse failed — normales Rate Limit */
          }
          msg = t("error.serverBusy");
        } else if (response.status === 413) {
          msg = t("error.imageTooLarge");
        } else if (response.status === 400) {
          msg = t("error.invalidFormat");
        } else if (response.status === 503) {
          try {
            const body = await response.clone().json();
            if (body.maintenance) {
              showMaintenanceModal(body.message);
              httpFailureHandled = true;
              break;
            }
          } catch (_) {
            /* parse failed — generischer Serverfehler */
          }
          msg = t("error.serverBusy");
        } else if (response.status >= 500) {
          msg = t("error.serverError");
        }
        try {
          const body = await response.text();
          const p = JSON.parse(body);
          if (p.code === "file_too_large") msg = t("error.imageTooLarge");
          if (p.code === "missing_image") msg = t("error.missingImage");
        } catch (_) {
          /* response parse failed — use default msg */
        }
        setStatus(msg, traceId);
        logClientError(new Error(`HTTP ${response.status}`), {
          phase: "http-error",
          durationMs: Date.now() - analyzeStartTime,
          requestId: String(myId),
          traceId,
          httpStatus: response.status,
          wakeLock: wakeLockStatus,
          timings: { ...timings, totalMs: Date.now() - analyzeStartTime },
        });
        httpFailureHandled = true;
        break;
      }

      /* response.ok — JSON parsen */
      const parseStart = Date.now();
      data = await response.json();
      timings.parseMs = Date.now() - parseStart;

      /* Heartbeat-Pfad: Status war 200, aber Body meldet Ueberlast → retryen */
      if (data && data.blockedReason === "blocked.overloaded" && attempt < MAX_AUTO_RETRIES) {
        data = null;
        continue;
      }

      break; /* Erfolgreicher fetch — raus aus dem Retry-Loop */
    }

    if (httpFailureHandled) return;

    /* Falls Auto-Retries erschoepft und immer noch Ueberlast: klare Meldung. */
    if (!data || data.blockedReason === "blocked.overloaded") {
      stopScanAnim();
      setStatus(t("error.serverBusy"), traceId);
      logClientError(new Error("server_busy_after_retries"), {
        phase: "server-busy",
        durationMs: Date.now() - analyzeStartTime,
        requestId: String(myId),
        traceId,
        wakeLock: wakeLockStatus,
        timings: { ...timings, totalMs: Date.now() - analyzeStartTime },
      });
      return;
    }
    stopScanAnim();

    /* Client-seitige Daten injizieren — GPS und dateTimeOriginal verlassen nie den Browser */
    if (!data.exif) data.exif = {};
    if (state.lastPrepared.gps) {
      data.exif.gpsLatitude = state.lastPrepared.gps.latitude;
      data.exif.gpsLongitude = state.lastPrepared.gps.longitude;
    }
    if (state.lastPrepared.dateTimeOriginal) {
      data.exif.dateTimeOriginal = state.lastPrepared.dateTimeOriginal;
    }

    /* BUG-002: Guard in Modal-Callback — stale Daten nicht übernehmen */
    const renderStart = Date.now();
    showDisclaimerModal(() => {
      if (state.requestId !== myId) return;
      state.lastData = data;
      renderCurrentMode(data);
      setStatus("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      /* A11y: Focus auf Ergebnisse setzen nachdem Modal geschlossen */
      setTimeout(() => {
        if (elements.resultsPanel) elements.resultsPanel.focus({ preventScroll: true });
      }, 300);
      timings.renderMs = Date.now() - renderStart;
      timings.totalMs = Date.now() - analyzeStartTime;

      const meta = data && data.meta ? data.meta : {};
      logTelemetry("analyze-success", {
        traceId,
        durationMs: timings.totalMs,
        timings,
        meta: {
          subject: typeof meta.subject === "string" ? meta.subject : undefined,
          mode: typeof meta.mode === "string" ? meta.mode : undefined,
          lang: getLanguage(),
          wakeLock: wakeLockStatus,
        },
      });
    });
  } catch (err) {
    /* BUG-002: Stale catch darf UI des neuen Laufs nicht überschreiben */
    if (state.requestId !== myId) return;
    stopScanAnim();

    let phase;
    if (err.message === "read_failed") {
      phase = "image-read";
      setStatus(t("error.readFailed"), traceId);
    } else if (err.message === "image_decode_failed") {
      phase = "image-decode";
      setStatus(t("error.decodeFailed"), traceId);
    } else if (document.hidden) {
      /* Page ist JETZT noch hidden — Browser hat fetch eingefroren, weil Tab/Gerät
         im Hintergrund. Sticky-Flag früher war fehleranfällig: Safari feuert
         visibilitychange auch bei kurzem Display-Dimm, ohne dass der User wechselt. */
      phase = "page-hidden";
      setStatus(t("error.suspended"), traceId);
    } else if (err.name === "AbortError") {
      phase = "client-timeout";
      setStatus(t("error.timeout"), traceId);
    } else if (!navigator.onLine) {
      phase = "offline";
      setStatus(t("error.offline"), traceId);
    } else {
      phase = "network";
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
      timings: { ...timings, totalMs: Date.now() - analyzeStartTime },
    });
  } finally {
    /* BUG-001: Timeout immer aufräumen */
    clearTimeout(timeoutId);
    /* Wake-Lock immer freigeben — Analyse ist durch (Erfolg, Fehler, Stale). */
    releaseWakeLock();
    /* BUG-002: Nur eigenen isAnalyzing-Flag zurücksetzen */
    if (state.requestId === myId) state.isAnalyzing = false;
  }
}

/* ── Queue-Modus (v2.0) ─────────────────────────────────────────────
   Aktiv, wenn das Feature-Flag `useQueue` an ist. Statt einer langen offenen
   Verbindung: Bild an /api/enqueue, danach /api/job-status alle 2 s pollen.
   Jeder Poll ist zugleich der Liveness-Herzschlag (siehe Backend).

   Parallel-Pfad: Der synchrone analyzeImage-Pfad oben bleibt unangetastet.
   Prep und Ergebnis-Rendering ähneln ihm bewusst — beide Pfade bleiben
   getrennt, bis Phase 6 den synchronen Pfad sauber entfernt. */

const ENQUEUE_URL = "/api/enqueue";
const JOB_STATUS_URL = "/api/job-status";
const POLL_INTERVAL_MS = 2000;
const JOB_ID_STORAGE_KEY = "malzime.queueJobId";
const JOB_TOKEN_STORAGE_KEY = "malzime.queueResultToken"; /* PRIV-003: Abhol-Ticket */
/* Merkt, für welchen Job der „Nichts davon ist wahr"-Hinweis schon bestätigt
   wurde — überlebt den Reload, damit der Dialog nicht erneut aufpoppt. */
const JOB_DISCLAIMER_ACK_KEY = "malzime.queueDisclaimerAcked";
/* Aufeinanderfolgende job-status-Fehler, die der Poll-Loop toleriert, bevor
   er aufgibt — ein Netz-Wackler darf den wartenden User nicht rauswerfen,
   das Ergebnis liegt serverseitig sicher. */
const MAX_POLL_FAILURES = 5;
/* Gesamt-Obergrenze fürs Pollen. Selbst eine tiefe Warteschlange ist deutlich
   darunter; greift nur, falls ein Job dauerhaft hängt (z.B. Cloud-Tasks-
   Ausfall) — dann nicht endlos pollen, sondern sauber abbrechen. */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000;

function storeJobId(jobId, resultToken) {
  try {
    sessionStorage.setItem(JOB_ID_STORAGE_KEY, jobId);
    /* PRIV-003: Abhol-Ticket zusammen mit der jobId merken (überlebt Reload/Tab). */
    if (resultToken) sessionStorage.setItem(JOB_TOKEN_STORAGE_KEY, resultToken);
  } catch (_) {
    /* sessionStorage kann im privaten Modus werfen — kein harter Fehler. */
  }
}

function clearStoredJobId() {
  try {
    sessionStorage.removeItem(JOB_ID_STORAGE_KEY);
    sessionStorage.removeItem(JOB_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(JOB_DISCLAIMER_ACK_KEY);
  } catch (_) {
    /* dito */
  }
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

/** Merkt, dass der Hinweis-Dialog für diesen Job bestätigt wurde. */
function setStoredDisclaimerAck(jobId) {
  try {
    sessionStorage.setItem(JOB_DISCLAIMER_ACK_KEY, jobId);
  } catch (_) {
    /* dito */
  }
}

/** Gibt zurück, für welchen Job der Hinweis-Dialog schon bestätigt wurde. */
function getStoredDisclaimerAck() {
  try {
    return sessionStorage.getItem(JOB_DISCLAIMER_ACK_KEY);
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
 * @returns {Promise<object|null>} {result} | {error,reason} | {abandoned}
 *          — oder null, wenn ein neuer Upload den Lauf abgelöst hat.
 */
async function pollJob(jobId, myId, resultToken, pollImmediately = false) {
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
      const resp = await fetch(`${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}${tokenParam}`);
      if (!resp.ok) {
        /* 404 = Job existiert nicht (mehr) — kein transienter Fehler. */
        if (resp.status === 404) return { error: t("error.queueFailed") };
        throw new Error(`HTTP ${resp.status}`);
      }
      data = await resp.json();
      failures = 0;
    } catch (_) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) return { error: t("error.networkError") };
      continue;
    }

    if (state.requestId !== myId) return null;

    switch (data.status) {
      case "queued":
        showQueueWaiting("queued", data.position, data.etaSeconds);
        break;
      case "processing":
        showQueueWaiting("processing");
        break;
      case "done":
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

/**
 * Rendert das fertige Queue-Ergebnis — gleiche Darstellung wie der Sync-Pfad
 * (Disclaimer-Modal → renderCurrentMode → Success-Telemetrie).
 */
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
 * Rendert das fertige Queue-Ergebnis — gleiche Darstellung wie der Sync-Pfad
 * (Disclaimer-Modal → renderCurrentMode → Success-Telemetrie). Bei einem
 * Reload-Resume eines bereits bestätigten Ergebnisses wird der Disclaimer
 * übersprungen (skipDisclaimer); die jobId dient dazu, die Bestätigung zu merken.
 */
function renderQueueResult(data, myId, traceId, timings, jobId, skipDisclaimer) {
  if (!data) {
    setStatus(t("error.queueFailed"), traceId);
    return;
  }
  /* Client-seitige Daten injizieren — GPS/dateTimeOriginal verlassen nie den
     Browser. Nach einem Reload fehlt state.lastPrepared; dann bleibt GPS leer. */
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
    setStatus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      if (elements.resultsPanel) elements.resultsPanel.focus({ preventScroll: true });
    }, 300);
    /* Hinweis-Dialog für genau diesen Job als bestätigt merken → ein Reload
       zeigt ihn nicht erneut (der User hat ihn ja schon weggeklickt). */
    if (jobId) setStoredDisclaimerAck(jobId);
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

  /* Bereits bestätigt (Reload eines schon gesehenen Ergebnisses) → direkt
     rendern, kein erneuter Hinweis-Dialog. Sonst wie gehabt mit Dialog. */
  if (skipDisclaimer) {
    finishRender();
  } else {
    showDisclaimerModal(finishRender);
  }
}

async function analyzeImageQueued() {
  state.isAnalyzing = true;
  const myId = ++state.requestId;
  const analyzeStartTime = Date.now();
  const traceId = generateTraceId();
  state.lastTraceId = traceId;
  const timings = {};

  setStatus("");
  elements.facts.innerHTML = "";
  elements.privacy.innerHTML = "";
  elements.gpsMap.innerHTML = "";
  elements.targeting.innerHTML = "";
  elements.dataValue.innerHTML = "";
  elements.simulation.innerHTML = "";
  elements.exportPdf.classList.add("export-btn--hidden");

  /* Warte-Animation starten — Phase wird in showQueueWaiting weitergeschaltet:
     queued zeigt die Position, processing die gewohnten Analyse-Meldungen. */
  resetQueueWaiting();
  startScanAnim(false);
  elements.scanText.textContent = "";

  const file = state.lastFile || elements.fileInput.files[0];
  if (!file) {
    stopScanAnim();
    setStatus(t("error.noFile"));
    state.isAnalyzing = false;
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    stopScanAnim();
    setStatus(t("error.fileTooLarge"));
    state.isAnalyzing = false;
    return;
  }
  /* Honeypot — Bots füllen unsichtbare Felder aus */
  const hp = document.getElementById("website");
  if (hp && hp.value) {
    stopScanAnim();
    state.isAnalyzing = false;
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
    const enqueueResp = await fetch(ENQUEUE_URL, {
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
    });
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

    const enqueueData = await enqueueResp.json();
    const jobId = enqueueData && enqueueData.jobId;
    if (!jobId) {
      stopScanAnim();
      setStatus(t("error.queueFailed"), traceId);
      return;
    }
    /* PRIV-003: Abhol-Ticket vom Server merken + bei jedem Poll mitschicken. */
    const resultToken = enqueueData.resultToken || null;
    storeJobId(jobId, resultToken);

    /* ── Auf das Ergebnis pollen (jeder Poll = Liveness-Herzschlag) ── */
    const outcome = await pollJob(jobId, myId, resultToken);
    if (state.requestId !== myId) return;

    stopScanAnim();
    elements.scanText.textContent = "";

    if (!outcome) return;

    if (outcome.abandoned) {
      clearStoredJobId();
      setStatus(t("error.queueAbandoned"), traceId);
      return;
    }
    if (outcome.error) {
      clearStoredJobId();
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
    /* Erste Anzeige nach dem Upload → Hinweis-Dialog wie gewohnt zeigen. */
    renderQueueResult(outcome.result, myId, traceId, timings, jobId, false);
  } catch (err) {
    if (state.requestId !== myId) return;
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
    if (state.requestId === myId) state.isAnalyzing = false;
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
export async function resumeQueueJob() {
  const jobId = getStoredJobId();
  if (!jobId || state.isAnalyzing) return;
  /* PRIV-003: das gespeicherte Abhol-Ticket mitnehmen (überlebt den Reload). */
  const resultToken = getStoredResultToken();

  state.isAnalyzing = true;
  const myId = ++state.requestId;
  const traceId = generateTraceId();
  const startTime = Date.now();

  /* state.lastPrepared ist nach einem Reload leer — GPS kann nicht mehr
     injiziert werden (verlässt den Browser ohnehin nie). Das Profil selbst
     liegt vollständig serverseitig. */
  resetQueueWaiting();
  startScanAnim(false);
  elements.scanText.textContent = "";

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
    /* Foto ist nach dem Reload weg (Datenschutz, s. showPhotoDeletedNotice) →
       an seine Stelle den positiven Datenschutz-Hinweis setzen. */
    showPhotoDeletedNotice();
    /* Hinweis-Dialog nur zeigen, wenn er für genau diesen Job noch NICHT
       bestätigt wurde — sonst (User hat ihn beim ersten Ergebnis schon
       weggeklickt) direkt rendern. */
    const disclaimerAlreadyAcked = getStoredDisclaimerAck() === jobId;
    renderQueueResult(
      outcome.result,
      myId,
      traceId,
      { totalMs: Date.now() - startTime },
      jobId,
      disclaimerAlreadyAcked
    );
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
