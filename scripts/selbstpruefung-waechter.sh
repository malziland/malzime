#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# selbstpruefung-waechter.sh — prueft die drei Waechter, die das
# Repository selbst untersuchen.
#
# WARUM NEBEN scripts/pruefungen/ UND NICHT DARIN: Jenes Verzeichnis ist eine
# vendorierte Kopie aus dem Skill-Verzeichnis — dort gehoert nichts Eigenes
# hinein, sonst meldet der Vendorierungs-Waechter zu Recht eine ungestempelte
# Datei. (Am 31.08. genau so passiert; der Waechter hat den Push angehalten.)
#
# WARUM EINE EIGENE DATEI: `pruefungen/selbstpruefung.sh` arbeitet mit vorbereiteten
# Verzeichnissen (kaputt/sauber) und ruft Pruefungen aus `checks/` auf. Die
# drei Waechter hier untersuchen dagegen das laufende Repository — sie
# brauchen echte Aenderungen, keine Beispieldateien.
#
# ANLASS, 31.08.2026: Ein Pruefer ohne Vorwissen fand, dass zwei der drei
# Waechter gruen meldeten, ohne etwas gemessen zu haben:
#   · pruefe-deploy-riegel.py bestand ein deploy.sh, das die Riegel nur als
#     KOMMENTARE enthielt.
#   · pruefe-mitzieher.py hatte eine Regel mit leerer Begleiter-Liste, die per
#     Konstruktion nie anschlagen konnte.
# Beide Fehler waren behoben — aber nichts hielt sie fest. Genau das tut diese
# Datei: Was von Hand geprueft wurde, wird wiederholbar.
#
# JEDE PROBE PRUEFT BEIDE RICHTUNGEN. Nur zu testen, dass ein Waechter rot
# werden kann, ist die haelfte: Einer, der IMMER rot ist, besteht das auch.
#
# Aufruf:  bash scripts/selbstpruefung-waechter.sh
# Exit 0 = alle Waechter verhalten sich in beide Richtungen richtig.
# ---------------------------------------------------------------------------
# Wer die Datei mit `sh` aufruft, bekommt sonst nur "Illegal option -o
# pipefail" — eine Meldung, die nicht sagt, was zu tun ist.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Diese Pruefung braucht bash (sie nutzt pipefail und Funktionen mit" >&2
  echo "Rueckgabewert). Aufruf:  bash scripts/selbstpruefung-waechter.sh" >&2
  exit 2
fi

# BASH, NICHT SH: `pipefail` gibt es in dash nicht, und dash ist auf
# Ubuntu-Runnern das, worauf `sh` zeigt. Lokal auf macOS faellt das nicht auf —
# dort ist `sh` gleich bash. Der Fehler zeigte sich erst in der Pipeline:
# "set: Illegal option -o pipefail" (31.08.2026).
set -uo pipefail

WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
FEHLER=0
PROBEN=0
BERUEHRT=""

cd "$WURZEL" || exit 2

# ── SICHERHEIT ZUERST (Befund 31.08.2026, Pruefer A) ──
#
# Diese Pruefung veraendert echte Dateien im Arbeitsbaum: Sie baut Riegel aus,
# verschiebt Grenzen, legt Felder an — und stellt danach wieder her. Vorher
# sicherte sie in ein Verzeichnis aus `mktemp`, das ein EXIT-Trap loeschte.
# Bei Strg+C lief dieser Trap MIT: Die Sicherung war weg, die verstuemmelte
# Datei blieb. Und das bei jedem Push, im echten Repository.
#
# Zwei Aenderungen:
#
#   1. Wiederhergestellt wird ueber `git checkout --`, nicht ueber eine Kopie.
#      Das ueberlebt jeden Abbruch, weil die Quelle im Repository liegt.
#   2. Es laeuft NUR bei sauberem Arbeitsbaum. Sonst wuerde ein Rueckbau
#      fremde, ungespeicherte Arbeit mitloeschen — genau das, was hier
#      verhindert werden soll.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Uebersprungen: Der Arbeitsbaum ist nicht sauber."
  echo ""
  echo "  Diese Pruefung veraendert Dateien und stellt sie ueber git wieder"
  echo "  her. Bei ungespeicherten Aenderungen wuerde sie diese mitloeschen."
  echo "  Erst committen oder aufraeumen, dann erneut laufen lassen."
  echo ""
  echo "  (Kein Fehler — aber auch KEIN Beleg. Rueckgabewert 2.)"
  # OPS-2026-08-31-12 (Befund B-7): Hier stand `exit 0`. Der Aufrufer
  # vor-dem-push.sh zeigt die Ausgabe bei Rueckgabewert 0 nicht an — es
  # erschien also "ok  Waechter-Selbstpruefung", obwohl NICHTS geprueft worden
  # war. Ein uebersprungener Lauf darf nicht wie ein bestandener aussehen.
  # 2 heisst hier wie ueberall: nicht messbar.
  exit 2
