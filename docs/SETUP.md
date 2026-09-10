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
2. Stripe-Karte hinterlegen, **Scale Tier** aktivieren (die Limits des Free Tier reichen fuer den Betrieb nicht)
3. API-Key generieren unter https://console.mistral.ai/api-keys/ — Key NUR EINMAL angezeigt, sofort sichern
4. Key spaeter als Firebase Secret hinterlegen (Schritt 4)

Genutztes Modell (in `functions/src/config.js`): `mistral-large-2512`. Ein Aufruf liefert Bildbeschreibung + beide Profile (seit v2.2), ein zweiter, kleiner Aufruf ohne Bild die Beast-Werbung (seit v2.8). Einen zweiten Analyseweg mit einem anderen Modell gibt es seit 10.09.2026 nicht mehr.

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
- Firestore-Feature-Flags im Dokument `featureFlags/current` (Uebersicht in [`FLAGS.md`](FLAGS.md)) — umlegbar **ohne Deploy**

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

Die Secrets tragen seit 09.09.2026 das Suffix `_EU` und werden mit `gcloud`
angelegt, **nicht** mit `firebase functions:secrets:set` — das Firebase-Kommando
legt Secrets weltweit repliziert an, und diese Einstellung laesst sich
nachtraeglich nicht aendern. So bleiben sie in `europe-west1`:

```bash
for s in ADMIN_SECRET_EU MISTRAL_API_KEY_EU NTFY_URL_EU NTFY_TOPIC_EU; do
  gcloud secrets create "$s" --replication-policy=user-managed --locations=europe-west1
done
printf "%s" "DEIN_ADMIN_TOKEN"  | gcloud secrets versions add ADMIN_SECRET_EU    --data-file=-
printf "%s" "DEIN_MISTRAL_KEY"  | gcloud secrets versions add MISTRAL_API_KEY_EU --data-file=-
printf "%s" "https://ntfy.example.com" | gcloud secrets versions add NTFY_URL_EU --data-file=-
printf "%s" "dein-topic"        | gcloud secrets versions add NTFY_TOPIC_EU      --data-file=-
```

WICHTIG: `printf` statt `echo`, damit kein Zeilenumbruch im Secret-Wert landet.
Das Laufzeit-Dienstkonto der Functions braucht auf jedem Secret die Rolle
`roles/secretmanager.secretAccessor`.

| Secret | Pflicht | Beschreibung |
|--------|---------|--------------|
| `ADMIN_SECRET_EU` | Ja | Bearer-Token fuer Admin-Endpunkte (Boost, Reset, Wartungsmodus) |
| `MISTRAL_API_KEY_EU` | Ja | Mistral AI API-Key |
| `NTFY_URL_EU` | Nein | URL des ntfy-Servers fuer Push-Benachrichtigungen |
| `NTFY_TOPIC_EU` | Nein | ntfy-Topic fuer Limit-Benachrichtigungen |

Wenn `NTFY_URL_EU` oder `NTFY_TOPIC_EU` leer sind, werden keine Push-Benachrichtigungen gesendet.

Hinweis: `MISTRAL_API_KEY_EU` ist Pflicht — Mistral ist seit v1.6.0 der einzige KI-Anbieter. Fehlt der Key, schlagen alle Analyse-Anfragen mit einer blockierten Antwort fehl (kein Fallback-Anbieter).

## 5. Lokal testen

```bash
firebase emulators:start --only functions,hosting
```

Dann: http://localhost:5050

**Hinweis**: Damit die Analyse-Pipeline lokal funktioniert, muss `MISTRAL_API_KEY` in `functions/.env` gesetzt sein (siehe `functions/.env.example`). Der Firestore-Emulator startet automatisch mit, ein Google-Login ist fuer die lokale Entwicklung nicht noetig.

## 6. Tests ausfuehren

```bash
# Backend (Jest)
cd functions && npm test

# Frontend (Vitest + jsdom)
npm run test:frontend
```

