#!/usr/bin/env bash
# lasttest-live.sh — echte Analysen gegen die PRODUKTION, mit Auswertung.
#
# ANLASS (Nutzer, 01.09.2026): „Ich habe ja mehrfach erwaehnt, dass du einen
# Lasttest mit 30 Benutzern auf das echte System machen sollst."
#
# ABGRENZUNG zu scripts/lasttest-betriebsprofil.sh: Jenes faehrt gegen den
# Emulator mit einer Mistral-Attrappe — echte Warteschlange, echte
# Positionsrechnung, aber KEINE echten KI-Aufrufe und keine Kosten. Es kann
# deshalb genau das nicht zeigen, worauf es hier ankommt: ob Mistral bei der
# T1-Rate (0,25 Anfragen/s) mitkommt und wie lange eine Analyse unter echter
# Last wirklich braucht.
#
# DIESER LAUF KOSTET GELD UND VERAENDERT DIE OEFFENTLICHE STATISTIK.
#   * ~0,5 bis 0,8 Cent je Analyse (docs/FLAGS.md)
#   * jede Analyse zaehlt dauerhaft in "Profile erstellt" auf /stats mit
#   * das Stundenlimit (500) wird mitverbraucht
# Deshalb laeuft er NIE ohne ausdrueckliche Freigabe und NIE mit einer
# Vorgabe-Anzahl: Die Zahl muss jemand hinschreiben.
#
# Aufruf:  sh scripts/lasttest-live.sh 30
set -u

BASIS="${MALZIME_BASIS:-https://malzi.me}"
ANZAHL="${1:-}"

if [ -z "$ANZAHL" ]; then
  echo "Aufruf: sh $0 <anzahl>" >&2
  echo "  Keine Vorgabe-Anzahl — dieser Lauf kostet Geld und veraendert die" >&2
  echo "  oeffentliche Statistik. Die Zahl muss bewusst gesetzt werden." >&2
  exit 2
fi

ABLAGE="$(mktemp -d)"
trap 'rm -rf "$ABLAGE"' EXIT

echo "── Lasttest gegen die PRODUKTION ($BASIS) ──────────────"
echo "   $ANZAHL echte Analysen · echte KI-Aufrufe · echte Kosten"
echo

# 1. Lage vorher festhalten — ohne Ausgangswert ist kein Zuwachs belegbar.
VORHER="$(curl -s --max-time 20 "$BASIS/api/stats")"
VOR_GESAMT=$(printf '%s' "$VORHER" | grep -o '"allTime":[0-9]*' | cut -d: -f2)
VOR_STUNDE=$(printf '%s' "$VORHER" | grep -o '"hourlyTotal":[0-9]*' | cut -d: -f2)
VOR_LIMIT=$(printf '%s' "$VORHER" | grep -o '"limit":[0-9]*' | head -1 | cut -d: -f2)
WARTUNG=$(printf '%s' "$VORHER" | grep -o '"maintenance":{"enabled":[a-z]*' | grep -o '[a-z]*$')

if [ "$WARTUNG" = "true" ]; then
  echo "   ABBRUCH: Der Wartungsmodus ist an — es kaeme keine Analyse durch."
  echo "            sh scripts/wartungsmodus.sh aus"
  exit 2
fi

echo "1. Ausgangslage"
echo "   Profile gesamt: ${VOR_GESAMT:-?} · in dieser Stunde: ${VOR_STUNDE:-?} von ${VOR_LIMIT:-?}"

# Reisst der Lauf das Stundenlimit, sehen echte Nutzer eine Absage. Lieber
# vorher abbrechen als mitten im Lauf feststellen.
if [ -n "${VOR_STUNDE:-}" ] && [ -n "${VOR_LIMIT:-}" ]; then
  REST=$((VOR_LIMIT - VOR_STUNDE))
  if [ "$ANZAHL" -gt "$REST" ]; then
    echo "   ABBRUCH: Nur noch $REST Plaetze in dieser Stunde frei, $ANZAHL angefordert."
    echo "            Echte Nutzer bekaemen eine Absage. Spaeter erneut."
    exit 2
  fi
  echo "   Nach dem Lauf belegt: $((VOR_STUNDE + ANZAHL)) von $VOR_LIMIT"
