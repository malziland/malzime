"use strict";

/**
 * config.js — was NICHT einstellbar ist, und warum.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEIT 30.08.2026 STEHEN HIER KEINE BETRIEBSWERTE MEHR.
 *
 * Zeitgrenzen, Textmengen, Limits, Parallelitaet und Fristen kommen
 * ausschliesslich aus dem Einstellungssatz in Firestore
 * (`config/betriebsprofil`, siehe betriebsprofil.js). Jede dieser Zahlen
 * existiert genau einmal. Es gibt keine Rueckfallwerte im Code: Zwei Orte
 * fuer dieselbe Zahl laufen frueher oder spaeter auseinander, und dann haengt
 * es vom Aufrufweg ab, welche gilt — ein Fehler, den niemand sieht.
 *
 * ── WARUM HIER TROTZDEM ZAHLEN STEHEN ─────────────────────────────────────
 *
 * Was in dieser Datei geblieben ist, ist bewusst NICHT einstellbar. Der
 * Unterschied ist keine Bequemlichkeit, sondern eine Sicherheitsgrenze:
 *
 * Ein Wert im Firestore laesst sich zur Laufzeit aendern — von jedem, der
 * Schreibrechte auf die Datenbank hat, in Sekunden, ohne Commit, ohne
 * Code-Review, ohne Spur im oeffentlichen Quelltext. Fuer eine Zeitgrenze ist
 * das genau richtig: Sie soll sich im Betrieb drehen lassen.
 *
 * Fuer eine ZUSAGE waere es fatal. malziME verspricht oeffentlich:
 *   · Die Bilder gehen an einen EU-Endpunkt (api.eu.mistral.ai).
 *   · Die Daten liegen in der EU-Datenbank (malzime-eu).
 *   · Es rechnet ein benanntes Modell, kein beliebiges anderes.
 *   · Fehlerprotokolle sind auf harmlose Feldlaengen beschnitten.
 *
 * Stuende der Endpunkt im Store, koennte ein einziger Schreibzugriff die
 * Analyse still auf einen Nicht-EU-Server umlenken — die Website wuerde
 * weiter dasselbe versprechen, der Quelltext auf GitHub waere unveraendert,
 * und die Pruefsummen unter malzi.me/build-info.json wuerden weiter stimmen.
 * Der Bruch waere von aussen nicht nachweisbar.
 *
 * Deshalb: Alles, was eine Zusage an die Nutzer traegt, bleibt im Code, wo es
 * durch Commit, Review, Pruefkette und Veroeffentlichung muss. Der
 * Einstellungssatz kann diese Werte auch nicht versehentlich uebernehmen —
 * betriebsprofil.js liest ausschliesslich die ihm bekannten Zahlenfelder;
 * alles andere im Dokument wird ignoriert (Test: betriebsprofil-chaos).
 *
 * ── DIE TRENNLINIE IN EINEM SATZ ──────────────────────────────────────────
 *   Zahlen, die man im Betrieb dreht          → Einstellungssatz (Firestore)
 *   Zusagen, Adressen, Sicherheitsgrenzen,
 *   Messergebnisse                            → hier, im Code
 *
 * Vor v1.6.0 standen hier auch Gemini-Modelle und Vision-API-Konfiguration.
 * Beides wurde mit dem Vision/Gemini-Cleanup entfernt; die heute aktive
 * Pipeline nutzt ausschliesslich Mistral AI.
 */

