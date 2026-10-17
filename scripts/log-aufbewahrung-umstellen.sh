#!/bin/sh
# Stellt die Aufbewahrung des Log-Speichers betrieb-eu (europe-west1) auf den
# Sollwert und misst danach nach.
#
# WARUM ES DIESES SKRIPT GIBT (16.10.2026): Die Datenschutzerklaerung nennt fuer
# das technische Protokoll eine Aufbewahrungsdauer, und scripts/verify-
# infrastructure.sh prueft sie vor jedem Deploy. Aendert sich die Dauer, muss
# die Einstellung bei Google am selben Tag mit dem Text live gehen. Der Riegel
# vor dem Deploy laesst erst durch, wenn die Einstellung steht — deshalb ist
# DIESES Skript der erste Schritt der Auslieferung, VOR deploy.sh
# (Reihenfolge: docs/RUNBOOK.md, „Logs und Aufbewahrung“).
#
# SCHREIBT BEI GOOGLE (nur mit --ausfuehren). Das ist eine Aenderung an einer
# fremden Oberflaeche und braucht eine ausdrueckliche Freigabe.
#
# Der Sollwert steht an EINER Stelle: LOG_AUFBEWAHRUNG_TAGE in
# scripts/verify-infrastructure.sh. Dieses Skript liest ihn von dort.
#
# Aufruf:
#   sh scripts/log-aufbewahrung-umstellen.sh               zeigt Ist und Soll, aendert nichts
#   sh scripts/log-aufbewahrung-umstellen.sh --ausfuehren  stellt um und misst nach
#
# Wiederholbar: Steht der Sollwert schon, aendert es nichts und endet mit 0.
# Rueckgabe: 0 = Sollwert steht (nachgemessen) · 1 = nach dem Umstellen
# weicht er ab · 2 = nicht messbar oder Voraussetzung fehlt.

set -u
cd "$(dirname "$0")/.." || exit 2

PROJECT="malzime"
SPEICHER="betrieb-eu"
ORT="europe-west1"

SOLL=$(sed -n 's/^LOG_AUFBEWAHRUNG_TAGE=\([0-9][0-9]*\)$/\1/p' scripts/verify-infrastructure.sh)
case "$SOLL" in
  '' | *[!0-9]*)
    echo "NICHT MESSBAR: LOG_AUFBEWAHRUNG_TAGE in scripts/verify-infrastructure.sh nicht lesbar."
    exit 2
    ;;
esac

if ! command -v gcloud >/dev/null 2>&1; then
  echo "FEHLT: gcloud nicht gefunden."
  exit 2
fi

ist() {
  gcloud logging buckets describe "$SPEICHER" --location="$ORT" --project="$PROJECT" \
    --format='value(retentionDays)' 2>/dev/null
}

IST=$(ist) || IST=""
case "$IST" in
  '' | *[!0-9]*)
    echo "NICHT MESSBAR: Aufbewahrung von $SPEICHER nicht lesbar (Anmeldung? gcloud auth login)."
    exit 2
    ;;
esac
echo "$SPEICHER ($ORT): Aufbewahrung IST $IST Tage, SOLL $SOLL Tage."

if [ "$IST" = "$SOLL" ]; then
  echo "Steht bereits — nichts zu tun."
  exit 0
fi

if [ "${1:-}" != "--ausfuehren" ]; then
  echo "Nur angezeigt. Umstellen mit: sh scripts/log-aufbewahrung-umstellen.sh --ausfuehren"
  exit 1
fi

echo "Stelle um auf $SOLL Tage ..."
if ! gcloud logging buckets update "$SPEICHER" --location="$ORT" --project="$PROJECT" \
  --retention-days="$SOLL" --quiet; then
  echo "FEHLER: gcloud hat die Umstellung abgelehnt — nichts geaendert (nachmessen mit diesem Skript ohne Schalter)."
  exit 1
fi

# Nachmessen an der Wirkung, nicht an der eigenen Ausgabe (KERN 10).
NACHHER=$(ist) || NACHHER=""
echo "Nachgemessen: Aufbewahrung $NACHHER Tage."
if [ "$NACHHER" = "$SOLL" ]; then
  echo "OK: $SPEICHER haelt jetzt $SOLL Tage."
  exit 0
fi
echo "ABWEICHUNG: erwartet $SOLL, gemessen ${NACHHER:-<leer>}."
exit 1
