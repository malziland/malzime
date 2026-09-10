# Architektur — malziME

Dieses Dokument beschreibt die End-to-End-Architektur von malziME. Die KI-Pipeline läuft seit v1.6.0 über Mistral AI; seit v2.0 wird sie über eine Cloud-Tasks-Warteschlange ausgeführt (siehe Abschnitt »Queue-Architektur«).

## Aktueller Stand

Seit v1.6.0 läuft die komplette KI-Analyse über Mistral AI (Paris, EU). Google-KI-Dienste (Vertex AI Gemini, Cloud Vision API) sind aus der Pipeline entfernt. Google ist nur noch für die Infrastruktur-Schicht zuständig: Firebase Hosting, Cloud Functions, Firestore, Cloud Tasks und Cloud Storage, alles in `europe-west1` (Belgien). Seit v2.0 wird die Pipeline über eine Warteschlange ausgeführt — siehe Abschnitt »Queue-Architektur«.

| Phase | Primaer | Modell | Region |
|-------|---------|--------|--------|
| KI-Analyse (aktiv, Single-Call) | Mistral AI | `mistral-large-2512` — Beschreibung + beide Profile in einem Call | EU-Default |
| Functions + DB + Warteschlange | Google | Firebase / Cloud Run | `europe-west1` — der Browser ruft die Schnittstellen seit 09.09.2026 **direkt** unter ihren Cloud-Run-Adressen auf (`public/js/api-basis.js`) |
| Hosting (nur die Seite selbst) | Google | Firebase Hosting | weltweites Auslieferungsnetz; enthält keine Nutzerdaten |

> **Ein Weg:** Seit v2.2 liefert ein Aufruf an `mistral-large-2512` Bildbeschreibung + beide Profile. Den älteren Drei-Aufruf-Weg (Large beschreibt, Small profiliert) gibt es seit 10.09.2026 nicht mehr.