fi

# 2. Ein echtes Bild — die Magic-Byte-Pruefung laesst nichts anderes durch.
BILD_B64=$(python3 -c "
import base64, pathlib
print(base64.b64encode(pathlib.Path('public/img/demo/demo-cafe-thumb.jpg').read_bytes()).decode())
")
if [ -z "$BILD_B64" ]; then
  echo "   ABBRUCH: Testbild nicht gelesen (public/img/demo/demo-cafe-thumb.jpg)" >&2
  exit 1
fi

echo
echo "2. $ANZAHL Analysen gleichzeitig einreihen — JETZT auf $BASIS mitschauen"
START=$(date +%s)
i=1
while [ "$i" -le "$ANZAHL" ]; do
  curl -s --max-time 60 -X POST "$BASIS/api/enqueue" \
    -H "Content-Type: application/json" \
    -d "{\"imageBase64\":\"$BILD_B64\",\"mimeType\":\"image/jpeg\",\"lang\":\"de\"}" \
    -o "$ABLAGE/ein-$i.json" -w "%{http_code}" >> "$ABLAGE/codes.txt" 2>/dev/null &
  echo >> "$ABLAGE/codes.txt"
  i=$((i + 1))
done
wait
EINGEREIHT=$(( $(date +%s) - START ))
echo "   eingereiht in ${EINGEREIHT} s"

ANGENOMMEN=$(grep -l "jobId" "$ABLAGE"/ein-*.json 2>/dev/null | wc -l | tr -d ' ')
ABGELEHNT=$((ANZAHL - ANGENOMMEN))
echo
echo "3. Einlass"
echo "   angenommen: $ANGENOMMEN   abgelehnt: $ABGELEHNT"
if [ "$ABGELEHNT" -gt 0 ]; then
  echo "   Gruende:"
  cat "$ABLAGE"/ein-*.json 2>/dev/null | grep -o '"blocked":"[^"]*"' | sort | uniq -c | sed 's/^/     /'
fi

if [ "$ANGENOMMEN" -eq 0 ]; then
  echo
  echo "── Was dieser Lauf belegt ───────────────────────────────"
  echo "   NICHTS. Keine einzige Anfrage kam durch."
  exit 1
fi

# 3. Die Wartezeit-Ansage des LETZTEN Auftrags festhalten.
#    BEFUND 01.09.2026 am Emulator-Zwilling: Der zuerst eingereihte Auftrag
#    steht ganz vorne, dort sagt die Ansage bei jeder Parallelitaet dasselbe.
#    Gemessen wird deshalb der zuletzt eingereihte.
LETZTER=$(grep -ho '"jobId":"[^"]*"' "$ABLAGE"/ein-*.json | tail -1 | cut -d'"' -f4)
LETZTER_TOKEN=$(grep -l "$LETZTER" "$ABLAGE"/ein-*.json | head -1 | xargs grep -ho '"resultToken":"[^"]*"' | cut -d'"' -f4)
ANSAGE=$(curl -s --max-time 20 "$BASIS/api/jobStatus?jobId=$LETZTER&token=$LETZTER_TOKEN")
POS=$(printf '%s' "$ANSAGE" | grep -o '"position":[0-9]*' | cut -d: -f2)
ETA=$(printf '%s' "$ANSAGE" | grep -o '"etaSeconds":[0-9]*' | cut -d: -f2)
echo
echo "4. Was der letzte in der Reihe angezeigt bekommt"
echo "   Position ${POS:-keine} · angesagte Wartezeit ${ETA:-keine} s"

# 4. Warten, bis alle fertig sind — und dabei messen, wie lange es WIRKLICH
#    dauert. Genau diese Zahl kann der Emulator nicht liefern.
echo
echo "5. Warten auf die Ergebnisse (hoechstens 20 Minuten)"
FERTIG=0
FEHLER=0
GESAMT_START=$(date +%s)
for f in "$ABLAGE"/ein-*.json; do
  JOB=$(grep -ho '"jobId":"[^"]*"' "$f" 2>/dev/null | cut -d'"' -f4)
  TOK=$(grep -ho '"resultToken":"[^"]*"' "$f" 2>/dev/null | cut -d'"' -f4)
  [ -z "$JOB" ] && continue
  (
    JOB_START=$(date +%s)
    while [ $(( $(date +%s) - JOB_START )) -lt 1200 ]; do
      ST=$(curl -s --max-time 20 "$BASIS/api/jobStatus?jobId=$JOB&token=$TOK")
      case "$ST" in
        *'"status":"done"'*)    echo "done $(( $(date +%s) - GESAMT_START ))" >> "$ABLAGE/zeiten.txt"; exit 0 ;;
        *'"status":"failed"'*)  echo "failed $(( $(date +%s) - GESAMT_START ))" >> "$ABLAGE/zeiten.txt"; exit 0 ;;
      esac
      sleep 10
    done
    echo "timeout 1200" >> "$ABLAGE/zeiten.txt"
  ) &
