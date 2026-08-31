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
ABLAGE="$(mktemp -d)"
FEHLER=0
PROBEN=0

trap 'rm -rf "$ABLAGE"' EXIT

cd "$WURZEL" || exit 2

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

sichern() { cp "$1" "$ABLAGE/$(basename "$1").sicher"; }
zurueck() { cp "$ABLAGE/$(basename "$1").sicher" "$1"; }

echo "── Selbstpruefung der Repository-Waechter ──"
echo

# ═══════════════════════════════════════════════════════════════════════════
echo "1. pruefe-deploy-riegel.py"

probe 0 "sauberes deploy.sh besteht" python3 scripts/pruefe-deploy-riegel.py

sichern scripts/deploy.sh
python3 - <<'PY'
s = open("scripts/deploy.sh").read()
open("scripts/deploy.sh", "w").write(s.replace("trap aufraeumen_bei_abbruch EXIT", "# entfernt", 1))
PY
probe 1 "entfernte Aufraeumfalle wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck scripts/deploy.sh

# Der Befund vom 31.08.: Kommentare duerfen nicht als Riegel zaehlen.
sichern scripts/deploy.sh
python3 - <<'PY'
s = open("scripts/deploy.sh").read()
s = s.replace('  if ! firebase deploy --only firestore:malzime-eu --dry-run',
              '  if ! echo ueberhaupt-kein-trockenlauf', 1)
s = s.replace('  if ! firebase deploy --only "$TARGET" --dry-run',
              '  if ! echo auch-keiner', 1)
open("scripts/deploy.sh", "w").write(s)
PY
probe 1 "Trockenlauf nur noch als Kommentar wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck scripts/deploy.sh

echo

# ═══════════════════════════════════════════════════════════════════════════
echo "2. pruefe-kopplung.py"

probe 0 "Dateien innerhalb ihrer Grenzen bestehen" python3 scripts/pruefe-kopplung.py

sichern scripts/pruefe-kopplung.py
python3 - <<'PY'
import re
s = open("scripts/pruefe-kopplung.py").read()
s = re.sub(r'"functions/src/jobs\.js": \d+', '"functions/src/jobs.js": 10', s)
open("scripts/pruefe-kopplung.py", "w").write(s)
PY
probe 1 "ueberschrittene Grenze wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck scripts/pruefe-kopplung.py

# Der wichtigste Fall: eine Datei aus der Liste verschwindet.
sichern scripts/pruefe-kopplung.py
python3 - <<'PY'
s = open("scripts/pruefe-kopplung.py").read()
s = s.replace('"functions/src/jobs.js"', '"functions/src/gibt-es-nicht.js"', 1)
open("scripts/pruefe-kopplung.py", "w").write(s)
PY
probe 2 "fehlende Datei meldet NICHT MESSBAR statt gruen" python3 scripts/pruefe-kopplung.py
zurueck scripts/pruefe-kopplung.py

echo

# ═══════════════════════════════════════════════════════════════════════════
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
  echo "  Alle $PROBEN Proben bestanden. Die Waechter messen in beide Richtungen."
  exit 0
fi
echo "  $FEHLER von $PROBEN Proben fehlgeschlagen."
echo "  Ein Waechter, der nicht rot werden kann, ist schlimmer als keiner."
exit 1