## Datenfluss

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (User-Geraet)                                             │
│                                                                    │
│  Foto-Upload                                                       │
│    ├─ EXIF-Extraktion (exifr, lokal)                              │
│    │   ├─ GPS → wird NICHT an Server gesendet                     │
│    │   ├─ dateTimeOriginal → wird NICHT an Server gesendet        │
│    │   └─ make/model → wird mitgesendet                           │
│    ├─ Geocoding via Nominatim (direkter Browser-Call)             │
│    └─ Bild-Kompression: max 1280px, JPEG q82                       │
│                                                                    │
│  POST /api/enqueue {imageBase64, mimeType, exif:{make,model}, lang}│
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ↓ HTTPS, eu-west1
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Function "enqueue" (europe-west1, Node 24, 512 MiB)         │
│                                                                    │
│  Validation in handle-enqueue.js                                   │
│     ├─ Maintenance-Mode-Check (Firestore, 30s Cache)              │
│     ├─ Rate-Limit (IP-basiert, Wert im Einstellungssatz)          │
│     ├─ Honeypot + MIME + Magic-Byte-Validierung                   │
│     ├─ Hourly-Limit-Check (Firestore, rollendes Fenster)           │
│     └─ Queue-Tiefen-Bremse (warteschlangeTiefe)                    │
│                                                                    │
│  Bild → GCS-Bucket, Job-Dokument → Firestore, Task → Cloud Tasks   │
│  Antwort an den Browser: { jobId } — KEINE Analyse in dieser       │
│  Function (der synchrone Pfad ist seit v2.10 entfernt).            │
└────────────────────────────────────┬───────────────────────────────┘
                                     │ dosiert durch Cloud Tasks
                                     ↓
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Function "processJob" (OIDC-geschuetzt, nicht oeffentlich)  │
│                                                                    │
│  1. claimJob: queued → processing (idempotente Transaktion)        │
│                                                                    │
│  2. Analyse-Aufruf (Single-Large-Call)                             │
│     └─ EIN Aufruf an mistral-large-2512 liefert Beschreibung       │
│        UND beide Profile; ein zweiter, kleiner Aufruf ohne Bild    │
│        erzeugt die Beast-Werbung (seit v2.8)                       │
│                                                                    │
│  3. SUBJECT-Klassifikation in animal.js                            │
│     ├─ classifyDescription() parst die SUBJECT-Zeile                │
│     ├─ Bei ANIMAL_ONLY: detectAnimalType() matcht Tier-Keywords     │
│     └─ Default bei fehlender Zeile: HUMAN (restriktivste Annahme)   │
│                                                                    │
│  4. Privacy-Risiken in privacy.js                                  │
│     ├─ extractVisibleText() parst "Sichtbarer Text:"-Zeile         │
│     └─ buildPrivacyRisks() matcht Telefon/Adress/Kfz-Patterns       │
│                                                                    │
│  5. Ergebnis-Aufbau                                                │
│     ├─ Profile JSON in Output-Bounds geclampt (SEC-004)            │
│     └─ Ergebnis ins Job-Dokument, Bild sofort geloescht            │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ↓ GET /api/job-status (Polling, 2 s)
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                           │
│                                                                    │
│  render.js zeigt Profil + Privacy-Risiken + EXIF + Karte           │
│  Beim Tab-Schliessen ist alles weg (kein localStorage)             │
└──────────────────────────────────────────────────────────────────┘
```

## Queue-Architektur (v2.0)

Seit v2.0 läuft die Analyse nicht mehr synchron, sondern über eine Warteschlange. Grund: Workshop-Last ist stoßweise (z. B. 25 Uploads in zwei Minuten), und jeder KI-Anbieter hat Rate-Limits. Die Queue nimmt den Stoß auf und arbeitet ihn dosiert ab, statt im Limit-Fall Fehler zu produzieren.

Seit v2.10 ist die Warteschlange der einzige Weg. Der synchrone `/analyze`-Pfad ist entfernt: Er war seit Mai 2026 nur noch Rückfall über ein Feature-Flag und hätte bei Stoßlast genau das Problem zurückgebracht, wegen dem die Warteschlange gebaut wurde. Als Notfall-Hebel dient der Wartungsmodus ([RUNBOOK.md](RUNBOOK.md)).

Seit 09.09.2026 gehen diese Aufrufe **direkt an die Cloud-Run-Adresse des jeweiligen
Dienstes in `europe-west1`** (`https://enqueue-….a.run.app/api/enqueue` usw., eine Quelle:
`public/js/api-basis.js`), nicht mehr über Firebase Hosting. Hosting ist ein weltweites
Auslieferungsnetz; über den Umweg lief auch das Foto durch dessen nächsten Knoten. Die
Hosting-Umleitungen für `/api/…` bleiben als Rückweg bestehen (RUNBOOK, Hebel 5a). Lokal
und in Tests (localhost) bleibt der Pfad relativ.

```
Browser ──POST /api/enqueue (direkt: https://enqueue-….a.run.app)──► enqueue
                                 │ Bild → GCS-Bucket
                                 │ Job-Dokument → Firestore-Collection `jobs` (queued)
                                 │ Task → Cloud-Tasks-Queue `analyze-queue`
                                 ▼  Antwort: { jobId }
                          Cloud Tasks  (dosiert, maxConcurrentDispatches)
                                 ▼
                          processJob  (OIDC-geschützt, nicht öffentlich)
                                 │ claimJob: queued → processing (idempotente Transaktion)
                                 │ Liveness-Check: pollt der Client nicht mehr → abandoned
                                 │ Bild aus dem Bucket → Mistral-Pipeline                     
                                 │ Ergebnis → Job-Dokument (done), Bild gelöscht
                                 ▼
Browser ◄──GET /api/job-status?jobId=──  Polling alle 2 s (= Liveness-Herzschlag)
            Antwort: status, queuePosition, etaSeconds, result (bei done)
```

### Client-Liveness

Der Client hält keine lange Verbindung mehr, sondern pollt. Jeder `job-status`-Poll schreibt `lastSeenAt`. Bleibt das Lebenszeichen länger als `livenessGnadenfristMs` (Einstellungssatz) aus, gilt der Client als weg — der Job wird `abandoned`, ohne Mistral zu rufen, und der Warteschlangen-Platz wird frei.

### Reaper

