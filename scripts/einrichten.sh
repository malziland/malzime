#!/bin/sh
# einrichten.sh — einmalig nach dem Klonen ausfuehren.
#
# BEFUND 31.08.2026 (Pruefrunde 3): Der Push-Riegel `scripts/hooks/pre-push`
# greift nur, wenn `core.hooksPath` gesetzt ist. Dieser Befehl stand
# ausschliesslich im Kopf der Hook-Datei selbst — also in der Datei, die ohne
# ihn gar nicht laeuft. Ein frischer Klon hatte den im CHANGELOG angekuendigten
# Riegel nicht, und nichts sagte, wie man ihn bekommt.
#
# Gemessen wurde das: Ohne core.hooksPath ging ein Push mit entwaffnetem
# deploy.sh durch (rc=0).
set -eu
cd "$(dirname "$0")/.."

echo "── malziME einrichten ──────────────────────────────"
echo

echo "1. Push-Riegel"
git config core.hooksPath scripts/hooks
IST=$(git config --get core.hooksPath || echo "")
if [ "$IST" = "scripts/hooks" ]; then
  echo "   ok   scripts/vor-dem-push.sh laeuft jetzt vor jedem Push."
  echo "        Notausgang im Einzelfall: OHNE_VORABPRUEFUNG=1 git push"
else
  echo "   FEHLER: core.hooksPath liess sich nicht setzen (ist: '$IST')."
  exit 1
fi
echo

echo "2. Werkzeuge"
for w in node npm python3 gh firebase gitleaks; do
  if command -v "$w" >/dev/null 2>&1; then
    echo "   ok   $w"
  else
    echo "   fehlt $w"
    case "$w" in
      gitleaks) echo "         -> brew install gitleaks (Pflicht-Check secret-scan)" ;;
      gh)       echo "         -> brew install gh (Stand-Bindung im Deploy)" ;;
      firebase) echo "         -> npm i -g firebase-tools (Auslieferung)" ;;
      *)        echo "         -> ohne dieses Werkzeug laeuft die Pruefkette nicht" ;;
    esac
  fi
done
echo
echo "Fertig. Naechster Schritt: sh scripts/vor-dem-push.sh"
