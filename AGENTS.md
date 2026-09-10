# Repository Guidelines

## Project Structure & Module Organization

```
public/              Firebase Hosting SPA (Vanilla JS, kein Build-Schritt)
  index.html         Hauptseite (Cache-Busting: ?v=YYYYMMDDNN an CSS/JS)
  app.js             Entry Point (ES Module)
  js/                Frontend-Module
    api.js           API-Client: Einreihen, Statusabfrage, Wiederaufnahme (analyzeImageQueued, pollJob, resumeQueueJob)
    dom.js           DOM-Helpers (escapeHtml, sanitize)
    exif.js          Client-seitige EXIF-Extraktion (exifr)
    geocoding.js     Nominatim Reverse Geocoding (client-seitig)
    render.js        Ergebnis-Rendering (Profile, EXIF, Karte, Datenwert)
    state.js         Globaler State (requestId, isAnalyzing)
    ui.js            UI-Komponenten (Maintenance-Modal, Scan-Animation, Bias-Toggle, Limit-Banner, Warteschlangen-Anzeige)
    demo.js          Demo-Foto-Initialisierung (Click-Handler fuer die KI-generierten Demo-Fotos, siehe public/img/demo/LICENSE.md)
    stats.js         Stats-Seite: Fetch /api/stats, Limit-Balken, Countdown
    i18n.js          i18n Micro-Modul (initI18n, t, getLanguage, applyTranslations)
  locales/           Frontend-Locale-Dateien
    manifest.json    Verfuegbare Sprachen + Default
    de.json + en.json  Deutsche + englische UI-Strings (Keys fuer alle data-i18n-Elemente; i18n-Guardian erzwingt Schluessel-Gleichstand)
  __tests__/         Vitest Frontend-Tests
  styles.css         malziland Design System (heller Papier-Look, Beast-Mode-Dunkel-Kopplung) + Print Styles + Self-hosted @font-face
  impressum.html     Impressum
  datenschutz.html   Datenschutzerklaerung
  stats.html         Oeffentliche Nutzungsstatistik
  fonts/             Self-hosted: Poppins (woff2, OFL)
  lib/leaflet/       Self-hosted: Leaflet 1.9.4 (JS, CSS, Marker-Images)
  lib/exifr/         Self-hosted: exifr lite ESM (Browser EXIF-Parsing)

functions/src/       Firebase Cloud Functions 2nd Gen (Node 24, europe-west1)
  index.js           Cloud-Function-Exports (stats, admin, errors, telemetry, enqueue, processJob, jobStatus, reapJobs, erinnerung, laufzeitWache, satzWache), Secret-Deklarationen (EU-gebunden, Endung _EU, u. a. MISTRAL_API_KEY_EU)
  handle-stats.js    Stats-Handler (GET-only)
  handle-admin.js    Admin-Endpunkte (Boost, Reset, Maintenance) — 3-Schritt-Flow mit HMAC + Nonce
  config.js          NUR NOCH, was bewusst NICHT einstellbar ist: Modell-IDs,
                     EU-Endpunkt, EU-Datenbank, Upload-Grenze, erlaubte
                     Dateiformate. Jede Zeile mit Begruendung 'BLEIBT IM CODE'.
                     Betriebswerte stehen seit 30.08.2026 AUSSCHLIESSLICH im
                     Firestore-Einstellungssatz -> docs/BETRIEBSPROFILE.md
  betriebsprofil.js  Die 26 einstellbaren Werte, ihre Grenzen und die Pruefung
                     jedes Satzes. Vier Obergrenzen SIND Datenschutzzusagen.
  counter.js         Firestore-Zaehler: Stundenlimit, Totals, Stats, Boost, Reset,
                     Maintenance-Mode. Seit 30.08.2026 mit NETZ
                     (notbremseUeberJobs): Faellt der Zaehler bei Andrang aus
                     — er schreibt in EIN Dokument —, zaehlt das Netz statt zu
                     schreiben und haelt die Kostenbremse aufrecht.
  notify.js          ntfy Push-Benachrichtigungen bei Limit-Erreichung
  animal.js          SUBJECT-Klassifikation aus Mistral-Beschreibungstext + Easter-Egg-Profile (Hund/Katze/Vogel/...)
  middleware.js      Rate Limiting (IP-basiert, Grenze+Fenster aus dem Einstellungssatz), IP-Extraktion
  upload.js          Multipart + JSON Body Parsing
  privacy.js         Privacy-Risiko-Erkennung aus Mistrals "Sichtbarer Text"-Feld
  mistral.js         Mistral AI: runSingleLargeCall (Large macht Beschreibung + beide Profile in EINEM Call) + generateBeastAds (zweiter Aufruf ohne Bild)
  json-repair.js     Defensiver JSON-Parser fuer LLM-Outputs (direkt -> heuristisch -> json5 -> Truncation-Recovery)
  throttle.js        In-Memory-Semaphore gegen Mistral-Bursts (AKTIV: withMistralSlot umschliesst jeden Mistral-Call)
  auth.js            HMAC-basierte Admin-Token + Nonces (createAdminToken, verifyAdminToken, createNonce, verifyNonce)
  domains.js         Zentrale CORS-/Origin-Whitelist (ALLOWED_ORIGINS)
  i18n.js            Backend-Locale-Loader (loadPrompts, loadAnimals, resolveLanguage)
  feature-flags.js   Laufzeit-Feature-Flags aus Firestore (useBeastAdsCall, useGemesseneDauer), 30s-Cache, fail-safe
  --- Queue-Architektur (v2.0) — der einzige Pfad seit v2.10 ---
  handle-enqueue.js  Queue-Annahme: Validierung -> Bild in Storage -> Job anlegen -> in Cloud Tasks einreihen
  handle-process-job.js  Queue-Worker (nur Cloud Tasks): claimt Job, fuehrt Mistral-Pipeline aus, schreibt Ergebnis
  handle-job-status.js   Queue-Polling: Status, Warteschlangen-Position, ETA, Ergebnis; jeder Poll ist Liveness-Herzschlag
  handle-reap.js     Queue-Reaper (geplant, Minutentakt): markiert verlassene Jobs als abandoned, gibt ihren Platz frei
  jobs.js            Queue-Job-Lebenszyklus in Firestore (createJob/claimJob/completeJob/failJob/getQueuePosition/touchJob/abandonJob)
  cloud-tasks.js     Queue: Wrapper um Google Cloud Tasks (enqueueJob)
  queue-storage.js   Queue: temporaere Bild-Ablage in Firebase Storage (storeImage/loadImage/deleteImage)
  mistral-mock.js    Mistral-Attrappe fuer kostenlose Tests (Unit-Tests, Emulator-Durchklick, Mock-Lasttest)
  locales/           Backend-Locale-Dateien
    manifest.json    Verfuegbare Sprachen + Default
    de/prompts.js    Deutsche Prompts (singleLargePrompt mit Alterskalibrierung und SUBJECT-Klassifikation, beastAdsSystem/beastAdsUser, Marken-Sperre, injectionWarning)
    de/animals.js    Deutsche Tier-Easter-Egg-Profile
    en/prompts.js    Englische Prompts (Spiegelung von de/prompts.js)
  __tests__/         Jest Unit-Tests + fixtures/ fuer json-repair
  scripts/           Dev-Tools (Lasttests, Forschungs-Skripte)

docs/                Setup-Dokumentation
.github/             CI/CD Workflows (ci.yml, dependabot-automerge.yml, release.yml)
```

