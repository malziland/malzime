#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# selbstpruefung-waechter.sh — prueft die Waechter, die das
# Repository selbst untersuchen.
#
# WARUM NEBEN scripts/pruefungen/ UND NICHT DARIN: Jenes Verzeichnis ist eine
# vendorierte Kopie aus dem Skill-Verzeichnis — dort gehoert nichts Eigenes
# hinein, sonst meldet der Vendorierungs-Waechter zu Recht eine ungestempelte
# Datei. (Am 31.08. genau so passiert; der Waechter hat den Push angehalten.)
#
# WARUM EINE EIGENE DATEI: `pruefungen/selbstpruefung.sh` arbeitet mit vorbereiteten
# Verzeichnissen (kaputt/sauber) und ruft Pruefungen aus `checks/` auf. Die
# die Waechter hier untersuchen dagegen das laufende Repository — sie
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
# BEFUND 01.09.2026 (Runde 6, J-2): Beide Wiederherstellungen warfen ihren
# Rueckgabewert weg. Scheitert `git checkout --`, meldete diese Datei weiter
# "Alle 10 Proben bestanden" und Rueckgabewert 0 — und liess sechs SABOTIERTE
# Dateien im Arbeitsbaum stehen, darunter deploy.sh ohne einen Notschalter in
# der Schlussbilanz. Gemessen mit einer git-Attrappe, die nur `checkout`
# scheitern laesst. Sie laeuft ueber den pre-push-Hook bei JEDEM Push.
#
# Eine Selbstpruefung, die ihre eigenen Eingriffe nicht zurueckdrehen kann,
# richtet mehr Schaden an als sie verhindert.
wiederherstellen() {
  [ -z "$BERUEHRT" ] && return 0
  # shellcheck disable=SC2086
  if ! git checkout -- $BERUEHRT; then
    echo "" >&2
    echo "  ✘ WIEDERHERSTELLUNG GESCHEITERT." >&2
    echo "    Diese Pruefung veraendert Dateien und stellt sie danach zurueck." >&2
    echo "    Das ist eben NICHT gelungen. Betroffen:" >&2
    printf '      %s\n' $BERUEHRT >&2
    echo "    Bitte pruefen: git status" >&2
    exit 3
  fi
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

# BEFUND 01.09.2026 (Pruefrunde 8, M-P3): Diese Funktion war definiert und
# wurde NIE aufgerufen — alle negativen Proben verglichen nur den
# Rueckgabewert. Ein abgestuerzter Waechter liefert aber auch 1, und der
# Absturz haette als "Befund gefunden" gezaehlt. Genau die Fehlerform, gegen
# die diese Datei gebaut ist, in ihr selbst.
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
zurueck() {
  if ! git checkout -- "$1"; then
    echo "  ✘ WIEDERHERSTELLUNG GESCHEITERT fuer $1 — Abbruch." >&2
    exit 3
  fi
}

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
probe_text 1 "FEHLT|Schlussbilanz" "Notschalter ohne Eintrag in der Schlussbilanz wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck scripts/deploy.sh

# Befund G-10 (30.09.2026): Der Nachtlauf darf nicht still entfallen — weder
# ohne Zeitplan noch mit einer Pruefung, deren Rueckgabewert verschluckt wird.
sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
s = s.replace('  schedule:\n    - cron: "43 3 * * *"', "", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "kein taeglicher Zeitplan" "Nachtlauf ohne Zeitplan wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
s = s.replace("node scripts/pruefe-abkuendigungen.mjs", "node scripts/pruefe-abkuendigungen.mjs || true", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "statt genau" "Pruefung mit '|| true' im Nachtlauf wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

# Befund H-01/H-02 (30.09.2026): Alarm-Job und Nachbau-Vergleich sind per
# Pruefsumme festgeschrieben — eine Stilllegung dort muss auffallen.
sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
s = s.replace("priority: 5", "priority: 3", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "sicherheit-nachts.yml weicht" "abgeschwaechter Alarm im Nachtlauf wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

sichern .github/workflows/libheif-bau.yml
python3 - <<'PYSELF'
p = ".github/workflows/libheif-bau.yml"
s = open(p).read()
s = s.replace("          exit $abweichung", "          exit 0", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "libheif-bau.yml weicht" "entwaffneter Herkunftsvergleich wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/libheif-bau.yml

# Befund J-01 (30.09.2026): Umgehungen, die die erste Fassung des Vertrags
# durchliess — ein "exit 0" mit "uses:" im Kommentar und eine Kommentarzeile
# mitten in einem mehrzeiligen Befehl.
sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
s = s.replace('          if [ -z "$NTFY_URL" ]', '          exit 0 # uses: nichts\n          if [ -z "$NTFY_URL" ]', 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "sicherheit-nachts.yml weicht" "'exit 0 # uses:' im Alarm wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
s = s.replace("          BODY=$(jq -n", "          # zwischengeschoben\n          BODY=$(jq -n", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "sicherheit-nachts.yml weicht" "Kommentarzeile im mehrzeiligen Befehl wird gefunden" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

# Befund K-01 (Runde 4, 30.09.2026): Aenderungen, die die Datei fuer GitHub
# UNLESBAR machen — ein Kommentar mit zu wenig Einzug mitten im mehrzeiligen
# Ausdruck, eine Kommentarzeile, deren Einzug ein geschuetztes Leerzeichen ist
# (aus einer kopierten Zeile). Beide Schichten muessen anschlagen: der Leser
# (Zeichen, Groesse, YAML-Syntax) und die Pruefsumme.
sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
alt = "      always() && github.ref == 'refs/heads/main'"
assert s.count(alt) == 1, "Anker der Probe fehlt"
s = s.replace(alt, "    # Anmerkung zur Bedingung\n" + alt, 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "UNLESBAR" "Kommentar mit zu wenig Einzug im Ausdruck: Datei unlesbar" node scripts/pruefe-workflows-gueltig.mjs
probe_text 1 "sicherheit-nachts.yml weicht" "... und die Pruefsumme schlaegt an" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
alt = "      - run: node scripts/pruefe-abkuendigungen.mjs"
assert s.count(alt) == 1, "Anker der Probe fehlt"
s = s.replace(alt, "\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0# kopierte Anmerkung\n" + alt, 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "UNLESBAR" "geschuetztes Leerzeichen als Einzug: Datei unlesbar" node scripts/pruefe-workflows-gueltig.mjs
probe_text 1 "sicherheit-nachts.yml weicht" "... und die Pruefsumme schlaegt an" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

# Befund N-01 (Runde 5, 01.10.2026): Zeichen, die YAML 1.2 erlaubt, GitHubs
# Server-Leser aber ablehnt — eine Leerzeile nur aus einem Tab, ein
# Zeilentrenner U+2028 in einer Kopfkommentarzeile (dort laesst sich sogar ein
# Schluessel einschleusen). Beide waren in der ersten Fassung beider Schichten
# gruen.
sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
alt = "\njobs:\n"
assert s.count(alt) == 1, "Anker der Probe fehlt"
s = s.replace(alt, "\n\t\njobs:\n", 1)
open(p, "w").write(s)
PYSELF
probe_text 1 "Tab" "Leerzeile nur aus einem Tab: Datei unlesbar" node scripts/pruefe-workflows-gueltig.mjs
probe_text 1 "sicherheit-nachts.yml weicht" "... und die Pruefsumme schlaegt an" python3 scripts/pruefe-deploy-riegel.py
zurueck .github/workflows/sicherheit-nachts.yml

sichern .github/workflows/sicherheit-nachts.yml
python3 - <<'PYSELF'
p = ".github/workflows/sicherheit-nachts.yml"
s = open(p).read()
z = s.split("\n")
i = next(n for n, zeile in enumerate(z) if zeile.startswith("#"))
z[i] = z[i] + "\u2028if: false"
open(p, "w").write("\n".join(z))
PYSELF
probe_text 1 "Zeilentrenner" "Zeilentrenner U+2028 im Kommentar: Datei unlesbar" node scripts/pruefe-workflows-gueltig.mjs
zurueck .github/workflows/sicherheit-nachts.yml

echo

echo "2. verify-infrastructure.sh — Bildspeicher"

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
echo "3. pruefe-kopplung.py"

probe 0 "eingehaltene Grenzen bestehen" python3 scripts/pruefe-kopplung.py

sichern scripts/pruefe-kopplung.py
python3 - <<'PYSELF'
s = open("scripts/pruefe-kopplung.py").read()
# Eine Grenze so weit senken, dass die Datei sie reisst.
s = s.replace('"functions/src/mistral.js": ', '"functions/src/mistral.js": 1, #', 1)
open("scripts/pruefe-kopplung.py", "w").write(s)
PYSELF
probe_text 1 "Grenze|ueberschritten" "gerissene Groessengrenze wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck scripts/pruefe-kopplung.py

# TEST-2026-10-03-44: Der Waechter sieht auch die oberste Ebene von public/ und
# die eigenen Skripte. Drei Proben: Das Einstiegs-Skript der Website waechst
# ueber seine Grenze; und je eine Datei aus den zwei neuen Bereichen verliert
# ihren Eintrag — dann muss die Nachsuche sie als "ohne Grenze" melden.
sichern public/app.js
python3 - <<'PYSELF'
s = open("public/app.js").read()
open("public/app.js", "w").write(s + "".join("// Probe %d\n" % i for i in range(600)))
PYSELF
probe_text 1 "public/app.js: [0-9]+ Zeilen" "gewachsenes Einstiegs-Skript der Website wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck public/app.js

for OHNE_EINTRAG in scripts/deploy.sh public/styles.css; do
  sichern scripts/pruefe-kopplung.py
  OHNE_EINTRAG="$OHNE_EINTRAG" python3 - <<'PYSELF'
import os, re
ziel = os.environ["OHNE_EINTRAG"]
s = open("scripts/pruefe-kopplung.py").read()
neu, anzahl = re.subn(r'\n    "%s": \d+,' % re.escape(ziel), "", s)
assert anzahl == 1, ziel
open("scripts/pruefe-kopplung.py", "w").write(neu)
PYSELF
  probe_text 1 "OHNE GRENZE +[0-9]+ +$OHNE_EINTRAG" "Datei ohne Grenze wird gefunden: $OHNE_EINTRAG" python3 scripts/pruefe-kopplung.py
  zurueck scripts/pruefe-kopplung.py
done

# TEST-2026-10-04-28: Eine Testdatei, die verschwindet, faellt auf — auch wenn
# sie nicht in der Liste der unverzichtbaren Pruefungen steht. Und umgekehrt:
# Eine Testdatei, die im Bestand fehlt, ebenso (sonst waere sie ungeschuetzt).
sichern functions/src/__tests__/upload.test.js
rm functions/src/__tests__/upload.test.js
probe_text 1 "TESTDATEI FEHLT" "geloeschte Testdatei ausserhalb der Pflichtliste wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck functions/src/__tests__/upload.test.js

sichern scripts/testdateien-bestand.txt
python3 - <<'PYSELF'
s = open("scripts/testdateien-bestand.txt").read()
# Eine Zeile streichen: Die Datei gibt es weiter, im Bestand fehlt sie.
assert "public/__tests__/state.test.js\n" in s
open("scripts/testdateien-bestand.txt", "w").write(s.replace("public/__tests__/state.test.js\n", "", 1))
PYSELF
probe_text 1 "NICHT IM BESTAND" "Testdatei ohne Eintrag im Bestand wird gefunden" python3 scripts/pruefe-kopplung.py
zurueck scripts/testdateien-bestand.txt

echo

echo "4. pruefe-mitzieher.py"

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
probe_text 1 "vergessen|Begleiter|fehlt" "neues Pflichtfeld ohne Begleiter wird gefunden" python3 scripts/pruefe-mitzieher.py HEAD
zurueck functions/src/betriebsprofil.js

echo

# BEFUND 01.09.2026 (Runde 7, L-5): Der Waechter ist neu — und ein neuer
# Waechter ohne eigene Probe ist genau die Luecke, gegen die diese Datei
# gebaut wurde. Die Probe legt eine ignorierte Datei unter public/ an, die
# firebase.json NICHT ausschliesst: Firebase wuerde sie ausliefern, git zeigt
# sie nirgends.
echo "5. pruefe-auslieferbare-reste.mjs"

probe 0 "sauberes public/ besteht" node scripts/pruefe-auslieferbare-reste.mjs

RESTE_PROBE="public/selbstpruefung-rest.json"
sichern .gitignore
echo "$RESTE_PROBE" >> .gitignore
printf '{"probe":1}' > "$RESTE_PROBE"
probe_text 1 "wuerden ausgeliefert|ERGEBNIS: [1-9]" "ignorierte, auslieferbare Datei wird gefunden" node scripts/pruefe-auslieferbare-reste.mjs
rm -f "$RESTE_PROBE"
zurueck .gitignore

# OSS-2026-10-04-13: Der Waechter braucht minimatch — als eigene Abhaengigkeit
# der Wurzel, nicht als Mitbringsel eines anderen Pakets.
sichern package.json
python3 - <<'PYSELF'
import re
s = open("package.json").read()
neu, anzahl = re.subn(r'\n\s*"minimatch": "[^"]*",', "", s)
assert anzahl == 1
open("package.json", "w").write(neu)
PYSELF
probe_text 2 "nicht als eigene Abhaengigkeit" "minimatch nur noch als Mitbringsel: nicht messbar" node scripts/pruefe-auslieferbare-reste.mjs
zurueck package.json

echo

# BEFUND 01.09.2026 (Punkt 2 des Umbaus): Von elf Waechtern hatten nur vier
# eine Probe hier. Fuer die uebrigen gab es KEINEN Beleg, dass sie ueberhaupt
# rot werden koennen — sie meldeten seit Wochen gruen, und niemand hatte je
# gemessen, ob das etwas bedeutet. Ein Waechter ohne Probe ist eine
# Behauptung. Die folgenden fuenf schliessen die Luecke.

echo "6. pruefe-doppelte-werte.py"

probe 0 "einfach gefuehrte Werte bestehen" python3 scripts/pruefe-doppelte-werte.py

sichern functions/src/config.js
python3 - <<'PYSELF'
# Einen Betriebswert, der im Einstellungssatz steht, zusaetzlich fest in den
# Code schreiben — genau die Doppelung, gegen die der Waechter gebaut ist.
s = open("functions/src/config.js").read()
open("functions/src/config.js", "w").write(
    s + "\n// Selbstpruefung: absichtliche Doppelung\nconst RATE_LIMIT = 155;\n")
PYSELF
probe_text 1 "zweite Definition|Einstellungssatz" "doppelt gefuehrter Betriebswert wird gefunden" python3 scripts/pruefe-doppelte-werte.py
zurueck functions/src/config.js

echo

echo "7. pruefe-i18n-fallbacks.py"

probe 0 "uebereinstimmende Texte bestehen" python3 scripts/pruefe-i18n-fallbacks.py

sichern public/index.html
python3 - <<'PYSELF'
# Den sichtbaren Text von seiner Sprachdatei abweichen lassen. Genau dieser
# Fall ist am 21.08. real aufgetreten: Im HTML stand ein anderer Satz als in
# der Sprachdatei, und wer die Seite ohne Uebersetzung sah, las den falschen.
s = open("public/index.html").read()
s = s.replace('data-i18n="hero.title">Wir sehen mehr als dein Foto.',
              'data-i18n="hero.title">Selbstpruefung: abweichender Text.', 1)
open("public/index.html", "w").write(s)
PYSELF
probe_text 1 "weicht ab|Abweichung|stimmt nicht" "abweichender sichtbarer Text wird gefunden" python3 scripts/pruefe-i18n-fallbacks.py
zurueck public/index.html

echo

echo "8. pruefe-tote-geduld.py"

probe 0 "Wartezeiten unter dem Zeitlimit bestehen" python3 scripts/pruefe-tote-geduld.py

sichern e2e/ansagen.test.js
python3 - <<'PYSELF'
# Eine Wartezeit ueber das Zeitlimit des Tests setzen: Der Test kann dann
# NIE durchlaufen — er reisst die Reissleine, bevor die Wartezeit um ist.
s = open("e2e/ansagen.test.js").read()
s = s.replace("waitForTimeout(900)", "waitForTimeout(99000)", 1)
open("e2e/ansagen.test.js", "w").write(s)
PYSELF
probe_text 1 "TOTE GEDULD|wirkungslose Wartezeit" "Wartezeit ueber dem Zeitlimit wird gefunden" python3 scripts/pruefe-tote-geduld.py
zurueck e2e/ansagen.test.js

echo

echo "9. pruefe-fremddateien.mjs"

probe 0 "unveraenderte Fremddateien bestehen" node scripts/pruefe-fremddateien.mjs

# Die Schluessel in PRUEFSUMMEN.json sind bereits vollstaendige Pfade
# ("public/fonts/..."), kein Zusatz noetig. Die erste Fassung setzte "public/"
# davor und fand deshalb nichts — die Probe meldete "nicht messbar" statt zu
# messen. Genau die Fehlerform, gegen die diese Datei gebaut ist.
FREMD="$(node -e "
const j=require('./public/lib/PRUEFSUMMEN.json');
const k=Object.keys(j.dateien||j).filter((n) => /\.(js|css|txt)$/.test(n));
process.stdout.write(k[0]||'');
" 2>/dev/null)"
if [ -n "$FREMD" ] && [ -f "$FREMD" ]; then
  sichern "$FREMD"
  printf '\n/* Selbstpruefung */\n' >> "$FREMD"
  probe_text 1 "ABWEICHUNG|abweich" "veraenderte Fremddatei wird gefunden" node scripts/pruefe-fremddateien.mjs
  zurueck "$FREMD"
else
  echo "  ?     Fremddatei-Sabotage NICHT MESSBAR (keine Datei in PRUEFSUMMEN.json gefunden)"
  echo "        Eine uebersprungene Probe ist kein Beleg — hier ist der Grund."
  FEHLER=$((FEHLER + 1))
fi

echo

echo "10. pruefe-vendorierung.mjs"

probe 0 "unveraenderte Kopien bestehen" node scripts/pruefe-vendorierung.mjs

sichern scripts/pruefungen/checks/aussentext.py
printf '\n# Selbstpruefung: Kopie veraendert\n' >> scripts/pruefungen/checks/aussentext.py
probe_text 1 "Kopie stimmt nicht mehr" "bearbeitete vendorierte Kopie wird gefunden" node scripts/pruefe-vendorierung.mjs
zurueck scripts/pruefungen/checks/aussentext.py

echo

# BEFUND 01.09.2026 (Pruefrunde 8, M-P1-1): pruefe-mutationen.mjs war der
# EINZIGE neue Waechter ohne Probe hier — und ausgerechnet er meldete in der
# Pipeline 100 % gruen, ohne einen Test ausgefuehrt zu haben. Ein Waechter
# ohne Probe ist eine Behauptung; bei einem Waechter, der ueber die Guete
# ALLER Tests urteilt, ist es eine gefaehrliche.
echo "11. pruefe-commit-nachrichten.sh"

probe 0 "saubere Commit-Nachrichten bestehen" sh scripts/pruefe-commit-nachrichten.sh
probe_text 1 "RECHTSRISIKO-FORMULIERUNG|FUND" "heikle Formulierung wird gefunden (Probe)" sh scripts/pruefe-commit-nachrichten.sh --probe "docs: Patentlage erklaert, Rechtsrisiko getragen"

echo

echo "12. pruefe-mutationen.mjs"

probe 0 "die Eichung besteht" node scripts/pruefe-mutationen.mjs --eichung

# Die entscheidende Probe: Kann das Werkzeug ueberhaupt keine Tests starten,
# darf es KEIN Urteil faellen. Nachgestellt mit einem PATH, der `node`
# enthaelt (sonst startet das Werkzeug selbst nicht), aber KEIN `npx` — genau
# die Lage im CI-Job ohne Pakete.
OHNE_NPX="$(mktemp -d)"
ln -s "$(command -v node)" "$OHNE_NPX/node"
probe 2 "ohne ausfuehrbare Tests faellt es kein Urteil" \
  env PATH="$OHNE_NPX" node scripts/pruefe-mutationen.mjs functions/src/notify.js
rm -rf "$OHNE_NPX"

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
  # 39 seit 01.10.2026: dreizehn Proben fuer die Sicherheits-Workflows
  # (Zeitplan, '|| true', Alarm, Herkunftsvergleich, 'exit 0 # uses:',
  # Kommentarzeile im Befehl, vier unlesbare Dateien gegen Leser und
  # Pruefsumme — die mit U+2028 im Kopfkommentar nur gegen den Leser, denn
  # Kommentare ausserhalb von Bloecken zaehlen in der Summe bewusst nicht).
  # 45 seit 07.10.2026: zwei Proben fuer den Bestand der Testdateien, eine
  # fuer die eigene Abhaengigkeit des Paket-Waechters, drei fuer die neuen
  # Bereiche des Struktur-Waechters.
  ERWARTETE_PROBEN=45
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
