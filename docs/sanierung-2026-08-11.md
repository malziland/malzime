# Sanierungsplan zum LANGAUDIT vom 2026-08-10

Bezug: `docs/audit-2026-08-11.md` (Prüfstand `b9cec48`, v2.10.0)
Auftrag: **alle 38 Befunde restlos schließen.** Kein Punkt bleibt am Ende offen.

---

## 1. Was „fertig" heißt

Ein Befund gilt erst dann als geschlossen, wenn **alle vier** Bedingungen erfüllt sind:

1. Die Änderung ist gemacht, mit Pfad und Zeile benannt.
2. Es gibt eine **Prüfung**, die den Fehler abdeckt — ein Test, ein Suchbefehl oder
   eine externe Abfrage.
3. **Rückbauprobe:** Ich drehe nur den Quellcode zurück, behalte die Prüfung, und
   die Prüfung wird rot. Die Fehlermeldung kommt wörtlich in den Nachweis. Danach
   wiederherstellen und grün sehen.
4. **Nachlauf:** Dieselbe Denkfigur wurde repo-weit gesucht. „Keine weiteren
   Fundstellen" ist ein Ergebnis und wird notiert.

Wo keine Prüfung möglich ist (reine Doku, Entfernungen, externe Einstellungen),
tritt an ihre Stelle eine Gegenprobe mit Suchbefehl und Trefferzahl bzw. die
lesende CLI-Abfrage, die den neuen Zustand belegt.

**Nicht zulässig als Abschluss:** „künftig darauf achten", „bei Gelegenheit",
„sollte man mal". Entweder es wird eine Prüfung im System, oder es steht als
ausdrücklich verworfen mit Begründung in der Liste.

---

## 2. Freigaben, die ich jetzt brauche

Alle auf einmal, damit am Ende nichts nachkommt.

| # | Freigabe | Warum | Meine Empfehlung |
|---|---|---|---|
| F1 | **Read-only aufheben** — ich darf Code und Konfiguration im Repo ändern | Sonst geht gar nichts | ja |
| F2 | **GCP-Änderungen** (Monitoring-Kanal, Soft-Delete, Dienst löschen) | OPS-003, PRIV-003, SEC-004 | ja |
| F3 | **GitHub-Änderungen** (Tags/Releases neu setzen, `enforce_admins`) | OPS-002, OPS-001 | ja |
| F4 | **Firestore in die EU umziehen** (neue Datenbank, Code umstellen, Altbestand leeren) | PRIV-001 | **ja** — der Datenschutz ist dein Verkaufsargument; „liegt in der EU" ist glaubwürdiger als „liegt in den USA, ist aber vertraglich gedeckt". Kein Datenumzug nötig, weil Jobs nur 2 h leben |
| F5 | **ntfy-Server absichern** (anonymes Schreiben abschalten) | SEC-005 — betrifft deinen gemeinsamen ntfy-Dienst, also auch andere Projekte | ja, aber als letzter Schritt und mit Test danach |
| F6 | **Stundenlimit 500 → 380 senken** | ARCH-001 — der Durchsatz liegt bei ~387/h; ein Limit darüber baut nur Rückstau auf | ja. Ein 25er-Workshop braucht 200–300/h, 380 ist reichlich |

**Deploy bleibt getrennt.** Ich deploye erst auf dein ausdrückliches Wort, wie immer.

Zwei Dinge kann ich dir nicht abnehmen:

- **Der Text der Datenschutzerklärung.** Ich schreibe die Korrektur, du liest sie
  einmal — es ist ein Rechtsdokument mit deinem Namen darunter.
- **Die Frage, ob „ohne Personenbezug" darin haltbar ist.** Das ist eine
  Rechtsfrage, kein Bug. Sie steht im Bericht unter „offene Fragen" und wird hier
  ausdrücklich als *nicht technisch lösbar* geparkt — nicht als offener Befund.

---

## 3. Die 38 Befunde — Maßnahme und Nachweis

### Welle 1 — Blocker und rotes Gate (zuerst, ~1 Stunde)

