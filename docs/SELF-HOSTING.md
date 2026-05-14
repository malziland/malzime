# Self-Hosting — Eigene malziME-Instanz aufsetzen

Diese Anleitung erklaert Schritt fuer Schritt, wie du eine eigene Instanz von malziME auf deinem eigenen Firebase-Projekt betreibst — mit deiner eigenen Domain und deiner eigenen Abrechnung.

**Zeitaufwand:** ca. 30–60 Minuten (je nach Google Cloud Erfahrung).

---

## Voraussetzungen

- [Node.js](https://nodejs.org/) 24+
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm i -g firebase-tools`
- Ein Google-Konto mit Kreditkarte (fuer Google Cloud Abrechnung)
- Git

## 1. Repo forken und klonen

```bash
# Fork auf GitHub erstellen, dann:
git clone https://github.com/DEIN-USERNAME/malzime.git
cd malzime
```

## 2a. Mistral AI Account einrichten

malziME nutzt seit v1.6.0 ausschliesslich Mistral AI fuer KI-Analysen.

1. Account erstellen auf [console.mistral.ai](https://console.mistral.ai/)
2. Stripe-Karte hinterlegen, **Scale Tier** aktivieren — Free Tier reicht nicht fuer Image-Calls
3. API-Key generieren unter https://console.mistral.ai/api-keys/
4. Key sofort sichern (wird nur einmal angezeigt) — wird in Schritt 5g als Firebase Secret hinterlegt

Kosten: Pay-per-Use, ein Workshop mit 30 Teilnehmer:innen kostet ca. $0.35.

## 2b. Google Cloud Projekt erstellen (nur fuer Infrastruktur)

1. Gehe zu [console.cloud.google.com](https://console.cloud.google.com)
2. Erstelle ein neues Projekt (z.B. `mein-malzime`)
3. Aktiviere die Abrechnung fuer das Projekt

### APIs aktivieren

Im Google Cloud Console unter **APIs & Services > Library**:

- **Cloud Firestore** — fuer den Analyse-Zaehler, das Stundenlimit und den Maintenance-Modus (wird automatisch mit Firebase aktiviert)

Cloud Vision API und Vertex AI sind NICHT mehr noetig (seit v1.6.0). Falls du sie zuvor aktiviert hattest, kannst du sie zur Kosten-Einsparung deaktivieren — die Pipeline nutzt sie nicht.

## 3. Firebase Projekt erstellen

1. Gehe zu [console.firebase.google.com](https://console.firebase.google.com)
2. Klicke auf **Projekt hinzufuegen**
3. Waehle das Google Cloud Projekt aus Schritt 2 (Firebase verknuepft sich damit)
4. Hosting aktivieren (unter **Build > Hosting**)

```bash
firebase login
firebase use --add   # Deine neue Projekt-ID waehlen
```

## 4. Dependencies installieren

```bash
# Backend
cd functions && npm install && cd ..

# Frontend-Tests + Linting
npm install
```

## 5. Anpassungen — Was du aendern musst

Hier sind alle Stellen die du fuer deine eigene Instanz anpassen musst.

### 5a. Backend: CORS + Origin-Check

**Datei:** `functions/src/domains.js`

Alle erlaubten Domains sind zentral in einer Datei definiert. Ersetze sie mit deinen eigenen:

```js
const ALLOWED_ORIGINS = [
  "https://DEINE-DOMAIN.com",
  "https://www.DEINE-DOMAIN.com",
  "https://DEIN-PROJEKT.web.app",
  "https://DEIN-PROJEKT.firebaseapp.com",
];

module.exports = { ALLOWED_ORIGINS };
```

Falls du keine eigene Domain hast, reichen die Firebase-Defaults:
```js
const ALLOWED_ORIGINS = [
  "https://DEIN-PROJEKT.web.app",
  "https://DEIN-PROJEKT.firebaseapp.com",
];
```

### 5b. Backend: Projekt-ID Fallback (entfaellt seit v1.6.0)

Vor v1.6.0 stand in `gemini.js` ein hartcodierter Projekt-Fallback (`"malzime"`). Mit dem Cleanup ist die Datei entfernt — Cloud Functions erkennt die Projekt-ID heute automatisch via `process.env.GCLOUD_PROJECT`. Keine Anpassung noetig.

### 5c. Frontend: Nominatim User-Agent

**Datei:** `public/js/geocoding.js` (Zeile 17)

Im Code steht ein `User-Agent`-Header fuer Nominatim (OpenStreetMap Geocoding). **Wichtig:** Browser ignorieren diesen Header stillschweigend — er hat keinen Effekt. Nominatim verwendet stattdessen den Standard-User-Agent deines Browsers, was fuer die Nutzung ausreichend ist.

Du kannst den Wert trotzdem anpassen (er erscheint z.B. im Emulator oder bei Server-seitigem Geocoding):

```js
headers: { "User-Agent": "DEIN-PROJEKT-NAME/1.0" },
```

### 5d. Frontend: Meta-Tags + Impressum + Datenschutz

Diese Dateien enthalten malziME-spezifische Inhalte (Domain, Firma, Kontakt) die du durch deine eigenen ersetzen musst:

| Datei | Was aendern |
|-------|------------|
| `public/index.html` | `<title>`, `<meta>` (description, author, canonical, OG-Tags, Twitter Cards), Structured Data (JSON-LD), Footer, Buy-Me-a-Coffee-Link |
| `public/impressum.html` | Kompletter Inhalt — dein eigenes Impressum |
| `public/datenschutz.html` | Kompletter Inhalt — deine eigene Datenschutzerklaerung |
| `public/og-image.png` | Eigenes Social-Media-Vorschaubild (1200x630px empfohlen) |
| `public/site.webmanifest` | App-Name und -Beschreibung |

> **Rechtlich wichtig**: Impressum und Datenschutzerklaerung muessen auf dein Unternehmen/deine Person zugeschnitten sein. Kopiere nicht einfach die malziland-Texte.

### 5e. CI/CD (optional, nur bei GitHub Actions)

**Datei:** `.github/workflows/ci.yml`

Der CI-Workflow laeuft automatisch bei Push und Pull Request. Er fuehrt Tests, Lint und Secret-Scan aus.

Deploy ist manuell per `firebase deploy` — es gibt keinen automatischen Deploy-Workflow.

### 5f. Locale-Dateien (optional)

Die UI-Texte, Gemini-Prompts und Tier-Profile liegen in Locale-Dateien:

| Dateien | Inhalt |
|---------|--------|
| `public/locales/de.json` | Alle Frontend-UI-Strings |
| `functions/src/locales/de/prompts.js` | Gemini-Prompts (System-Prompts, Labels, jsonSchemaNormal + jsonSchemaBoost) |
| `functions/src/locales/de/animals.js` | Tier-Easter-Egg-Profile |

Wenn du die Texte anpassen oder eine neue Sprache hinzufuegen willst:
- Frontend: Kopiere `de.json` nach `XX.json`, uebersetze die Werte, trage den Code in `manifest.json` ein
- Backend: Erstelle `functions/src/locales/XX/prompts.js` + `XX/animals.js`, trage den Code in `manifest.json` ein
- Testen mit `?lang=XX` in der URL

### 5g. Firebase Secrets

Die Cloud Functions benoetigen Firebase Secrets fuer Admin-Endpunkte, den Mistral-Provider und optionale Push-Benachrichtigungen:

```bash
# Pflicht: Admin-Token fuer Boost/Reset-Endpunkte
firebase functions:secrets:set ADMIN_SECRET

# Pflicht: Mistral API-Key fuer Primaer-Provider (Hybrid)
# WICHTIG: printf statt echo, damit kein Trailing-Newline im Secret landet!
printf "%s" "DEIN_MISTRAL_KEY" | firebase functions:secrets:set MISTRAL_API_KEY --data-file=-

# Optional: ntfy Push-Benachrichtigungen bei Limit-Erreichung
firebase functions:secrets:set NTFY_URL      # z.B. https://ntfy.example.com
firebase functions:secrets:set NTFY_TOPIC    # z.B. malzime-alerts
```

Wenn `MISTRAL_API_KEY` fehlt oder ungueltig ist, faellt die Pipeline automatisch auf den Gemini-Fallback zurueck — die App bleibt funktionsfaehig.

Wenn du keine ntfy-Benachrichtigungen willst, setze die Secrets auf einen Platzhalter-Wert (z.B. `none`). Der Code erkennt ungueltige URLs und sendet dann keine Benachrichtigungen.

### 5h. Stundenlimit anpassen (optional)

Das Standard-Stundenlimit liegt bei 500 Analysen/Stunde. Du kannst es in `functions/src/config.js` aendern:

```js
HOURLY_LIMIT: 500,  // Maximale Analysen pro Stunde
```

### 5i. Spenden-Button (optional)

**Datei:** `.github/FUNDING.yml`

Ersetze `malzime` mit deinem eigenen Buy-Me-a-Coffee-Username, oder entferne die Datei.

---

## 6. Lokal testen

Fuer lokale Entwicklung muessen die Google Cloud APIs authentifiziert sein:

```bash
gcloud auth application-default login
```

Dann den Emulator starten:

```bash
firebase emulators:start --only functions,hosting
```

Oeffne http://localhost:5000 — die App sollte funktionieren.

> **Tipp**: Im Emulator brauchen die Vision und Vertex AI APIs trotzdem Internet-Zugang — sie laufen nicht lokal.

## 7. Deploy

```bash
# Alles deployen
firebase deploy --only functions,hosting
```

Deine Instanz ist jetzt unter `https://DEIN-PROJEKT.web.app` erreichbar.

### Eigene Domain verbinden (optional)

1. Firebase Console > Hosting > **Benutzerdefinierte Domain hinzufuegen**
2. DNS-Eintraege bei deinem Domain-Anbieter setzen
3. CORS-Liste in `functions/src/domains.js` um deine Domain erweitern
4. Neu deployen: `firebase deploy --only functions`

---

## Checkliste

Bevor du live gehst:

- [ ] `functions/src/domains.js` enthaelt deine Domains
- [ ] Impressum und Datenschutzerklaerung sind auf dich zugeschnitten
- [ ] Meta-Tags (OG, Twitter, canonical) zeigen auf deine Domain
- [ ] User-Agent in geocoding.js enthaelt deinen Projektnamen
- [ ] Eigenes OG-Image erstellt
- [ ] Locale-Dateien angepasst (falls gewuenscht)
- [ ] Firebase Secrets gesetzt: ADMIN_SECRET, MISTRAL_API_KEY (+ optional NTFY_URL, NTFY_TOPIC)
- [ ] Firestore Security Rules deployed: `firebase deploy --only firestore`
- [ ] Tests laufen: `cd functions && npm test` und `npm run test:frontend`
- [ ] Lokal getestet: Bild hochladen funktioniert

## Kosten

### Was pro Analyse passiert

| API | Aufrufe | Was |
|-----|---------|-----|
| **Mistral Large 3** | 1 Call | Multimodale Bildbeschreibung mit SUBJECT-Klassifikation |
| **Mistral Small 4** | 2 Calls | Profilgenerierung (Normal + Boost, parallel) |
| **Cloud Functions** | 1 Invocation | ~3–8 Sekunden, 512 MiB RAM |

Bei Tier-Fotos entfaellt der Small-4-Call — Easter-Egg aus statischen Locales.

### Preise (Stand Mai 2026)

**Mistral Scale Tier** (pro 1M Tokens):

| Modell | Input | Output |
|--------|-------|--------|
| Large 3 | $0.50 | $1.50 |
| Small 4 | $0.15 | $0.60 |

**Google Cloud (nur Infrastruktur):**

| Posten | Preis | Kostenlos/Monat |
|--------|-------|-----------------|
| Firebase Hosting | $0.15 / GB Transfer | 10 GB/Monat |
| Cloud Functions | nutzungsbasiert | 2 Mio. Aufrufe/Monat |
| Cloud Firestore | nutzungsbasiert | 50 K Reads/Tag, 20 K Writes/Tag |

### Rechenbeispiel: Workshop mit 30 Teilnehmer:innen

| Posten | Rechnung | Kosten |
|--------|----------|--------|
| Mistral Large 3 Describe | 30 × ~10.000 Input + ~1.500 Output Tokens | **~$0.22** |
| Mistral Small 4 Profile (2x) | 30 × 2 × ~5.000 Tokens je in/out | **~$0.13** |
| Cloud Functions + Hosting | minimal | **$0.00** |
| **Gesamt** | | **~$0.35** |

Neue Google Cloud Konten erhalten **$300 Startguthaben**.

## Fragen?

Oeffne ein [Issue auf GitHub](https://github.com/malziland/malzime/issues) — wir helfen gerne.
