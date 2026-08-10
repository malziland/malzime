"use strict";

/**
 * config.js — Konstanten für die Mistral-only Pipeline (seit v1.6.0).
 *
 * Vor v1.6.0 standen hier auch Gemini-Modelle (DESCRIBE_MODELS, PROFILE_MODELS)
 * und Vision-API-Konfiguration. Beides wurde mit dem Vision/Gemini-Cleanup
 * entfernt. Die heute aktive Pipeline nutzt ausschließlich Mistral AI.
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/* v1.10.6: RATE_LIMIT 200 → 500. Schul-WLAN teilt sich eine IP. Bei einem
   25er-Workshop mit Auto-Retries kann eine Schul-IP locker 200/10min
   ueberschreiten und alle blockieren. 500 gibt grosszuegigen Puffer. */
const RATE_LIMIT = 500;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/* ── Mistral-Modelle ──
   Describe-Stage via Large 3 = mistral-large-2512 (gute Bilderkennung),
   Profile-Stage via Small 4 = mistral-small-2603 (aktive Konstante unten),
   Mistral-internes Fallback bei Profile-Versagen: Large 3.
   Im Single-Large-Betrieb (featureFlags/current.useSingleLargeCall) laeuft
   alles ueber Large 3 — Small 4 bleibt der 3-Call-Fallback-Pfad.

   Preise pro 1M Tokens (Stand 2026-05):
     - mistral-large-2512: $0.50 / $1.50  in/out  (Large 3)
     - mistral-small-2603: $0.15 / $0.60  in/out  (Small 4)

   Verifizierte Limits (Account-Dashboard 2026-05-19):
     - mistral-small-2603: 100K TPM, 1.67 RPS  (absurd niedrig — deshalb
       Single-Large als Standard-Pfad; vor Architektur-Entscheidungen IMMER
       das Account-Dashboard pruefen, Limits variieren je Modellversion)
     - mistral-large-2512: 2M TPM, 6 RPS

   Historie: v1.10.7 (2026-05-19) wich wegen der 2603-Limits voruebergehend
   auf mistral-small-2506 (Small 3.2, 5M TPM) aus; seit der Queue-/Single-
   Large-Architektur ist 2603 wieder aktiv. 2506 wurde von Mistral zum
   31.07.2026 ZURUECKGEZOGEN (Retirement) — als Modell-Option dauerhaft tot.

   API-Key kommt aus `process.env.MISTRAL_API_KEY` (Firebase Secret). */
/* v1.10.7: Large fest auf -2512 gepinnt statt -latest-Alias. Hintergrund:
   Mistral koennte das -latest-Alias jederzeit auf eine neuere Version
   umlenken (z.B. ein hypothetisches Large -2603), die wie das aktuelle
   Small-2603 mit brutalen Limits ausgestattet sein koennte. Mit dem Pin
   kontrollieren wir Versions-Wechsel selbst.
   Verifizierte Limits -2512 (Account-Dashboard 2026-05-19): 6 RPS, 2M TPM. */
const MISTRAL_DESCRIBE_MODEL = "mistral-large-2512";
const MISTRAL_PROFILE_MODEL = "mistral-small-2603";
const MISTRAL_FALLBACK_MODEL = "mistral-large-2512";
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODELS_ENDPOINT = "https://api.mistral.ai/v1/models";
const MISTRAL_DESCRIBE_MAX_TOKENS = 2048;
/* v2.1 (2026-05-23 nachmittags): 12000 → 16000. Hintergrund: Beim ersten
   v2.1-Live-Test schnitt Beast mehrere Karten mit "..." mitten im Wort ab,
   weil Mistral trotz Variante-B-Längenvorgabe ausführlich schrieb. 16000
   gibt ausreichend Puffer für die jetzt strengeren Beast-Schema-Beispiele
   (siehe jsonSchemaBoost) bei trotzdem disziplinierterem Modell-Verhalten
   (Temperatur Beast wurde von 1.0 → 0.8 in mistral.js). Kostenneutral,
   da Mistral nur tatsächlich generierte Tokens berechnet. */
const MISTRAL_PROFILE_MAX_TOKENS = 16000;
const MISTRAL_TIMEOUT_MS = 90000;

/* ── Globales Stundenlimit ──
   500 Analysen pro rollendem 60-Minuten-Fenster — der gewuenschte Betriebswert
   (kostenstabil beim aktuellen Budget). Mit Auto-Retries auf Client-Seite plus
   Demo-Klicks verbraucht ein 25er-Workshop rund 200-300 Analysen/Stunde, 500
   laesst dafuer Puffer.

   WICHTIG: Der LIVE durchgesetzte Wert steht in Firestore `stats/current.limit`
   und wird dort gelesen (counter.js). Diese Konstante ist (a) der Fallback bei
   fehlendem Feld und (b) der Wert, auf den `resetHourly` das Dokument setzt.
   Beide muessen zum Live-Wert passen — sonst kippt ein Admin-Reset das Limit
   ungewollt. Bei Aenderung IMMER auch `stats/current.limit` mitziehen. */