`reapJobs` läuft im Minutentakt und räumt auf: verlassene wartende Jobs (`queued` ohne Herzschlag → `abandoned`), hängende Jobs (`processing` über dem Zeitlimit → `failed`), überfällige wartende Jobs (älter als `wartendesHoechstalterMs` → `abandoned`, auch wenn noch gepollt wird), zugestellte Ergebnisse nach dem Browser-Wiederholungs-Fenster (`zustellfensterMs` ab Erstzustellung → gelöscht, PRIV-107b) und abgelaufene Job-Dokumente (älter als `jobAufbewahrungMs` → gelöscht). Alle vier Fristen stehen im Einstellungssatz ([BETRIEBSPROFILE.md](BETRIEBSPROFILE.md)); zwei davon sind nach oben durch Datenschutzzusagen begrenzt. Bei `abandoned` wird der Stunden-Slot zurückgegeben und das zwischengespeicherte Bild mitgelöscht.

### Einlass-Politik

### Die Einlassgrenze hält in zwei Stufen (seit 30.08.2026)

Bis dahin zählte der Einlass die Warteschlange und legte den Auftrag erst
mehrere Schritte später an. Bei gleichzeitigem Andrang sahen alle Anfragen
denselben Stand und kamen alle durch — gemessen 200 Wartende bei einer Grenze
von 155. Der Fehler bestand seit der Einführung der Warteschlange und wurde
erst durch einen Lasttest im Emulator sichtbar (BUG-2026-08-30-14).

1. **Vorprüfung vor dem Upload** (`countQueuedJobs`) — grob, billig, ohne
   Sperre. Sie fängt den Normalfall ab, *bevor* ein Bild gespeichert wird.
   Das ist auch eine Datenschutzfrage: Ein Foto, das nie analysiert wird, soll
   nie auf unserem Speicher liegen.
2. **Positionsprüfung nach dem Anlegen** (`platzBestaetigen`) — exakt. Jeder
   Auftrag fragt: Wie viele warten *vor mir*? Die Antwort ist stabil, niemand
   schreibt etwas Gemeinsames, es gibt keinen Wettlauf. Wer zu spät kommt,
   nimmt sich selbst zurück, bevor Kosten entstehen.

**Verworfen wurde eine atomare Reservierung** über ein Zähler-Dokument in einer
Transaktion. Sie löste den Wettlauf sauber und erzeugte einen schlimmeren
Fehler: Ein einzelnes Firestore-Dokument verträgt etwa einen Schreibvorgang pro
Sekunde. Bei 170 gleichzeitigen Anfragen entstanden 373 Sperr-Konflikte,
einzelne Anfragen hingen sechzig Sekunden, 94 von 170 Verbindungen rissen ab.
Die Lehre gilt über diesen Fall hinaus: **Nicht in ein gemeinsames Dokument
schreiben, sondern zählen.**

Der Einlass ist doppelt begrenzt: durch das **globale Stundenlimit** (`stundenlimit` über ein rollendes Fenster in Firestore) und durch die **Queue-Tiefen-Bremse** — ab `warteschlangeTiefe` wartenden Jobs lehnt der Enqueue neue Aufträge ehrlich ab, statt Wartezeiten anzunehmen, die den 30-Minuten-Polling-Deckel des Browsers überschreiten würden. In der Praxis greift fast immer das Stundenlimit zuerst, weil der Einlass über dem Verarbeitungs-Durchsatz liegt (`parallelitaet` × gemessene Dauer je Analyse). Beide Werte stehen im Einstellungssatz und sind hier bewusst nicht als Zahl wiederholt.

Dazu kommt die Selbstregulation: Nutzer sehen Position + ETA sofort nach dem Upload und können selbst entscheiden, ob sie warten. Abbrecher werden nach der Karenz (`livenessGnadenfristMs`) gereapt und geben ihren Stunden-Slot zurück. Wartende Jobs haben zusätzlich ein absolutes Höchstalter (`wartendesHoechstalterMs`) — fortlaufendes Pollen hält einen Job also nicht unbegrenzt am Leben.

### Lokaler Betrieb

Für Google Cloud Tasks gibt es keinen Emulator. Im Lokal-Modus (`QUEUE_LOCAL=1`) ersetzen Shims Cloud Tasks (direkter HTTP-Dispatch) und den GCS-Bucket (Dateisystem-Ablage). Siehe `docs/QUEUE-EMULATOR.md`.

