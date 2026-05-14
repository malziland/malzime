# Changelog

Alle relevanten Aenderungen an malziME werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [1.6.0] — 2026-05-14

### Architektur-Wechsel: Pure-Mistral-only (Vision + Gemini entfernt)

malziME nutzt seit v1.6.0 ausschliesslich **Mistral AI** (Paris, EU) als KI-Anbieter. Google Vertex AI (Gemini) und Google Cloud Vision API sind komplett aus der Pipeline entfernt. Google bleibt nur fuer Firebase Hosting + Cloud Functions + Firestore (alles in `europe-west1`).

**Hintergrund:** v1.5.x hatte Mistral schrittweise neben Gemini eingefuehrt. User-Entscheidung am 2026-05-13: keine weiteren Zwischenversionen — naechster Live-Deploy soll bereits die saubere Mistral-only-Architektur enthalten.

### Entfernt

- **`functions/src/gemini.js`** — komplett geloescht. Vertex AI Gemini wird nicht mehr aufgerufen.
- **`functions/src/vision.js`** — komplett geloescht. Cloud Vision API wird nicht mehr aufgerufen.
- **`functions/src/feature-flags.js`** — komplett geloescht. Provider-Auswahl entfaellt, weil es nur noch einen Provider gibt.
- **`functions/src/__tests__/gemini.test.js`, `vision.test.js`, `feature-flags.test.js`** — komplett geloescht.
- **`@google-cloud/vision`** und **`@google/genai`** aus `functions/package.json` Dependencies entfernt. `package-lock.json` regeneriert.
- **`config.js`:** `DESCRIBE_MODELS`, `PROFILE_MODELS` und weitere nicht mehr genutzte Konstanten raus.
- **`index.js`:** Vertex-AI-bezogene Initialisierung raus (war ohnehin nur noch im Kommentar). `MISTRAL_API_KEY`-Secret-Bindings bleiben.
- **Multi-Provider-Fallback-Chain** in `handle-analyze.js` entfernt — die Pipeline ruft direkt Mistral, ohne Wahllogik.

### Geaendert

- **`functions/src/handle-analyze.js`:** komplett vereinfacht.
  - Keine Vision-API-Vorabverarbeitung mehr — die Pipeline ruft direkt Mistral Large 3 fuer die Bildbeschreibung.
  - SUBJECT-Klassifikation aus der `SUBJECT:`-Kopfzeile in Mistrals Antwort (siehe Prompt-Aenderung unten) entscheidet, ob ein Tier-Easter-Egg oder ein normales Profil generiert wird.
  - Privacy-Risks werden aus dem "Sichtbarer Text:"-Marker in der Mistral-Beschreibung extrahiert.
  - Wenn Mistral fehlschlaegt, gibt es keinen Fallback-Provider — der User bekommt eine `blocked.apiError`- oder `blocked.overloaded`-Response.
- **`functions/src/animal.js`:** komplett umgebaut.
  - `classifyLabels(labels)` -> `classifyDescription(description)`. Parsing der `SUBJECT:`-Zeile (`ANIMAL_ONLY | HUMAN | MIXED | OTHER`). Bei `ANIMAL_ONLY`: zusaetzliches Keyword-Matching im Beschreibungstext, um den konkreten Tier-Typ fuer das Easter-Egg-Profil zu bestimmen.
  - `buildAnimalProfiles(rawLabelsLower, lang)` -> `buildAnimalProfiles(animalType, lang)`. Direkter Tier-Typ-Parameter statt Label-Liste.
  - `AGE_LABELS`-Export entfaellt (gab es zur Vision-API-Label-Filterung — wird nicht mehr gebraucht).
- **`functions/src/privacy.js`:** komplett umgebaut.
  - Neuer Helper `extractVisibleText(description)` parst die `"Sichtbarer Text:"`- bzw. `"Visible text:"`-Zeile aus der Mistral-Antwort.
  - `buildPrivacyRisks({ visibleText, fullDescription })` ersetzt die alte Signatur mit `{ ocrText, labels }`. Adresse + Telefon werden nur auf der "Sichtbarer Text:"-Zeile gesucht (sonst False Positives aus der Prosa), das Kfz-Kennzeichen-Muster laeuft ueber die ganze Beschreibung.
- **`functions/src/locales/{de,en}/prompts.js`:** Der `mistralDescribeAddendum` enthaelt jetzt eine vorgegebene `SUBJECT:`-Kopfzeile zusaetzlich zur bestehenden "Sichtbarer Text:"-Pflicht. Mistral muss die Kopfzeile als allererste Zeile seiner Antwort liefern.
- **`functions/src/__tests__/i18n-guardian.test.js`:** `animal.js` zur Allowlist hinzugefuegt (enthaelt deutsche Keywords als Suchpatterns — kein UI-Text).

### Frontend-Locales

- **`public/locales/de.json` + `en.json`:** `blocked.safetyFilter` und `blocked.safetyFilterFallback` neutralisiert — keine Google-Referenzen mehr (Texte sprechen jetzt von "KI-Anbieter" allgemein).

### Datenschutzerklaerung + Nutzungsbedingungen

- **`public/datenschutz.html`:**
  - Schritt 3 "Was passiert mit meinem Foto?" komplett neu: nur noch Mistral AI als KI-Verarbeiter.
  - "Wer ist beteiligt?"-Tabelle: Vertex AI Gemini-Zeile + Cloud Vision API-Zeile entfernt. Nur Mistral, Firebase Hosting/Functions, Firestore, OpenStreetMap.
  - "Das Rechtliche"-Abschnitt: Mistral AI SAS (Paris) als Auftragsverarbeiter; Google nur noch als Infrastruktur-Partner ohne KI-Zugriff. Verweis auf Mistral DPA + Trust Center.
  - Stand-Datum 13. Mai 2026. Cache-Buster `?v=2026051301`.
- **`public/nutzungsbedingungen.html`:** Abschnitt 5 + 6 (illegale Inhalte, KI-Anbieter) angepasst.

### Dokumentation

- `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/SELF-HOSTING.md`, `SECURITY.md`, `CONTRIBUTING.md` — alle auf Mistral-only-Architektur umgeschrieben. Vision-API-Hinweise + Gemini-Modelle + Multi-Provider-Fallback-Chain-Beschreibungen entfernt.

### Timeouts angehoben (Mistral ist langsamer als Gemini)

Mistral Large 3 braucht laut Tests rund 3,5x so lang wie Gemini 2.5 Flash. Mit der bisherigen Timeout-Kaskade (60s Frontend / 60s Mistral-Call / 90s Backend-Budget / 120s Cloud-Function) waren Frontend-Abbrueche bei langsamen Describes praktisch garantiert. Neue Werte:

- **`MISTRAL_TIMEOUT_MS`** (`functions/src/config.js`): 60s -> **90s**
- **`REQUEST_BUDGET_MS`** (`functions/src/config.js`): 90s -> **120s**
- **`FETCH_TIMEOUT_MS`** (`public/js/api.js`): 60s -> **180s**
- **Cloud-Function `timeoutSeconds`** (`functions/src/index.js`): 120s -> **180s**

Kaskade ist jetzt: Mistral-Call (90s) < Backend-Budget (120s) < Cloud-Function-Hardlimit (180s) = Frontend-Wartezeit. Frontend bricht nicht mehr ab, bevor das Backend fertig sein kann.

### Behoben

