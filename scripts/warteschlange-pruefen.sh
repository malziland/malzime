#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# warteschlange-pruefen.sh — Stimmt die Einstellung mit der echten Bremse ueberein?
#
# WOZU: Zwei Werte aus dem Einstellungssatz steuern die Cloud-Tasks-Queue:
#
#   parallelitaet        -> maxConcurrentDispatches   (wie viele gleichzeitig)
#   queueRatePerSekunde  -> maxDispatchesPerSecond    (wie schnell losgeschickt)
#
# Die `satzWache` uebertraegt sie bei jeder Aenderung. Dieses Skript prueft, ob
# das tatsaechlich passiert ist — denn zwischen "im Firestore steht X" und "die
# Queue tut X" liegt ein Netzaufruf, der scheitern kann.
#
# WARUM DAS EIN EIGENES SKRIPT IST: Die Meldung der Wache geht einmal raus.
# Wer spaeter wissen will, ob es noch stimmt, braucht eine Messung, keine
# Erinnerung an eine Meldung.
#
# AUFRUF:
#   ./scripts/warteschlange-pruefen.sh            nur pruefen und melden
#   ./scripts/warteschlange-pruefen.sh --setzen   bei Abweichung nachziehen
#
# RUECKGABE: 0 = stimmt ueberein, 1 = weicht ab, 2 = nicht messbar.
# ---------------------------------------------------------------------------
set -uo pipefail

PROJEKT="malzime"
REGION="europe-west1"
QUEUE="analyze-queue"
DATENBANK="malzime-eu"
SETZEN=0
[ "${1:-}" = "--setzen" ] && SETZEN=1

WURZEL="$(cd "$(dirname "$0")/.." && pwd)"

echo "── Warteschlange gegen Einstellungssatz pruefen ──"
echo

# ── 1. Was steht im Einstellungssatz? ──────────────────────────────────────
# Aus functions/ heraus, weil dort das Firestore-Paket liegt.
SOLL="$(cd "$WURZEL/functions" && node -e '
const { Firestore } = require("@google-cloud/firestore");
new Firestore({ projectId: "'"$PROJEKT"'", databaseId: "'"$DATENBANK"'" })
  .doc("config/betriebsprofil").get()
  .then((s) => {
    const d = s.data();
    if (!d || !d.aktiv) { console.log("FEHLER kein-satz"); process.exit(0); }
    const p = (d.profile || {})[d.aktiv];
    if (!p) { console.log("FEHLER satz-" + d.aktiv + "-fehlt"); process.exit(0); }
    /* Fehlt das Feld, wird das NICHT als 0 durchgereicht — sonst prueft man
       gegen einen erfundenen Wert. */
    if (p.queueRatePerSekunde === undefined || p.parallelitaet === undefined) {
      console.log("FEHLER feld-fehlt"); process.exit(0);
    }
    console.log(d.aktiv + " " + p.parallelitaet + " " + p.queueRatePerSekunde);
    process.exit(0);
  })
  .catch((e) => { console.log("FEHLER " + String(e.message).slice(0, 40)); process.exit(0); });
' 2>/dev/null)"

if [ -z "$SOLL" ] || [[ "$SOLL" == FEHLER* ]]; then
  echo "  NICHT MESSBAR: Einstellungssatz nicht lesbar (${SOLL:-keine Antwort})"
  exit 2
fi

SATZ="$(echo "$SOLL" | awk '{print $1}')"
SOLL_PARALLEL="$(echo "$SOLL" | awk '{print $2}')"
SOLL_RATE="$(echo "$SOLL" | awk '{print $3}')"

echo "  Einstellungssatz \"$SATZ\" sagt:"
echo "    gleichzeitig     $SOLL_PARALLEL"
echo "    pro Sekunde      $SOLL_RATE"
echo

# ── 2. Was tut die Queue wirklich? ─────────────────────────────────────────
IST="$(gcloud tasks queues describe "$QUEUE" \
  --location="$REGION" --project="$PROJEKT" \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond,state)" 2>/dev/null)"

if [ -z "$IST" ]; then
  echo "  NICHT MESSBAR: Queue nicht abfragbar (angemeldet? gcloud auth login)"
  exit 2
fi

