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
#   4. haelt die Pruefsummen des Server-Pakets gegen denselben Commit — jede
#      Datei, die laut diesem Commit zu Google geht (das Programm unter
#      functions/src/, package.json, package-lock.json, die Sprachliste); auch
#      diese Liste bildet das Skript selbst aus dem Commit,
#   5. meldet Uebereinstimmung oder nennt jede Abweichung beim Namen.
#
# Aufruf:  sh scripts/pruefe-live.sh [basis-adresse]
#          Standard: https://malzi.me
#
# Braucht nur sh, curl, git und python3 — keine Installation, kein npm.
#
# Rueckgabewerte, bewusst getrennt:
#   0  alles deckungsgleich — und gegen den Inhalt des genannten Commits
#      nachgerechnet
#   1  BEFUND: mindestens eine Datei weicht ab
#   2  MESSPROBLEM: kein Netz, kein Werkzeug, Datei nicht lesbar — oder der
#      genannte Commit liess sich nicht gegenrechnen (dieses Repository kennt
#      ihn nicht, oder das Skript laeuft ausserhalb eines Repositories)
#      Ein Messfehler darf nie als Befund durchgehen (und umgekehrt) — und nie
#      als bestandene Pruefung.
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
REPO_DA=nein
REPO_GEPRUEFT=0
REPO_ABWEICHUNG=0
NUR_KENNUNG=0
if git rev-parse --git-dir >/dev/null 2>&1; then
  REPO_DA=ja
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
# Fingerabdruck schreibt. Ebenso fuer das Server-Paket: Was zu Google geht,
# bestimmt functions.ignore in der firebase.json DES COMMITS.
#
# Zwei Formen des Fingerabdrucks gibt es. Bis zum 05.10.2026 nannte er vom
# Server nur die .js-Dateien unter functions/src/ (Feld `serverDateien`);
# seither nennt er jede Datei des Server-Pakets (Feld `serverPaket`, Pfade
# relativ zum Quellordner des Pakets). Welche Form ein Stand SCHULDET, sagt
# nicht der Fingerabdruck — ihn schreibt der Server, der geprueft wird, und
# mit dem alten Feld allein waeren package.json, package-lock.json und die
# Sprachliste wieder ungeprueft. Es sagt der genannte Commit: Schreibt sein
# scripts/build-info.mjs das Feld `serverPaket`, muss es dastehen.
: > "$ARBEIT/erwartet.txt"
: > "$ARBEIT/server-erwartet.txt"
SERVER_FELD=serverDateien
SERVER_PRAEFIX="functions/src/"
SERVER_NAME="Server-Code"
ERWARTET_ANZAHL=0
if [ "$COMMIT_DA" = "ja" ]; then
  python3 - "$COMMIT" "$ARBEIT" <<'PYTHON'
import fnmatch, json, re, subprocess, sys

commit, arbeit = sys.argv[1], sys.argv[2]


def messproblem(text):
    sys.stderr.write("MESSPROBLEM: %s\n" % text)
    sys.exit(2)


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
if not website:
    sys.stderr.write("MESSPROBLEM: Commit %s enthaelt keine auslieferbare Datei unter public/.\n" % commit)
    sys.exit(2)


