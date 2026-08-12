#!/bin/sh
# selbstpruefung.sh — prueft die Pruefungen selbst.
#
# Jede Pruefung muss zweierlei koennen: bei kaputtem Material rot werden UND bei
# sauberem Material gruen. Nur das erste zu testen ist der Fehler, der in der
# Familie schon einmal passiert ist: Ein Abgabe-Check wurde gegen einen
# unvollstaendigen Bericht getestet, wurde korrekt rot, und liess trotzdem
# Stichwortsalat durch. Getestet war nur eine Richtung.
#
# Aufruf: sh selbstpruefung.sh
# Exit 0 = alle Pruefungen verhalten sich in beide Richtungen richtig.

HIER=$(cd "$(dirname "$0")" && pwd)
KAPUTT="$HIER/negativprobe/kaputt"
SAUBER="$HIER/negativprobe/sauber"
FEHLER=0

lauf() {
  # $1 = Skriptname, $2 = Verzeichnis, $3 = erwarteter Exit, $4 = Beschreibung
  python3 "$HIER/checks/$1" "$2" > /tmp/selbstpruefung.out 2>&1
  IST=$?
  if [ "$IST" -eq "$3" ]; then
    echo "  ja    $4 (Exit $IST wie erwartet)"
  else
    echo "  NEIN  $4 (Exit $IST, erwartet $3)"
    sed 's/^/          /' /tmp/selbstpruefung.out | tail -8
    FEHLER=$((FEHLER + 1))
  fi
}

echo "SELBSTPRUEFUNG DER PRUEFUNGEN"
echo "============================================================"
echo "Richtung 1: kaputtes Material MUSS rot werden (Exit 1)"
lauf fakten-drift.py       "$KAPUTT" 1 "fakten-drift findet den Zahlen-Drift"
lauf stiller-fehlschlag.py "$KAPUTT" 1 "stiller-fehlschlag findet die Erfolgsluege"
lauf aussentext.py         "$KAPUTT" 1 "aussentext findet die verbotene Zusage"
lauf test-blind.py         "$KAPUTT" 1 "test-blind findet die blinden Tests"

echo ""
echo "Richtung 2: sauberes Material MUSS gruen bleiben (Exit 0)"
lauf fakten-drift.py       "$SAUBER" 0 "fakten-drift meldet nichts"
lauf stiller-fehlschlag.py "$SAUBER" 0 "stiller-fehlschlag meldet nichts"
lauf aussentext.py         "$SAUBER" 0 "aussentext meldet nichts"
lauf test-blind.py         "$SAUBER" 0 "test-blind meldet nichts"

echo ""
echo "Richtung 3: die Pruefung darf nicht still schwaecher werden (2026-08-12)"
lauf aussentext.py "$HIER/negativprobe/regeln-kaputt" 2 \
  "nicht kompilierbare Regel bricht ab (Exit 2), statt sie zu ueberspringen"
lauf aussentext.py "$HIER/negativprobe/regeln-mit-oder" 1 \
  "Regel mit | im Ausdruck laedt und schlaegt an (Trennung von rechts)"
lauf stiller-fehlschlag.py "$HIER/negativprobe/nur-ausgeschlossenes" 2 \
  "negativprobe/ wird uebersprungen, uebrig bleibt keine Suchflaeche"
lauf aussentext.py "$HIER/negativprobe/regeln-prosa-pipe" 2 \
  "| in der Begruendung wird erkannt, statt das Suchmuster still zu erweitern"

echo "============================================================"
if [ "$FEHLER" -eq 0 ]; then
  echo "ERGEBNIS: alle zwoelf Proben bestanden."
  echo "Die Pruefungen koennen rot werden und sind nicht ueberempfindlich."
  exit 0
fi
echo "ERGEBNIS: $FEHLER Probe(n) fehlgeschlagen."
echo "Eine Pruefung, die hier durchfaellt, ist selbst der Befund."
exit 1
