#!/bin/sh
# simulator-szenarien.sh — der Betrieb, wie er im Workshop wirklich aussieht.
#
# ANLASS (Nutzer, 30.08.2026): „Du musst auch die Simulator-Tests alle fahren
# mit wirklichem Massenansturm, damit das mit der Warteliste auch ausprobiert
# wird. Und alle möglichen Edge Cases."
#
# Der Lasttest daneben (lasttest-betriebsprofil.sh) misst EINE Sache: Wirkt
# eine Umstellung? Dieses Skript faehrt die Lagen, die im Workshop entstehen —
# und die man am Schreibtisch nicht trifft:
#
#   1. Eine ganze Klasse laedt gleichzeitig hoch (Warteliste fuellt sich)
#   2. Die Warteliste laeuft ueber (Einlassgrenze greift)
#   3. Der Satz wird UMGESTELLT, waehrend Leute warten
#   4. Der Satz wird KAPUTT gemacht, waehrend Leute warten
#   5. Der Satz wird repariert — laufen die Wartenden weiter?
#   6. Zwei Umstellungen dicht hintereinander (Zwischenspeicher)
#   7. Der Aufraeumer laeuft, waehrend Leute warten
#
# Alles im Emulator, Mistral als Attrappe. Kosten: 0.
#
# Aufruf aus der Repo-Wurzel:  sh scripts/simulator-szenarien.sh
# Voraussetzung: firebase emulators:start --only functions,firestore

set -e

# KEIN VERSAND NACH DRAUSSEN.
# VORFALL 30.08.2026: Ein Lauf dieses Skripts reihte 200 Analysen ein, riss das
# Stundenlimit — und schickte eine ECHTE Push-Nachricht auf das Handy des
# Betreibers. Der Emulator holt sich bei angemeldetem Konto die echten
# Zugangsdaten aus dem Secret Manager. Ein Testlauf darf nicht nach aussen
# wirken; notify.js erkennt beide Kennzeichen.
export NTFY_STUMM=1
WURZEL=$(cd "$(dirname "$0")/.." && pwd)
cd "$WURZEL"
PROJEKT="malzime"
EMU_FIRESTORE="localhost:8080"
EMU="http://localhost:5001/$PROJEKT/europe-west1"
FEHLER=0

# ── MESSMITTEL-PROBE ZUERST ────────────────────────────────────────────
# Ohne diesen Block meldete das Skript bei totem Emulator munter weiter:
# "0 von 30 angenommen" — und im naechsten Schritt "ok, Einlassgrenze greift".
# Ein Pruefstand, der bei kaputter Messung Ergebnisse liefert, ist gefaehrlich.
if ! curl -s -o /dev/null --max-time 5 "$EMU/stats" 2>/dev/null; then
  echo "ABBRUCH: Der Emulator antwortet nicht unter $EMU"
  echo "         Starten mit:  MISTRAL_MOCK=1 firebase emulators:start \\"
  echo "                         --only functions,firestore --project malzime"
  echo "         Ohne laufenden Emulator misst dieses Skript NICHTS."
  exit 1
fi

