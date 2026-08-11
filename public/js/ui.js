import { elements } from "./dom.js";
import { t } from "./i18n.js";

/* ── Scan-Animation ── */

let scanInterval = null;

export function setStatus(text, traceId) {
  if (!text) {
    elements.status.textContent = "";
    elements.status.classList.remove("visible");
    elements.status.removeAttribute("role");
    return;
  }
  if (traceId) {
    /* Bei Fehlern wird die Trace-ID dezent als zweite Zeile angehaengt,
       damit User sie an Support weitergeben koennen. Per createElement
       statt innerHTML, um XSS-Risiken durch traceId/text zu vermeiden. */
    elements.status.textContent = "";
    const main = document.createElement("span");
    main.textContent = text;
    const small = document.createElement("small");
    small.className = "status__trace";
    small.textContent = `Code: ${traceId}`;
    elements.status.appendChild(main);
    elements.status.appendChild(small);
  } else {
    elements.status.textContent = text;
  }
  elements.status.classList.add("visible");
  /* A11y: Fehlermeldungen als role="alert" fuer robuste Screenreader-Ankuendigung */
  elements.status.setAttribute("role", "alert");
}

export function getBiasMode() {
  return elements.biasSwitch.checked ? "boost" : "normal";
}

/* `leise` nutzt die Live-Anzeige (v3.0.2): Sie holt das Auge als Warte-
   Spinner zurück, wenn der getippte Text ausgeht — dieses Wieder-Erscheinen
   ist KEIN neuer Analyse-Start, eine „Analyse gestartet"-Ansage wäre dort
   schlicht falsch. */
export function startScanAnim(rotateMessages = true, leise = false) {
  /* BUG-009: alten Intervall aufräumen bevor neuer startet. Leise (true):
     ein Neustart der Animation ist nie ein Abschluss — „Analyse
     abgeschlossen" darf hier nicht angesagt werden. */
  stopScanAnim(true);
  elements.scanAnim.classList.add("active");
  /* A11y: Screenreader-Ankuendigung */
  if (!leise && elements.srAnnounce) elements.srAnnounce.textContent = t("scan.srStart");
  /* Queue-Modus (rotateMessages=false): nur die Animation laufen lassen, den
     scan-Text setzt der Aufrufer selbst. Die rotierenden Analyse-Meldungen
     ("Gesicht erkannt…") wären irreführend, solange der Job nur wartet. */
  if (!rotateMessages) return;
  let idx = 0;
  const messages = t("scan.messages");
  const shuffled = [...(Array.isArray(messages) ? messages : [])].sort(() => Math.random() - 0.5);
  if (shuffled.length === 0) {
    /* BUG-104: Fallback wenn i18n-Laden fehlschlägt */
    const fallback = "\u2026";
    elements.scanText.textContent = fallback;
    return;
  }
  elements.scanText.textContent = shuffled[0];
  scanInterval = setInterval(() => {
    idx = (idx + 1) % shuffled.length;
    elements.scanText.textContent = shuffled[idx];
  }, 1800);
}

export function stopScanAnim(leise = false) {
  elements.scanAnim.classList.remove("active");
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  /* A11y: Screenreader-Ankuendigung. `leise` nutzt die Live-Anzeige (v3.0):
     Sie versteckt die Scan-Animation schon beim ERSTEN getippten Zeichen —
     dort waere „Analyse abgeschlossen" schlicht falsch. Die echte Abschluss-
     Ansage kommt weiterhin vom normalen Aufruf am Ende des Durchgangs. */
  if (!leise && elements.srAnnounce) elements.srAnnounce.textContent = t("scan.srEnd");
}

/* ── Limit-Banner ── */

let countdownInterval = null;

export function showLimitBanner(retryAfterSeconds) {
  if (!elements.limitBanner) return;
  elements.limitBanner.classList.add("active");

  const uploadSection = document.querySelector(".upload-section");
  const demoSection = document.querySelector(".demo-section");
  if (uploadSection) uploadSection.classList.add("upload-section--limited");
  if (demoSection) demoSection.classList.add("upload-section--limited");

  startLimitCountdown(retryAfterSeconds);
}