- **Kfz-Kennzeichen-Erkennung verbreitert** (`privacy.js`): Der Kennzeichen-Regex lief nur auf der "Sichtbarer Text:"-Zeile. Erwaehnt Mistral ein Kennzeichen nur im Beschreibungs-Fliesstext, ging es verloren. Jetzt scannt das Muster die komplette Beschreibung — das Muster (`X-XX 1234`) ist spezifisch genug, dass das keine False Positives erzeugt.
- **API-Fehler korrekt gelabelt** (`mistral.js`): Ein echter Mistral-API-/Netzwerk-Fehler (HTTP 5xx) wurde stillschweigend als `null` zurueckgegeben und vom Caller faelschlich als `blocked.safetyFilter` ausgewiesen. `tryDescribeWithPrompt` wirft jetzt `code: "api_error"`, `describeImage` propagiert ihn — der User bekommt `blocked.apiError`. Echte leere Antworten bleiben `blocked.safetyFilter`.

### Dev-Tools

- **`functions/scripts/compare-models.js` + `test-prompts.js` geloescht** — waren das Gemini-vs-Mistral-Vergleichstooling, in v1.6.0 funktionslos (haengen an geloeschtem `gemini.js`/`vision.js`).
- **`functions/scripts/test-subject.js` neu** — prueft die v1.6.0-Tiererkennung gegen echte Bilder ohne Deploy: ruft `mistral.describeImage()` + `classifyDescription()` auf und zeigt pro Durchlauf die `SUBJECT:`-Kopfzeile + Einordnung. Siehe `docs/SETUP.md`.

### Tests

- 282 Backend-Tests gruen (vorher 394 in v1.5.3; rueckwirkend weniger weil ganze Test-Suiten fuer entfernte Module weggefallen sind, dann +3 fuer die Behoben-Fixes).
- 139 Frontend-Tests gruen.
- ESLint + Prettier sauber.

### Migrations-Hinweise fuer Self-Hoster

- `MISTRAL_API_KEY` Firebase Secret muss gesetzt sein — siehe `docs/SETUP.md`.
- Cloud Vision API und Vertex AI im Google Cloud Console koennen nach Deploy deaktiviert werden (sparen Kosten).
- Firestore-Doc `featureFlags/current` aus Phase 3/4 wird nicht mehr gelesen — kann manuell geloescht werden, ist aber harmlos wenn es liegen bleibt.

## [1.5.3] — 2026-05-12

### Phase 4 der Mistral-Migration — Auto-Ramp (in v1.6.0 wieder entfernt)

v1.5.3 brachte einen hartcodierten 8-Tage-Auto-Ramp, der den Mistral-Anteil
schrittweise hochfahren sollte. Die Provider-Wahl lief ueber IP-Hash-Sampling
in `feature-flags.js`, mit einer Firestore-Notbremse als Override.

**Der Ramp hat in der Praxis nicht wie gedacht funktioniert.** Das IP-basierte
Sampling ist "sticky" pro IP — bei Workshop-Gruppen hinter einer gemeinsamen
NAT-IP landet die ganze Gruppe im selben Sample-Bucket, also entweder 0 % oder
100 % Mistral, nie ein echter gradueller Ramp. In den Live-Logs kam ueber den
Tag-1-Anteil (1 %) dadurch kein einziger Mistral-Call zustande. Der gesamte
Auto-Ramp-Mechanismus (`MISTRAL_RAMP_*` in `config.js`, `calculateRampPct` +
`feature-flags.js`) wurde in v1.6.0 ersatzlos entfernt.

## [1.5.2] — 2026-05-12

### Verbesserungen (Phase 3 der Mistral-Migration — Feature-Flag + Multi-Provider-Fallback-Chain)

- **`functions/src/feature-flags.js`** neu: liest `aiProvider` aus Firestore-Doc `featureFlags/current` mit 30s Cache, fail-open auf `"gemini"` (Default). Akzeptiert nur `"gemini"` oder `"hybrid"` — ungültige Werte fallen still auf Default zurück. 13 Tests.
- **`functions/src/throttle.js`** neu: per-Instance-Semaphore mit Default-Limit 6 (matched Mistral Scale-Tier RPS). FIFO-Queue mit Timeout, idempotenter Release. Schützt vor Workshop-Bursts. 9 Tests. Noch nicht in mistral.js eingebunden — Aktivierung bei Bedarf in Phase 4.
- **`functions/src/handle-analyze.js`** refaktoriert: zwei neue Helper `runDescribeStage` und `runProfileStage` realisieren die Multi-Provider-Fallback-Chain:
  - **Stage 1 Describe:** bei `aiProvider="hybrid"` zuerst Mistral, dann Gemini als Fallback, dann Vision-Labels-Heuristik
  - **Stage 2 Profile:** analog Mistral → Gemini
  - **Default-Pfad `aiProvider="gemini"`:** verhalten unveraendert, ruft nur Gemini-Funktionen
- **`functions/src/index.js`** deklariert `MISTRAL_API_KEY` via `defineSecret` und bindet das Secret an die `analyze`-Function. Secret wird erst beim ersten Hybrid-Provider-Call gelesen — der Default-Pfad braucht den Key nicht.
- **`functions/src/__tests__/index.test.js`** um 8 Phase-3-Tests erweitert: alle Fallback-Pfade (Mistral OK, Mistral→Gemini, Mistral+Gemini→Vision-Labels, alles versagt, Default-Flag bleibt Gemini-only).
- **356 Backend-Tests** alle gruen (vorher 326, +30 neu in Phase 3: 13 feature-flags + 9 throttle + 8 fallback-chain).

### Wichtig

- **Live-Verhalten bleibt unveraendert.** Default-Flag-Wert ist `"gemini"`, Firestore-Doc `featureFlags/current` existiert nicht, Default greift. Die Live-Pipeline ruft weiterhin ausschliesslich Gemini-Funktionen wie bisher.
- **Aktivierung erst in Phase 4** durch Setzen des Firestore-Docs auf `{ aiProvider: "hybrid" }`. Rueckschalten durch `{ aiProvider: "gemini" }` — beide Pfade sind ueber denselben Code-Pfad jederzeit waehlbar.
- **`MISTRAL_API_KEY` Firebase Secret ist gesetzt** (Version 1 in Secret Manager) — wartet auf den ersten Hybrid-Call der ihn liest.

## [1.5.1] — 2026-05-12

### Verbesserungen (Phase 2 der Mistral-Migration — dormanter Schatten-Code)

- **`functions/src/json-repair.js`** neu (~310 Zeilen): provider-agnostische 4-stufige JSON-Reparatur-Schicht.
  - Stufe 1: direkter `JSON.parse`
  - Stufe 2: heuristisches Cleanup (Markdown-Fencing, Smart-Quotes, Trailing-Commas, Control-Char-Escape, Inner-Quote-Escape)
  - Stufe 3: `json5.parse` als toleranter Backup
  - Stufe 4: Truncation-Recovery via Stack-Snapshot — findet letzten sauber geschlossenen Wert, schließt offene Brackets programmatisch
  - Output-Bounds (SEC-004) integriert
