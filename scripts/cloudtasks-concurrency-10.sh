#!/usr/bin/env bash
#
# ACHTUNG — NICHT MEHR AKTUELL (Audit 2026-08-10):
# Seit v2.8 braucht jede Analyse ZWEI Mistral-Aufrufe. Mit Concurrency 10
# waeren das rund 22 Anfragen/min. Dieses Skript ist NUR noch zulaessig,
# nachdem der v2.8-Codestand zurueckgebaut wurde (siehe docs/RUNBOOK.md).
# Im Normalbetrieb gilt cloudtasks-concurrency-7.sh.
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 10.
# Passend zur SINGLE-LARGE-CALL-PIPELINE (1× Large 2512 macht alles).
# Large 2512 hat 2M TPM — bei Concurrency 10 sind wir bei ~30K Tokens × 12
# Jobs/min = 360K TPM = 18% Auslastung. Viel Puffer.
#
# Wechsel-Workflow:
#   1. featureFlags/current.useSingleLargeCall in Firestore auf true setzen
#   2. Warten ~30s, bis der Flag-Cache durch ist
#   3. Dieses Script ausführen
# HINWEIS: --max-burst-size wurde 2026-08-10 entfernt — die aktuelle
# gcloud-CLI kennt den Parameter nicht mehr (Google leitet den Wert selbst
# ab, aktuell 10). Mit dem Parameter bricht das Script mit einem Fehler ab.

# BEFUND 01.09.2026 (Runde 7, K-11): Diese Meldung nannte frueher eine Zahl,
# die im Skript gar nicht gesetzt wurde (Datei "7" setzte 4). Jetzt kommt sie
# aus denselben Variablen wie der Aufruf — auseinanderlaufen kann sie nicht
# mehr.
#
# WICHTIG, seit dem Umbau vom 30.08.2026: Die Anwendung zieht die Queue nach
# JEDER Aenderung des Einstellungssatzes selbst nach (index.js ruft
# warteschlangeNachziehen mit den Werten des Satzes). Ein hier gesetzter Wert
# haelt also nur, bis der Satz das naechste Mal geschrieben wird. Der Weg
# ueber den Einstellungssatz ist der richtige; dieses Skript ist der Notbehelf
# fuer den Fall, dass die Anwendung selbst nicht laeuft.
set -euo pipefail
PARALLEL=10
RATE=3
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches="$PARALLEL" \
  --max-dispatches-per-second="$RATE"
echo "Gesetzt: Parallelitaet $PARALLEL, Rate $RATE/s (Single-Large-Call-Pipeline, Large 2512)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"

echo ""
echo "WICHTIG: QUEUE_DISPATCH_CONCURRENCY in functions/src/config.js auf 10"
echo "anpassen + redeploy, damit die ETA-Anzeige im Frontend stimmt."