| ID | Maßnahme | Nachweis |
|---|---|---|
| BUG-001 | `pruefeTierWiderspruch` samt `TIER_MERKMALE`/`KEIN_TIER` und beiden Aufrufstellen entfernen; Tests entfernen. Primaten-Regel zusätzlich in `mistralDescribeAddendum` beider Sprachen aufnehmen | `grep -rn pruefeTierWiderspruch functions/src/` → 0 (Positivkontrolle: `classifyDescription` > 0). Neuer Integrationstest: Gaming-Profil ⇒ `mode: "multimodal"`. Rückbauprobe: heute liefert er `"animal"` |
| OPS-001a | `Response: "readonly"` in `eslint.config.mjs` bei den Test-Globals | `npm run lint` exit 0; danach ein grüner CI-Lauf auf `main` |
| OPS-001b | `enforce_admins` einschalten | `gh api …/protection` → `enforce_admins.enabled: true` |
| OPS-001c | Deploys wieder über `scripts/deploy.sh`; Benachrichtigung auf rote `main`-Läufe einrichten | Cache-Buster in allen fünf HTML-Seiten identisch |
| UX-001 | `clearStoredJobId()` an den Anfang von `analyzeImageQueued`; „Upload läuft"-Zustand, den `resumeQueueJob` respektiert; `state.lastPollOk` in `state.js` deklarieren und beim Upload-Start zurücksetzen | Neuer Test: vorige Analyse fertig + neues Foto + `visibilitychange` ⇒ `/api/enqueue` wird gerufen, kein `job-status` auf die alte Nummer. Schließt zugleich den vormaligen UX-003 |
| PRIV-002 | `img/demo/original/**` in die `ignore`-Liste von `firebase.json`; Sicherungsordner aus `public/` heraus (`scripts/ki-wasserzeichen.mjs:39`); sechs Dateien enttracken | Nach dem Deploy: `curl -I https://malzi.me/img/demo/original/demo-selfie.jpg` → 404. Neuer Test: jede ausgelieferte Demo-Datei trägt `trainedAlgorithmicMedia` |

### Welle 2 — die übrigen P1 und alles Sicherheitsrelevante

| ID | Maßnahme | Nachweis |
|---|---|---|
| PRIV-001 | Neue Firestore-Datenbank in `europe-west1`; `getFirestore("<name>")` im Code; `stats`, `featureFlags`, `config/maintenance` übernehmen; alte Datenbank leeren. Dazu Datenschutzerklärung, ARCHITECTURE, SECURITY-MODEL, README korrigieren | `gcloud firestore databases list` → `europe-west1`; danach eine echte Analyse und Sichtprüfung, dass das Job-Dokument dort entsteht |
| OPS-003 | Monitoring-Kanal-URL auf das aktuelle Topic ziehen (ich lese es aus dem Secret, gebe es nirgends aus). Danach bewusst eine ERROR-Zeile erzeugen und den Empfang bestätigen lassen | Testalarm kommt auf deinem Handy an — das ist der einzige gültige Nachweis |
| SEC-001 | Prüfung auf **alle** Textfelder ausweiten: bei `ad_targeting` entfernen, bei `profileText` und Karten **protokollieren** (damit keine Aufklärung wegfällt). `\bkredit` → `kredit`. Wortlisten pro Sprache in die Locales. Getrennte Listen für Werbung und Trigger. `minor-safety` bei **jeder** Analyse loggen, auch mit `entfernt: 0`, plus `lang` und ob ein Alter erkannt wurde | `test.each`-Matrix über beide Sprachen mit je 20 Phrasen; Integrationstest, der „Bet365" in `profileText` abfängt. Rückbauprobe je Liste |
| OPS-002 | Tags und Releases `v2.9.0`–`v2.9.4` löschen und passend zum CHANGELOG neu setzen; `release.yml` bei Nummern-Kollision **rot** laufen lassen statt still auszusteigen | Skript im CI: jeder `## [x.y.z]`-Abschnitt muss auf einen Tag zeigen, dessen CHANGELOG-Spitze dieselbe Version trägt |
| PRIV-003 | Soft-Delete am Bucket auf 0; im RUNBOOK als Prüfpunkt verankern | `gcloud storage ls --soft-deleted …` → 0 |
| PRIV-004 | Abhol-Ticket beim Rendern verbrauchen | Test: zweiter Seitenaufruf im selben Tab rendert kein fremdes Ergebnis |
| SEC-002 | Größe vor dem Dekodieren aus `content-length` ablehnen; `enqueue`-Speicher bzw. Parallelität anpassen | Test gegen den Emulator mit übergroßem Body ⇒ 413 vor jeder Allokation |
| SEC-003 | Reaper-Karenz nicht allein am Poll aufhängen, damit reines Pollen keine Plätze blockiert | Emulator-Probe: 500 Jobs anlegen, pollen, Plätze müssen freikommen |
| SEC-006 | Prompt-Injection-Warnung in den Single-Large-Prompt beider Sprachen; `SECURITY.md` korrigieren | Test analog `age-markers.test.js`: Warnung in beiden Pfaden × beiden Sprachen |