fi

# Stellt bei JEDEM Ende wieder her, auch bei Strg+C und bei einem Fehler
# mittendrin. `git checkout --` braucht keine externe Kopie.
wiederherstellen() {
  [ -z "$BERUEHRT" ] && return 0
  # shellcheck disable=SC2086
  git checkout -- $BERUEHRT 2>/dev/null
}
trap wiederherstellen EXIT INT TERM

# Fuehrt eine Pruefung aus und vergleicht ihren Rueckgabewert mit dem
# erwarteten. Der Wert wird UNMITTELBAR aufgefangen — nicht erst in einer
# Folgezeile, wo ein zwischengeschobener Befehl ihn ueberschreiben koennte.
#
# $1 = erwarteter Rueckgabewert, $2 = Beschreibung, ab $3 der Befehl.
probe() {
  ERWARTET="$1"; WAS="$2"; shift 2
  PROBEN=$((PROBEN + 1))
  AUSGABE="$("$@" 2>&1)"
  IST=$?
  if [ "$IST" -eq "$ERWARTET" ]; then
    echo "  ja    $WAS (Rueckgabe $IST wie erwartet)"
    return 0
  fi
  echo "  NEIN  $WAS (Rueckgabe $IST, erwartet $ERWARTET)"
  printf '%s\n' "$AUSGABE" | tail -6 | sed 's/^/          /'
  FEHLER=$((FEHLER + 1))
  return 1
}

# OPS-2026-08-31-11: Wie `probe`, prueft aber ZUSAETZLICH die Ausgabe.
#
# BEFUND 31.08.2026: `probe 2 "fehlende Datei meldet NICHT MESSBAR"` bestand
# auch dann, wenn der Waechter GAR NICHT MEHR EXISTIERTE — Python liefert bei
# einem fehlenden Skript ebenfalls Rueckgabewert 2. Die Probe mass also nur,
# dass irgendetwas eine 2 zurueckgibt, nicht dass der Waechter richtig
# entscheidet. Ein Rueckgabewert allein ist bei Rueckgabewert 2 kein Beleg.
# BEFUND 31.08.2026 (Runde 4): Wie `probe_text`, aber OHNE Rueckgabewert.
#
# Die drei Bildspeicher-Proben verlangten Rueckgabe 0 bzw. 1 vom GESAMTEN
# verify-infrastructure.sh. In der Pipeline gibt es keine gcloud-Anmeldung —
# dort melden 14 andere Abschnitte rot, das Skript endet immer mit 1, und der
# Pflicht-Check `pruefungen` waere gerissen. Auf dem Entwicklerrechner faellt
# das nicht auf, weil dort eine Anmeldung besteht.
#
# Geprueft wird deshalb nur, was der Bildspeicher-Abschnitt SAGT. Genau darum
# geht es bei diesen drei Proben; der Gesamtzustand der Infrastruktur ist eine
# andere Frage.
probe_ausgabe() {
  MUSTER="$1"; NICHT="$2"; WAS="$3"; shift 3
  PROBEN=$((PROBEN + 1))
  AUSGABE="$("$@" 2>&1)"
  if printf '%s' "$AUSGABE" | grep -qE "$MUSTER" && ! printf '%s' "$AUSGABE" | grep -qE "$NICHT"; then
    echo "  ja    $WAS"
    return 0
  fi
  echo "  NEIN  $WAS"
  echo "        erwartet: '$MUSTER', nicht erwartet: '$NICHT'"
  printf '%s\n' "$AUSGABE" | grep -iE "bildspeicher|bilder" | sed 's/^/          /' | head -3
  FEHLER=$((FEHLER + 1))
  return 1
}

probe_text() {
  ERWARTET="$1"; MUSTER="$2"; WAS="$3"; shift 3
  PROBEN=$((PROBEN + 1))
  AUSGABE="$("$@" 2>&1)"
  IST=$?
  if [ "$IST" -eq "$ERWARTET" ] && printf '%s' "$AUSGABE" | grep -qE "$MUSTER"; then
    echo "  ja    $WAS (Rueckgabe $IST, Text passt)"
    return 0
  fi
  if [ "$IST" -ne "$ERWARTET" ]; then
    echo "  NEIN  $WAS (Rueckgabe $IST, erwartet $ERWARTET)"
  else
    echo "  NEIN  $WAS (Rueckgabe stimmt, aber die Ausgabe nennt nicht '$MUSTER' —"
    echo "        das passiert auch, wenn der Waechter gar nicht laeuft)"
  fi
  printf '%s\n' "$AUSGABE" | tail -6 | sed 's/^/          /'
  FEHLER=$((FEHLER + 1))
  return 1
}

