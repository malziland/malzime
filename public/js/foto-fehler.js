/* ── Meldung, wenn ein Foto nicht gelesen, geoeffnet oder hochgeladen wird ──
   Am 09.10.2026 aus js/api.js herausgeloest: Die Liste der Diagnosefelder
   waechst mit jeder Fehlersuche, der Ablauf dort (analyzeImageQueued) soll es
   nicht. */

import { state } from "./state.js";
import { logClientError } from "./error-logger.js";

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
