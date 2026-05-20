# Changelog

Alle relevanten Aenderungen an malziME werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [2.0.0-rc5] — 2026-05-20

### Queue-Architektur — Phase 5: Go-Live

Fünfter Schritt: Die Warteschlange geht für echte Nutzer scharf. Das Frontend mit dem Queue-Code wird ausgeliefert, das Feature-Flag `useQueue` wird auf AN gestellt — ab jetzt läuft jeder Upload über die Warteschlange. Der synchrone `/analyze`-Pfad bleibt unangetastet als sofortiger Rückfall: Flag zurück auf AUS genügt.

#### Datensparsamkeit — Aufräumung der Job-Dokumente

- Der Reaper (`reapJobs`, Minutentakt) löscht zusätzlich jedes Job-Dokument, das älter als 24 Stunden ist. Ein Job-Dokument enthält bis zum Abschluss das fertige Profil; danach wird es nicht mehr gebraucht — so bleibt nichts unbegrenzt liegen.
- `JOB_RETENTION_MS` (24 h) ist großzügig über jedem realistischen Abhol-Fenster gewählt; der Client holt das Ergebnis binnen Minuten ab.

#### Datenschutzerklärung

Die Datenschutzerklärung benennt jetzt die kurze Bild-Zwischenspeicherung in der Warteschlange ehrlich:

- Das komprimierte Bild liegt für die kurze Wartezeit auf einem EU-Server — unangetastet, bis es an der Reihe ist — und wird unmittelbar nach der Analyse automatisch gelöscht.
- Das fertige Profil liegt bis zum Abruf durch den Browser kurz auf dem Server (ohne Personenbezug) und wird spätestens nach 24 Stunden gelöscht.
- Mitgezogen: Nutzungsbedingungen, Impressum, Startseite und Meta-Beschreibungen — überall heißt es jetzt korrekt „keine dauerhafte Speicherung".

## [2.0.0-rc4] — 2026-05-20

### Queue-Architektur — Phase 4: Production-Deploy (dormant) + Echt-Test

Vierter Schritt: Die Queue geht in Produktion — aber dormant. Es wurde kein App-Code geändert; deployt wurde der bereits committete Stand (rc3 inkl. Audit-Fixes).

**Für echte Nutzer ändert sich nichts:** Das Feature-Flag `useQueue` bleibt AUS, jeder Upload läuft weiter über den synchronen `/analyze`-Pfad.

#### Infrastruktur

- Alle Functions deployt — neu live: `enqueue`, `processJob`, `jobStatus`, `reapJobs`. Sie liegen dormant, bis das Flag in Phase 5 umgelegt wird.
- Cloud-Tasks-Queue `analyze-queue` angelegt (`europe-west1`, `maxConcurrentDispatches` 3).
- IAM: Der Invoker-Service-Account darf `processJob` per OIDC aufrufen; `processJob` selbst ist nicht öffentlich erreichbar.
- Firestore-Indizes deployt.

#### Echter End-to-End-Test

Ein einmaliger Lauf mit 20 echten Analysen über die deployte Queue (echtes Mistral):

- **20/20 erfolgreich**, kein verlorener Job, kein harter Fehler.
- **Null 429er** — die Cloud-Tasks-Drosselung verhindert die Mistral-Überlast strukturell, wie vorgesehen. Der Kernzweck der Queue ist damit am echten System bewiesen.
- Gemessene Bearbeitungszeit ~95–100 s/Job; die ETA-Schätzkonstante (120 s) liegt bewusst darüber — bestätigt, keine Änderung nötig.

Das Test-Werkzeug bleibt als Betreiber-Skript außerhalb des öffentlichen Repos.

## [2.0.0-rc3] — 2026-05-20

### Queue-Architektur — Phase 3: Lokale Testumgebung (Emulator)

Dritter Schritt: das komplette System lokal lauffähig machen — für den Durchklick der Warteschlangen-UX und kostenlose Mock-Lasttests. Reine Test- und Entwicklungs-Infrastruktur, keine Produktions-Auswirkung.

**Google Cloud Tasks hat keinen Emulator.** Daher zwei sauber per Umgebungsschalter (`QUEUE_LOCAL=1`) getrennte lokale Ersatz-Implementierungen — in Produktion ist `QUEUE_LOCAL` nie gesetzt, dort bleibt es bei Cloud Tasks und dem GCS-Bucket:

- `cloud-tasks.js`: Im Lokal-Modus stößt `enqueue` die `processJob`-Function direkt per HTTP an, statt einen Cloud-Task zu erzeugen.
- `queue-storage.js`: Im Lokal-Modus liegen die Bilder in einem Temp-Verzeichnis statt im GCS-Bucket.
- `feature-flags.js`: Im Lokal-Modus gilt die Queue als aktiv — der Emulator-Lauf dient ja gerade ihrem Test.

- `firebase.json`: Emulator-Konfiguration (functions / firestore / hosting / pubsub). `functions/.env.local` aktiviert die Lokal-Schalter und wird von `firebase deploy` ignoriert.
- npm-Skript `emulator` startet das System lokal; `docs/QUEUE-EMULATOR.md` beschreibt den Durchklick.
- `functions/scripts/queue-emulator-loadtest.js`: feuert N Mock-Jobs gegen die lokale Queue und verifiziert, dass keiner verloren geht.

### Korrekturen aus dem Durchklick

Der Durchklick im Emulator hat drei Lücken aufgedeckt, die im selben Zug behoben wurden:

- **Routing-Race:** Ein sehr schneller Upload entschied sich fälschlich für den synchronen Pfad, bevor das `useQueue`-Flag von `/api/stats` geladen war. `analyzeImage` wartet jetzt auf `state.statsReady` (mit hartem Timeout), bevor es Sync vs. Queue wählt.
- **Warte-Bildschirm vereinfacht:** Das zusätzliche `#queueStatus`-Element samt Sonder-CSS wurde wieder entfernt; der Warte-Bildschirm nutzt den bestehenden Scan-Text — in der Warteschlange die Position, bei der Verarbeitung die gewohnten Meldungen. Keine doppelten Texte.
- **Lokale Drosselung:** Der Emulator fährt mehrere Worker-Prozesse, daher kann der lokale Cloud-Tasks-Ersatz nicht über Modul-Variablen drosseln. `processJob` zählt jetzt im Lokal-Modus die laufenden Jobs in Firestore (prozess-übergreifend) und vertagt sich bei voller Drossel — so staut sich im Emulator eine echte Warteschlange mit sichtbaren Positionen, wie unter echtem Cloud Tasks.
- ETA-Schätzung (`QUEUE_AVG_JOB_SECONDS`) bewusst großzügig auf 120 s gesetzt — die Wartezeit-Anzeige soll lieber über- als unterschätzen.

### Audit-Nachbesserungen

Ein kritischer Durchgang durch den gesamten Queue-Code (vor Phase 4) brachte fünf Befunde — alle behoben:

- **B1:** `pollJob` brach nicht ab, falls ein Job dauerhaft hängt (Cloud-Tasks-Ausfall) — jetzt Gesamt-Obergrenze von 30 Min, danach sauberer Abbruch.
- **B2:** In `processing` hängende Jobs ohne pollenden Client wurden nie aufgeräumt — der Reaper setzt jetzt auch sie auf `failed` (nicht nur verlassene `queued`-Jobs). Neuer Index (`status`, `startedAt`).
- **B3:** `getQueuePosition` las den Job doppelt — nimmt jetzt das bereits geladene Job-Objekt entgegen (ein Firestore-Read pro Poll gespart).
- **B4:** Klarstellung im Code: `QUEUE_DISPATCH_CONCURRENCY` muss in Phase 4 zum echten Cloud-Tasks-`maxConcurrentDispatches` passen.
- **B5** (vorbestehend, nicht Queue): Die Balken im Ergebnis (`render.js`) setzten ihre Breite per inline `style="…"` — von der strikten CSP blockiert. Jetzt per CSSOM (`element.style.width`) gesetzt, CSP-konform. Betrifft auch die Live-Seite.

