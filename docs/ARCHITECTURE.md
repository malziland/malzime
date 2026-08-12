# Architektur — malziME

Dieses Dokument beschreibt die End-to-End-Architektur von malziME. Die KI-Pipeline läuft seit v1.6.0 über Mistral AI; seit v2.0 wird sie über eine Cloud-Tasks-Warteschlange ausgeführt (siehe Abschnitt »Queue-Architektur«).

## Aktueller Stand

Seit v1.6.0 läuft die komplette KI-Analyse über Mistral AI (Paris, EU). Google-KI-Dienste (Vertex AI Gemini, Cloud Vision API) sind aus der Pipeline entfernt. Google ist nur noch für die Infrastruktur-Schicht zuständig: Firebase Hosting, Cloud Functions, Firestore, Cloud Tasks und Cloud Storage, alles in `europe-west1` (Belgien). Seit v2.0 wird die Pipeline über eine Warteschlange ausgeführt — siehe Abschnitt »Queue-Architektur«.

| Phase | Primaer | Modell | Region |
|-------|---------|--------|--------|
| KI-Analyse (aktiv, Single-Call) | Mistral AI | `mistral-large-2512` — Beschreibung + beide Profile in einem Call | EU-Default |
| Describe (Fallback-Pipeline) | Mistral AI | `mistral-large-2512` | EU-Default |
| Profile (Fallback-Pipeline) | Mistral AI | `mistral-small-2603` | EU-Default |
| Hosting + Functions + DB | Google | Firebase | `europe-west1` |

> **Zwei Modi:** Aktiv ist seit v2.2 der **Single-Large-Call** (Feature-Flag `featureFlags/current.useSingleLargeCall`): ein Aufruf an `mistral-large-2512` liefert Bildbeschreibung + beide Profile. Die klassische **3-Call-Pipeline** (Large beschreibt, Small profiliert, Large als internes JSON-Backup) bleibt als Fallback im Code und ist per Flag umschaltbar.

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
│  1. Validation in handle-enqueue.js                                │
│     ├─ Maintenance-Mode-Check (Firestore, 30s Cache)              │
│     ├─ Rate-Limit (IP-basiert, 500/10min, In-Memory pro Instanz)  │
│     ├─ Honeypot + MIME + Magic-Byte-Validierung                   │
│     └─ Hourly-Limit-Check (Firestore, 500/Std. rollendes Fenster)  │
│                                                                    │
│  2. Mistral Large 3 — Beschreibung                                 │
│     ├─ mistral.js → POST api.mistral.ai/v1/chat/completions        │
│     │   (Bearer MISTRAL_API_KEY, image_url base64, max 2048 tok)   │
│     └─ Antwort enthaelt:                                            │
│         ├─ Erste Zeile: "SUBJECT: ANIMAL_ONLY|HUMAN|MIXED|OTHER"   │
│         ├─ Bildbeschreibung als Fliesstext                          │
│         └─ Letzte Zeile: "Sichtbarer Text: ..."                     │
│                                                                    │
│  3. SUBJECT-Klassifikation in animal.js                            │
│     ├─ classifyDescription() parst die SUBJECT-Zeile                │
│     ├─ Bei ANIMAL_ONLY: detectAnimalType() matcht Tier-Keywords     │
│     │   im Text (Hund/Katze/Vogel/Fisch/Pferd/Kaninchen/generic)    │
│     └─ Default bei fehlender Zeile: HUMAN (restriktivste Annahme)   │
│                                                                    │
│  4. Privacy-Risiken in privacy.js                                  │
│     ├─ extractVisibleText() parst "Sichtbarer Text:"-Zeile         │
│     └─ buildPrivacyRisks() matcht Telefon/Adress/Kfz-Patterns       │
│                                                                    │
│  5. Profil-Stage                                                   │
│     ├─ ANIMAL_ONLY-Pfad: buildAnimalProfiles(animalType)           │
│     │   → Easter-Egg aus locales/de/animals.js                     │
│     └─ HUMAN/MIXED/OTHER-Pfad:                                     │
│         ├─ mistral.generateBothProfiles() parallel                  │
│         │   ├─ Normal-Profil via Small 4                            │
│         │   ├─ Boost-Profil via Small 4                             │
│         │   └─ Bei Small-4-JSON-Fail: Large 3 als Mistral-Backup    │
│         └─ json-repair.js cleant LLM-Outputs (4-Stufen-Repair)      │
│                                                                    │
│  6. Response-Aufbau                                                │
│     ├─ Profile JSON in Output-Bounds geclampt (SEC-004)            │
│     └─ JSON-Antwort an den Browser                                 │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ↓ JSON
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

