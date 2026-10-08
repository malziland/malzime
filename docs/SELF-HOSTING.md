# Self-Hosting — Eigene malziME-Instanz aufsetzen

Diese Anleitung erklaert Schritt fuer Schritt, wie du eine eigene Instanz von malziME auf deinem eigenen Firebase-Projekt betreibst — mit deiner eigenen Domain und deiner eigenen Abrechnung.

**Zeitaufwand:** ca. 30–60 Minuten (je nach Google Cloud Erfahrung).

---

## Voraussetzungen

- [Node.js](https://nodejs.org/) 24+
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm i -g firebase-tools`
- Ein Google-Konto mit Kreditkarte (fuer Google Cloud Abrechnung)
- Git

> **Marke ersetzen (rechtlich wichtig):** Die MIT-Lizenz gilt fuer den Code,
> **nicht** fuer Logo und Marke. Die malziland-Brand-Assets unter
> `public/img/brand/` sind ausdruecklich von der MIT-Lizenz ausgenommen — wer
> eine eigene Instanz betreibt, muss sie durch eigene Grafiken ersetzen.
> Details: [`TRADEMARKS.md`](../TRADEMARKS.md) und `public/img/brand/LICENSE.md`.

## 1. Repo forken und klonen

```bash
# Fork auf GitHub erstellen, dann:
git clone https://github.com/DEIN-USERNAME/malzime.git
cd malzime
```

## 2a. Mistral AI Account einrichten

malziME nutzt seit v1.6.0 ausschliesslich Mistral AI fuer KI-Analysen.

1. Account erstellen auf [console.mistral.ai](https://console.mistral.ai/)
2. Zahlungsmittel hinterlegen und einen kostenpflichtigen Tarif aktivieren — der kostenlose
   Tarif reicht fuer Bild-Aufrufe nicht. Die Tarifnamen bei Mistral aendern sich; massgeblich
   ist das Dashboard, nicht diese Anleitung (DOC-2026-08-20-52).
3. API-Key generieren unter https://console.mistral.ai/api-keys/
4. Key sofort sichern (wird nur einmal angezeigt) — wird in Schritt 5g als Firebase Secret hinterlegt

Kosten: Pay-per-Use. Ein Rechenbeispiel fuer einen Workshop steht an einer Stelle:
[SETUP.md, Abschnitt „Kosten"](SETUP.md#kosten).

## 2b. Google Cloud Projekt erstellen (nur fuer Infrastruktur)

1. Gehe zu [console.cloud.google.com](https://console.cloud.google.com)
2. Erstelle ein neues Projekt (z.B. `mein-malzime`)
3. Aktiviere die Abrechnung fuer das Projekt

### APIs aktivieren

Im Google Cloud Console unter **APIs & Services > Library**:

- **Cloud Firestore** — Analyse-Zaehler, Stundenlimit, Maintenance-Modus, Queue-Jobs, Einstellungssatz. Die API wird mit Firebase aktiviert; die **Datenbank selbst legst du in Schritt 3a an** — das Programm benutzt nicht die Standard-Datenbank
- **Cloud Tasks API** — Warteschlange fuer die Analyse-Jobs (seit v2.0)
- **Cloud Storage** — temporaere Bild-Ablage der Queue (seit v2.0)

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

## 3a. Datenbank anlegen (Pflicht)

malziME spricht ausschliesslich eine **benannte** Firestore-Datenbank an: `malzime-eu` in
`europe-west1`. Die Standard-Datenbank `(default)`, die Firebase von sich aus anbietet,
benutzt das Programm nicht — ohne diesen Schritt findet es keine Datenbank.

```bash
gcloud firestore databases create --database=malzime-eu --location=europe-west1 \
  --project=DEIN-PROJEKT
```

Der Standort einer Firestore-Datenbank steht beim Anlegen fest und laesst sich danach nicht
mehr aendern. Wer zusaetzlich `--delete-protection` angibt, schuetzt die Datenbank vor
versehentlichem Loeschen.

Der Name ist nur in deinem eigenen Projekt sichtbar; am einfachsten bleibt er, wie er ist.
Willst du einen anderen, steht er an genau zwei Stellen: `FIRESTORE_DATABASE_ID` in
`functions/src/config.js` und `"database"` in `firebase.json`.

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

Die Adresse der Seite (`SITE_URL`) und alle erlaubten Domains stehen zentral in dieser einen
Datei. Aendere **nur die Werte** und lass beide Exporte stehen — `SITE_URL` brauchen die
Wochen-Erinnerung und die Push-Benachrichtigungen:

```js
const SITE_URL = "https://DEINE-DOMAIN.com";

const ALLOWED_ORIGINS = [
  SITE_URL,
  "https://www.DEINE-DOMAIN.com",
  "https://DEIN-PROJEKT.web.app",
  "https://DEIN-PROJEKT.firebaseapp.com",
];

module.exports = { ALLOWED_ORIGINS, SITE_URL };
```

Falls du keine eigene Domain hast, reichen die Firebase-Adressen:
```js
const SITE_URL = "https://DEIN-PROJEKT.web.app";

const ALLOWED_ORIGINS = [SITE_URL, "https://DEIN-PROJEKT.firebaseapp.com"];

module.exports = { ALLOWED_ORIGINS, SITE_URL };
```

### 5b. Backend: Projekt-ID Fallback (entfaellt seit v1.6.0)

Vor v1.6.0 stand in `gemini.js` ein hartcodierter Projekt-Fallback (`"malzime"`). Mit dem Cleanup ist die Datei entfernt — Cloud Functions erkennt die Projekt-ID heute automatisch via `process.env.GCLOUD_PROJECT`. Keine Anpassung noetig.

### 5c. Frontend: Nominatim User-Agent

**Datei:** `public/js/geocoding.js` (Suche nach `User-Agent`)

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
| `public/site.webmanifest` | App-Name (`name`, `short_name`) und Farben |

> **Rechtlich wichtig**: Impressum und Datenschutzerklaerung muessen auf dein Unternehmen/deine Person zugeschnitten sein. Kopiere nicht einfach die malziland-Texte.

### 5e. CI/CD (optional, nur bei GitHub Actions)

**Datei:** `.github/workflows/ci.yml`

Der CI-Workflow laeuft automatisch bei Push und Pull Request. Er fuehrt Tests, Lint und Secret-Scan aus.

Zwei weitere Workflows laufen mit: `libheif-bau.yml` (baut den HEIC-Dekoder nach, nur
bei Änderungen an ihm; braucht nichts außer dem eingebauten `GITHUB_TOKEN`) und
`sicherheit-nachts.yml` (täglich; meldet Sicherheitslücken und Abkündigungen). Dessen
Job `alarm`, der Push aufs Handy, läuft nur im Original-Repository `malziland/malzime`
— in einem Fork wird er übersprungen. Wer ihn im eigenen Fork nutzen will, setzt die
GitHub-Secrets `NTFY_URL_EU` und `NTFY_TOPIC_EU` und passt die Bedingung
`github.repository` im Workflow an. Der Deploy-Riegel hält alle fünf Workflows,
`.github/dependabot.yml` und die Einstellungsdateien der Prüfwerkzeuge (`vitest.config.js`,
`playwright.config.js`, beide ESLint-Einstellungen, `.prettierignore`,
`functions/jest.setup.js`) per Prüfsumme fest,
dazu den Wortlaut der npm-Skripte hinter den Pflicht-Schritten: Nach jeder Änderung an
einer dieser Stellen die neue Summe bzw. den neuen Wortlaut eintragen
(`python3 scripts/pruefe-deploy-riegel.py --vertrag-summen` zeigt die Summen), sonst wird
der Pflicht-Check `pruefungen` rot.
In einem Fork schaltet GitHub geplante Workflows zunächst ab; den Nachtlauf unter
„Actions" einmal aktivieren. (`scripts/deploy.sh` ist auf das Original-Repository
zugeschnitten; Selbst-Hoster deployen wie oben beschrieben mit `firebase deploy`.)

Deploy ist manuell per `firebase deploy` — es gibt keinen automatischen Deploy-Workflow.

### 5f. Locale-Dateien (optional)

Die UI-Texte, KI-Prompts und Tier-Profile liegen in Locale-Dateien:

| Dateien | Inhalt |
|---------|--------|
| `public/locales/de.json`, `en.json` | Alle Frontend-UI-Strings (beide Dateien brauchen dieselben Schluessel) |
| `functions/src/locales/de/prompts.js`, `en/prompts.js` | KI-Prompts (Analyse-Prompt `singleLargePrompt`, die zwei Teile des Werbe-Aufrufs, Marken-Sperre) |
| `functions/src/locales/de/animals.js`, `en/animals.js` | Tier-Easter-Egg-Profile |

Wenn du die Texte anpassen oder eine neue Sprache hinzufuegen willst:
- Frontend: Kopiere `de.json` nach `XX.json`, uebersetze die Werte, trage den Code in `manifest.json` ein
- Backend: Erstelle `functions/src/locales/XX/prompts.js` + `XX/animals.js`, trage den Code in `manifest.json` ein
- Testen mit `?lang=XX` in der URL

### 5g. Firebase Secrets

Die Cloud Functions benoetigen Firebase Secrets fuer Admin-Endpunkte, den Mistral-Provider und optionale Push-Benachrichtigungen:

Die Namen enden auf `_EU`, und die Secrets werden mit `gcloud` an eine
EU-Region gebunden angelegt (`firebase functions:secrets:set` wuerde sie
weltweit replizieren, und das laesst sich nachtraeglich nicht aendern):

```bash
for s in ADMIN_SECRET_EU MISTRAL_API_KEY_EU NTFY_URL_EU NTFY_TOPIC_EU; do
  gcloud secrets create "$s" --replication-policy=user-managed --locations=europe-west1
done
# WICHTIG: printf statt echo, damit kein Trailing-Newline im Secret landet!
printf "%s" "DEIN_ADMIN_TOKEN" | gcloud secrets versions add ADMIN_SECRET_EU    --data-file=-
printf "%s" "DEIN_MISTRAL_KEY" | gcloud secrets versions add MISTRAL_API_KEY_EU --data-file=-
printf "%s" "https://ntfy.example.com" | gcloud secrets versions add NTFY_URL_EU --data-file=-   # optional
printf "%s" "malzime-alerts"   | gcloud secrets versions add NTFY_TOPIC_EU      --data-file=-   # optional
```

`MISTRAL_API_KEY_EU` ist Pflicht — Mistral ist seit v1.6.0 der einzige KI-Anbieter. Fehlt der Key, schlagen alle Analyse-Anfragen mit einer blockierten Antwort fehl (es gibt keinen Fallback-Anbieter).

Wenn du keine ntfy-Benachrichtigungen willst, setze die Secrets auf einen Platzhalter-Wert (z.B. `none`). Der Code erkennt ungueltige URLs und sendet dann keine Benachrichtigungen.

### 5h. Einstellungssatz anlegen (Pflicht)

Das Stundenlimit und alle anderen Betriebswerte stehen **nicht im Code**,
sondern in Firestore im Dokument `config/betriebsprofil` (in der Datenbank aus
Schritt 3a). **Ohne gueltigen Einstellungssatz laeuft keine Analyse** — die
Seite zeigt dann „Bei uns stimmt gerade eine Einstellung nicht".

Die Werte fuer den Start stehen in `functions/src/produktiv-satz.js`. Angelegt
wird der Satz mit einem Skript, **vor** dem ersten Ausliefern:

```bash
gcloud auth application-default login
# Ohne --projekt schreibt das Skript in das Projekt "malzime" — also immer deines nennen.
node scripts/betriebsprofil-anlegen.js --projekt DEINE-PROJEKT-ID               # zeigt nur, was es schreiben wuerde
node scripts/betriebsprofil-anlegen.js --projekt DEINE-PROJEKT-ID --ausfuehren  # schreibt und liest zur Kontrolle zurueck
```

Aendern heisst spaeter: den Wert im aktiven Satz setzen — kein Deploy noetig,
wirkt binnen 30 Sekunden. Welche Werte es gibt, was sie bedeuten und welche
Obergrenzen Datenschutzzusagen sind, steht in
[BETRIEBSPROFILE.md](BETRIEBSPROFILE.md). Passe vor allem `parallelitaet` und
`queueRatePerSekunde` an die Grenzen deines Mistral-Tarifs an (Schritt 5j).

### 5i. Spenden-Button (optional)

**Datei:** `.github/FUNDING.yml`

Ersetze `malzime` mit deinem eigenen Buy-Me-a-Coffee-Username, oder entferne die Datei.

---

## 5j. Queue-Architektur einrichten (v2.0)

Seit v2.0 läuft die Analyse über eine Cloud-Tasks-Warteschlange (Details: [`ARCHITECTURE.md`](ARCHITECTURE.md)). Für eine eigene Instanz brauchst du:

**1. Cloud-Tasks-Queue anlegen:**

```bash
gcloud tasks queues create analyze-queue --location=europe-west1 \
  --max-backoff=60s --max-retry-duration=1800s --max-attempts=10
```

Die drei Angaben sind die Wiederholungsregel: Antwortet der Verarbeiter mit einem Fehler, versucht die Warteschlange es höchstens im Minutenabstand erneut und hört nach 30 Minuten auf — so lange wartet auch der Browser höchstens. Ohne sie gilt der Google-Standard (bis 100 Versuche, Abstand bis zu einer Stunde); ein Auftrag bliebe dann nach einer kurzen Störung viele Minuten liegen. Für eine bestehende Warteschlange: derselbe Befehl mit `update` statt `create`. `scripts/verify-infrastructure.sh` prüft die Werte.

Die Parallelität (`--max-concurrent-dispatches`) richtet sich nach den Rate-Limits deines Mistral-Tarifs — starte konservativ (z. B. 3) und taste dich mit Lasttests hoch. Zu hoch gewählt, antwortet Mistral mit `429` und Analysen kommen als `blocked.overloaded` zurück.

**2. GCS-Bucket für die temporäre Bild-Ablage:**

```bash
gcloud storage buckets create gs://DEIN-PROJEKT-queue-uploads \
  --location=europe-west1 --uniform-bucket-level-access --public-access-prevention
```

Trage den Bucket-Namen in `functions/src/config.js` (`QUEUE_BUCKET`) oder als Umgebungsvariable `QUEUE_BUCKET` ein. Empfohlen: eine Lifecycle-Regel, die Objekte nach 1 Tag löscht (Sicherheitsnetz — die aktive Löschung passiert ohnehin sofort nach der Verarbeitung).

**3. Firestore-Regeln und -Indizes deployen** (in die Datenbank aus Schritt 3a; `firebase.json` nennt sie):

```bash
firebase deploy --only firestore
```

**4. Feature-Flags:** Die Warteschlange läuft immer; seit v2.10 gibt es keinen zweiten Weg mehr. Im Dokument `featureFlags/current` steuerst du `useBeastAdsCall` (Notausschalter fuer den Werbe-Aufruf) und `useGemesseneDauer` — ohne Deploy umlegbar (Uebersicht in `FLAGS.md`).

Die IAM-Rolle, mit der Cloud Tasks den Worker `processJob` aufrufen darf, vergibt `firebase deploy` automatisch.

Lokaler Test der Queue ohne Cloud Tasks: [`QUEUE-EMULATOR.md`](QUEUE-EMULATOR.md).

---

## 6. Lokal testen

Lokal laeuft alles im Firebase-Emulator, ohne Google-Anmeldung und ohne Kosten:
Die KI ist durch eine Attrappe ersetzt, Warteschlange und Bild-Ablage durch
lokale Ersatzstuecke. Der Ablauf steht in [`QUEUE-EMULATOR.md`](QUEUE-EMULATOR.md);
in Kurzform:

```bash
cp functions/.env.local.example functions/.env.local   # einmalig
npm run emulator                                        # Functions, Firestore, Hosting, Pub/Sub
# zweites Terminal — der Emulator beginnt jedes Mal mit leerer Datenbank, also auch
# ohne Einstellungssatz. Das Skript legt den Satz der Tests an (functions/src/test-satz.js):
GCLOUD_PROJECT=DEIN-PROJEKT FIRESTORE_EMULATOR_HOST=localhost:8080 \
  node scripts/lasttest-satz-anlegen.js
```

Oeffne http://localhost:5050 — die App sollte funktionieren.

> **Echte KI statt Attrappe:** in `functions/.env.local` `MISTRAL_MOCK=0` setzen und
> `MISTRAL_API_KEY` eintragen. Dann braucht der Emulator Internet-Zugang, und jede
> Analyse kostet Geld. Lege keine Datei `functions/.env` an (Grund: [SETUP.md](SETUP.md)).

## 7. Deploy

Reihenfolge: Datenbank (3a), Einstellungssatz (5h) sowie Regeln und Indizes (5j)
muessen vorher liegen.

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

- [ ] Datenbank `malzime-eu` in `europe-west1` angelegt (Schritt 3a)
- [ ] Einstellungssatz `config/betriebsprofil` angelegt und zurueckgelesen (Schritt 5h)
- [ ] `functions/src/domains.js` enthaelt deine Domains und deine `SITE_URL`
- [ ] Impressum und Datenschutzerklaerung sind auf dich zugeschnitten
- [ ] Meta-Tags (OG, Twitter, canonical) zeigen auf deine Domain
- [ ] User-Agent in geocoding.js enthaelt deinen Projektnamen
- [ ] Eigenes OG-Image erstellt
- [ ] Locale-Dateien angepasst (falls gewuenscht)
- [ ] Secrets gesetzt, EU-gebunden: ADMIN_SECRET_EU, MISTRAL_API_KEY_EU, NTFY_URL_EU, NTFY_TOPIC_EU (Namen wie in `functions/src/index.js`)
- [ ] Firestore Security Rules deployed: `firebase deploy --only firestore`
- [ ] Queue eingerichtet: Cloud-Tasks-Queue + GCS-Bucket + `QUEUE_BUCKET` gesetzt (siehe »Queue-Architektur einrichten«)
- [ ] Tests laufen: `cd functions && npm test` und `npm run test:frontend`
- [ ] Lokal getestet: Bild hochladen funktioniert

## Kosten

Was je Analyse aufgerufen wird, die Preise und ein Rechenbeispiel fuer einen Workshop
stehen an einer Stelle: [SETUP.md, Abschnitt „Kosten"](SETUP.md#kosten). Massgeblich fuer
die Preise ist dein eigenes Mistral-Konto.

## Fragen?

Oeffne ein [Issue auf GitHub](https://github.com/malziland/malzime/issues) — wir helfen gerne.
