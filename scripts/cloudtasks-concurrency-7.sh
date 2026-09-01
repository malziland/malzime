#!/usr/bin/env bash
#
# GEAENDERT 30.08.2026 — die Rate war die Ursache haeufiger 429-Fehler.
#
# Bis dahin: --max-dispatches-per-second=3. Die Rechnung darunter stimmte fuer
# den DAUERBETRIEB (13 Anfragen/min = 0,22/s, unter dem Mistral-Limit von
# 0,25/s) — aber nicht fuer die SPITZE. Laedt eine Klasse gleichzeitig hoch,
# sind alle Plaetze auf einmal frei, und die Queue schickt drei Auftraege pro
# Sekunde los: sechs Mistral-Aufrufe in einer Sekunde. Mistral misst die
# Spitze, nicht den Durchschnitt.
#
# Gemessen am 30.08. gegen die Produktion: bei 30 gleichzeitigen Analysen
# scheiterte etwa jede zweite an HTTP 429.
#
# JETZT: 0,125 Auftraege/Sekunde = ein Auftrag alle 8 Sekunden.
#   0,125 x 2 Aufrufe je Analyse = 0,25 Aufrufe/s = genau das Mistral-Limit.
# Dazu Parallelitaet 4 statt 7, damit auch der erste Stoss nach einer
# Ruhephase klein bleibt (der Stoss-Wert selbst ist bei Cloud Tasks nicht
# direkt setzbar).
#
# STEIGT DIE MISTRAL-STUFE, darf beides hoch — aber erst nach einem Blick ins
# Dashboard, nicht nach Gefuehl.
#
# Historie: Concurrency 7, **65 s je Analyse** (Median, live gemessen 2026-08-10, n=21)
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
PARALLEL=4
RATE=0.125
gcloud tasks queues update analyze-queue \
  --location=europe-west1 \
  --project=malzime \
  --max-concurrent-dispatches="$PARALLEL" \
  --max-dispatches-per-second="$RATE"
echo "Gesetzt: Parallelitaet $PARALLEL, Rate $RATE/s (v2.8 — zwei Mistral-Aufrufe je Analyse)"
gcloud tasks queues describe analyze-queue \
  --location=europe-west1 --project=malzime \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,rateLimits.maxBurstSize)"
