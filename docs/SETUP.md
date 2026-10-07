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
2. Zahlungsmittel hinterlegen und einen kostenpflichtigen Tarif aktivieren — der kostenlose
   Tarif reicht fuer Bild-Aufrufe nicht. Die Tarifnamen bei Mistral aendern sich; massgeblich
   ist das Dashboard, nicht diese Anleitung
3. API-Key generieren unter https://console.mistral.ai/api-keys/ — Key NUR EINMAL angezeigt, sofort sichern
4. Key spaeter als Firebase Secret hinterlegen (Schritt 5, Abschnitt „Firebase Secrets")

Genutztes Modell (in `functions/src/config.js`): `mistral-large-2512`. Ein Aufruf liefert Bildbeschreibung + beide Profile (seit v2.2), ein zweiter, kleiner Aufruf ohne Bild die Beast-Werbung (seit v2.8). Einen zweiten Analyseweg mit einem anderen Modell gibt es seit 10.09.2026 nicht mehr.

Wenn der Mistral-Call fehlschlaegt, gibt es keinen anderen KI-Provider als Fallback. Der User sieht eine `blocked.apiError`- oder `blocked.overloaded`-Antwort.

## 3. Google Cloud (nur fuer Infrastruktur)

Im [Google Cloud Console](https://console.cloud.google.com) brauchst du diese APIs zusaetzlich zu Firebase:

- **Cloud Firestore** — Analyse-Zaehler, Maintenance-Flag, Queue-Jobs und Einstellungssatz. Das Programm
  spricht ausschliesslich die **benannte Datenbank `malzime-eu`** in `europe-west1` an, nicht die
  Standard-Datenbank `(default)`; sie muss eigens angelegt werden (Befehl: [`SELF-HOSTING.md`](SELF-HOSTING.md), Schritt 3a)
- **Cloud Tasks** — Warteschlange fuer die Analyse-Jobs (seit v2.0)
- **Cloud Storage** — temporaere Bild-Ablage der Queue (seit v2.0)

Cloud Vision API und Vertex AI werden seit v1.6.0 NICHT mehr genutzt — falls vorher aktiviert, kannst du sie im Cloud Console deaktivieren (sparen Kosten, nicht zwingend).

Region: `europe-west1` (Belgien, EU)

## 3a. Queue-Architektur (v2.0)

Seit v2.0 läuft die Analyse über eine Cloud-Tasks-Warteschlange — Details in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Eingerichtet sind:

- Cloud-Tasks-Queue `analyze-queue` (`europe-west1`, `maxConcurrentDispatches` an Mistrals Limits angepasst)
- GCS-Bucket `malzime-queue-uploads` fuer die temporaere Bild-Ablage (Lifecycle-Regel: 1 Tag)
- Einstellungssatz im Dokument `config/betriebsprofil` — alle Betriebswerte, umstellbar **ohne Deploy**; ohne
  gueltigen Satz laeuft keine Analyse (Werte und Anlegen: [`BETRIEBSPROFILE.md`](BETRIEBSPROFILE.md))
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

Lokale Einstellungen stehen ausschliesslich in `functions/.env.local` (nicht in git, nur vom
Emulator geladen). Lege die Datei aus der Vorlage an und passe die Werte an:

```bash
cp functions/.env.local.example functions/.env.local
```

Die Vorlage startet mit der Attrappe statt der echten KI (kostenlos). Fuer Laeufe mit der
echten KI traegst du dort `MISTRAL_API_KEY` ein und setzt `MISTRAL_MOCK=0`.

**Lege keine Datei `functions/.env` an.** `firebase deploy` haengt ihren Inhalt als Einstellung
an alle Functions der Produktion — ein Schluessel stuende dort im Klartext, ein Test-Schalter
wuerde dort wirken. Das Auslieferskript bricht deshalb ab, sobald es eine solche Datei findet.

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

## 6. Lokal testen

```bash
npm run emulator   # Functions, Firestore, Hosting, Pub/Sub
# zweites Terminal — der Emulator beginnt jedes Mal mit leerer Datenbank, also auch ohne
# Einstellungssatz; ohne ihn lehnt der Einlass jede Analyse ab:
FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/lasttest-satz-anlegen.js
```

Dann: http://localhost:5050 — Einzelheiten und der Durchklick der Warteschlange stehen in
[`QUEUE-EMULATOR.md`](QUEUE-EMULATOR.md).

**Hinweis**: Mit der Attrappe aus der Vorlage laeuft die Analyse-Pipeline lokal ohne Schluessel. Fuer die echte KI muss `MISTRAL_API_KEY` in `functions/.env.local` gesetzt sein (siehe `functions/.env.local.example`). Ein Google-Login ist fuer die lokale Entwicklung nicht noetig.

## 7. Tests ausfuehren

```bash
# Backend (Jest)
cd functions && npm test

# Frontend (Vitest + jsdom)
npm run test:frontend
```

**Backend** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): HTTP-Handler, Admin-Endpunkte, Stats-Handler, HMAC-Auth, Nonce-Flow, Tier-Erkennung, Config, Counter, Middleware (Rate Limiting), Privacy-Risiken, Upload-Parsing, Magic-Byte-Validierung, XML-Escaping, ntfy-Benachrichtigungen, i18n-Guardian, Mistral-Integration (Mocked-Fetch), JSON-Repair (4-Stufen), Throttle-Semaphore, Queue (Job-Lebenszyklus, Reaper, Feature-Flag, Cloud-Tasks-Anbindung, Abhol-Ticket).
**Frontend** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): DOM-Helpers, State, Scan-Animation, Limit-Banner, Maintenance-Modal, Geocoding, Render-Pipeline, API-Integration, Warteschlange samt Wiederaufnahme, Stats-Seite, i18n-Modul, i18n-Guardian.
**E2E** (Anzahl: siehe [VERIFICATION.md](VERIFICATION.md)): Playwright Smoke-, A11y- und Tastatur-Tests — Demo-Flow, fehlerfreies Laden, axe-A11y-Gate (Startseite + Profil-Ansicht), Tastatur-Durchlauf.