/* BLEIBT IM CODE — Sicherheitsgrenze.
   Die groesste Datei, die der Server ueberhaupt annimmt. Waere sie im Store,
   liesse sich der Schutz gegen ueberlange Uploads zur Laufzeit stilllegen:
   ein Schreibzugriff, und der Server nimmt 500-MB-Dateien entgegen. Eine
   Schutzgrenze, die sich ohne Code-Aenderung aufheben laesst, ist keine. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/* BLEIBT IM CODE — Sicherheitsliste.
   Welche Dateiformate ueberhaupt durchgelassen werden. Dasselbe Argument:
   Ein Store-Eintrag koennte hier stillschweigend SVG oder HTML ergaenzen. */
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

   RATE-LIMITS — WICHTIG, STAND 2026-08-11 (KA-07): Die frueher hier
   notierten Modell-Limits („6 RPS" Large, „1.67 RPS" Small, Dashboard-Stand
   2026-05-19) sind UEBERHOLT. Mistral vergibt Limits heute als
   STUFEN-SYSTEM nach kumuliertem Umsatz (org-weit, auch am EU-Endpunkt):
   T1 = 0,25 req/s (bis 20 $), T2 ab 20 $, T3 ab 100 $, T4 ab 500 $ —
   kein Vorkauf moeglich. Aktuell gilt T1: 0,25 req/s = die REALE
   Durchsatzbremse (~7,5 Analysen/min bei 2 Calls je Analyse). In der
   Praxis haelt die Cloud-Tasks-Nebenlaeufigkeit (7 gleichzeitige Jobs,
   ~55 s je Analyse) den Durchsatz von selbst genau unter dieser Decke —
   wer die Nebenlaeufigkeit hochdreht, MUSS vorher die Tier-Stufe im
   Mistral-Dashboard pruefen, nicht diesen Kommentar.

   Historie: v1.10.7 (2026-05-19) wich wegen der damaligen 2603-Limits
   voruebergehend auf mistral-small-2506 (Small 3.2) aus; seit der Queue-/
   Single-Large-Architektur ist 2603 wieder aktiv. 2506 wurde von Mistral zum
   31.07.2026 ZURUECKGEZOGEN (Retirement) — als Modell-Option dauerhaft tot.

   API-Key kommt aus `process.env.MISTRAL_API_KEY` (Firebase Secret). */
/* v1.10.7: Large fest auf -2512 gepinnt statt -latest-Alias. Hintergrund:
   Mistral koennte das -latest-Alias jederzeit auf eine neuere Version
   umlenken, deren Konditionen wir nicht kennen. Mit dem Pin kontrollieren
   wir Versions-Wechsel selbst. (Zu Rate-Limits: Stufen-System, s. oben.) */
/* BLEIBT IM CODE — Zusage an die Nutzer.
   WELCHES Modell rechnet, steht auf der Website und in den Rechtstexten.
   Zur Laufzeit umschaltbar hiesse: Die Analyse liefe still ein anderes
   Modell, waehrend die Seite weiter das alte nennt. */
const MISTRAL_DESCRIBE_MODEL = "mistral-large-2512";
const MISTRAL_PROFILE_MODEL = "mistral-small-2603";
const MISTRAL_FALLBACK_MODEL = "mistral-large-2512";
/* v3.0.4 (User-Freigabe 2026-08-11 abends): EU-Regional-Endpunkt statt des
   globalen — Mistral sichert damit VERTRAGLICH zu, dass die Inferenz in
   EU-/EFTA-Rechenzentren laeuft (der globale Endpunkt verspricht nur
   "standardmaessig EU"). Kostet 10 % Aufpreis; beide Modelle wurden am
   11.08. mit dem echten Schluessel am EU-Endpunkt verifiziert (HTTP 200).
   Grundlage: docs.mistral.ai/studio-api/regional-inference. */
/* BLEIBT IM CODE — Datenschutzzusage, der wichtigste Fall.
   Der EU-Endpunkt ist der Grund, warum die Bilder die EU nicht verlassen.
   Stuende er im Store, koennte EIN Schreibzugriff die Analyse auf einen
   Nicht-EU-Server umlenken: Website, Quelltext und Pruefsummen blieben
   unveraendert, der Bruch waere von aussen nicht nachweisbar. */
const MISTRAL_ENDPOINT = "https://api.eu.mistral.ai/v1/chat/completions";
const MISTRAL_MODELS_ENDPOINT = "https://api.eu.mistral.ai/v1/models";
/* v2.1 (2026-05-23 nachmittags): 12000 → 16000. Hintergrund: Beim ersten
   v2.1-Live-Test schnitt Beast mehrere Karten mit "..." mitten im Wort ab,
   weil Mistral trotz Variante-B-Längenvorgabe ausführlich schrieb. 16000
   gibt ausreichend Puffer für die jetzt strengeren Beast-Schema-Beispiele
   (siehe jsonSchemaBoost) bei trotzdem disziplinierterem Modell-Verhalten
   (Temperatur Beast wurde von 1.0 → 0.8 in mistral.js). Kostenneutral,
   da Mistral nur tatsächlich generierte Tokens berechnet. */

