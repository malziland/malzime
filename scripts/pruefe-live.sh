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
COMMIT_DA=nein
REPO_GEPRUEFT=0
REPO_ABWEICHUNG=0
NUR_KENNUNG=0
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
    echo "  Commit im Repository: ja"
    COMMIT_DA=ja
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

TRANSPORT=0

while IFS="$(printf '\t')" read -r PFAD SOLL; do
  [ -z "$PFAD" ] && continue
  # BUG-2026-08-20-08: Vorher galt JEDER gescheiterte Abruf als "FEHLT auf dem
  # Server" und damit als Befund (Exit 1). Ein abgebrochenes Netz, ein Zeitablauf
  # oder ein 5xx sahen damit aus wie eine manipulierte Auslieferung. curl
  # unterscheidet das: Rueckgabewert 22 ist eine echte HTTP-Fehlerantwort
  # (404 -> die Datei fehlt wirklich), alles andere ist ein Transportproblem und
  # damit ein MESSproblem.
  CURL_FEHLER=$(curl -fsS "$BASIS/$PFAD" -o "$ARBEIT/datei" 2>&1) || CURL_RC=$?
  CURL_RC=${CURL_RC:-0}
  if [ "$CURL_RC" -ne 0 ]; then
    if [ "$CURL_RC" -eq 22 ]; then
      echo "  FEHLT auf dem Server: $PFAD"
      FEHLEND=$((FEHLEND + 1))
    else
      echo "  NICHT MESSBAR: $PFAD (curl-Rueckgabewert $CURL_RC: ${CURL_FEHLER:-Transportfehler})"
      TRANSPORT=$((TRANSPORT + 1))
    fi
    CURL_RC=0
    continue
  fi
  IST="sha256:$($SUMME "$ARBEIT/datei" | cut -d' ' -f1)"
  GEPRUEFT=$((GEPRUEFT + 1))
  if [ "$IST" != "$SOLL" ]; then
    echo "  ABWEICHUNG: $PFAD"
    echo "      erwartet: $SOLL"
    echo "      gefunden: $IST"
    ABWEICHUNG=$((ABWEICHUNG + 1))
    continue
  fi
  # ARCH-2026-08-20-04: Bis hierher hat nur der Server gegen sich selbst gerechnet
  # — Sollwerte und Dateien kommen beide von malzi.me. Wer die Auslieferung
  # kontrolliert, kontrolliert beides. Erst der Vergleich gegen den GENANNTEN
  # COMMIT im lokalen Repository macht die Schlussaussage belegbar.
  if [ "$COMMIT_DA" = "ja" ]; then
    REPOPFAD="public/$PFAD"
    if git cat-file -e "${COMMIT}:${REPOPFAD}" 2>/dev/null; then
      REPO_GEPRUEFT=$((REPO_GEPRUEFT + 1))
      git show "${COMMIT}:${REPOPFAD}" > "$ARBEIT/repo-datei" 2>/dev/null
      if [ "sha256:$($SUMME "$ARBEIT/repo-datei" | cut -d' ' -f1)" != "$IST" ]; then
        # Die Cache-Kennung (?v=JJJJMMTTNN) schreibt das Deploy-Skript VOR der
        # Auslieferung in die Seiten; committet wird sie erst danach. Genau diese
        # Differenz ist erwartbar und kein Hinweis auf fremden Code — sie wird
        # benannt statt verschwiegen. Alles andere ist eine echte Abweichung.
        OHNE_LIVE=$(sed 's/?v=[0-9]\{10\}/?v=KENNUNG/g' "$ARBEIT/datei" | $SUMME | cut -d' ' -f1)
        OHNE_REPO=$(sed 's/?v=[0-9]\{10\}/?v=KENNUNG/g' "$ARBEIT/repo-datei" | $SUMME | cut -d' ' -f1)
        if [ "$OHNE_LIVE" = "$OHNE_REPO" ]; then
          NUR_KENNUNG=$((NUR_KENNUNG + 1))
        else
          echo "  ABWEICHUNG zum Commit: $PFAD (Inhalt, nicht nur die Cache-Kennung)"
          REPO_ABWEICHUNG=$((REPO_ABWEICHUNG + 1))
        fi
      fi
    else
      echo "  NICHT IM COMMIT: $PFAD — die Datei wird ausgeliefert, steht aber nicht in $COMMIT."
      REPO_ABWEICHUNG=$((REPO_ABWEICHUNG + 1))
    fi
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
if [ "$TRANSPORT" -gt 0 ]; then
  echo "MESSPROBLEM: $TRANSPORT Datei(en) waren nicht abrufbar (Netz/Server, kein HTTP 404)." >&2
  echo "             Ein unvollstaendiger Lauf ist kein bestandener Lauf — erneut versuchen." >&2
  exit 2
fi

if [ "$ABWEICHUNG" -eq 0 ] && [ "$FEHLEND" -eq 0 ] && [ "$SERVER_ABWEICHUNG" -eq 0 ] && [ "$REPO_ABWEICHUNG" -eq 0 ]; then
  echo "ERGEBNIS: $GEPRUEFT von $ANZAHL Website-Dateien geprueft, alle deckungsgleich"
  echo "          mit dem Fingerabdruck der Auslieferung."
  if [ "$SERVER_GEPRUEFT" -gt 0 ]; then
    echo "          $SERVER_GEPRUEFT Server-Dateien in diesem Repository ebenfalls deckungsgleich."
  fi
  # ARCH-2026-08-20-04: Die Schlusszeile sagt jetzt genau so viel, wie gemessen
  # wurde. Ohne lokales Repository ist der Commit nur BENANNT, nicht geprueft —
  # vorher stand dort trotzdem "entspricht Commit X".
  if [ "$COMMIT_DA" = "ja" ] && [ "$REPO_GEPRUEFT" -gt 0 ]; then
    echo "          $REPO_GEPRUEFT Datei(en) zusaetzlich gegen den Inhalt von $COMMIT nachgerechnet."
    if [ "$NUR_KENNUNG" -gt 0 ]; then
      echo "          Davon $NUR_KENNUNG nur in der Cache-Kennung abweichend (?v=…): Die schreibt"
      echo "          das Deploy-Skript vor der Auslieferung, committet wird sie unmittelbar danach."
    fi
    echo "Der ausgelieferte Stand entspricht Commit $COMMIT."
    exit 0
  fi
  echo "Der ausgelieferte Stand ist in sich schluessig; er nennt Commit $COMMIT."
  echo "ACHTUNG: Dieser Commit wurde NICHT gegengerechnet — Sollwerte und Dateien"
  echo "         stammen beide vom Server. Fuer den vollen Nachweis in einer Kopie"
  echo "         des Repositories laufen lassen (git clone, dann erneut)."
  exit 0
fi

echo "ERGEBNIS: $ABWEICHUNG Abweichung(en), $FEHLEND fehlend, bei $GEPRUEFT geprueften Dateien."
[ "$SERVER_ABWEICHUNG" -gt 0 ] && echo "          Dazu $SERVER_ABWEICHUNG Abweichung(en) im Server-Code."
[ "$REPO_ABWEICHUNG" -gt 0 ] && echo "          Dazu $REPO_ABWEICHUNG Abweichung(en) gegenueber dem Inhalt von $COMMIT."
echo "Der ausgelieferte Stand entspricht NICHT dem genannten Commit."
exit 1
