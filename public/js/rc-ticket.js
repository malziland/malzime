/**
 * rc-ticket.js — Einmal-Ticket des Realitäts-Checks (KA-02, Kurzaudit
 * 2026-08-12).
 *
 * Der Server gibt bei der ERSTEN Auslieferung eines fertigen Ergebnisses
 * genau ein Ticket aus (job-status-Antwort, Feld `rcTicket`); der Zähler der
 * anonymen Selbsteinschätzung nimmt eine Stimme nur noch gegen dieses Ticket
 * an und entwertet es dabei — eine echte Analyse, höchstens eine Stimme.
 *
 * Eigenes Modul statt api.js: telemetry-logger.js braucht das Ticket beim
 * Absenden, api.js beim Empfangen/Aufräumen — ein Import von api.js aus dem
 * Logger (oder umgekehrt) ergäbe einen Kreis. sessionStorage wie bei
 * jobId/resultToken: überlebt Reload im selben Tab, nie tab-übergreifend,
 * und der private Modus darf werfen, ohne dass etwas kaputtgeht.
 *
 * Privacy: Das Ticket ist ein reiner Zufallswert ohne jede Bedeutung. Es
 * beweist dem Server nur „gehört zu irgendeiner echten Analyse" — im
 * Log-Ereignis und im Aggregat landet es nie, und in der Datenbank liegt
 * ohnehin nur sein Hash (bis zur Entwertung).
 */

const RC_TICKET_KEY = "malzime.queueRcTicket";

/** Merkt das vom Server ausgegebene Ticket (api.js, bei `done`). */
export function speichereRcTicket(ticket) {
  try {
    if (typeof ticket === "string" && ticket.length > 0) {
      sessionStorage.setItem(RC_TICKET_KEY, ticket);
    }
  } catch (_) {
    /* ohne Speicher keine Stimme — der Check funktioniert am Bildschirm trotzdem */
  }
}

/** Liest das gemerkte Ticket (telemetry-logger.js, beim Absenden) — oder null. */
export function leseRcTicket() {
  try {
    return sessionStorage.getItem(RC_TICKET_KEY);
  } catch (_) {
    return null;
  }
}

/** Räumt das Ticket weg (api.js: neuer Auftrag / Aufräumen des Tab-Stands). */
export function loescheRcTicket() {
  try {
    sessionStorage.removeItem(RC_TICKET_KEY);
  } catch (_) {
    /* dito */
  }
}
