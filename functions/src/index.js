const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret } = require("firebase-functions/params");

const { FIRESTORE_DATABASE_ID } = require("./config");
const { handleStats } = require("./handle-stats");
const { handleAdmin } = require("./handle-admin");
const { handleErrors } = require("./handle-errors");
const { handleTelemetry } = require("./handle-telemetry");
const { handleEnqueue } = require("./handle-enqueue");
/* Nur fuer die satzWache: Sie ueberträgt die Dosierung aus dem Einstellungssatz
   in die echte Cloud-Tasks-Queue. */
const { warteschlangeNachziehen } = require("./cloud-tasks");
const { handleProcessJob } = require("./handle-process-job");
const { handleJobStatus } = require("./handle-job-status");
const { reapJobs } = require("./handle-reap");
const { pruefeZusagen } = require("./handle-erinnerung");
const { pruefeLaufzeit } = require("./laufzeit-wache");
const { pruefeKapazitaet } = require("./kapazitaets-wache");
const { geltendeWerte, _cacheLeeren } = require("./betriebsprofil");
const { sendeNtfy } = require("./notify");
const { ALLOWED_ORIGINS } = require("./domains");

const adminSecret = defineSecret("ADMIN_SECRET");
const ntfyUrl = defineSecret("NTFY_URL");
const ntfyTopic = defineSecret("NTFY_TOPIC");
/* Mistral AI API-Key — Pflicht seit v1.6.0 (Mistral-only Pipeline).
   Wird via process.env.MISTRAL_API_KEY von mistral.js gelesen. Firebase
   injiziert das Secret automatisch als env-Var wenn es in `secrets`
   deklariert ist. Wenn das Secret fehlt, schlagen alle Analyse-Calls
   mit code "no_api_key" fehl. */
const mistralApiKey = defineSecret("MISTRAL_API_KEY");

initializeApp();

exports.stats = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 5,
  },
  handleStats
);

exports.admin = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 2,
    secrets: [adminSecret],
  },
  (req, res) => handleAdmin(req, res, { adminSecret })
);

exports.errors = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 3,
    timeoutSeconds: 10,
  },
  handleErrors
);

exports.telemetry = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 3,
    timeoutSeconds: 10,
  },
  handleTelemetry
);

/* ── Queue-Architektur ──
   Der einzige Weg: Jeder Upload laeuft ueber diese Functions. Der frueher
   frueher vorhandene synchrone Rueckfall ist mit v2.10 ersatzlos abgebaut;
   als Betriebshebel dient jetzt der Wartungsmodus (docs/RUNBOOK.md, Hebel 1).
   Siehe docs/ARCHITECTURE.md. */

/* enqueue — public Annahme-Endpoint: validiert, speichert das Bild,
   legt den Job an und reiht ihn in Cloud Tasks ein. */
exports.enqueue = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 60,
    secrets: [ntfyUrl, ntfyTopic, adminSecret],
  },
  (req, res) => handleEnqueue(req, res, { ntfyUrl, ntfyTopic, adminSecret })
);

/* processJob — Worker, NICHT public. Nur Cloud Tasks ruft ihn auf:
   invoker "private" → Cloud Run verlangt Authentifizierung; der Cloud-
   Tasks-Service-Account erhaelt beim Deploy die Invoker-Rolle. concurrency
   1 = ein Job pro Instanz, die Dosierung uebernimmt die Cloud-Tasks-Queue.
   MISTRAL_API_KEY wird als Secret injiziert (mistral.js liest die env-Var). */
exports.processJob = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    invoker: "private",
    concurrency: 1,
    maxInstances: 10,
    timeoutSeconds: 540,
    secrets: [mistralApiKey],
  },
  handleProcessJob
);

/* jobStatus — public, leichtgewichtiger Polling-Endpoint fuer den Client.
   Jeder Poll ist zugleich der Liveness-Herzschlag des wartenden Jobs.
   memory 256MiB: 128MiB hatte keinen Puffer ueber dem firebase-admin-
   Grundbedarf — beim Workshop 2026-05-21 ein OOM unter Poll-Last. */
exports.jobStatus = onRequest(
  {
    region: "europe-west1",
    memory: "256MiB",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
    maxInstances: 10,
    timeoutSeconds: 10,
  },
  handleJobStatus
);

/* reapJobs — geplanter Lauf (jede Minute): markiert wartende Jobs, deren
   Client nicht mehr pollt, als `abandoned`, gibt ihren Warteschlangen-Platz
   frei und loescht ihr Bild. Siehe handle-reap.js. Laeuft auch, wenn die
   */
exports.reapJobs = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 1 minutes",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  () => reapJobs()
);