const HOURLY_LIMIT = 500;
const HOURLY_WINDOW_MINUTES = 60;

/* BUG-003: Globales Budget pro Request — verhindert dass die Summe aller
   internen Timeouts das Cloud-Function-Limit übersteigt.
   v1.10.6: Function-Timeout ist jetzt 540s (Maximum). Budget auf 480s
   gehoben — Mistral bekommt damit auch nach langer Throttle-Queue-Wartezeit
   noch seine vollen 90s, statt nach 119s schon kein Budget mehr zu haben. */
const REQUEST_BUDGET_MS = 480000;

/* ── Queue-Architektur (v2.0) ──
   Konstanten für den Cloud-Tasks-Queue-Pfad. Seit v2.10 ist die Queue der
   einzige Weg — der synchrone /analyze-Pfad ist abgebaut. */
const QUEUE_NAME = "analyze-queue";
const QUEUE_REGION = "europe-west1";
/* Firebase-Function-Name des Workers — Cloud Tasks dispatcht an dessen URL. */
const PROCESS_JOB_FUNCTION = "processJob";
/* Dedizierter Cloud-Storage-Bucket für die temporäre Bild-Ablage der Queue.
   Eigener Bucket (kein Firebase-Storage-Default-Bucket) — auf ihn greift nur
   der Server via Admin-SDK zu, nie ein Browser. Per QUEUE_BUCKET-env
   überschreibbar (z.B. für den Storage-Emulator). */
const QUEUE_BUCKET = process.env.QUEUE_BUCKET || "malzime-queue-uploads";
/* Storage-Prefix innerhalb des Buckets. Eine GCS-Lifecycle-Regel löscht
   alles unter diesem Prefix nach 1 Tag (Sicherheitsnetz; die aktive Löschung
   in processJob greift sofort nach der Verarbeitung). */
const QUEUE_UPLOAD_PREFIX = "queue-uploads/";
/* Karenz-Fenster der Client-Liveness: Aktualisiert der Browser eines
   wartenden Jobs länger als das hier seinen Herzschlag nicht (job-status
   schreibt bei jedem Poll `lastSeenAt`), gilt der Client als weg → der Job
   wird `abandoned` und kostet keinen Mistral-Call. Großzügig bemessen, weil
   iOS Tabs beim App-Wechsel/Display-Sperren einfriert und das Pollen
   pausiert, ohne dass der Nutzer wirklich weg ist.

   UX-001 (Audit 2026-06): von 3 auf 8 Minuten angehoben. Im Workshop legen
   Schüler:innen das Handy oft länger weg (Pause, App-Wechsel, Display-Sperre);
   3 Min waren zu knapp und ließen Jobs sterben, obwohl der Nutzer nur kurz weg
   war. 8 Min deckt realistische Abwesenheiten ab. Kostenneutral — ein
   abandoned Job macht ohnehin keinen Mistral-Call; es wird nur der Bild-
   Zwischenspeicher + der Warteschlangen-Platz etwas länger gehalten. */
const LIVENESS_GRACE_MS = 8 * 60 * 1000;

/* Schätzwerte für die Warteschlangen-ETA im job-status-Endpoint:
   durchschnittliche Verarbeitungsdauer pro Job und Anzahl parallel
   dispatchter Jobs. BEWUSST leicht großzügig — die ETA soll lieber über-
   als unterschätzen, damit Wartende nicht enttäuscht werden.
   QUEUE_DISPATCH_CONCURRENCY muss dem `maxConcurrentDispatches` der echten
   Cloud-Tasks-Queue entsprechen, sonst geht die ETA daneben.

   v2.2.0-rc1 (2026-05-23 abends): von 100s/3 auf 65s/10 angepasst nach
   Lasttest mit Single-Large-Pipeline + Cloud-Tasks-Concurrency 10. Reale
   Messung (35 Jobs): Median 58s/Job, P95 65s. Concurrency wurde via
   `scripts/cloudtasks-concurrency-10.sh` auf 10 gesetzt. Falls Flag
   `useSingleLargeCall` wieder deaktiviert wird, muessen beide Werte
   zurueck (100 / 3) — und die Cloud-Tasks-Queue per
   `scripts/cloudtasks-concurrency-3.sh` ebenfalls.

   v2.8.0 (2026-08-10): Concurrency von 10 auf 7 gesenkt. Seit v2.8 braucht
   jede Analyse ZWEI Mistral-Aufrufe (Bildanalyse + Beast-Werbung), und
   mistral-large-2512 erlaubt nur 15 Anfragen pro Minute — an der API
   gemessen, die aeltere Annahme "6 Anfragen pro Sekunde" ist ueberholt.
   Bei Concurrency 10 waeren es 22 Anfragen/min und damit 429-Fehler.
   Die Queue muss per `scripts/cloudtasks-concurrency-7.sh` mitgezogen werden.
   QUEUE_AVG_JOB_SECONDS bleibt bewusst bei 65, obwohl real 56 gemessen —
   die ETA soll ueberschaetzen, und der zweite Aufruf kostet 1-2 Sekunden. */
const QUEUE_AVG_JOB_SECONDS = 65;
const QUEUE_DISPATCH_CONCURRENCY = 7;