## Komponenten-Verantwortlichkeiten

### Frontend (`public/`)

| Modul | Verantwortlich fuer |
|-------|---------------------|
| `app.js` | Entry Point, Event-Bindings, Pipeline-Coordinator |
| `js/exif.js` | EXIF-Extraktion via exifr (lokal im Browser) |
| `js/geocoding.js` | Nominatim Reverse-Geocoding (direkter Browser-Call) |
| `js/api.js` | Analyse-Ablauf im Browser: Bild einreihen, Status abfragen, Ergebnis zustellen, Wiederaufnahme nach Neuladen — mit AbortController + Stale-Guard |
| `js/api-basis.js` | Die eine Stelle für die Server-Adressen: im Betrieb direkt Cloud Run in `europe-west1`, sonst relativ |
| `js/auftrag-speicher.js` | Auftragsgedächtnis des Tabs (sessionStorage): Auftragsnummer, Abhol-Ticket, 15-Minuten-Frist für ein zugestelltes Ergebnis |
| `js/wake-lock.js` | Bildschirm während der Analyse wach halten (Best-Effort) und den Stand für die Telemetrie melden |
| `js/rc-ticket.js` | Einmal-Ticket des Realitäts-Checks (sessionStorage), eigenes Modul gegen einen Import-Kreis |
| `js/render.js` | Profile-Rendering, Bias-Toggle, Privacy-Cards, Karte |
| `js/live-anzeige.js` | Live-Karte während der Analyse: getippter Zusammenfassungstext, ankommende Ergebnis-Boxen |
| `js/klang.js` | Die zwei Klänge des Live-Erlebnisses (Web Audio, im Browser erzeugt) |
| `js/beast-lockruf.js` | Einmaliger Hinweis auf den Beast-Umschalter, wenn das Profil fertig dasteht |
| `js/sticky-toggle.js` | Umschalter bleibt nach dem Ergebnis oben stehen, Leseposition beim Moduswechsel halten |
| `js/modus-speicher.js` | Modus-Wahl (seriös / Beast) über ein Neuladen hinweg merken |
| `js/realitaets-check.js` | Realitäts-Check: anonyme Selbsteinschätzung, wie gut die KI getroffen hat |
| `js/sprachumschalter.js` | DE/EN-Umschalter samt Rückfragen; startet eine laufende Analyse in der neuen Sprache neu |
| `js/heic.js` | HEIC-Fotos im Browser öffnen, wenn der Browser es nicht selbst kann (Dekoder nur bei Bedarf geladen) |
| `js/absturz-wache.js` | Erkennt eine Neustart-Schleife der Seite, meldet sie einmal und bricht sie ab |
| `js/druck-wache.js` | Meldet eine leer gebliebene Seite nach dem Druckdialog (Diagnose) |
| `js/echtheit-pruefen.js` | Rechnet die Prüfsummen aus `build-info.json` im Browser nach (Echtheits-Nachweis) |
| `js/ui.js` | Maintenance-Modal, Limit-Banner, Scan-Animation, Warteschlangen-Anzeige |
| `js/state.js` | Globaler State (`requestId`, `isAnalyzing`) |
| `js/i18n.js` | i18n Micro-Modul (`initI18n`, `t`, `applyTranslations`) |
| `js/demo.js` | Demo-Bild-Logik (KI-generierte Demo-Fotos durch die echte KI schicken — keine realen Personen, siehe `public/img/demo/LICENSE.md`) |
| `js/stats.js` | Stats-Seite mit Limit-Balken + Countdown |
| `js/dom.js` | DOM-Helpers (`escapeHtml`, sanitize) |
| `js/error-logger.js` | Anonymes Client-Fehler-Logging an `/api/errors` (Fehler-Typ, Phase, Dauer — grober User-Agent, keine PII) |
| `js/telemetry-logger.js` | Anonyme Success-/Performance-Telemetrie an `/api/telemetry` (Spiegel zum Error-Logger, Timings statt Fehler) |
| `js/client-context.js` | Anonyme Geräte-/Netzwerk-Klassen für die Diagnose (`coarseUserAgent`, Bildschirm-Größenklasse, Netzwerk-Klasse) + Trace-ID |

### Backend (`functions/src/`)

