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

const PAGE_LOADED_AT = Date.now();
const MIN_INTERACTION_MS = 2000;
/* BUG-006: Relative URL nutzt Firebase Hosting Rewrite (/analyze → function:analyze).
   Keine hardcoded Domain — funktioniert auf allen Deployments. */
const ANALYZE_URL = "/analyze";
const FETCH_TIMEOUT_MS = 180000;

export async function analyzeImage() {
  if (state.isAnalyzing) return;
  state.isAnalyzing = true;

  /* BUG-001/002: Jeder Analyse-Lauf bekommt eine eindeutige ID.
     Stale catch/finally/Callbacks prüfen ob sie noch "aktuell" sind. */
  const myId = ++state.requestId;

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
  if (file.size > 6 * 1024 * 1024) {
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
    /* Bild komprimieren + EXIF extrahieren (client-seitig) */
    if (!state.lastPrepared) {
      state.lastPrepared = await prepareImage(file);
    }

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

    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: state.lastPrepared.imageBase64,
        exif: state.lastPrepared.exif,
        mimeType: "image/jpeg",
        filename: "upload.jpg",
        lang: getLanguage(),
      }),
      signal: controller.signal,
    });

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
            setStatus(t("error.rateLimit"));
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
      setStatus(msg);
      return;
    }

    const data = await response.json();

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
    });
  } catch (err) {
    /* BUG-002: Stale catch darf UI des neuen Laufs nicht überschreiben */
    if (state.requestId !== myId) return;
    stopScanAnim();
    if (err.name === "AbortError") {
      setStatus(t("error.timeout"));
    } else if (err.message === "read_failed") {
      setStatus(t("error.readFailed"));
    } else if (err.message === "image_decode_failed") {
      setStatus(t("error.decodeFailed"));
    } else if (!navigator.onLine) {
      setStatus(t("error.offline"));
    } else {
      setStatus(t("error.networkError"));
    }
  } finally {
    /* BUG-001: Timeout immer aufräumen */
    clearTimeout(timeoutId);
    /* BUG-002: Nur eigenen isAnalyzing-Flag zurücksetzen */
    if (state.requestId === myId) state.isAnalyzing = false;
  }
}