/* ── Eigene Zeitgrenze fuer den Single-Large-Aufruf ──
   BUG-2026-08-17-01. Der Single-Large-Call schreibt Standard- UND Beast-Profil
   in EINEM Zug und ist damit der mit Abstand laengste Aufruf der Pipeline. Die
   allgemeinen 90 s passen zu den kurzen Aufrufen (describe, beast-ads), nicht
   zu diesem.

   WARUM DAS ERST SEIT v3.0.0 WEH TUT: Vor dem Live-Text lief der Aufruf ohne
   Stream, und `mistral.js` raeumt die Uhr im Nicht-Stream-Fall schon nach den
   Antwortkopfzeilen weg — das eigentliche Warten auf den Text lief ungebremst.
   Die 90 s standen seit v1.6.0 (14.05.) in der Konfiguration, haben aber nie
   zugebissen. Im Stream-Modus bleibt die Uhr bewusst scharf bis zum letzten
   Zeichen; damit wurde eine schlafende Grenze zum ersten Mal wirksam.

   WARUM 300 s (BUG-2026-08-28-01, vorher 150 s): Die 150 s stammten aus einer
   Messung vom 11.-16.08.2026 (47 Token/s im Median, 39,4 im langsamsten Lauf).
   Diese Momentaufnahme stand danach als feste Zahl im Code und wurde nie wieder
   an der Wirklichkeit geprueft. Am 28.08. lag die reale Laufzeit des Aufrufs bei
   135-155 s und damit MITTEN auf der Grenze: Gemessen wurden vier Laeufe
   innerhalb einer halben Stunde, zwei davon (150,3 s und 152,2 s) starben an der
   Uhr, zwei kamen durch (135,8 s und 156,7 s Gesamtdauer). Das ergab fuer die
   Nutzer eine Ausfallquote um 50 % — bei fertig geschriebenen Profilen, die
   verworfen wurden.

   Die Zahl selbst ist damit nicht das Problem, sondern dass sie eine gemessene
   Eigenschaft der Aussenwelt einfriert. 300 s ist bewusst grosszuegig gewaehlt
   (Function-Limit 540 s, REQUEST_BUDGET_MS 480 s) und behebt den Ausfall; sie
   macht die Verlangsamung selbst nicht rueckgaengig und ersetzt keinen Waechter,
   der anschlaegt, wenn die Laufzeit erneut an die Grenze wandert.

   Die Kopplung der beiden Werte ist keine Bitte um Sorgfalt, sondern geprueft:
   `__tests__/mistral-zeitbudget.test.js` rechnet sie gegeneinander und wird
   rot, sobald jemand einen der beiden Werte allein verschiebt. */

/* Langsamstes gemessenes Schreibtempo (Token/s) aus dem 30-Tage-Diagnose-Bucket.
   Kanonische Quelle fuer die Zeitbudget-Rechnung; steht hier, damit Test und
   Konfiguration dieselbe Zahl benutzen und nicht auseinanderdriften. */
/* BLEIBT IM CODE — Messergebnis, kein Sollwert.
   Die langsamste je gemessene Ausgabegeschwindigkeit von Mistral. Man STELLT
   sie nicht ein: Wird Mistral langsamer, misst man neu und traegt den neuen
   Messwert ein — mit Commit und Beleg. Im Einstellungssatz waere sie eine
   Zahl, an der man drehen koennte, bis die Kopplungspruefung "passt" — und
   genau die Pruefung soll ja verhindern, dass Token-Budget und Zeitgrenze
   auseinanderlaufen (BUG-2026-08-17-01). Ein Pruefmass, das der Prueflling
   selbst verstellen kann, prueft nichts. */
const MISTRAL_SLOWEST_TOKENS_PER_SECOND = 39.4;

/* Obergrenze der Ausgabelaenge fuer den Single-Large-Aufruf.
   v2.1.1 (23.05.) stand hier 8000 — das war rechnerisch nie erreichbar: 8000
   Token brauchen beim gemessenen Tempo rund 170 s und wurden nach 90 s
   abgeschnitten. Der laengste je gemessene erfolgreiche Lauf lag bei 4394
   Token; der Median liegt bei 2750. 5000 laesst dem Modell also reichlich
   Luft nach oben und passt zugleich in MISTRAL_SINGLE_LARGE_TIMEOUT_MS.

   Diese Konstante lag bis v3.3.1 in `mistral.js`. Sie steht jetzt neben ihrer
   Zeitgrenze, weil die beiden nur GEMEINSAM richtig sind (Ein-Quellen-Regel):
   getrennt aufgestellt sah jede fuer sich plausibel aus, und genau daran ist
   der Fehler zwei Audits lang vorbeigelaufen. */

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