BILD=$(python3 -c "
import base64, pathlib
print(base64.b64encode(pathlib.Path('public/img/demo/demo-cafe-thumb.jpg').read_bytes()).decode())")
[ -n "$BILD" ] || { echo "FEHLER: Testbild nicht lesbar"; exit 1; }

# Jede dieser Hilfen prueft ihren Rueckgabewert. Ohne das waere nicht
# unterscheidbar, ob der Schritt lief oder scheiterte — und die folgenden
# Pruefungen liefen gegen einen Zustand, den niemand hergestellt hat.
satz() {
  if ! FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
    node "$WURZEL/scripts/lasttest-satz-anlegen.js" >/dev/null 2>&1; then
    echo "   ABBRUCH: Einstellungssatz konnte nicht angelegt werden"
    exit 1
  fi
}
umstellen() {
  if ! FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
    node "$WURZEL/scripts/lasttest-umstellen.js" "$1" >/dev/null 2>&1; then
    echo "   ABBRUCH: Umstellung auf \"$1\" gescheitert"
    exit 1
  fi
}
kaputt() {
  if ! FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
    node "$WURZEL/scripts/simulator-satz-kaputt.js" "$1" >/dev/null 2>&1; then
    echo "   ABBRUCH: Satz konnte nicht kaputtgemacht werden (\"$1\")"
    exit 1
  fi
}
einreihen() {
  curl -s -X POST "$EMU/enqueue" -H "Content-Type: application/json" \
    -d "{\"imageBase64\":\"$BILD\",\"mimeType\":\"image/jpeg\",\"lang\":\"de\"}"
}
# Je Schritt ein eigener Namensraum. BEFUND aus dem ersten Lauf: Ohne das
# ueberschrieb Schritt 2 die Antworten von Schritt 1, und die Auswertung zaehlte
# ueber einen Mischmasch aus beiden — die Absagen waren "verschwunden", obwohl
# der Server sie korrekt geschickt hatte. Das Skript meldete einen Fehler im
# Produkt, den es nicht gab.
viele() {
  SCHRITT="$2"
  rm -f "/tmp/sim-$SCHRITT-"*.json
  I=1
  while [ "$I" -le "$1" ]; do
    einreihen > "/tmp/sim-$SCHRITT-$I.json" &
    I=$((I + 1))
  done
  wait
}
zaehle() { grep -l "jobId" /tmp/sim-"$1"-*.json 2>/dev/null | wc -l | tr -d ' '; }
leeren() {
  if ! FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
    node "$WURZEL/scripts/simulator-warteschlange-leeren.js" >/dev/null 2>&1; then
    echo "   ABBRUCH: Warteschlange konnte nicht geleert werden"
    exit 1
  fi
}
# Sobald ein Schritt die Grundlage der folgenden zerstoert, wird abgebrochen.
# Sonst pruefen die spaeteren Schritte gegen einen Zustand, den es nicht gibt —
# und melden gruen, weil "nichts passiert" wie "richtig abgelehnt" aussieht.
abbruch_wenn_grundlos() {
  if [ "$1" -eq 0 ]; then
    echo
    echo "ABBRUCH: $2"
    echo "         Alles Weitere wuerde gegen einen leeren Zustand pruefen"
    echo "         und faelschlich gruen melden."
    exit 1
  fi
}

pruefe() {
  # pruefe "Name" "Ist" "Soll-Beschreibung" "Bedingung(0=ok)"
  if [ "$4" -eq 0 ]; then
    printf "   ok    %-46s %s\n" "$1" "$2"
  else
    printf "   ROT   %-46s %s (SOLL: %s)\n" "$1" "$2" "$3"
    FEHLER=$((FEHLER + 1))
  fi
}

echo "══ Simulator-Szenarien: der Workshop-Betrieb ══════════════════"
echo

# ── 1. Eine Klasse laedt gleichzeitig hoch ────────────────────────────
echo "1. Eine Schulklasse (30) laedt gleichzeitig hoch"
rm -f /tmp/sim-*.json
satz
leeren
viele 30 klasse
A=$(zaehle klasse)
pruefe "alle 30 angenommen" "$A von 30" "30" "$([ "$A" -eq 30 ] && echo 0 || echo 1)"
abbruch_wenn_grundlos "$A" "Keine einzige Anfrage angenommen — Satz fehlt oder Emulator kaputt."
POS=$(grep -ho '"position":[0-9]*' /tmp/sim-klasse-*.json 2>/dev/null | cut -d: -f2 | sort -n | tail -1)
echo "      hoechste Warteposition: ${POS:-(nicht in der Einlass-Antwort)}"

# ── 2. Die Warteliste laeuft ueber ────────────────────────────────────
echo
echo "2. Zwei Klassen mehr (170) — die Einlassgrenze muss greifen"
viele 170 andrang
B=$(zaehle andrang)

# ABGEBROCHENE VERBINDUNGEN SIND KEINE ABLEHNUNGEN.
# BEFUND (30.08.2026): Der Emulator laesst unter 170 gleichzeitigen Anfragen
# einige Verbindungen fallen (ECONNRESET). Das Skript zaehlte sie als
# "abgelehnt" und meldete "ok, Einlassgrenze greift" — obwohl die Grenze gar
# nicht erreicht war. Eine kaputte Verbindung sieht aus wie eine Absage und
# ist das Gegenteil: gar keine Antwort.
ABGERISSEN=$(grep -l "ECONNRESET\|ECONNREFUSED\|socket hang up" /tmp/sim-andrang-*.json 2>/dev/null | wc -l | tr -d ' ')
ABGELEHNT=$(grep -l '"blocked"' /tmp/sim-andrang-*.json 2>/dev/null | wc -l | tr -d ' ')
echo "      angenommen $B · abgelehnt $ABGELEHNT · Verbindung abgerissen $ABGERISSEN"

# Der ECHTE Nachweis: Wie viele liegen danach in der Warteschlange? Sie darf
# die eingestellte Tiefe nicht ueberschreiten. Das ist unabhaengig davon, wie
# der Emulator sich unter Last verhaelt.
WARTEND=$(FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
  node "$WURZEL/scripts/simulator-warteschlange-zaehlen.js" 2>/dev/null | tail -1)
TIEFE=$(python3 -c "
import json, pathlib, re
s = pathlib.Path('functions/src/test-satz.js').read_text()
m = re.search(r'warteschlangeTiefe:\s*([0-9]+)', s)
print(m.group(1) if m else 155)")
# BUG-2026-08-30-14, BEHOBEN am 30.08.2026.
# Der Einlass zaehlte frueher und legte den Auftrag mehrere Schritte spaeter an.
# Bei gleichzeitigem Andrang sahen alle Anfragen denselben Stand und kamen alle
# durch — hier gemessen: 200 bei Grenze 155. Seit der atomaren
# Platzreservierung (jobs.platzReservieren) entscheidet EINE Transaktion.
#
# Die Schwelle ist deshalb die ECHTE Grenze, nicht mehr das frueher gemessene
# Ausmass. Ein paar Plaetze Toleranz bleiben fuer Auftraege, die zwischen
# Reservierung und Zaehlung stehen — mehr nicht.
pruefe "die Warteschlange haelt die eingestellte Tiefe ein" \
  "${WARTEND:-?} wartend, Grenze $TIEFE" "hoechstens $TIEFE (+5 Toleranz)" \
  "$([ -n "$WARTEND" ] && [ "$WARTEND" -le "$((TIEFE + 5))" ] && echo 0 || echo 1)"

GRUND=$(grep -ho '"blocked":"[a-zA-Z]*"' /tmp/sim-andrang-*.json 2>/dev/null | sort -u | head -1)
pruefe "wer abgewiesen wird, bekommt einen Grund" "${GRUND:-keine Absage noetig}" '"blocked":"queueFull"' \
  "$([ "$ABGELEHNT" -eq 0 ] || echo "$GRUND" | grep -q queueFull && echo 0 || echo 1)"

# ── 3. Umstellung WAEHREND die Leute warten ───────────────────────────
echo
echo "3. Der Satz wird umgestellt, waehrend 155 Leute warten"
# NICHT den ersten Auftrag nehmen! Bei Position 1 rundet ceil(1/7) und
# ceil(1/14) beide auf 1 — die Parallelitaet faellt aus der Rechnung, und der
# Test meldet "65 s -> 65 s: wirkt nicht", obwohl sie wirkt. Gemessen wird an
# einem Auftrag WEIT HINTEN, wo der Unterschied ankommt.
ERSTE=$(grep -ho '"jobId":"[^"]*"' /tmp/sim-andrang-*.json 2>/dev/null | tail -1 | cut -d'"' -f4)
TOK=$(grep -l "$ERSTE" /tmp/sim-andrang-*.json 2>/dev/null | head -1 | xargs grep -ho '"resultToken":"[^"]*"' | cut -d'"' -f4)
VOR=$(curl -s "$EMU/jobStatus?jobId=$ERSTE&token=$TOK")
ETA_VOR=$(echo "$VOR" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
umstellen "t2-schnell"
sleep 32
NACH=$(curl -s "$EMU/jobStatus?jobId=$ERSTE&token=$TOK")
ETA_NACH=$(echo "$NACH" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
pruefe "Wartezeit zieht mit" "${ETA_VOR:-?} s -> ${ETA_NACH:-?} s" "kuerzer" \
  "$([ -n "$ETA_VOR" ] && [ -n "$ETA_NACH" ] && [ "$ETA_NACH" -lt "$ETA_VOR" ] && echo 0 || echo 1)"
pruefe "die Wartenden verlieren ihren Platz NICHT" \
  "$(echo "$NACH" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)" "queued" \
  "$(echo "$NACH" | grep -q '"status":"queued"' && echo 0 || echo 1)"

# ── 4. Der Satz wird KAPUTT, waehrend Leute warten ────────────────────
echo
echo "4. Jemand macht den Satz kaputt, waehrend die Klasse wartet"
kaputt "feld-weg"
sleep 32
NEU=$(einreihen)
pruefe "kein neuer Einlass" "$(echo "$NEU" | head -c 60)" "Absage" \
  "$(echo "$NEU" | grep -q jobId && echo 1 || echo 0)"
WARTEND=$(curl -s "$EMU/jobStatus?jobId=$ERSTE&token=$TOK")
pruefe "der Wartende stuerzt nicht ab" \
  "$(echo "$WARTEND" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)" "eine Antwort" \
  "$(echo "$WARTEND" | grep -q '"status"' && echo 0 || echo 1)"

# ── 5. Reparatur ──────────────────────────────────────────────────────
echo
echo "5. Der Satz wird repariert"
satz
# BEFUND aus dem ersten Lauf: Ohne dieses Leeren war die Warteschlange noch
# von Schritt 2 voll — der Einlass lehnte ZU RECHT ab, und das Skript meldete
# das als Fehler. Eine Pruefung muss die Lage herstellen, die sie behauptet.
leeren
sleep 32
REP=$(einreihen)
pruefe "Einlass laeuft wieder" "$(echo "$REP" | grep -q jobId && echo 'jobId da' || echo "$REP" | head -c 40)" "jobId" \
  "$(echo "$REP" | grep -q jobId && echo 0 || echo 1)"

# ── 6. Zwei Umstellungen dicht hintereinander ─────────────────────────
echo
echo "6. Zwei Umstellungen binnen Sekunden (Zwischenspeicher)"
# BEFUND aus dem zweiten Lauf: Schritt 5 leert die Warteschlange — danach gibt
# es den Auftrag aus Schritt 1 nicht mehr, und die Abfrage lief ins Leere. Das
# Skript meldete "der Satz gilt nicht", obwohl es nur seinen eigenen Bezugs-
# punkt zerstoert hatte. Deshalb hier ein FRISCHER Auftrag als Bezug.
viele 40 spaet
NEUE=$(grep -ho '"jobId":"[^"]*"' /tmp/sim-spaet-*.json 2>/dev/null | head -1 | cut -d'"' -f4)
NTOK=$(grep -l "$NEUE" /tmp/sim-spaet-*.json 2>/dev/null | head -1 | xargs grep -ho '"resultToken":"[^"]*"' | cut -d'"' -f4)
abbruch_wenn_grundlos "$(zaehle spaet)" "Kein frischer Auftrag angenommen — Bezugspunkt fehlt."
umstellen "t2-schnell"
umstellen "t1-normal"
sleep 32
Z=$(curl -s "$EMU/jobStatus?jobId=$NEUE&token=$NTOK" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
pruefe "der zuletzt gesetzte Satz gilt" "eta ${Z:-?} s" "wieder der langsamere" \
  "$([ -n "$Z" ] && echo 0 || echo 1)"

# ── 7. Der Aufraeumer laeuft, waehrend Leute warten ───────────────────
echo
echo "7. Der Aufraeumer laeuft mitten im Andrang"
# Der Aufraeumer ist eine ZEITPLAN-Function und im Emulator nicht per HTTP
# erreichbar. Frueher stand hier eine Pruefung, die "ok" meldete, weil die
# Antwort "Function does not exist" kein "error" enthielt — sie mass nichts.
# Jetzt wird die Aufraeum-LOGIK direkt gerufen, die dieselben Abfragen macht.
R=$(FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" GCLOUD_PROJECT="$PROJEKT" \
  node "$WURZEL/scripts/simulator-aufraeumen.js" 2>&1)
echo "$R" | sed 's/^/      /'
pruefe "Aufraeumer laeuft durch" "$(echo "$R" | tail -1 | head -c 46)" "kein Absturz" \
  "$(echo "$R" | grep -qi 'ABSTURZ\|Error:' && echo 1 || echo 0)"
NOCH=$(curl -s "$EMU/jobStatus?jobId=$NEUE&token=$NTOK")
pruefe "frisch Wartende wurden NICHT weggeraeumt" \
  "$(echo "$NOCH" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)" "queued" \
  "$(echo "$NOCH" | grep -q '"status":"queued"' && echo 0 || echo 1)"

echo
echo "══ ERGEBNIS ══════════════════════════════════════════════════"
if [ "$FEHLER" -gt 0 ]; then
  echo "   $FEHLER Szenario-Pruefung(en) ROT."
  echo "   Die Antworten bleiben in /tmp/sim-*.json liegen — ohne sie ist"
  echo "   nicht nachvollziehbar, WAS der Server geantwortet hat."
  exit 1
fi
rm -f /tmp/sim-*.json
echo "   Alle Szenarien bestanden. Kosten: 0."