- **`functions/src/mistral.js`** neu (~260 Zeilen): Mistral-Provider mit derselben Schnittstelle wie `gemini.js`. Hybrid-Architektur (Large 3 Describe → Small 4 Profile-Generation), Fallback auf Voll-Large 3 bei Small-4-Failure, JSON-Repair-Layer integriert. API-Key kommt ausschliesslich aus `process.env.MISTRAL_API_KEY`.
- **`functions/src/config.js`** um Mistral-Konstanten erweitert (Modelle, Endpoint, Pricing, Timeouts) — backward-compatible.
- **`mistralDescribeAddendum`** in `de/prompts.js` und `en/prompts.js` — der Zusatz-Prompt der Mistral anweist, Bild-Text in die Beschreibung zu integrieren (kein separater Vision-Schritt).
- **`json5` ^2.2.3** als Production-Dependency in `functions/package.json`.
- **57 neue Tests** (`json-repair.test.js` 34, `mistral.test.js` 22, `config.test.js` +1) — Backend-Test-Suite jetzt bei 326 Tests, alle gruen.
- **Test-Fixtures** aus den realen Mistral-Failures vom 12.05. (`compare-failed-mistral-large-3-*.txt`) zur Verifikation des JSON-Repair-Layers.

### Wichtig

- **Live-System unverändert**: weder `handle-analyze.js` noch `gemini.js` importieren die neuen Module. Der Code ist dormant und wird erst in Phase 3 (Feature-Flag + Multi-Provider-Fallback) aktiviert. Deploy ist daher rein additiv ohne Verhaltens-Aenderung in Produktion.

## [1.5.0] — 2026-05-12

### Verbesserungen (Phase 1 der Mistral-Migration)

