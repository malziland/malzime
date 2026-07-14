# ADR-0001: Grundentscheidungen und Governance-Standard

- **Status:** Akzeptiert
- **Datum:** 2026-07-14
- **Owner:** Christoph Krieger

## Kontext

malziME ist seit v1.x produktiv. Im Juli 2026 wurde die Betriebs- und
Governance-Dokumentation auf einen Familien-Standard nachgezogen (Bootstrap-,
Change- und Audit-Prompts mit Evidenz-Pflicht). Dieses ADR hält die bereits
gelebten Grundentscheidungen fest — nachträglich dokumentiert, nicht neu
getroffen — sowie die bewussten Abweichungen vom Standard.

## Entscheidungen

1. **Ausbaustufe: STANDARD.** Produktiv, öffentlich erreichbar, verarbeitet
   personenbezogene Daten (Fotos) transient. Kein ENTERPRISE: Solo-Projekt ohne
   Artefakt-Distribution an Dritte.
2. **Aktive Profile:** UI, SERVICE_API, Serverless/Managed (Firebase),
   DATA_ML_GENAI (Mistral), Open Source (MIT; Markenmaterial ausgenommen —
   `TRADEMARKS.md`, `public/img/brand/LICENSE.md`).
3. **Stack:** Firebase Hosting + Cloud Functions 2nd Gen (Node 24,
   `europe-west1`), Firestore, Cloud Tasks, Cloud Storage; Vanilla-JS-Frontend
   ohne Build-Schritt; KI ausschließlich Mistral AI (kein Google-/US-KI-Dienst).
4. **Versionierung:** SemVer-artige `vX.Y.Z` für die Anwendung. **Live-Deploy =
   Release:** der `[Unveröffentlicht]`-Abschnitt im CHANGELOG (Keep a Changelog)
   wird beim Deploy gestempelt; `release.yml` erzeugt daraus automatisch den
   GitHub-Release.
5. **Sprache: Deutsch** für Doku, Commits, UI und Reports — bewusste Abweichung
   vom Familien-Default Englisch (Solo-Betrieb, deutschsprachige Zielgruppe,
   gewachsene Repo-Konvention).
6. **Keine Pre-commit-Hooks** — bewusste Abweichung. Die verbindliche Grenze sind
   die CI-Pflicht-Checks (Tests, Lint, Format, gitleaks-Secret-Scan,
   npm-audit-Gate) plus Branch Protection; lokale Hooks würden das für einen
   Solo-Entwickler nur doppeln.
7. **Umgebungskapselung: Toolchain-Pinning statt Dev-Container.** Node 24 über
   `.nvmrc`, `engines` und CI; die Playwright-Version ist an den
   CI-Container-Tag gekoppelt (siehe Kommentar in `ci.yml`). Solo-Entwicklung auf
   macOS — ein Dev-Container brächte keinen Nutzen.
8. **Feature-Flags über Firestore** (`featureFlags/current`, 30-s-Cache,
   fail-safe `false`) statt Umgebungsvariablen. Grund: Umlegen ohne Deploy, auch
   vom Handy — zentrales Betriebssicherheits-Element. Register:
   [FLAGS.md](../FLAGS.md). Die Fallback-Pfade (synchroner `/analyze`,
   3-Call-Pipeline) bleiben bewusst im Code, bis der Inhaber ihren Abbau
   ausdrücklich freigibt („Phase 6").
9. **Release-Tags leichtgewichtig** (durch `release.yml`/GitHub-Releases erzeugt)
   — Abweichung von „annotierte Tags": die Metadaten (Notizen, Datum, Urheber)
   trägt der GitHub-Release. Akzeptiert.
10. **Kein SBOM, keine Build-Provenance:** es werden keine Artefakte an Dritte
    ausgeliefert (Web-App, direkt deployt). Bei Bedarf neu bewerten.
11. **Deploy-Governance:** Kein Deploy, Push auf `main`, Release oder Löschen
    ohne ausdrückliche Freigabe des Inhabers. Mit Freigabe läuft der dokumentierte
    Ablauf ([RUNBOOK.md](../RUNBOOK.md)) vollständig durch.

## Konsequenzen

- Audits finden ihre Gegenevidenz in `docs/` (RUNBOOK, FLAGS, SECURITY-MODEL,
  ADRs); die Verifikationsmatrix `docs/VERIFICATION.md` samt erster
  Rollback-Probe folgt als Phase 2 der Governance-Nachrüstung.
- Die Abweichungen 5, 6 und 9 sind bewusst und gelten nicht als Audit-Findings,
  solange die genannten Kompensationen (CI-Gate, Branch Protection,
  GitHub-Releases) bestehen.
- Neue Grundsatzentscheidungen werden als weitere ADRs unter `docs/adr/`
  festgehalten (fortlaufende Nummer, Kontext, Entscheidung, Konsequenzen).