## Build, Test, and Development Commands

Sammel-Befehle (Root, decken Frontend + Backend ab):

- `npm run setup` — install everything (root + functions, via npm ci)
- `npm test` — run all unit tests (backend Jest + frontend Vitest)
- `npm run lint` — ESLint frontend + backend
- `npm run format:check` — Prettier check frontend + backend

Einzelbefehle:

- `cd functions && npm install` — install backend dependencies
- `npm install` (root) — install frontend test/lint dependencies (Vitest, ESLint, Prettier)
- `cd functions && npm test` — run Jest backend unit tests (count: see `docs/VERIFICATION.md`)
- `npm run test:frontend` — run Vitest frontend unit tests (count: see `docs/VERIFICATION.md`)
- `npm run test:e2e` — run Playwright E2E tests (Smoke + axe-A11y-Gate ohne Ausnahmen + Tastatur-Durchlauf; A11y misst mit reducedMotion, sonst Schein-Funde durch Einblend-Animation)
- `cd functions && npm run lint` — ESLint backend
- `cd functions && npm run format:check` — Prettier backend
- `npm run lint:frontend` — ESLint frontend
- `npm run format:frontend:check` — Prettier frontend
- `firebase emulators:start --only functions,hosting` — local dev
- `./scripts/deploy.sh [hosting|functions]` — deploy (only with the owner's explicit release; the script runs the gates, the dry run and the live smoke — never `firebase deploy` directly, see docs/RUNBOOK.md)

## Coding Style & Naming Conventions

- JavaScript with 2-space indentation
- Filenames: `kebab-case.js` for modules
- Exports: named exports via `module.exports = { ... }`
- Frontend: vanilla JS ES modules, no build step, no framework
- Sprache in Profilen und UI: Deutsch (du-Form, kein Passiv)
- Nie "kaukasisch" verwenden — stattdessen "europaeisch" oder "mitteleuropaeisch"
- Neue UI-Strings gehoeren in `public/locales/de.json` (nicht hardcoded in HTML/JS)
- Neue Prompt-Texte gehoeren in `functions/src/locales/de/prompts.js`
- Neue Tier-Profile gehoeren in `functions/src/locales/de/animals.js`
- i18n-Guardian-Tests pruefen dass keine hardcoded Strings in HTML/JS/Backend stehen

## Testing Guidelines

- Jest for backend unit tests in `functions/src/__tests__/`
- Vitest + jsdom for frontend unit tests in `public/__tests__/`
- Run backend: `cd functions && npm test`
- Run frontend: `npm run test:frontend`
- Backend: test pure functions (privacy, config, middleware, upload)
- Frontend: test DOM helpers, state, UI components, geocoding, render, API integration
- API-dependent module (`mistral.js`) tested via mocked-fetch unit tests

## Privacy-Architektur (KRITISCH)

- EXIF wird client-seitig extrahiert (exifr im Browser)
- GPS erreicht NIE unsere Server — Nominatim und die Kartenkacheln ruft der Browser direkt
  auf, die Koordinaten verlassen das Gerät also sehr wohl, nur nie in Richtung malziME.
  Diese Formulierung ist verbindlich (DOC-2026-08-12-05); die frühere Fassung war im
  Netzwerk-Tab widerlegbar und steht auf der Sperrliste in `.pruefungen/aussentext.txt`
- Server bekommt nur: komprimiertes Bild + Kamera-Metadaten (make, model) OHNE GPS, OHNE dateTimeOriginal
- Keine externen Scripts: Alles self-hosted (Fonts, Leaflet, exifr). Kein CDN, kein reCAPTCHA, kein Firebase SDK
- Bot-Schutz: Rate Limiting (IP) + Honeypot + Timing-Check
- CSP: nur 'self' + OpenStreetMap Tiles + Cloud Functions Endpoint + Nominatim

## Security & Configuration

- Use `functions/.env` for local config (see `functions/.env.example`)
- Never commit secrets or API keys
- CSP headers configured in `firebase.json`
- Honeypot field for bot protection
- Prompt-Injection-Schutz: User-Daten in XML-Tags isoliert + escapeXml() auf dynamische Inhalte
- Admin-Aktionen: GET zeigt Bestaetigungsseite, POST+Nonce fuehrt Mutation aus (SEC-001)

## Mistral-Architektur (seit v1.6.0)

Die komplette KI-Pipeline laeuft ueber Mistral AI, in genau einem Weg:
`runSingleLargeCall` in `mistral.js` schickt das Bild EINMAL an Mistral Large (2512)
und erhaelt Beschreibung + beide Profile (Normal + Beast) in einer Antwort. Laeuft im
Queue-Worker `handle-process-job.js`; SUBJECT-Klassifikation + Privacy-Risks werden
aus den `subject`/`visible_text`-Feldern der Antwort abgeleitet. Ein zweiter, kleiner
Aufruf ohne Bild erzeugt die Beast-Werbung (`generateBeastAds`). Alle LLM-Ausgaben
gehen durch `json-repair.js` (4-stufige defensive Reparatur).

Den aelteren Drei-Aufruf-Weg (Large beschreibt, Small profiliert; bis v2.1 aktiv,
danach Reserve hinter einem Feature-Flag) gibt es seit 10.09.2026 nicht mehr.

`MISTRAL_API_KEY_EU` ist als Secret (an europe-west1 gebunden) hinterlegt und wird in `index.js` an die KI-Endpunkte gebunden. `mistral-http.js` liest den Key aus `process.env.MISTRAL_API_KEY_EU`, lokal ersatzweise aus `MISTRAL_API_KEY`.

Wenn Mistral nicht antwortet, gibt es keinen anderen KI-Provider als Fallback. Der User bekommt eine `blocked.apiError`- oder `blocked.overloaded`-Response. Google bleibt nur fuer die Infrastruktur-Schicht (Firebase Hosting + Cloud Functions + Firestore in `europe-west1`).

## Agent-Specific Instructions

- Keep changes focused and incremental
- Always run `cd functions && npm test` after backend changes
- Always run `npm run test:frontend` after frontend changes
- Run `cd functions && npm run lint && npm run format:check` before committing backend changes
- Run `npm run lint:frontend && npm run format:frontend:check` before committing frontend changes
- The cache-buster `?v=YYYYMMDDNN` is bumped by `scripts/deploy.sh` on every hosting deploy — never by hand
- Both profiles (normal + boost) come from ONE call (`runSingleLargeCall` in `mistral.js`); the prompt text lives in `locales/*/prompts.js` (`singleLargePrompt`)
- Bei Aenderungen an der Architektur oder neuen Features: README.md, AGENTS.md, CHANGELOG.md, docs/SETUP.md und docs/SELF-HOSTING.md aktualisieren
- Bei neuen Features: Dokumentation und Anleitungen mitliefern
- dateTimeOriginal wird NICHT an die KI gesendet (verleitet zu falschen Altersschaetzungen)
- Analyse-Prompt: das Alter nur ueber physische Merkmale kalibrieren (Merkmalsraster, abgesichert durch age-markers.test.js)
