"use strict";

/**
 * handle-reap.js — Reaper für hängengebliebene Queue-Jobs (v2.0).
 *
 * Läuft als geplante Function im Minutentakt und räumt drei Sorten auf:
 *
 *  1. Verlassene wartende Jobs — Status `queued`, aber der Client-Herzschlag
 *     (`lastSeenAt`) ist älter als das Karenz-Fenster: Der Browser pollt nicht
 *     mehr, der Nutzer hat die Seite verlassen. → `abandoned`. Damit wird kein
 *     Mistral-Call mehr für ein Ergebnis verbraucht, das niemand abholt, und
 *     der Warteschlangen-Platz wird für andere frei.
 *
 *  2. Hängende Jobs — Status `processing` über dem Verarbeitungs-Timeout
 *     (Worker abgestürzt). `markFailedIfStale` greift nur, wenn ein Client
 *     pollt; pollt keiner mehr, bliebe das Dokument ewig liegen. → `failed`.
 *
 *  2c. PRIV-107b: Zugestellte Ergebnisse nach Ablauf des Browser-
 *     Wiederholungs-Fensters (15 min ab Erstzustellung) — das Dokument hat
 *     ab da keinen Zweck mehr, der Browser zeigt das Ergebnis ohnehin nicht
 *     mehr an. Vorher deckelte nur Zweig (3) mit 2 h.
 *
 *  3. Abgelaufene Job-Dokumente — älter als JOB_RETENTION_MS. Das Dokument
 *     wird endgültig gelöscht (Datensparsamkeit: das fertige Profil im Feld
 *     `result` soll nicht unbegrenzt liegen bleiben).
 *
 * Bei (1) und (2) wird das zwischengespeicherte Bild mitgelöscht (die GCS-
 * Lifecycle-Regel bleibt nur das Sicherheitsnetz).
 *
 */

const {
  findAbandonedJobs,
  findUeberfaelligeJobs,
  findStaleProcessingJobs,
  findExpiredJobs,
  findZugestellteJobs,
  abandonJob,
  failJob,
  deleteJob,
} = require("./jobs");
const { datenbank } = require("./db");
const { deleteImage } = require("./queue-storage");
const { releaseHourlySlot } = require("./counter");

/* Obergrenze der Jobs, die ein einzelner Lauf je Sorte abräumt — verhindert,
   dass ein extremer Rückstau einen Lauf überlange macht. Der nächste Lauf
   (1 min später) nimmt den Rest. */
/* Die Stapelgroesse kommt aus dem Einstellungssatz (aufraeumStapel). Die
   find*-Funktionen holen sie sich selbst, wenn kein Wert uebergeben wird. */

/* OPS-2026-08-13-38: Jede Fund-Abfrage einzeln absichern. Vorher lagen die
   fünf `await findX(...)` ausserhalb jeder Fehlerbehandlung — eine einzige
   fehlschlagende Abfrage (fehlender Index, Berechtigungsentzug, Firestore-
   Stoerung) hielt den GANZEN Reaper an, inklusive der beiden Loeschzweige und
   des Erinnerungs-Waechters. Jetzt: schlaegt eine Abfrage fehl, meldet sie das
   laut (severity ERROR → Alarm) und liefert eine leere Liste, damit die
   uebrigen Zweige weiterlaufen. */
async function sicherFinden(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        step: "reap",
        error: `reap-query-fehlgeschlagen:${name}`,
        message: err && err.message,
      })
    );
    return [];
  }
}

