"use strict";

/**
 * erinnerungs-waechter.js — Waechter ueber die Wochen-Erinnerung.
 *
 * AUDIT-BEFUND OPS-2026-08-12-11: Die Erinnerung laeuft montags und schweigt in
 * jedem Fehlerfall. Sie hinterlaesst deshalb bei jedem Lauf ein Lebenszeichen;
 * der Aufraeumdienst (handle-reap.js) ruft diesen Waechter in jedem seiner
 * Laeufe, weil er jede Minute laeuft und in der Alarmrichtlinie steht. Mit dem
 * Aufraeumen selbst hat der Waechter nichts zu tun — deshalb eine eigene Datei.
 */

const { datenbank } = require("./db");

/* Liest das Lebenszeichen der Wochen-Erinnerung und meldet laut, wenn es fehlt
   oder veraltet ist (OPS-2026-08-12-11). */
const LEBENSZEICHEN_DOC = "config/erinnerung";
const LEBENSZEICHEN_MAX_ALTER_MS = 9 * 24 * 60 * 60 * 1000;
/* OPS-2026-08-13-44: Bezugsdatum gegen die unbefristete Gnadenfrist. Vorher
   kehrte der Wächter bei fehlendem Lebenszeichen einfach zurück — läuft die
   Erinnerung NIE an (Zeitplan gelöscht, Function nicht deployt, Dauerfehler),
   schwieg er für immer statt nach neun Tagen zu warnen. Ab diesem Datum + neun
   Tagen ist ein fehlendes Lebenszeichen selbst ein ERROR. Ausgeliefert wurde
   die Erinnerung am 2026-08-12; der erste echte Lauf ist Montag 2026-08-18. */
const ERINNERUNG_AUSGELIEFERT_MS = Date.parse("2026-08-12T00:00:00Z");

/* Laeufe hintereinander, in denen das Lebenszeichen nicht LESBAR war
   (OPS-2026-10-03-25) — gezaehlt wie die Laeufe ohne Betriebswerte im
   Aufraeumdienst, mit dessen Schwelle (er reicht sie herein). Lebt in der
   Instanz. Ohne die Zaehlung schrieb ein dauerhaft blinder Waechter
   jede Minute dieselbe Zeile ohne Schweregrad, und fiel in dieser Zeit auch die
   Erinnerung aus, meldete niemand etwas. */
let laeufeOhneLebenszeichen = 0;

async function pruefeErinnerungsLebenszeichen(laeufeBisAlarm) {
  try {
    const snap = await datenbank().doc(LEBENSZEICHEN_DOC).get();
    laeufeOhneLebenszeichen = 0;
    /* OPS-2026-08-13-44: auf letzterErfolg schauen, nicht letzterLauf — sonst
       hält eine Erinnerung, die jeden Montag NUR läuft aber scheitert (Seite
       nicht lesbar, Datum unlesbar), den Wächter über letzterLauf grün.
       Rückfall auf letzterLauf für Dokumente aus der Zeit vor diesem Feld. */
    const daten = snap.exists && snap.data() ? snap.data() : null;
    const letzterLauf = daten ? Number(daten.letzterErfolg || daten.letzterLauf) : 0;
    if (!letzterLauf) {
      /* Noch nie gelaufen. Bis kurz nach der Auslieferung ist das normal —
         danach hätte längst ein Montag stattgefunden, also ist das Ausbleiben
         des allerersten Lebenszeichens selbst der Befund. */
      if (Date.now() - ERINNERUNG_AUSGELIEFERT_MS > LEBENSZEICHEN_MAX_ALTER_MS) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            error: "erinnerung-nie-gelaufen",
            ausgeliefert: new Date(ERINNERUNG_AUSGELIEFERT_MS).toISOString(),
            hinweis:
              "Die Wochen-Erinnerung hat seit ihrer Auslieferung KEIN einziges Lebenszeichen geschrieben — " +
              "sie ist vermutlich nie angelaufen (Zeitplan/Function pruefen, RUNBOOK).",
          })
        );
      }
      return;
    }
    const alter = Date.now() - letzterLauf;
    if (alter <= LEBENSZEICHEN_MAX_ALTER_MS) return;
    console.error(
      JSON.stringify({
        severity: "ERROR",
        error: "erinnerung-lebenszeichen-veraltet",
        letzterLauf: new Date(letzterLauf).toISOString(),
        alterTage: Math.floor(alter / (24 * 60 * 60 * 1000)),
        hinweis:
          "Die Wochen-Erinnerung hat seit ueber neun Tagen nicht gelaufen. Sie meldet " +
          "ihren eigenen Ausfall bewusst nicht — deshalb diese Meldung. Zeitplan und " +
          "Function pruefen (RUNBOOK).",
      })
    );
  } catch (err) {
    /* Nicht lesbar ist nicht dasselbe wie veraltet — ein einzelner Lauf ist
       eine Warnung, kein Fehlalarm. Bleibt es dabei, ist der Waechter blind:
       ab `laeufeBisAlarm` Laeufen in Folge ein Fehler, jede Minute erneut. */
    laeufeOhneLebenszeichen += 1;
    console.warn(
      JSON.stringify({ severity: "WARNING", step: "reap", warning: "lebenszeichen-nicht-lesbar", error: err.message })
    );
    if (laeufeOhneLebenszeichen >= laeufeBisAlarm) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          step: "reap",
          error: "lebenszeichen-wiederholt-nicht-lesbar",
          laeufeInFolge: laeufeOhneLebenszeichen,
          hinweis:
            "Der Aufraeumer kann das Lebenszeichen der Wochen-Erinnerung (config/erinnerung) seit mehreren " +
            "Laeufen nicht lesen — er wuerde ihren Ausfall nicht bemerken. Firestore und Rechte pruefen (RUNBOOK).",
        })
      );
    }
  }
}

module.exports = { pruefeErinnerungsLebenszeichen };
