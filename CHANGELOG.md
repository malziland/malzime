# Changelog

Alle relevanten Aenderungen an malziME werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

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
