# Contributing — malziME

Danke fuer dein Interesse! malziME ist ein Open-Source-Lern-Tool und freut sich ueber Beitraege.

## Schnellstart

```bash
git clone https://github.com/malziland/malzime.git
cd malzime

# Backend-Dependencies
cd functions && npm install && cd ..

# Frontend-Tests + Linting (Vitest, ESLint, Prettier)
npm install

# Lokal starten
firebase emulators:start --only functions,hosting
```

Detaillierte Anleitung: [`docs/SETUP.md`](docs/SETUP.md)

## Pull Requests

1. Fork das Repo und erstelle einen Feature-Branch (`git checkout -b feature/mein-feature`)
2. Aenderungen machen
3. Tests laufen lassen:
   - Backend: `cd functions && npm test`
   - Frontend: `npm run test:frontend`
4. Lint + Format pruefen:
   - Backend: `cd functions && npm run lint && npm run format:check`
   - Frontend: `npm run lint:frontend && npm run format:frontend:check`
5. Cache-Buster in `index.html` hochzaehlen bei Frontend-Aenderungen
6. Pull Request erstellen

## Code-Stil

- JavaScript, 2 Spaces Einrueckung
- Frontend: Vanilla JS ES Modules, kein Framework, kein Build-Schritt
- Backend: CommonJS (`require`/`module.exports`)
- Dateinamen: `kebab-case.js`
- UI-Sprache: Deutsch (du-Form)
- Nie "kaukasisch" verwenden — stattdessen "europaeisch" oder "mitteleuropaeisch"

## Privacy-Regeln (WICHTIG)

Diese Regeln sind nicht verhandelbar:

- **GPS verlässt nie den Browser.** Keine Ausnahmen.
- **Keine externen Scripts.** Alles muss self-hosted sein.
- **Keine Tracking-Cookies, Analytics oder Werbung.**
- **Keine dauerhafte Speicherung von Bildern oder Profilen.** (Im Queue-Betrieb liegt das Bild kurz im Storage — es muss unmittelbar nach der Verarbeitung gelöscht werden.)
- **Kein Firebase SDK im Frontend.**
- **dateTimeOriginal wird nicht an die KI gesendet.** (Verleitet zu falschen Altersschaetzungen.)
- **API-Keys und Secrets niemals committen.** `gitleaks` laeuft in CI als Backstop.

## KI-Provider und Architektur

Seit v1.6.0 nutzt malziME ausschliesslich Mistral AI (Paris, EU) als KI-Anbieter — keine weiteren Provider, kein Fallback. Seit v2.0 läuft die Analyse über eine Cloud-Tasks-Warteschlange (umschaltbar per Feature-Flag `useQueue`). Details:
- Code-Aufbau: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Setup mit Mistral-API-Key: [`docs/SETUP.md`](docs/SETUP.md#firebase-secrets)
- Tests laufen mit Mocked-Fetch — kein echter Key fuer `npm test` noetig.

## Uebersetzungen

malziME hat ein vollstaendiges i18n-System — aktuell ist nur Deutsch verfuegbar. So fuegst du eine neue Sprache hinzu:

### Frontend (UI-Strings)

1. Kopiere `public/locales/de.json` nach `public/locales/XX.json` (z.B. `en.json`)
2. Uebersetze alle Werte (Keys nicht aendern!)
3. Fuege den Sprachcode in `public/locales/manifest.json` hinzu: `"languages": ["de", "XX"]`

### Backend (Prompts + Tierprofile)

1. Erstelle `functions/src/locales/XX/prompts.js` — kopiere `de/prompts.js` als Vorlage
2. Erstelle `functions/src/locales/XX/animals.js` — kopiere `de/animals.js` als Vorlage
3. Fuege den Sprachcode in `functions/src/locales/manifest.json` hinzu

### Testen

- `?lang=XX` an die URL anhaengen um die Sprache zu testen
- Frontend-Tests: `npm run test:frontend`
- Backend-Tests: `cd functions && npm test`
- Die i18n-Guardian-Tests pruefen automatisch, dass keine Strings fehlen

### Wichtig bei Uebersetzungen

- Alle `{{placeholder}}`-Variablen muessen erhalten bleiben
- Profil-Sprache: Du-Form, kein Passiv (auch in anderen Sprachen eine persoenliche Anrede waehlen)
- Nie "kaukasisch" verwenden — "europaeisch" oder "mitteleuropaeisch"
- Bei neuen Sprachen: HTML-Attribut `data-i18n` verwendet die gleichen Keys wie in `de.json`

## Was wir suchen

- Bessere Prompt-Qualitaet (realistischere/lehrreichere Profile)
- Neue Demo-Datensaetze fuer Workshops
- Barrierefreiheit (a11y) Verbesserungen
- Uebersetzungen in weitere Sprachen (siehe oben)
- Bug-Reports und Edge-Cases
- Performance-Optimierungen

## Was wir NICHT wollen

- Tracking oder Analytics jeder Art
- Externe CDN-Abhaengigkeiten
- Build-Schritte oder Bundler fuer das Frontend
- Features die die Privacy-Architektur aufweichen

## Bug Reports

Bitte mit:
- Beschreibung des Problems
- Welches Bild (Typ: Selfie, Landschaft, Meme, etc.) — kein echtes Foto noetig
- Browser und Geraet
- Console-Errors (falls vorhanden)

## Lizenz

Beitraege werden unter der [MIT-Lizenz](LICENSE) veroeffentlicht.
