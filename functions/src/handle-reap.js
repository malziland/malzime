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
  nachmeldenBeimLoeschen,
} = require("./jobs");
const { pruefeErinnerungsLebenszeichen } = require("./erinnerungs-waechter");
const { letzterLeseversuchGescheitert } = require("./betriebsprofil");
const { deleteImage } = require("./queue-storage");
const { belegtesFreigeben } = require("./ruecknahme");

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
   uebrigen Zweige weiterlaufen.

   AUSNAHME seit 07.09.2026: fehlende Betriebswerte. Das ist kein kaputter
   Index und keine entzogene Berechtigung, sondern meist ein einzelner traeger
   Datenbankzugriff (BELEG 07.09.2026, 17:37 Wien: ein Lauf ohne Werte, der
   naechste gesund, niemand betroffen — und trotzdem zwei Alarme). Ein Lauf
   ist eine Warnung; ob es ein Fehler ist, entscheidet reapJobs am Ende ueber
   die Laeufe in Folge. */
/* Laeufe hintereinander, in denen mindestens eine Abfrage ohne Betriebswerte
   blieb. Lebt in der Instanz; ein Instanzwechsel setzt auf null — dann
   alarmiert ein Dauerzustand spaeter, nicht gar nicht. */
let laeufeOhneBetriebswerte = 0;
/* BLEIBT IM CODE — Schutzgrenze der Alarmierung, keine Betriebseinstellung:
   Sie haengt am Minutentakt des Aufraeumers, nicht an Last oder Modell. Fuenf
   Laeufe sind fuenf Minuten — ein Ausrutscher bleibt still, ein Dauerzustand
   nicht.
   BELEG fuer fuenf statt zwei (10.09.2026, 11:18 und 11:19 Wien): zwei traege
   Lesevorgaenge direkt hintereinander, der Lauf danach gesund, niemand
   betroffen — und trotzdem Alarm. Firestore selbst beantwortete in diesen
   Minuten laut Googles Messwerten jede Anfrage in hoechstens 0,15 s. Fuer
   diesen Alarm sind fuenf Minuten unschaedlich: Er ist die Reserve fuer die
   Zeit, in der niemand analysiert. */
const LAEUFE_BIS_ALARM = 5;

