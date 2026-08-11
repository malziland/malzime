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

# ── Cache-Busting-Version generieren (Konvention: ?v=YYYYMMDDNN) ──
# Aktuellen Buster aus index.html lesen; am selben Tag laufende Nummer +1,
# sonst neuer Tag mit laufender Nummer 01.
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

# ── Deploy-Ziel bestimmen ──
TARGET="${1:-hosting,functions}"

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

echo ""
echo "Deploy abgeschlossen. Version: ?v=$VERSION"
