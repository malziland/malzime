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
#   2. prueft, ob dieser Commit im lokalen Repository existiert, und bildet
#      aus ihm SELBST die Liste der Dateien, die ausgeliefert sein muessen
#      (die Liste des Servers allein genuegt nicht — er koennte eine
#      veraenderte Datei einfach weglassen),
#   3. laedt jede dieser Dateien und jede vom Server genannte Datei und rechnet
#      sie gegen den Fingerabdruck UND gegen den Inhalt des Commits nach,
#   4. haelt die Pruefsummen des Server-Codes gegen denselben Commit,
#   5. meldet Uebereinstimmung oder nennt jede Abweichung beim Namen.
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

# ── 2b. Was MUESSTE ausgeliefert sein? Die Dateiliste des genannten Commits ──
# ARCH-2026-08-20-04: Welche Dateien geprueft werden, bestimmte bisher allein
# der Fingerabdruck — also der Server, der geprueft wird. Eine veraenderte
# Datei, die er dort weglaesst, wurde nie angesehen. Jetzt bildet das Skript
# die Liste selbst: aus dem genannten Commit, mit denselben Ausschluessen
# (hosting.ignore in firebase.json), nach denen scripts/build-info.mjs den
# Fingerabdruck schreibt. Ebenso fuer den Server-Code.
: > "$ARBEIT/erwartet.txt"
: > "$ARBEIT/server-erwartet.txt"
ERWARTET_ANZAHL=0
if [ "$COMMIT_DA" = "ja" ]; then
  python3 - "$COMMIT" "$ARBEIT" <<'PYTHON'
import json, re, subprocess, sys

commit, arbeit = sys.argv[1], sys.argv[2]


def git(*args):
    return subprocess.run(
        ["git", "-c", "core.quotepath=false", *args], check=True, capture_output=True
    ).stdout


try:
    konfig = json.loads(git("show", commit + ":firebase.json"))
    hosting = konfig["hosting"][0] if isinstance(konfig.get("hosting"), list) else konfig["hosting"]
    muster = hosting["ignore"]
    if not isinstance(muster, list):
        raise ValueError("hosting.ignore ist keine Liste")
except Exception as fehler:
    sys.stderr.write("MESSPROBLEM: firebase.json in Commit %s nicht lesbar (%s).\n" % (commit, fehler))
    sys.exit(2)


def passt(rel, m):
    # Dieselben Formen wie in scripts/build-info.mjs (passtAufMuster). Eine
    # unbekannte Form ist ein Messproblem: Raten wuerde still danebengreifen.
    teile = rel.split("/")
    if m == "firebase.json":
        return rel == "firebase.json"
    if m == "**/.*":
        return any(t.startswith(".") for t in teile)
    ordner = re.match(r"^\*\*/(.+)/\*\*$", m)
    if ordner:
        return ordner.group(1) in teile
    pfad_ordner = re.match(r"^(.+)/\*\*$", m)
    if pfad_ordner:
        return rel == pfad_ordner.group(1) or rel.startswith(pfad_ordner.group(1) + "/")
    if "*" not in m:
        return rel == m
    sys.stderr.write("MESSPROBLEM: unbekanntes Hosting-Muster in firebase.json: %s\n" % m)
    sys.exit(2)


def dateien(ordner):
    roh = git("ls-tree", "-r", "--name-only", "-z", commit, "--", ordner + "/").decode("utf-8")
    return [n[len(ordner) + 1 :] for n in roh.split("\0") if n]


website = [
    rel
    for rel in dateien("public")
    # Der Fingerabdruck kann sich nicht selbst enthalten.
    if rel != "build-info.json" and not any(passt(rel, m) for m in muster)
]
server = [
    rel
    for rel in dateien("functions/src")
    # Wie build-info.mjs: nur .js, ohne Tests und ohne mitgebrachte Pakete.
    if rel.endswith(".js") and not {"__tests__", "node_modules"} & set(rel.split("/")[:-1])
]
if not website:
    sys.stderr.write("MESSPROBLEM: Commit %s enthaelt keine auslieferbare Datei unter public/.\n" % commit)
    sys.exit(2)