/* BUG-003: Globales Budget pro Request — verhindert dass die Summe aller
   internen Timeouts das Cloud-Function-Limit übersteigt.
   v1.10.6: Function-Timeout ist jetzt 540s (Maximum). Budget auf 480s
   gehoben — Mistral bekommt damit auch nach langer Throttle-Queue-Wartezeit
   noch seine vollen 90s, statt nach 119s schon kein Budget mehr zu haben. */

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
/* PRIV-107b (User-Freigabe 11.08. abends): Zugestellte Ergebnisse leben am
   Server nur noch so lange wie das Wiederholungs-Fenster im Browser
   (ERGEBNIS_WIEDERHOLUNG_MS in public/js/api.js, 15 min ab Erstzustellung) —
   danach hat das Dokument keinen Zweck mehr und der Reaper löscht es.
   JOB_RETENTION_MS oben bleibt die Obergrenze für NIE abgeholte Ergebnisse. */

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

/* ── Firestore-Standort (Audit 2026-08-10, PRIV-001) ──────────────────────
   Die Datenschutzerklärung verspricht Europa. Die ursprüngliche Datenbank
   liegt in `nam5` (USA) — und in den Job-Dokumenten steht bis zu zwei Stunden
   lang das fertige Profil eines (oft minderjährigen) Menschen.

   Der Standort einer Firestore-Datenbank steht bei der Erstellung fest und
   lässt sich NIE ändern. Es gibt keinen Umzugsknopf. Der Wechsel läuft
   deshalb über eine ZWEITE Datenbank, auf die hier umgeschaltet wird:

     ""    → Standard-Datenbank, Standort nam5 (USA)
     "malzime-eu" → Datenbank `malzime-eu`, Standort europe-west1 (dort, wo
                    auch die Functions und der Foto-Bucket liegen)

   ═══ UMSCHALTEN ═══
   Diesen einen Wert ändern, dann `firebase deploy --only functions`.
   Zurück geht es genauso — der Wert ist der gesamte Hebel.
   Ablauf, Kontrollen und Rückweg: docs/RUNBOOK.md, Abschnitt „Firestore-Umzug".

   Der Zugriff läuft ausschließlich über `db()` aus `db.js`; ein direkter
   `getFirestore()`-Aufruf würde diesen Schalter umgehen und still in die
   falsche Datenbank schreiben. Genau das verhindert eine eigene Prüfung
   (`__tests__/db-zentral.test.js`). */
/* BLEIBT IM CODE — dieselbe Datenschutzzusage wie beim Endpunkt.
   Welche Datenbank die Daten haelt, und damit in welchem Rechtsraum sie
   liegen. Zusaetzlich pruefbar von aussen: scripts/verify-infrastructure.sh
   misst das vor jedem Deploy an der echten Infrastruktur. */
const FIRESTORE_DATABASE_ID = "malzime-eu";

/* Laufzeit-Validierung — fehlerhafte Config crasht sofort statt leise falsch zu laufen */
if (MAX_UPLOAD_BYTES < 1) throw new Error("Config: MAX_UPLOAD_BYTES must be >= 1");
/* Die Kopplungspruefung "Ausgabelaenge muss in die Zeitgrenze passen"
   (BUG-2026-08-17-01) ist mit den Werten in den Einstellungssatz gewandert.
   Sie steht jetzt in betriebsprofil.js und prueft JEDEN neuen Satz, bevor er
   gilt — also auch die, die erst im Betrieb entstehen. Frueher lief sie nur
   beim Start der Function. */

module.exports = {
  FIRESTORE_DATABASE_ID,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_MODELS_ENDPOINT,
  MISTRAL_SLOWEST_TOKENS_PER_SECOND,
  QUEUE_NAME,
  QUEUE_REGION,
  PROCESS_JOB_FUNCTION,
  QUEUE_BUCKET,
  QUEUE_UPLOAD_PREFIX,
  isLocalQueueMode,
  localQueueConcurrency,
};