def server_paket():
    """Quellordner und Dateien des Server-Pakets, wie das Werkzeug sie aus
    diesem Commit bildete (firebase-tools: der ganze Ordner functions.source
    ohne das, was functions.ignore nennt)."""
    eintrag = konfig.get("functions")
    if isinstance(eintrag, list):
        eintrag = eintrag[0] if len(eintrag) == 1 else None
    if not isinstance(eintrag, dict) or not isinstance(eintrag.get("source"), str):
        messproblem("firebase.json in Commit %s nennt kein (einzelnes) functions.source." % commit)
    quelle = eintrag["source"].strip("/")
    if quelle.startswith("./"):
        quelle = quelle[2:]
    if not quelle or "." in quelle.split("/") or ".." in quelle.split("/"):
        messproblem("functions.source in Commit %s ist kein Ordner dieses Repositories: %s" % (commit, eintrag["source"]))
    ausschluesse = eintrag.get("ignore")
    if ausschluesse is None:
        # Die Vorgabe des Werkzeugs, wenn die Liste fehlt.
        ausschluesse = ["node_modules", ".git"]
    if not isinstance(ausschluesse, list):
        messproblem("functions.ignore in Commit %s ist keine Liste." % commit)
    # Was das Werkzeug in jedem Fall weglaesst.
    ausschluesse = list(ausschluesse) + ["firebase-debug.log", "firebase-debug.*.log", ".runtimeconfig.json"]
    for m in ausschluesse:
        # Verstanden wird EINE Form: der blosse Name, hoechstens mit Stern. Ihn
        # haelt das Werkzeug auf jeder Ebene gegen den Datei- oder Ordnernamen;
        # ein Ordner, der passt, bleibt samt Inhalt draussen. Jede andere Form
        # (Schraegstrich, Klammer, Ausrufezeichen) ist ein Messproblem: Raten
        # wuerde still danebengreifen.
        if not isinstance(m, str) or not re.fullmatch(r"[A-Za-z0-9_.*-]+", m):
            messproblem("unbekanntes Muster in functions.ignore der firebase.json: %s" % (m,))
    gefunden = []
    for zeile in git("ls-tree", "-r", "-z", commit, "--", quelle + "/").decode("utf-8").split("\0"):
        if not zeile:
            continue
        kopf, name = zeile.split("\t", 1)
        rel = name[len(quelle) + 1 :]
        if any(fnmatch.fnmatchcase(teil, m) for teil in rel.split("/") for m in ausschluesse):
            continue
        if "\n" in rel or "\t" in rel:
            # Die Listen dieses Skripts sind zeilen- und spaltenweise aufgebaut.
            messproblem("ein Dateiname unter %s/ in Commit %s enthaelt einen Zeilenumbruch oder Tabulator." % (quelle, commit))
        if kopf.split(" ")[0] not in ("100644", "100755"):
            # Ein Verweis (Symlink) oder ein Unter-Repository: Das Werkzeug
            # folgt ihm, git kennt nur das Ziel als Namen.
            messproblem("%s in Commit %s ist keine gewoehnliche Datei — das Server-Paket laesst sich daraus nicht bilden." % (name, commit))
        gefunden.append(rel)
    if not gefunden:
        messproblem("Commit %s enthaelt keine Datei fuer das Server-Paket unter %s/." % (commit, quelle))
    return quelle, gefunden


try:
    erzeuger = git("show", commit + ":scripts/build-info.mjs").decode("utf-8", "replace")
except subprocess.CalledProcessError:
    erzeuger = ""
if re.search(r"(?m)^\s*serverPaket\s*:", erzeuger):
    quelle, server = server_paket()
    form = ("serverPaket", quelle + "/", "Server-Paket")
else:
    server = [
        rel
        for rel in dateien("functions/src")
        # Die Form bis zum 05.10.2026: nur .js, ohne Tests und ohne mitgebrachte Pakete.
        if rel.endswith(".js") and not {"__tests__", "node_modules"} & set(rel.split("/")[:-1])
    ]
    form = ("serverDateien", "functions/src/", "Server-Code")