/* erinnerung — geplanter Lauf (montags 9 Uhr Wien): schickt einen ntfy-Push,
   wenn die halbjaehrliche ZDR-Nachpruefung binnen einer Woche faellig wird.
   Freundliche Vorwarnung VOR der harten CI-Bremse (zusagen-frische.test.js).
   Siehe handle-erinnerung.js. */
exports.erinnerung = onSchedule(
  {
    region: "europe-west1",
    schedule: "every monday 09:00",
    timeZone: "Europe/Vienna",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [ntfyUrl, ntfyTopic],
  },
  () => pruefeZusagen({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value() })
);

/* FEATURE-2026-08-29-03: Laufzeit-Wache.

   BEWUSST EIGENER ZEITPLAN, nicht an `erinnerung` angehaengt: Die laeuft nur
   montags. Eine Verlangsamung, die am Dienstag beginnt, waere sechs Tage lang
   unsichtbar — genau der Fehler, den diese Wache verhindern soll. Der Einbruch
   vom 26.08. wurde zwei Tage lang nicht bemerkt und traf dann eine laufende
   Presse-Aussendung.

   07:20, damit ein Befund vor dem Schulvormittag auf dem Telefon liegt. Nicht
   zur vollen oder halben Stunde — dort draengen sich alle Zeitplaene. */
exports.laufzeitWache = onSchedule(
  {
    region: "europe-west1",
    schedule: "every day 07:20",
    timeZone: "Europe/Vienna",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [ntfyUrl, ntfyTopic],
  },
  async () => {
    const ergebnis = await pruefeLaufzeit({
      melder: (text) => sendeNtfy({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value(), text }),
    });
    /* Auch der unauffaellige Lauf wird protokolliert — sonst laesst sich nicht
       unterscheiden, ob die Wache "in Ordnung" meldet oder gar nicht lief
       (KERN 4: ein stiller Ausfall darf nie wie ein Bestehen aussehen). */
    console.log(JSON.stringify({ step: "laufzeit-wache", ...ergebnis }));

    /* Zweite Pruefung im selben taeglichen Lauf: Stimmen Code und echte
       Warteschlange noch ueberein?

       BEWUSST KEINE EIGENE FUNCTION. Am 29.08. hat der Infrastruktur-Waechter
       eine Auslieferung gestoppt, weil die neu angelegte `laufzeitWache` nicht
       im Filter der Fehler-Alarmierung stand — jede neue Function zieht diese
       Nacharbeit nach sich. Zwei fachlich verwandte Tagespruefungen in einer
       Function ersparen sie, und der Zeitpunkt ist ohnehin derselbe.

       Ein Fehler hier darf die Laufzeit-Pruefung nicht nachtraeglich
       entwerten — sie ist oben bereits gelaufen und protokolliert. */
    /* Zuerst der Einstellungssatz: Ohne ihn laeuft keine einzige Analyse.
       Die Alarmierung ueber den Analyse-Pfad greift erst, WENN jemand es
       versucht — liegt der Fehler nachts vor, erfaehrt es niemand bis zum
       ersten Nutzer am Morgen. Diese Pruefung um 7:20 findet ihn vorher. */
    try {
      const { werte, quelle, profil, grund } = await geltendeWerte();
      if (!werte) {
        const text =
          `KEIN gueltiger Einstellungssatz — es laeuft derzeit KEINE Analyse. ` +
          `Grund: ${grund || "unbekannt"}. Firestore-Dokument config/betriebsprofil pruefen.`;
        await sendeNtfy({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value(), text });
        console.error(JSON.stringify({ step: "betriebsprofil-wache", status: "kein-satz", grund }));
      } else {
        console.log(JSON.stringify({ step: "betriebsprofil-wache", status: "ok", quelle, profil }));
      }
    } catch (fehler) {
      console.error(JSON.stringify({ step: "betriebsprofil-wache", status: "fehler", grund: String(fehler.message) }));
    }

    try {
      const kapazitaet = await pruefeKapazitaet();
      if (kapazitaet.auffaellig && kapazitaet.meldung) {
        await sendeNtfy({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value(), text: kapazitaet.meldung });
      }
      console.log(JSON.stringify({ step: "kapazitaets-wache", ...kapazitaet }));
    } catch (fehler) {
      console.error(JSON.stringify({ step: "kapazitaets-wache", status: "fehler", grund: String(fehler.message) }));
    }
  }
);