- **Prompt-Haertung mit zwei neuen Bloecken** in `functions/src/locales/de/prompts.js` und `functions/src/locales/en/prompts.js`:
  - **`AGE_ANCHOR`** — kalibriert Altersschaetzung in zwei Richtungen:
    - **Primaere Achse Koerperproportionen**: Schultern-zu-Kopf-Verhaeltnis und Handgroesse entscheiden zuerst die Spanne (Kind 2-10 J / Pre-Teen-Teen 10-15 J / Teen-Jung-Erwachsen 15-22 J), Hautmerkmale verfeinern danach. Verhindert, dass Make-up, Frisur oder Kleidung die Reife jugendlicher Gesichter nach oben verzerren.
    - **Zwangs-Mapping fuer Erwachsene** mit Mindest-Alter pro sichtbarem Merkmal (Nasolabialfalten ≥38 J, Lid-Erschlaffung ≥45 J, Pigmentflecken Haende ≥45 J, etc.). Kombinations-Regel: drei oder mehr Merkmale gleichzeitig → Pflicht-Spanne 40-55 J, egal wie jung das Gesamtbild wirkt. Adressiert systematische Unterschaetzung von Erwachsenen, die im Alltag oft juenger geschaetzt werden.
    - **Begruendungspflicht**: Wenn das Modell trotz sichtbarer Merkmale juenger schaetzen will, muss es im Beschreibungstext explizit erklaeren, warum das Merkmal NICHT sichtbar ist.
  - **`SCHEMA_RULES`** — Laengen-Vorgaben und Format-Saeuberung in beiden Profil-Schemas:
    - Pro Kategorie 3-5 Saetze, ca. 50-80 Woerter (statt unbegrenzt mit Mindest-30-Woerter).
    - `ad_targeting` jetzt 6-8 Eintraege a 1-3 Woerter (statt 8-12 mit unklarem Limit).
    - `manipulation_triggers` max. 30 Woerter pro Eintrag (statt mindestens 15 ohne Obergrenze).
    - `profileText` Normal max. 100 Woerter, Boost max. 150 Woerter (statt 5-8 bzw. 10-15 Saetze ohne Hard-Cap).
    - **Keine Preisangaben** in `ad_targeting`/`werbeprofil`/`kaufkraft` — nur Marken-, Produkt- oder Modellnamen (Einkommens-Spannen bleiben bei `einkommen` erlaubt).
    - **Reines JSON** ohne Markdown-Wrapping, keine \`\`\`json-Codebloecke, keine erklaerenden Saetze drumherum.
  - Beide Bloecke werden an `describePrompt`, `describeFallback`, `jsonSchemaNormal` und `jsonSchemaBoost` angehaengt (Doppelsicherung: Modell sieht Anker sowohl in der Bildbeschreibungs-Phase als auch in der Profil-Phase).
- **Konflikt-Aufloesung im Schema**: Alte Live-Regel `ad_targeting: 8-12 Eintraege` wurde durch `6-8 Eintraege a 1-3 Woerter` ersetzt; alte `manipulation_triggers: mindestens 15 Woerter` durch `1-2 Saetze, maximal 30 Woerter`; alte `profileText Normal: 5-8 Saetze` durch `max 100 Woerter`; alte `profileText Boost: 10-15 Saetze` durch `max 150 Woerter, etwa 8-10 Saetze`. So widersprechen sich die neue Vorgabe und die alte Anweisung nicht mehr im selben Prompt.
- **`functions/scripts/test-prompts.js` als Pass-Through**: Frueher hat dieses Script die Anker zusaetzlich zu den Live-Prompts angehaengt — jetzt liegen die Anker direkt in den Live-Prompts, daher ist `test-prompts.js` nur noch ein 1:1-Re-Export der Live-Prompts. Verhindert, dass `compare-models.js` doppelte Anker anwendet.

### Beobachtete Effekte aus Spot-Test (Mädchen 14 J)

- **Kosten Gemini Live**: $0,0214 → $0,0187 (-12,6 %)
- **Kosten Hybrid (Large 3 + Small 4)**: $0,0093 → $0,0083 (-10,7 %)
- **Token-Output**: Profile sind knapper und kompakter, `ad_targeting` reduziert auf 7-8 saubere Eintraege.
- **Alters-Genauigkeit**: bei diesem konkreten Bild keine Verbesserung — die Schultern-zu-Kopf-Proportion war bereits adult-aehnlich und der Anker ordnet das korrekt in 18-22 J ein. Anker zeigt erwartbare Wirkung bei klar erwachsenen Personen, die im Alltag juenger geschaetzt werden (Zwangs-Mapping greift dort).
- **JSON-Parsefehler**: keine, beide Anbieter.
- **269 Backend-Tests** weiterhin gruen.

## [1.4.0] — 2026-05-11

### Wartung (zukunftssichernd)

- **SDK-Migration auf `@google/genai` 2.0.1**: Die alte `@google-cloud/vertexai` SDK (1.12.0) wird am 24.06.2026 von Google entfernt. Komplettes Refactor von `functions/src/gemini.js` auf die neue, einheitliche Gen-AI-SDK:
  - `new VertexAI({ project, location })` → `new GoogleGenAI({ vertexai: true, project, location })`
  - `vertexAI.getGenerativeModel({...}).generateContent({...})` → `genai.models.generateContent({ model, contents, config })`
  - Response-Struktur: Verschachteltes `response.response.candidates` wird flach zu `response.candidates`.
  - `generationConfig` + `safetySettings` jetzt zusammen unter `config`.
  - Verhalten bleibt identisch — gleicher Output-Parser, gleiche Fehler-Klassifikation, gleiche Modelle (`gemini-2.5-flash` + `gemini-2.0-flash-001` Fallback).
  - 269 Backend-Tests gruen. Tests-Mocks von alter auf neue SDK-Surface umgestellt.
  - `setGenAIForTest()` als zusaetzlicher Export fuer einfacheres Mocking.
- **gitleaks-action auf Node.js 24 vorgezogen**: ENV-Variable `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` im `secret-scan`-Job. GitHub forced ab 02.06.2026 ohnehin Node 24; mit dem Override verschwindet die Deprecation-Warnung schon jetzt aus den CI-Logs. Action-Version auf `v2.3.9` gepinnt (Latest).

## [1.3.2] — 2026-05-11

### Verbesserungen

- **Profil-Schemas geschaerft**: Vier zusaetzliche Regeln in `jsonSchemaNormal` und `jsonSchemaBoost`, damit Gemini-Modelle sich strenger an die Vorgaben halten — speziell juengere Modelle wie `gemini-3.1-flash-lite` neigten sonst zu pauschalen Stichworten und persoenlichen Spekulationen ohne Bildbezug.
  - **Belegpflicht**: Jede Aussage muss durch ein konkretes, sichtbares Element aus der Bildbeschreibung gedeckt sein. Element wird wortwoertlich zitiert. Wo das Bild keinen Beweis liefert, schreibt das Modell jetzt explizit "Hierzu sind keine sichtbaren Hinweise vorhanden" statt zu spekulieren.
  - **Mindestlaenge pro Kategorie**: Mindestens 2 vollstaendige Saetze, ~30 Woerter. Knappe Etiketten wie "Du bist mitteleuropaeisch." sind nicht mehr zulaessig.
  - **Manipulation-Trigger als Fliesstext**: Bisher generierten kleinere Modelle nur Stichworte ("Statusangst durch Vergleich"). Jetzt sind 4-6 ausformulierte Saetze mit mindestens 15 Woertern pro Eintrag und konkretem Bildbezug vorgeschrieben — inkl. Beispiel-Eintrag und Negativ-Beispiel im Prompt.
  - **Boost-Tonalitaet fokussiert**: Boost-Modus richtet die Haerte jetzt explizit gegen das System (Algorithmen, Konzerne, Marketing) statt persoenlich gegen die Person. Persoenliche Bewertungen bleiben erlaubt, aber nur mit klarem Bildbeleg — Pauschalbeleidigungen ("Mitlaeufer", "wandelndes Klischee") sind verboten.

### Tooling

- **Neues Dev-Tool `functions/scripts/compare-models.js`**: Lokales Side-by-Side-Skript zum Vergleichen verschiedener Gemini-Modelle (z.B. 2.5 Flash vs 3.1 Flash-Lite) mit dem gleichen Bild. Faehrt die komplette malzime-Pipeline (Vision API + Beschreibung + Normal-Profil + Boost-Profil) parallel mit beiden Modellen, miss Tokens und Kosten und erzeugt einen HTML-Vergleichsbericht. Schreibt nicht in Firestore, beruehrt das Live-System nicht. Anleitung in `docs/SETUP.md`.
- **Vergleichsbericht-Output ausgeschlossen**: `compare-result.html` ist in `.gitignore` aufgenommen — der Bericht enthaelt Test-Bilder und generierte Profile, die nicht ins oeffentliche Repo gehoeren.

### Wartung

- **Backend-Dependencies aktualisiert**: `@google-cloud/vision` 5.3.5 → 5.3.6, `firebase-admin` 13.8.0 → 13.9.0, `jest` 30.3.0 → 30.4.2, `eslint` 10.2.1 → 10.3.0. Alle 269 Backend-Tests bleiben gruen.
- **Frontend-Dependencies aktualisiert**: `vitest` + `@vitest/coverage-v8` 4.1.4 → 4.1.5, `jsdom` 29.0.2 → 29.1.1, `eslint` 10.2.1 → 10.3.0. Alle 139 Frontend-Tests bleiben gruen.
- **firebase-tools CLI aktualisiert**: 15.5.1 → 15.17.0 (global via `npm install -g firebase-tools@latest`).

## [1.3.1] — 2026-04-19

### Sicherheit

- **protobufjs RCE gefixt (CRITICAL)**: `protobufjs` auf 7.5.5 aktualisiert — schliesst Arbitrary-Code-Execution-Luecke (GHSA-xq3m-2v4x-88gg), die transitiv ueber `@google-cloud/firestore` + `@google-cloud/vision` + `firebase-admin` in die Cloud Functions gelangte.
- **Weitere High-Luecken gefixt**: `node-forge` 1.3.3 → 1.4.0 (Signature Forgery, DoS), `path-to-regexp` 0.1.12 → 0.1.13 (ReDoS), `fast-xml-parser` (Entity Expansion Bypass).
- **CI-Audit-Schwelle strenger**: `npm audit --audit-level` von `critical` auf `high` angehoben. Hohe Schwachstellen (z. B. ReDoS, Signature Forgery) werden jetzt in der CI sichtbar gemacht statt unbemerkt durchzurutschen.

### Wartung

- **Backend-Dependencies aktualisiert**: `@google-cloud/vertexai` 1.10.0 → 1.12.0, `@google-cloud/vision` 5.3.4 → 5.3.5, `firebase-admin` 13.7.0 → 13.8.0, `firebase-functions` 7.0.6 → 7.2.5, `jest` 30.2.0 → 30.3.0, `eslint` 10.0.2 → 10.2.1, `prettier` 3.8.1 → 3.8.3.
- **Frontend-Dependencies aktualisiert**: `vitest` + `@vitest/coverage-v8` 4.0.18 → 4.1.4, `@playwright/test` 1.58.2 → 1.59.1, `jsdom` 28.1.0 → 29.0.2 (Major-Bump, alle 139 Frontend-Tests bleiben gruen), `eslint` 10.0.0 → 10.2.1, `prettier` 3.8.1 → 3.8.3.

### Ops

- **Branch Protection fuer `main`**: Required Status Checks aktiv fuer `test-backend`, `test-frontend`, `test-e2e` und `secret-scan`. Dependabot-Auto-Merge greift jetzt nur noch bei nachweislich gruener CI. `strict=true` (Branch muss up-to-date sein), `allow_force_pushes=false`, `allow_deletions=false`.

## [1.3.0] — 2026-03-07

### Neu

- **Englische Uebersetzung**: Komplette i18n-Unterstuetzung fuer Englisch — UI-Texte, Gemini-Prompts, Tier-Profile und Schemas. Sprache wird automatisch ueber Browser-Sprache oder `?lang=en` URL-Parameter gewaehlt. Beitrag von [@MechanikGamer](https://github.com/MechanikGamer) (PR #11, Issue #4).

## [1.2.10] — 2026-02-27

### Verbesserungen

- **Modus-spezifische Profil-Schemas**: `jsonSchema` in zwei getrennte Schemas aufgeteilt (`jsonSchemaNormal` + `jsonSchemaBoost`). Beide haben identische JSON-Struktur und Keys, aber komplett unterschiedliche Feld-Anweisungen:
  - **Normal-Modus**: Sachlich-nüchtern wie ein echtes Scoring-System. Persoenlichkeit als psychometrische Einordnung (Big-Five-Stil), Verletzlichkeit als systemischer Risikobericht, Profiltext 5-8 Saetze nüchtern-analytisch.
  - **Beast Mode**: Zynisch-spöttisch und exploitativ. Persoenlichkeit als psychologische Angriffsflaeche, Verletzlichkeit als Algorithmus-Schwachstellenanalyse, Profiltext 10-15 Saetze mit scharfen Ueberzeichnungen.
  - **Widerspruch behoben**: Normal-System-Prompt sagte "5-8 Saetze sachlich", geteiltes Schema sagte "10-15 Saetze konfrontativ" — jetzt modusspezifisch korrekt.
- **buildPrompt erweitert**: Akzeptiert jetzt Schema als 7. Parameter statt es intern aus dem Prompt-Modul zu laden. `generateBothProfiles` uebergibt das jeweils passende Schema pro Modus.

### Tests

- **Testabdeckung**: 269 Backend + 139 Frontend = 408 Tests
- **Neue Tests**: Schema-Konsistenz-Pruefung (beide Schemas haben identische JSON-Keys), Schema-Differenzierung in buildPrompt

## [1.2.9] — 2026-02-27

### Bugfixes

- **Altersschaetzung bei Erwachsenen 25+ (umfassende Ueberarbeitung)**: Personen ueber 25 wurden systematisch zu jung geschaetzt — oft 10 Jahre daneben. Drei Ursachen identifiziert und behoben:
  - **Fehlende Alterungsmerkmale:** Beschreibungs-Prompts (describePrompt + describeFallback) massiv erweitert um: Jowls/Haengewangen, Marionetten-Linien, Oberlid-Erschlaffung, Lippenvolumen-Verlust, Porengröße, Handvenen-Sichtbarkeit, Hautverdünnung/-transparenz, Sehnen-Sichtbarkeit, Halsbaender, Dekollete-Textur, Ergrauungs-Prozentanteil, Augenbrauen-Ausdünnung, Haarstruktur-Veraenderungen. Haende und Hals explizit als zuverlaessigste Indikatoren hervorgehoben.
  - **Kalibrierungs-Anker:** Neue Zuordnungs-Skala in allen 4 Prompts: Glatte Haut = unter 25, erste Linien = 28-35, deutliche Falten + Volumenverlust = 35-45, Jowls + Halsfalten + Lid-Erschlaffung = 45-55, tiefe Falten + Hautverdünnung = 55+. Gibt dem Modell eine Referenz statt vage Merkmale.
  - **Anti-Hoeflichkeits-Bias:** Explizite Anweisung in Beschreibungs- und System-Prompts: "Alterungsmerkmale ehrlich beschreiben ist KEINE Beleidigung — systematisches Juenger-Schaetzen ist ein Messfehler." Gemini tendiert dazu, schmeichelhaft zu sein — das wird jetzt direkt adressiert.
  - **Differenzierte Makeup-Regel:** Bei jugendlich Wirkenden weiterhin streng getrennt (Kinderschutz). Bei eindeutig Erwachsenen sind Mode und Stil jetzt legitime Alters-Indikatoren.

## [1.2.8] — 2026-02-24

### Verbesserungen

- **Altersangepasste Sprache**: Profile passen Wortwahl und Ton automatisch an das geschaetzte Alter an. Jüngere Personen bekommen einfachere Sprache ohne Fremdwoerter, aeltere sachlich-analytische Formulierungen. Untergrenze ist das Sprachniveau fuer 10-14-Jaehrige — darunter wird nicht vereinfacht. Inhalt und Schaerfe bleiben in jeder Altersstufe gleich, nur die Verpackung aendert sich. Betrifft beide Modi (Normal + Beast Mode).
- **Beast Mode: Erweiterte Eigenschafts-Palette**: Negative Charaktereigenschaften und Schwaechen von ~30 auf ~100 Begriffe erweitert, geordnet in 8 Kategorien (Psyche, Soziales, Sucht/Laster, Gesundheit, Finanzen, Beziehung, Beruf, Weltbild). Jede Eigenschaft wird aus sichtbaren Merkmalen im Bild abgeleitet — nichts wird erzwungen. Profile sind dadurch abwechslungsreicher und schaerfer.
- **Beast Mode: Geschaerfte Profilfelder**: Gesundheit umfasst jetzt auch psychische Gesundheit, Suchtverhalten und Essmuster. Verletzlichkeiten werden konkreter statt abstrakt formuliert. Der Profiltext benennt explizit unangenehme Wahrheiten ueber Gewohnheiten — aber nur wenn das Bild Anhaltspunkte liefert.
- **Beast Mode: Ton-Schaerfung**: Texte jetzt explizit zynisch, spoettisch und unterhaltsam — scharf treffen aber auch Spass machen zu lesen.
- **Normal-Modus: Erweiterte Eigenschafts-Palette**: Charaktereigenschaften von ~25 auf ~145 Begriffe massiv erweitert, geordnet in 8 Kategorien mit jeweils Staerken UND Schwaechen. Ausgewogenes Scoring wie ein echtes Profiling-System — nicht einseitig negativ. Kategorien: Psyche, Soziale Kompetenz, Gewohnheiten/Lebensstil, Gesundheit, Finanzverhalten, Beziehung, Beruf/Leistung, Weltbild/Denkweise.

## [1.2.7] — 2026-02-24

### Features

- **Nutzungsbedingungen**: Neue Unterseite `/nutzungsbedingungen` mit 12 Abschnitten (Geltungsbereich, erlaubte/verbotene Nutzung, Zielgruppe, Workshops, Haftung, Geistiges Eigentum, Recht/Gerichtsstand, Kontakt). SEO-optimiert mit canonical URL, Open Graph Tags und Sitemap-Eintrag.

### Dokumentation

- **Footer aktualisiert**: Nutzungsbedingungen-Link auf allen 5 Seiten (Startseite, Impressum, Datenschutz, Nutzungsbedingungen, Stats) eingefuegt
- **Sitemap**: Neue URL `https://malzi.me/nutzungsbedingungen` hinzugefuegt
- **Firebase Routing**: Clean-URL Rewrite `/nutzungsbedingungen` → `/nutzungsbedingungen.html`
- **i18n**: Neuer Locale-Key `footer.nutzungsbedingungen`