### Welle 3 — Betrieb, Kapazität, Tests

| ID | Maßnahme | Nachweis |
|---|---|---|
| OPS-004 | `console.error` im `generateBeastAds`-Fehlerpfad; log-basierte Metrik auf die `blocked.apiError`-Quote mit Schwellwert-Alarm | Testalarm auslösen |
| ARCH-001 | Stundenlimit auf 380 (Konstante **und** Firestore `stats/current.limit`) | Unit-Test: `QUEUE_DISPATCH_CONCURRENCY × 3600 / QUEUE_AVG_JOB_SECONDS ≥ HOURLY_LIMIT` |
| BIZ-001 | hard-facts **voranstellen** statt ersetzen | Test, der die Alterskarte **nach** `runSingleLargeCall` prüft |
| TEST-001 | Test, der eine XSS-Nutzlast durch `renderCurrentMode` schickt und am DOM prüft | Rückbauprobe: ohne `escapeHtml` muss er rot sein (heute belegt: alle 176 Tests bleiben grün) |
| TEST-002 | Die mit v2.10.0 verlorenen Zusicherungen in `handle-enqueue.test.js` nachziehen: Base64-Zeichensatz, 413, MIME-Liste, 100-Zeichen-EXIF, Reihenfolge Honeypot-vor-Zähler | Rückbauprobe je Fall |
| TEST-003 | Dritter axe-Lauf nach dem Umschalten in den Beast Mode; `#biasSwitch` in den Tastaturtest | `npm run test:e2e` mit den neuen Fällen |
| OPS-005 | `playwright-version` als fünften Pflicht-Check aufnehmen | `gh api …/protection` → 5 Kontexte |
| OPS-006 | Dependabot-Ausnahme auf „Verzeichnis enthält `/functions`" umstellen statt Gleichheit auf `direct:production` | Trockenlauf gegen einen erzeugten Testfall |
| BUG-002 | `await deleteImage(job.imagePath)` in Reaper-Zweig 3 — deckelt **jede** Bild-Waise auf 2 h | Test in `handle-reap.test.js` |
| UX-002 | Wächter auf „Job-Nummer vorhanden UND Analyse lief" umstellen; nach dem Rendern nicht erneut telemetrieren | Test mit `isAnalyzing = false` + gespeicherter Nummer |
| BUG-003 | `fetchWithTimeout` um das Body-Lesen erweitern | Test mit hängendem Body |

### Welle 4 — Doku, Aufräumen, Kleinteiliges

