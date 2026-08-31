"use strict";

/**
 * handle-process-job.js — Worker der Queue-Architektur (v2.0).
 *
 * Wird AUSSCHLIESSLICH von Cloud Tasks aufgerufen (POST mit { jobId }).
 * Der Schutz vor öffentlichem Aufruf liegt auf IAM-Ebene: die processJob-
 * Function wird NICHT public deployt — nur der Service-Account von Cloud
 * Tasks erhält die Invoker-Rolle (siehe index.js + Deploy-Schritt). Cloud
 * Run weist unauthentifizierte Aufrufe damit ab, bevor dieser Code läuft.
 *
 * Ablauf:
 *  1. Job aus Firestore lesen, claimen (idempotent: queued → processing).
 *  2. Bild aus Storage laden.
 *  3. Mistral-Pipeline (Beschreibung → Klassifikation → Privacy → Profile).
 *  4. Ergebnis ins Job-Dokument schreiben (completeJob).
 *  5. Bild aus Storage löschen (immer — Erfolg ODER Fehler).
 *
 * Idempotenz: Liefert Cloud Tasks denselben Task doppelt, schlägt der
 * zweite claimJob fehl → der Worker bestätigt nur (200) und tut nichts.
 *
 * Fehlerverhalten: Jeder Pipeline-Fehler wird zu einem regulären „blocked"-
 * Ergebnis (completeJob mit blockedReason) — der Client bekommt eine saubere,
 * renderbare Antwort. Der Worker antwortet
 * immer mit 200; ein Job, der den Worker zum Absturz bringt, wird vom
 * Stale-Timeout in jobs.js aufgefangen.
 */

const { isLocalQueueMode, localQueueConcurrency } = require("./config");
/* PUNKT 3 des Nachtlaufs, 31.08.2026: Die kleinen Entscheidungen liegen in
   einer eigenen Datei — alle drei Wege brauchen sie. */
const {
  
  
  
  
  
  
  
  loggeMinorSafety,
  
} = require("./job-helfer");

/* Die beiden Analyse-Wege liegen in einer eigenen Datei — was hier bleibt, ist
   die Annahme des Auftrags und das Wegschreiben des Ergebnisses. */
const { runPipeline } = require("./job-pipelines");
const { incrementTotals, releaseHourlySlot } = require("./counter");
const { getJob, claimJob, completeJob, isAbandoned, abandonJob, countProcessingJobs } = require("./jobs");
const { geltendeWerte } = require("./betriebsprofil");
const { deleteImage } = require("./queue-storage");
const { redispatchJobLocal } = require("./cloud-tasks");
/* FEATURE-2026-08-29-02: Jede erfolgreiche Analyse meldet ihre Dauer. */
const { merkeDauer } = require("./durchsatz");

/* Mistral-Provider: im Mock-Modus die kostenlose Attrappe, sonst die echte
   API. Umschaltbar über die Umgebungsvariable MISTRAL_MOCK ("1" = Mock) —
   für Unit-Tests, Emulator-Durchklick und Mock-Lasttests. */

/* ── Kinderschutz-Bericht loggen (beide Pipelines) ────────────────────────
   IMMER loggen, nicht nur bei einem Treffer (Audit SEC-001): Ein
   systematischer Ausfall (englischsprachiger Durchgang, kein erkanntes
   Alter) erzeugte sonst exakt null Spuren und waere von "alles sauber" nicht
   zu unterscheiden. `alter: null` ist die wichtigste dieser Zeilen.

   ESKALATION (Kurzaudit 2026-08-11, SEC-108): Taucht ein Begriff der HARTEN
   Stufe (Pornografie, Waffen, Extremismus) im Fliesstext auf, ist das kein
   Zaehlfall, sondern ein Regelbruch des Modells — dann geht zusaetzlich eine
   ERROR-Zeile raus, die den vorhandenen E-Mail-Alarm ausloest (processJob
   steht im Alarmfilter). Die minor-Stufe bleibt bewusst ein stiller Zaehler:
   Sie schlaegt regelmaessig auf den Lerninhalt selbst an ("Ratenzahlung" im
   Beast-Text, gemessen 2026-08-11). */

/* v2.2: Single-Large-Call-Pipeline. Ersetzt Describe + 2× Profile durch
   einen einzigen Large-Aufruf, der das Bild ansieht und beide Profile in
   einer Antwort liefert. Tier-Easter-Egg und Privacy-Risks bleiben unmittelbar
   nutzbar; sie laufen heute über die Beschreibung — die liegt im Single-Call
   aber NICHT mehr als String vor, sondern verteilt im JSON. Wir rekonstruieren
   einen "kompakten Beschreibungs-Text" aus profileText, damit
   classifyDescription/extractVisibleText weiter funktionieren. Pragmatischer
   Workaround, bis der Tier-Pfad bei Bedarf nativ eingebaut wird. */

/* Fail-safe Flag-Lesen: jeder Fehler beim Firestore-Read → 3-Call-Pipeline.
   Vermeidet, dass ein vorübergehender Firestore-Fehler die ganze Pipeline
   blockiert. */