| Modul | Verantwortlich fuer |
|-------|---------------------|
| `index.js` | Cloud-Function-Exports, Secret-Deklarationen (`ADMIN_SECRET_EU`, `MISTRAL_API_KEY_EU`, `NTFY_*_EU`, alle an europe-west1 gebunden) |
| `handle-stats.js` | GET-only Stats-Endpunkt |
| `handle-admin.js` | Admin-Endpunkte (Boost, Reset, Maintenance) — 3-Schritt-Flow mit HMAC + Nonce |
| `handle-errors.js` | Anonymes Client-Error-Logging (whitelist-validiert, längenbegrenzt; severity ERROR → Log-Bucket `client-diagnostics`) |
| `handle-telemetry.js` | Anonyme Success-/Performance-Telemetrie (Spiegel zu `handle-errors.js`, severity INFO, eigener Endpoint) |
| `handle-enqueue.js` | Queue: Job anlegen, Bild in den Bucket, Task einreihen |
| `handle-process-job.js` | Queue-Worker: claimt den Job, ruft die Mistral-Pipeline, schreibt das Ergebnis |
| `handle-job-status.js` | Queue: Status-Polling für den Client + Liveness-Herzschlag |
| `handle-reap.js` | Queue: Reaper (Minutentakt) für verlassene / hängende / abgelaufene Jobs |
| `handle-erinnerung.js` | Wochenlauf (montags): erinnert per ntfy-Push, bevor die halbjährliche ZDR-Nachprüfung fällig wird — inkl. Handlungsanleitung im Text |
| `zusagen.js` | Gemeinsame Fristlogik für datierte öffentliche Zusagen (Erinnerung + CI-Wächter rechnen mit derselben Definition) |
| `jobs.js` | Queue: Job-Lebenszyklus + Firestore-Zugriff auf die `jobs`-Collection |
| `cloud-tasks.js` | Queue: Cloud-Tasks-Anbindung (+ Lokal-Shim) |
| `queue-storage.js` | Queue: temporäre Bild-Ablage im GCS-Bucket |
| `feature-flags.js` | Laufzeit-Feature-Flags (`useBeastAdsCall`, `useGemesseneDauer`; Firestore, 30 s Cache, je Flag ein fail-safe-Wert, siehe `FLAGS.md`) |
| `config.js` | Konstanten, Mistral-Modell-IDs, Limits |
| `mistral.js` | Mistral AI: ein Aufruf an `mistral-large-2512` liefert Beschreibung + beide Profile; ein zweiter, kleiner Aufruf ohne Bild erzeugt die Beast-Werbung |
| `json-repair.js` | Defensiver JSON-Parser (direkt → heuristisch → json5 → Truncation-Recovery) |
| `throttle.js` | In-Memory-Semaphore + Token-Bucket gegen Mistral-Bursts (seit v1.7.0 in `mistral.js` aktiv) |
| ~~`heartbeat.js`~~ | Entfernt mit dem Audit 2026-08-10 — hatte seit v2.10 keinen Aufrufer mehr (Safari kappt fetch-Streams nach ~47 s ohne Bytes) |
| `counter.js` | Firestore-Zaehler: Stundenlimit (rollend), Totals, Stats, Boost, Reset, Maintenance |
| `animal.js` | SUBJECT-Klassifikation aus Mistral-Beschreibung + Easter-Egg-Profile |
| `privacy.js` | OCR-basiertes Privacy-Risiko-Mapping aus Mistrals "Sichtbarer Text" |
| `middleware.js` | Rate-Limit + IP-Extraktion |
| `upload.js` | Multipart- und JSON-Body-Parsing |
| `auth.js` | HMAC-Admin-Tokens + Nonces |
| `notify.js` | ntfy-Push bei Limit-Erreichung |
| `domains.js` | Zentrale CORS-Whitelist |
| `i18n.js` | Backend-Locale-Loader |
| `mistral-http.js` | Netzschicht zu Mistral: Zeitgrenzen, Wiederholung bei Überlast, Antwort als Strom |
| `mistral-antwort.js` | Auswertung der KI-Antwort: Live-Text, fehlende Karten, Maskierung (`escapeXml`) |
| `mistral-mock.js` | Mistral-Attrappe für Unit-Tests und Emulator (`MISTRAL_MOCK=1`) |
| `job-helfer.js` | Kleine Entscheidungen im Analyseablauf (Werbe-Schalter, Fehlerarten, Ersatzbeschreibung) |
| `minor-safety.js` | Kinderschutz-Filter für Werbekategorien bei erkennbar Minderjährigen |
| `betriebsprofil.js` | Betriebswerte aus Firestore (`config/betriebsprofil`): Prüfung, Cache, Rückfall |
| `produktiv-satz.js` | Betriebswerte für den echten Betrieb — Quelle für `config/betriebsprofil` |
| `test-satz.js` | Einstellungssatz für die Tests |
| `durchsatz.js` | Gemessene Analysedauer (Wartezeit-Ansage, Einlassgrenze) |
| `kapazitaets-wache.js` | Meldet, wenn Einstellungssatz und Warteschlange auseinanderlaufen |
| `laufzeit-wache.js` | Meldet, wenn Analysen an ihre Zeitgrenze stoßen |
| `db.js` | Firestore-Zugang (benannte Datenbank `malzime-eu`) |

