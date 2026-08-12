#!/bin/sh
# ERWARTUNG: keine Fundstelle. Die Zahl wird per grep geholt UND danach geprueft;
# ein leeres oder unplausibles Ergebnis bricht ab, statt gestempelt zu werden.
# Die Erfolgsmeldung am Ende steht bewusst drin: Genau sie loeste den Fehlalarm
# aus, weil die Regel ueber mehrere Zeilen bis zum naechsten Erfolgswort suchte
# und die Pruefung dazwischen nicht sah (bis 2026-08-12).
set -eu

LOG=$(cat testlauf.txt)
ANZAHL=$(printf "%s" "$LOG" | grep -Eo "Tests: [0-9]+ passed" | grep -Eo "[0-9]+" | head -1)

if ! echo "$ANZAHL" | grep -qE "^[0-9]+$" || [ "$ANZAHL" -eq 0 ]; then
  echo "ABBRUCH: Anzahl nicht lesbar — Ausgabeformat geaendert?"
  exit 1
fi

echo "Alle Suiten gruen: $ANZAHL — Stempel wird gesetzt."
