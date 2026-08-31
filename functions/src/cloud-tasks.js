"use strict";

/**
 * cloud-tasks.js — dünner Wrapper um Google Cloud Tasks.
 *
 * Reiht Analyse-Jobs in die Queue `analyze-queue` ein. Cloud Tasks dispatcht
 * sie anschließend dosiert an die `processJob`-Function. Genau diese Drossel
 * verhindert die 429er strukturell: Mistral sieht nie mehr als N parallele
 * Calls, und sie wirkt GLOBAL — anders als `throttle.js`, das nur im
 * Arbeitsspeicher einer einzelnen Instanz zählt.
 *
 * SEIT 30.08.2026 kommen die Dosier-Parameter aus dem Einstellungssatz:
 * `parallelitaet` -> maxConcurrentDispatches, `queueRatePerSekunde` ->
 * maxDispatchesPerSecond. `warteschlangeNachziehen()` überträgt sie; die
 * `satzWache` ruft das bei jeder Änderung auf. Vorher standen sie nur in der
 * Queue-Definition und waren ausschließlich per gcloud-Befehl änderbar —
 * also nicht im laufenden Betrieb.
 *
 * Authentifizierung: Jeder Task trägt ein OIDC-Token eines Service-Accounts.
 * `processJob` akzeptiert nur Aufrufe mit gültigem Token — damit ist der
 * Worker nicht öffentlich anstoßbar.
 *
 * Der CloudTasksClient wird lazy erzeugt (erst beim ersten Einreihen) und
 * ist über `setClientForTest()` für Unit-Tests ersetzbar — so braucht kein
 * Test echte GCP-Credentials.
 */

const { QUEUE_NAME, QUEUE_REGION, PROCESS_JOB_FUNCTION, isLocalQueueMode } = require("./config");

let client = null;
let clientOverride = null;

function getClient() {
  if (clientOverride) return clientOverride;
  if (!client) {
    /* Lazy require: das SDK wird nur geladen, wenn der Queue-Pfad aktiv ist. */
    const { CloudTasksClient } = require("@google-cloud/tasks");
    client = new CloudTasksClient();
  }
  return client;
}

/* Cloud Functions / Cloud Run setzen GCLOUD_PROJECT bzw. GCP_PROJECT. */
function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
}

/* Stabile Alias-URL der Worker-Function. */
function processJobUrl() {
  return `https://${QUEUE_REGION}-${projectId()}.cloudfunctions.net/${PROCESS_JOB_FUNCTION}`;
}

/* Service-Account, mit dem Cloud Tasks das OIDC-Token signiert. Standard ist
   der App-Engine-Default-SA; per QUEUE_INVOKER_SA überschreibbar, falls das
   Projekt einen anderen Runtime-SA nutzt. Dieser SA braucht die Rolle
   "Cloud Functions Invoker" auf processJob (IAM-Setup, Deploy-Schritt). */
function invokerServiceAccount() {
  return process.env.QUEUE_INVOKER_SA || `${projectId()}@appspot.gserviceaccount.com`;
}

/**
 * Reiht einen Job in die Cloud-Tasks-Queue ein. Cloud Tasks ruft danach
 * `processJob` mit `{ jobId }` im Body auf.
 *
 * @param {string} jobId  Firestore-Job-ID (aus jobs.createJob)
 * @returns {Promise<string>} der von Cloud Tasks vergebene Task-Name
 */
async function enqueueJob(jobId) {
  /* Lokal-Modus (Emulator): Es gibt keinen Cloud-Tasks-Emulator — daher
     processJob direkt anstoßen statt einen echten Task zu erzeugen. */
  if (isLocalQueueMode()) return enqueueJobLocal(jobId);

  const c = getClient();
  const parent = c.queuePath(projectId(), QUEUE_REGION, QUEUE_NAME);
  const url = processJobUrl();
  const task = {
    httpRequest: {
      httpMethod: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ jobId })),
      oidcToken: {
        serviceAccountEmail: invokerServiceAccount(),
        audience: url,
      },
    },
  };
  const [created] = await c.createTask({ parent, task });
  return created.name;
}

