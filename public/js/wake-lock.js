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
   "unsupported", "acquired", "denied:<FehlerName>".

   Seit 10.09.2026 ein eigenes Modul (vorher Teil von api.js); das Verhalten
   ist unverändert. */
let wakeLock = null;
let status = "not-attempted";
/* v1.10.8: Guard gegen Doppel-Anfrage. acquireWakeLock wird jetzt aus dem
   User-Gesture-Kontext heraus aufgerufen (app.js handleNewFile, direkt im
   change/drop-Event) — und zusaetzlich als Fallback in analyzeImage. Der
   Guard stellt sicher, dass nur die ERSTE Anfrage zaehlt: ein zweiter Aufruf
   nach `await`-Punkten wuerde auf iOS mit NotAllowedError scheitern und den
   bereits gewonnenen Status ueberschreiben. */
let wakeLockRequested = false;

/** Stand für die Telemetrie: "not-attempted", "unsupported", "acquired" oder "denied:<FehlerName>". */
export function wakeLockStatus() {
  return status;
}

/* WICHTIG: iOS Safari erlaubt navigator.wakeLock.request("screen") nur,
   solange noch transiente User-Aktivierung besteht — also unmittelbar nach
   dem Tippen, VOR jedem `await`. Deshalb wird diese Funktion aus dem
   synchronen change/drop-Handler (app.js) aufgerufen, nicht erst tief in der
   asynchronen analyzeImage-Pipeline. */
export async function acquireWakeLock() {
  if (wakeLockRequested) return;
  wakeLockRequested = true;
  if (!("wakeLock" in navigator)) {
    status = "unsupported";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    status = "acquired";
  } catch (err) {
    /* Verweigert/nicht verfügbar — kein Abbruch, läuft ohne Wake-Lock weiter. */
    wakeLock = null;
    status = "denied:" + (err && err.name ? err.name : "unknown");
  }
}

export function releaseWakeLock() {
  /* Guard zuruecksetzen, damit die naechste Analyse wieder anfordern darf. */
  wakeLockRequested = false;
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}