async function reapJobs() {
  /* (1) Verlassene wartende Jobs → abandoned. */
  const abandoned = await sicherFinden("abandoned", () => findAbandonedJobs());
  let reapedAbandoned = 0;
  for (const job of abandoned) {
    try {
      const ok = await abandonJob(job.id);
      /* Schlug der Übergang fehl, hat ein Worker den Job zwischen Query und
         Abbruch geclaimt — er läuft noch und braucht das Bild: nichts anfassen. */
      if (!ok) continue;
      /* BIZ-001: Stunden-Slot zurückgeben — verlassener Job machte nie eine Analyse. */
      await releaseHourlySlot();
      await deleteImage(job.imagePath);
      reapedAbandoned += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "abandon-failed", error: err.message }));
    }
  }

  /* (2) In `processing` hängende Jobs → failed. */
  const stale = await sicherFinden("stale", () => findStaleProcessingJobs());
  let reapedStale = 0;
  for (const job of stale) {
    try {
      await failJob(job.id, "processing_timeout");
      await deleteImage(job.imagePath);
      reapedStale += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "fail-stale-failed", error: err.message }));
    }
  }

  /* (2b) SEC-003: Jobs, die nur noch durch Pollen am Leben gehalten werden.
     Jeder Poll erneuert `lastSeenAt`, deshalb sieht Zweig (1) sie nie. Ohne
     diese Grenze kann jemand 500 Mini-Uploads anlegen, im Takt weiterfragen und
     damit das komplette Stundenfenster dauerhaft blockieren — ohne dass je ein
     Platz zurueckkommt. Nach 35 Minuten wartet niemand mehr ernsthaft; der
     Browser gibt bereits nach 30 auf. */
  const ueberfaellig = await sicherFinden("ueberfaellig", () => findUeberfaelligeJobs());
  let reapedUeberfaellig = 0;
  for (const job of ueberfaellig) {
    try {
      const ok = await abandonJob(job.id);
      if (!ok) continue;
      await releaseHourlySlot();
      await deleteImage(job.imagePath);
      reapedUeberfaellig += 1;
    } catch (err) {
      console.log(JSON.stringify({ step: "reap", jobId: job.id, warning: "overdue-failed", error: err.message }));
    }
  }

  /* (2c) PRIV-107b: Zugestellte Ergebnisse nach dem Browser-Wiederholungs-
     Fenster löschen — Bild zuerst (BUG-002-Regel), defensiv: normal ist es
     nach der Analyse längst weg. */
  const zugestellt = await sicherFinden("zugestellt", () => findZugestellteJobs());
  let reapedZugestellt = 0;
  for (const job of zugestellt) {
    try {
      /* PRIV-2026-08-12-26: Erst loeschen, dann pruefen. Scheitert die Bild-
         loeschung, bleibt das Job-Dokument mit seinem `imagePath` stehen — sonst
         verschwindet der einzige Verweis auf die Datei und niemand kann sie je
         wieder finden. Der naechste Reaper-Lauf versucht es erneut; spaetestens
         Zweig (3) raeumt das Dokument nach 2 h ab. */
      if (job.imagePath && !(await deleteImage(job.imagePath))) continue;
      await deleteJob(job.id);
      reapedZugestellt += 1;
    } catch (err) {
      console.log(
        JSON.stringify({ step: "reap", jobId: job.id, warning: "delete-delivered-failed", error: err.message })
      );
    }
  }

  /* (3) Abgelaufene Job-Dokumente → gelöscht. */
  const expired = await sicherFinden("expired", () => findExpiredJobs());

  let reapedExpired = 0;
  for (const job of expired) {
    try {
      /* BUG-002 (Audit 2026-08-10): Zuerst das Bild, dann das Dokument.
         Mit dem Dokument verschwindet `imagePath` — danach kennt niemand mehr
         den Pfad, und ein Bild, das ein anderer Pfad liegen gelassen hat,
         waere endgueltig verwaist. Dieser Zweig sieht JEDEN abgelaufenen Job
         unabhaengig vom Status und ist damit die einzige Stelle, die jede
         denkbare Waise erwischt: Stirbt der Worker hart, kippt der erste
         Client-Poll den Job ueber `markFailedIfStale` auf `failed` — ohne
         Loeschung — und Zweig (2) sucht nur nach `processing`, findet ihn also
         nie wieder. Deckelt die Verweildauer auf 2 h statt auf die
         Lifecycle-Regel (1 Tag). */
      /* PRIV-2026-08-12-26: Auch hier erst pruefen. Anders als in Zweig (2c)
         wird das Dokument hier trotzdem geloescht, wenn die Bildloeschung
         dauerhaft scheitert — sonst sammelten sich abgelaufene Dokumente mit
         Nutzerdaten unbegrenzt an, und das waere der schwerere Verstoss. Der
         Fehlschlag ist dank deleteImage laut (severity ERROR) und faellt damit
         in die Alarmrichtlinie. */
      const bildWeg = job.imagePath ? await deleteImage(job.imagePath) : true;
      if (!bildWeg) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            error: "reap-bild-blieb-liegen",
            jobId: job.id,
            path: job.imagePath,
            hinweis: "Dokument wird trotzdem geraeumt; das Bild faellt auf die Lifecycle-Regel zurueck.",
          })
        );
      }
      await deleteJob(job.id);
      reapedExpired += 1;
    } catch (err) {
      console.log(
        JSON.stringify({ step: "reap", jobId: job.id, warning: "delete-expired-failed", error: err.message })
      );
    }
  }

  /* AUDIT-BEFUND OPS-2026-08-12-11: Waechter ueber die Wochen-Erinnerung.
     Die Erinnerung laeuft montags und schweigt in jedem Fehlerfall — bis zum
     ersten faelligen Push (2027-02) waere ihr Ausfall 180 Tage lang nicht von
     korrektem Verhalten zu unterscheiden. Sie hinterlaesst deshalb bei jedem
     Lauf ein Lebenszeichen; hier wird es gelesen. Der Reaper eignet sich dafuer,
     weil er jede Minute laeuft und in der Alarmrichtlinie steht — anders als die
     Erinnerung selbst, die bewusst leise bleibt.
     Schwelle 9 Tage: ein ausgefallener Montag allein loest noch nichts aus. */
  await pruefeErinnerungsLebenszeichen();

  console.log(
    JSON.stringify({
      step: "reap",
      abandoned: reapedAbandoned,
      staleProcessing: reapedStale,
      expired: reapedExpired,
      ueberfaellig: reapedUeberfaellig,
      zugestellt: reapedZugestellt,
    })
  );
  return {
    abandoned: reapedAbandoned,
    staleProcessing: reapedStale,
    expired: reapedExpired,
    ueberfaellig: reapedUeberfaellig,
    zugestellt: reapedZugestellt,
  };
}

module.exports = { reapJobs };

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

async function pruefeErinnerungsLebenszeichen() {
  try {
    const snap = await datenbank().doc(LEBENSZEICHEN_DOC).get();
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
    /* Nicht lesbar ist nicht dasselbe wie veraltet — kein Fehlalarm. */
    console.log(JSON.stringify({ warning: "lebenszeichen-nicht-lesbar", error: err.message }));
  }
}