```
Browser ──POST /api/enqueue──► enqueue
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

Der Client hält keine lange Verbindung mehr, sondern pollt. Jeder `job-status`-Poll schreibt `lastSeenAt`. Bleibt das Lebenszeichen länger als `LIVENESS_GRACE_MS` (8 min) aus, gilt der Client als weg — der Job wird `abandoned`, ohne Mistral zu rufen, und der Warteschlangen-Platz wird frei.

### Reaper

`reapJobs` läuft im Minutentakt und räumt auf: verlassene wartende Jobs (`queued` ohne Herzschlag → `abandoned`), hängende Jobs (`processing` über dem Timeout → `failed`), überfällige wartende Jobs (älter als `MAX_QUEUED_AGE_MS` = 35 min → `abandoned`, auch wenn noch gepollt wird), zugestellte Ergebnisse nach dem Browser-Wiederholungs-Fenster (15 min ab Erstzustellung → gelöscht, PRIV-107b) und abgelaufene Job-Dokumente (älter als `JOB_RETENTION_MS` = 2 h → gelöscht). Bei `abandoned` wird der Stunden-Slot zurückgegeben und das zwischengespeicherte Bild mitgelöscht.

### Einlass-Politik

Der Einlass ist doppelt begrenzt: durch das **globale Stundenlimit** (500/h, rollendes 60-Minuten-Fenster in Firestore) und durch die **Queue-Tiefen-Bremse** — ab 155 wartenden Jobs (`MAX_QUEUE_DEPTH`) lehnt der Enqueue neue Aufträge ehrlich ab, statt Wartezeiten anzunehmen, die den 30-Minuten-Polling-Deckel des Browsers überschreiten würden. In der Praxis greift fast immer das Stundenlimit zuerst: 500/h Einlass steht einem Verarbeitungs-Durchsatz von ~387 Analysen/h gegenüber (Concurrency 7 × ~65 s/Job).

Dazu kommt die Selbstregulation: Nutzer sehen Position + ETA sofort nach dem Upload und können selbst entscheiden, ob sie warten. Abbrecher werden nach der 8-Minuten-Karenz gereapt und geben ihren Stunden-Slot zurück. Wartende Jobs haben zusätzlich ein absolutes Höchstalter von 35 Minuten (`MAX_QUEUED_AGE_MS`) — fortlaufendes Pollen hält einen Job also nicht unbegrenzt am Leben.

### Lokaler Betrieb

Für Google Cloud Tasks gibt es keinen Emulator. Im Lokal-Modus (`QUEUE_LOCAL=1`) ersetzen Shims Cloud Tasks (direkter HTTP-Dispatch) und den GCS-Bucket (Dateisystem-Ablage). Siehe `docs/QUEUE-EMULATOR.md`.

## Komponenten-Verantwortlichkeiten

### Frontend (`public/`)

| Modul | Verantwortlich fuer |
|-------|---------------------|
| `app.js` | Entry Point, Event-Bindings, Pipeline-Coordinator |
| `js/exif.js` | EXIF-Extraktion via exifr (lokal im Browser) |
| `js/geocoding.js` | Nominatim Reverse-Geocoding (direkter Browser-Call) |
| `js/api.js` | API-Client: Einreihen, Statusabfrage, Wiederaufnahme — mit AbortController + Stale-Guard |
| `js/render.js` | Profile-Rendering, Bias-Toggle, Privacy-Cards, Karte |
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
| `index.js` | Cloud-Function-Exports, Secret-Deklarationen (`ADMIN_SECRET`, `MISTRAL_API_KEY`, `NTFY_*`) |
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
| `feature-flags.js` | Laufzeit-Feature-Flags `useSingleLargeCall` + `usePromptCache` (Firestore, 30 s Cache, fail-safe `false`) |
| `config.js` | Konstanten, Mistral-Modell-IDs, Limits |
| `mistral.js` | Mistral AI: Single-Large aktiv (1 Call `mistral-large-2512` liefert Beschreibung + beide Profile); 3-Call-Fallback (Describe Large + 2× Profil Small) mit Mistral-internem Large-3-Backup |
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

## Externe Abhängigkeiten

| Dienst | Genutzt fuer | Datensouveraenitaet |
|--------|--------------|---------------------|
| **Mistral AI API** | Alle KI-Analysen | Mistral AI SAS, Paris, FR — EU-Hosting Default |
| **Firebase Hosting** | SPA-Auslieferung | Google Ireland Ltd. — Edge-Caches weltweit, Origin EU |
| **Firebase Cloud Functions** | Backend-Runtime | Google Ireland Ltd. — `europe-west1` |
| **Google Cloud Tasks** | Dosierter Job-Dispatch (Queue) | Google Ireland Ltd. — `europe-west1` |
| **Google Cloud Storage** | Temporaere Bild-Ablage der Queue | Google Ireland Ltd. — `europe-west1` |
| **Cloud Firestore** | Zaehler, Maintenance-Flag, Queue-Jobs | Google Ireland Ltd. — `europe-west1` |
| **OpenStreetMap / Nominatim** | Reverse-Geocoding (direkt vom Browser) | OpenStreetMap Foundation, UK |
| **ntfy** | Push-Benachrichtigungen bei Limit | Self-hosted oder ntfy.sh, je nach Setup |

Mistrals Sub-Prozessoren (Cloud-Provider, Compute) können temporär außerhalb der EU operieren, dann mit DSGVO-Schutzmaßnahmen nach Art. 46 (Standardvertragsklauseln). Aktuelle Liste im [Mistral Trust Center](https://trust.mistral.ai/subprocessors).

## SUBJECT-Klassifikation

Mistrals Describe-Prompt enthält das `mistralDescribeAddendum`, das eine `SUBJECT:`-Kopfzeile als erste Zeile der Antwort erzwingt:

```
SUBJECT: ANIMAL_ONLY | HUMAN | MIXED | OTHER