async function sicherFinden(name, fn, lauf) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "config_missing") {
      lauf.ohneBetriebswerte = true;
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          step: "reap",
          warning: `reap-query-ohne-betriebswerte:${name}`,
          message: err.message,
        })
      );
      return [];
    }
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
  const lauf = { ohneBetriebswerte: false };
  /* (1) Verlassene wartende Jobs → abandoned. */
  const abandoned = await sicherFinden("abandoned", () => findAbandonedJobs(), lauf);
  let reapedAbandoned = 0;
  for (const job of abandoned) {
    try {
      const ok = await abandonJob(job.id);
      /* Schlug der Übergang fehl, hat ein Worker den Job zwischen Query und
         Abbruch geclaimt — er läuft noch und braucht das Bild: nichts anfassen. */
      if (!ok) continue;
      /* BIZ-001: Stunden-Slot zurückgeben — verlassener Job machte nie eine
         Analyse — und das Foto loeschen (ruecknahme.js). */
      await belegtesFreigeben(job);
      reapedAbandoned += 1;
    } catch (err) {
      /* FEHLERZEILEN DES AUFRAEUMDIENSTES OHNE jobId UND OHNE FEHLERTEXT
         (27.09.2026): Die Fristen, nach denen er einen Auftrag anfasst,
         liegen fest (Anlage + Aufbewahrung, Abholung + Zustellfenster). Eine
         jobId hier liesse sich darueber minutengenau der Abschlusszeile der
         Analyse und damit der Kinderschutz-Zeile zuordnen; ein
         Firestore-Fehlertext kann den Dokumentpfad samt jobId enthalten.
         Fehlgeschlagene Schritte wiederholt der naechste Lauf ohnehin. */
      console.log(
        JSON.stringify({
          step: "reap",
          warning: "abandon-failed",
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
      );
    }
  }

  /* (2) In `processing` hängende Jobs → failed. */
  const stale = await sicherFinden("stale", () => findStaleProcessingJobs(), lauf);
  let reapedStale = 0;
  for (const job of stale) {
    try {
      await failJob(job.id, "processing_timeout");
      await deleteImage(job.imagePath);
      reapedStale += 1;
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "reap",
          warning: "fail-stale-failed",
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
      );
    }
  }

  /* (2b) SEC-003: Jobs, die nur noch durch Pollen am Leben gehalten werden.
     Jeder Poll erneuert `lastSeenAt`, deshalb sieht Zweig (1) sie nie. Ohne
     diese Grenze kann jemand 500 Mini-Uploads anlegen, im Takt weiterfragen und
     damit das komplette Stundenfenster dauerhaft blockieren — ohne dass je ein
     Platz zurueckkommt. Nach 35 Minuten wartet niemand mehr ernsthaft; der
     Browser gibt bereits nach 30 auf. */
  const ueberfaellig = await sicherFinden("ueberfaellig", () => findUeberfaelligeJobs(), lauf);
  let reapedUeberfaellig = 0;
  for (const job of ueberfaellig) {
    try {
      const ok = await abandonJob(job.id);
      if (!ok) continue;
      await belegtesFreigeben(job);
      reapedUeberfaellig += 1;
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "reap",
          warning: "overdue-failed",
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
      );
    }
  }

  /* (2c) PRIV-107b: Zugestellte Ergebnisse nach dem Browser-Wiederholungs-
     Fenster löschen — Bild zuerst (BUG-002-Regel), defensiv: normal ist es
     nach der Analyse längst weg. */
  const zugestellt = await sicherFinden("zugestellt", () => findZugestellteJobs(), lauf);
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
      /* OPS-2026-10-03-31: Was eine Fehlermeldung zeigte und noch nicht
         gemeldet ist, wird jetzt gemeldet — hier und in Zweig (3). */
      nachmeldenBeimLoeschen(job);
      reapedZugestellt += 1;
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "reap",
          warning: "delete-delivered-failed",
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
      );
    }
  }

  /* (3) Abgelaufene Job-Dokumente → gelöscht. */
  const expired = await sicherFinden("expired", () => findExpiredJobs(), lauf);

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
            hinweis: "Dokument wird trotzdem geraeumt; das Bild faellt auf die Lifecycle-Regel zurueck.",
          })
        );
      }
      await deleteJob(job.id);
      nachmeldenBeimLoeschen(job);
      reapedExpired += 1;
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "reap",
          warning: "delete-expired-failed",
          code: (err && err.code) || null,
          art: (err && err.name) || null,
        })
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
  await pruefeErinnerungsLebenszeichen(LAEUFE_BIS_ALARM);

  /* BUG-2026-10-03-32: Ist der Einstellungssatz gerade nicht lesbar, liefert
     betriebsprofil.js den zuletzt gueltig gelesenen weiter — die Abfragen oben
     laufen dann durch und werfen nicht. Fuer die Zaehlung unten ist so ein
     Lauf trotzdem einer ohne frisch gelesene Betriebswerte: sonst kaeme der
     Alarm fuer den Dauerzustand nie mehr. Eine Warnung je Lauf, mit demselben
     Namensanfang wie die Warnungen der einzelnen Abfragen (die Abfrage im
     RUNBOOK zaehlt sie nach Minuten). */
  if (!lauf.ohneBetriebswerte && letzterLeseversuchGescheitert()) {
    lauf.ohneBetriebswerte = true;
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        step: "reap",
        warning: "reap-query-ohne-betriebswerte:letzter-stand",
      })
    );
  }

  /* Ohne Betriebswerte in LAEUFE_BIS_ALARM Laeufen hintereinander ist es kein
     Ausrutscher mehr — dann alarmieren, jede Minute erneut, bis es wieder geht. Ein
     gesunder Lauf setzt die Zaehlung zurueck (KERN 4: die Pruefung kann sich
     erholen). */
  if (lauf.ohneBetriebswerte) {
    laeufeOhneBetriebswerte += 1;
    if (laeufeOhneBetriebswerte >= LAEUFE_BIS_ALARM) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          step: "reap",
          error: "betriebswerte-wiederholt-nicht-lesbar",
          laeufeInFolge: laeufeOhneBetriebswerte,
          hinweis:
            "Der Aufraeumer kommt seit mehreren Laeufen nicht an die Betriebswerte (config/betriebsprofil). " +
            "Firestore und das Dokument pruefen (RUNBOOK).",
        })
      );
    }
  } else {
    laeufeOhneBetriebswerte = 0;
  }

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