/* URL der processJob-Function im laufenden Firebase-Emulator. */
function localProcessJobUrl() {
  if (process.env.QUEUE_LOCAL_PROCESS_URL) return process.env.QUEUE_LOCAL_PROCESS_URL;
  const port = process.env.FUNCTIONS_EMULATOR_PORT || "5001";
  return `http://127.0.0.1:${port}/${projectId() || "malzime"}/${QUEUE_REGION}/processJob`;
}

/* Stößt processJob lokal per HTTP an (Emulator). */
function dispatchLocal(jobId) {
  fetch(localProcessJobUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    console.log(JSON.stringify({ warning: "local-dispatch-failed", jobId, error: err.message }));
  });
}

/**
 * Lokaler Cloud-Tasks-Ersatz: stößt processJob direkt per HTTP an. Fire-and-
 * forget — enqueue wartet NICHT auf die Verarbeitung, genau wie beim echten
 * Cloud-Tasks-Dispatch. Nur aktiv bei QUEUE_LOCAL=1.
 *
 * Die Drosselung (maxConcurrentDispatches bei echtem Cloud Tasks) übernimmt
 * im Lokal-Modus processJob selbst: Es zählt vor der Verarbeitung die laufenden
 * Jobs in Firestore und vertagt sich via `redispatchJobLocal`, wenn die Grenze
 * erreicht ist. Firestore ist die prozess-übergreifende Wahrheit — nötig, weil
 * der Emulator mehrere Worker-Prozesse fährt (Modul-Variablen sind nicht
 * geteilt). Siehe handle-process-job.js.
 */
function enqueueJobLocal(jobId) {
  dispatchLocal(jobId);
  return Promise.resolve(`local-dispatch/${jobId}`);
}

/* Verzögerung, nach der ein vertagter Job erneut angestoßen wird. */
const LOCAL_REDISPATCH_MS = 2500;

/**
 * Stößt einen vertagten Job (Lokal-Modus, Drossel war voll) nach kurzer
 * Verzögerung erneut an. So lange wiederholt, bis ein Slot frei ist.
 */
function redispatchJobLocal(jobId) {
  setTimeout(() => dispatchLocal(jobId), LOCAL_REDISPATCH_MS);
}

/**
 * Überträgt die Dosierung aus dem Einstellungssatz in die echte Queue.
 *
 * Wird von der `satzWache` bei jeder Änderung an `config/betriebsprofil`
 * aufgerufen. Damit ist der Firestore-Wert die einzige Quelle: Wer ihn ändert,
 * ändert die laufende Drossel — ohne Deploy, ohne gcloud, ohne mich.
 *
 * Rückgabe beschreibt, was passiert ist; die Wache meldet es weiter.
 * Wirft nie — ein Fehler hier darf den Einstellungssatz nicht blockieren.
 */
