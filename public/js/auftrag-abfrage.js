/* ── Statusabfrage eines eingereihten Auftrags ──────────────────────────
   Bis 07.10.2026 Teil von js/api.js; das Verhalten ist unverändert. Der
   Ablauf drumherum (einreihen, Ergebnis zeigen, wiederaufnehmen) steht
   weiter dort. */

import { state } from "./state.js";
import { showQueueWaiting } from "./ui.js";
import * as liveAnzeige from "./live-anzeige.js";
import { speichereRcTicket } from "./rc-ticket.js";
import { apiUrl } from "./api-basis.js";
import { fetchWithTimeout, waitForNextPoll } from "./netz-hilfen.js";

/* Adresse aus api-basis.js: im Betrieb direkt Cloud Run (EU), sonst relativ. */
export const JOB_STATUS_URL = apiUrl("/api/job-status");
const POLL_INTERVAL_MS = 2000;
/* Aufeinanderfolgende job-status-Fehler, die der Poll-Loop toleriert, bevor
   er aufgibt — ein Netz-Wackler darf den wartenden User nicht rauswerfen,
   das Ergebnis liegt serverseitig sicher. */
const MAX_POLL_FAILURES = 5;
/* Gesamt-Obergrenze fürs Pollen. Bei randvollem Stundenbudget kann die ehrliche
   Wartezeit darüber liegen (Extremfall: ~950 wartende Jobs ≈ 100 min ETA) —
   dieser Deckel ist der bewusste Schlussstrich, damit kein Tab stundenlang
   pollt. Der aufgegebene Job wird nach der Herzschlag-Karenz gereapt und gibt
   seinen Stunden-Slot zurück. */
export const MAX_POLL_DURATION_MS = 30 * 60 * 1000;
/* Zeitgrenze je Abfrage: Der Client darf nie vor dem Server aufgeben
   (job-status 10 s), aber ein Fetch, der nie settelt (Netz-Blackhole auf
   Mobilgeräten), darf den Wartefluss nicht einfrieren. */
const POLL_TIMEOUT_MS = 30000;

/**
 * Pollt /api/job-status bis zu einem Terminal-Status. Jeder Poll erneuert
 * serverseitig den Liveness-Herzschlag des Jobs.
 * @param {boolean} [liveErlaubt] v3.0: Live-Text-Wellen aus processing-
 *        Antworten an die Live-Anzeige durchreichen. Nur der frische Upload
 *        setzt das — die Wiederaufnahme nach einem Reload bleibt bewusst beim
 *        heutigen Verhalten (Scan-Animation bis zum fertigen Ergebnis).
 * @returns {Promise<object|null>} {result} | {error,reason} | {abandoned}
 *          — oder null, wenn ein neuer Upload den Lauf abgelöst hat.
 *          `error` ist der SCHLÜSSEL des Textes (etwa "error.queueFailed"),
 *          nicht der fertige Text: Der Aufrufer übersetzt und gibt den
 *          Schlüssel an die Statuszeile weiter, damit die Meldung einen
 *          Sprachwechsel mitmacht (UX-2026-10-03-48).
 */
