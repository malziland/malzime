#!/usr/bin/env bash
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 3.
# Rollback-Hebel für den 3-Call-FALLBACK (Describe Large + 2× Profile Small
# 2603) — heute läuft live der Single-Large-Pfad mit Concurrency 10 (siehe
# docs/RUNBOOK.md, Hebel 3). 2603 hat 100K TPM — bei Concurrency 3 sind wir
# bei ~95% Auslastung. Höher gehen wäre im 3-Call-Betrieb risikobehaftet.
#
# Wechsel-Workflow:
#   1. featureFlags/current.useSingleLargeCall in Firestore auf false setzen
#   2. Dieses Script ausführen
#   3. Warten bis aktuelle Jobs durch sind
# HINWEIS: --max-burst-size wurde 2026-08-10 entfernt — die aktuelle
# gcloud-CLI kennt den Parameter nicht mehr (Google leitet den Wert selbst
# ab, aktuell 10). Mit dem Parameter bricht das Script mit einem Fehler ab.
set -euo pipefail
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches=3 \
  --max-dispatches-per-second=1
echo "Concurrency: 3 (3-Call-Pipeline, Small 2603)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
