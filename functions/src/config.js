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
   Describe-Stage via Large 3 (gute Bilderkennung),
   Profile-Stage via Small 3.2 (siehe v1.10.7-Note unten),
   Mistral-internes Fallback bei Profile-Versagen: Large 3.

   Preise pro 1M Tokens (Stand 2026-05):
     - mistral-large-latest: $0.50 / $1.50  in/out
     - mistral-small-2506:   $0.15 / $0.60  in/out  (Small 3.2)
     - mistral-small-2603:   $0.15 / $0.60  in/out  (Small 4, derzeit nicht im Einsatz)

   v1.10.7 (2026-05-19): WICHTIGER Wechsel von -2603 → -2506.
   Hintergrund: Mistral hat fuer unser Konto auf -2603 (Small 4) absurd
   niedrige Limits gesetzt:
     - mistral-small-2603: 100K TPM, 1.67 RPS
     - mistral-small-2506: 5M TPM, 20.83 RPS  (50× / 12× hoeher)
   Bei nur 100K TPM (~10 Analysen pro Minute) ist Small 4 fuer unseren
   Workshop-Use-Case schlicht unbrauchbar. Small 3.2 ist offiziell
   deprecated, aber noch monatelang verfuegbar und liefert fuer unseren
   JSON-Output praktisch gleichwertige Profile bei massiv besseren Limits.

   Migration zurueck zu Small 4 macht erst Sinn, wenn Mistral die Limits
   gleichzieht ODER wir auf einen hoeheren Tarif wechseln.

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
const MISTRAL_PROFILE_MAX_TOKENS = 8000;
const MISTRAL_TIMEOUT_MS = 90000;

/* ── Globales Stundenlimit ──
   v1.10.6: Von 500 auf 1500 hochgesetzt. Mit Auto-Retries auf Client-Seite
   plus moeglichen Demo-Klicks kann ein 25er-Workshop locker 200-300
   Analysen im Stundenfenster verbrennen. 1500 laesst grosszuegig Puffer
   fuer mehrere Workshops kurz hintereinander. */
const HOURLY_LIMIT = 1500;
const HOURLY_WINDOW_MINUTES = 60;

/* BUG-003: Globales Budget pro Request — verhindert dass die Summe aller
   internen Timeouts das Cloud-Function-Limit übersteigt.
   v1.10.6: Function-Timeout ist jetzt 540s (Maximum). Budget auf 480s
   gehoben — Mistral bekommt damit auch nach langer Throttle-Queue-Wartezeit
   noch seine vollen 90s, statt nach 119s schon kein Budget mehr zu haben. */
const REQUEST_BUDGET_MS = 480000;

/* ── Queue-Architektur (v2.0) ──
   Konstanten für den Cloud-Tasks-Queue-Pfad. Werden ausschließlich von den
   neuen Queue-Functions (enqueue / processJob / jobStatus) genutzt — der
   synchrone /analyze-Pfad ist davon unberührt. Solange das Feature-Flag
   `useQueue` AUS ist, liegen diese Functions dormant. */
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
   pausiert, ohne dass der Nutzer wirklich weg ist. */
const LIVENESS_GRACE_MS = 3 * 60 * 1000;

/* Schätzwerte für die Warteschlangen-ETA im job-status-Endpoint:
   durchschnittliche Verarbeitungsdauer pro Job und Anzahl parallel
   dispatchter Jobs. Erste Näherung aus den Lasttests 2026-05-20
   (Median ~81-90s); wird in Phase 3/4 anhand echter Messungen kalibriert. */
const QUEUE_AVG_JOB_SECONDS = 90;
const QUEUE_DISPATCH_CONCURRENCY = 3;

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
  LIVENESS_GRACE_MS,
};
