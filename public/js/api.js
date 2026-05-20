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
