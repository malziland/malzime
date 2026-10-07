"use strict";

/**
 * analyse-ausgang.js — welche Fehlermeldung ein Endzustand dem Kind zeigt, und
 * die eine Fehlerzeile dazu.
 *
 * Aus jobs.js herausgeloest: Dort stehen die Uebergaenge eines Auftrags, hier
 * steht, was ein Endzustand BEDEUTET. Reine Rechnung und eine Protokollzeile,
 * ohne Datenbank.
 */

/* EIN ALARM JE GESCHEITERTER ANALYSE (01.10.2026). Endet eine Analyse mit
   einer Fehlermeldung, endet ihr Auftrag `done` mit blockiertem Ergebnis,
   `done` mit einem leeren Profil in einem der beiden Modi (completeJob) oder
   `failed` (failJob — Worker nicht fertig, oder schon das Einreihen scheiterte,
   `enqueue_failed`). Zu diesem Uebergang gehoert die eine Fehlerzeile, auf die
   der Alarm "Analyse gescheitert" hoert; der Auftrag traegt bis dahin
   `gemeldet: false` (jobs.js, OPS-2026-10-03-31). Scheitert das Einreihen,
   bevor es einen Auftrag gibt (Speicher oder Datenbank weg), ruft
   handle-enqueue.js dieselbe Meldung selbst. Die Zeilen, die den Grund im
   Einzelnen beschreiben (KI-Aufruf, Foto laden, Absturzverdacht, verworfenes
   Ergebnis), sind Warnungen — sonst kaemen fuer eine Fehlermeldung zwei
   Nachrichten, und ein Tierfoto, das trotz gescheiterter Nachfrage sein Profil
   bekommt, loeste einen Fehlalarm aus.
   Ohne Kennung (handle-process-job.js, "AB HIER KEINE KENNUNG IM LOG"): nur
   der Grund, und nur als feste Kennung wie `blocked.apiError` oder
   `processing_timeout` — alles andere wird "unbekannt". */
const GRUND_MUSTER = /^(blocked\.[A-Za-z]{1,40}|[a-z_]{1,40})$/;

/* Ein Profil ohne Text und ohne Karten zeigt im jeweiligen Modus "Die KI hat
   ein leeres Profil zurueckgeliefert" (public/js/render.js, hasContent —
   dieselbe Regel). Das passiert, wenn nur ein Teil gerettet wurde und die
   Nachfrage nach den fehlenden Karten scheiterte. Tierprofile sind immer
   gefuellt, blockierte Ergebnisse haben keine Profile. */
function leeresProfil(result) {
  if (!result || !result.profiles || !result.meta || result.meta.mode === "animal") return null;
  const hatInhalt = (p) =>
    Boolean(
      p &&
      ((typeof p.profileText === "string" && p.profileText.trim()) ||
        (p.categories && Object.keys(p.categories).length > 0))
    );
  if (!hatInhalt(result.profiles.normal)) return "profil_leer_standard";
  if (!hatInhalt(result.profiles.boost)) return "profil_leer_beast";
  return null;
}

function meldeGescheiterteAnalyse(grund) {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      alert: "analyse-gescheitert",
      step: "analyse-ausgang",
      grund: typeof grund === "string" && GRUND_MUSTER.test(grund) ? grund : "unbekannt",
    })
  );
}

/**
 * Der Grund der Fehlermeldung, die ein Auftrag in diesem Zustand dem Kind
 * zeigt — oder `null`, wenn er keine zeigt (wartend, laufend, verlassen,
 * erfolgreich). Nimmt das Auftragsdokument (oder dessen Felder `status`,
 * `result`, `errorReason`).
 *
 * Bei einem blockierten Ergebnis geht `errorReason` vor: Dort steht der wahre
 * Grund, wenn er ein anderer ist als der, den das Kind sieht
 * (`ergebnis_speichern`, jobs.js).
 */
function fehlerGrund(daten) {
  if (!daten) return null;
  if (daten.status === "failed") return daten.errorReason || "unbekannt";
  if (daten.status !== "done") return null;
  const result = daten.result;
  if (result && result.meta && result.meta.mode === "blocked") return daten.errorReason || result.blockedReason;
  return leeresProfil(result);
}

module.exports = { fehlerGrund, leeresProfil, meldeGescheiterteAnalyse };
