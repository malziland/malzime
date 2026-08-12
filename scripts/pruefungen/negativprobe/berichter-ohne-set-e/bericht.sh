#!/bin/sh
# ERWARTUNG: keine Fundstelle. Kein set -e, aber das Skript sammelt Fehler und
# gibt am Ende einen eigenen Rueckgabewert zurueck. Mit set -e wuerde es beim
# ersten Fehlschlag abbrechen, statt alle Punkte zu zeigen.
FEHLER=0

pruefe_eins() { FEHLER=$((FEHLER + 1)); }
pruefe_zwei() { FEHLER=$((FEHLER + 1)); }

pruefe_eins
pruefe_zwei

if [ "$FEHLER" -eq 0 ]; then
  echo "alles in Ordnung"
  exit 0
fi
echo "$FEHLER Punkt(e) offen"
exit 1