/* ARCH-001 (Audit 2026-08-10): Obergrenze der Warteschlangen-Tiefe beim Einlass.
   Der Browser gibt nach 30 Minuten auf (MAX_POLL_DURATION_MS in api.js). Bei
   7 parallel und ~65 s je Analyse sind in 30 Minuten rund 190 Jobs zu schaffen
   — wer dahinter einreiht, sieht garantiert einen Timeout, obwohl sein Job
   noch lebt und Geld kostet. Deshalb wird ab dieser Schwelle ehrlich abgelehnt
   statt einen aussichtslosen Auftrag anzunehmen.

   Bewusst NICHT das Stundenlimit gesenkt: Ein Vormittag kann 1000-2000
   Analysen bedeuten, ein niedrigeres Limit wuerde einem laufenden Workshop den
   Hahn zudrehen. Die Tiefenpruefung bremst nur dann, wenn es ohnehin nicht mehr
   aufgeht — und sie loest sich von selbst wieder auf.
   Mit 20 % Sicherheitsabstand unter der rechnerischen Grenze. */
const MAX_QUEUE_DEPTH = Math.floor(((30 * 60) / QUEUE_AVG_JOB_SECONDS) * QUEUE_DISPATCH_CONCURRENCY * 0.8);

/* Aufbewahrungsfenster der Job-Dokumente. Ein Job-Dokument enthält bis zum
   Abschluss das fertige Profil im Feld `result`; danach wird es nicht mehr
   gebraucht (der Client hat es längst abgeholt). Der Reaper löscht jedes
   Job-Dokument, das älter als das hier ist — Datensparsamkeit, damit nichts
   unbegrenzt liegen bleibt.

   PRIV-004 (Audit 2026-06): von 24 h auf 2 h gesenkt. Das Job-Dokument enthält
   das fertige Profil einer (oft minderjährigen) Person — Datensparsamkeit
   verlangt, es nicht länger als nötig zu halten. Ein realer Job lebt Sekunden
   bis Minuten; 2 h decken jedes realistische Reload-/Abhol-Fenster großzügig ab
   (Poll dauert Minuten, Reload-Wiederaufnahme Sekunden), reduzieren die
   Aufbewahrung der abgeleiteten Profile aber um das 12-fache. */
const JOB_RETENTION_MS = 2 * 60 * 60 * 1000;

/* Lokal-Modus für den Firebase-Emulator (Phase 3): Da es für Google Cloud
   Tasks keinen Emulator gibt, werden im Lokal-Modus Cloud Tasks und der
   GCS-Bucket durch lokale Ersatz-Implementierungen abgelöst (direkter HTTP-
   Dispatch bzw. Dateisystem-Ablage). Aktiv per QUEUE_LOCAL=1 — ausschließlich
   für lokalen Durchklick/Lasttest, NIE in Produktion gesetzt. Zur Laufzeit
   gelesen, damit Tests es pro Fall setzen können. */
function isLocalQueueMode() {
  return process.env.QUEUE_LOCAL === "1";
}

/* Drosselung des lokalen Cloud-Tasks-Ersatzes: so viele Jobs gleichzeitig in
   `processing`. Im Lokal-Modus übernimmt processJob die Drosselung (Cloud
   Tasks gibt es im Emulator nicht). Niedrig halten, damit sich im Durchklick
   eine sichtbare Warteschlange staut. Nur im Lokal-Modus relevant. */
function localQueueConcurrency() {
  return Math.max(1, Number(process.env.QUEUE_LOCAL_CONCURRENCY) || 3);
}

/* Laufzeit-Validierung — fehlerhafte Config crasht sofort statt leise falsch zu laufen */
if (HOURLY_LIMIT < 1) throw new Error("Config: HOURLY_LIMIT must be >= 1");
if (RATE_LIMIT < 1) throw new Error("Config: RATE_LIMIT must be >= 1");
if (MAX_UPLOAD_BYTES < 1) throw new Error("Config: MAX_UPLOAD_BYTES must be >= 1");
if (MISTRAL_PROFILE_MAX_TOKENS < 1) throw new Error("Config: MISTRAL_PROFILE_MAX_TOKENS must be >= 1");

module.exports = {
  MAX_UPLOAD_BYTES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  ALLOWED_MIME,
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_MODELS_ENDPOINT,
  MISTRAL_DESCRIBE_MAX_TOKENS,
  MISTRAL_PROFILE_MAX_TOKENS,
  MISTRAL_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
  HOURLY_LIMIT,
  HOURLY_WINDOW_MINUTES,
  QUEUE_NAME,
  QUEUE_REGION,
  PROCESS_JOB_FUNCTION,
  QUEUE_BUCKET,
  QUEUE_UPLOAD_PREFIX,
  QUEUE_AVG_JOB_SECONDS,
  QUEUE_DISPATCH_CONCURRENCY,
  MAX_QUEUE_DEPTH,
  JOB_RETENTION_MS,
  LIVENESS_GRACE_MS,
  isLocalQueueMode,
  localQueueConcurrency,
};