## Externe Abhängigkeiten

| Dienst | Genutzt fuer | Datensouveraenitaet |
|--------|--------------|---------------------|
| **Mistral AI API** | Alle KI-Analysen | Mistral AI SAS, Paris, FR — EU-Hosting Default |
| **Firebase Hosting** | Auslieferung der Seite (HTML, JS, CSS, Bilder) — keine Nutzerdaten; die Schnittstellen ruft der Browser direkt in `europe-west1` auf | Google Ireland Ltd. — Edge-Caches weltweit, Origin EU |
| **Firebase Cloud Functions** | Backend-Runtime | Google Ireland Ltd. — `europe-west1` |
| **Google Cloud Tasks** | Dosierter Job-Dispatch (Queue) | Google Ireland Ltd. — `europe-west1` |
| **Google Cloud Storage** | Temporaere Bild-Ablage der Queue | Google Ireland Ltd. — `europe-west1` |
| **Cloud Firestore** | Zaehler, Maintenance-Flag, Queue-Jobs | Google Ireland Ltd. — `europe-west1` |
| **OpenStreetMap / Nominatim** | Reverse-Geocoding (direkt vom Browser) | OpenStreetMap Foundation, UK |
| **ntfy** | Push-Benachrichtigungen bei Limit | Self-hosted oder ntfy.sh, je nach Setup |