<Bildbeschreibung Fliesstext...>

Sichtbarer Text: <Text 1>; <Text 2>; ...
```

`animal.js:classifyDescription()` parst die SUBJECT-Zeile und routet:
- `ANIMAL_ONLY` → Tier-Easter-Egg-Pfad (Profile aus `animals.js`, keine zweite KI-Anfrage)
- `HUMAN` / `MIXED` / `OTHER` → Normaler Profil-Pfad im 3-Call-Fallback (Mistral Small 4); aktiv laeuft alles ueber Large 3

Bei fehlender SUBJECT-Zeile fällt das System fail-safe auf `HUMAN` zurück — d.h. kein versehentliches Easter-Egg bei kaputter Mistral-Antwort.

## Fehler-Handling

Da es keine alternativen KI-Provider mehr gibt:

| Mistral-Antwort | Reaktion |
|---|---|
| 200 OK mit Beschreibung | Normale Pipeline weiter |
| 200 OK mit leerem Body | `blocked.safetyFilter` |
| HTTP 429 (Rate-Limit) | `blocked.overloaded` (intern: 2 Retries mit Exponential Backoff) |
| HTTP 5xx oder Timeout | `blocked.apiError` |
| Profile-JSON nicht parsbar | `json-repair.js` → wenn 4 Stufen scheitern: Mistral Large 3 als interner Backup; wenn auch fällt: `blocked.profileBlocked` |

Der User sieht in allen Blocked-Fällen eine erklärende Meldung statt eines internen Server-Fehlers. Das `blockedReason`-Feld in der Response erlaubt frontend-seitiges Mapping zu i18n-Strings.

## JSON-Repair-Strategie

Mistral-API liefert gelegentlich invalides JSON (max-tokens-Truncation, unescapte Inner-Quotes, unescapte Control-Chars). `json-repair.js` versucht in 4 Stufen:

1. **Direkter Parse** — `JSON.parse()` ohne Aenderung.
2. **Heuristik** — Markdown-Fences entfernen, Smart-Quotes ASCII-ifizieren, Trailing-Commas, Control-Chars und Inner-Quotes escapen, Slice zum letzten `}`.
3. **json5-Toleranz** — `json5.parse()` toleriert Trailing-Commas, Single-Quotes, Comments.
4. **Truncation-Recovery** — Stack-basierte Suche nach dem letzten sauber geschlossenen Wert, Auffuellen der offenen Brackets in umgekehrter Reihenfolge.

Bei Misserfolg in allen 4 Stufen: `null` zurueck — der Aufrufer in `mistral.js` faellt dann auf den Mistral-internen Large-3-Backup zurueck.

## Sicherheits-Architektur

- **CSP** auf `firebase.json` — nur self + OpenStreetMap-Tiles + Nominatim + `/api/…` (gleiche Domain)
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
- CSP nur self + OpenStreetMap Tiles + Nominatim + `/api/…` (gleiche Domain)
- Keine dauerhafte Persistenz: im Queue-Betrieb liegt das Bild kurz im GCS-Bucket und wird unmittelbar nach der Verarbeitung gelöscht; das Job-Dokument spätestens nach 2 h
- Anwendungs-Logs enthalten keine Bildinhalte und keine personenbezogenen Daten — nur Request-ID, Step-Name, Status, Token-Counts
