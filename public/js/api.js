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
/* Direkt-Aufruf der Cloud-Run-URL statt Firebase-Hosting-Rewrite — der Hosting-Edge
   schneidet Antworten nach ~60s ab, was die Mistral-Pipeline bei Latenz-Spitzen reisst.
   Direkt-Aufruf nutzt den Cloud-Run-Timeout (180s, siehe functions/src/index.js).
   CORS regelt firebase-functions/v2 automatisch via `cors: ALLOWED_ORIGINS`. */
const ANALYZE_URL = "https://analyze-5ymhpdpqcq-ew.a.run.app";
const FETCH_TIMEOUT_MS = 180000;

/* ── Wake-Lock ──────────────────────────────────────────────────────
   Verhindert, dass das Gerät während der (bis ~3 min langen) Analyse in
   Standby geht. Geht es schlafen, friert der Browser die Seite ein und die
   laufende fetch-Anfrage stirbt — der User sieht beim Aufwachen einen Fehler,
   obwohl der Server fertig gerechnet hat. Best-Effort: nicht jedes Gerät
   unterstützt die API, und ein manueller Power-Knopf-Druck sperrt trotzdem. */
let wakeLock = null;

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) {
    /* Verweigert/nicht verfügbar — kein Abbruch, läuft ohne Wake-Lock weiter. */
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

/* Merkt sich, ob die Seite während einer laufenden Analyse in den Hintergrund
   ging (Gerät gesperrt / Tab gewechselt) — für eine treffende Fehlermeldung. */
let pageHiddenDuringRequest = false;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.isAnalyzing) pageHiddenDuringRequest = true;
  } else if (state.isAnalyzing && !wakeLock) {
    /* Seite wieder sichtbar und Analyse läuft noch — der Browser gibt den
       Wake-Lock beim Verstecken automatisch frei, also neu anfordern. */
    acquireWakeLock();
  }
});

export async function analyzeImage() {
  if (state.isAnalyzing) return;
  state.isAnalyzing = true;

  /* BUG-001/002: Jeder Analyse-Lauf bekommt eine eindeutige ID.
     Stale catch/finally/Callbacks prüfen ob sie noch "aktuell" sind. */
  const myId = ++state.requestId;
  const analyzeStartTime = Date.now();
  const traceId = generateTraceId();
  state.lastTraceId = traceId;
  pageHiddenDuringRequest = false;

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

    /* BUG-001: Lokale Controller-Variable — Timeout referenziert nicht state */
    const controller = new AbortController();
    state.currentAbortController = controller;
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const fetchStart = Date.now();
    const response = await fetch(ANALYZE_URL, {
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
    stopScanAnim();

    /* BUG-002: Prüfen ob dieser Lauf noch aktuell ist */
    if (state.requestId !== myId) return;

    if (!response.ok) {
      let msg = t("error.generic");
      if (response.status === 429) {
        /* Limit-Block vom Firestore-Zähler erkennen */
        try {
          const body = await response.clone().json();
          if (body.blocked === "limit") {
            showLimitBanner(body.retryAfterSeconds || 600);
            setStatus(t("error.rateLimit"), traceId);
            return;
          }
        } catch (_) {
          /* parse failed — normales Rate Limit */
        }
        msg = t("error.rateLimit");
      } else if (response.status === 413) {
        msg = t("error.imageTooLarge");
      } else if (response.status === 400) {
        msg = t("error.invalidFormat");
      } else if (response.status === 503) {
        try {
          const body = await response.clone().json();
          if (body.maintenance) {
            showMaintenanceModal(body.message);
            return;
          }
        } catch (_) {
          /* parse failed — generischer Serverfehler */
        }
        msg = t("error.serverError");
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
        timings: { ...timings, totalMs: Date.now() - analyzeStartTime },
      });
      return;
    }

    const parseStart = Date.now();
    const data = await response.json();
    timings.parseMs = Date.now() - parseStart;

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
        },
      });
    });
  } catch (err) {
    /* BUG-002: Stale catch darf UI des neuen Laufs nicht überschreiben */
    if (state.requestId !== myId) return;
    stopScanAnim();

    let phase = "fetch";
    if (err.message === "read_failed") {
      phase = "image-read";
      setStatus(t("error.readFailed"), traceId);
    } else if (err.message === "image_decode_failed") {
      phase = "image-decode";
      setStatus(t("error.decodeFailed"), traceId);
    } else if (pageHiddenDuringRequest) {
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