### Tests

- Backend 407/407, Frontend 152/152 grün. Lint + Format sauber.

## [2.0.0-rc2] — 2026-05-20

### Queue-Architektur — Phase 2: Frontend (Warteschlangen-UI)

Zweiter Entwicklungsschritt: das Frontend zur Queue-Architektur. Der Browser reicht das Bild bei `/api/enqueue` ein, erhält sofort eine `jobId` und pollt `/api/job-status` im 2-Sekunden-Takt bis zum Ergebnis. Jeder Poll ist zugleich der Liveness-Herzschlag.

**Weiterhin ohne Auswirkung auf echte Nutzer:** Solange das Feature-Flag `useQueue` AUS ist, läuft jeder Upload über den unveränderten synchronen Pfad. Der Queue-Pfad ist rein additiv — `analyzeImage()` verzweigt nur, wenn das Flag an ist.

- **Feature-Flag-Auslieferung:** `/api/stats` liefert jetzt zusätzlich `useQueue` (das Frontend holt die Stats ohnehin beim Seitenstart). `state.useQueue` steuert die Pfad-Wahl; Default false → fail-safe der bewährte synchrone Pfad.
- **`api.js` Queue-Modus:** `analyzeImageQueued()` — Einreihen, Polling, Zustandsbehandlung (`queued`/`processing`/`done`/`failed`/`abandoned`). Der synchrone `analyzeImage`-Pfad bleibt unangetastet.
- **Warteschlangen-UI:** Während der Wartezeit zeigt die Oberfläche Position und geschätzte Restzeit. Die rotierenden Analyse-Meldungen entfallen im Wartezustand — sie wären irreführend, solange der Job nur wartet.
- **Ergebnis-Abholung nach Reload:** Die `jobId` liegt in `sessionStorage`. Lädt der Nutzer die Seite neu, holt `resumeQueueJob()` das laufende oder fertige Ergebnis ab — kein „Geister-Durchlauf" mehr.
- Hosting-Rewrites `/api/enqueue` und `/api/job-status`; neue Locale-Keys (de + en) für die Warteschlangen-Anzeige.

### Tests

- Backend 395/395, Frontend 152/152 grün (+9 Queue-Frontend-Tests mit gemocktem Fetch/Polling). Lint sauber.

## [2.0.0-rc1] — 2026-05-20

### Queue-Architektur — Phase 1: Backend-Infrastruktur (dormant)

Erster Entwicklungsschritt der Queue-Architektur (siehe `memory/queue-plan.md`). Statt die Analyse synchron in einer 60–180 s offenen Verbindung abzuwickeln, werden Anfragen künftig in eine Cloud-Tasks-Queue gelegt, dosiert abgearbeitet und das Ergebnis serverseitig gespeichert. Das löst die 429er bei Burst-Last strukturell und macht Ergebnisse gegen Verbindungsabbrüche robust.

**Diese rc1 enthält ausschließlich Backend-Infrastruktur. Sie verändert das Live-Verhalten NICHT:** Solange das Feature-Flag `useQueue` (Firestore `featureFlags/current`) AUS ist, läuft jeder echte Nutzer unverändert über den synchronen `/analyze`-Pfad. Der alte Pfad wurde nicht angefasst.

#### Neue Module (`functions/src/`)

- **`jobs.js`** — Job-Lebenszyklus in der Firestore-Collection `jobs`: `createJob`, `claimJob` (idempotenter Übergang `queued → processing` per Transaction), `completeJob`, `failJob`, `getQueuePosition` (Firestore-`count()`-Aggregation), `markFailedIfStale` (Timeout-Sicherung gegen hängende Jobs).
- **`cloud-tasks.js`** — Wrapper um Google Cloud Tasks (`enqueueJob`). Neue Abhängigkeit `@google-cloud/tasks`.
- **`queue-storage.js`** — temporäre Bild-Ablage in Firebase Storage (`queue-uploads/`), wird nach der Verarbeitung sofort gelöscht.
- **`feature-flags.js`** — Laufzeit-Feature-Flags aus Firestore, 30 s Cache, fail-safe auf `false`.
- **`mistral-mock.js`** — Mistral-Attrappe für kostenlose Tests (Unit-Tests, Emulator-Durchklick, Mock-Lasttests), umschaltbar per `MISTRAL_MOCK=1`.
- **`handle-enqueue.js`** — Function `enqueue` (public): validiert die Anfrage (identisch zum `/analyze`-Pfad), legt das Bild ab, erzeugt den Job, reiht ihn ein, antwortet sofort mit der `jobId`.
- **`handle-process-job.js`** — Function `processJob` (NICHT public, nur via Cloud Tasks): führt die bestehende Mistral-Pipeline aus und schreibt das Ergebnis ins Job-Dokument.
- **`handle-job-status.js`** — Function `jobStatus` (public, leichtgewichtig): liefert dem pollenden Client Status, Warteschlangen-Position, ETA und Ergebnis.
- **`handle-reap.js`** — geplante Function `reapJobs` (Minutentakt): räumt verlassene Jobs ab (siehe Client-Liveness).

#### Konfiguration & Infrastruktur

- `firestore.indexes.json` neu: zwei zusammengesetzte Indizes auf `jobs` — `status`+`createdAt` (Warteschlangen-Position) und `status`+`lastSeenAt` (Reaper); in `firebase.json` verdrahtet.
- Dedizierter Cloud-Storage-Bucket `gs://malzime-queue-uploads` angelegt (`europe-west1`, nicht öffentlich, Public-Access dauerhaft gesperrt, Uniform Bucket-Level Access). Kein Firebase-Storage-Default-Bucket — auf den Bucket greift nur der Server via Admin-SDK zu. Dem Function-Runtime-Service-Account wurde Objekt-Zugriff erteilt.
- `storage-lifecycle.json` neu + auf den Bucket angewendet: GCS-Lifecycle-Regel löscht `queue-uploads/`-Objekte als Sicherheitsnetz nach 1 Tag (GCS-Minimum). Die aktive Löschung in `processJob` greift unmittelbar nach der Verarbeitung — der Lifecycle fängt nur den seltenen Crash-Fall ab.

#### Client-Liveness (Keep-Alive) — von Anfang an Kernmechanismus

Damit die Queue keine Mistral-Calls für Anfragen verbraucht, deren Nutzer die Seite längst verlassen haben:

- Jeder `job-status`-Poll des Clients ist zugleich ein Herzschlag (`lastSeenAt` im Job-Dokument).
- Pollt der Browser eines wartenden Jobs länger als das Karenz-Fenster (`LIVENESS_GRACE_MS`, 3 min) nicht mehr, gilt der Client als weg.
- Die geplante Function `reapJobs` setzt solche Jobs im Minutentakt auf `abandoned` und löscht ihr Bild — kein Mistral-Call, und der Warteschlangen-Platz wird frei, sodass Wartende nachrücken. `processJob` prüft die Liveness zusätzlich selbst, bevor es Mistral aufruft.
- Das Karenz-Fenster ist bewusst großzügig, weil iOS Tabs beim App-Wechsel/Display-Sperren einfriert (das Pollen pausiert, ohne dass der Nutzer wirklich weg ist).