## 8. Linting + Formatting

```bash
# Backend
cd functions && npm run lint
cd functions && npm run format:check

# Frontend
npm run lint:frontend
npm run format:frontend:check
```

CI prueft Lint + Format automatisch bei jedem Push und Pull Request.

## 9. Deploy

```bash
./scripts/deploy.sh            # Website + Server
./scripts/deploy.sh hosting    # nur die Website (der Server allein wird abgelehnt)
```

Das Skript prüft vorher Tests, Infrastruktur und Einstellungssatz, macht einen
Trockenlauf, zählt die Cache-Kennung (`?v=YYYYMMDDNN`) in allen ausgelieferten
Seiten selbst hoch und endet mit einer Live-Probe. Ablauf, Notschalter und
Rückweg stehen in [`RUNBOOK.md`](RUNBOOK.md). Nie direkt per `firebase deploy`
ausliefern — dann fehlen alle Riegel.

## Kosten

### Was pro Analyse passiert

| API | Aufrufe | Was |
|-----|---------|-----|
| **Mistral Large 3** | 1 Call | Bildbeschreibung, SUBJECT-Klassifikation, sichtbarer Text und beide Profile |
| **Mistral Large 3** | 1 Call | Beast-Werbung (ohne Bild, seit v2.8) |
| **Cloud Functions** | 1 Invocation | Dauer haengt an der Mistral-Antwortzeit (zuletzt gemessen rund 40 s), 512 MiB RAM |

Bei Tier-Fotos (SUBJECT=ANIMAL_ONLY) entfaellt der zweite Aufruf — das Easter-Egg-Profil wird aus statischen Locale-Daten gebaut.

### Preise (Stand Mai 2026)

**Mistral, kostenpflichtiger Tarif** (Listenpreis pro 1M Tokens):

