/* ── Auftragsgedächtnis des Tabs ────────────────────────────────────
   Merkt sich im sessionStorage die Nummer des laufenden Auftrags und das
   Abhol-Ticket, damit ein Neuladen oder ein kurz weggelegter Tab das Ergebnis
   wieder abholen kann (resumeQueueJob in api.js). sessionStorage lebt nur in
   diesem einen Tab und endet mit ihm.

   Seit 10.09.2026 ein eigenes Modul (vorher Teil von api.js); das Verhalten
   ist unverändert. */
import { loescheRcTicket } from "./rc-ticket.js";

const JOB_ID_STORAGE_KEY = "malzime.queueJobId";
const JOB_TOKEN_STORAGE_KEY = "malzime.queueResultToken"; /* PRIV-003: Abhol-Ticket */
const JOB_DELIVERED_AT_KEY = "malzime.queueErgebnisZeit"; /* PRIV-107: erste Zustellung */

/* PRIV-107 (Kurzaudit 2026-08-11): Absolute Frist, wie lange ein FERTIGES
   Ergebnis per Reload wiederholbar bleibt — gerechnet ab der ERSTEN
   Zustellung, nicht ab dem letzten Reload (sonst schöbe jedes Neuladen die
   Frist vor sich her). Die 3-Minuten-Übergabepause in api.js greift nur über
   den Sichtbarkeits-Wechsel des Tabs; ein Gerät, das mit durchgehend
   sichtbarem Tab weitergereicht wird, fiel bisher durch — bis der Job
   serverseitig nach ~2 h verfällt. Diese Frist schließt das Fenster auch für
   diesen Fall. */
const ERGEBNIS_WIEDERHOLUNG_MS = 15 * 60 * 1000;
/* Historischer Schlüssel des entfernten Hinweis-Pop-ups (bis v3.0.1) — wird
   beim Aufräumen weiterhin mitgelöscht, damit alte Tab-Stände keinen toten
   Eintrag behalten. */
const JOB_DISCLAIMER_ACK_KEY = "malzime.queueDisclaimerAcked";

export function storeJobId(jobId, resultToken) {
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
export function markiereErgebnisZustellung() {
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
export function ergebnisFristAbgelaufen() {
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
export function getStoredResultToken() {
  try {
    return sessionStorage.getItem(JOB_TOKEN_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}