/* Analog fail-safe: Kann das Prompt-Cache-Flag nicht gelesen werden, laeuft der
   Call ohne Cache-Key — also exakt wie vor v2.5. Ein Firestore-Wackler darf
   eine reine Kostenoptimierung niemals zum Ausfall eskalieren. */
/* Fail-safe wie die anderen Flags: Ist das Flag nicht lesbar, laeuft der
   Zweitaufruf wie im Normalbetrieb weiter — eine Kostenoptimierung darf keinen
   Funktionsausfall ausloesen. */

/* Fail-safe wie die anderen Flags — hier heisst „sicher" AUS: Ist das Flag
   nicht lesbar, laeuft der Aufruf ohne Stream, also exakt der heutige Pfad.
   Der Live-Text ist reiner Komfort; ein Firestore-Wackler darf das Experiment
   niemals von selbst einschalten. */

async function handleProcessJob(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const jobId = req.body && req.body.jobId;
  if (!jobId || typeof jobId !== "string") {
    /* Kein gültiger Task-Body — bestätigen, damit Cloud Tasks nicht endlos
       einen kaputten Task wiederholt. */
    console.log(JSON.stringify({ step: "process-job", status: "missing-jobId" }));
    res.status(200).json({ ok: false, reason: "missing_jobId" });
    return;
  }

  const job = await getJob(jobId);
  if (!job) {
    console.log(JSON.stringify({ step: "process-job", jobId, status: "job-not-found" }));
    res.status(200).json({ ok: false, reason: "job_not_found" });
    return;
  }

  /* OPS-2026-08-13-34: Ein Worker kann nach dem Claim sterben (Instanz-Kill,
     OOM). Cloud Tasks stellt binnen 0,1 s erneut zu und trägt dabei
     `X-CloudTasks-TaskRetryCount ≥ 1`. Trifft eine solche Wiederholung auf einen
     Job, der noch `processing` ist, ist der vorige Versuch mit hoher
     Wahrscheinlichkeit abgestürzt — der Nutzer wartet sonst bis zu 9 Minuten auf
     `failed`, ohne dass ein Alarm feuert (die Request-Logs mit dem 503 sind per
     PRIV-12 ausgeschlossen, `staleProcessing` loggt ohne severity). Eine
     ERROR-Zeile hier löst die bestehende Alarmrichtlinie aus und ist gefahrlos:
     der idempotente Claim unten verhindert weiterhin jede Doppelverarbeitung. */
  const retryCount = Number(req.headers && req.headers["x-cloudtasks-taskretrycount"]);
  if (retryCount >= 1 && job.status === "processing") {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        step: "process-job",
        jobId,
        error: "worker-abgestuerzt-verdacht",
        retryCount,
        hinweis:
          "Task-Wiederholung traf einen noch verarbeitenden Job - der vorige Worker ist vermutlich abgestuerzt. Der Nutzer wartet sonst bis zur Stale-Grenze auf failed.",
      })
    );
  }

  /* Liveness: Hat der Client die Seite verlassen, während der Job wartete?
     Dann gar nicht erst Mistral aufrufen — Job auf `abandoned` setzen, Bild
     löschen, fertig. Backstop für die Lücke, bis der Reaper den Job erwischt. */
  const { werte: betriebsW, grund: betriebsGrund } = await geltendeWerte();
  if (!betriebsW) {
    /* Ohne Einstellungssatz laeuft keine Analyse. Der Job bleibt liegen und
       wird nach der Wiederholung ehrlich als Fehler gemeldet, statt mit
       erfundenen Werten zu rechnen. */
    console.error(
      JSON.stringify({ step: "process-job", jobId, status: "kein-einstellungssatz", grund: betriebsGrund })
    );
    res.status(503).json({ ok: false, reason: "config_missing" });
    return;
  }
  if (isAbandoned(job, betriebsW.livenessGnadenfristMs)) {
    const didAbandon = await abandonJob(jobId);
    if (!didAbandon) {
      /* Übergang verloren: Entweder hat der Reaper parallel abgeräumt (Bild
         dort gelöscht) oder ein zweiter Dispatch hat den Job geclaimt und
         braucht das Bild noch — in beiden Fällen gehört das Aufräumen ihm. */
      console.log(JSON.stringify({ step: "process-job", jobId, status: "abandon-raced" }));
      res.status(200).json({ ok: false, reason: "abandoned" });
      return;
    }
    /* BIZ-001: nur freigeben, wenn DIESER Aufruf den Job wirklich verlassen hat
       (sonst Doppel-Freigabe, falls der Reaper parallel war). */
    releaseHourlySlot().catch(() => {});
    await deleteImage(job.imagePath);
    console.log(JSON.stringify({ step: "process-job", jobId, status: "abandoned" }));
    res.status(200).json({ ok: false, reason: "abandoned" });
    return;
  }

  /* Lokal-Modus-Drosselung: Cloud Tasks gibt es im Emulator nicht. Sind schon
     genug Jobs in Verarbeitung, diesen Job vertagen — er bleibt `queued` und
     wird kurz darauf erneut angestoßen. So staut sich eine echte Warteschlange
     mit sichtbaren Positionen. In Produktion (kein QUEUE_LOCAL) ist dieser
     Block inaktiv — dort drosselt das echte Cloud Tasks. */
  if (isLocalQueueMode() && job.status === "queued") {
    const processing = await countProcessingJobs();
    if (processing >= localQueueConcurrency()) {
      redispatchJobLocal(jobId);
      console.log(JSON.stringify({ step: "process-job", jobId, status: "deferred", processing }));
      res.status(200).json({ ok: false, reason: "deferred" });
      return;
    }
  }

  /* Idempotenter Claim — verhindert Doppelverarbeitung bei Task-Wiederholung. */
  const claimed = await claimJob(jobId);
  if (!claimed) {
    console.log(JSON.stringify({ step: "process-job", jobId, status: "already-claimed", jobStatus: job.status }));
    res.status(200).json({ ok: false, reason: "already_claimed" });
    return;
  }

  const start = Date.now();
  try {
    const { result, success } = await runPipeline(job);
    /* BUG-2026-08-13-35: Rückgabewert von completeJob auswerten. Er liefert
       `false`, wenn der Job nicht mehr `processing` ist (der Reaper hat ihn
       zwischenzeitlich auf `failed` gekippt, und eine CPU-gedrosselt wieder
       auflebende Fortsetzung landet hier). Vorher wurde das verworfen: das
       fertige Ergebnis ging still verloren, `incrementTotals` zählte trotzdem
       eine Analyse, und die Logzeile behauptete `status: "done"` — das Log log
       aktiv, statt zu schweigen. */
    const gespeichert = await completeJob(jobId, result);
    if (!gespeichert) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          step: "process-job",
          jobId,
          error: "ergebnis-verworfen-job-bereits-terminal",
          hinweis:
            "completeJob gab false - der Job war nicht mehr processing (Reaper/markFailedIfStale war schneller). Ergebnis wird NICHT gezaehlt.",
        })
      );
      res.status(200).json({ ok: false, reason: "already_terminal" });
      return;
    }
    if (success) {
      incrementTotals().catch((err) =>
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: err.message }))
      );
    }
    console.log(
      JSON.stringify({
        step: "process-job",
        jobId,
        traceId: job.traceId || null,
        status: success ? "done" : "blocked",
        /* OPS-2026-08-31-01: Der SPERRGRUND gehoert ins Server-Log. Vorher
           stand hier nur `status: "blocked"` — bei einem Vorfall liess sich
           die Ursache nicht mehr feststellen. Am 31.08. war sie nur deshalb
           rekonstruierbar, weil das Frontend sie als client-error
           zurueckmeldete; eine Sekunde frueher weggeklickt und sie waere fuer
           immer weg gewesen. Kein Personenbezug: einer von sieben festen
           Bezeichnern (blocked.overloaded, blocked.safetyFilter, ...).
           Bei Erfolg bleibt das Feld WEG, damit die Logsuche nach echten
           Sperren nicht von leeren Werten eingefaerbt wird. */
        ...(success ? {} : { blockedReason: result.blockedReason || null }),
        mode: result.meta.mode,
        /* Wartezeit in der Warteschlange: erstellt → Verarbeitungsbeginn.
           `start` wird unmittelbar nach dem erfolgreichen Claim gesetzt. */
        queueWaitMs: typeof job.createdAt === "number" ? start - job.createdAt : null,
        totalMs: Date.now() - start,
      })
    );
    /* FEATURE-2026-08-29-02: Die Dauer dieses Laufs fuettert die Wartezeit-
       Ansage der naechsten Besucher. NUR bei Erfolg — ein blockierter oder an
       der Uhr gestorbener Lauf sagt nichts darueber, wie lange eine Analyse
       braucht, und wuerde die Ansage verfaelschen. Bewusst ohne await: Das
       Ergebnis steht bereits, niemand soll darauf warten. */
    if (success) {
      merkeDauer((Date.now() - start) / 1000).catch(() => {});
    }
  } catch (err) {
    /* Unerwarteter Fehler → trotzdem ein sauberes, renderbares blocked-
       Ergebnis liefern (wie der synchrone Pfad). */
    console.log(
      JSON.stringify({
        step: "process-job",
        jobId,
        status: "error",
        error: err.message,
        totalMs: Date.now() - start,
      })
    );
    await completeJob(jobId, {
      profiles: null,
      blockedReason: "blocked.apiError",
      privacyRisks: [],
      exif: job.exif || {},
      meta: { traceId: job.traceId || null, mode: "blocked" },
    }).catch((e) => console.log(JSON.stringify({ warning: "completeJob-error", jobId, error: e.message })));
  } finally {
    /* Bild immer löschen — Erfolg ODER Fehler. Die Storage-Lifecycle-Regel
       ist das zweite Sicherheitsnetz. */
    await deleteImage(job.imagePath);
  }

  res.status(200).json({ ok: true });
}

module.exports = { handleProcessJob, runPipeline, _loggeMinorSafety: loggeMinorSafety };