| Modell | Input | Output |
|--------|-------|--------|
| Large 3 (`mistral-large-2512`) | $0.50 | $1.50 |

malziME ruft Mistral ueber den EU-Endpunkt auf (fest im Code, `functions/src/config.js`); dafuer
berechnet Mistral einen Aufpreis auf den Listenpreis. Massgeblich ist die Abrechnung im
eigenen Mistral-Konto.

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
2. **GPS erreicht nie unsere Server**: Die Koordinaten liest der Browser aus dem Foto und nutzt sie dort. Die Adresse zum Ort (Nominatim) und die Kartenkacheln ruft der Browser direkt bei OpenStreetMap ab — die Koordinaten verlassen das Geraet also, nur nie in Richtung malziME. Bei den Demo-Fotos fragt der Browser nichts nach aussen
3. **Server bekommt**: Komprimiertes Bild (max 1280px, JPEG 0.82) + Kamera-Hersteller/Modell. Kein GPS, kein dateTimeOriginal.
4. **Keine dauerhafte Speicherung**: Im Queue-Betrieb liegt das Bild nur kurz zur Verarbeitung im EU-Storage und wird unmittelbar danach geloescht; das Job-Dokument spaetestens nach 2 h. Das Bild bleibt nie länger als nötig im Speicher
5. **Keine externen Scripts**: Fonts, Leaflet, exifr und libheif sind self-hosted. Kein CDN, kein Google Fonts, kein Firebase SDK im Frontend
6. **Bot-Schutz ohne Tracking**: Rate Limiting (IP-basiert), Honeypot-Feld, Timing-Check. Kein reCAPTCHA.

## CI/CD

GitHub Actions Workflows:
- **`ci.yml`** — Tests + Lint + Format + Secret-Scan bei jedem Push und Pull Request
- **`sicherheit-nachts.yml`** — taeglich: npm-Luecken (beide Baeume, auch Werkzeuge),
  Herstellermeldungen zu den mitgelieferten Bibliotheken unter `public/lib`,
  Abkuendigungshinweise von GitHub. Was bei Rot zu tun ist: `docs/RUNBOOK.md`
- **`libheif-bau.yml`** — baut den HEIC-Dekoder aus den Original-Quellen nach und
  vergleicht ihn Byte fuer Byte mit `public/lib/libheif/` (bei Aenderungen daran)

Deploy ist manuell über `scripts/deploy.sh` (kein automatisches Deployment via CI).

## Eigene Instanz aufsetzen (Fork)

Falls du malziME auf deinem eigenen Firebase-Projekt betreiben willst: [`docs/SELF-HOSTING.md`](SELF-HOSTING.md) enthaelt eine vollstaendige Schritt-fuer-Schritt-Anleitung mit allen Stellen die angepasst werden muessen (CORS, Domains, Impressum, CI/CD, etc.).

## Mehrsprachigkeit (i18n)

malziME hat ein vollstaendiges i18n-System. Alle UI-Texte, KI-Prompts und Tier-Profile sind in Locale-Dateien ausgelagert.

### Aufbau

```
public/locales/                Frontend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de.json                      Deutsche UI-Strings
  en.json                      Englische UI-Strings (dieselben Schluessel)

functions/src/locales/         Backend-Locales
  manifest.json                Verfuegbare Sprachen + Default-Sprache
  de/prompts.js                Deutsche KI-Prompts (Analyse-Prompt, Werbe-Aufruf)
  de/animals.js                Deutsche Tier-Easter-Egg-Profile
  en/prompts.js, en/animals.js Englische Gegenstuecke
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
- Liefert Mistral kein auswertbares Profil, bekommt der User eine blockierte Antwort (`blocked.profileBlocked`). Fehlen in einer sonst lesbaren Antwort einzelne Karten, fragt der Code einmal mit demselben Prompt nach; einen zweiten Prompt oder ein zweites Modell gibt es nicht
