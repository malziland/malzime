# Setup — malziME

## Voraussetzungen

- Node.js 24+
- Firebase CLI: `npm i -g firebase-tools`
- Google Cloud Projekt mit aktivierter Abrechnung
- Firebase Projekt verknuepft mit dem GCP Projekt

## 1. Firebase Projekt konfigurieren

```bash
firebase login
firebase use --add   # Projekt-ID waehlen
```

## 2. Mistral AI einrichten

malziME nutzt seit v1.6.0 ausschliesslich Mistral AI fuer KI-Analysen.

1. Account erstellen auf [console.mistral.ai](https://console.mistral.ai/)
2. Stripe-Karte hinterlegen, **Scale Tier** aktivieren (Free Tier reicht NICHT fuer Image-Calls auf Small 4 — Limit 50 K TPM)
3. API-Key generieren unter https://console.mistral.ai/api-keys/ — Key NUR EINMAL angezeigt, sofort sichern
4. Key spaeter als Firebase Secret hinterlegen (Schritt 4)

Genutzte Modelle (in `functions/src/config.js`):
- `mistral-large-2512` fuer die aktive **Single-Large-Analyse** (ein Call → Bildbeschreibung + beide Profile, seit v2.2)
- `mistral-small-2603` fuer die Profilgenerierung in der **Fallback-3-Call-Pipeline** (Text-only)
- `mistral-large-2512` zusaetzlich als internes JSON-Backup, falls Small invalides JSON liefert

Umschaltbar ueber das Firestore-Feature-Flag `featureFlags/current.useSingleLargeCall` (aktiv = Single-Large).

Wenn der Mistral-Call fehlschlaegt, gibt es keinen anderen KI-Provider als Fallback. Der User sieht eine `blocked.apiError`- oder `blocked.overloaded`-Antwort.

## 3. Google Cloud (nur fuer Infrastruktur)

Im [Google Cloud Console](https://console.cloud.google.com) brauchst du diese APIs zusaetzlich zu Firebase:

- **Cloud Firestore** — Analyse-Zaehler, Maintenance-Flag und Queue-Jobs (wird automatisch mit Firebase aktiviert)
- **Cloud Tasks** — Warteschlange fuer die Analyse-Jobs (seit v2.0)
- **Cloud Storage** — temporaere Bild-Ablage der Queue (seit v2.0)

Cloud Vision API und Vertex AI werden seit v1.6.0 NICHT mehr genutzt — falls vorher aktiviert, kannst du sie im Cloud Console deaktivieren (sparen Kosten, nicht zwingend).

Region: `europe-west1` (Belgien, EU)

## 3a. Queue-Architektur (v2.0)

Seit v2.0 läuft die Analyse über eine Cloud-Tasks-Warteschlange — Details in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Eingerichtet sind:

- Cloud-Tasks-Queue `analyze-queue` (`europe-west1`, `maxConcurrentDispatches` an Mistrals Limits angepasst)
- GCS-Bucket `malzime-queue-uploads` fuer die temporaere Bild-Ablage (Lifecycle-Regel: 1 Tag)
- Firestore-Feature-Flag `featureFlags/current.useQueue` — schaltet zwischen Queue und synchronem `/analyze`-Pfad, **ohne Deploy** (zentraler Betriebsschalter)

Lokaler Durchklick der Queue ohne Cloud Tasks: [`docs/QUEUE-EMULATOR.md`](QUEUE-EMULATOR.md).

## 4. Dependencies installieren

```bash
# Backend
cd functions && npm install && cd ..

# Frontend-Tests + Linting (Vitest, ESLint, Prettier)
npm install
```

## 5. Umgebungsvariablen

Kopiere `functions/.env.example` nach `functions/.env` und passe die Werte an:

```bash
cp functions/.env.example functions/.env
```

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `GCLOUD_PROJECT` | (auto-detect) | Google Cloud Projekt-ID (fuer Firestore) |

### Firebase Secrets

Die folgenden Secrets werden ueber `firebase functions:secrets:set` konfiguriert:

```bash
firebase functions:secrets:set ADMIN_SECRET    # Beliebiger Token fuer Admin-Endpunkte
firebase functions:secrets:set MISTRAL_API_KEY # Key aus console.mistral.ai (Scale Tier)
firebase functions:secrets:set NTFY_URL        # ntfy Server-URL (z.B. https://ntfy.example.com)
firebase functions:secrets:set NTFY_TOPIC      # ntfy Topic-Name
```

Beim Setzen des Mistral-Keys WICHTIG: `printf` statt `echo` benutzen, damit kein trailing Newline im Secret-Wert landet:

```bash
printf "%s" "DEIN_MISTRAL_KEY" | firebase functions:secrets:set MISTRAL_API_KEY --data-file=-
```

| Secret | Pflicht | Beschreibung |
|--------|---------|--------------|
| `ADMIN_SECRET` | Ja | Bearer-Token fuer Admin-Endpunkte (Boost, Reset) |
| `MISTRAL_API_KEY` | Ja (seit v1.5.2) | Mistral AI API-Key fuer Hybrid-Provider |
| `NTFY_URL` | Nein | URL des ntfy-Servers fuer Push-Benachrichtigungen |
| `NTFY_TOPIC` | Nein | ntfy-Topic fuer Limit-Benachrichtigungen |

Wenn `NTFY_URL` oder `NTFY_TOPIC` leer sind, werden keine Push-Benachrichtigungen gesendet.

Hinweis: `MISTRAL_API_KEY` ist Pflicht — Mistral ist seit v1.6.0 der einzige KI-Anbieter. Fehlt der Key, schlagen alle Analyse-Anfragen mit einer blockierten Antwort fehl (kein Fallback-Anbieter).

## 5. Lokal testen

```bash
firebase emulators:start --only functions,hosting
```

Dann: http://localhost:5000

**Hinweis**: Damit die Analyse-Pipeline lokal funktioniert, muss `MISTRAL_API_KEY` in `functions/.env` gesetzt sein (siehe `functions/.env.example`). Der Firestore-Emulator startet automatisch mit, ein Google-Login ist fuer die lokale Entwicklung nicht noetig.

## 6. Tests ausfuehren

```bash
# Backend (Jest)
cd functions && npm test

# Frontend (Vitest + jsdom)
npm run test:frontend
```

**Backend (432 Tests):** HTTP-Handler, Admin-Endpunkte, Stats-Handler, HMAC-Auth, Nonce-Flow, Tier-Erkennung, Config, Counter, Middleware (Rate Limiting), Privacy-Risiken, Upload-Parsing, Magic-Byte-Validierung, XML-Escaping, ntfy-Benachrichtigungen, i18n-Guardian, Mistral-Integration (Mocked-Fetch), JSON-Repair (4-Stufen), Throttle-Semaphore, Queue (Job-Lebenszyklus, Reaper, Feature-Flag, Cloud-Tasks-Anbindung, Abhol-Ticket).
**Frontend (155 Tests):** DOM-Helpers, State, Scan-Animation, Disclaimer-Modal, Limit-Banner, Maintenance-Modal, Geocoding, Render-Pipeline, API-Integration (synchron + Queue), Queue-Reload-Wiederherstellung, Stats-Seite, i18n-Modul, i18n-Guardian.
**E2E (2 Tests):** Playwright Smoke-Tests — Demo-Flow + fehlerfreies Laden.

## 7. Linting + Formatting

```bash
# Backend
cd functions && npm run lint
cd functions && npm run format:check

# Frontend
npm run lint:frontend
npm run format:frontend:check
```

CI prueft Lint + Format automatisch bei jedem Push und Pull Request.

## 7a. Tiererkennung testen (Dev-Tool)

Die Tiererkennung in v1.6.0 haengt daran, dass Mistral Large 3 in der Bildbeschreibung eine `SUBJECT:`-Kopfzeile (`ANIMAL_ONLY | HUMAN | MIXED | OTHER`) liefert. Mit `functions/scripts/test-subject.js` laesst sich gegen echte Bilder pruefen, ob Mistral diese Kopfzeile zuverlaessig setzt — ohne Deploy.

**Aufruf:**

```bash
MISTRAL_API_KEY=<dein-key> node functions/scripts/test-subject.js <pfad-zum-bild> [anzahl-durchlaeufe]
```

**Was es tut:**

- Verkleinert das Bild wie das Live-Frontend (1280px / JPEG 82%, via `sips` auf macOS).
- Ruft genau den v1.6.0-Pfad auf: `mistral.describeImage()` + `classifyDescription()` + `extractVisibleText()`.
- Zeigt pro Durchlauf die gelieferte `SUBJECT:`-Zeile, die Einordnung (Mensch/Tier/Tierart) und den sichtbaren Text.
- Bei mehreren Durchlaeufen: Verteilung am Ende — so wird Run-to-Run-Varianz sichtbar.

**Was es nicht tut:**

- Schreibt nichts in Firestore, beruehrt das Live-System nicht.
- Generiert keine Profile — nur die Describe- + Klassifikations-Stufe.

**Voraussetzung:** `MISTRAL_API_KEY` als Umgebungsvariable gesetzt.

## 8. Deploy

```bash
# Alles
firebase deploy --only functions,hosting

# Nur Frontend (nach CSS/JS-Aenderungen)
firebase deploy --only hosting

# Nur Backend (nach Functions-Aenderungen)
firebase deploy --only functions
```

**Wichtig**: Nach Frontend-Aenderungen den Cache-Buster in `public/index.html` hochzaehlen:
```html
<link rel="stylesheet" href="./styles.css?v=2026021608" />
<!-- ... -->
<script type="module" src="./app.js?v=2026021608"></script>
```

Format: `?v=YYYYMMDDNN` (Datum + laufende Nummer)

## Kosten

### Was pro Analyse passiert

| API | Aufrufe | Was |
|-----|---------|-----|
| **Mistral Large 3** | 1 Call | multimodale Bildbeschreibung mit SUBJECT-Klassifikation + sichtbarem Text |
| **Mistral Small 4** | 2 Calls | Profilgenerierung (Normal + Boost, parallel, Text-only) |
| **Cloud Functions** | 1 Invocation | ~3–8 Sekunden, 512 MiB RAM |

Bei Tier-Erkennung (SUBJECT=ANIMAL_ONLY) entfaellt der Small-4-Profile-Call — das Easter-Egg-Profil wird aus statischen Locale-Daten gebaut.

### Preise (Stand Mai 2026)

**Mistral Scale Tier** (pro 1M Tokens):

| Modell | Input | Output |
|--------|-------|--------|
| Large 3 (`mistral-large-2512`) | $0.50 | $1.50 |
| Small 4 (`mistral-small-2603`) | $0.15 | $0.60 |

**Google Cloud (nur Infrastruktur):**

| Posten | Preis | Kostenlos/Monat |
|--------|-------|-----------------|
| Firebase Hosting | $0.15 / GB Transfer | 10 GB/Monat |
| Cloud Functions | nutzungsbasiert | 2 Mio. Aufrufe/Monat |
| Cloud Firestore | nutzungsbasiert | 50 K Reads/Tag, 20 K Writes/Tag |

### Rechenbeispiel: Workshop mit 30 Teilnehmer:innen

| Posten | Rechnung | Kosten |
|--------|----------|--------|
| Mistral Large 3 (Describe) | 30 × ~10.000 Input + ~1.500 Output Tokens = 300K in, 45K out | **~$0.22** |
| Mistral Small 4 (Profile, 2x) | 30 × 2 × ~2.500 Input + ~2.500 Output = 150K in, 150K out je | **~$0.13** |
| Cloud Functions | 30 Aufrufe × ~5s | **$0.00** |
| Firebase Hosting | Statische Dateien, wenige MB | **$0.00** |
| **Gesamt** | | **~$0.35** |

Mistral berechnet pro 1M Tokens unabhaengig vom Volumen, kein Frei-Kontingent. Die Describe-Stage laeuft ueber Mistral Large 3, die beiden Profile ueber das guenstigere Small 4.

### Tipp fuer neue Google Cloud Konten

Neue Konten erhalten $300 Startguthaben — damit lassen sich tausende Analysen durchfuehren.

## Privacy-Architektur

Die Privacy-Architektur ist ein Kernbestandteil des Projekts:

1. **EXIF im Browser**: Die Library exifr (self-hosted unter `public/lib/exifr/`) parsed Metadaten client-seitig
2. **GPS bleibt lokal**: GPS-Koordinaten werden nie an den Server gesendet. Geocoding (Nominatim) wird direkt vom Browser aufgerufen
3. **Server bekommt**: Komprimiertes Bild (max 1280px, JPEG 0.82) + Kamera-Hersteller/Modell. Kein GPS, kein dateTimeOriginal.
4. **Keine dauerhafte Speicherung**: Im Queue-Betrieb liegt das Bild nur kurz zur Verarbeitung im EU-Storage und wird unmittelbar danach geloescht; das Job-Dokument spaetestens nach 2 h. Im synchronen Pfad bleibt das Bild im RAM
5. **Keine externen Scripts**: Fonts, Leaflet und exifr sind self-hosted. Kein CDN, kein Google Fonts, kein Firebase SDK im Frontend
6. **Bot-Schutz ohne Tracking**: Rate Limiting (IP-basiert), Honeypot-Feld, Timing-Check. Kein reCAPTCHA.

## CI/CD

GitHub Actions Workflow:
- **`ci.yml`** — Tests + Lint + Format + Secret-Scan bei jedem Push und Pull Request

Deploy ist manuell per `firebase deploy` (kein automatisches Deployment via CI).

## Eigene Instanz aufsetzen (Fork)

Falls du malziME auf deinem eigenen Firebase-Projekt betreiben willst: [`docs/SELF-HOSTING.md`](SELF-HOSTING.md) enthaelt eine vollstaendige Schritt-fuer-Schritt-Anleitung mit allen Stellen die angepasst werden muessen (CORS, Domains, Impressum, CI/CD, etc.).

## Mehrsprachigkeit (i18n)

malziME hat ein vollstaendiges i18n-System. Alle UI-Texte, KI-Prompts und Tier-Profile sind in Locale-Dateien ausgelagert.

### Aufbau

```
public/locales/                Frontend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de.json                      Deutsche UI-Strings

functions/src/locales/         Backend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de/prompts.js                Deutsche KI-Prompts (System-Prompts, Schemas)
  de/animals.js                Deutsche Tier-Easter-Egg-Profile
```

### Wie es funktioniert

1. **Frontend**: `public/js/i18n.js` laedt beim Start `manifest.json` und die passende Locale-Datei. HTML-Elemente mit `data-i18n`-Attributen werden automatisch uebersetzt. Die `t()`-Funktion liefert Strings per Key.
2. **Backend**: `functions/src/i18n.js` stellt `loadPrompts(lang)` und `loadAnimals(lang)` bereit. Der `lang`-Parameter kommt vom Client im Request-Body.
3. **Spracherkennung**: `?lang=XX` URL-Parameter > Browser-Sprache > Default (`de`)

### Neue Sprache hinzufuegen

1. Frontend: `public/locales/XX.json` erstellen (Kopie von `de.json`, Werte uebersetzen)
2. Backend: `functions/src/locales/XX/prompts.js` + `XX/animals.js` erstellen
3. Sprachcode in beide `manifest.json` eintragen
4. Tests ausfuehren — die i18n-Guardian-Tests pruefen automatisch auf fehlende Strings

### Testen

Sprache per URL-Parameter testen: `https://malzi.me/?lang=XX`

## Hinweise

- IP-basierte Rate Limits sind in-memory (pro Cloud Functions Instanz). Das globale Stundenlimit verwendet Firestore und ist instanzuebergreifend
- Logs enthalten nur Request-ID, Status und Modell-Info — keine Bilddaten
- Wenn Mistral die Bildbeschreibung verweigert (z.B. bei Grenzfall-Bildern), versucht der Code automatisch einen zweiten, weniger triggernden Prompt. Schlaegt auch der fehl, bekommt der User eine blockierte Antwort
