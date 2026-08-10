#!/usr/bin/env bash
#
# Concurrency  7, **65 s je Analyse** (Median, live gemessen 2026-08-10, n=21)
#   -> ~6,5 Analysen/min -> ~13 Anfragen/min
#
# FRUEHER STAND HIER 56 s. Der Wert stammte aus der v2.2-Messung und wurde fuer
# v2.8 nie neu erhoben; der zweite Mistral-Aufruf kostet im Median 3,7 s (nicht
# "1-2 Sekunden"). Mit 65 s braucht eine 25er-Klasse ~3,9 statt der frueher
# zugesagten 3,3 Minuten.
#
# UNBELEGT: Die Zahl "mistral-large-2512 erlaubt 15 Anfragen/min" steht an
# mehreren Stellen als Tatsache, es gibt dafuer aber kein Messartefakt — und
# config.js nennt an anderer Stelle unveraendert "6 RPS" (Dashboard 2026-05-19).
# Vor der naechsten Dosierungs-Entscheidung einmal sauber messen.
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 7.
# PASSEND ZU v2.8 (Beast-Werbung im zweiten Aufruf).
#
# WARUM 7 UND NICHT 10:
# Seit v2.8 braucht jede Analyse ZWEI Mistral-Aufrufe (Bildanalyse + Werbung).
# mistral-large-2512 erlaubt 15 Anfragen pro Minute (am 2026-08-10 direkt an der
# API gemessen — die aeltere Notiz "6 Anfragen pro Sekunde" ist ueberholt).
#


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
# HINWEIS: --max-burst-size wurde 2026-08-10 entfernt — die aktuelle
# gcloud-CLI kennt den Parameter nicht mehr (Google leitet den Wert selbst
# ab, aktuell 10). Mit dem Parameter bricht das Script mit einem Fehler ab.
set -euo pipefail
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches=7 \
  --max-dispatches-per-second=3
echo "Concurrency: 7 (v2.8 — zwei Mistral-Aufrufe je Analyse)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
