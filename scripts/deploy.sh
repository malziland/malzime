#!/usr/bin/env bash
# malziME Deploy-Script
# Aktualisiert Cache-Busting-Versionen und deployed auf Firebase.
#
# Nutzung:
#   ./scripts/deploy.sh              # Hosting + Functions
#   ./scripts/deploy.sh hosting      # Nur Hosting
#   ./scripts/deploy.sh functions    # Nur Functions

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Einmaliges Infra-Setup (NICHT Teil des regulaeren Deploys) ──
# Die GCS-Lifecycle-Regel, die zwischengespeicherte Bilder als Sicherheitsnetz
# nach 1 Tag loescht, wird von `firebase deploy` NICHT mit ausgerollt. Sie muss
# beim ersten Setup (oder einem Bucket-Neuaufbau) EINMAL gesetzt werden:
#   gsutil lifecycle set storage-lifecycle.json gs://malzime-queue-uploads
# Pruefen:  gsutil lifecycle get gs://malzime-queue-uploads
# (Stand 2026-06-06 verifiziert: Regel am Produktiv-Bucket aktiv.)

# ── Cache-Busting-Version generieren (sekundengenau, eindeutig pro Deploy) ──
VERSION=$(date +"%Y%m%d%H%M%S")
echo "Cache-Busting-Version: ?v=$VERSION"

# Alle HTML-Dateien mit ?v= aktualisieren
for f in public/index.html public/datenschutz.html public/impressum.html public/stats.html; do
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
