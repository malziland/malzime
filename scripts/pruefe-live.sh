#!/bin/sh
# pruefe-live.sh — rechnet nach, ob malzi.me wirklich das ausliefert, was hier
# im Repository liegt.
#
# Offener Quelltext beweist fuer sich genommen nichts: Er sagt, was laufen
# KOENNTE, nicht was laeuft. Dieses Skript schliesst die Luecke fuer den Teil,
# auf dem die Datenschutz-Zusagen dieses Projekts beruhen — das Frontend.
#
# So geht es vor:
#   1. holt https://malzi.me/build-info.json (Commit + Pruefsumme je Datei),
#   2. prueft, ob dieser Commit im lokalen Repository existiert,
#   3. laedt jede genannte Datei vom Server und rechnet ihre Pruefsumme nach,
#   4. meldet Uebereinstimmung oder nennt jede Abweichung beim Namen.
#
# Aufruf:  sh scripts/pruefe-live.sh [basis-adresse]
#          Standard: https://malzi.me
#
# Rueckgabewerte, bewusst getrennt:
#   0  alles deckungsgleich
#   1  BEFUND: mindestens eine Datei weicht ab
#   2  MESSPROBLEM: kein Netz, kein Werkzeug, Datei nicht lesbar
#      Ein Messfehler darf nie als Befund durchgehen (und umgekehrt).
#
# Kein `set -e`: Das Skript soll ALLE Abweichungen zeigen, nicht bei der
# ersten stehenbleiben.

BASIS="${1:-https://malzi.me}"

# ── Werkzeuge pruefen ───────────────────────────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  echo "MESSPROBLEM: curl fehlt." >&2
  exit 2
fi
if command -v shasum >/dev/null 2>&1; then
  SUMME="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  SUMME="sha256sum"
else
  echo "MESSPROBLEM: weder shasum noch sha256sum vorhanden." >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "MESSPROBLEM: python3 fehlt (wird zum Lesen der JSON-Datei gebraucht)." >&2
  exit 2
fi

ARBEIT=$(mktemp -d) || { echo "MESSPROBLEM: kein temporaeres Verzeichnis." >&2; exit 2; }
trap 'rm -rf "$ARBEIT"' EXIT

echo "Nachrechnung gegen $BASIS"
echo "-----------------------------------------------------------"

# ── 1. Fingerabdruck holen ──────────────────────────────────────────────────
if ! curl -fsS "$BASIS/build-info.json" -o "$ARBEIT/build-info.json"; then
  echo "MESSPROBLEM: $BASIS/build-info.json nicht erreichbar." >&2
  exit 2
fi

# Firebase liefert bei unbekannten Pfaden die Startseite aus — statt eines
# 404 kommt dann HTML mit Status 200. Das ist ein Messproblem, kein Befund,
# und die Meldung muss den Unterschied benennen.
if head -c 200 "$ARBEIT/build-info.json" | grep -qi "<!doctype\|<html"; then
  echo "MESSPROBLEM: $BASIS/build-info.json liefert HTML statt JSON." >&2
  echo "             Vermutlich gibt es die Datei dort noch nicht — der Server" >&2
  echo "             antwortet stattdessen mit der Startseite." >&2
  exit 2
fi

COMMIT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['commit'])" "$ARBEIT/build-info.json" 2>/dev/null)
if [ -z "$COMMIT" ]; then
  echo "MESSPROBLEM: build-info.json ist unlesbar oder nennt keinen Commit." >&2
  exit 2
fi
STAND=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['ausgeliefertAm'], d['cacheBuster'])" "$ARBEIT/build-info.json")
ANZAHL=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['dateien']))" "$ARBEIT/build-info.json")

echo "  Ausgeliefert:  $STAND"
echo "  Commit:        $COMMIT"
echo "  Dateien:       $ANZAHL"

# ── 2. Kennt das lokale Repository diesen Commit? ───────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
    echo "  Commit im Repository: ja"
  else
    echo "  Commit im Repository: NEIN — 'git fetch' ausfuehren, dann erneut pruefen."
  fi
else
  echo "  Commit im Repository: nicht pruefbar (kein git-Repository)."
fi
echo "-----------------------------------------------------------"