/* ── Wache am Einstellungssatz ────────────────────────────────────────────
   ANLASS (Nutzer, 30.08.2026): „Die Meldung soll kommen, wenn der Fehler
   passiert, oder nicht irgendwann danach."

   Die Alarmierung ueber den Analyse-Pfad greift erst, WENN jemand eine Analyse
   versucht. Wird der Satz nachts kaputt gemacht, erfaehrt es niemand bis zum
   ersten Nutzer am Morgen — der dann eine Fehlermeldung sieht, die wir haetten
   verhindern koennen.

   Dieser Ausloeser haengt am Dokument selbst und feuert in dem Moment, in dem
   es geschrieben wird. Er prueft den neuen Stand mit derselben Rechnung wie der
   Analyse-Pfad und meldet sofort, wenn daraus keine Analyse mehr laufen wuerde.

   BEWUSST AUCH BEI ERFOLG EINE MELDUNG: Wer eine Einstellung aendert, will
   wissen, ob sie angekommen ist. Eine Umstellung, die stillschweigend abgelehnt
   wird, ist die gefaehrlichste Form des Fehlschlags. */
exports.satzWache = onDocumentWritten(
  {
    document: "config/betriebsprofil",
    /* WELCHE Datenbank — ohne diese Angabe nimmt Firebase die Standard-
       Datenbank "(default)". Die gibt es hier nicht: Seit dem Umzug nach
       Europa (PRIV-001) heisst sie "malzime-eu".

       BEFUND 30.08.2026: Genau daran ist der v4.4-Deploy DREIMAL gescheitert,
       mit einer Meldung, die den Trigger nicht erwaehnt:
         Error: Request to .../databases/(default) had HTTP Error: 404
       Ich habe den Fehler zuerst beim Deploy-Ziel gesucht (firestore:rules)
       und dort auch etwas gefunden — aber die Ursache lag hier. Erst als der
       Deploy OHNE jedes Firestore-Ziel denselben Fehler warf, war klar, dass
       es an einer Function liegen muss. Und die einzige neue mit
       Firestore-Bezug ist diese. */
    database: FIRESTORE_DATABASE_ID,
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [ntfyUrl, ntfyTopic],
  },
  async () => {
    /* Der Zwischenspeicher haelt den alten Stand bis zu 30 Sekunden — hier
       interessiert der NEUE, also frisch lesen. */
    _cacheLeeren();
    const { werte, quelle, profil, grund } = await geltendeWerte();

    if (!werte) {
      const text =
        `ACHTUNG: Der Einstellungssatz wurde geaendert und ist UNGUELTIG — ` +
        `es laeuft ab sofort KEINE Analyse. Grund: ${grund || "unbekannt"}. ` +
        `Rueckweg: das Feld "aktiv" auf einen gueltigen Satz stellen.`;
      await sendeNtfy({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value(), text });
      console.error(JSON.stringify({ step: "satz-wache", status: "ungueltig", grund }));
      return;
    }

    /* Die Warteschlange bei Google nachziehen. Sie ist die GLOBALE Bremse gegen
       das Mistral-Limit; ohne diesen Schritt beschriebe der Einstellungssatz
       nur, was gelten soll, und die echte Drossel bliebe stehen.

       Absichtlich NACH der Gueltigkeitspruefung: Ein ungueltiger Satz darf die
       laufende Queue nicht anfassen. */
    const queue = await warteschlangeNachziehen({
      parallelitaet: werte.parallelitaet,
      queueRatePerSekunde: werte.queueRatePerSekunde,
    });

    let queueSatz;
    if (!queue.ok) {
      /* Der gefaehrliche Fall: Der Satz sagt etwas anderes als die Queue tut.
         Deshalb ausdruecklich als ACHTUNG und als console.error — nicht
         stillschweigend. */
      queueSatz =
        ` ACHTUNG: Die Warteschlange konnte NICHT nachgezogen werden ` +
        `(${queue.grund}) — sie laeuft mit dem alten Tempo weiter.`;
      console.error(JSON.stringify({ step: "satz-wache", status: "queue-nicht-gesetzt", grund: queue.grund }));
    } else if (queue.geaendert) {
      queueSatz =
        ` Warteschlange nachgezogen: ${queue.parallel} gleichzeitig, ` +
        `${queue.rate}/s (vorher ${queue.vorherParallel} / ${queue.vorherRate}/s).`;
    } else {
      queueSatz = ` Warteschlange stand bereits richtig (${queue.parallel} / ${queue.rate}/s).`;
    }

    const text =
      `Einstellungssatz geaendert und uebernommen: "${profil}". ` +
      `Zeitgrenze ${Math.round(werte.singleLargeTimeoutMs / 1000)} s, ` +
      `${werte.singleLargeMaxTokens} Token, ${werte.parallelitaet} parallel, ` +
      `${werte.stundenlimit} pro Stunde.` +
      queueSatz;
    await sendeNtfy({ ntfyUrl: ntfyUrl.value(), ntfyTopic: ntfyTopic.value(), text });
    console.log(JSON.stringify({ step: "satz-wache", status: "uebernommen", quelle, profil, queue }));
  }
);