done
wait
GESAMT=$(( $(date +%s) - GESAMT_START ))

FERTIG=$(grep -c '^done' "$ABLAGE/zeiten.txt" 2>/dev/null || echo 0)
FEHLER=$(grep -c '^failed' "$ABLAGE/zeiten.txt" 2>/dev/null || echo 0)
ABLAUF=$(grep -c '^timeout' "$ABLAGE/zeiten.txt" 2>/dev/null || echo 0)

# 5. Auswertung — Median und Spanne der Durchlaufzeiten.
ZEITEN=$(grep '^done' "$ABLAGE/zeiten.txt" 2>/dev/null | awk '{print $2}' | sort -n)
ANZ_Z=$(printf '%s\n' "$ZEITEN" | grep -c . || echo 0)
if [ "$ANZ_Z" -gt 0 ]; then
  ERSTE=$(printf '%s\n' "$ZEITEN" | head -1)
  LETZTE_Z=$(printf '%s\n' "$ZEITEN" | tail -1)
  MITTE=$(( (ANZ_Z + 1) / 2 ))
  MEDIAN=$(printf '%s\n' "$ZEITEN" | sed -n "${MITTE}p")
fi

NACHHER="$(curl -s --max-time 20 "$BASIS/api/stats")"
NACH_GESAMT=$(printf '%s' "$NACHHER" | grep -o '"allTime":[0-9]*' | cut -d: -f2)

echo
echo "── Auswertung ───────────────────────────────────────────"
echo "   Eingereicht:            $ANZAHL"
echo "   Angenommen:             $ANGENOMMEN     abgelehnt: $ABGELEHNT"
echo "   Fertig geworden:        $FERTIG     gescheitert: $FEHLER     abgelaufen: $ABLAUF"
if [ "${ANZ_Z:-0}" -gt 0 ]; then
  echo "   Erste fertig nach:      ${ERSTE} s"
  echo "   Median:                 ${MEDIAN} s"
  echo "   Letzte fertig nach:     ${LETZTE_Z} s"
fi
echo "   Ganzer Lauf:            ${GESAMT} s"
echo "   Angesagt war (letzter): ${ETA:-keine} s bei Position ${POS:-?}"
echo "   Profile gesamt:         ${VOR_GESAMT:-?} -> ${NACH_GESAMT:-?}"
if [ -n "${VOR_GESAMT:-}" ] && [ -n "${NACH_GESAMT:-}" ]; then
  echo "   Zuwachs:                $((NACH_GESAMT - VOR_GESAMT))"
fi
echo
echo "   Kosten (0,5-0,8 Cent je Analyse): rund $((ANGENOMMEN * 5 / 10)) bis $((ANGENOMMEN * 8 / 10)) Cent"