## [1.2.6] — 2026-02-23

### Bugfixes

- **Stats-Zaehler setzen sich um Mitternacht zurueck**: Tages-, Wochen-, Monats- und Jahreszaehler auf der Stats-Seite zeigten nach Mitternacht weiterhin die alten Werte — bis zum naechsten Upload. `getStats()` vergleicht jetzt die gespeicherten Datums-Keys live mit dem aktuellen Wiener Datum und gibt 0 zurueck wenn sie nicht mehr passen. Kein Cron-Job noetig.
- **Zeitzone Europe/Vienna**: Alle Datums-Keys (Tag, Woche, Monat, Jahr) werden jetzt in oesterreichischer Lokalzeit berechnet — inkl. automatischer Sommer-/Winterzeit-Umstellung. Vorher wurde UTC verwendet, was dazu fuehrte dass der Tageswechsel um 01:00 (Winter) bzw. 02:00 (Sommer) statt um Mitternacht stattfand.

### Tests

- **Testabdeckung**: 266 Backend + 139 Frontend + 2 E2E = 407 Tests
- **getDateKeys**: 6 neue Tests (Format, Montag-Berechnung, Vienna-Zeitzone)
- **getStats Live-Reset**: 4 neue Tests (stale todayDate/weekStart/monthKey/yearKey → 0)

## [1.2.5] — 2026-02-22

Accessibility-Verbesserungen, Hardening und Test-Ausbau.

### Accessibility

- **Focus-Management nach Analyse**: Nach dem Schliessen des Disclaimer-Modals wird der Focus auf das Ergebnis-Panel gesetzt statt auf dem verschwundenen Button zu verbleiben
- **Fehlermeldungen als `role="alert"`**: Status-Meldungen bekommen dynamisch `role="alert"` fuer robustere Screenreader-Ankuendigung bei Fehlern
- **Screenreader-Ankuendigungen**: Analyse-Start und -Ende werden per `aria-live="assertive"` Live-Region angekuendigt ("Analyse gestartet" / "Analyse abgeschlossen"). Visuelle Zwischentexte bleiben nur visuell
- **SR-Only CSS-Klasse**: Neue `.sr-only` Utility-Klasse (opacity-basiert fuer Safari/VoiceOver-Kompatibilitaet)

