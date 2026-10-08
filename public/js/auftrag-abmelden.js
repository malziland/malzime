/* ── Abmelden eines Auftrags, den der Tab nicht mehr abholt ──────────────
   Seit 08.10.2026 ein eigenes Modul (vorher Teil von api.js). Hier steht, WIE
   abgemeldet wird und was als „offen" gilt; WANN abgemeldet wird, entscheidet
   der Ablauf in api.js. */
import { JOB_STATUS_URL } from "./auftrag-abfrage.js";
import { getStoredJobId, offenerAuftrag } from "./auftrag-speicher.js";

/* PRIV-2026-10-03-57: Meldet dem Server einen Auftrag ab, den dieser Tab
   nicht mehr abholt (ein anderes Foto wurde gewaehlt). Wartet der Auftrag
   noch, verwirft ihn der Server sofort: kein KI-Aufruf, der Platz im
   Stundenkontingent wird frei, das Bild geloescht. Laeuft er schon, aendert
   die Abmeldung nichts. Ohne Abhol-Ticket nimmt der Server sie nicht an.
   Bestmoeglich und still: Scheitert sie, raeumt der Server den Auftrag wie
   bisher nach seiner Karenz selbst ab.
   Abgemeldet wird nur, was NIEMAND mehr abholt: beim Start jedes neuen
   Durchgangs (was der Tab bis dahin gemerkt hatte — auch wenn zuletzt eine
   Wiederaufnahme den Auftrag fuehrte); wenn ein abgeloester Durchgang merkt,
   dass ein anderes Foto uebernommen hat; wenn ein Auftrag erst zurueckkommt,
   nachdem schon ein anderes Foto gewaehlt wurde; und wenn die Seite nach
   langer Pause das Warten auf die Verbindung aufgibt. NICHT abgemeldet wird,
   solange ein Durchgang den Auftrag noch abfragt — auch nicht nach langer
   Pause: Er bekommt sein Ergebnis. Je Auftrag geht hoechstens eine Abmeldung
   hinaus. */
const abgemeldet = new Set();
export function meldeAuftragAb(jobId, resultToken) {
  if (!jobId || !resultToken || abgemeldet.has(jobId)) return;
  abgemeldet.add(jobId);
  try {
    fetch(`${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(resultToken)}`, {
      method: "DELETE",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* Abmelden ist ein Zusatz — nie ein Grund fuer eine Fehlermeldung. */
  }
}

/* Meldet ab, was der Tab gemerkt hat und noch nicht bekommen hat. Ein Auftrag,
   dessen Ergebnis schon auf dem Bildschirm stand, braucht das nicht. */
export function meldeOffenenAuftragAb() {
  const offen = offenerAuftrag();
  if (offen) meldeAuftragAb(offen.jobId, offen.resultToken);
}

/* Ein Durchgang kommt vom Warten zurueck und ist abgeloest. Fuehrt eine
   Wiederaufnahme DENSELBEN Auftrag weiter, steht seine Nummer noch im Tab —
   dann nichts tun. Sonst hat ein anderes Foto uebernommen: abmelden. Meist hat
   das der neue Durchgang schon getan; nicht aber, wenn die Nummer inzwischen
   vergessen war (nach langer Pause im Hintergrund). */
export function abgeloestNachDemWarten(jobId, resultToken) {
  if (getStoredJobId() !== jobId) meldeAuftragAb(jobId, resultToken);
}
