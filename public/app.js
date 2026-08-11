import { initI18n, applyTranslations, t } from "./js/i18n.js";
import { elements } from "./js/dom.js";
import { state } from "./js/state.js";
import { analyzeImage, acquireWakeLock, resumeQueueJob, initHintergrundWiederaufnahme } from "./js/api.js";
import { renderCurrentMode } from "./js/render.js";
import {
  dismissDisclaimerModal,
  insertPrintNotes,
  removePrintNotes,
  showLimitBanner,
  showMaintenanceModal,
} from "./js/ui.js";
import { initDemo } from "./js/demo.js";
import { initStickyToggle, renderKeepingScrollAnchor } from "./js/sticky-toggle.js";
import { merkeModus, gemerkterModus } from "./js/modus-speicher.js";

/* ── i18n initialisieren (vor allem anderen) ── */
await initI18n();
applyTranslations();

/* ── Demo-Fotos initialisieren ── */
initDemo();

/* ── Queue-Modus: offenes Ergebnis nach einem Reload weiter abholen ──
   No-Op, wenn keine jobId aus einem früheren Seitenbesuch vorliegt. */
resumeQueueJob();

/* Holt das Ergebnis auch dann nach, wenn das Handy zwischendurch gesperrt war
   und die Abfrage-Schleife dabei steckengeblieben ist. */
initHintergrundWiederaufnahme();

/* ── Limit-, Maintenance- und Feature-Flag-Check beim Seitenstart ──
   In state.statsReady abgelegt, damit analyzeImage darauf warten kann, bevor
   es Sync vs. Queue entscheidet. Mit hartem Timeout: antwortet /api/stats
   nicht, löst das Promise trotzdem auf (Fail-safe → synchroner Pfad). */
const statsAbort = new AbortController();
const statsTimer = setTimeout(() => statsAbort.abort(), 20000);
state.statsReady = fetch("/api/stats", { signal: statsAbort.signal })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    /* Queue-Feature-Flag übernehmen. Bleibt es aus (Flag false oder Fetch
       fehlgeschlagen), läuft der bewährte synchrone Pfad. */
    if (data?.maintenance?.enabled) {
      showMaintenanceModal(data.maintenance.message);
      return;
    }
    if (data?.current?.limitActive) {
      showLimitBanner(data.current.retryAfterSeconds || 600);
    }
  })
  .catch(() => {})
  .finally(() => clearTimeout(statsTimer));

/* Maintenance-Modal: Seite neu laden */
elements.maintenanceReload.addEventListener("click", () => location.reload());

/* Leaflet Marker-Icons: Auto-Detection deaktivieren und Pfade für self-hosted Build setzen */
if (typeof L !== "undefined" && L.Icon && L.Icon.Default) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/lib/leaflet/images/marker-icon-2x.png",
    iconUrl: "/lib/leaflet/images/marker-icon.png",
    shadowUrl: "/lib/leaflet/images/marker-shadow.png",
  });
}

/* ── Foto-Vorschau + Auto-Start ── */

function handleNewFile(file) {
  /* v1.10.8: Wake-Lock SOFORT anfordern — synchron im User-Gesture-Kontext
     (handleNewFile wird direkt aus dem change/drop-Event aufgerufen). iOS
     Safari erlaubt navigator.wakeLock.request nur, solange die transiente
     User-Aktivierung noch lebt — also vor jedem `await`. Frueher lief die
     Anfrage erst tief in der asynchronen analyzeImage-Pipeline und wurde von
     iOS mit NotAllowedError abgelehnt. */
  acquireWakeLock();

  /* Laufende Analyse abbrechen */
  if (state.currentAbortController) {
    state.currentAbortController.abort();
    state.currentAbortController = null;
  }
  state.isAnalyzing = false;

  /* Offenes Disclaimer-Modal schließen (BUG-004) */
  dismissDisclaimerModal();

  /* Laufendes Geocoding abbrechen (BUG-005) */
  if (state.geocodeAbortController) {
    state.geocodeAbortController.abort();
    state.geocodeAbortController = null;
  }
  state.pendingGeocode = null;

  const prev = elements.imagePreview.querySelector("img");
  if (prev) URL.revokeObjectURL(prev.src);

  const url = URL.createObjectURL(file);
  const img = document.createElement("img");
  img.src = url;
  img.alt = t("preview.alt");
  elements.imagePreview.innerHTML = "";
  elements.imagePreview.appendChild(img);

  state.lastFile = file;
  state.lastPrepared = null;
  state.lastData = null;
  analyzeImage();
}

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files[0];
  if (!file) return;
  handleNewFile(file);
});

/* ── Drag & Drop (auch für macOS Fotos-App) ── */

const dropTarget = document.querySelector(".file-drop");

["dragenter", "dragover"].forEach((evt) => {
  dropTarget.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropTarget.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropTarget.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropTarget.classList.remove("drag-over");
  });
});

