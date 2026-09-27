#!/usr/bin/env bash
# KA-04 (Kurzaudit 2026-08-12): Analyse-Logzeilen 30 Tage aufheben.
#
# Problem: Der Standard-Log-Speicher (_Default) hebt nur 1 Tag auf.
# Kinderschutz-Auswertung und KI-Dauer waeren damit am Folgetag weg.
#
# Loesung: Der bestehende 30-Tage-Speicher `client-diagnostics`
# (europe-west1, beschrieben als "Anonyme Client-Diagnose ... keine PII,
# keine IPs") bekommt zwei Server-Zeilen dazu — die zwei Eintraege je
# Analyse, die der Datenschutztext nennt (Abschnitt Kinderschutz-Auswertung):
#   - `step:"mistral-single-large"`: nur die Dauer (seit 26.09.2026; Modell,
#     Status und Token-Zahlen stehen in `mistral-single-large-details`,
#     1 Tag), hoechstens eine Zeile je Analyse, auch bei Nachfrage an die KI
#     (27.09.2026).
#   - `step:"minor-safety"` (seit 09.09.2026): geschaetztes Alter,
#     Filterentscheidung, Anzahl und Grund der Sperrwort-Treffer — seit
#     27.09.2026 ohne das getroffene Wort und ohne Feldnamen.
# Keine Kennung, keine IP, kein Bild, kein Satz aus dem Profil. Welche
# Felder erlaubt sind, haelt public/__tests__/fixtures/datenschutz-deckung.json
# fest; der Filter vergleicht `step` exakt, andere Zeilen bleiben draussen.
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
