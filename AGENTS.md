# Repository Guidelines

## Project Structure & Module Organization

```
public/              Firebase Hosting SPA (Vanilla JS, kein Build-Schritt)
  index.html         Hauptseite (Cache-Busting: ?v=YYYYMMDDNN an CSS/JS)
  app.js             Entry Point (ES Module)
  js/                Frontend-Module (jede Datei unter public/js/*.js hat hier genau eine Zeile)
    api.js           Analyse-Ablauf im Browser: Foto einreihen, Ergebnis zeigen, Wiederaufnahme nach Neuladen, verworfenen Auftrag abmelden (analyzeImage, resumeQueueJob)
    auftrag-abfrage.js  Statusabfrage eines eingereihten Auftrags im 2-Sekunden-Takt (pollJob), zugleich Lebenszeichen an den Server
    netz-hilfen.js   Netz- und Warte-Hilfen des Ablaufs: Aufruf mit Zeitgrenze bis zum Ende des Antwort-Rumpfs (fetchWithTimeout), Warten auf den naechsten Takt
    foto-vorschau.js  Zwei Handgriffe an der Foto-Vorschau: Ersatzbild, wenn der Browser das Original nicht anzeigen kann; Hinweis „Foto geloescht“
    api-basis.js     Die eine Stelle fuer die Server-Adressen: im Betrieb direkt Cloud Run in europe-west1, lokal relativ
    auftrag-speicher.js  Auftragsgedaechtnis des Tabs (sessionStorage): Auftragsnummer, Abhol-Ticket, Frist fuer ein zugestelltes Ergebnis
    rc-ticket.js     Einmal-Ticket des Realitaets-Checks (sessionStorage)
    wake-lock.js     Bildschirm waehrend der Analyse wach halten (bestmoeglich)
    dom.js           DOM-Helpers (elements, escapeHtml)
    exif.js          Client-seitige EXIF-Extraktion (exifr) und Vorbereitung des Fotos (prepareImage)
    heic.js          HEIC-Fotos im Browser oeffnen, wenn der Browser es nicht selbst kann (Dekoder nur bei Bedarf geladen)
    geocoding.js     Nominatim Reverse Geocoding (client-seitig, nur fuer hochgeladene Fotos); fuer die Demo-Fotos feste Adresse und fester Kartenausschnitt aus der Seite, ohne Abfrage — fuehrt die Liste der Demo-Fotos
    render.js        Ergebnis-Rendering (Profile, EXIF, Karte, Datenwert)
    live-anzeige.js  Live-Karte waehrend der Analyse: getippter Text, ankommende Ergebnis-Karten
    klang.js         Die zwei Klaenge des Live-Erlebnisses (Web Audio, im Browser erzeugt)
    beast-lockruf.js  Einmaliger Hinweis auf den Beast-Umschalter, wenn das Profil fertig dasteht
    sticky-toggle.js  Umschalter bleibt nach dem Ergebnis oben stehen; haelt die Leseposition beim Moduswechsel
    modus-speicher.js  Modus-Wahl (serioes / Beast) ueber ein Neuladen hinweg merken (sessionStorage)
    realitaets-check.js  Realitaets-Check: anonyme Selbsteinschaetzung, wie gut die KI getroffen hat
    sprachumschalter.js  DE/EN-Umschalter samt Rueckfragen; startet eine laufende Analyse in der neuen Sprache neu
    state.js         Globaler State (requestId, isAnalyzing)
    ui.js            UI-Komponenten (Maintenance-Modal, Scan-Animation, Bias-Toggle, Limit-Banner, Warteschlangen-Anzeige)
    demo.js          Demo-Foto-Initialisierung (Click-Handler fuer die KI-generierten Demo-Fotos, siehe public/img/demo/LICENSE.md)
    stats.js         Stats-Seite: Fetch /api/stats, Limit-Balken, Countdown
    i18n.js          i18n Micro-Modul (initI18n, t, getLanguage, applyTranslations)
    error-logger.js  Anonyme Fehlermeldungen des Browsers an /api/errors (Fehlerart, Phase, Dauer, grobe Geraeteangaben)
    telemetry-logger.js  Anonyme Erfolgs- und Dauer-Meldungen an /api/telemetry (ohne Geraeteangaben, ohne Vorgangsnummer)
    client-context.js  Grobe Geraete- und Netz-Klassen fuer die Fehlermeldungen + Zufallsnummer eines Vorgangs (generateTraceId)
    absturz-wache.js  Erkennt eine Neustart-Schleife der Seite, meldet sie einmal und bricht sie ab
    druck-wache.js   Meldet eine leer gebliebene Seite nach dem Druckdialog (Diagnose)
    echtheit-pruefen.js  Rechnet die Pruefsummen aus build-info.json im Browser nach (Echtheits-Nachweis)
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
  lib/libheif/       Self-hosted: HEIC-Dekoder (libheif + libde265, WebAssembly, LGPL),
                     SELBST GEBAUT: Rezept scripts/libheif-bauen.sh, Nachweis per
                     Workflow libheif-bau.yml; Neubau-Anleitung docs/RUNBOOK.md

functions/src/       Firebase Cloud Functions 2nd Gen (Node 24, europe-west1) — jede Datei unter functions/src/*.js hat hier genau eine Zeile
  index.js           Cloud-Function-Exports (stats, admin, errors, telemetry, enqueue, processJob, jobStatus, reapJobs, erinnerung, laufzeitWache, satzWache), Secret-Deklarationen (EU-gebunden, Endung _EU, u. a. MISTRAL_API_KEY_EU)
  oeffentliche-huelle.js  Was fuer jede oeffentliche Schnittstelle gilt: Cache-Control no-store, gepackte Anfragen abweisen (von index.js um jede oeffentliche Function gelegt)
  handle-stats.js    Stats-Handler (GET-only)
  handle-admin.js    Admin-Endpunkte: Boost und Reset per Bearer-Secret oder per Knopf aus der Benachrichtigung (HMAC-Link -> Bestaetigungsseite -> POST mit Einmal-Nonce); Maintenance nur per Bearer-Secret
  handle-errors.js   Annahme der anonymen Fehlermeldungen des Browsers (Positivliste der Felder, laengenbegrenzt, severity ERROR)
  handle-telemetry.js  Annahme der anonymen Erfolgs- und Dauer-Meldungen (eigene Positivliste ohne Geraeteangaben, severity INFO)
  meldungs-annahme.js  Gemeinsames der zwei Annahmestellen: Rumpfpruefung, Wertgrenze, Messwert-Pruefung; die Feldlisten bleiben bei den Annahmestellen
  config.js          NUR NOCH, was bewusst NICHT einstellbar ist: Modell-IDs,
                     EU-Endpunkt, EU-Datenbank, Upload-Grenze, erlaubte
                     Dateiformate. Jede Zeile mit Begruendung 'BLEIBT IM CODE'.
                     Betriebswerte stehen seit 30.08.2026 AUSSCHLIESSLICH im
                     Firestore-Einstellungssatz -> docs/BETRIEBSPROFILE.md
  db.js              Die einzige Stelle, an der eine Firestore-Verbindung entsteht (benannte Datenbank malzime-eu)
  betriebsprofil.js  Die einstellbaren Werte (Liste: docs/BETRIEBSPROFILE.md), ihre Grenzen
                     und das Lesen aus Firestore; ist der Satz nur gerade nicht lesbar, gilt
                     der zuletzt gueltig gelesene weiter. Vier Obergrenzen SIND Datenschutzzusagen.
  betriebsprofil-kopplung.js  Welche Werte eines Satzes zusammenpassen muessen (reine Rechnung, von betriebsprofil.js aufgerufen)
  produktiv-satz.js  Die Werte fuer den echten Betrieb — Quelle fuer config/betriebsprofil und fuer die Spalte „heute“ der Doku
  test-satz.js       Der Einstellungssatz fuer die Tests, an einer Stelle
  counter.js         Firestore-Zaehler: Stundenlimit, Totals, Stats, Boost, Reset,
                     Maintenance-Mode. Seit 30.08.2026 mit NETZ
                     (netzUeberZeitstempel): Faellt der Zaehler bei Andrang aus
                     — er schreibt in EIN Dokument —, zaehlt das Netz statt zu
                     schreiben und haelt die Kostenbremse aufrecht.
  notify.js          ntfy Push-Benachrichtigungen bei Limit-Erreichung
  animal.js          Motiv-Entscheidung am Feld subject der KI-Antwort (classifySubject), Tierart aus dem Beschreibungstext (detectAnimalType) + Easter-Egg-Profile (Hund/Katze/Vogel/...)
  middleware.js      Rate Limiting (IP-basiert, Grenze+Fenster aus dem Einstellungssatz), IP-Extraktion
  upload.js          Multipart + JSON Body Parsing
  privacy.js         Privacy-Risiko-Erkennung (buildPrivacyRisks): lesbare Adresse und Telefonnummer aus dem Feld visible_text der KI-Antwort, Kennzeichen aus dem ganzen Text
  minor-safety.js    Kinderschutz-Filter fuer Werbe-Eintraege: Stufe 1 fuer alle, Stufe 2 bis zur Untergrenze SCHUTZ_BIS
  minor-safety-woerter.js  Die Wortlisten dazu (reine Daten, deutsch und englisch); jedes Listenwort braucht ein Beispiel in der Pruefreihe
  alters-lesbarkeit.js  Lesbarkeit der Altersangabe im KI-Text: erster Satz einer Karte, Altersversuch, nicht lesbares Alter
  alters-auslese.js     Die Zahl-Lesung dazu: Zahlwoerter, Kategorien, untere und obere Altersgrenze
  alters-lesbarkeit-woerter.js  Die Woerter, Kategorien und Abkuerzungen dazu (reine Daten)
  mistral.js         Mistral AI: runSingleLargeCall (Large macht Beschreibung + beide Profile in EINEM Call) + generateBeastAds (zweiter Aufruf ohne Bild)
  mistral-http.js    Netzschicht zu Mistral: Zugangsschluessel, Zeitgrenzen, Antwort als Strom, Ueberlastmeldung erkennen
  mistral-antwort.js  Antwort der KI auseinandernehmen (reine Funktionen): Live-Text, fehlende Karten, Maskierung (escapeXml)
  ueberlast.js       Was ein Mistral-Aufruf tut, wenn Mistral ablehnt (429) oder kurz weg ist (502, 503, 504)
  json-repair.js     Defensiver JSON-Parser fuer LLM-Outputs (direkt -> heuristisch -> json5 -> Truncation-Recovery)
  throttle.js        In-Memory-Semaphore gegen Mistral-Bursts (AKTIV: withMistralSlot umschliesst jeden Mistral-Call)
  verbindungsfehler.js  Verbindungsabriss zu einem fremden Dienst: erkennen, markieren, einmal neu versuchen, Teiltext retten, Grund protokollieren — nur Code und Kurztext, nie Adressen
  auth.js            HMAC-basierte Admin-Token + Nonces (createAdminToken, verifyAdminToken, createNonce, verifyNonce)
  domains.js         Zentrale CORS-/Origin-Whitelist (ALLOWED_ORIGINS)
  i18n.js            Backend-Locale-Loader (loadPrompts, loadAnimals, resolveLanguage)
  feature-flags.js   Laufzeit-Feature-Flags aus Firestore (useBeastAdsCall, useGemesseneDauer), 30s-Cache, fail-safe
  lokale-schalter.js  Schalter nur fuer lokale Laeufe (MISTRAL_MOCK, QUEUE_LOCAL, NTFY_STUMM): wirken nie in der Produktion; steht dort einer auf 1, startet index.js nicht
  --- Queue-Architektur (v2.0) — der einzige Pfad seit v2.10 ---
  handle-enqueue.js  Queue-Annahme: Validierung -> Stundenlimit zaehlen -> Job anlegen -> Bild in Storage -> Platz bestaetigen -> in Cloud Tasks einreihen
  handle-process-job.js  Queue-Worker (nur Cloud Tasks): claimt Job, fuehrt Mistral-Pipeline aus, schreibt Ergebnis
  job-pipelines.js   Der Analyseweg eines Auftrags (runPipeline): KI-Aufruf, Motiv und sichtbarer Text aus den Feldern der Antwort, Tier-Easter-Egg, Beast-Werbung, Kinderschutz
  job-helfer.js      Kleine Entscheidungen im Analyseablauf (Werbe-Schalter, Fehlerarten, Ersatzbeschreibung)
  handle-job-status.js   Queue-Polling (GET): Status, Warteschlangen-Position, ETA, Ergebnis; jeder Poll ist Liveness-Herzschlag. Abmelden (DELETE): verwirft einen noch wartenden Auftrag, nur mit Abhol-Ticket
  handle-reap.js     Queue-Reaper (geplant, Minutentakt): markiert verlassene Jobs als abandoned, gibt ihren Platz frei, loescht nach den Fristen
  ruecknahme.js      Zurueckgeben, was ein nie analysierter Auftrag belegt: Platz im Stundenfenster freigeben, Foto loeschen — die eine Stelle dafuer, abgewartet
  jobs.js            Queue-Job-Lebenszyklus in Firestore (createJob/claimJob/completeJob/failJob/getQueuePosition/touchJob/abandonJob)
  analyse-ausgang.js  Welche Fehlermeldung ein Endzustand eines Auftrags zeigt, und die eine Fehlerzeile dazu („ein Alarm je gescheiterter Analyse“)
  warteschlangen-rechnung.js  Die eine Rechnung fuer Einlassgrenze und Wartezeit-Ansage: die engere von zwei Bremsen (Parallelitaet, Rate)
  durchsatz.js       Gemessene Dauer der letzten Analysen (Grundlage fuer Wartezeit-Ansage und Einlassgrenze)
  cloud-tasks.js     Queue: Wrapper um Google Cloud Tasks (enqueueJob)
  queue-storage.js   Queue: temporaere Bild-Ablage in Firebase Storage (storeImage/loadImage/deleteImage); loadImage laedt direkt per Speicher-Schnittstelle (Pruefsumme + Wiederholungsregeln der Bibliothek), nicht ueber deren Download-Weg (SECURITY-MODEL 01.10.2026)
  mistral-mock.js    Mistral-Attrappe fuer kostenlose Tests (Unit-Tests, Emulator-Durchklick, Mock-Lasttest)
  --- Wachen und Erinnerung ---
  kapazitaets-wache.js  Meldet, wenn Einstellungssatz und Warteschlange bei Google auseinanderlaufen
  laufzeit-wache.js  Meldet, wenn Analysen an ihre Zeitgrenze stossen
  handle-erinnerung.js  Wochenlauf (montags): ntfy-Push, bevor die halbjaehrliche ZDR-Nachpruefung faellig wird — mit Handlungsanleitung
  erinnerungs-waechter.js  Waechter ueber die Wochen-Erinnerung: liest ihr Lebenszeichen, meldet veraltet, nie gelaufen oder wiederholt nicht lesbar (vom Aufraeumdienst je Lauf gerufen)
  zusagen.js         Gemeinsame Fristlogik fuer datierte oeffentliche Zusagen (Erinnerung und CI-Waechter rechnen mit derselben Definition)
  locales/           Backend-Locale-Dateien
    manifest.json    Verfuegbare Sprachen + Default
    de/prompts.js    Deutsche Prompts (singleLargePrompt mit Alterskalibrierung und SUBJECT-Klassifikation, beastAdsSystem/beastAdsUser, Marken-Sperre, injectionWarning)
    de/animals.js    Deutsche Tier-Easter-Egg-Profile
    en/prompts.js    Englische Prompts (Spiegelung von de/prompts.js)
  __tests__/         Jest Unit-Tests + fixtures/ fuer json-repair
  scripts/           Dev-Tools (Lasttests, Forschungs-Skripte)

docs/                Setup-Dokumentation
.github/             CI/CD Workflows (ci.yml, dependabot-automerge.yml, libheif-bau.yml, release.yml, sicherheit-nachts.yml)
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
- `npm run emulator` — local dev (Functions, Firestore, Hosting, Pub/Sub; needs `functions/.env.local` and, after every start, the settings record — see `docs/QUEUE-EMULATOR.md`)
- `./scripts/deploy.sh [hosting]` — deploy website and server (no argument) or the website only (`hosting`, refused if the server code changed since the last deploy); the server alone is refused, because the server fingerprint ships with the website (only with the owner's explicit release; the script runs the gates, the dry run and the live smoke — never `firebase deploy` directly, see docs/RUNBOOK.md)

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
  Ausnahme seit 03.10.2026: Bei den Demo-Fotos fragt der Browser nichts nach außen (feste
  Adresse und fester Kartenausschnitt, `e2e/beispielbild-ohne-ortsabfrage.test.js`).
  Diese Formulierung ist verbindlich (DOC-2026-08-12-05); die frühere Fassung war im
  Netzwerk-Tab widerlegbar und steht auf der Sperrliste in `.pruefungen/aussentext.txt`
- Server bekommt nur: komprimiertes Bild + Kamera-Metadaten (make, model) OHNE GPS, OHNE dateTimeOriginal
- Keine externen Scripts: Alles self-hosted (Fonts, Leaflet, exifr, libheif). Kein CDN, kein reCAPTCHA, kein Firebase SDK
- Selbst gehostet heisst selbst gewartet: Dependabot und npm audit sehen `public/lib` nicht. Das
  uebernimmt der Nachtlauf `sicherheit-nachts.yml` (`scripts/pruefe-fremd-meldungen.mjs`); eine
  neue Bibliothek unter `public/lib` braucht dort einen Eintrag, sonst wird der Lauf rot. Derselbe
  Lauf beobachtet den selbst betriebenen ntfy-Server (Fassung gespiegelt in
  `.github/fremd-dienste/ntfy/VERSION`; nach jedem Update des Dienstes nachziehen)
- Bot-Schutz: Rate Limiting (IP) + Honeypot + Timing-Check
- CSP: nur 'self' + OpenStreetMap Tiles + Cloud Functions Endpoint + Nominatim

## Security & Configuration

- Use `functions/.env.local` for local config (see `functions/.env.local.example`). Never create `functions/.env`: `firebase deploy` would attach its content to every production function; `scripts/deploy.sh` aborts when such a file exists
- Never commit secrets or API keys
- CSP headers configured in `firebase.json`
- Honeypot field for bot protection
- Prompt-Injection-Schutz: User-Daten in XML-Tags isoliert + escapeXml() auf dynamische Inhalte
- Admin-Aktionen Boost und Reset: GET mit HMAC-Token zeigt nur die Bestaetigungsseite, POST+Nonce fuehrt die Mutation aus (SEC-001). Der Wartungsmodus geht nur mit dem Bearer-Secret (`scripts/wartungsmodus.sh`)

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
- The cache-buster `?v=YYYYMMDDNN` is bumped by `scripts/deploy.sh` on every deploy (every deploy includes the website) — never by hand
- Whoever changes a file under `.github/workflows/`, `.github/dependabot.yml` or one of the tool configs pinned there (`vitest.config.js`, `playwright.config.js`, `eslint.config.mjs`, `functions/eslint.config.js`, `.prettierignore`, `functions/jest.setup.js`) updates its checksum in `scripts/pruefe-deploy-riegel.py` in the same commit (`python3 scripts/pruefe-deploy-riegel.py --vertrag-summen` prints the new values); Dependabot's bumps of pinned actions are exempt. Whoever changes an npm script behind a required CI step, or the Jest settings in `functions/package.json`, updates the pinned wording there (`NPM_SKRIPTE`) in the same commit
- Both profiles (normal + boost) come from ONE call (`runSingleLargeCall` in `mistral.js`); the prompt text lives in `locales/*/prompts.js` (`singleLargePrompt`)
- Bei Aenderungen an der Architektur oder neuen Features: README.md, AGENTS.md, CHANGELOG.md, docs/SETUP.md und docs/SELF-HOSTING.md aktualisieren
- Bei neuen Features: Dokumentation und Anleitungen mitliefern
- dateTimeOriginal wird NICHT an die KI gesendet (verleitet zu falschen Altersschaetzungen)
- Analyse-Prompt: das Alter nur ueber physische Merkmale kalibrieren (Merkmalsraster, abgesichert durch age-markers.test.js)
