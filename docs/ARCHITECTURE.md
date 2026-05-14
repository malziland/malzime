# Architektur — malziME

Dieses Dokument beschreibt die End-to-End-Architektur von malziME ab Version 1.6.0 (Mistral-only Pipeline).

## Aktueller Stand

Seit v1.6.0 läuft die komplette KI-Analyse über Mistral AI (Paris, EU). Google-KI-Dienste (Vertex AI Gemini, Cloud Vision API) sind aus der Pipeline entfernt. Google ist nur noch für die Infrastruktur-Schicht zuständig: Firebase Hosting + Cloud Functions + Firestore, alles in `europe-west1` (Belgien).

| Phase | Primaer | Modell | Region |
|-------|---------|--------|--------|
| Describe (Bildbeschreibung) | Mistral AI | `mistral-large-latest` (Large 3) | EU-Default |
| Profile (Normal + Boost) | Mistral AI | `mistral-small-2603` (Small 4) | EU-Default |
| Profile-Fallback (intern) | Mistral AI | `mistral-large-latest` (Large 3) | EU-Default |
| Hosting + Functions + DB | Google | Firebase | `europe-west1` |

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
│  POST /analyze {imageBase64, mimeType, exif:{make,model}, lang}    │
└────────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ↓ HTTPS, eu-west1
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Function "analyze" (europe-west1, Node 24, 512 MiB)         │
│                                                                    │
│  1. Validation in handle-analyze.js                                │
│     ├─ Maintenance-Mode-Check (Firestore, 30s Cache)              │
│     ├─ Rate-Limit (IP-basiert, 200/10min, In-Memory pro Instanz)  │
│     ├─ Honeypot + MIME + Magic-Byte-Validierung                   │
│     └─ Hourly-Limit-Check (Firestore, 500/Stunde rollendes Fenster)│
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

## Komponenten-Verantwortlichkeiten

### Frontend (`public/`)

| Modul | Verantwortlich fuer |
|-------|---------------------|
| `app.js` | Entry Point, Event-Bindings, Pipeline-Coordinator |
| `js/exif.js` | EXIF-Extraktion via exifr (lokal im Browser) |
| `js/geocoding.js` | Nominatim Reverse-Geocoding (direkter Browser-Call) |
| `js/api.js` | API-Client mit AbortController + Stale-Guard |
| `js/render.js` | Profile-Rendering, Bias-Toggle, Privacy-Cards, Karte |
| `js/ui.js` | Disclaimer-Modal, Maintenance-Modal, Limit-Banner, Scan-Animation |
| `js/state.js` | Globaler State (`requestId`, `isAnalyzing`) |
| `js/i18n.js` | i18n Micro-Modul (`initI18n`, `t`, `applyTranslations`) |
| `js/demo.js` | Demo-Bild-Logik (Stock-Fotos durch echte KI schicken) |
| `js/stats.js` | Stats-Seite mit Limit-Balken + Countdown |
| `js/dom.js` | DOM-Helpers (`escapeHtml`, sanitize) |

### Backend (`functions/src/`)

| Modul | Verantwortlich fuer |
|-------|---------------------|
| `index.js` | Cloud-Function-Exports, Secret-Deklarationen (`ADMIN_SECRET`, `MISTRAL_API_KEY`, `NTFY_*`) |
| `handle-analyze.js` | Mistral-only Pipeline: Validation → Mistral Describe → SUBJECT → Easter-Egg / Profile-Gen |
| `handle-stats.js` | GET-only Stats-Endpunkt |
| `handle-admin.js` | Admin-Endpunkte (Boost, Reset, Maintenance) — 3-Schritt-Flow mit HMAC + Nonce |
| `config.js` | Konstanten, Mistral-Modell-IDs, Limits |
| `mistral.js` | Mistral AI Hybrid — Large 3 Describe + Small 4 Profile, mit Mistral-internem Large-3-Backup |
| `json-repair.js` | Defensiver JSON-Parser (direkt → heuristisch → json5 → Truncation-Recovery) |
| `throttle.js` | In-Memory-Semaphore gegen Mistral-Bursts (gebaut, noch nicht aktiviert) |
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
| **Cloud Firestore** | Zaehler, Maintenance-Flag | Google Ireland Ltd. — `europe-west1` |
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
- `HUMAN` / `MIXED` / `OTHER` → Normaler Profil-Pfad (Mistral Small 4)

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

- **CSP** auf `firebase.json` — nur self + OpenStreetMap-Tiles + Nominatim
- **HSTS** mit Preload
- **Magic-Byte-Validierung** der hochgeladenen Bilder
- **Honeypot-Feld** + **Timing-Check** als Bot-Defense
- **HMAC-signierte Admin-Tokens** mit Nonce-Replay-Schutz (SEC-001/SEC-002)
- **escapeXml()** auf alle dynamischen Prompt-Inhalte (SEC-003)
- **Output-Bounds** auf Profil-Strings (max 800 chars / Kategorie, SEC-004)
- **Maintenance-Kill-Switch** via Firestore-Doc (30s Cache)
- **Per-Instance-Throttle** (gebaut in `throttle.js`, nicht angebunden — Aktivierung bei Bedarf)

## Privacy-Architektur

- EXIF wird client-seitig extrahiert (exifr im Browser)
- GPS verlaesst NIEMALS den Browser — Nominatim wird direkt vom Client aufgerufen
- Server bekommt nur: komprimiertes Bild + Kamera-make/model (KEIN GPS, KEIN dateTimeOriginal)
- Keine externen Scripts: alles self-hosted (Fonts, Leaflet, exifr)
- CSP nur self + OpenStreetMap Tiles + Nominatim
- Keine Persistenz: Bilder und Profile bleiben im RAM, alles wird verworfen
- Anwendungs-Logs enthalten keine Bildinhalte und keine personenbezogenen Daten — nur Request-ID, Step-Name, Status, Token-Counts
