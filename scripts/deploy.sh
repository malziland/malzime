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
  VERSION=$(printf "%s%02d" "$TODAY" "$((10#${CURRENT:8:2} + 1))")
else
  VERSION="${TODAY}01"
fi
echo "Cache-Busting-Version: ?v=$VERSION"

# Alle HTML-Dateien mit ?v= aktualisieren
for f in public/index.html public/datenschutz.html public/impressum.html public/nutzungsbedingungen.html public/stats.html; do
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

npx firebase deploy --only "$TARGET"

echo ""
echo "Deploy abgeschlossen. Version: ?v=$VERSION"