export async function pollJob(jobId, myId, resultToken, pollImmediately = false, liveErlaubt = false) {
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
      return { error: "error.timeout" };
    }

    let data;
    try {
      const tokenParam = resultToken ? `&token=${encodeURIComponent(resultToken)}` : "";
      /* PRIV-2026-09-10-06: traegt das Profil — nie zwischenspeichern, auch ohne Server-Kopfzeile. */
      const resp = await fetchWithTimeout(
        `${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}${tokenParam}`,
        { cache: "no-store" },
        POLL_TIMEOUT_MS
      );
      if (!resp.ok) {
        /* 404 = Job existiert nicht (mehr) — kein transienter Fehler. */
        if (resp.status === 404) return { error: "error.queueFailed" };
        throw new Error(`HTTP ${resp.status}`);
      }
      data = await resp.jsonMitTimeout();
      failures = 0;
      /* Zeitstempel des letzten erfolgreichen Polls: Daran erkennt die
         Wiederaufnahme, ob diese Schleife noch lebt oder in einem eingefrorenen
         fetch feststeckt. */
      state.lastPollOk = Date.now();
    } catch (_) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        /* transient: Die Verbindung ist weg, NICHT der Job. Der läuft
           serverseitig weiter und das Ergebnis liegt rund zwei Stunden bereit.
           Der Aufrufer darf die Job-Nummer deshalb nicht wegwerfen — sonst ist
           das fertige Profil unerreichbar, obwohl es existiert. */
        return { error: "error.connectionLost", transient: true };
      }
      continue;
    }

    if (state.requestId !== myId) return null;

    switch (data.status) {
      case "queued":
        showQueueWaiting("queued", data.position, data.etaSeconds);
        break;
      case "processing":
        showQueueWaiting("processing");
        /* v3.0: Liefert der Server schon Live-Text, tippt die Live-Anzeige ihn
           mit — sie versteckt beim ersten Zeichen selbst die Scan-Animation.
           Beide Felder gehen als EINE Welle ans Modul: `standard` (liveText)
           und, sobald das Modell es schreibt, das Beast-Profil (liveTextBeast)
           — angezeigt wird dort der Puffer des gerade gewählten Modus. Fehlt
           das Feld noch, passiert hier nichts. Einen Schalter dafür gibt es
           seit dem 10.09.2026 nicht mehr: Live-Text ist immer an. */
        if (liveErlaubt && typeof data.liveText === "string") {
          liveAnzeige.welle({
            standard: data.liveText,
            beast: typeof data.liveTextBeast === "string" ? data.liveTextBeast : null,
            /* FEATURE-2026-08-29-01: Fertige Merkmale derselben Welle. Fehlen
               sie (noch keine Karte fertig), bleibt es beim reinen Text. */
            kartenStandard: Array.isArray(data.liveKartenStandard) ? data.liveKartenStandard : null,
            kartenBeast: Array.isArray(data.liveKartenBeast) ? data.liveKartenBeast : null,
            /* Neuversuch nach Verbindungsabriss: steigt die Zahl, faengt die
               Anzeige von vorn an (live-anzeige.js). */
            versuch: data.liveTextVersuch,
          });
        }
        break;
      case "done":
        /* BUG-2026-08-13-FE-05: „fertig ohne Ergebnis" ist keine Zustellung.
           Der Server schickt {status:"done", result:null, tokenRequired:true},
           wenn ein Ergebnis existiert, aber das Abhol-Ticket fehlt (etwa wenn
           sessionStorage beim zweiten Schreibvorgang warf). Vorher lief das als
           Zustellung durch: startete die 15-Minuten-Frist und zeigte ein
           Fehler-Banner statt still aufzuräumen. Jetzt wie ein Fehler behandelt. */
        if (data.result == null) {
          return { error: "error.queueFailed", reason: data.tokenRequired ? "token-fehlt" : "kein-ergebnis" };
        }
        /* KA-02: Das Einmal-Ticket für den Realitäts-Check kommt genau mit
           der ersten Auslieferung (danach nie wieder) — sofort merken, damit
           es Reload und Tab-Wiederaufnahme im 15-Minuten-Fenster überlebt. */
        if (typeof data.rcTicket === "string") speichereRcTicket(data.rcTicket);
        /* Fragte der Server neu, ohne dass die Anzeige den neuen Versuch sah
           (kurz offline), wird der alte Text verworfen statt zu Ende getippt. */
        if (liveErlaubt) liveAnzeige.versuchAbgleichen(data.liveTextVersuch);
        return { result: data.result };
      case "failed":
        return { error: "error.queueFailed", reason: data.errorReason };
      case "abandoned":
        return { abandoned: true };
      default:
        return { error: "error.queueFailed" };
    }
  }
}
