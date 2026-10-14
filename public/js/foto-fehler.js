/* ── Meldung, wenn ein Foto nicht gelesen, geoeffnet oder hochgeladen wird ──
   Am 09.10.2026 aus js/api.js herausgeloest: Die Liste der Diagnosefelder
   waechst mit jeder Fehlersuche, der Ablauf dort (analyzeImageQueued) soll es
   nicht. */

import { state } from "./state.js";
import { logClientError } from "./error-logger.js";

/* DAUER DER FOTOAUSWAHL (14.10.2026): Kommt die Auswahl ohne Foto zurueck,
   sagt die Dauer, wie lange sie offen war. Sofort leer zurueck spricht eher
   fuer ein Versagen des Geraets, nach einer Weile eher fuer Abbrechen. Am
   14.10.2026 kam sie im Workshop auf einem Samsung-Handy zweimal leer zurueck,
   ohne dass vorher ein Foto gewaehlt war — das Protokoll konnte beides nicht
   unterscheiden. Gemessen wird ab dem Tippen auf die Auswahl; ohne gemerkten
   Start (oder bei einer Uhr, die rueckwaerts zu laufen scheint) gibt es keine
   Zahl. Der Start gilt fuer genau eine Rueckkehr der Auswahl. Mitgeschickt
   wird die Zahl im Feld "Dauer" der Meldung, das die Datenschutzerklaerung
   schon nennt — kein neues Feld, keine Angabe ueber Kind oder Geraet. */
let auswahlGeoeffnetUm = null;

export function merkeAuswahlGeoeffnet(jetzt = performance.now()) {
  auswahlGeoeffnetUm = jetzt;
}

export function auswahlOffenMs(jetzt = performance.now()) {
  if (auswahlGeoeffnetUm === null) return undefined;
  const ms = Math.round(jetzt - auswahlGeoeffnetUm);
  auswahlGeoeffnetUm = null;
  return ms >= 0 ? ms : undefined;
}

/* Meldet den Fehler samt den Diagnosefeldern, die exif.js an ihn haengt. */
export function meldeFotoFehler(err, kontext) {
  logClientError(err, {
    ...kontext,
    fileFormat: err.fileFormat,
    errorDetail: err.errorDetail,
    fileSizeKb: err.fileSizeKb,
    /* Lesefehler-Diagnose (08.09.2026): Zeit seit der Auswahl und das
       Ergebnis des zweiten Lesewegs — beides ohne Personenbezug. */
    msSeitAuswahl: err.msSeitAuswahl,
    zweiterLeseweg: err.zweiterLeseweg,
    kopfLesetest: err.kopfLesetest,
    /* 09.10.2026: Art der Zeitangabe der Datei und Vergleich mit der vorigen
       Auswahl (beides exif.js) — nur beim Lesefehler, feste Woerter. */
    dateizeit: err.dateizeit,
    zeitsprung: err.message === "read_failed" ? state.zeitsprung : undefined,
  });
}
