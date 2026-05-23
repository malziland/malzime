#!/usr/bin/env bash
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 3.
# Passend zur HEUTIGEN 3-Call-Pipeline (Describe Large + 2× Profile Small 2603).
# 2603 hat 100K TPM — bei Concurrency 3 sind wir bei ~95% Auslastung (siehe
# Memory). Höher gehen wäre risikobehaftet ohne Architektur-Wechsel.
#
# Wechsel-Workflow:
#   1. featureFlags/current.useSingleLargeCall in Firestore auf false setzen
#   2. Dieses Script ausführen
#   3. Warten bis aktuelle Jobs durch sind
set -euo pipefail
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches=3 \
  --max-dispatches-per-second=1 \
  --max-burst-size=10
echo "Concurrency: 3 (3-Call-Pipeline, Small 2603)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
