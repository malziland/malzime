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
# Erweiterung 09.09.2026: Auch die Kinderschutz-Zeile `step:"minor-safety"`
# (geschaetztes Alter, Zaehler, Feldnamen, getroffenes Stichwort aus der
# festen Sperrliste) bleibt 30 Tage. Grund: Am 08./09.09. meldete der Filter
# bei 8 von 19 Analysen mit Minderjaehrigen einen Treffer im Fliesstext —
# ob das eine Quote oder ein Ausreisser ist, laesst sich mit einem Tag
# Aufbewahrung nicht sagen (die Abfrage fuer den 07.09. fand 0 Zeilen bei
# 18 Analysen). Kein Satz, kein Kontext, kein Personenbezug.
#
# Ausfuehren: einmalig nach Freigabe (kein Deploy noetig, wirkt sofort).
# Ruecknahme: denselben Befehl mit dem vorigen Filter erneut ausfuehren.
set -euo pipefail

PROJECT="malzime"
SINK="client-diagnostics-sink"
FILTER='jsonPayload.type="client-error" OR jsonPayload.type="client-telemetry" OR jsonPayload.step="mistral-single-large" OR jsonPayload.step="minor-safety"'

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
