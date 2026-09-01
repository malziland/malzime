#!/bin/sh
# secret-scan-lokal.sh — die lokale Entsprechung des Pflicht-Checks secret-scan.
#
# BEFUND 31.08.2026 (Pruefrunde 3): `vor-dem-push.sh` versprach im Kopf, "genau
# die BILLIGEN Pruefungen der Pipeline" abzufahren, und nannte als bewusst
# fehlend nur Backend- und E2E-Suite. `secret-scan` fehlte trotzdem — obwohl er
# Pflicht-Check ist und in Sekunden laeuft.
#
# Rueckgabewerte: 0 sauber · 1 Fund · 2 nicht messbar (gitleaks fehlt).
# 2 ist hier wichtig: Ein fehlendes Werkzeug darf nicht wie "kein Fund"
# aussehen.
set -u

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "NICHT MESSBAR: gitleaks ist nicht installiert."
  echo "  Die Pipeline fuehrt diesen Pflicht-Check trotzdem aus."
  echo "  Installation: brew install gitleaks"
  exit 2
fi

# Nur der Arbeitsstand, nicht die ganze Historie — die prueft die Pipeline mit
# fetch-depth 0. Hier geht es darum, einen Fund VOR dem Push zu bemerken.
# BEFUND beim ersten Lauf: `--no-git` scannt ALLE Dateien im Verzeichnis, auch
# nicht verfolgte und ignorierte — bei der ersten Probe meldete es drei Funde
# in `.claude/settings.local.json`, einer lokalen Datei, die gar nicht im
# Repository liegt. Die Pipeline scannt das Repository. Also hier auch.
if gitleaks detect --redact --exit-code 1 >/tmp/malzime-gitleaks.log 2>&1; then
  echo "kein Fund"
  exit 0
fi

echo "FUND: gitleaks meldet moegliche Geheimnisse."
sed 's/^/  /' /tmp/malzime-gitleaks.log | head -20
exit 1