Der Job-Lebenszyklus hat damit einen fünften Zustand: `abandoned`. Die Client-Hälfte (das eigentliche Pollen) baut Phase 2 — das Backend ist von Anfang an darauf ausgelegt.

#### Offene Setup-Schritte vor Go-Live (NICHT Teil dieser rc)

- Cloud-Tasks-Queue `analyze-queue` (`europe-west1`) anlegen, Dispatch-Rate setzen.
- IAM: Cloud-Tasks-Service-Account die Invoker-Rolle auf `processJob` geben.
- `firestore.indexes.json` deployen.

### Tests

- Backend 394/394 grün (+96 neue Tests für die Queue-Module inkl. Client-Liveness). Frontend unverändert 143/143.

## [1.10.9] — 2026-05-20

### Behoben — Wake-Lock wird wieder im User-Gesture-Kontext angefordert

Die v1.10.8-Wake-Lock-Telemetrie lieferte sofort ein klares Ergebnis: Auf einem iPhone (voller Akku, KEIN Stromsparmodus) kam `wakeLock: "denied:NotAllowedError"`, auf einem Mac `"acquired"`.

Ursache: `navigator.wakeLock.request("screen")` wurde tief in der asynchronen `analyzeImage`-Pipeline aufgerufen — nach mehreren `await`-Punkten (u.a. der `MIN_INTERACTION_MS`-Wartepause). iOS Safari erlaubt die Wake-Lock-Anfrage aber nur, solange noch **transiente User-Aktivierung** besteht — also unmittelbar nach dem Tippen, vor jedem `await`. Desktop-Safari ist hier lax (→ „acquired"), iOS streng (→ `NotAllowedError`). Es war also kein Geräte-Problem, sondern ein Reihenfolge-Bug bei uns.

**Fix:**

- **`public/app.js`**: `handleNewFile()` ruft `acquireWakeLock()` jetzt synchron als ALLERERSTES auf — direkt im `change`/`drop`-Event-Handler, bevor irgendein `await` läuft. Damit ist die User-Aktivierung noch „live", wenn die Wake-Lock-Anfrage rausgeht.
- **`public/js/api.js`**: `acquireWakeLock` exportiert + Guard `wakeLockRequested` ergänzt — ein zweiter (post-`await`) Aufruf aus `analyzeImage` würde sonst auf iOS scheitern und den bereits gewonnenen Status überschreiben. `releaseWakeLock` setzt den Guard zurück. Der `analyzeImage`-Aufruf bleibt als Fallback für Pfade ohne `handleNewFile` (Demo-Bilder). Der nicht mehr funktionsfähige `visibilitychange`-Re-Acquire-Listener wurde entfernt (durch den Guard ohnehin wirkungslos, und Re-Acquire ohne Gesture scheitert auf iOS sowieso).

Erwartung: Auf iPhones sollte aus `denied:NotAllowedError` künftig `acquired` werden — verifizierbar in den Telemetrie-Logs ab dem nächsten Workshop. Wichtig bleibt die Einordnung aus v1.10.8: Ein funktionierender Wake-Lock behebt nur die Bildschirm-Auto-Sperre, nicht das Tab-Einfrieren oder App-Wechsel.

### Tests

- Frontend 143/143 grün. Backend unverändert (298/298).

### Sonstiges

- Cache-Buster auf `?v=2026052002`.

## [1.10.8] — 2026-05-20

### Behoben — modell-bewusster Token-Bucket + Wake-Lock-Diagnose

Nach Auswertung des Workshop-Vormittags (2026-05-20): Der Server lief stabil (keine 429er, keine Mistral-Hänger), aber einzelne Schüler warteten bis ~110 s, und manche mussten mehrfach hochladen. Drei Ursachen-Maßnahmen:

- **`functions/src/throttle.js` — modell-bewusster Token-Bucket.** Bisher drosselte EIN gemeinsamer Token-Bucket alle Mistral-Calls auf 1,6 RPS — orientiert am langsamsten Modell (`mistral-small-2603`, 1,67 RPS). Damit wurden auch die `describe`-Calls über `mistral-large-2512` (Limit 6 RPS) unnötig auf 1,6 RPS gebremst. Jetzt zwei getrennte Buckets: Large 800 ms/Instanz (= ~5 RPS gesamt bei 4 Instanzen, unter 6-RPS-Limit), Small 2500 ms/Instanz (= ~1,6 RPS, unter 1,67-Limit). Die Bildbeschreibung läuft damit ~3× schneller → kürzerer Wartezeit-Tail unter Workshop-Last. `withMistralSlot` bekommt einen `modelClass`-Parameter; `mistral.js` leitet `large`/`small` aus dem Modellnamen ab.
- **`public/js/api.js` — Wake-Lock-Telemetrie.** Das `acquireWakeLock()`-`catch` verschluckte bisher jeden Fehler stumm — wir hatten null Daten, warum der Bildschirm-Wachhalter auf keinem Gerät zu greifen scheint. Jetzt wird der Status erfasst (`not-attempted` / `unsupported` / `acquired` / `denied:<FehlerName>`) und in Success-Telemetrie (`meta.wakeLock`) sowie Client-Error-Logs (`wakeLock`) mitgeschickt. Ab dem nächsten Workshop liefern die Logs echte Daten.
- **`public/locales/de.json` + `en.json` — `error.suspended` neutral formuliert.** Die alte Meldung behauptete fälschlich „Gerät ging in Ruhezustand". Das stützte sich auf `document.hidden`, das aber aus vielen Gründen `true` wird (App-Wechsel, Benachrichtigungs-Leiste, Browser-Energiesparmodus — speziell Samsung Internet friert Tabs bei eingeschaltetem Bildschirm ein). Neue Meldung: „Die Analyse wurde unterbrochen. Bitte versuch es nochmal und lass die Seite dabei geöffnet im Vordergrund." — keine falsche Ursachen-Behauptung mehr.

### Begleitende Whitelist-Erweiterungen

- `functions/src/handle-telemetry.js`: `wakeLock` (max 40 Zeichen) in `META_STRING_KEYS`.
- `functions/src/handle-errors.js`: `wakeLock` (max 40 Zeichen) in `STRING_FIELDS`.
- `public/js/error-logger.js`: reicht `context.wakeLock` in den Error-Payload durch.

### Tests

- Backend 298/298 grün (3 neue Tests für die modell-bewussten Token-Buckets).
- Frontend 143/143 grün.

### Sonstiges

- Cache-Buster auf `?v=2026052001`.

## [1.10.7] — 2026-05-19 (Abend)

### Behoben — Modell-Limits korrekt erfasst, Token-Bucket entsprechend kalibriert

Spaeter Abend nach v1.10.6-Deploy zeigten sich anhaltende Mistral-429er-Probleme und 3-Minuten-Hänger. Diagnose ueber das Mistral-Account-Dashboard offenbarte den eigentlichen Fehler: Unsere `throttle.js`-Annahme „Mistral-Scale-Tier hat 6 RPS" stammte aus einem alten Audit und war fuer das aktuelle Modell falsch.

**Tatsaechliche Account-Limits (Dashboard 2026-05-19):**

- `mistral-small-2603` (unser Profile-Modell): **100K TPM, 1.67 RPS**
- `mistral-small-2506` (deprecated, aelter): 5M TPM, 20.83 RPS
- `mistral-large-2512` (Describe + Fallback): 2M TPM, 6 RPS
- `mistral-large-2411` (aelter): 600K TPM, 1.67 RPS

Mistral hat fuer die neueste Small-Variante (-2603) auffaellig restriktive Limits gesetzt — vermutlich gestaffelte Freischaltung neuer Modelle. Mit unseren v1.10.6-Werten (`maxInstances=4 × 1500ms-Token-Bucket = 2.67 RPS`) lagen wir strukturell ueber dem Small-Limit.

**Aenderungen:**

- **`functions/src/throttle.js`**: `TOKEN_INTERVAL_MS: 1500 → 2500` ms. Damit ergibt sich `4 × 0.4 = 1.6 RPS` gesamt, sicher unter dem 1.67-RPS-Limit von -2603. Kostet ~1 s extra Queue-Wartezeit pro Mistral-Call unter Last, eliminiert aber die strukturelle 429-Quelle.
- **`functions/src/config.js`**: Large-Modelle fest gepinnt — `MISTRAL_DESCRIBE_MODEL` und `MISTRAL_FALLBACK_MODEL` von `mistral-large-latest` auf `mistral-large-2512` (verifizierte gute Limits: 2M TPM, 6 RPS). Verhindert dass Mistral uns ueber den `-latest`-Alias auf ein moeglicherweise restriktiv limitiertes Nachfolge-Modell umschiebt.
- **`functions/src/config.js`**: Erweiterte Kommentar-Doku mit den verifizierten Limits zu jedem Modell, damit Folge-Audits nicht wieder auf falschen Annahmen aufbauen.

### Nicht uebernommen — Modell-Wechsel auf Small 3.2

Zwischenzeitlich testweise ausprobiert: `MISTRAL_PROFILE_MODEL` auf `mistral-small-2506` umgestellt. Limits 50× besser, aber **Live-Test zeigte 30-80 % Qualitaetsregression beim `ad_targeting`** (kaum noch echte Markennamen, generische Targeting-Begriffe). Didaktischer Wert des Tools haengt aber an konkreten Marken — daher sofortiger Revert zurueck auf `mistral-small-2603`.

Lesson learned: Versions-Sprung Small 3.2 → Small 4 ist bei spezifischen Fähigkeiten (Brand-Knowledge) substanziell, nicht nur „3-8 % Benchmark-Verbesserung" wie meine Schätzung vorher.

### Folge-Lessons aus dem Abend

- **Vor Architektur-Entscheidungen immer das Account-Dashboard pruefen**, nicht den Code-Kommentar oder die generische Doku.
- **Modell-spezifische Limits sind nicht uniform** — neueste Versionen koennen drastisch restriktiver sein als deprecated Vorgaenger.
- **-latest-Aliase fuer Modelle vermeiden** — Versions-Pinning gibt uns Kontrolle.

### Tests

- Backend 295/295 gruen (Test-Konstanten an neue Modell-IDs angepasst).
- Frontend 143/143 gruen (unveraendert).

## [1.10.6] — 2026-05-19

### Behoben — Workshop-Tauglichkeit fuer 25-50 gleichzeitige Teilnehmer

Heutiger 13:00-15:00-Workshop hat die Pipeline gerissen: ab ~15 Geraeten gleichzeitig kamen reihenweise "Server-Fehler" und Abbrueche. Logs zeigten Throttle-Queue-Timeouts, Mistral-429-Kaskaden und Analysen, die statt 60-90 s plötzlich 250-328 s dauerten.

**Wurzelursache** war nicht Mistral selbst, sondern eine Kette von Config-Schwaechen, die sich gegenseitig verstaerkt haben:

1. Cloud-Run-`concurrency: 20` packte alle eingehenden Requests auf eine einzelne Instanz, statt horizontal zu skalieren.
2. Die Per-Instance-Drossel (`throttle.js`, 6 Slots) staute sich dadurch sofort.
3. Auf 429-Antworten von Mistral versuchte der Code 2× Retry mit kurzem Backoff — drei Wellen Anfragen gegen ein bereits ueberlastetes Rate-Limit verstaerkten den Stau exponentiell.
4. Der Throttle-Queue-Timeout (90 s) feuerte unter Last reihenweise → Anfragen schlugen fehl, ohne dass Mistral je wirklich angesprochen wurde.
5. Frontend hatte keine Auto-Retry-Logik fuer transienten Server-Druck → User sah einen einzigen generischen Fehler nach 60-180 s.

**Fixes** (zusammen wirksam):

- **`functions/src/index.js`**: `concurrency: 20 → 8`, `maxInstances: 10 → 4`, `timeoutSeconds: 180 → 540` (Cloud-Run-Maximum). Mit `concurrency=8` zwingt Cloud Run das Hochfahren neuer Instanzen, statt eine zu fluten. `maxInstances=4` × 6 Throttle-Slots ergibt einen echten globalen Cap von 24 parallelen Mistral-Calls (~2,7 RPS sustained mit Token-Bucket), weit unter Mistrals 6-RPS-Limit.
- **`functions/src/throttle.js`**: `DEFAULT_QUEUE_TIMEOUT_MS: 90 000 → 360 000` (6 Minuten). Mistral braucht 60-90 s pro Call, ein Slot wird also nur alle ~15 s frei. Mit kurzem Timeout lief eine Anfrage in Queue-Position 3+ schon mitten im Anstehen ins Out. 6 Minuten Warte-Spielraum + 540 s Function-Timeout = praktisch kein Throttle-Failure mehr im Normalbetrieb.
- **`functions/src/mistral.js`**: 429-Retry-Backoffs `[1000, 3000] → [2000]` (1 statt 2 Retries). `isRateLimitError` erkennt jetzt auch `throttle_timeout` als Ueberlast-Signal. `runProfile`/`tryProfileCall` schlucken Rate-Limit-Fehler nicht mehr, sondern propagieren sie sauber zu `handle-analyze.js` (→ `blocked.overloaded` im Response-Body → Frontend retried). Per-Call-Timeout via `Math.min(timeoutMs || MISTRAL_TIMEOUT_MS, MISTRAL_TIMEOUT_MS)` gecappt — verhindert, dass das gestiegene `REQUEST_BUDGET_MS` einen einzelnen Mistral-Call ueber 90 s laufen laesst (Outer-Budget gilt fuer die Pipeline, nicht fuer Einzelaufrufe).
- **`functions/src/throttle.js`**: **Token-Bucket-Rate-Limiter + Initial-Jitter.** Die bisherige Semaphore limitierte nur PARALLELITAET (max 6 in-flight) — nicht die RATE. Lasttests mit 20 parallelen Anfragen haben das aufgedeckt: Slots wurden gleichzeitig frei, neue Calls bursteten in derselben Millisekunde gegen Mistral, × N Cloud-Run-Instanzen = bis zu 36 RPS Instant-Burst (Limit: 6 RPS). Resultat: 40 % HTTP 429. Token-Bucket erlaubt jetzt max 1 Mistral-Call alle 1500 ms pro Instanz (= 0,67 RPS); bei `maxInstances=4` ergibt das ~2,7 RPS gesamt, sicher unter Mistrals 6-RPS-Limit. **Initial-Jitter 0-2000 ms** beim allerersten Token-Acquire pro Instanz verhindert, dass mehrere frisch geboorene Cold-Start-Instanzen ihren ersten Call in derselben Millisekunde feuern.
- **`functions/src/counter.js`**: Eigene 2-Retry-Schleife auf `runTransaction` bei Firestore-ABORTED-Kontention. Das SDK retried intern 5×, das reichte unter Workshop-Burst nicht — die `counter-fail-open`-Alarme bei meinen Lasttests waren genau diese Kontention, kein echter DB-Ausfall. Jetzt 2 Retries mit 80–240 ms Backoff+Jitter VOR dem ERROR-Pfad; nur wenn auch die noch versagen, wird der Alarm ausgeloest. Routinemaessige Workshop-Last triggert keinen Alarm mehr; echte Firestore-Ausfaelle alarmieren weiter sauber.
- **`functions/src/config.js`**: `HOURLY_LIMIT: 500 → 1500` (Puffer fuer mehrere Workshops kurz hintereinander + Auto-Retry-Volumen), `REQUEST_BUDGET_MS: 120 000 → 480 000` (matched neues Function-Timeout, gibt Mistral auch nach langer Queue-Wartezeit volle 90 s), `RATE_LIMIT: 200 → 500` pro 10 Minuten (Schul-WLAN teilt sich eine IP — bei 25 Geraeten mit Auto-Retries war 200 zu knapp).
- **`public/js/api.js`**: Auto-Retry-Loop um den Fetch-Block. Max 3 Retries (4 Versuche total), 8 s Basis-Wartezeit mit ±2 s Jitter, retried bei HTTP 429/503 ohne `blocked:"limit"`/`maintenance`-Body und bei `blockedReason: "blocked.overloaded"` im 200er-Body (Heartbeat-Pfad). `FETCH_TIMEOUT_MS: 180 000 → 540 000` matched das neue Backend-Timeout. Jitter zwischen Retries verhindert synchrone Retry-Wellen aller Workshop-Geraete.
- **`public/locales/de.json` + `en.json`**: Neue Keys `error.serverBusy` ("System gerade stark belastet, bitte ein bis zwei Minuten warten") und `status.serverBusyRetrying` ("Sehr viele Anfragen gerade — versuche es automatisch nochmal …") fuer die Auto-Retry-UX.

### Erwartete Kapazitaet nach diesen Aenderungen

| Workshop-Groesse | Verhalten                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| 15-25            | Sauber, alle in 1-2 Minuten fertig, kein User-sichtbarer Fehler                                    |
| 25-50            | Sauber, alle in 2-4 Minuten, vereinzelt Auto-Retry mit „versuche es automatisch nochmal …"-Meldung |
| 50-100           | Mit Auto-Retry meistens sauber; einzelne sehen evtl. die Server-Busy-Meldung                       |
| 100+             | Knapp bis enger Engpass — fuer 200 braucht es die echte Queue-Architektur (separater Plan)         |

### Was bewusst NICHT angefasst wurde

- **`MISTRAL_PROFILE_MAX_TOKENS` bleibt 8000.** Erste Idee war 4500, aber Live-Beobachtung im Workshop zeigte abgeschnittene Profile — die kamen von Timeout-Truncation, nicht vom Token-Cap. Eine Reduktion haette die Truncations verschlimmert statt verbessert.
- **Heartbeat-Pattern (v1.10.4) bleibt unangetastet.** Wird erst mit v2.0-Streaming obsolet.

### Tests

- Backend 293/293 gruen (3 Tests fuer geaenderte Konstanten angepasst, 1 neuer Test fuer `isRateLimitError` mit `throttle_timeout`, 1 neuer Test fuer Einzel-Call-Timeout-Cap, 1 neuer Test fuer Token-Bucket-Rate-Limiter).
- Frontend 143/143 gruen (1 bestehender 429-Test auf Hard-Limit-Pfad umgestellt, 2 neue Tests fuer Auto-Retry-Verhalten: 503-Retry-mit-Success und blocked.overloaded-mit-Exhaustion).
- Lint + Prettier auf allen geaenderten Files gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051910`.

## [1.10.5] — 2026-05-15

### Behoben — Spinner verschwand mid-Pipeline mit Heartbeat

Direkt nach v1.10.4-Deploy gemeldet: Spinner verschwand nach wenigen Sekunden, dann ~1 Minute leere UI, dann ploetzlich das Ergebnis. Ursache: `await fetch(...)` returnt bei chunked transfer **sofort sobald Headers da sind** (statt erst beim kompletten Body wie bei `Content-Length`-Response). `stopScanAnim()` lief deshalb mid-Pipeline statt erst beim fertigen JSON.

- **`public/js/api.js`**: `stopScanAnim()` aus dem fetch-Direct-Path entfernt. Stopp jetzt entweder im 4xx-Block oder nach `await response.json()` — dann ist der Body wirklich da und der User sieht den Wechsel von Spinner zu Ergebnis ohne Lücke.

### Tests

- Frontend 141/141 gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051509`.

## [1.10.4] — 2026-05-15

### Behoben — Safari/WebKit kappt fetch nach ~47 s ("Load failed")

Akutes Problem: Im Workshop-Setup auf macOS + iOS Safari brach jede Analyse mit `TypeError: Load failed` ab, sobald die Pipeline laenger als ~45 s lief. Cloud Logging zeigte: Backend antwortete sauber mit `status:ok` in 50-120 s, der Browser kappte aber bereits nach 46-47 s. Brave/Chrome (Chromium-Engine) waren nicht betroffen, also engine-spezifisches Verhalten — WebKit killt idle fetch-Streams ohne Server-Bytes.

**Fix: Heartbeat-Pattern.**

- **Neu — `functions/src/heartbeat.js`**: Streaming-Helper, der den Status auf 200 committed und alle 5 s ein Whitespace-Byte ueber chunked transfer sendet. `JSON.parse` toleriert leading whitespace, deshalb keine Client-Anpassung noetig.
- **`functions/src/handle-analyze.js`**: Heartbeat startet NACH allen 4xx-Pfaden (Validation, Counter), direkt vor dem ersten Mistral-Call. Alle `res.json(...)` in der Pipeline durch `heartbeat.finish(...)` ersetzt. Outer catch signalisiert Fehler als `blocked.apiError` im 200er-Body, da Status nach Heartbeat-Start nicht mehr aenderbar ist.
- **`public/js/api.js`**: Fehlklassifizierung „Geraet im Ruhestand" entfernt. Sticky-Flag `pageHiddenDuringRequest` raus — pruefte den falschen Zeitpunkt und feuerte auch bei Safari-Display-Dimm. Stattdessen wird `document.hidden` zum tatsaechlichen Fehler-Zeitpunkt geprueft.
- **`functions/eslint.config.js`**: `setInterval`/`clearInterval` als Globals (fuer Heartbeat-Timer).
- **`eslint.config.mjs`**: `screen` als Browser-Global ergaenzt (war v1.10.0-Lint-Schuld in `client-context.js`).

### Tests

- Backend 290/290 gruen. Heartbeat-Helper enthaelt graceful Test-Fallback: wenn `res.flushHeaders` im Mock fehlt, fungiert er als `res.status(200).json(body)` — alle bestehenden `index.test.js`-Tests laufen unveraendert.
- Frontend 141/141 gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051508`.

## [1.10.3] — 2026-05-15

### Geaendert — Hosting-Fallback-Pfade entfernt

Nach erfolgreicher Verifikation von `api.malzi.me` (v1.10.2) jetzt die beiden Fallbacks aufgeraeumt, die als Sicherheitsnetz waehrend des Uebergangs drin waren:

- **`firebase.json` CSP `connect-src`**: alte Cloud-Run-URL `https://analyze-5ymhpdpqcq-ew.a.run.app` entfernt. Nur noch `api.malzi.me` (+ Nominatim) erlaubt — engerer Schutz, kein Bypass mehr ueber die alte URL moeglich.
- **`firebase.json` rewrites**: `/analyze → function analyze` entfernt. War der urspruengliche Hosting-Rewrite mit dem 60s-Edge-Timeout-Bug — wird vom aktuellen Frontend nicht mehr aufgerufen, und Clients mit gecachtem alten Frontend laufen nach Cache-Buster-Update (`?v=2026051507`) automatisch auf die neue api.js mit `api.malzi.me`.

Cloud-Run-Services bleiben unveraendert; nur Frontend-Hosting-Konfig.

### Tests

- Bestandstests laufen weiter, keine Logik-Aenderung.

### Sonstiges

- Cache-Buster auf `?v=2026051507`.

## [1.10.2] — 2026-05-15

### Geaendert — Analyze-Endpoint nutzt jetzt `api.malzi.me`

Custom Domain `api.malzi.me` ist via Cloud Run Domain Mapping eingerichtet (CNAME → `ghs.googlehosted.com`, SSL automatisch ueber Lets Encrypt). Damit weg von der unschoenen `.run.app`-URL und in DevTools/Network-Tab sauber unter eigener Domain sichtbar. Funktional identisch zur direkten Cloud-Run-URL — Edge-Timeout-Falle bleibt umgangen.

- **`public/js/api.js`**: `ANALYZE_URL` auf `https://api.malzi.me`
- **`firebase.json`**: CSP `connect-src` um `https://api.malzi.me` ergaenzt; alte `analyze-5ymhpdpqcq-ew.a.run.app` bleibt vorerst als Fallback drin fuer User mit gecachtem alten Frontend-Build
- DNS-/SSL-/CORS-Setup live verifiziert (HTTP 405 / 204 Preflight, `server: Google Frontend`, `access-control-allow-origin: https://malzi.me`)

### Tests

- Bestandstests laufen weiter, keine Logik-Aenderung.

### Sonstiges

- Cache-Buster auf `?v=2026051506`.

## [1.10.1] — 2026-05-15

### Geaendert — Trace-ID standardmaessig in Fehlermeldungen

`?debug=1`-Toggle entfernt — der Diagnose-Code (Trace-ID) wird jetzt bei **jedem** Fehler dezent als zweite Zeile unter der User-Meldung angezeigt. So kann jeder Workshop-Teilnehmer im Fehlerfall den Code an den Support weitergeben, ohne dass URL-Tricks noetig sind. Der Code bleibt anonym (keine PII), zeigt nur die Quittungsnummer fuer das zugehoerige Cloud-Logging-Bundle.

- **`public/js/ui.js`**: `setStatus(text, traceId)` nimmt jetzt eine optionale Trace-ID. Trace-Anzeige als eigenes `<small class="status__trace">`-Element (XSS-sicher via createElement/textContent).
- **`public/styles.css`**: Neue Klasse `.status__trace` — kleiner, dezent grau, monospace, mit `user-select: text` damit der Code per Maus markierbar ist.
- **`public/js/api.js`**: Alle Fehler-`setStatus`-Aufrufe (catch-Block + HTTP-Error + Rate-Limit) reichen `traceId` mit. `appendTraceIdInDebug` + `isDebugMode`-Aufruf entfernt.
- **`public/js/client-context.js`**: `isDebugMode()`-Export entfernt (nicht mehr benoetigt).
- **`public/__tests__/api.test.js`**: 7 Tests von `toBe(...)` auf `toContain(...)` umgestellt, weil `textContent` jetzt auch die Trace-Zeile enthaelt.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051505`.

## [1.10.0] — 2026-05-15

### Neu — State-of-the-Art Logging-Pipeline (anonym, DSGVO-konform)

Das v1.9.0-Logging deckte nur Fehler ab und liess Frontend ↔ Backend unverbunden. v1.10.0 macht daraus eine richtige Telemetrie-Pipeline: pro Analyse eine durchgaengige Trace-ID, alle Pipeline-Schritte mit Timings, Erfolge und Fehler beide strukturiert, mit Hardware-/Netzwerk-Kontext fuer Diagnose von Mobile-Issues.

- **Trace-ID-Korrelation Frontend ↔ Backend** (`public/js/client-context.js` neu): Frontend generiert pro Analyse-Lauf eine 16-Zeichen-Trace-ID, sendet sie im `analyze`-Body mit. Backend (`handle-analyze.js`) validiert sie (Regex-Whitelist), nimmt sie in alle Log-Eintraege auf und setzt sie als `X-Trace-Id`-Response-Header. Damit ist jeder Frontend-Error einem konkreten Backend-Request zuordenbar.
- **Strukturierte Pipeline-Timings im Backend** (`handle-analyze.js`): Jeder Mistral-Schritt loggt `durationMs`. Final-Log enthaelt `totalMs`, `describeMs`, `profilesMs` — kein Zusammenrechnen aus Timestamps mehr noetig. Auch Blocked- und Error-Pfade enthalten `totalMs`.
- **Neuer `/api/telemetry`-Endpoint** (`functions/src/handle-telemetry.js`, `firebase.json`): Spiegel zu `/api/errors`, aber `console.log` (severity INFO) statt `console.error` (ERROR) — Success-Events bleiben getrennt von Fehlern im Cloud Logging. Whitelist + Laengenlimits identisch zur Errors-Function.
- **Anonymer Hardware-/Netzwerk-Kontext** (`public/js/client-context.js`): `collectClientContext()` sammelt `effectiveType` (`4g`/`3g`), `downlinkMbps`, `rttMs`, `saveData`, `deviceMemoryGb`, `hardwareConcurrency`, `language`, `screen` (BxH), `dpr`. KEINE IP, KEINE Cookies, keine UUIDs persistent — nur grobe Klassen fuer Performance-/Mobile-Diagnose.
- **Telemetrie-Logger Frontend** (`public/js/telemetry-logger.js` neu): `logTelemetry(eventType, context)` sendet anonymisierte Performance-Daten. `keepalive: true` fuer Beacons beim Tab-Schliessen.
- **Phase-Timings im Frontend** (`public/js/api.js`): Misst und meldet `prepareImageMs`, `fetchMs`, `parseMs`, `renderMs`, `totalMs`. Bei Success: `logTelemetry("analyze-success", ...)`. Bei Fehler: vorhandene Timings landen mit im Error-Report.
- **Error-Logger erweitert** (`public/js/error-logger.js`, `handle-errors.js`): `traceId`, `httpStatus`, `timings`, `client` zusaetzlich akzeptiert + validiert.
- **`?debug=1` URL-Parameter** (`public/js/client-context.js`): Aktiviert Trace-ID-Anzeige in der Status-Zeile bei Fehlern — User kann die ID einfach an Support weitergeben.
- **Trace-ID im State** (`public/js/state.js`): `state.lastTraceId` fuer Wiederverwendung.

### DSGVO-Bilanz

Geloggt: Fehler-Typ + -Message (gekuerzt), Phase, Dauer, gekuerzter User-Agent, anonyme Hardware-Klassen (Memory-Stufe / CPU-Cores / grobe Bandbreite), Trace-ID (ephemer, kein Profil), URL-Pfad. Nicht geloggt: IP persistent, Cookies, Bilder, EXIF, GPS, exakte Browser-Versionen, Timezones. Daten liegen ausschliesslich in Cloud Logging mit projektweiter Retention.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051504`.

## [1.9.1] — 2026-05-15

### Geaendert — Upload-Limit von 6 MB auf 25 MB hochgesetzt

Frontend verkleinert das Bild ohnehin per Canvas-Resize (`exif.js`), bevor es an die API gesendet wird. Das alte 6-MB-Hardlimit blockierte aber bereits die Rohdatei — typische Handy-Originale (iPhone, iPad, Pixel) liegen oft bei 4–10 MB und scheiterten daran ohne Grund. Neues 25-MB-Limit laesst alle ueblichen Handy-Fotos durch, schuetzt aber weiterhin vor versehentlich hochgeladenen RAW-Dateien oder Videos.

- **`functions/src/config.js`**: `MAX_UPLOAD_BYTES` von 6 auf 25 MiB
- **`public/js/api.js`**: Client-seitige Pre-Check-Grenze von 6 auf 25 MB
- **`public/locales/de.json` + `en.json`**: Hint + Fehlermeldung („max 6 MB" → „max 25 MB")
- **`public/index.html`**: drop-hint Text
- Tests angepasst: `config.test.js`, `api.test.js` (Oversize-Test von 21 auf 30 MB), `index.test.js` (Base64-Oversize-Test von 15 auf 40 MB).

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051503`.

## [1.9.0] — 2026-05-15

### Neu — Anonymes Client-Error-Logging (DSGVO-konform)

Bisher waren Frontend-Fehler nur als pauschale UI-Meldung sichtbar (z.B. „Server-Fehler", „Verbindung fehlgeschlagen") — ohne Hinweis auf Fehler-Typ, Phase oder Dauer. Reproduktion und Diagnose von Reports waren reine Vermutungssache. Jetzt landet jeder Frontend-Fehler strukturiert in Cloud Logging.

- **`functions/src/handle-errors.js`** (neu): nimmt POST mit JSON-Body, validiert Felder gegen eine Whitelist mit Laengenlimits, schreibt strukturierten Eintrag mit `console.error` (severity ERROR in Cloud Logging). DSGVO: keine PII, keine IP-Speicherung (nur Rate-Limit-Bucket), keine Cookies, keine persistente Speicherung — Daten liegen ausschliesslich in Cloud Logging mit der projektweiten Retention.
- **`functions/src/index.js`**: neue `errors`-Function (europe-west1, 128 MiB, 3 max instances, 10s timeout, public CORS auf `ALLOWED_ORIGINS`).
- **`firebase.json`**: Hosting-Rewrite `/api/errors` → function `errors` (Same-Origin → keine CSP-Aenderung noetig).
- **`public/js/error-logger.js`** (neu): `logClientError(error, context)` sendet anonymisierte Fehler-Metadaten an `/api/errors`. `keepalive:true` damit der Beacon auch beim Tab-Schliessen durchgeht. Fehler des Loggers selbst werden still geschluckt — der User-Flow haengt nie davon ab.
- **`public/js/api.js`**: catch-Block setzt jetzt eine eindeutige `phase` (`image-read` / `image-decode` / `page-hidden` / `client-timeout` / `offline` / `network` / `fetch`) und ruft `logClientError(err, { phase, durationMs, requestId })`. Auch HTTP-Fehler-Responses (>=400) werden mit Phase `http-error` geloggt. UI-Meldungen bleiben identisch.

### Datenfelder (Whitelist, alles optional)

- `errorName` (max 100), `errorMessage` (max 500), `phase` (max 50), `url` Pfad-Teil (max 200), `userAgent` gekuerzt (max 250), `requestId` (max 50)
- `durationMs` (0–600000), `online`, `hidden`

Was NICHT geloggt wird: IPs persistent, Cookies, Bilder, EXIF, GPS, beliebige Header.

### Tests

- Bestandstests werden vor Deploy ausgefuehrt.

### Sonstiges

- Cache-Buster auf `?v=2026051502`.

## [1.8.0] — 2026-05-15

### Behoben — Hosting-Edge-Timeout umgangen

Beobachtet: Bei langsameren Mistral-Antworten (z.B. heute Vormittag um ~30 % erhoehte Latenz) reisst die komplette Pipeline (describe + 2x profile) die 60-Sekunden-Grenze des Firebase-Hosting-Rewrite-Edges. Symptom im Browser: „Server-Fehler" nach ~60–70 s, obwohl die Cloud Function selber sauber mit `status:"ok"` antwortet — der Hosting-Proxy davor kappt die Antwort.

- **`public/js/api.js`**: `ANALYZE_URL` zeigt jetzt direkt auf die Cloud-Run-URL der `analyze`-Function (`https://analyze-5ymhpdpqcq-ew.a.run.app`) statt auf den `/analyze`-Rewrite. Damit greift der Cloud-Run-Function-Timeout (180 s laut `index.js`) statt des Hosting-Edge-Timeouts (~60 s).
- **`firebase.json`**: CSP `connect-src` um die Cloud-Run-URL erweitert, damit der Browser den Cross-Origin-Fetch zulaesst.
- **`e2e/smoke.test.js`**: Route-Pattern auf `**/analyze*` erweitert, damit der Mock weiter greift.
- **CORS** regelt `firebase-functions/v2` bereits automatisch via `cors: ALLOWED_ORIGINS` (`functions/src/index.js`) — keine Anpassung am Backend noetig.

Der bisherige `/analyze`-Rewrite in `firebase.json` bleibt als sanfter Fallback erhalten (wird vom Frontend nicht mehr genutzt). Eine eigene Subdomain `api.malzi.me` statt der unschoenen `.run.app`-URL ist als naechster Schritt vorgemerkt — DNS-Mapping erfolgt direkt von Cloud Run auf IONOS (NICHT ueber Firebase Hosting, sonst zurueck in den Edge-Timeout).

### Tests

- Bestandstests laufen weiter; Smoke-Test-Pattern auf neue URL angepasst.

### Sonstiges

- Cache-Buster auf `?v=2026051501`.

## [1.7.2] — 2026-05-14

### Aufgeraeumt — Gemini-Aera-Reste entfernt

Nach der Pure-Mistral-Umstellung (v1.6.0) waren in Doku und Kommentaren noch veraltete Verweise auf Google Gemini / Vertex AI / Cloud Vision uebrig — teils schlicht falsch (z.B. „faellt automatisch auf Gemini-Fallback zurueck", obwohl es seit v1.6.0 keinen Fallback-Anbieter mehr gibt). Bereinigt:

- **`CONTRIBUTING.md`, `SECURITY.md`, `docs/SETUP.md`, `docs/SELF-HOSTING.md`, `AGENTS.md`** — falsche Multi-Provider-/Fallback-/Vision-API-Aussagen korrigiert. `SECURITY.md`: obsolete `@google-cloud/vision`-Vulnerability-Zeile + Vertex-AI-Vendor-Zeile entfernt, veraltete „Throttle nicht aktiviert"-Notiz auf den v1.7.0-Stand gebracht. Test-Zahlen in `SETUP.md` auf 290 Backend / 141 Frontend aktualisiert.
- **`functions/.env.example`** — verwies auf `VERTEX_LOCATION` / `GCLOUD_PROJECT`, jetzt auf `MISTRAL_API_KEY`.
- **`functions/src/locales/de/prompts.js` + `en/prompts.js`** — Header-Kommentare („Gemini-Prompts", „aus gemini.js") korrigiert; toter Locale-Key `labelVisionLabels` entfernt (wurde seit v1.6.0 nirgends mehr genutzt).
- **`functions/src/__tests__/i18n-guardian.test.js`** — `vision.js` aus der Ausschlussliste entfernt (Datei existiert seit v1.6.0 nicht mehr).
- Verwaiste lokale Artefakte geloescht (`compare-result.html`, `compare-failed-*.txt`, diverse `.DS_Store`).

`CHANGELOG.md` bleibt bewusst unangetastet — alte Eintraege sind historisches Protokoll.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen. Reine Doku-/Kommentar-Bereinigung, keine Funktionsaenderung.

## [1.7.1] — 2026-05-14

### Behoben / Verbessert

- **Wake-Lock gegen Analyse-Abbruch** (`public/js/api.js` + Locales): Eine Analyse kann bis ~3 min dauern. Ging das Geraet in der Zeit in Standby, fror der Browser die Seite ein und die laufende fetch-Anfrage starb — der User sah beim Aufwachen einen Fehler, obwohl der Server fertig gerechnet hatte. Jetzt fordert der Browser waehrend der Analyse einen Screen-Wake-Lock an (Bildschirm bleibt an) und gibt ihn danach wieder frei. Best-Effort: nicht jedes Geraet unterstuetzt die API, und ein manueller Power-Knopf-Druck sperrt weiterhin.
- **Treffende Fehlermeldung bei Standby-Abbruch**: Ging die Seite waehrend des Requests doch in den Hintergrund, zeigt malziME jetzt "Die Analyse wurde unterbrochen, weil das Geraet in den Ruhezustand ging..." (neuer Locale-Key `error.suspended`, de + en) statt eines generischen Netzwerkfehlers.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051404`.

## [1.7.0] — 2026-05-14

### Sicherheit & Stabilitaet — Audit-Massnahmen

Dieses Release setzt die Befunde eines internen Security-, Privacy- und Reliability-Audits (Stand Commit f6d1a47) um. Vier Befunde wurden im Code behoben, jeweils mit Test:

- **REL-01 — Burst-Bremse aktiviert** (`mistral.js` + `throttle.js`): Die Per-Instance-Semaphore aus `throttle.js` war fertig implementiert und getestet, aber nirgends in die Pipeline eingebunden. Jeder Mistral-HTTP-Call laeuft jetzt durch `withMistralSlot` — bei einem Workshop-Burst (viele gleichzeitige Uploads, je 3 Mistral-Calls) warten ueberzaehlige Calls geordnet auf einen freien Slot, statt Mistrals RPS-Limit zu reissen und als `blocked.overloaded` fehlzuschlagen.
- **SEC-02 — XSS-Haertung beim Ergebnis-Rendering** (`public/js/dom.js` + `json-repair.js`): `escapeHtml` escaped jetzt auch Anfuehrungszeichen (`"` / `'`) — die Funktion wird in `render.js` im Attribut-Kontext (`data-key="..."`) verwendet, wo ein nicht-escaptes `"` einen Attribut-Breakout erlaubt haette. Zusaetzlich filtert `applyBounds` Kategorie-Keys serverseitig gegen eine Whitelist (`[a-zA-Z0-9_]`), damit ein prompt-injizierter Modell-Output keinen Key mit Sonderzeichen ins DOM bringen kann (Defense-in-depth).
- **SEC-01 — Admin-Token konstantzeitig vergleichen** (`auth.js` + `handle-admin.js`): Der Bearer-Token-Vergleich nutzte `===` (timing-anfaellig), waehrend der HMAC-Pfad bereits `crypto.timingSafeEqual` verwendete. Neue zentrale `safeCompare`-Funktion in `auth.js`, im Admin-Handler eingesetzt — kein Timing-Seitenkanal mehr aufs Admin-Secret.
- **REL-02 — Kostenbremse-Ausfall wird alarmiert** (`counter.js`): Faellt der Firestore-Stundenzaehler aus, laeuft das System bewusst fail-open weiter — der Zaehler ist aber die einzige globale Kostenbremse fuer Mistral-Calls. Der Fehlerfall wird jetzt als `console.error` mit `alert: "counter-fail-open"`-Marker (statt stillem `console.log`) eskaliert, sodass ein Log-basierter Alert in Cloud Logging anschlagen kann.

Nicht-Code-Befunde des Audits: Das Mistral-Ausgabenlimit (100 EUR/Monat, harte Notbremse) deckt die Kostenseite von REL-02 extern ab. Branch Protection (`enforce_admins=false`) bleibt als bewusster Solo-Entwickler-Trade-off bestehen.

### Tests

- 290 Backend-Tests + 140 Frontend-Tests gruen (neue Tests fuer alle vier Befunde).

### Sonstiges

- Cache-Buster auf `?v=2026051403`.

## [1.6.2] — 2026-05-14

### Behoben

- **Alter inkonsistent zwischen Normal- und Beast-Modus** (Prompts de + en): Bisher nannte die Bildbeschreibung absichtlich kein Alter — sie beschrieb nur die Merkmale, und beide Profil-Anfragen legten das Alter danach jeweils selbst fest. Dadurch kamen sie auf unterschiedliche Werte. Jetzt legt die bildsehende Stufe (Mistral Large 3) die Altersspanne EINMAL fest, beide Profile (Normal + Beast) uebernehmen sie unveraendert. Umgesetzt ueber `describePrompt` + `describeFallback` (Alter wird jetzt explizit geschaetzt) plus neue `ALTER`-Regel in `SCHEMA_RULES`. `AGE_ANCHOR`-Kalibrierung unveraendert. Reiner Prompt-Eingriff, keine zusaetzliche API-Anfrage.

## [1.6.1.1] — 2026-05-14

### Behoben

- **Geschlecht inkonsistent zwischen Normal- und Beast-Modus** (`SCHEMA_RULES` in de + en `prompts.js`): Beide Profile bekommen dieselbe Bildbeschreibung von Large 3 — aber der Beast-Modus (hoehere Temperatur + konfrontativer System-Prompt) interpretierte das Geschlecht teils neu, statt es zu uebernehmen. Neue Regel in `SCHEMA_RULES`: Das Geschlecht steht in der Bildbeschreibung und wird exakt uebernommen — keine Neuinterpretation, keine Aenderung zur dramatischen Wirkung. Greift fuer Normal + Beast. Reiner Prompt-Eingriff, keine zusaetzliche API-Anfrage.

## [1.6.1] — 2026-05-14

### Behoben / Verbessert

Erste Live-Uploads nach dem v1.6.0-Deploy zeigten drei Genauigkeitsschwaechen — alle drei adressiert:

- **Tierart-Erkennung** (`animal.js` + Prompts): Eine orange Langhaarkatze wurde als Hund eingestuft. Zwei Ursachen behoben:
  - `detectAnimalType` nimmt jetzt das **haeufigste** Tier-Stichwort im Beschreibungstext statt des erstbesten in fester Reihenfolge — ein einzeln erwaehnter "Hund" verliert gegen eine mehrfach genannte "Katze".
  - `mistralDescribeAddendum` (de + en) bekam eine Merkmals-Checkliste (Katze: dreieckige Ohren, Schnurrhaare, kurze Schnauze; Hund: laengere Schnauze), damit Mistral die Tierart vor dem Festlegen gezielt prueft.
- **Geschlechts-Kalibrierung** (Prompts): Eine Frau wurde als Mann erkannt. Neuer `GENDER_ANCHOR`-Block in `describePrompt` + `describeFallback` (de + en): Geschlecht zuerst aus echten Gesichtsmerkmalen bestimmen, nicht aus Frisur/Kleidung; "nicht eindeutig erkennbar" nur als Notausgang fuer echt mehrdeutige Faelle erlaubt — nicht als Standardantwort.
- **Bild-Schaerfe** (`public/js/exif.js`): Beim Verkleinern im Browser wird jetzt `imageSmoothingQuality = "high"` gesetzt — das verkleinerte Bild bleibt schaerfer, die KI sieht mehr Details (relevant fuer die Altersschaetzung). Cache-Buster auf `?v=2026051402`.

### Hinweis

Das sind Feinschliff-Massnahmen, kein Allheilmittel — Mistrals Grundgenauigkeit bei Alter/Geschlecht/Tierart bleibt modellbedingt schwankend. Fuer die Workshop-Hauptzielgruppe (Schueler 10–17) ist Mistral laut Evaluierung weiterhin die bessere Wahl als Gemini.

### Tests

- 283 Backend-Tests + 139 Frontend-Tests gruen.

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
