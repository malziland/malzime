#!/bin/sh
# lasttest-betriebsprofil.sh — Warteschlange und Gleichzeitigkeit, kostenlos.
#
# ANLASS (Nutzer, 30.08.2026): „Wie testest du die Werte mit der
# Gleichzeitigkeit von Analysen, wenn mehrere gleichzeitig sind, und mit dem
# Warte-Bereich und dem ganzen Thema?"
#
# Der Firebase-Emulator faehrt Firestore und die Functions lokal; MISTRAL_MOCK=1
# ersetzt die KI durch eine Attrappe. Damit laeuft die ECHTE Warteschlange mit
# echten Jobs, echter Positionsrechnung und echter Wartezeit-Ansage — ohne
# einen einzigen bezahlten Aufruf.
#
# Aufruf:  sh scripts/lasttest-betriebsprofil.sh [Anzahl]   (Vorgabe 40)

set -e

# KEIN VERSAND NACH DRAUSSEN.
# VORFALL 30.08.2026: Ein Lauf dieses Skripts reihte 200 Analysen ein, riss das
# Stundenlimit — und schickte eine ECHTE Push-Nachricht auf das Handy des
# Betreibers. Der Emulator holt sich bei angemeldetem Konto die echten
# Zugangsdaten aus dem Secret Manager. Ein Testlauf darf nicht nach aussen
# wirken; notify.js erkennt beide Kennzeichen.
export NTFY_STUMM=1
# KORREKTUR 31.08.2026 (Pruefrunde 3): Dieses `export` erreicht den Emulator
# NICHT. Das Skript startet ihn nicht selbst; er laeuft als fremder Prozess und
# sieht die Variable nie. Wirksam gegen den Vorfall ist allein der Riegel in
# functions/src/queue-storage.js — der prueft FUNCTIONS_EMULATOR, das der
# Emulator selbst setzt. Die Zeile bleibt trotzdem: Wer das Skript kuenftig um
# einen eigenen Emulator-Start erweitert, braucht sie.
#
# VORFALL 31.08.2026: Ohne QUEUE_LOCAL=1 legt der Emulator die Bilder im
# ECHTEN Cloud-Storage-Bucket ab — er holt sich bei angemeldetem Konto die
# Produktions-Zugangsdaten. Dort blieben 4.056 Testbilder (233 MB) liegen,
# weil sie nie ein Worker abholte und loeschte. Im Lokal-Modus landen sie
# stattdessen in einem Temp-Verzeichnis. queue-storage.js verriegelt den
# echten Bucket zusaetzlich, sobald ein Emulator laeuft.
export QUEUE_LOCAL=1
ANZAHL="${1:-40}"
PROJEKT="malzime"
EMU_FIRESTORE="localhost:8080"
EMU_FUNCTIONS="http://localhost:5001/$PROJEKT/europe-west1"

echo "── Lasttest Betriebsprofil ──────────────────────────────"
echo "   $ANZAHL gleichzeitige Analysen, Mistral als Attrappe, keine Kosten"
echo

# 1. Einstellungssatz in den Emulator schreiben
echo "1. Einstellungssatz anlegen"
FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
  node "$(pwd)/scripts/lasttest-satz-anlegen.js" || {
  # Die alte Meldung nannte IMMER den Emulator — auch wenn nur ein Modul
  # fehlte oder das Verzeichnis falsch war. Eine Fehlermeldung, die die
  # falsche Ursache nennt, kostet mehr Zeit als gar keine.
  echo
  echo "   Das Anlegen des Satzes ist gescheitert. Die Ursache steht oben."
  echo "   Haeufig: (a) Emulator laeuft nicht -> firebase emulators:start"
  echo "            (b) Abhaengigkeiten fehlen -> npm ci --prefix functions"
  echo "            (c) falsches Verzeichnis   -> aus der Repo-Wurzel starten"
  exit 1
}

