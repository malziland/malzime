#!/usr/bin/env bash
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 10.
# Passend zur SINGLE-LARGE-CALL-PIPELINE (1× Large 2512 macht alles).
# Large 2512 hat 2M TPM — bei Concurrency 10 sind wir bei ~30K Tokens × 12
# Jobs/min = 360K TPM = 18% Auslastung. Viel Puffer.
#
# Wechsel-Workflow:
#   1. featureFlags/current.useSingleLargeCall in Firestore auf true setzen
#   2. Warten ~30s, bis der Flag-Cache durch ist
#   3. Dieses Script ausführen
set -euo pipefail
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches=10 \
  --max-dispatches-per-second=3 \
  --max-burst-size=20
echo "Concurrency: 10 (Single-Large-Call-Pipeline, Large 2512)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"

echo ""
echo "WICHTIG: QUEUE_DISPATCH_CONCURRENCY in functions/src/config.js auf 10"
echo "anpassen + redeploy, damit die ETA-Anzeige im Frontend stimmt."
