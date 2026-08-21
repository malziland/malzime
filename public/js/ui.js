import { elements } from "./dom.js";
import { t } from "./i18n.js";

/**
 * Schreibt eine gemerkte Statusmeldung in der aktuellen Sprache neu.
 * Ruft der Sprachumschalter nach jedem Wechsel auf.
 */
export function statusNeuSchreiben() {
  const schluessel = elements.status.dataset.i18nKey;
  if (!schluessel) return;
  setStatus(t(schluessel), elements.status.dataset.traceId || undefined, schluessel);
}

/* ── Scan-Animation ── */

let scanInterval = null;

/**
 * Setzt die Statuszeile.
 *
 * @param {string} text     Fertiger Text.
 * @param {string} [traceId]
 * @param {string} [schluessel] i18n-Schlüssel des Textes. Wird er mitgegeben,
 *   merkt sich die Zeile ihn und kann bei einem Sprachwechsel neu geschrieben
 *   werden (statusNeuSchreiben). Ohne ihn bleibt die Meldung stehen, wie sie
 *   ist — genau das war der Fehler: Nach einem Wechsel auf Englisch stand die
 *   Fehlermeldung weiter auf Deutsch (gefunden 2026-08-13 beim Durchgang durch
 *   alle Zustände der echten Anwendung).
 */
