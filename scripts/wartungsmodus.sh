#!/usr/bin/env bash
# wartungsmodus.sh — schaltet den Wartungsmodus auf malzi.me ein oder aus.
#
# ANLASS (01.09.2026): Das Betriebshandbuch nennt den Wartungsmodus als
# Hebel 1 fuer eine kontrollierte Vollbremsung — aber es gab kein Werkzeug
# dafuer, und die Anleitung dazu war falsch (siehe unten). Wer ihn brauchte,
# musste ihn von Hand nachbauen, ausgerechnet in dem Moment, in dem es schnell
# gehen muss.
#
# Was dieses Skript tut:
#   1. Admin-Secret aus dem Secret Manager holen
#   2. POST auf /api/admin/maintenance mit Bearer-Auth -> schaltet
#   3. NACHMESSEN: /api/stats muss den neuen Zustand melden
#
# Schritt 3 ist der wichtige: Ohne ihn waere "geschaltet" eine Behauptung. Der
# Zwischenspeicher braucht bis zu 30 Sekunden, und genau in dieser Spanne
# wuerde man sonst weiterarbeiten, obwohl noch Analysen hereinkommen.
#
# Aufruf:  sh scripts/wartungsmodus.sh ein "Text fuer die Besucher"
#          sh scripts/wartungsmodus.sh aus
set -euo pipefail

BASIS="${MALZIME_BASIS:-https://malzi.me}"
AKTION="${1:-}"
TEXT="${2:-Wir spielen gerade eine neue Fassung ein. In wenigen Minuten geht es weiter.}"

case "$AKTION" in
  ein) ENABLED=true ;;
  aus) ENABLED=false; TEXT="" ;;
  *) echo "Aufruf: sh $0 ein|aus [Text]" >&2; exit 2 ;;
esac

echo "── Wartungsmodus $AKTION ($BASIS) ──"

SECRET="$(gcloud secrets versions access latest --secret=ADMIN_SECRET --project=malzime 2>/dev/null)"
if [ -z "$SECRET" ]; then
  echo "ABBRUCH: ADMIN_SECRET nicht lesbar. Angemeldet? (gcloud auth login)" >&2
  exit 2
fi

# BEFUND 01.09.2026: docs/RUNBOOK.md beschrieb hier den zweistufigen HMAC-Weg
# mit Bestaetigungsseite und Nonce. Den gibt es fuer den Wartungsmodus NICHT —
# handle-admin.js schliesst ihn ausdruecklich aus (`action !== "maintenance"`)
# und antwortet mit `403 Maintenance requires Bearer auth`. Fuer `boost` und
# `reset` stimmt der HMAC-Weg weiterhin; falsch beschrieben war ausgerechnet
# der Hebel, der am schnellsten greifen muss. Das Handbuch ist im selben
# Schritt berichtigt.
echo "— Schalten (Bearer-Auth)"
ANTWORT="$(curl -s --max-time 20 -X POST "$BASIS/api/admin/maintenance" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"enabled\":$ENABLED,\"message\":\"$TEXT\"}")"
printf '  %s\n' "$(printf '%s' "$ANTWORT" | head -c 200)"

echo "— Nachmessen (Zwischenspeicher, bis zu 35 s)"
for i in 1 2 3 4 5 6 7; do
  sleep 5
  IST="$(curl -s --max-time 10 "$BASIS/api/stats" | grep -oE '"enabled":(true|false)' | head -1 | cut -d: -f2)"
  if [ "$IST" = "$ENABLED" ]; then
    echo "  BESTAETIGT: maintenance.enabled = $IST"
    exit 0
  fi
  echo "  noch $IST, warte…"
done

echo "ABBRUCH: Der Zustand hat sich nach 35 s nicht geaendert (ist: ${IST:-unbekannt})." >&2
echo "         NICHT weitermachen — erst pruefen, was los ist." >&2
exit 1