dropTarget.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) {
    handleNewFile(file);
  }
});

/* Globaler dragover-Schutz: verhindert Navigation bei Drop außerhalb der Zone */
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

/* ── Toggle-Wechsel: Sofort umschalten ohne neuen API-Call ── */

/* Modus-Theme-Kopplung (malziland Design System): Seriöse Analyse = heller
   Papier-Look, Beast Mode = dunkles Theme. Das Theme hängt am Modus — es
   gibt bewusst keinen separaten Hell/Dunkel-Schalter.

   Zur Speicherung: Beast startet weiterhin immer ausgeschaltet — aber ein
   Reload ist kein Start. Die Wahl liegt deshalb im sessionStorage: Sie
   überlebt Neuladen und Tab-Wechsel, endet aber mit dem Tab. Im Workshop
   startet damit jede neue Person und jedes weitergereichte Gerät wieder
   seriös und erlebt den Kontrast selbst (siehe js/modus-speicher.js). */
function applyModeTheme() {
  const boost = elements.biasSwitch.checked;
  document.documentElement.setAttribute("data-mode", boost ? "boost" : "normal");
  document.documentElement.setAttribute("data-theme", boost ? "dark" : "light");
  /* Browser-Farbleiste (mobile Adressleiste) folgt dem Modus */
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", boost ? "#171d1f" : "#f9f7f4");
}
/* Gemerkte Wahl wiederherstellen, BEVOR das Theme angewendet wird — sonst
   blitzt kurz der falsche Look auf. `null` heisst „nie gewählt": dann bleibt
   der Zustand, den der Browser selbst wiederhergestellt hat, unangetastet. */
const gemerkt = gemerkterModus();
if (gemerkt !== null) elements.biasSwitch.checked = gemerkt;

/* Beim Start anwenden — Browser können den Checkbox-Zustand nach einem
   Reload wiederherstellen, dann muss das Theme mitziehen. */
applyModeTheme();

/* Sticky-Umschalter aktivieren (Logik in js/sticky-toggle.js) */
initStickyToggle();

elements.biasSwitch.addEventListener("change", () => {
  merkeModus(elements.biasSwitch.checked);
  applyModeTheme();
  if (state.lastData) {
    renderKeepingScrollAnchor(() => renderCurrentMode(state.lastData));
  }
});

/* Text-Labels klickbar — schalten direkt um (aber nicht wenn Info-Icon geklickt) */
document.querySelectorAll(".bias-opt").forEach((opt) => {
  opt.classList.add("bias-opt--clickable");
  opt.addEventListener("click", (e) => {
    if (e.target.closest(".info-icon")) return;
    const wantBoost = opt.dataset.mode === "boost";
    if (elements.biasSwitch.checked !== wantBoost) {
      elements.biasSwitch.checked = wantBoost;
      elements.biasSwitch.dispatchEvent(new Event("change"));
    }
  });
});

/* Info-Icon Tooltip: Nur einer gleichzeitig, Position am Viewport ausrichten */
function toggleTooltip(icon, e) {
  e.stopPropagation();
  const wasOpen = icon.classList.contains("tooltip-open");
  /* Alle schließen */
  document.querySelectorAll(".info-icon.tooltip-open").forEach((el) => el.classList.remove("tooltip-open"));
  if (!wasOpen) {
    icon.classList.add("tooltip-open");
    /* Tooltip vertikal positionieren */
    const tip = icon.querySelector(".tooltip");
    if (tip) {
      tip.style.top = "0px";
      void tip.offsetHeight; /* Reflow erzwingen damit offsetHeight stimmt */
      const rect = icon.getBoundingClientRect();
      const tipH = tip.offsetHeight;
      let top = rect.top - tipH - 12;
      const below = top < 8;
      /* Falls Tooltip oben rausfällt → unter dem Icon anzeigen */
      if (below) top = rect.bottom + 12;
      tip.style.top = top + "px";
      tip.classList.toggle("below", below);
    }
  }
  /* Desktop: Hover auf dem anderen Icon unterdrücken solange einer offen ist */
  document.querySelectorAll(".info-icon").forEach((el) => {
    el.classList.toggle("tooltip-suppress", el !== icon && !wasOpen);
  });
}
document.querySelectorAll(".info-icon").forEach((icon) => {
  icon.addEventListener("click", (e) => toggleTooltip(icon, e));
  icon.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleTooltip(icon, e);
    }
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".info-icon.tooltip-open").forEach((el) => el.classList.remove("tooltip-open"));
  document.querySelectorAll(".info-icon.tooltip-suppress").forEach((el) => el.classList.remove("tooltip-suppress"));
});

/* ── PDF-Export ── */

elements.exportPdf.addEventListener("click", () => {
  insertPrintNotes();
  window.print();
  setTimeout(removePrintNotes, 1000);
});

window.addEventListener("afterprint", removePrintNotes);
