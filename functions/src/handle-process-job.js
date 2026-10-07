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
const { loggeMinorSafety } = require("./job-helfer");

/* Die beiden Analyse-Wege liegen in einer eigenen Datei — was hier bleibt, ist
   die Annahme des Auftrags und das Wegschreiben des Ergebnisses. */
const { runPipeline } = require("./job-pipelines");
const { incrementTotals, releaseHourlySlot, zaehlerNachtragen } = require("./counter");
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
   systematischer Ausfall (kein erkanntes Alter) erzeugte sonst exakt null
   Spuren und waere von "alles sauber" nicht zu unterscheiden. `alter: null`
   ist die wichtigste dieser Zeilen. Seit 26.09.2026 traegt die Zeile keine
   Sprache mehr (Datenschutztext) — einen Ausfall nur einer Sprache zeigt sie
   deshalb nicht mehr getrennt; nur die Alarmzeile bei harten Treffern
   (`minor-safety-durchbruch`, Betriebsprotokoll) nennt sie.

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
     `failed` (die Request-Logs mit dem 503 sind per PRIV-12 ausgeschlossen).
     Seit 01.10.2026 eine WARNUNG: Den Alarm loest das `failed` aus (jobs.js),
     sonst kaeme eine zweite Nachricht, bei falschem Verdacht eine ohne Fehler
     beim Kind. Der idempotente Claim verhindert jede Doppelverarbeitung. */
  const retryCount = Number(req.headers && req.headers["x-cloudtasks-taskretrycount"]);
  if (retryCount >= 1 && job.status === "processing") {
    console.warn(
      JSON.stringify({
        severity: "WARNING",
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
    await releaseHourlySlot(job.zaehlerStempel).catch(() => {});
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

  /* AB HIER KEINE KENNUNG IM LOG (26./27.09.2026): Ab dem Claim kann dieser
     Aufruf die Kinderschutz-Zeile schreiben (geschaetztes Alter, 30 Tage im
     Diagnose-Speicher, bewusst ohne Vorgangskennung, PRIV-2026-09-10-02).
     Zwei Wege wuerden sie trotzdem mit der Vorgangskennung verbinden — und
     darueber mit den Geraeteangaben, die der Browser unter dieser Kennung in
     Fehlermeldungen schickt:
       1. Das Label `execution_id` steht an JEDER Logzeile eines Aufrufs (die
          Laufzeit schreibt es; firebase-tools schaltet es beim Deploy ein,
          abschalten laesst es sich nicht).
       2. Die Dauern der Zeilen von Analyse und Abholung ergeben Anlage- und
          Fertigzeitpunkt des Auftrags millisekundengenau, und der
          Fertigzeitpunkt liegt Millisekunden neben der Kinderschutz-Zeile.
     Deshalb schreibt kein Aufruf mit Analyse und weder Annahme noch
     Abholung eines erfolgreichen Auftrags jobId oder traceId ins Log, auch
     keine Fehlerzeile des Aufraeumdienstes (feste Fristen). Die Dauern
     bleiben. Wie man "nie abgeholt" ohne Kennung naehert und welche Wege
     noch Kennungen tragen: docs/SECURITY-MODEL.md, Abschnitt "Erfolgsweg
     eines Auftrags ohne Kennung im Log". Pruefung (alle Ausgaben des
     jeweiligen Aufrufs): analyse-aufruf-ohne-kennung.test.js,
     handle-enqueue.test.js, handle-job-status.test.js, handle-reap.test.js. */
  /* Fehlertexte ohne Kennung (27.09.2026): Ein Firestore-Fehler zu diesem
     Auftrag kann den Dokumentpfad samt jobId nennen (etwa "No document to
     update: projects/.../jobs/<jobId>"), ein Speicherfehler den Bildpfad.
     Die Texte bleiben fuer die Fehlersuche lesbar; entfernt werden die
     bekannten Werte dieses Auftrags und jeder Firestore-Pfad. */
  const ohneKennung = (text) => {
    let t = String(text || "").replace(/projects\/[^\s'"`,)]+/g, "‹pfad›");
    for (const wert of [jobId, job.traceId, job.imagePath]) {
      if (typeof wert === "string" && wert) t = t.split(wert).join("‹kennung›");
    }
    return t;
  };
  const start = Date.now();
  /* Stundenzaehler (11.09.2026): War der Zaehler beim Einlass ausgewichen,
     traegt dieser Auftrag seine Marke jetzt selbst nach — neben der Analyse
     her und vor der Antwort abgewartet, solange die Instanz sicher rechnet
     (counter.js, "GENAU EINMAL IM FENSTER"). Wirft nie. */
  const zaehlerNachtrag = job.zaehlerNachtrag === true ? zaehlerNachtragen(job.zaehlerStempel) : null;
  try {
    const { result, success } = await runPipeline(job);
    /* BUG-2026-08-13-35: Rückgabewert von completeJob auswerten. Er liefert
       `false`, wenn der Job nicht mehr `processing` ist (der Reaper hat ihn
       zwischenzeitlich auf `failed` gekippt, und eine CPU-gedrosselt wieder
       auflebende Fortsetzung landet hier). Vorher wurde das verworfen: das
       fertige Ergebnis ging still verloren, `incrementTotals` zählte trotzdem
       eine Analyse, und die Logzeile behauptete `status: "done"` — das Log log
       aktiv, statt zu schweigen. Seit 01.10.2026 eine Warnung: Den Alarm hat
       der Wechsel auf `failed` bereits ausgeloest (jobs.js). */
    const gespeichert = await completeJob(jobId, result);
    if (!gespeichert) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          step: "process-job",
          error: "ergebnis-verworfen-job-bereits-terminal",
          hinweis:
            "completeJob gab false - der Job war nicht mehr processing (Reaper/markFailedIfStale war schneller). Ergebnis wird NICHT gezaehlt.",
        })
      );
      res.status(200).json({ ok: false, reason: "already_terminal" });
      return;
    }
    if (success) {
      await incrementTotals().catch((err) =>
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: ohneKennung(err.message) }))
      );
    }
    console.log(
      JSON.stringify({
        step: "process-job",
        status: success ? "done" : "blocked",
        /* OPS-2026-08-31-01: Der SPERRGRUND gehoert ins Server-Log. Vorher
           stand hier nur `status: "blocked"` — bei einem Vorfall liess sich
           die Ursache nicht mehr feststellen. Am 31.08. war sie nur deshalb
           rekonstruierbar, weil das Frontend sie als client-error
           zurueckmeldete; eine Sekunde frueher weggeklickt und sie waere fuer
           immer weg gewesen. Kein Personenbezug: einer von wenigen festen
           Bezeichnern (blocked.overloaded, blocked.apiError, ...).
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
       braucht, und wuerde die Ansage verfaelschen. Abgewartet wie der Zaehler
       oben (BUG-2026-10-03-29): Das Ergebnis steht schon, das Kind wartet nicht. */
    if (success) {
      await merkeDauer((Date.now() - start) / 1000).catch((e) =>
        /* BEFUND 31.08.2026: Der Fehlschlag wurde restlos verschluckt.
           Scheitert das Fortschreiben dauerhaft, bleibt die Wartezeit-Ansage
           auf einem alten Wert stehen — sichtbar fuer jeden Besucher, ohne
           dass irgendwo etwas auffaellt. */
        console.log(JSON.stringify({ warning: "merkeDauer-fehlgeschlagen", error: ohneKennung(e.message) }))
      );
    }
  } catch (err) {
    /* Unerwarteter Fehler → trotzdem ein sauberes, renderbares blocked-
       Ergebnis liefern (wie der synchrone Pfad). */
    console.log(
      JSON.stringify({
        step: "process-job",
        status: "error",
        error: ohneKennung(err.message),
        totalMs: Date.now() - start,
      })
    );
    await completeJob(jobId, {
      profiles: null,
      blockedReason: "blocked.apiError",
      privacyRisks: [],
      exif: job.exif || {},
      meta: { traceId: job.traceId || null, mode: "blocked" },
    }).catch((e) => console.log(JSON.stringify({ warning: "completeJob-error", error: ohneKennung(e.message) })));
  } finally {
    /* Bild immer löschen — Erfolg ODER Fehler. Die Storage-Lifecycle-Regel
       ist das zweite Sicherheitsnetz. */
    await deleteImage(job.imagePath);
    if (zaehlerNachtrag) await zaehlerNachtrag;
  }

  res.status(200).json({ ok: true });
}

module.exports = { handleProcessJob, runPipeline, _loggeMinorSafety: loggeMinorSafety };
