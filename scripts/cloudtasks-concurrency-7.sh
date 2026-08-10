#!/usr/bin/env bash
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 7.
# PASSEND ZU v2.8 (Beast-Werbung im zweiten Aufruf).
#
# WARUM 7 UND NICHT 10:
# Seit v2.8 braucht jede Analyse ZWEI Mistral-Aufrufe (Bildanalyse + Werbung).
# mistral-large-2512 erlaubt 15 Anfragen pro Minute (am 2026-08-10 direkt an der
# API gemessen — die aeltere Notiz "6 Anfragen pro Sekunde" ist ueberholt).
#
#   Concurrency 10, 56 s je Analyse -> ~11 Analysen/min -> 22 Anfragen/min  ZU VIEL
#   Concurrency  7, 56 s je Analyse -> ~7,5 Analysen/min -> 15 Anfragen/min  passt
#
# Folge fuer den Workshop: Eine Klasse mit 25 Schuelern ist nach rund 3,3 statt
# 2,7 Minuten durch.
#
# ZURUECK AUF EINEN AUFRUF (Rollback von v2.8):
#   Erst den Code zurueckrollen, dann scripts/cloudtasks-concurrency-10.sh
#   ausfuehren — sonst laeuft die Queue unnoetig langsam.
#
# max-dispatches-per-second bleibt bei 3. Der Wert ist heute wirkungslos, weil
# die Concurrency vorher greift; er wuerde erst bei deutlich hoeherer
# Parallelitaet relevant. Siehe docs/RUNBOOK.md.
set -euo pipefail
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches=7 \
  --max-dispatches-per-second=3 \
  --max-burst-size=20
echo "Concurrency: 7 (v2.8 — zwei Mistral-Aufrufe je Analyse)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