# Merkt sich, welche Datei angefasst wurde — der Trap oben stellt sie her.
sichern() { BERUEHRT="$BERUEHRT $1"; }
zurueck() { git checkout -- "$1" 2>/dev/null; }

echo "── Selbstpruefung der Repository-Waechter ──"
echo

# ═══════════════════════════════════════════════════════════════════════════
echo "1. pruefe-deploy-riegel.py"

# UMGEBAUT 31.08.2026: Der Waechter prueft keine Riegel mehr, sondern nur noch
# zwei Dinge, bei denen es wirklich um Text geht — dass jeder Notschalter in
# der Schlussbilanz genannt wird, und die concurrency-Einstellung der Pipeline.
#
# Die Riegel selbst prueft jetzt deploy-verhalten.test.js, indem es deploy.sh
# AUSFUEHRT. Die frueheren Proben hier (entfernte Aufraeumfalle, Trockenlauf
# als Kommentar, Meldung ohne Abbruch) sind dorthin gewandert und liegen dort
# als acht Rueckbauproben vor. Sie hier zu wiederholen hiesse, wieder
# Textmuster zu pruefen.
probe 0 "sauberes deploy.sh besteht" python3 scripts/pruefe-deploy-riegel.py

sichern scripts/deploy.sh
python3 - <<'PYSELF'
s = open("scripts/deploy.sh").read()
# Ein Notschalter, der in der Schlussbilanz NICHT genannt wird: genau der Fall,
# in dem ein Lauf gruen aussieht, obwohl eine Pruefung uebersprungen wurde.
s = s.replace("UEBERSPRUNGEN SKIP_SMOKE", "erledigt", 1)
open("scripts/deploy.sh", "w").write(s)
PYSELF
probe 1 "Notschalter ohne Eintrag in der Schlussbilanz wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck scripts/deploy.sh

echo

echo "2b. verify-infrastructure.sh — Bildspeicher"

# BEFUND 31.08.2026 (Runde 5, von beiden Pruefern): Diese drei Proben riefen
# das Infrastruktur-Skript mit vollem PATH auf — gemessen 42 gcloud- und drei
# curl-Aufrufe gegen das Produktivprojekt JE LAUF, dazu drei Lesezugriffe auf
# config/betriebsprofil. Und das Skript haengt ueber vor-dem-push.sh an JEDEM
# Push. Dieselbe Luecke wurde am selben Tag in verify-infrastructure-script.
# test.js geschlossen, im Schwesterskript nicht.
#
# Attrappen kosten hier nichts: Geprueft wird ohnehin nur, was der
# Bildspeicher-Abschnitt SAGT — die uebrigen Abschnitte sind fuer diese drei
# Proben ohne Belang.
ATTRAPPEN_BIN="$(mktemp -d)"
for W in gcloud gsutil curl node; do
  printf '#!/bin/sh\necho "ATTRAPPE %s: kein Zugriff in der Selbstpruefung" >&2\nexit 1\n' "$W" \
    > "$ATTRAPPEN_BIN/$W"
  chmod +x "$ATTRAPPEN_BIN/$W"
done
PATH_OHNE_CLOUD="$ATTRAPPEN_BIN:$PATH"
: > /tmp/probe-leer.txt
INFRA_PROBE_BILDER=/tmp/probe-leer.txt INFRA_PROBE_BILDER_CODE=1 \
INFRA_PROBE_BILDER_FEHLER="CommandException: One or more URLs matched no objects." \
  probe_ausgabe "Keine Bilder aelter" "Bildspeicher nicht lesbar" \
  "leerer Bucket ist der SOLLZUSTAND, nicht ein Fehler" \
  env PATH="$PATH_OHNE_CLOUD" bash scripts/verify-infrastructure.sh

INFRA_PROBE_BILDER=/tmp/probe-leer.txt INFRA_PROBE_BILDER_CODE=1 \
INFRA_PROBE_BILDER_FEHLER="AccessDeniedException: 403 Forbidden" \
  probe_ausgabe "Bildspeicher nicht lesbar" "Keine Bilder aelter" \
  "echter Zugriffsfehler wird gemeldet" \
  env PATH="$PATH_OHNE_CLOUD" bash scripts/verify-infrastructure.sh