open(arbeit + "/erwartet.txt", "w", encoding="utf-8").write("".join(z + "\n" for z in sorted(website)))
open(arbeit + "/server-erwartet.txt", "w", encoding="utf-8").write("".join(z + "\n" for z in sorted(server)))
PYTHON
  if [ $? -ne 0 ]; then
    echo "MESSPROBLEM: Dateiliste von Commit $COMMIT nicht ermittelbar." >&2
    exit 2
  fi
  ERWARTET_ANZAHL=$(grep -c . "$ARBEIT/erwartet.txt")
  echo "  Dateien laut Commit: $ERWARTET_ANZAHL"
fi
echo "-----------------------------------------------------------"

# ── 3. Jede Datei laden und nachrechnen ─────────────────────────────────────
# Geprueft wird die Vereinigung: was der Fingerabdruck nennt UND was der Commit
# verlangt. "-" in der zweiten Spalte heisst: Der Fingerabdruck nennt die Datei
# nicht.
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
soll = d['dateien']
erwartet = set(z.rstrip('\n') for z in open(sys.argv[2], encoding='utf-8') if z.strip())
for pfad in sorted(set(soll) | erwartet):
    print(pfad + '\t' + soll.get(pfad, '-'))
" "$ARBEIT/build-info.json" "$ARBEIT/erwartet.txt" > "$ARBEIT/soll.txt" || {
  echo "MESSPROBLEM: Dateiliste nicht lesbar." >&2
  exit 2
}

ABWEICHUNG=0
FEHLEND=0
GEPRUEFT=0
NICHT_GENANNT=0

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
  if [ "$SOLL" = "-" ]; then
    # Die Datei gehoert zum Commit, aber der Server fuehrt sie nicht im
    # Fingerabdruck. Das ist ein Befund fuer sich — und sie wird trotzdem
    # weiter unten gegen den Commit nachgerechnet.
    NICHT_GENANNT=$((NICHT_GENANNT + 1))
    if [ "$NICHT_GENANNT" -le 10 ]; then
      echo "  FEHLT IM FINGERABDRUCK: $PFAD — gehoert zu Commit $COMMIT, der Server nennt die Datei nicht."
    fi
  elif [ "$IST" != "$SOLL" ]; then
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

if [ "$NICHT_GENANNT" -gt 10 ]; then
  echo "  … und $((NICHT_GENANNT - 10)) weitere Datei(en) des Commits, die der Fingerabdruck nicht nennt."
fi

# ── Server-Code gegen den genannten Commit ────────────────────────────────
# Seit 2026-08-18 nennt der Fingerabdruck auch Pruefsummen fuer functions/src/.
# Die kann man nicht vom Webserver holen — der Server-Code wird nicht
# ausgeliefert, er laeuft. Nachrechenbar ist er trotzdem: gegen die Dateien des
# GENANNTEN COMMITS. Das beantwortet die Frage "ist der Code, den ich hier
# lese, wirklich der, aus dem ausgeliefert wurde?"
# ARCH-2026-08-20-04: Verglichen wird mit dem Commit, nicht mit dem, was gerade
# im Ordner liegt — sonst meldet ein Repository, das der Auslieferung einen
# Commit voraus ist, eine Abweichung, die keine ist. Und auch hier gilt die
# Liste des Commits: Ein Fingerabdruck ohne Server-Dateien, oder mit weniger,
# ist ein Befund.
SERVER_ABWEICHUNG=0
SERVER_GEPRUEFT=0
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for pfad, summe in sorted((d.get('serverDateien') or {}).items()):
    print(pfad + '\t' + summe)
" "$ARBEIT/build-info.json" > "$ARBEIT/server-soll.txt" 2>/dev/null || : > "$ARBEIT/server-soll.txt"

