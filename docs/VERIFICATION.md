# Verifikationsmatrix

Welche Qualitäts- und Sicherheitsanforderung ist wodurch **belegt** — nicht behauptet.
Jede Zeile nennt den Nachweisweg (Befehl bzw. CI-Job) und das letzte belastbare
Ergebnis mit Referenz (Commit, CI-Run, Datum). Audits nutzen diese Tabelle als
Einstieg; ein Datum allein ist keine Evidenz. Einträge mit Status **offen** sind
bewusst als offen ausgewiesen.

## Kernnachweise

| Anforderung | Nachweisweg | Letztes Ergebnis |
|---|---|---|
| Backend-Unit-Tests | CI-Job `test-backend` (jeder Push/PR); lokal `npm test --prefix functions` | ✅ 611/611 grün — lokal auf dem Sanierungsstand, 2026-08-10 |
| Frontend-Unit-Tests | CI-Job `test-frontend`; lokal `npm run test:frontend` | ✅ 193/193 grün — lokal auf dem Sanierungsstand, 2026-08-10 |
| E2E kritischster Nutzerfluss (Demo-Foto → Queue → Disclaimer → Profil) | CI-Job `test-e2e` (Playwright, Container-Image = Paketversion); lokal `npm run test:e2e` | ✅ 10/10 grün (Smoke 2, A11y 4 inkl. Beast Mode, Tastatur 1, Sticky 3) — 2026-08-10 |
| Lint + Format (Backend & Frontend) | Teil der CI-Jobs `test-backend`/`test-frontend` (ESLint, Prettier `--check`) | ✅ sauber — 2026-08-10 |
| Secret-Scan (inkl. voller Historie) | CI-Job `secret-scan` (gitleaks v3.0.0, SHA-gepinnt, `fetch-depth: 0`) | ✅ kein Fund — CI-Run 29562535095, 2026-07-17 |
| Dependency-Audit | CI-Job `test-backend`: `node scripts/audit-gate.mjs functions` (Gate, bricht Build; High/Critical blockieren, Ausnahmen nur begründet **und mit Ablaufdatum** in `.github/audit-allowlist.json`) | ✅ **0 Meldungen, Ausnahmeliste leer** — `npm audit` in beiden Projekten 0, auch inklusive Entwicklungswerkzeuge (vorher 27). Stand 2026-07-29 |
| Lockfile ↔ package.json synchron (Linux-CI) | `npm ci --dry-run` in Root und `functions/` — reproduziert den `EUSAGE`-Abbruch lokal, den eine Textsuche nach „linux" im Lockfile **nicht** findet | ✅ beide exit 0 — 2026-07-29 |
| Web-Schicht (Multipart-Streaming, Body-/Query-Parsing) | `functions/src/__tests__/upload-http.test.js` — echter HTTP-Server + echtes Express gegen den echten Parser, in beiden Betriebsarten `pipe` und `rawBody` (Firebase-Produktion nachgebildet). **Schließt die Lücke, dass alle übrigen Backend-Tests `onRequest` durch eine Attrappe ersetzen und die Express-Schicht überspringen.** | ✅ 12/12 grün; Gegenprobe: ohne die `rawBody`-Behandlung in `upload.js` fallen 3 davon durch — 2026-07-29 |
| Queue-Robustheit unter Stoßlast (kein Job verloren) | Queue-Emulator-Lasttest: `firebase emulators:exec` + `functions/scripts/queue-emulator-loadtest.js` (Mistral-Mock, `QUEUE_LOCAL=1`) | ✅ 100 Jobs: 100 done / 0 failed / 0 abandoned / 0 verloren — 2026-07-17 |
| Performance-/Qualitäts-Budget | CI-Job `lighthouse` gegen malzi.me, /datenschutz, /impressum mit Budget-Datei | ✅ pass — CI-Run 29312808034, 2026-07-14 |
| Reproduzierbares Setup (frischer Checkout) | `npm ci` (Root + `functions/`, Lockfiles committet, Node per `.nvmrc`/`engines`/CI gepinnt) | ✅ belegt durch Rollback-Probe (unten), 2026-07-14 |
| Reproduzierbarer Build | — entfällt: kein Build-Schritt (Vanilla-JS-Frontend wird direkt ausgeliefert, Functions deployen Quellcode) | n/a, Begründung links |
| **Rollback-Probe** (Release-Stand aus sich heraus lauffähig) | Release-Tag in temporärem `git worktree` auschecken, `npm ci` Root + functions, beide Test-Suiten | ✅ Tag `v2.3.1` (Commit `8d39a10`): Setup ok, 435/435 + 165/165 Tests grün, Exit 0 — 2026-07-14, Node 24, macOS; Worktree danach entfernt |
| Betriebs-Rollback ohne Deploy (Feature-Flags) | Firestore-Flag `useSingleLargeCall`, Verfahren in [RUNBOOK.md](RUNBOOK.md) | ✅ produktiv erprobt (Architektur-Umstellungen v2.0/v2.2 liefen über genau diese Schalter) |