# 2. Ein ECHTES Bild vorbereiten
#    Vorher stand hier "dGVzdA==" (= das Wort "test"). Die Magic-Byte-Pruefung
#    hat jede einzelne Anfrage abgelehnt — der Lasttest meldete "50 abgelehnt"
#    und behauptete trotzdem, er habe die Warteschlange geprueft. Ein
#    Testwerkzeug, das am Eingang scheitert, misst nichts dahinter.
BILD_B64=$(python3 -c "
import base64, pathlib
p = pathlib.Path('public/img/demo/demo-cafe-thumb.jpg')
print(base64.b64encode(p.read_bytes()).decode())
")
if [ -z "$BILD_B64" ]; then
  echo "   FEHLER: Testbild nicht gelesen (public/img/demo/demo-cafe-thumb.jpg)"
  exit 1
fi

# 3. Gleichzeitig einreihen
echo
echo "3. $ANZAHL Analysen gleichzeitig einreihen"
START=$(date +%s)
i=1
while [ "$i" -le "$ANZAHL" ]; do
  curl -s -X POST "$EMU_FUNCTIONS/enqueue" \
    -H "Content-Type: application/json" \
    -d "{\"imageBase64\":\"$BILD_B64\",\"mimeType\":\"image/jpeg\",\"lang\":\"de\"}" \
    -o "/tmp/lasttest-$i.json" &
  i=$((i + 1))
done
wait
ENDE=$(date +%s)
echo "   eingereiht in $((ENDE - START)) s"

# 3. Auswerten
echo
echo "4. Ergebnis des Einlasses"
ANGENOMMEN=$(grep -l "jobId" /tmp/lasttest-*.json 2>/dev/null | wc -l | tr -d ' ')
ABGELEHNT=$((ANZAHL - ANGENOMMEN))
echo "   angenommen: $ANGENOMMEN   abgelehnt: $ABGELEHNT"

if [ "$ANGENOMMEN" -eq 0 ]; then
  echo
  echo "── Was dieser Lauf belegt ───────────────────────────────"
  echo "   NICHTS. Keine einzige Anfrage wurde angenommen — die Ursache steht"
  echo "   in /tmp/lasttest-1.json. Der Lauf sagt nichts ueber die Warteschlange."
  exit 1
fi

# 5. DER EIGENTLICHE NACHWEIS: Wirkt eine Umstellung?
#
#    Die Positionsrechnung und die Wartezeit-Ansage stehen NICHT in der
#    Antwort des Einlasses — sie kommen erst beim Statusabruf. Frueher hat
#    dieses Skript sie im Einlass gesucht, nichts gefunden und trotzdem
#    behauptet, sie stammten aus dem Satz. Jetzt wird gemessen.
#
#    Der Nachweis: Bei doppelter Parallelitaet muss dieselbe Warteposition
#    die HALBE Wartezeit ergeben. Genau das war der schwerste Befund des
#    Audits (ARCH-2026-08-30-04): Die Ansage rechnete mit dem Code-Wert und
#    haette sich durch eine Umstellung nicht bewegt.
echo
echo "5. Nachweis: wirkt eine Umstellung des Satzes?"

ERSTE_JOB=$(grep -ho '"jobId":"[^"]*"' /tmp/lasttest-*.json 2>/dev/null | head -1 | cut -d'"' -f4)
ERSTER_TOKEN=$(grep -l "$ERSTE_JOB" /tmp/lasttest-*.json | head -1 | xargs grep -ho '"resultToken":"[^"]*"' | cut -d'"' -f4)

status_holen() {
  curl -s "$EMU_FUNCTIONS/jobStatus?jobId=$ERSTE_JOB&token=$ERSTER_TOKEN"
}

VORHER=$(status_holen)
ETA_VORHER=$(echo "$VORHER" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
POS_VORHER=$(echo "$VORHER" | grep -o '"position":[0-9]*' | cut -d: -f2)
echo "   mit t1-normal (parallelitaet 7):  Position ${POS_VORHER:-?}, Wartezeit ${ETA_VORHER:-keine} s"

FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
  node "$(pwd)/scripts/lasttest-umstellen.js" t2-schnell || exit 1

# Der Satz liegt 30 s im Zwischenspeicher — so lange gilt bewusst der alte.
echo "   warte 32 s (Zwischenspeicher)…"
sleep 32

NACHHER=$(status_holen)
ETA_NACHHER=$(echo "$NACHHER" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
echo "   mit t2-schnell (parallelitaet 14): Position ${POS_VORHER:-?}, Wartezeit ${ETA_NACHHER:-keine} s"

rm -f /tmp/lasttest-*.json

echo
echo "── Was dieser Lauf belegt ───────────────────────────────"
echo "   * $ANGENOMMEN von $ANZAHL Anfragen angenommen, $ABGELEHNT abgelehnt"
echo "   * Der Einstellungssatz wurde unter Gleichzeitigkeit gelesen"
if [ -n "$ETA_VORHER" ] && [ -n "$ETA_NACHHER" ]; then
  if [ "$ETA_NACHHER" -lt "$ETA_VORHER" ]; then
    echo "   * BESTANDEN: Die Umstellung wirkt — Wartezeit $ETA_VORHER s -> $ETA_NACHHER s"
    echo "     (doppelte Parallelitaet, halbe Wartezeit, ohne Deploy)"
  else
    echo "   * DURCHGEFALLEN: Die Wartezeit hat sich NICHT bewegt"
    echo "     ($ETA_VORHER s -> $ETA_NACHHER s). Die Ansage rechnet nicht mit"
    echo "     dem Satz — genau der Befund ARCH-2026-08-30-04."
    exit 1
  fi
else
  echo "   * NICHT MESSBAR: keine Wartezeit-Ansage erhalten (Job schon fertig?)"
  echo "     Mit mehr Last erneut versuchen: sh $0 200"
fi
echo "   * Kosten: 0 — kein bezahlter Mistral-Aufruf"