IST_PARALLEL="$(echo "$IST" | awk '{print $1}')"
IST_RATE="$(echo "$IST" | awk '{print $2}')"
IST_STAND="$(echo "$IST" | awk '{print $3}')"

echo "  Die echte Warteschlange tut:"
echo "    gleichzeitig     $IST_PARALLEL"
echo "    pro Sekunde      $IST_RATE"
echo "    Zustand          $IST_STAND"
echo

# ── 3. Vergleichen ─────────────────────────────────────────────────────────
# Zahlenvergleich statt Textvergleich: "0.125" und "0.1250" sind dieselbe Rate.
GLEICH="$(awk -v a="$SOLL_PARALLEL" -v b="$IST_PARALLEL" -v c="$SOLL_RATE" -v d="$IST_RATE" \
  'BEGIN { print (a+0 == b+0 && (c-d < 0.0001 && d-c < 0.0001)) ? "ja" : "nein" }')"

if [ "$GLEICH" = "ja" ]; then
  echo "  ERGEBNIS: Einstellung und Warteschlange stimmen ueberein."
  if [ "$IST_STAND" != "RUNNING" ]; then
    echo "  ABER: Die Queue ist im Zustand $IST_STAND, nicht RUNNING —"
    echo "        angehaltene Auftraege werden nicht zugestellt."
    exit 1
  fi
  exit 0
fi

echo "  ERGEBNIS: ABWEICHUNG. Was du eingestellt hast, laeuft NICHT."
echo
echo "    Soll (Firestore):  $SOLL_PARALLEL gleichzeitig, $SOLL_RATE/s"
echo "    Ist  (Queue):      $IST_PARALLEL gleichzeitig, $IST_RATE/s"
echo

if [ "$SETZEN" -eq 0 ]; then
  echo "  ZUM NACHZIEHEN:  ./scripts/warteschlange-pruefen.sh --setzen"
  echo "  ODER:            den Wert im Firestore noch einmal speichern —"
  echo "                   das loest einen neuen Versuch der satzWache aus."
  exit 1
fi

echo "  Ziehe nach ..."
# Die Ausgabe wird AUFGEFANGEN, nicht verworfen: Bei einem Fehlschlag ist
# Googles Meldung das Einzige, was den Grund nennt (fehlende Berechtigung,
# abgelaufene Anmeldung, falsches Projekt). Sie nur bei Bedarf zeigen.
MELDUNG="$(gcloud tasks queues update "$QUEUE" \
  --location="$REGION" --project="$PROJEKT" \
  --max-concurrent-dispatches="$SOLL_PARALLEL" \
  --max-dispatches-per-second="$SOLL_RATE" 2>&1)"
SETZ_CODE=$?
if [ "$SETZ_CODE" -ne 0 ]; then
  echo "  Der Befehl meldete einen Fehler (Code $SETZ_CODE):"
  echo "$MELDUNG" | sed 's/^/    /' | head -6
  echo "  Ich messe trotzdem nach — vielleicht hat er teilweise gewirkt."
fi

# NACHMESSEN statt annehmen — ein stiller Fehlschlag waere hier das Schlimmste.
NACHHER="$(gcloud tasks queues describe "$QUEUE" \
  --location="$REGION" --project="$PROJEKT" \
  --format="value(rateLimits.maxConcurrentDispatches,rateLimits.maxDispatchesPerSecond)" 2>/dev/null)"
N_PARALLEL="$(echo "$NACHHER" | awk '{print $1}')"
N_RATE="$(echo "$NACHHER" | awk '{print $2}')"

OK="$(awk -v a="$SOLL_PARALLEL" -v b="$N_PARALLEL" -v c="$SOLL_RATE" -v d="$N_RATE" \
  'BEGIN { print (a+0 == b+0 && (c-d < 0.0001 && d-c < 0.0001)) ? "ja" : "nein" }')"

if [ "$OK" = "ja" ]; then
  echo "  NACHGEZOGEN und nachgemessen: $N_PARALLEL gleichzeitig, $N_RATE/s"
  exit 0
fi

echo "  FEHLGESCHLAGEN: Die Queue steht weiterhin auf $N_PARALLEL / $N_RATE."
echo "  Naechster Schritt: gcloud auth list — bist du mit dem richtigen Konto angemeldet?"
exit 1