export function hideLimitBanner() {
  if (!elements.limitBanner) return;
  elements.limitBanner.classList.remove("active");

  const uploadSection = document.querySelector(".upload-section");
  const demoSection = document.querySelector(".demo-section");
  if (uploadSection) uploadSection.classList.remove("upload-section--limited");
  if (demoSection) demoSection.classList.remove("upload-section--limited");

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function startLimitCountdown(totalSeconds) {
  if (countdownInterval) clearInterval(countdownInterval);
  let remaining = totalSeconds;
  let ticksSinceCheck = 0;
  updateCountdownText(remaining);

  countdownInterval = setInterval(() => {
    remaining--;
    ticksSinceCheck++;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      if (elements.limitCountdown) {
        elements.limitCountdown.textContent = t("limit.countdownDone");
      }
      setTimeout(() => location.reload(), 2000);
      return;
    }
    updateCountdownText(remaining);

    /* Alle 30s prüfen ob Limit per Boost/Reset aufgehoben wurde */
    if (ticksSinceCheck >= 30) {
      ticksSinceCheck = 0;
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && !data.current.limitActive) {
            location.reload();
          }
        })
        .catch(() => {});
    }
  }, 1000);
}

function updateCountdownText(seconds) {
  if (!elements.limitCountdown) return;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const time = m > 0 ? m + ":" + String(s).padStart(2, "0") + " Min" : s + " " + t("limit.seconds");
  elements.limitCountdown.textContent = t("limit.countdown", { time });
}

/* ── Maintenance-Modal ── */

export function showMaintenanceModal(message) {
  const msg = message || t("maintenance.text");
  elements.maintenanceMessage.textContent = msg;
  elements.maintenanceModal.classList.add("active");
  elements.maintenanceReload.focus();

  /* Focus-Trap: Tab bleibt im Modal, Escape nicht möglich */
  document.addEventListener("keydown", maintenanceKeyHandler);
}

function maintenanceKeyHandler(e) {
  if (e.key === "Tab") {
    e.preventDefault();
    elements.maintenanceReload.focus();
  }
}

/* ── Warteschlangen-Anzeige (Queue-Modus, v2.0) ──
   Bewusst KEIN eigenes Design: nutzt dieselbe Scan-Animation wie der
   synchrone Pfad. In der Warteschlange steht die Position im scan-Text,
   bei der Verarbeitung laufen die gewohnten rotierenden Meldungen. */

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return t("queue.etaUnderMin");
  return t("queue.etaMinutes", { min: Math.round(seconds / 60) });
}

/* Aktuelle Warte-Phase — damit die Animation nur beim Phasenwechsel
   umgeschaltet wird, nicht bei jedem Poll. */
let queuePhase = null;

/**
 * Aktualisiert den Warte-Bildschirm im Queue-Modus.
 * @param {"queued"|"processing"} status
 * @param {number} [position]    Jobs vor diesem (0 = als Nächstes dran)
 * @param {number} [etaSeconds]  geschätzte Restwartezeit
 */
export function showQueueWaiting(status, position, etaSeconds) {
  if (status === "processing") {
    /* Verarbeitung läuft → die gewohnten rotierenden Analyse-Meldungen,
       wie gewohnt. */
    if (queuePhase !== "processing") {
      startScanAnim(true);
      queuePhase = "processing";
    }
    return;
  }
  /* queued → Animation ohne Rotation, Position als stabiler scan-Text. */
  if (queuePhase !== "queued") {
    startScanAnim(false);
    queuePhase = "queued";
  }
  const posText = position > 0 ? t("queue.position", { n: position }) : t("queue.next");
  const etaText = formatEta(etaSeconds);
  elements.scanText.textContent = etaText ? `${posText} · ${etaText}` : posText;
}

/** Setzt die Phasen-Verfolgung zurück — vor jedem neuen Queue-Lauf aufrufen. */
export function resetQueueWaiting() {
  queuePhase = null;
}

/* ── PDF-Export Hilfsfunktionen ── */

export function insertPrintNotes() {
  removePrintNotes();

  /* Alle sichtbaren Karten sammeln */
  const blocks = [...document.querySelectorAll(".cat-card, .meta-card, .target-card")].filter(
    (el) => el.offsetHeight > 0
  );

  if (blocks.length === 0) return;

  /* Höhen messen, dann Hinweise einfügen wo Seitenumbrüche wahrscheinlich sind */
  const PAGE_HEIGHT = 880;
  const NOTE_HEIGHT = 40;
  let accumulated = 200; /* Disclaimer + etwas Vorschau auf Seite 1 */

  for (const block of blocks) {
    const h = block.offsetHeight + 16;
    accumulated += h;

    if (accumulated > PAGE_HEIGHT) {
      const note = document.createElement("div");
      note.className = "print-note";
      note.textContent = t("print.note");
      block.parentNode.insertBefore(note, block);
      accumulated = NOTE_HEIGHT + h;
    }
  }
}

export function removePrintNotes() {
  document.querySelectorAll(".print-note").forEach((el) => el.remove());
}