### Bugfixes

- **Timeout-Cleanup gemini.js**: `clearTimeout` wird jetzt per `try/finally` um `Promise.race` in `describeImageWithModel()` immer ausgefuehrt — auch wenn die API-Promise rejectet. Behebt einen Timer-Leak bei Fehlerantworten

### Hardening

- **SITE_URL statt ALLOWED_ORIGINS[0]**: ntfy-Admin-Links verwenden jetzt eine eigene `SITE_URL`-Konstante statt der ordnungsabhaengigen ersten CORS-Origin
- **E2E-Tests in CI**: Playwright Smoke-Tests laufen jetzt im GitHub Actions Workflow (neuer `test-e2e` Job)
- **test-results/ in .gitignore**: Playwright-Artefakte verschmutzen nicht mehr den Worktree

### Tests

- **E2E Smoke-Tests (Playwright)**: 2 Smoke-Tests — Demo-Flow (Seite laden → Demo-Klick → Disclaimer → Profil gerendert) und fehlerfreies Laden. API-Calls gemockt
- **Testtiefe upload.js erweitert**: 7 neue Edge-Case-Tests (Multipart-Parsing, Charset-Varianten, Request-Abort, leere Datei)
- **Testtiefe gemini.js erweitert**: 13 neue Integration-Tests mit gemocktem Vertex AI (describeImage Fallback/Quota, generateBothProfiles Schema-Validierung/Markdown/Truncation, isQuotaError)
- **Testtiefe ui.js erweitert**: 11 neue Tests (role="alert" a11y, srAnnounce Start/Ende, Limit-Banner, Maintenance-Modal)
- **Testtiefe handle-stats.js**: 5 neue Tests (405 bei POST, 503 bei Ausfall, Maintenance-Flag)
- **Testabdeckung**: 256 Backend + 139 Frontend + 2 E2E = 397 Tests

## [1.2.4] — 2026-02-22

Wartungsmodus-Modal, Prompt-Verbesserungen und Backend-Hardening.

### Features

- **Wartungsmodus-Modal**: Neues rotes Warn-Modal mit Blur-Hintergrund blockiert die gesamte Seite im Wartungsmodus. Focus-Trap (nur Reload-Button erreichbar), `role="alertdialog"`, rote Scan-Lines und pulsierendes Warn-Icon. Aktivierung per Admin-API (`POST /api/admin/maintenance`) oder automatisch bei 503-Response
- **Maintenance-Check beim Seitenstart**: Die Hauptseite prueft beim Laden via `/api/stats` ob der Wartungsmodus aktiv ist und zeigt sofort das Modal

### Verbesserungen

- **Ethnizitaets-Erkennung verbessert**: Bildbeschreibungs-Prompt enthaelt jetzt eine explizite Hauttöne-Skala (very fair bis very dark brown), detaillierte Gesichtszug-Merkmale (Nasenform, Augenform, Kieferlinie, Jochbein) und differenzierte Haarstruktur-Begriffe (straight/wavy/curly/coiled/kinky). Verhindert fehlerhafte Zuordnungen bei suedasiatischen, nahöstlichen und anderen nicht-europaeischen Personen
- **Altersschaetzung bei gestylten Jugendlichen verbessert**: Bildbeschreibungs-Prompt trennt jetzt Makeup/Styling explizit von natuerlichen Gesichtszuegen. Zusaetzlich werden Koerperproportionen beschrieben die Schminke nicht veraendert (Handgroesse, Handgelenke, Schulterbreite, Kopf-zu-Koerper-Verhaeltnis). Profil-Prompts ignorieren kosmetische Reife bei der Altersschaetzung — Knochenstruktur und Entwicklungsstand zaehlen
- **Einkommensschaetzung kalibriert**: Alle Prompts orientieren sich jetzt am oesterreichischen Lohnniveau mit konkreten Referenzwerten (Studierende 400-1.200€, Median aller Erwerbstaetigen 2.700€ brutto, Durchschnitt 3.100€ brutto, Median Vollzeit 3.900€ brutto) statt an US-amerikanischen Gehaeltern
- **Herkunfts-Ableitung praezisiert**: Ethnische Herkunft wird ausschliesslich aus Hautton, Gesichtszuegen und Haarstruktur abgeleitet — der Hintergrund/Ort im Bild wird explizit ignoriert (Person kann im Urlaub sein)

### Bugfixes

- **Upload-Limit korrigiert**: Frontend zeigte "max 20 MB" an, Backend akzeptierte aber nur 6 MB. Upload-Hint, Fehlermeldung und JS-Check auf 6 MB angeglichen
- **ntfy-Links Self-Hosting-tauglich**: Admin-URLs in ntfy-Benachrichtigungen (Boost, Reset, Stats) kommen jetzt aus `domains.js` statt einer hardcodierten Domain. Self-Hosted-Instanzen bekommen korrekte Links

### Sicherheit

- **Accepted Risks dokumentiert**: Fail-open-Verhalten bei Firestore-Ausfaellen (Counter + Nonce) und `minimatch` ReDoS in Vision-API-Abhaengigkeitskette als akzeptierte Risiken in `SECURITY.md` dokumentiert mit Begruendung und Mitigations

### Tests

- **Testabdeckung**: 222 Backend + 128 Frontend = 350 Tests

## [1.2.3] — 2026-02-22

Demo-Bilder, UX-Verbesserungen und Code-Cleanup.

### Verbesserungen

- **Neue Demo-Fotos**: Café- und Wanderer-Demobild durch neue Stock-Fotos ersetzt (mit eingebetteten Fake-EXIF-Daten fuer Workshops)
- **Scroll nach Analyse**: Nach Klick auf den Disclaimer-Hinweis scrollt die Seite automatisch nach oben zum Ergebnis — besonders wichtig bei Demo-Bildern am Seitenende
- **Demo-Thumbnail-Zuschnitt**: Café-Thumbnail zeigt jetzt den Kopf statt der Mitte (`object-position: top`)
- **Stats-Footer bereinigt**: Ueberfluessigen „Startseite"-Link aus dem Stats-Footer entfernt

### Code-Cleanup

- **demo-data.js entfernt**: Vorgeschriebene Demo-Profile waren toter Code — das Frontend schickt Demo-Bilder durch die echte KI-Analyse, nicht durch vorgeschriebene Profile. Server-seitiger Demo-Pfad, Tests und Dokumentation bereinigt
- **Test-Coverage-Scripts**: `npm run test:coverage` (Backend) und `npm run test:frontend:coverage` (Frontend) hinzugefuegt
- **Testabdeckung**: 187 Backend + 126 Frontend = 313 Tests

### Dokumentation

- **Sitemap aktualisiert**: Stats-Seite hinzugefuegt, lastmod-Daten aktualisiert
- **README-Screenshots erneuert**: Aktuelle Startseite mit neuen Demo-Bildern
- **README + SETUP.md aktualisiert**: Fehlende Module ergaenzt (counter, auth, notify, stats), Testanzahlen korrigiert, Security-Sektion erweitert, veraltete Demo-Referenzen entfernt

## [1.2.2] — 2026-02-21

Externer Code-Review: 5 Bugfixes + 3 Hardening-Massnahmen.

### Sicherheit