if [ "$COMMIT_DA" = "ja" ]; then
  SERVER_ERWARTET=$(grep -c . "$ARBEIT/server-erwartet.txt")
  if [ ! -s "$ARBEIT/server-soll.txt" ] && [ "$SERVER_ERWARTET" -gt 0 ]; then
    echo "  FEHLT IM FINGERABDRUCK: die Server-Dateien — Commit $COMMIT hat $SERVER_ERWARTET, der Server nennt keine."
    SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
  else
    # Erst: jede Datei des Commits muss genannt sein und stimmen.
    while IFS= read -r PFAD; do
      [ -z "$PFAD" ] && continue
      SOLL=$(awk -F '\t' -v p="$PFAD" '$1 == p { print $2 }' "$ARBEIT/server-soll.txt")
      if [ -z "$SOLL" ]; then
        echo "  FEHLT IM FINGERABDRUCK (Server-Code): functions/src/$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
        continue
      fi
      git show "${COMMIT}:functions/src/${PFAD}" > "$ARBEIT/server-datei" 2>/dev/null
      IST="sha256:$($SUMME "$ARBEIT/server-datei" | cut -d' ' -f1)"
      SERVER_GEPRUEFT=$((SERVER_GEPRUEFT + 1))
      if [ "$IST" != "$SOLL" ]; then
        echo "  ABWEICHUNG im Server-Code: functions/src/$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      fi
    done < "$ARBEIT/server-erwartet.txt"
    # Dann: nichts genannt, was der Commit nicht kennt.
    while IFS="$(printf '\t')" read -r PFAD SOLL; do
      [ -z "$PFAD" ] && continue
      if ! grep -qxF "$PFAD" "$ARBEIT/server-erwartet.txt"; then
        echo "  NICHT IM COMMIT (Server-Code): functions/src/$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      fi
    done < "$ARBEIT/server-soll.txt"
  fi
  echo "  Server-Code: $SERVER_GEPRUEFT Datei(en) gegen Commit $COMMIT geprueft."
  echo "-----------------------------------------------------------"
elif [ -s "$ARBEIT/server-soll.txt" ]; then
  # Ohne den Commit bleibt nur der Vergleich mit dem, was im Ordner liegt.
  while IFS="$(printf '\t')" read -r PFAD SOLL; do
    [ -z "$PFAD" ] && continue
    QUELLE="functions/src/$PFAD"
    if [ ! -f "$QUELLE" ]; then
      echo "  FEHLT in diesem Ordner: $QUELLE"
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
  echo "  Server-Code: $SERVER_GEPRUEFT Datei(en) gegen die Dateien in diesem Ordner geprueft."
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

if [ "$ABWEICHUNG" -eq 0 ] && [ "$FEHLEND" -eq 0 ] && [ "$SERVER_ABWEICHUNG" -eq 0 ] && [ "$REPO_ABWEICHUNG" -eq 0 ] && [ "$NICHT_GENANNT" -eq 0 ]; then
  echo "ERGEBNIS: $GEPRUEFT von $ANZAHL Website-Dateien geprueft, alle deckungsgleich"
  echo "          mit dem Fingerabdruck der Auslieferung."
  if [ "$SERVER_GEPRUEFT" -gt 0 ]; then
    echo "          $SERVER_GEPRUEFT Server-Dateien ebenfalls deckungsgleich."
  fi
  # ARCH-2026-08-20-04: Die Schlusszeile sagt jetzt genau so viel, wie gemessen
  # wurde. Ohne lokales Repository ist der Commit nur BENANNT, nicht geprueft —
  # vorher stand dort trotzdem "entspricht Commit X".
  if [ "$COMMIT_DA" = "ja" ] && [ "$REPO_GEPRUEFT" -gt 0 ]; then
    echo "          $REPO_GEPRUEFT Datei(en) zusaetzlich gegen den Inhalt von $COMMIT nachgerechnet;"
    echo "          der Commit verlangt $ERWARTET_ANZAHL Website-Dateien, keine fehlt im Fingerabdruck."
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
[ "$NICHT_GENANNT" -gt 0 ] && echo "          Dazu $NICHT_GENANNT Datei(en) des Commits, die der Fingerabdruck nicht nennt."
echo "Der ausgelieferte Stand entspricht NICHT dem genannten Commit."
exit 1
