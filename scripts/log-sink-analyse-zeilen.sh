#!/usr/bin/env bash
# KA-04 (Kurzaudit 2026-08-12): Analyse-Logzeilen 30 Tage aufheben.
#
# Problem: Der Standard-Log-Speicher (_Default) hebt nur 1 Tag auf. Die
# Zeilen `step:"mistral-single-large"` (Dauer, Token-Zahlen, cachedTokens)
# sind damit am Folgetag weg — die geplanten September-Messungen
# (Prompt-Caching-Trefferquote unter Last, HEIC-Formatanteile) waeren
# unmoeglich.
#
# Loesung: Der bestehende 30-Tage-Speicher `client-diagnostics`
# (europe-west1, beschrieben als "Anonyme Client-Diagnose ... keine PII,
# keine IPs") bekommt diese Zeilen dazu. Sie enthalten Schritt-Name, Dauer
# und Token-Zahlen — keine IP, kein Bild, nichts Personenbezogenes. Die
# 30-Tage-Zusage der Datenschutzerklaerung ("vollstaendig anonyme
# Diagnose-Daten ohne Personenbezug ... bis zu 30 Tage") deckt sie ab.
#
# Ausfuehren: einmalig nach Freigabe (kein Deploy noetig, wirkt sofort).
# Ruecknahme: denselben Befehl mit dem alten Filter (nur die zwei
# client-*-Typen) erneut ausfuehren.
set -euo pipefail

PROJECT="malzime"
SINK="client-diagnostics-sink"
FILTER='jsonPayload.type="client-error" OR jsonPayload.type="client-telemetry" OR jsonPayload.step="mistral-single-large"'

echo "Erweitere Filter von ${SINK} (Projekt ${PROJECT}) ..."
gcloud logging sinks update "${SINK}" \
  --project="${PROJECT}" \
  --log-filter="${FILTER}"

echo
echo "Kontrolle — aktiver Filter:"
gcloud logging sinks describe "${SINK}" --project="${PROJECT}" --format='value(filter)'
echo
echo "Fertig. Nachweis nach der naechsten echten Analyse:"
echo "  gcloud logging read 'jsonPayload.step=\"mistral-single-large\"' \\"
echo "    --project=${PROJECT} --bucket=client-diagnostics --location=europe-west1 \\"
echo "    --view=_AllLogs --limit=3 --freshness=1d"