- **SEC-001: Admin-Aktionen nicht mehr per GET ausfuehrbar**: ntfy-Buttons oeffnen jetzt eine Bestaetigungsseite (GET) — die eigentliche Mutation passiert erst per POST mit kurzlebiger Nonce (5 Min gueltig). Schuetzt gegen Link-Prefetcher, CSRF und versehentliche Bot-Zugriffe
- **SEC-002: HMAC-Amount kann nicht mehr manipuliert werden**: Boost ueber HMAC/Nonce immer fest 100. Benutzerdefinierte Betraege nur noch per Bearer-Auth (POST body)
- **SEC-003: Prompt-Injection via XML-Tags verhindert**: Alle dynamischen Inhalte in Gemini-Prompts werden jetzt per `escapeXml()` bereinigt — `<`, `>`, `&`, `"`, `'` werden escaped

### Bugfixes

- **BUG-001 (P0): Counter zaehlt erst nach Validierung**: `checkAndIncrement()` wurde von vor den Validierungen nach die Magic-Byte-Pruefung verschoben. Honeypot-Treffer, Demo-Requests und ungueltige Uploads verbrauchen jetzt kein Stundenlimit mehr
- **BUG-002: getStats() ist jetzt read-only**: Fire-and-forget Cleanup-Write aus dem Stats-Endpunkt entfernt. Cleanup passiert nur noch in `checkAndIncrement()` — keine Race Conditions mehr
- **BUG-003: Admin funktioniert auf leerer Datenbank**: `update()` durch `set({merge: true})` ersetzt in `boostLimit()` und `resetCounter()` — erstellt Dokument wenn noetig
- **BUG-004: Confidence 0 wird korrekt angezeigt**: `cat.confidence || 0.5` durch `typeof`-Check ersetzt — JavaScript-Falsy-0-Bug behoben

### Tests

- **24 neue Backend-Tests**: BUG-001 Counter-Validierung (6), SEC-001 Nonce-Flow (5), SEC-002 HMAC-Amount (2), Nonce-Auth (5), BUG-002 Read-only Stats (1), SEC-003 XML-Escaping (5)
- **1 neuer Frontend-Test**: BUG-004 Confidence-Zero
- **Testabdeckung**: 210 Backend + 126 Frontend = 336 Tests

## [1.2.1] — 2026-02-21

### Sicherheit

- **HMAC-basierte Admin-Tokens**: ntfy-Action-URLs enthalten keine Klartext-Secrets mehr — stattdessen kurzlebige HMAC-SHA256-signierte Tokens (30 Min gueltig, aktionsgebunden, timing-safe)
- **Admin CORS-Whitelist**: Admin-Endpunkte verwenden jetzt dieselbe Domain-Whitelist wie der Analyse-Endpunkt (statt `cors: true`)
- **Boost-Cap**: Maximaler Boost auf 500 begrenzt (statt 10.000)
- **HTML-Escaping**: Admin-Bestaetigungsseite escaped jetzt alle dynamischen Werte
- **ADMIN_SECRET rotiert**: Neues Zufalls-Secret gesetzt

### Bugfixes

- **Counter-Cleanup**: `getStats()` schreibt veraltete `recentAnalyses`-Eintraege zurueck nach Firestore (verhindert unbegrenztes Wachstum)
- **Demo-Daten Privacy**: GPS-Koordinaten und `dateTimeOriginal` aus Server-seitigen Demo-Exif-Daten entfernt — widerspricht sonst der Privacy-Architektur
- **stats.js i18n**: Alle hardcoded deutschen Strings durch `t()`-Aufrufe ersetzt, `Intl.NumberFormat` verwendet erkannte Sprache statt `"de"`

### Verbesserungen

- **i18n-Guardian erweitert**: Prueft jetzt automatisch alle HTML-Dateien auf fehlende Locale-Keys (nicht nur index.html)
- **stats.html i18n**: Alle statischen Texte mit `data-i18n`-Attributen versehen

### Tests

- **77 neue Tests**: HMAC-Auth (10), Admin-Endpunkte (14), Stats-Frontend (41), Demo-Privacy (1), Rate-Limit-Boundary (1), Notify HMAC (6), npm audit fix
- **Testabdeckung**: 186 Backend + 125 Frontend Tests

## [1.2.0] — 2026-02-21

### Features

- **Stundenlimit mit rollendem Fenster**: Echtes rollendes 60-Minuten-Fenster basierend auf einem `recentAnalyses`-Array in Firestore. Alte Eintraege fallen automatisch heraus — sobald genug Eintraege altern, ist das System sofort wieder frei (kein starrer Countdown). Konfigurierbares Limit (Standard: 500/Stunde, zentral in `config.js`). Fail-open bei Firestore-Fehlern.
- **Oeffentliche Stats-Seite**: Neue Seite unter `/stats` mit Live-Status, Gesamtzaehler, Zeitraum-Statistiken (Heute, Woche, Monat) mit Durchschnittswerten und Limit-Balken. Vollstaendig anonym — keine personenbezogenen Daten.
- **Limit-Banner auf Hauptseite**: Wenn das Stundenlimit erreicht ist, erscheint ein auffaelliger Banner mit Live-Countdown und Link zur Stats-Seite. Upload- und Demo-Bereich werden ausgegraut. Automatischer Reload nach Ablauf. Banner erscheint auch beim Neuladen der Seite (nicht erst nach Upload-Versuch).
- **Admin-Endpunkte**: `/api/admin/boost` (+100 Analysen) und `/api/admin/reset` (Zaehler zuruecksetzen) mit Token-Authentifizierung via ADMIN_SECRET (Bearer-Header oder Query-Parameter). Bestaetigungsseite im Dark-Theme mit Auto-Redirect zu Stats.
- **ntfy Push-Benachrichtigungen**: Automatischer Push auf self-hosted ntfy wenn das Limit erstmals erreicht wird. Action-Buttons in der Benachrichtigung fuer Boost, Reset und Stats — oeffnen jeweils eine Bestaetigungsseite im Browser.
- **Auto-Refresh bei Limit-Aufhebung**: Limit-Banner prueft alle 30 Sekunden ob das Limit per Boost oder Reset aufgehoben wurde und laedt die Seite automatisch neu.

### Datenschutz

- **Datenschutzseite ergaenzt**: Neuer Absatz zum Analyse-Zaehler (nur aggregierte Zahlen, keine Nutzer- oder Bilddaten) + Cloud Firestore in der Dienste-Tabelle
- **Counter speichert nur anonyme Timestamps**: Das rollende Fenster speichert Zeitpunkte der Analysen — kein Bezug zu einzelnen Nutzern, keine IP-Adressen, keine Bildinhalte

### Dokumentation

- **Stats-Link im Footer**: Alle Seiten (Hauptseite, Impressum, Datenschutz, Stats) haben jetzt einen Stats-Link und konsistente Startseite-Links im Footer
- **AGENTS.md, docs/SETUP.md, docs/SELF-HOSTING.md**: Neue Dateien und Endpunkte dokumentiert, Testanzahlen aktualisiert

## [1.1.1] — 2026-02-20

### Verbesserungen

- **Concurrency**: Cloud Function verarbeitet jetzt bis zu 20 gleichzeitige Anfragen pro Instanz (statt 1) — bessere Performance bei vielen Workshop-Teilnehmern
- **Quota-Fehlermeldung**: Wenn die Google-API ueberlastet ist, zeigt die App eine verstaendliche Meldung statt eines kryptischen Fehlers
- **Datenwert-Rechner**: Schluessel in der Gewichtungstabelle korrigiert — `politisch` wird jetzt korrekt mit 0.11 statt 0.06 gewichtet
- **Scan-Animation**: Fallback wenn i18n-Laden fehlschlaegt (zeigt Ellipsis statt leerem Text)
- **Deploy-Script**: Cache-Busting jetzt sekundengenau statt stuendlich — verhindert Cache-Probleme bei mehreren Deploys am selben Tag

