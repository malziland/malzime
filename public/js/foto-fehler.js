/* ── Meldung, wenn ein Foto nicht gelesen, geoeffnet oder hochgeladen wird ──
   Am 09.10.2026 aus js/api.js herausgeloest: Die Liste der Diagnosefelder
   waechst mit jeder Fehlersuche, der Ablauf dort (analyzeImageQueued) soll es
   nicht. */

import { state } from "./state.js";
import { logClientError } from "./error-logger.js";

/* DAUER DER FOTOAUSWAHL (14.10.2026): Am 14.10.2026 kam im Workshop auf einem
   Samsung-Handy die Fotoauswahl zweimal ohne Foto zurueck, ohne dass vorher
   ein Foto gewaehlt war. Die Meldung sagt seither zusaetzlich, wie lange die
   Auswahl offen war: sofort leer zurueck oder erst nach einer Weile. Was das
   bedeutet, zeigt erst der Versuch am Geraet. NICHT gleichsetzen mit
   „Abbrechen“: In Chromium loest ein echtes Abbrechen ohne vorheriges Foto
   gar kein `change` aus, also auch keine Meldung (Abnahme 14.10.2026, am
   Samsung-Geraet nicht geprueft). Gemessen wird ab dem Tippen auf die
   Auswahl; ohne gemerkten Start (oder bei einer Uhr, die rueckwaerts zu laufen
   scheint) gibt es keine Zahl, dann steht in der Meldung wie bisher 0. Der
   Start gilt fuer genau eine Rueckkehr der Auswahl. Mitgeschickt wird die Zahl
   im Feld „Dauer“ der Meldung, das die Datenschutzerklaerung schon nennt —
   kein neues Feld, keine Angabe ueber Kind oder Geraet. */
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

/* LEERE AUSWAHL (16.09.2026): Kommt die Auswahl ohne Datei zurueck, sieht das
   Kind gar nichts — die Fehlererfassung soll es trotzdem sehen. Die Phase
   sagt, ob in diesem Tab vorher schon ein Foto gewaehlt war; die Dauer (seit
   14.10.2026), wie lange die Auswahl offen war. */
export function meldeLeereAuswahl(hatteSchonFoto, jetzt) {
  logClientError(new Error("auswahl_leer"), {
    phase: hatteSchonFoto ? "auswahl-leer-nach-foto" : "auswahl-leer",
    durationMs: auswahlOffenMs(jetzt),
  });
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