## Profilpflichten

| Profil | Pflicht | Status |
|---|---|---|
| UI | E2E-Test des kritischsten Nutzerflusses | ✅ `e2e/smoke.test.js` (CI-Pflicht-Check) |
| UI | Automatisierter Accessibility-Check dieses Flows | ✅ `e2e/a11y.test.js` (axe-core im Playwright-E2E, CI-Pflicht-Check): serious/critical-Verstöße brechen die CI — **ohne Ausnahmen seit v2.3.2** (Warmgrau-Textstufe `#6e675e`, `role="img"` an Konfidenz-Punkten, Attribution-Unterstreichung; Messung mit reducedMotion gegen Animations-Artefakte). Seit v2.3.3 meldet axe auf beiden Ansichten **null Funde über alle Schweregrade** (Landmarken + Überschriften-Reihenfolge behoben). 2026-07-14 |
| UI | Tastatur-Smoketest des kritischsten Flusses | ✅ `e2e/keyboard.test.js` (CI-Pflicht-Check, seit v2.3.3): kompletter Weg Demo-Foto → Disclaimer → Profil nur mit Tab + Enter, inkl. Prüfung sichtbarer Fokus-Markierung. Erstmals grün 2026-07-14 — damit dauerhaft automatisiert statt einmalig manuell |
| SERVICE_API | Request-/Upload-/Response-Grenzen, Rate Limits | ✅ Upload-/Größen-Limits + Magic-Byte-Check (`upload.js`), IP-Rate-Limit (`middleware.js`), Stundenlimit + Output-Bounds (`config.js`, `handle-*.js`) — durch Unit-Tests abgedeckt |
| SERVICE_API | Autorisierung fail-closed | ✅ Admin nur mit HMAC-Token + Nonce (`auth.js`, Tests); `processJob` nur via OIDC (Cloud Tasks) |
| DATA_ML_GENAI | LLM-Ausgaben schema-validiert, kein ungeprüftes Freitext-Parsing für Logik | ✅ JSON-Schema in Prompts + `json-repair.js` + Output-Clamps; LLM-Ausgaben steuern keine Tools/Folgeprozesse |
| DATA_ML_GENAI | Untrusted-Input-Annahme (Prompt Injection) | ✅ XML-Isolation + `escapeXml()` (SEC-003), Bounds (SEC-004) |
| DATA_ML_GENAI | Kosten-Grenzen | ✅ Stundenlimit 500 (Code-Gate) + GCP-Budget-Alarm (extern, siehe unten) |

## Externe Kontrollen (nicht aus dem Repo verifizierbar)

Diese Kontrollen existieren außerhalb des Repositories; ihr tatsächlicher Zustand
ist bei jedem Audit **extern** zu verifizieren (z. B. `gh api`), Stand hier nur
nachrichtlich (2026-07):

- Branch Protection auf `main` mit Pflicht-Checks `test-backend`, `test-frontend`, `test-e2e`, `secret-scan` (strict).
- Dependabot Security-Alerts **und Security-Updates** aktiviert (Letztere seit 2026-07-29 — vorher meldete Dependabot Lücken nur, ohne einen Reparatur-PR zu öffnen). Version-Updates monatlich und je Bereich gebündelt; Auto-Merge nur patch/minor.
- GCP-Budget-Alarm und ntfy-Fehleralarm (log-basiert, siehe [ERROR-ALERTING.md](ERROR-ALERTING.md)).

## Pflege

Ein Eintrag wird aktualisiert, wenn sein Nachweis durch eine Änderung ungültig wird
oder ein neuer Pflicht-Nachweis entsteht (z. B. neue Profilpflicht, behobenes
Audit-Finding). Die Rollback-Probe wird bei größeren Toolchain-Wechseln (Node-Major,
Test-Runner) wiederholt, nicht bei jedem Release.
