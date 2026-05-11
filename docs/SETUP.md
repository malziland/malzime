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

## 2. Google Cloud APIs aktivieren

Im [Google Cloud Console](https://console.cloud.google.com):

- **Cloud Vision API** — Texterkennung + Label-Erkennung
- **Vertex AI API** — Gemini Multimodal (Bildbeschreibung + Profilerstellung)
- **Cloud Firestore** — Analyse-Zaehler + Stundenlimit (automatisch mit Firebase aktiviert)

Region: `europe-west1` (Belgien, EU)

**Wichtig**: Die EU Vision API (`eu-vision.googleapis.com`) unterstuetzt nur `TEXT_DETECTION` und `LABEL_DETECTION`. Andere Features wie `FACE_DETECTION` oder `OBJECT_LOCALIZATION` sind nicht verfuegbar und wuerden den gesamten API-Call crashen.

## 3. Dependencies installieren

```bash
# Backend
cd functions && npm install && cd ..

# Frontend-Tests + Linting (Vitest, ESLint, Prettier)
npm install
```

## 4. Umgebungsvariablen

Kopiere `functions/.env.example` nach `functions/.env` und passe die Werte an:

```bash
cp functions/.env.example functions/.env
```

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `VERTEX_LOCATION` | `europe-west1` | Vertex AI Region |
| `GCLOUD_PROJECT` | (auto-detect) | Google Cloud Projekt-ID |

Fuer den EU-Endpoint der Vision API: In `functions/src/vision.js` wird `eu-vision.googleapis.com` verwendet.

### Firebase Secrets

Die folgenden Secrets werden ueber `firebase functions:secrets:set` konfiguriert:

```bash
firebase functions:secrets:set ADMIN_SECRET    # Beliebiger Token fuer Admin-Endpunkte
firebase functions:secrets:set NTFY_URL        # ntfy Server-URL (z.B. https://ntfy.example.com)
firebase functions:secrets:set NTFY_TOPIC      # ntfy Topic-Name
```

| Secret | Pflicht | Beschreibung |
|--------|---------|--------------|
| `ADMIN_SECRET` | Ja | Bearer-Token fuer Admin-Endpunkte (Boost, Reset) |
| `NTFY_URL` | Nein | URL des ntfy-Servers fuer Push-Benachrichtigungen |
| `NTFY_TOPIC` | Nein | ntfy-Topic fuer Limit-Benachrichtigungen |

Wenn `NTFY_URL` oder `NTFY_TOPIC` leer sind, werden keine Push-Benachrichtigungen gesendet.

## 5. Lokal testen

```bash
firebase emulators:start --only functions,hosting
```

Dann: http://localhost:5000

**Hinweis**: Fuer die lokale Entwicklung muss `gcloud auth application-default login` ausgefuehrt werden, damit die Vertex AI und Vision APIs funktionieren.

## 6. Tests ausfuehren

```bash
# Backend (Jest)
cd functions && npm test

# Frontend (Vitest + jsdom)
npm run test:frontend
```

**Backend (266 Tests):** HTTP-Handler, Admin-Endpunkte, Stats-Handler, HMAC-Auth, Nonce-Flow, Tier-Erkennung, Config, Counter, Middleware (Rate Limiting), Privacy-Risiken, Upload-Parsing, Vision API, Magic-Byte-Validierung, XML-Escaping, ntfy-Benachrichtigungen, i18n-Guardian, Gemini-Integration.
**Frontend (139 Tests):** DOM-Helpers, State, Scan-Animation, Disclaimer-Modal, Limit-Banner, Maintenance-Modal, Geocoding, Render-Pipeline, API-Integration, Stats-Seite, i18n-Modul, i18n-Guardian.
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

## 7a. Modellvergleich (Dev-Tool)

Wenn du verschiedene Gemini-Modelle gegeneinander testen willst — z.B. um zu beurteilen, ob ein neues Modell die alte Qualitaet erreicht oder uebertrifft — gibt es `functions/scripts/compare-models.js`. Das Skript faehrt die komplette malzime-Pipeline (Vision API + Bildbeschreibung + Normal-Profil + Boost-Profil) parallel mit zwei Modellen durch und erzeugt einen HTML-Vergleichsbericht.

**Aufruf:**

```bash
node functions/scripts/compare-models.js <pfad-zum-bild>
```

Drag&Drop unter macOS funktioniert: Befehl mit Leerzeichen am Ende tippen, dann Bilddatei aus dem Finder ins Terminal ziehen.

**Voraussetzungen:**

- Lokale ADC eingerichtet (`gcloud auth application-default login`).
- Vertex AI API + Vision API im Projekt aktiviert (sind sie auf einer laufenden malzime-Instanz ohnehin).

**Was es tut:**

- Schickt das Bild durch Vision API (Labels + OCR) — einmal.
- Generiert die Bildbeschreibung mit Variante A und Variante B (separate Modellketten).
- Generiert je Modell Normal- + Boost-Profil aus der jeweiligen Beschreibung.
- Misst Dauer, verbrauchte Tokens und geschaetzte Kosten.
- Schreibt `compare-result.html` ins Projekt-Root (in `.gitignore` aufgenommen — der Report enthaelt Test-Bilder und Profile, gehoert nicht ins Repo).

**Was es nicht tut:**

- Schreibt nichts in Firestore — der Stunden-Zaehler bleibt unberuehrt.
- Beruehrt das Live-System oder den Deploy nicht.
- Aendert keine Modell-Konfiguration in `functions/src/config.js`.

**Konfiguration:** Die zu vergleichenden Modelle stehen oben im Skript in der `VARIANTS`-Liste. Anpassen falls andere Modelle getestet werden sollen.

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
| **Vision API** | 1 Call, 2 Features | TEXT_DETECTION + LABEL_DETECTION |
| **Gemini 2.5 Flash** | 3 Calls | 1x Bildbeschreibung (multimodal) + 2x Profil (normal + boost, parallel) |
| **Cloud Functions** | 1 Invocation | ~5–15 Sekunden, 512 MiB RAM |

Thinking ist deaktiviert (`thinkingBudget: 0`) fuer Kostenreduktion.

### Preise (Stand Februar 2026, Vertex AI Standard Tier)

| Posten | Preis | Kostenlos/Monat |
|--------|-------|-----------------|
| Vision API (TEXT_DETECTION) | $1.50 / 1.000 Bilder | Erste 1.000 Bilder |
| Vision API (LABEL_DETECTION) | $1.50 / 1.000 Bilder | Erste 1.000 Bilder |
| Gemini 2.5 Flash Input | $0.30 / 1 Mio. Tokens | — |
| Gemini 2.5 Flash Output | $2.50 / 1 Mio. Tokens | — |
| Firebase Hosting | $0.15 / GB Transfer | 10 GB/Monat |
| Cloud Functions | nutzungsbasiert | 2 Mio. Aufrufe/Monat |

### Rechenbeispiel: Workshop mit 30 Teilnehmer:innen

| Posten | Rechnung | Kosten |
|--------|----------|--------|
| Vision API | 30 Bilder × 2 Features = 60 Units (innerhalb Frei-Kontingent) | **$0.00** |
| Gemini Input | 30 × ~5.000 Tokens = ~150.000 Tokens | **$0.05** |
| Gemini Output | 30 × ~5.000 Tokens = ~150.000 Tokens | **$0.38** |
| Cloud Functions | 30 Aufrufe × ~10s | **$0.00** |
| Firebase Hosting | Statische Dateien, wenige MB | **$0.00** |
| **Gesamt** | | **~$0.43** |

Bei kleinen Workshops (unter 1.000 Bilder/Monat) ist die Vision API komplett kostenlos. Der Hauptkostentreiber ist Gemini Output.

### Tipp fuer neue Google Cloud Konten

Neue Konten erhalten $300 Startguthaben — damit lassen sich tausende Analysen durchfuehren.

## Privacy-Architektur

Die Privacy-Architektur ist ein Kernbestandteil des Projekts:

1. **EXIF im Browser**: Die Library exifr (self-hosted unter `public/lib/exifr/`) parsed Metadaten client-seitig
2. **GPS bleibt lokal**: GPS-Koordinaten werden nie an den Server gesendet. Geocoding (Nominatim) wird direkt vom Browser aufgerufen
3. **Server bekommt**: Komprimiertes Bild (max 1280px, JPEG 0.82) + Kamera-Hersteller/Modell. Kein GPS, kein dateTimeOriginal.
4. **Keine Speicherung**: Bilder werden im RAM verarbeitet und sofort verworfen
5. **Keine externen Scripts**: Fonts, Leaflet und exifr sind self-hosted. Kein CDN, kein Google Fonts, kein Firebase SDK im Frontend
6. **Bot-Schutz ohne Tracking**: Rate Limiting (IP-basiert), Honeypot-Feld, Timing-Check. Kein reCAPTCHA.

## CI/CD

GitHub Actions Workflow:
- **`ci.yml`** — Tests + Lint + Format + Secret-Scan bei jedem Push und Pull Request

Deploy ist manuell per `firebase deploy` (kein automatisches Deployment via CI).

## Eigene Instanz aufsetzen (Fork)

Falls du malziME auf deinem eigenen Firebase-Projekt betreiben willst: [`docs/SELF-HOSTING.md`](SELF-HOSTING.md) enthaelt eine vollstaendige Schritt-fuer-Schritt-Anleitung mit allen Stellen die angepasst werden muessen (CORS, Domains, Impressum, CI/CD, etc.).

## Mehrsprachigkeit (i18n)

malziME hat ein vollstaendiges i18n-System. Alle UI-Texte, Gemini-Prompts und Tier-Profile sind in Locale-Dateien ausgelagert.

### Aufbau

```
public/locales/                Frontend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de.json                      Deutsche UI-Strings

functions/src/locales/         Backend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de/prompts.js                Deutsche Gemini-Prompts
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
- Safety-Filter von Google blockieren die Bildbeschreibung bei Kinderfotos. Der Code hat einen mehrstufigen Fallback: alternativer Prompt, dann Vision-API-Labels
- Alters-Labels der Vision API (Toddler, Baby, Infant, Newborn) werden gefiltert, da sie unzuverlaessig sind