open(arbeit + "/erwartet.txt", "w", encoding="utf-8").write("".join(z + "\n" for z in sorted(website)))
open(arbeit + "/server-erwartet.txt", "w", encoding="utf-8").write("".join(z + "\n" for z in sorted(server)))
open(arbeit + "/server-form.txt", "w", encoding="utf-8").write("".join(z + "\n" for z in form))
PYTHON
  if [ $? -ne 0 ]; then
    echo "MESSPROBLEM: Dateiliste von Commit $COMMIT nicht ermittelbar." >&2
    exit 2
  fi
  ERWARTET_ANZAHL=$(grep -c . "$ARBEIT/erwartet.txt")
  echo "  Dateien laut Commit: $ERWARTET_ANZAHL"
  SERVER_FELD=$(sed -n '1p' "$ARBEIT/server-form.txt")
  SERVER_PRAEFIX=$(sed -n '2p' "$ARBEIT/server-form.txt")
  SERVER_NAME=$(sed -n '3p' "$ARBEIT/server-form.txt")
  if [ -z "$SERVER_FELD" ] || [ -z "$SERVER_PRAEFIX" ] || [ -z "$SERVER_NAME" ]; then
    echo "MESSPROBLEM: Form des Fingerabdrucks fuer Commit $COMMIT nicht ermittelbar." >&2
    exit 2
  fi
elif python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if isinstance(d.get('serverPaket'), dict) and d['serverPaket'] else 1)
" "$ARBEIT/build-info.json" 2>/dev/null; then
  # Ohne den Commit laesst sich nicht sagen, welche Form der Stand schuldet.
  # Gerechnet wird dann mit dem, was der Fingerabdruck nennt, gegen die Dateien
  # in diesem Ordner — das Ergebnis ist ohnehin nie eine bestandene Pruefung.
  SERVER_FELD=serverPaket
  SERVER_PRAEFIX="functions/"
  SERVER_NAME="Server-Paket"
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

# ── Server-Paket gegen den genannten Commit ───────────────────────────────
# Seit 2026-08-18 nennt der Fingerabdruck auch Pruefsummen fuer den Server.
# Die kann man nicht vom Webserver holen — der Server-Code wird nicht
# ausgeliefert, er laeuft. Nachrechenbar ist er trotzdem: gegen die Dateien des
# GENANNTEN COMMITS. Das beantwortet die Frage "ist der Code, den ich hier
# lese, wirklich der, aus dem ausgeliefert wurde?" Welches Feld gelesen wird
# und worauf sich seine Pfade beziehen, steht seit Abschnitt 2b fest
# (SERVER_FELD, SERVER_PRAEFIX).
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
for pfad, summe in sorted((d.get(sys.argv[2]) or {}).items()):
    print(pfad + '\t' + summe)
" "$ARBEIT/build-info.json" "$SERVER_FELD" > "$ARBEIT/server-soll.txt" 2>/dev/null || : > "$ARBEIT/server-soll.txt"

if [ "$COMMIT_DA" = "ja" ]; then
  SERVER_ERWARTET=$(grep -c . "$ARBEIT/server-erwartet.txt")
  if [ ! -s "$ARBEIT/server-soll.txt" ] && [ "$SERVER_ERWARTET" -gt 0 ]; then
    echo "  FEHLT IM FINGERABDRUCK: die Server-Dateien — Commit $COMMIT hat $SERVER_ERWARTET, der Server nennt keine (Feld $SERVER_FELD)."
    SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
  else
    # Erst: jede Datei des Commits muss genannt sein und stimmen.
    while IFS= read -r PFAD; do
      [ -z "$PFAD" ] && continue
      SOLL=$(awk -F '\t' -v p="$PFAD" '$1 == p { print $2 }' "$ARBEIT/server-soll.txt")
      if [ -z "$SOLL" ]; then
        echo "  FEHLT IM FINGERABDRUCK ($SERVER_NAME): $SERVER_PRAEFIX$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
        continue
      fi
      git show "${COMMIT}:${SERVER_PRAEFIX}${PFAD}" > "$ARBEIT/server-datei" 2>/dev/null
      IST="sha256:$($SUMME "$ARBEIT/server-datei" | cut -d' ' -f1)"
      SERVER_GEPRUEFT=$((SERVER_GEPRUEFT + 1))
      if [ "$IST" != "$SOLL" ]; then
        echo "  ABWEICHUNG im $SERVER_NAME: $SERVER_PRAEFIX$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      fi
    done < "$ARBEIT/server-erwartet.txt"
    # Dann: nichts genannt, was der Commit nicht kennt.
    while IFS="$(printf '\t')" read -r PFAD SOLL; do
      [ -z "$PFAD" ] && continue
      if ! grep -qxF "$PFAD" "$ARBEIT/server-erwartet.txt"; then
        echo "  NICHT IM COMMIT ($SERVER_NAME): $SERVER_PRAEFIX$PFAD"
        SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      fi
    done < "$ARBEIT/server-soll.txt"
  fi
  echo "  $SERVER_NAME: $SERVER_GEPRUEFT Datei(en) gegen Commit $COMMIT geprueft."
  echo "-----------------------------------------------------------"
