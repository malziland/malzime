#!/usr/bin/env bash
# malziME Deploy-Script
# Fuehrt Lint + Unit-Tests aus, aktualisiert Cache-Busting-Versionen
# (Konvention ?v=YYYYMMDDNN) und deployed auf Firebase.
#
# Nutzung:
#   ./scripts/deploy.sh              # Hosting + Functions
#   ./scripts/deploy.sh hosting      # Nur Hosting
#   ./scripts/deploy.sh functions    # Nur Functions
#
#   SKIP_TESTS=1 ./scripts/deploy.sh # Test-Guard ueberspringen (nur im Notfall!)

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Einmaliges Infra-Setup (NICHT Teil des regulaeren Deploys) ──
# Die GCS-Lifecycle-Regel, die zwischengespeicherte Bilder als Sicherheitsnetz
# nach 1 Tag loescht, wird von `firebase deploy` NICHT mit ausgerollt. Sie muss
# beim ersten Setup (oder einem Bucket-Neuaufbau) EINMAL gesetzt werden:
#   gsutil lifecycle set storage-lifecycle.json gs://malzime-queue-uploads
# Pruefen:  gsutil lifecycle get gs://malzime-queue-uploads
# (Stand 2026-06-06 verifiziert: Regel am Produktiv-Bucket aktiv.)

# ── Test-Guard: Lint + Unit-Tests muessen gruen sein (Deploy-Konvention) ──
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_TESTS=1 gesetzt — Lint und Tests werden UEBERSPRUNGEN."
else
  npm run lint
  npm test --prefix functions
  npm run test:frontend
fi