async function warteschlangeNachziehen({ parallelitaet, queueRatePerSekunde }) {
  try {
    /* ── RIEGEL: NIEMALS aus einem Test heraus die echte Queue anfassen ──
     *
     * VORFALL 30./31.08.2026: In der Nacht hat ein Testlauf die
     * PRODUKTIONS-Warteschlange umgestellt — dreimal, auf 7/0,5 und 14/0,5.
     * Das sind die Werte aus `test-satz.js`. Zehn Stunden lang lief die
     * Auslieferung damit auf vierfachem Tempo gegen Mistrals Grenze; am
     * Morgen kamen die ersten Ueberlastmeldungen bei echten Nutzern an.
     *
     * Der einzelne Test, der die Attrappe vergass, ist austauschbar — der
     * Riegel hier ist es nicht. Er greift fuer JEDEN Pfad, auch fuer den, den
     * morgen jemand neu schreibt.
     *
     * `JEST_WORKER_ID` setzt Jest in jedem Arbeitsprozess. Wer die Funktion
     * im Test wirklich pruefen will, ersetzt den Client ueber
     * `setClientForTest()` — dann laeuft sie gegen die Attrappe weiter. */
    if (process.env.JEST_WORKER_ID !== undefined && !clientOverride) {
      return {
        ok: false,
        grund:
          "Aufruf aus einem Test ohne Attrappe — die echte Warteschlange " +
          "wird nicht angefasst. setClientForTest() verwenden.",
      };
    }
    /* OPS-2026-08-31-05: Der Jest-Riegel allein genuegt nicht. Der Lasttest
     * faehrt den Firebase-Emulator und laesst darin die ECHTEN Funktionen
     * laufen — Jest laeuft dabei nicht, der Emulator holt sich bei
     * angemeldetem Konto aber die Produktions-Zugangsdaten. Auf genau diesem
     * Weg lagen am 31.08. 4.056 Testbilder im echten Bildspeicher
     * (`queue-storage.js` hat denselben Riegel bekommen).
     *
     * Eine Warteschlange gibt es im Emulator ohnehin nicht: Der Lokal-Modus
     * ersetzt Cloud Tasks durch eigenen Dispatch. Wer hier landet, wollte den
     * echten Dienst — aus einer Umgebung, die ihn nicht anfassen darf. */
    const emulator =
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FUNCTIONS_EMULATOR ||
      process.env.CLOUD_TASKS_EMULATOR_HOST;
    if (emulator && !clientOverride) {
      return {
        ok: false,
        grund:
          "Es laeuft ein Emulator — die echte Warteschlange wird nicht " +
          "angefasst. Im Lokal-Modus ersetzt eigener Dispatch die Cloud Tasks.",
      };
    }

    const projekt = projectId();
    if (!projekt) return { ok: false, grund: "kein Projekt bekannt" };

    const c = getClient();
    const name = c.queuePath(projekt, QUEUE_REGION, QUEUE_NAME);

    /* Erst lesen: Steht der Wert schon richtig, wird nicht geschrieben. Das
       spart Schreibvorgaenge und macht die Meldung ehrlich ("unveraendert"). */
    const [vorher] = await c.getQueue({ name });
    const istRate = Number(vorher.rateLimits?.maxDispatchesPerSecond);
    const istParallel = Number(vorher.rateLimits?.maxConcurrentDispatches);

    if (istRate === queueRatePerSekunde && istParallel === parallelitaet) {
      return { ok: true, geaendert: false, rate: istRate, parallel: istParallel };
    }

    const [nachher] = await c.updateQueue({
      queue: {
        name,
        rateLimits: {
          maxDispatchesPerSecond: queueRatePerSekunde,
          maxConcurrentDispatches: parallelitaet,
        },
      },
      updateMask: {
        paths: ["rate_limits.max_dispatches_per_second", "rate_limits.max_concurrent_dispatches"],
      },
    });

    /* NACHMESSEN statt annehmen: Google meldet den tatsaechlich gesetzten
       Stand zurueck. Weicht er ab, steht das in der Meldung. */
    return {
      ok: true,
      geaendert: true,
      vorherRate: istRate,
      vorherParallel: istParallel,
      rate: Number(nachher.rateLimits?.maxDispatchesPerSecond),
      parallel: Number(nachher.rateLimits?.maxConcurrentDispatches),
    };
  } catch (err) {
    return { ok: false, grund: err?.message || String(err) };
  }
}

/* Nur für Tests — ersetzt den CloudTasksClient durch eine Attrappe. */
function setClientForTest(impl) {
  clientOverride = impl;
}

module.exports = {
  enqueueJob,
  redispatchJobLocal,
  processJobUrl,
  invokerServiceAccount,
  setClientForTest,
  warteschlangeNachziehen,
};