elif [ -s "$ARBEIT/server-soll.txt" ]; then
  # Ohne den Commit bleibt nur der Vergleich mit dem, was im Ordner liegt.
  while IFS="$(printf '\t')" read -r PFAD SOLL; do
    [ -z "$PFAD" ] && continue
    QUELLE="$SERVER_PRAEFIX$PFAD"
    if [ ! -f "$QUELLE" ]; then
      echo "  FEHLT in diesem Ordner: $QUELLE"
      SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
      continue
    fi
    IST="sha256:$($SUMME "$QUELLE" | cut -d' ' -f1)"
    SERVER_GEPRUEFT=$((SERVER_GEPRUEFT + 1))
    if [ "$IST" != "$SOLL" ]; then
      echo "  ABWEICHUNG im $SERVER_NAME: $QUELLE"
      SERVER_ABWEICHUNG=$((SERVER_ABWEICHUNG + 1))
    fi
  done < "$ARBEIT/server-soll.txt"
  echo "  $SERVER_NAME: $SERVER_GEPRUEFT Datei(en) gegen die Dateien in diesem Ordner geprueft."
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
  # Den Commit, gegen den gerechnet wird, nennt der Server, der geprueft wird.
  # Laesst er sich nicht gegenrechnen, stammen Sollwerte und Dateien beide von
  # ihm: Das ist kein Nachweis und endet deshalb nie mit 0.
  echo "Der ausgelieferte Stand ist in sich schluessig; er nennt Commit $COMMIT."
  echo "MESSPROBLEM: Der genannte Commit wurde NICHT gegengerechnet — Sollwerte und" >&2
  echo "             Dateien stammen beide vom Server. Das ist keine bestandene Pruefung." >&2
  if [ "$REPO_DA" = "ja" ] && [ "$COMMIT_DA" != "ja" ]; then
    echo "             Dieses Repository kennt den Commit nicht: 'git fetch --all' ausfuehren," >&2
    echo "             dann erneut pruefen. Kennt es ihn danach immer noch nicht, nennt die" >&2
    echo "             Seite einen Stand, den es im veroeffentlichten Quelltext nicht gibt —" >&2
    echo "             das ist dann ein BEFUND." >&2
  elif [ "$REPO_DA" != "ja" ]; then
    echo "             Fuer den Nachweis in einer Kopie des Repositories laufen lassen" >&2
    echo "             (git clone, dann erneut)." >&2
  fi
  exit 2
fi

echo "ERGEBNIS: $ABWEICHUNG Abweichung(en), $FEHLEND fehlend, bei $GEPRUEFT geprueften Dateien."
[ "$SERVER_ABWEICHUNG" -gt 0 ] && echo "          Dazu $SERVER_ABWEICHUNG Abweichung(en) im $SERVER_NAME."
[ "$REPO_ABWEICHUNG" -gt 0 ] && echo "          Dazu $REPO_ABWEICHUNG Abweichung(en) gegenueber dem Inhalt von $COMMIT."
[ "$NICHT_GENANNT" -gt 0 ] && echo "          Dazu $NICHT_GENANNT Datei(en) des Commits, die der Fingerabdruck nicht nennt."
echo "Der ausgelieferte Stand entspricht NICHT dem genannten Commit."
exit 1
