#!/usr/bin/env bash
# Setzt die Cloud-Tasks-Queue `analyze-queue` auf Concurrency 3.
# Rollback-Hebel für den 3-Call-FALLBACK (Describe Large + 2× Profile Small
# 2603) — heute laeuft live der Single-Large-Pfad mit Concurrency 7 (siehe
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
PARALLEL=3
RATE=1
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches="$PARALLEL" \
  --max-dispatches-per-second="$RATE"
echo "Gesetzt: Parallelitaet $PARALLEL, Rate $RATE/s (3-Call-Pipeline, Small 2603)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