# ── OPS-2026-08-12-25: Riegel gegen ein unbekanntes Auslieferungswerkzeug ──
# Die Firebase-CLI ist global installiert und war an keine Version gebunden:
# Ein beilaeufiges `npm i -g firebase-tools` haette den Deploy-Weg still
# veraendert, ohne dass irgendwo etwas rot wird — und nirgends stand, mit
# welcher Version je ausgeliefert wurde.
#
# Bewusst NICHT nach package.json verschoben: `npx firebase` scheitert, wenn
# firebase-tools nicht im Projekt liegt (Begruendung weiter unten), und ein
# Werkzeug dieser Groesse im Abhaengigkeitsbaum waere der schlechtere Tausch.
# Stattdessen: gemessen, protokolliert, mit Untergrenze.
#
# Untergrenze anheben, wenn ein Deploy eine neuere Version tatsaechlich
# gebraucht hat — nicht auf Verdacht. Diese Zeile ist die einzige Quelle
# dieser Zahl; die Doku verweist hierher.
FIREBASE_MIN="15.1.0"
if [ "${SKIP_CLI_CHECK:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_CLI_CHECK=1 gesetzt — Versionspruefung der CLI wird UEBERSPRUNGEN."
else
  FIREBASE_IST="$(firebase --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  # Fail-closed: Eine nicht ermittelbare Version ist ausdruecklich kein
  # bestandener Riegel. Leer ist zuerst ein Verdacht gegen die Messung.
  if [ -z "$FIREBASE_IST" ]; then
    echo "FEHLER: Version der Firebase-CLI nicht ermittelbar (\`firebase --version\` lieferte nichts)." >&2
    echo "        Ohne bekanntes Werkzeug kein Deploy. Notschalter: SKIP_CLI_CHECK=1" >&2
    exit 1
  fi
  if [ "$(printf '%s\n%s\n' "$FIREBASE_MIN" "$FIREBASE_IST" | sort -V | head -1)" != "$FIREBASE_MIN" ]; then
    echo "FEHLER: Firebase-CLI $FIREBASE_IST ist aelter als die Untergrenze $FIREBASE_MIN." >&2
    echo "        Aktualisieren mit: npm i -g firebase-tools" >&2
    exit 1
  fi
  echo "Firebase-CLI: $FIREBASE_IST (Untergrenze $FIREBASE_MIN)"
fi

# ── Infra-Riegel: Ist-Zustand der Cloud gegen den RUNBOOK-Soll-Zustand ──
# Nur lesend (Queue, Bucket, Firestore, Worker-IAM, Regionen, Logging).
# Notschalter fuer den Ernstfall (z. B. gcloud-Anmeldung abgelaufen und ein
# dringender Rollback darf nicht warten): SKIP_INFRA=1
if [ "${SKIP_INFRA:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_INFRA=1 gesetzt — Infrastruktur-Pruefung wird UEBERSPRUNGEN."
else
  ./scripts/verify-infrastructure.sh
fi

# ── Deploy-Ziel bestimmen ──
# KURZAUDIT-Befund OPS-2026-08-13-34: Das Ziel muss VOR dem Buster-Block
# feststehen. Vorher lief der Buster bei jedem Aufruf — ein reiner
# Functions-Deploy veraenderte sechs Hosting-Dateien, die dann unausgeliefert
# im Arbeitsbaum lagen. Rutscht so etwas in einen Commit, behauptet das
# Repository einen Buster-Stand, der nie online war.
TARGET="${1:-hosting,functions}"

# ── Cache-Busting-Version generieren (Konvention: ?v=YYYYMMDDNN) ──
# Aktuellen Buster aus index.html lesen; am selben Tag laufende Nummer +1,
# sonst neuer Tag mit laufender Nummer 01. NUR wenn Hosting wirklich
# ausgeliefert wird — der Buster gehoert zur Auslieferung der Seiten, nicht
# zum Aufruf des Skripts.
VERSION="(kein Hosting-Deploy — Buster unveraendert)"
if [[ ",$TARGET," == *",hosting,"* ]]; then
TODAY=$(date +"%Y%m%d")
CURRENT=$(grep -o 'styles\.css?v=[0-9]*' public/index.html | head -1 | grep -o '[0-9]*$' || true)
if [ "${#CURRENT}" -eq 10 ] && [ "${CURRENT:0:8}" = "$TODAY" ]; then
  NEXT=$((10#${CURRENT:8:2} + 1))
  if [ "$NEXT" -gt 99 ]; then
    echo "FEHLER: 99 Hosting-Deploys heute erreicht — die 2-stellige Buster-Nummer läuft über." >&2
    echo "Das ist praktisch nie ein echter Fall; falls doch, Konvention manuell erweitern." >&2
    exit 1
  fi
  VERSION=$(printf "%s%02d" "$TODAY" "$NEXT")
else
  VERSION="${TODAY}01"
fi
echo "Cache-Busting-Version: ?v=$VERSION"

# Alle Dateien mit ?v=-Verweisen aktualisieren: die fuenf HTML-Seiten UND
# public/js/demo.js — dort haengen die Buster der grossen Demo-Bilder.
# demo.js fehlte hier bis zum Kurzaudit 2026-08-11 (OPS-106): Sein Buster
# blieb drei Deploys lang auf einem alten Stand stehen.
for f in public/index.html public/datenschutz.html public/impressum.html public/nutzungsbedingungen.html public/stats.html public/js/demo.js; do
  if [ -f "$f" ]; then
    # BUG-009: Cross-platform sed (macOS + Linux)
    if sed --version >/dev/null 2>&1; then
      sed -i "s/\?v=[0-9]*/\?v=$VERSION/g" "$f"
    else
      sed -i '' "s/\?v=[0-9]*/\?v=$VERSION/g" "$f"
    fi
    echo "  $f aktualisiert"
  fi
done
fi

echo ""
echo "Deploy-Ziel: $TARGET"
echo "Weiter? (Enter = ja, Ctrl+C = abbrechen)"
read -r

# Global installierte CLI bevorzugen. `npx firebase` scheitert, wenn firebase-tools
# nicht im Projekt liegt: npm versucht dann einen Registry-Abruf und bricht mit
# "could not determine executable to run" ab. Genau daran ist das Skript zuletzt
# gescheitert — vermutlich der eigentliche Grund, warum es seit dem 2026-07-29
# nicht mehr benutzt wurde und die Deploys stattdessen von Hand liefen
# (Audit 2026-08-10, OPS-001).
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only "$TARGET"
else
  npx firebase deploy --only "$TARGET"
fi

# ── Live-Beweis: vier kostenfreie Proben gegen die frisch deployte Produktion ──
# (endet vor KI-Aufruf und Stundenzähler; Notschalter SKIP_SMOKE=1)
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_SMOKE=1 gesetzt — Live-Smoke wird UEBERSPRUNGEN."
else
  ./scripts/live-smoke.sh
fi

echo ""
echo "Deploy abgeschlossen. Version: ?v=$VERSION"
