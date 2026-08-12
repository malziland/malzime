#!/bin/sh
# pruefe-alles.sh — fuehrt alle Pruefungen der Familie gegen ein Projekt aus.
#
# Aufruf:  sh pruefe-alles.sh [projektverzeichnis]
# Exit 0 = alle sauber, Exit 1 = mindestens eine Pruefung hat Fundstellen.
#
# Fuer die Pipeline gedacht: Ein roter Lauf bricht ab. Das ist der Unterschied
# zwischen einer Regel und einer Kontrolle.

HIER=$(cd "$(dirname "$0")" && pwd)
ZIEL="${1:-.}"
FEHLER=0
UEBERSPRUNGEN=0

if ! command -v python3 >/dev/null 2>&1; then
  echo "FEHLER: python3 nicht gefunden. Die Pruefungen laufen nicht."
  echo "Das ist ein Fehlschlag, kein Hinweis: ungeprueft gilt als nicht bestanden."
  exit 1
fi

lauf() {
  echo ""
  echo "############################################################"
  python3 "$HIER/checks/$1" "$ZIEL"
  ERG=$?
  case "$ERG" in
    0) : ;;
    1) FEHLER=$((FEHLER + 1)) ;;
    *) UEBERSPRUNGEN=$((UEBERSPRUNGEN + 1)) ;;
  esac
}

echo "PRUEFUNGEN DER AUDIT-FAMILIE"
echo "Ziel: $(cd "$ZIEL" 2>/dev/null && pwd || echo "$ZIEL")"
echo "Stand: $(date '+%Y-%m-%d %H:%M:%S %Z')"

lauf fakten-drift.py
lauf stiller-fehlschlag.py
lauf aussentext.py
lauf test-blind.py

echo ""
echo "############################################################"
echo "ZUSAMMENFASSUNG"
echo "  Pruefungen mit Fundstellen: $FEHLER"
echo "  Pruefungen ohne Suchflaeche: $UEBERSPRUNGEN"
if [ "$UEBERSPRUNGEN" -gt 0 ]; then
  echo "  Achtung: Eine Pruefung ohne Suchflaeche ist kein bestandener Test."
  echo "  Entweder gibt es die geprueften Artefakte nicht, oder die Suche greift"
  echo "  nicht. Beides gehoert geklaert, nicht abgehakt."
fi
if [ "$FEHLER" -eq 0 ] && [ "$UEBERSPRUNGEN" -eq 0 ]; then
  echo "  ERGEBNIS: alle vier Pruefungen sauber."
  exit 0
fi
# TEST-2026-08-12-03: Eine Pruefung ohne Suchflaeche wurde bisher zwar
# angemahnt, der Lauf ging aber trotzdem mit 0 raus — die Warnung stand in einer
# Ausgabe, die niemand liest, solange das Ergebnis gruen ist. Jetzt entscheidet
# der Rueckgabewert mit: 1 = echte Fundstellen, 2 = Messung gescheitert.
# Fundstellen wiegen schwerer und gewinnen, wenn beides zutrifft.
[ "$FEHLER" -gt 0 ] && exit 1
exit 2
