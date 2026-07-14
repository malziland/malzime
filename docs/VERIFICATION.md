# Verifikationsmatrix

Welche Qualitäts- und Sicherheitsanforderung ist wodurch **belegt** — nicht behauptet.
Jede Zeile nennt den Nachweisweg (Befehl bzw. CI-Job) und das letzte belastbare
Ergebnis mit Referenz (Commit, CI-Run, Datum). Audits nutzen diese Tabelle als
Einstieg; ein Datum allein ist keine Evidenz. Einträge mit Status **offen** sind
bewusst als offen ausgewiesen.

## Kernnachweise

| Anforderung | Nachweisweg | Letztes Ergebnis |
|---|---|---|
| Backend-Unit-Tests | CI-Job `test-backend` (jeder Push/PR); lokal `npm test --prefix functions` | ✅ 435/435 grün — CI-Run 29312808034 (PR #44 → Commit `9ef949d`), 2026-07-14 |
| Frontend-Unit-Tests | CI-Job `test-frontend`; lokal `npm run test:frontend` | ✅ 165/165 grün — CI-Run 29312808034, 2026-07-14 |
| E2E kritischster Nutzerfluss (Demo-Foto → Queue → Disclaimer → Profil) | CI-Job `test-e2e` (Playwright, Container-Image = Paketversion); lokal `npm run test:e2e` | ✅ 2/2 grün — CI-Run 29312808034, 2026-07-14 |
| Lint + Format (Backend & Frontend) | Teil der CI-Jobs `test-backend`/`test-frontend` (ESLint, Prettier `--check`) | ✅ sauber — CI-Run 29312808034, 2026-07-14 |
| Secret-Scan (inkl. voller Historie) | CI-Job `secret-scan` (gitleaks v3.0.0, SHA-gepinnt, `fetch-depth: 0`) | ✅ kein Fund — CI-Run 29312808034, 2026-07-14 |
| Dependency-Audit | CI-Job `test-backend`: `npm audit --omit=dev --audit-level=high` (Gate, bricht Build) | ✅ 0 Meldungen — Stand v2.3.1 (uuid-Override), CI-Run 29312808034, 2026-07-14 |
| Performance-/Qualitäts-Budget | CI-Job `lighthouse` gegen malzi.me, /datenschutz, /impressum mit Budget-Datei | ✅ pass — CI-Run 29312808034, 2026-07-14 |
| Reproduzierbares Setup (frischer Checkout) | `npm ci` (Root + `functions/`, Lockfiles committet, Node per `.nvmrc`/`engines`/CI gepinnt) | ✅ belegt durch Rollback-Probe (unten), 2026-07-14 |
| Reproduzierbarer Build | — entfällt: kein Build-Schritt (Vanilla-JS-Frontend wird direkt ausgeliefert, Functions deployen Quellcode) | n/a, Begründung links |
| **Rollback-Probe** (Release-Stand aus sich heraus lauffähig) | Release-Tag in temporärem `git worktree` auschecken, `npm ci` Root + functions, beide Test-Suiten | ✅ Tag `v2.3.1` (Commit `8d39a10`): Setup ok, 435/435 + 165/165 Tests grün, Exit 0 — 2026-07-14, Node 24, macOS; Worktree danach entfernt |
| Betriebs-Rollback ohne Deploy (Feature-Flags) | Firestore-Flags `useQueue`/`useSingleLargeCall`, Verfahren in [RUNBOOK.md](RUNBOOK.md) | ✅ produktiv erprobt (Architektur-Umstellungen v2.0/v2.2 liefen über genau diese Schalter) |

## Profilpflichten

| Profil | Pflicht | Status |
|---|---|---|
| UI | E2E-Test des kritischsten Nutzerflusses | ✅ `e2e/smoke.test.js` (CI-Pflicht-Check) |
| UI | Automatisierter Accessibility-Check dieses Flows | **offen** — geplant als Phase 3 der Governance-Nachrüstung (axe im Playwright-E2E) |
| UI | Dokumentierter manueller Tastatur-Smoketest | **offen** — bisher nicht dokumentiert durchgeführt |
| SERVICE_API | Request-/Upload-/Response-Grenzen, Rate Limits | ✅ Upload-/Größen-Limits + Magic-Byte-Check (`upload.js`), IP-Rate-Limit (`middleware.js`), Stundenlimit + Output-Bounds (`config.js`, `handle-*.js`) — durch Unit-Tests abgedeckt |
| SERVICE_API | Autorisierung fail-closed | ✅ Admin nur mit HMAC-Token + Nonce (`auth.js`, Tests); `processJob` nur via OIDC (Cloud Tasks) |
| DATA_ML_GENAI | LLM-Ausgaben schema-validiert, kein ungeprüftes Freitext-Parsing für Logik | ✅ JSON-Schema in Prompts + `json-repair.js` + Output-Clamps; LLM-Ausgaben steuern keine Tools/Folgeprozesse |
| DATA_ML_GENAI | Untrusted-Input-Annahme (Prompt Injection) | ✅ XML-Isolation + `escapeXml()` (SEC-003), Bounds (SEC-004) |
| DATA_ML_GENAI | Kosten-Grenzen | ✅ Stundenlimit 1500 (Code-Gate) + GCP-Budget-Alarm (extern, siehe unten) |

## Externe Kontrollen (nicht aus dem Repo verifizierbar)

Diese Kontrollen existieren außerhalb des Repositories; ihr tatsächlicher Zustand
ist bei jedem Audit **extern** zu verifizieren (z. B. `gh api`), Stand hier nur
nachrichtlich (2026-07):

- Branch Protection auf `main` mit Pflicht-Checks `test-backend`, `test-frontend`, `test-e2e`, `secret-scan` (strict).
- Dependabot Security-Alerts aktiviert (0 offene Alerts, Stand v2.3.1); Auto-Merge nur patch/minor.
- GCP-Budget-Alarm und ntfy-Fehleralarm (log-basiert, siehe [ERROR-ALERTING.md](ERROR-ALERTING.md)).

## Pflege

Ein Eintrag wird aktualisiert, wenn sein Nachweis durch eine Änderung ungültig wird
oder ein neuer Pflicht-Nachweis entsteht (z. B. neue Profilpflicht, behobenes
Audit-Finding). Die Rollback-Probe wird bei größeren Toolchain-Wechseln (Node-Major,
Test-Runner) wiederholt, nicht bei jedem Release.