**Backend** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): HTTP-Handler, Admin-Endpunkte, Stats-Handler, HMAC-Auth, Nonce-Flow, Tier-Erkennung, Config, Counter, Middleware (Rate Limiting), Privacy-Risiken, Upload-Parsing, Magic-Byte-Validierung, XML-Escaping, ntfy-Benachrichtigungen, i18n-Guardian, Mistral-Integration (Mocked-Fetch), JSON-Repair (4-Stufen), Throttle-Semaphore, Queue (Job-Lebenszyklus, Reaper, Feature-Flag, Cloud-Tasks-Anbindung, Abhol-Ticket).
**Frontend** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): DOM-Helpers, State, Scan-Animation, Limit-Banner, Maintenance-Modal, Geocoding, Render-Pipeline, API-Integration, Warteschlange samt Wiederaufnahme, Stats-Seite, i18n-Modul, i18n-Guardian.
**E2E** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): Playwright Smoke-, A11y- und Tastatur-Tests — Demo-Flow, fehlerfreies Laden, axe-A11y-Gate (Startseite + Profil-Ansicht), Tastatur-Durchlauf.

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
| **Mistral Large 3** | 1 Call | Bildbeschreibung, SUBJECT-Klassifikation, sichtbarer Text und beide Profile |
| **Mistral Large 3** | 1 Call | Beast-Werbung (ohne Bild, seit v2.8) |
| **Cloud Functions** | 1 Invocation | Dauer haengt an der Mistral-Antwortzeit (zuletzt gemessen rund 40 s), 512 MiB RAM |

Bei Tier-Fotos (SUBJECT=ANIMAL_ONLY) entfaellt der zweite Aufruf — das Easter-Egg-Profil wird aus statischen Locale-Daten gebaut.

### Preise (Stand Mai 2026)

**Mistral Scale Tier** (pro 1M Tokens):

| Modell | Input | Output |
|--------|-------|--------|
| Large 3 (`mistral-large-2512`) | $0.50 | $1.50 |

**Google Cloud (nur Infrastruktur):**

| Posten | Preis | Kostenlos/Monat |
|--------|-------|-----------------|
| Firebase Hosting | $0.15 / GB Transfer | 10 GB/Monat |
| Cloud Functions | nutzungsbasiert | 2 Mio. Aufrufe/Monat |
| Cloud Firestore | nutzungsbasiert | 50 K Reads/Tag, 20 K Writes/Tag |

### Rechenbeispiel: Workshop mit 30 Teilnehmer:innen

| Posten | Rechnung | Kosten |
|--------|----------|--------|
| Mistral Large 3 (Analyse + Werbe-Aufruf) | 30 Analysen, gemessen am 30.08.2026 mit Prompt-Cache | **rund $0.20–0.25** (unter 1 Cent je Analyse) |
| Cloud Functions | 30 Aufrufe × ~1 Min. | **$0.00** |
| Firebase Hosting | Statische Dateien, wenige MB | **$0.00** |
| **Gesamt** | | **rund $0.20–0.25** |

Mistral berechnet pro 1M Tokens unabhaengig vom Volumen, kein Frei-Kontingent. Beide Aufrufe laufen ueber Mistral Large 3; der gleichbleibende Prompt-Anfang wird zum Cache-Preis (10 %) berechnet. Die Schätzung ist gerundet; die genauen Kosten zeigt das eigene Mistral-Konto.

### Tipp fuer neue Google Cloud Konten

Neue Konten erhalten $300 Startguthaben — damit lassen sich tausende Analysen durchfuehren.

## Privacy-Architektur

Die Privacy-Architektur ist ein Kernbestandteil des Projekts:

1. **EXIF im Browser**: Die Library exifr (self-hosted unter `public/lib/exifr/`) parsed Metadaten client-seitig
2. **GPS bleibt lokal**: GPS-Koordinaten werden nie an den Server gesendet. Geocoding (Nominatim) wird direkt vom Browser aufgerufen
3. **Server bekommt**: Komprimiertes Bild (max 1280px, JPEG 0.82) + Kamera-Hersteller/Modell. Kein GPS, kein dateTimeOriginal.
4. **Keine dauerhafte Speicherung**: Im Queue-Betrieb liegt das Bild nur kurz zur Verarbeitung im EU-Storage und wird unmittelbar danach geloescht; das Job-Dokument spaetestens nach 2 h. Das Bild bleibt nie länger als nötig im Speicher
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