export function setStatus(text, traceId, schluessel) {
  if (!text) {
    elements.status.textContent = "";
    elements.status.classList.remove("visible");
    elements.status.removeAttribute("role");
    delete elements.status.dataset.i18nKey;
    delete elements.status.dataset.traceId;
    return;
  }
  if (schluessel) {
    elements.status.dataset.i18nKey = schluessel;
    if (traceId) elements.status.dataset.traceId = traceId;
  } else {
    delete elements.status.dataset.i18nKey;
    delete elements.status.dataset.traceId;
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
  /* Auch hier nur bei echter Aenderung: `startScanAnim` wird pro Durchgang
     mehrfach gerufen (Upload, dann Warteschlange), und jedes Mal stand
     dieselbe Ansage erneut im Bereich — gemessen dreimal "Analyse gestartet"
     in einem einzigen Lauf. */
  if (!leise) textSetzen(elements.srAnnounce, t("scan.srStart"));
  /* Queue-Modus (rotateMessages=false): nur die Animation laufen lassen, den
     scan-Text setzt der Aufrufer selbst. Die rotierenden Analyse-Meldungen
     ("Gesicht erkannt…") wären irreführend, solange der Job nur wartet. */
  /* v3.4: Die rotierenden Meldungen sind Zierde — „Gesicht erkannt…",
     „Analysiere Pixel…". Sie wechseln alle paar Sekunden und wuerden deshalb
     alle paar Sekunden VORGELESEN. Wer zuhoert, bekommt damit eine Minute lang
     Geplapper ohne Neuigkeit. Waehrend der Rotation wird der Bereich deshalb
     stumm geschaltet; die echten Zustandswechsel („Analyse gestartet",
     „Analyse abgeschlossen") laufen ohnehin ueber `#srAnnounce`.

     Beim Warten in der Schlange bleibt er hoerbar: Dort steht die Position,
     und die IST eine Neuigkeit — dank textSetzen aber nur, wenn sie sich
     wirklich aendert. */
  if (elements.scanText) {
    elements.scanText.setAttribute("aria-live", rotateMessages ? "off" : "polite");
  }
  if (!rotateMessages) return;
  let idx = 0;
  const messages = t("scan.messages");
  const shuffled = [...(Array.isArray(messages) ? messages : [])].sort(() => Math.random() - 0.5);
  if (shuffled.length === 0) {
    /* BUG-104: Fallback wenn i18n-Laden fehlschlägt */
    const fallback = "\u2026";
    textSetzen(elements.scanText, fallback);
    return;
  }
  textSetzen(elements.scanText, shuffled[0]);
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

/* UX-2026-08-21-07: Der abgeschaltete Bereich war nur fuer Sehende und
   Maus-Nutzer abgeschaltet.

   Gemessen am 21.08. bei aktivem Limit: `pointer-events: none` griff, der
   Datenschutz-Link war nicht mehr anklickbar — aber `.drop-label`, der
   Datenschutz-Hinweis und der Rest waren fuer Screenreader unveraendert
   vorhanden und wurden vorgelesen, ohne dass irgendetwas den abgeschalteten
   Zustand vermittelt haette. Wer sieht, erkennt den toten Bereich sofort; wer
   hoert, liest eine Aufforderung zum Hochladen vor, die ins Leere fuehrt.

   `inert` schaltet den Bereich fuer ALLE gleichzeitig ab: Maus, Tastatur,
   Screenreader. Damit deckt sich der angesagte Zustand mit dem sichtbaren, und
   die sieben Kontrastmeldungen von axe entfallen als Nebenwirkung — abgeschaltete
   Bereiche sind von WCAG 1.4.3 ausgenommen, aber nur, wenn sie es wirklich sind.

   `inert` ist in diesem Projekt erprobt (Fokus-Kaefig der Sprachwahl-Rueckfrage). */
function bereicheSchalten(abgeschaltet) {
  for (const wahl of [".upload-section", ".demo-section"]) {
    const bereich = document.querySelector(wahl);
    if (!bereich) continue;
    bereich.classList.toggle("upload-section--limited", abgeschaltet);
    bereich.inert = abgeschaltet;
  }
}

export function showLimitBanner(retryAfterSeconds) {
  if (!elements.limitBanner) return;
  elements.limitBanner.classList.add("active");

  /* Reihenfolge ist wichtig: Steht der Fokus noch im Bereich, wenn er inert
     wird, faellt er ersatzlos auf <body> — der naechste Tastendruck beginnt
     dann wieder ganz oben. Deshalb zuerst pruefen, dann schalten, dann den
     Fokus auf den Hinweis lenken, der ohnehin `role="alert"` traegt. */
  const fokusWarDrin = document.activeElement
    ? Boolean(document.activeElement.closest(".upload-section, .demo-section"))
    : false;

  bereicheSchalten(true);

  if (fokusWarDrin) {
    elements.limitBanner.setAttribute("tabindex", "-1");
    elements.limitBanner.focus({ preventScroll: true });
  }

  startLimitCountdown(retryAfterSeconds);
}

export function hideLimitBanner() {
  if (!elements.limitBanner) return;
  elements.limitBanner.classList.remove("active");

  bereicheSchalten(false);

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
/**
 * Schreibt Text NUR, wenn er sich wirklich geaendert hat (v3.4).
 *
 * WARUM DAS NOETIG IST: `#scanText` ist ein `aria-live`-Bereich. Jede
 * Zuweisung an `textContent` tauscht den Textknoten aus — auch wenn derselbe
 * Satz herauskommt — und ein Screenreader liest ihn daraufhin erneut vor.
 * `showQueueWaiting` laeuft bei JEDER Statusabfrage, also alle 2 Sekunden.
 * Gemessen: 19 Ansagen in 30 Sekunden Wartezeit, bei einer vollen Analyse rund
 * 40 — fast immer derselbe Satz.
 *
 * Gefunden hat das ein Nutzer beim Zuhoeren mit VoiceOver, nicht ein Test: Die
 * automatische Pruefung sah, DASS angesagt wird, nicht WIE OFT. Ein
 * Wartezustand, der sich alle zwei Sekunden selbst wiederholt, macht die Seite
 * fuer blinde Nutzer unbenutzbar, waehrend jede Messung gruen bleibt.
 */
export function textSetzen(el, text) {
  if (!el) return;
  if (el.textContent === text) return;
  el.textContent = text;
}

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
  textSetzen(elements.scanText, etaText ? `${posText} · ${etaText}` : posText);
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