### Dokumentation

- **docs/SETUP.md**: Testanzahl, RAM-Angabe und CI/CD-Abschnitt korrigiert
- **docs/SELF-HOSTING.md**: RAM-Angabe, CI/CD-Abschnitt und Nominatim-Dokumentation korrigiert
- **Datenschutzseite**: Logging-Beschreibung praezisiert (genutztes Modell, Antwortlaenge erwaehnt)

## [1.1.0] — 2026-02-19

### Features

- **Demo-Fotos fuer Workshops**: 3 anklickbare Stock-Fotos (Selfie Wien, Cafe Salzburg, Wanderung Hallstatt) mit eingebetteten Fake-EXIF-Daten (GPS, Kamera, Datum). Loesung fuer Workshops, in denen Teilnehmer kein eigenes Foto hochladen moechten. Bilder werden echt von der KI analysiert — kein vorgefertigtes Ergebnis.
- **i18n-System**: Alle UI-Texte, Gemini-Prompts und Tier-Profile in Locale-Dateien ausgelagert
  - Frontend: `public/locales/de.json` (alle UI-Strings via `data-i18n`-Attribute)
  - Backend: `functions/src/locales/de/prompts.js` (Gemini-Prompts) + `de/animals.js` (Tierprofile)
  - Sprachcode wird vom Client an den Server gesendet (`lang`-Parameter)
  - Spracherkennung: `?lang=`-URL-Parameter > Browser-Sprache > Default (de)
- **i18n-Guardian-Tests**: Automatische Pruefung dass keine hardcoded Strings in HTML, JS oder Backend stehen (Frontend + Backend)

### Barrierefreiheit

- **Safari Keyboard-Navigation**: Explizites `tabindex="0"` auf allen interaktiven Elementen (Buttons, Inputs, Links) — Safari ueberspringt ohne dieses Attribut standardmaessig alles ausser Text-Inputs
- **Subpages Safari-fix**: Datenschutz- und Impressum-Seite ebenfalls mit `tabindex="0"` auf allen Links
- **File-Input Overlay behoben**: `position: relative` auf `.file-drop` verhindert, dass der unsichtbare File-Input andere Buttons ueberlagert
- **A11y-Tests gegen echte HTML**: Tests lesen die echte `index.html` statt einer Kopie — kein Drift zwischen Test und Produktion moeglich
- **Farbkontrast verbessert**: Muted-Farbe von `#6b7280` auf `#9ca3af` angehoben — erfuellt jetzt WCAG AA (5.38:1 statt 3.84:1)
- **Skip-to-Content Link**: Unsichtbarer Link fuer Tastatur-Nutzer — erscheint beim ersten Tab-Druck, springt zum Hauptinhalt
- **Toggle-Switch per Tastatur**: Bias-Toggle ist jetzt per Tab erreichbar und mit Leertaste umschaltbar
- **Upload-Feld per Tastatur**: Datei-Upload ist per Tab erreichbar, Enter/Leertaste oeffnet den Datei-Dialog
- `aria-live="polite"` auf Status, Scan-Animation und Ergebnis-Bereich — Screenreader lesen Aenderungen vor
- **Disclaimer-Modal**: Focus-Trap, Escape zum Schliessen, Focus-Wiederherstellung, `role="dialog"` + `aria-modal`
- **Bias-Toggle**: `aria-label` fuer Screenreader
- **Info-Tooltips**: Per Tastatur (Tab + Enter/Space) erreichbar, `role="button"`
- **Dekorative SVGs**: Mit `aria-hidden="true"` vor Screenreadern versteckt
- **Reduzierte Bewegung**: `prefers-reduced-motion` deaktiviert alle Animationen fuer bewegungsempfindliche User

### Dokumentation

- **Screenshots**: Desktop- und Mobil-Screenshot in `docs/screenshots/` fuer README
- **README**: Screenshots, Lighthouse-/License-/Node.js-/Firebase-Badges, CI/CD-Abschnitt aktualisiert
- **Error-Alerting-Doku**: Anleitung fuer E-Mail-Benachrichtigungen bei Cloud-Function-Fehlern (`docs/ERROR-ALERTING.md`)
- **Good First Issues**: 2 Issues auf GitHub fuer externe Contributors (Tier-Easter-Eggs, English Translation)

### Sicherheit

- **CSP gehaertet**: `style-src 'unsafe-inline'` entfernt — alle Inline-Styles durch CSS-Klassen ersetzt
- **Dependabot**: Monatliche automatische Pruefung auf unsichere Dependencies (npm + GitHub Actions)
- **npm audit in CI**: Backend-Dependencies werden bei jedem Push auf bekannte Sicherheitsluecken geprueft
- **gitleaks in CI**: Automatischer Scan nach versehentlich committeten Secrets (API-Keys, Tokens) bei jedem Push
- **Lighthouse CI**: Automatischer Lighthouse-Audit bei jedem Push mit Budget-Pruefung (Performance >= 90, Rest = 100)

### Tooling

- **Deploy-Script**: `scripts/deploy.sh` — automatisches Cache-Busting (`?v=YYYYMMDDHH`) + Deploy in einem Schritt

### Bugfixes

- **Memory-Limit**: Cloud Function von 256 auf 512 MiB erhoeht — behebt Abstuerze bei groesseren Bildern

### Datenschutz

- **Datenschutzseite praezisiert**: Klarstellung dass anonymisierte Fehlerzusammenfassungen (ohne personenbezogene Daten) zur Fehlerbehebung bestehen bleiben

## [1.0.0] — 2026-02-16

Erster oeffentlicher Release.

### Features

- **KI-Analyse**: Foto hochladen, Gemini erstellt fiktives Persoenlichkeitsprofil
- **Zwei Modi**: Serioese Analyse (sachlich) und Beast Mode (uebertrieben-provokant)
- **Datenwert-Rechner**: Zeigt was ein Profil fuer Datenbroker wert ist
- **Privacy-Check**: Erkennt ungewollt preisgegebene Informationen (Telefonnummern, Adressen, Kennzeichen)
- **EXIF-Analyse**: Versteckte Kamera-Metadaten (client-seitig extrahiert, GPS verlässt nie den Browser)
- **GPS-Karte**: Aufnahmeort auf Leaflet-Karte (nur lokal im Browser)
- **Tier-Easter-Egg**: Tierfotos bekommen ein lustiges Spass-Profil
- **PDF-Export**: Ergebnisse als PDF speichern
- **Demo-Modus**: Vorbereitete Profile fuer Workshops ohne echte Fotos
- **Disclaimer-Modal**: Pflicht-Hinweis vor Ergebnisanzeige

### Sicherheit

- Magic-Byte-Validierung (JPEG, PNG, WebP, GIF)
- Content Security Policy mit strikter Whitelist
- HSTS mit Preload
- Rate Limiting (200/10min pro IP)
- Honeypot-Feld + Timing-Check
- Prompt-Injection-Schutz (XML-Tag-Isolation)

### Privacy

- Keine Speicherung von Bildern oder Profilen
- Keine externen Scripts (Fonts, Leaflet, exifr self-hosted)
- Kein Tracking, keine Cookies, keine Analytics
- GPS bleibt immer im Browser