# ── 3. Jede Datei laden und nachrechnen ─────────────────────────────────────
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for pfad, summe in sorted(d['dateien'].items()):
    print(pfad + '\t' + summe)
" "$ARBEIT/build-info.json" > "$ARBEIT/soll.txt" || {
  echo "MESSPROBLEM: Dateiliste nicht lesbar." >&2
  exit 2
}

ABWEICHUNG=0
FEHLEND=0
GEPRUEFT=0

while IFS="$(printf '\t')" read -r PFAD SOLL; do
  [ -z "$PFAD" ] && continue
  if ! curl -fsS "$BASIS/$PFAD" -o "$ARBEIT/datei" 2>/dev/null; then
    echo "  FEHLT auf dem Server: $PFAD"
    FEHLEND=$((FEHLEND + 1))
    continue
  fi
  IST="sha256:$($SUMME "$ARBEIT/datei" | cut -d' ' -f1)"
  GEPRUEFT=$((GEPRUEFT + 1))
  if [ "$IST" != "$SOLL" ]; then
    echo "  ABWEICHUNG: $PFAD"
    echo "      erwartet: $SOLL"
    echo "      gefunden: $IST"
    ABWEICHUNG=$((ABWEICHUNG + 1))
  fi
done < "$ARBEIT/soll.txt"

echo "-----------------------------------------------------------"

# ── Server-Code gegen dieses Repository ───────────────────────────────────
# Seit 2026-08-18 nennt der Fingerabdruck auch Pruefsummen fuer functions/src/.
# Die kann man nicht vom Webserver holen — der Server-Code wird nicht
# ausgeliefert, er laeuft. Nachrechenbar ist er trotzdem: gegen die Dateien in
# genau diesem Repository. Das beantwortet die Frage "ist der Code, den ich
# hier lese, wirklich der, aus dem ausgeliefert wurde?"
SERVER_ABWEICHUNG=0
SERVER_GEPRUEFT=0
if python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for pfad, summe in sorted(d.get('serverDateien', {}).items()):
    print(pfad + '\t' + summe)
" "$ARBEIT/build-info.json" > "$ARBEIT/server-soll.txt" 2>/dev/null && [ -s "$ARBEIT/server-soll.txt" ]; then
  while IFS="$(printf '\t')" read -r PFAD SOLL; do
    [ -z "$PFAD" ] && continue
    QUELLE="functions/src/$PFAD"
    if [ ! -f "$QUELLE" ]; then
      echo "  FEHLT im Repository: $QUELLE"
      SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      continue
    fi
    IST="sha256:$($SUMME "$QUELLE" | cut -d' ' -f1)"
    SERVER_GEPRUEFT=$((SERVER_GEPRUEFT + 1))
    if [ "$IST" != "$SOLL" ]; then
      echo "  ABWEICHUNG im Server-Code: $QUELLE"
      SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
    fi
  done < "$ARBEIT/server-soll.txt"
  echo "  Server-Code: $SERVER_GEPRUEFT Datei(en) gegen dieses Repository geprueft."
  echo "-----------------------------------------------------------"
fi

if [ "$GEPRUEFT" -eq 0 ]; then
  echo "MESSPROBLEM: keine einzige Datei geladen — vermutlich kein Netz." >&2
  exit 2
fi

if [ "$ABWEICHUNG" -eq 0 ] && [ "$FEHLEND" -eq 0 ] && [ "$SERVER_ABWEICHUNG" -eq 0 ]; then
  echo "ERGEBNIS: $GEPRUEFT von $ANZAHL Website-Dateien geprueft, alle deckungsgleich."
  if [ "$SERVER_GEPRUEFT" -gt 0 ]; then
    echo "          $SERVER_GEPRUEFT Server-Dateien in diesem Repository ebenfalls deckungsgleich."
  fi
  echo "Der ausgelieferte Stand entspricht Commit $COMMIT."
  exit 0
fi

echo "ERGEBNIS: $ABWEICHUNG Abweichung(en), $FEHLEND fehlend, bei $GEPRUEFT geprueften Dateien."
[ "$SERVER_ABWEICHUNG" -gt 0 ] && echo "          Dazu $SERVER_ABWEICHUNG Abweichung(en) im Server-Code."
echo "Der ausgelieferte Stand entspricht NICHT dem genannten Commit."
exit 1