| ID | Maßnahme | Nachweis |
|---|---|---|
| DOC-001 | Beide Schutznetze samt ihrer Grenzen ins Sicherheitsmodell; `SECURITY-MODEL.md` in die Doku-Pflegeliste von `AGENTS.md` aufnehmen | `grep -c minor-safety docs/SECURITY-MODEL.md` > 0 |
| DOC-002 | Durchsatzzahlen auf den gemessenen Stand (65,1 s); die „15 Anfragen/min"-Annahme einmal messen und das Ergebnis im Repo ablegen; Widerspruch in `config.js:33` auflösen | Messskript + Ergebnisdatei |
| DOC-003 | Doku-Drift-Bündel in einem Durchgang: `handle-analyze.js` aus README/AGENTS/ARCHITECTURE, neun `useQueue`-Kommentare, halbfertiger Satz in `feature-flags.js`, ADR-0001 nachstempeln, Testzahlen, Cache-Buster, fünf tote Locale-Schlüssel, `heartbeat.js` entfernen | CI-Schritt: jede in der Doku genannte `functions/src/*.js` muss existieren, und umgekehrt |
| UX-004 | „Google's safety filters" → „Sicherheitsfilter der KI-Anbieter" | `grep -i google public/locales/en.json` → 0 |
| PRIV-005 | Modell-Fehlermeldung in den Logs auf den Fehlertyp reduzieren | Test: `repairStages` enthält keinen Modelltext |
| A11Y-001 | `data-i18n-aria` in `i18n.js`; `alt`-Texte der Demo-Fotos übersetzbar; i18n-Wächter um beide erweitern | Wächter-Test schlägt bei einem hartcodierten `aria-label` an |
| OPS-007 | `api.malzi.me` abbauen: erst CNAME bei IONOS, dann Domain-Zuordnung, dann CSP-Eintrag | `curl -I https://api.malzi.me` → kein DNS; `grep api.malzi.me firebase.json` → 0 |
| OPS-008 | Prompt-Cache am Zweitaufruf: `system`-Split wie im Hauptaufruf, statischen Teil nach vorn — oder den Schlüssel entfernen, wenn er nichts bringt | `cachedTokens > 0` in den `mistral-beast-ads`-Logzeilen; sonst Schlüssel weg |
| OPS-009 | Feature-Flag für den zweiten Mistral-Aufruf, damit er ohne Deploy abschaltbar ist | Flag umlegen, Logzeile bleibt aus |
| SEC-004 | `ntfy-authtest` löschen | `gcloud run services list` → nicht mehr enthalten |
| SEC-005 | Anonymes Schreiben am ntfy-Dienst abschalten, Veröffentlichungs-Token für die Functions | Fremd-Push ohne Token wird abgewiesen |
| OSS-001 | `load-test-malzime.js` auf `/api/enqueue` umstellen oder entfernen | Lauf liefert echte Messwerte statt 404 |
| OSS-002 | Selbst-Abholung des Produktivschlüssels aus den drei Skripten entfernen — Schlüssel muss ausdrücklich gesetzt werden | `grep -rn "functions:secrets:access" functions/scripts/` → 0 |
| OSS-003 | Reales Alter und Bildnamen aus `aufloesung-vs-mimik.js` | `grep ECHTES_ALTER` → kein Vorgabewert mehr |

---

## 4. Abschlussprüfung — wie ich belege, dass nichts offen ist

1. **Abhak-Tabelle über alle 38** mit Pfad/Zeile, Prüfungsname und Ergebnis der
   Rückbauprobe. Jeder Eintrag hat genau einen Endzustand: *behoben*,
   *extern erledigt* oder *bewusst verworfen mit Begründung*.
2. **Volle Messung**: Backend-, Frontend- und E2E-Tests, Lint, Format, `npm audit`,
   `npm ci --dry-run` — alle grün, Zahlen im Nachweis.
3. **KURZAUDIT über den Diff** `b9cec48..HEAD` mit derselben Strenge wie dieser
   Lauf: Hat die Sanierung neue Fehler eingeführt? Eigene Kategorie im Bericht,
   auch wenn sie leer bleibt.
4. **Externe Nachkontrolle**: dieselben `gcloud`- und `gh`-Abfragen wie im Audit,
   mit den neuen Sollwerten.
5. **Live-Smoke nach dem Deploy** mit einer echten Analyse — die Lektion aus dem
   Juli, wo zwei echte Funde erst beim Smoke auftauchten.

Erst wenn diese fünf Punkte belegt sind, sage ich „fertig".

---

## 5. Reihenfolge und Aufwand

| Welle | Inhalt | Aufwand | Deploy? |
|---|---|---|---|
| 1 | Blocker + rotes Gate | ~1 h | ja, nach deiner Freigabe |
| 2 | P1 + Sicherheit | ~3–4 h | ja |
| 3 | Betrieb, Kapazität, Tests | ~3 h | ja |
| 4 | Doku, Aufräumen | ~2 h | Hosting-Deploy |
| 5 | Abschlussprüfung + KURZAUDIT | ~1 h | — |

Welle 1 kann sofort live, die übrigen gebündelt — das hält die Zahl der Deploys
klein, was nach neun Versionen an einem Tag die eigentliche Lehre ist.