printf '    123456  2026-08-30T05:00:00Z  gs://x/queue-uploads/alt.jpg\n' > /tmp/probe-alt.txt
INFRA_PROBE_BILDER=/tmp/probe-alt.txt INFRA_PROBE_BILDER_CODE=0 \
  probe_ausgabe "aelter als 3 Stunden" "Keine Bilder aelter" \
  "liegengebliebene Bilder werden gefunden" \
  env PATH="$PATH_OHNE_CLOUD" bash scripts/verify-infrastructure.sh
rm -f /tmp/probe-leer.txt /tmp/probe-alt.txt
rm -rf "$ATTRAPPEN_BIN"

echo

# BEFUND 31.08.2026 (Runde 4, E-6): pruefe-kopplung.py kam in dieser Datei
# GAR NICHT vor — waehrend Dateikopf, ci.yml und CHANGELOG behaupteten, alle
# Waechter pruefen sich selbst. Der Waechter ueber den Waechtern hatte einen
# blinden Fleck von der Groesse eines ganzen Werkzeugs.
echo "2c. pruefe-kopplung.py"

probe 0 "eingehaltene Grenzen bestehen" python3 scripts/pruefe-kopplung.py

sichern scripts/pruefe-kopplung.py
python3 - <<'PYSELF'
s = open("scripts/pruefe-kopplung.py").read()
# Eine Grenze so weit senken, dass die Datei sie reisst.
s = s.replace('"functions/src/mistral.js": ', '"functions/src/mistral.js": 1, #', 1)
open("scripts/pruefe-kopplung.py", "w").write(s)
PYSELF
probe 1 "gerissene Groessengrenze wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck scripts/pruefe-kopplung.py

echo

echo "3. pruefe-mitzieher.py"

probe 0 "unveraenderter Baum besteht" python3 scripts/pruefe-mitzieher.py HEAD

# Der Befund vom 31.08.: Ein Cache-Buster-PR darf NICHT blockiert werden.
for f in $(git ls-files 'public/*.html' | head -3); do
  sichern "$f"
  printf '\n<!-- Selbstpruefung -->\n' >> "$f"
done
probe 0 "geaenderte (nicht neue) Seiten blockieren nicht" python3 scripts/pruefe-mitzieher.py HEAD
for f in $(git ls-files 'public/*.html' | head -3); do zurueck "$f"; done

# Und der Fall, fuer den er gebaut wurde.
sichern functions/src/betriebsprofil.js
python3 - <<'PY'
s = open("functions/src/betriebsprofil.js").read()
marke = "  parallelitaet: { min: 1, max: 100 },"
open("functions/src/betriebsprofil.js", "w").write(
    s.replace(marke, marke + "\n  selbstpruefungFeld: { min: 1, max: 9 },", 1))
PY
probe 1 "neues Pflichtfeld ohne Begleiter wird gefunden" python3 scripts/pruefe-mitzieher.py HEAD
zurueck functions/src/betriebsprofil.js

echo
echo "── Ergebnis ──"
if [ "$FEHLER" -eq 0 ]; then
  # BEFUND 31.08.2026 (Pruefrunde 3): Hier stand nur die gezaehlte Zahl. Wer die
  # Datei auf EINE positive Probe zusammenstrich, bekam "Alle 1 Proben
  # bestanden. Die Waechter messen in beide Richtungen." — eine Aussage ueber
  # alle Waechter, gestuetzt auf eine einzige Messung. Kein anderer Waechter
  # merkte es. Deshalb steht die erwartete Zahl jetzt HIER und wird verglichen.
  #
  # Beim Ergaenzen einer Probe: Zahl hochsetzen. Das ist Absicht — eine Probe
  # verschwindet damit nicht mehr unbemerkt.
  ERWARTETE_PROBEN=10
  if [ "$PROBEN" -ne "$ERWARTETE_PROBEN" ]; then
    echo "  NICHT MESSBAR: $PROBEN Proben gelaufen, $ERWARTETE_PROBEN erwartet."
    echo "  Es fehlen welche, oder die Zahl oben wurde nicht nachgezogen."
    echo "  Eine Selbstpruefung mit fehlenden Proben belegt nichts."
    exit 2
  fi
  echo "  Alle $PROBEN Proben bestanden. Die Waechter messen in beide Richtungen."
  exit 0
fi
echo "  $FEHLER von $PROBEN Proben fehlgeschlagen."
echo "  Ein Waechter, der nicht rot werden kann, ist schlimmer als keiner."
exit 1