Mistrals Sub-Prozessoren (Cloud-Provider, Compute) können temporär außerhalb der EU operieren, dann mit DSGVO-Schutzmaßnahmen nach Art. 46 (Standardvertragsklauseln). Aktuelle Liste im [Mistral Trust Center](https://trust.mistral.ai/subprocessors).

## SUBJECT-Klassifikation

Der Analyse-Aufruf liefert im JSON die Felder `subject` (`ANIMAL_ONLY | HUMAN | MIXED | OTHER`) und `visible_text`. `job-pipelines.js` setzt daraus eine Beschreibung in diesem Format zusammen, die `animal.js` und `privacy.js` auswerten:

```
SUBJECT: ANIMAL_ONLY | HUMAN | MIXED | OTHER

<Bildbeschreibung Fliesstext...>

Sichtbarer Text: <Text 1>; <Text 2>; ...
```

`animal.js:classifyDescription()` parst die SUBJECT-Zeile und routet:
- `ANIMAL_ONLY` → Tier-Easter-Egg-Pfad (Profile aus `animals.js`, keine zweite KI-Anfrage)
- `HUMAN` / `MIXED` / `OTHER` → die Profile aus demselben Aufruf werden ausgeliefert

Bei fehlender SUBJECT-Zeile fällt das System fail-safe auf `HUMAN` zurück — d.h. kein versehentliches Easter-Egg bei kaputter Mistral-Antwort.

## Fehler-Handling

Da es keine alternativen KI-Provider mehr gibt:

| Mistral-Antwort | Reaktion |
|---|---|
| 200 OK mit auswertbarem JSON | Normale Pipeline weiter |
| 200 OK ohne auswertbare Profile | `blocked.profileBlocked` |
| JSON nicht parsbar | `json-repair.js` (4 Stufen) → wenn alle scheitern: `blocked.profileBlocked` |
| HTTP 429 (Rate-Limit) | `blocked.overloaded` (vorher Wiederholungen mit wachsender Wartezeit, `ueberlast.js`) |
| Sonstiger HTTP-Fehler oder Timeout | `blocked.apiError` |
| Einstellungssatz fehlt oder ungültig | `blocked.configMissing` |

Der User sieht in allen Blocked-Fällen eine erklärende Meldung statt eines internen Server-Fehlers. Das `blockedReason`-Feld in der Response erlaubt frontend-seitiges Mapping zu i18n-Strings.

## JSON-Repair-Strategie

Mistral-API liefert gelegentlich invalides JSON (max-tokens-Truncation, unescapte Inner-Quotes, unescapte Control-Chars). `json-repair.js` versucht in 4 Stufen:

1. **Direkter Parse** — `JSON.parse()` ohne Aenderung.
2. **Heuristik** — Markdown-Fences entfernen, Smart-Quotes ASCII-ifizieren, Trailing-Commas, Control-Chars und Inner-Quotes escapen, Slice zum letzten `}`.
3. **json5-Toleranz** — `json5.parse()` toleriert Trailing-Commas, Single-Quotes, Comments.
4. **Truncation-Recovery** — Stack-basierte Suche nach dem letzten sauber geschlossenen Wert, Auffuellen der offenen Brackets in umgekehrter Reihenfolge.

Bei Misserfolg in allen 4 Stufen: `null` zurueck — der Aufrufer in `mistral.js` faellt dann auf den Mistral-internen Large-3-Backup zurueck.

## Sicherheits-Architektur

- **CSP** auf `firebase.json` — nur self + OpenStreetMap-Tiles + Nominatim + die fünf Cloud-Run-Adressen unserer Schnittstellen in `europe-west1` (`connect-src`; Liste identisch mit `public/js/api-basis.js`, Wächter `public/__tests__/api-basis.test.js`)
- **CORS** auf den öffentlichen Functions — nur unsere eigenen Ursprünge (`functions/src/domains.js`), keine Platzhalter
- **HSTS** mit Preload
- **Magic-Byte-Validierung** der hochgeladenen Bilder
- **Honeypot-Feld** + **Timing-Check** als Bot-Defense
- **HMAC-signierte Admin-Tokens** mit Nonce-Replay-Schutz (SEC-001/SEC-002)
- **escapeXml()** auf alle dynamischen Prompt-Inhalte (SEC-003)
- **Output-Bounds** auf Profil-Strings (max 800 chars / Kategorie, SEC-004)
- **Maintenance-Kill-Switch** via Firestore-Doc (30s Cache)
- **Per-Instance-Throttle** (`throttle.js` — Semaphore + Token-Bucket, seit v1.7.0 in `mistral.js` aktiv)

## Privacy-Architektur

- EXIF wird client-seitig extrahiert (exifr im Browser)
- GPS erreicht NIE unsere Server — Nominatim und die Kartenkacheln ruft der Browser
  direkt auf, die Koordinaten verlassen das Geraet also sehr wohl, nur nie in Richtung
  malziME (Formulierung nach DOC-2026-08-12-05: die alte Fassung war im Netzwerk-Tab
  widerlegbar)
- Server bekommt nur: komprimiertes Bild + Kamera-make/model (KEIN GPS, KEIN dateTimeOriginal)
- Keine externen Scripts: alles self-hosted (Fonts, Leaflet, exifr)
- CSP nur self + OpenStreetMap Tiles + Nominatim + die Cloud-Run-Adressen der eigenen Schnittstellen (`europe-west1`)
- Foto und Analysedaten gehen direkt an den EU-Server, nicht über das Auslieferungsnetz von Firebase Hosting (seit 09.09.2026)
- Keine dauerhafte Persistenz: im Queue-Betrieb liegt das Bild kurz im GCS-Bucket und wird unmittelbar nach der Verarbeitung gelöscht; das Job-Dokument spätestens nach 2 h
- Anwendungs-Logs enthalten keine Bildinhalte und keine personenbezogenen Daten — nur Request-ID, Step-Name, Status, Token-Counts
