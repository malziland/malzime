#!/usr/bin/env bash
# malziME Deploy-Script
# Fuehrt Lint + Unit-Tests aus, aktualisiert Cache-Busting-Versionen
# (Konvention ?v=YYYYMMDDNN) und deployed auf Firebase.
#
# Nutzung:
#   ./scripts/deploy.sh              # Hosting + Functions
#   ./scripts/deploy.sh hosting      # Nur Hosting
#   ./scripts/deploy.sh functions    # Nur Functions
#
#   SKIP_TESTS=1 ./scripts/deploy.sh # Test-Guard ueberspringen (nur im Notfall!)

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Einmaliges Infra-Setup (NICHT Teil des regulaeren Deploys) ──
# Die GCS-Lifecycle-Regel, die zwischengespeicherte Bilder als Sicherheitsnetz
# nach 1 Tag loescht, wird von `firebase deploy` NICHT mit ausgerollt. Sie muss
# beim ersten Setup (oder einem Bucket-Neuaufbau) EINMAL gesetzt werden:
#   gsutil lifecycle set storage-lifecycle.json gs://malzime-queue-uploads
# Pruefen:  gsutil lifecycle get gs://malzime-queue-uploads
# (Stand 2026-06-06 verifiziert: Regel am Produktiv-Bucket aktiv.)

# ── OPS-2026-08-13-43: Stand-Bindung — deployt wird nur, was die CI freigab ──
# Der Deploy liefert den ARBEITSBAUM aus (`firebase deploy`), prüfte aber
# nirgends, ob dieser Stand der von der CI freigegebene ist. Sein Test-Guard ist
# zudem eine echte Teilmenge der sechs Pflicht-Checks (es fehlen e2e,
# secret-scan, audit-gate, format:check und der ganze pruefungen-Job inkl. der
# Fremddatei-Prüfsummen, die exifr bewachen). Statt diese Riegel lokal zu
# doppeln, wird an die CI-Freigabe gebunden: sauberer Baum, HEAD == origin/main,
# und für HEAD müssen alle Pflicht-Checks grün sein. Notschalter SKIP_STAND=1,
# laut wie die anderen.
if [ "${SKIP_STAND:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_STAND=1 gesetzt — Stand-Bindung an die CI-Freigabe wird UEBERSPRUNGEN."
else
  if [ -n "$(git status --porcelain)" ]; then
    echo "FEHLER: Arbeitsbaum nicht sauber — es würde ungeprüfter Code ausgeliefert." >&2
    echo "        Erst committen/aufräumen, dann deployen. Notschalter: SKIP_STAND=1" >&2
    exit 1
  fi
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "FEHLER: HEAD != origin/main — der lokale Stand ist nicht der freigegebene." >&2
    echo "        Erst mergen/pullen, dann deployen. Notschalter: SKIP_STAND=1" >&2
    exit 1
  fi
  if command -v gh >/dev/null 2>&1; then
    SHA=$(git rev-parse HEAD)
    # Die sechs Pflicht-Checks müssen für DIESEN Commit success sein. Fehlt ein
    # Ergebnis (Lauf noch nicht durch), ist das kein Freibrief — dann Abbruch.
    PFLICHT="test-backend test-frontend test-e2e secret-scan playwright-version pruefungen"
    LAGE=$(gh api "repos/malziland/malzime/commits/$SHA/check-runs" \
      --jq '.check_runs[] | "\(.name)=\(.conclusion // "pending")"' 2>/dev/null || true)
    if [ -z "$LAGE" ]; then
      echo "FEHLER: CI-Ergebnis für $SHA nicht abrufbar — Abbruch statt Deploy auf Verdacht." >&2
      echo "        Notschalter: SKIP_STAND=1" >&2
      exit 1
    fi
    for CHECK in $PFLICHT; do
      if ! printf '%s\n' "$LAGE" | grep -qx "${CHECK}=success"; then
        echo "FEHLER: Pflicht-Check ${CHECK} ist fuer $SHA nicht grün (Ist: $(printf '%s\n' "$LAGE" | grep "^${CHECK}=" || echo "fehlt"))." >&2
        echo "        Notschalter: SKIP_STAND=1" >&2
        exit 1
      fi
    done
    echo "Stand-Bindung: HEAD == origin/main, alle sechs Pflicht-Checks grün für $SHA."
  else
    echo "WARNUNG: gh nicht verfügbar — CI-Freigabe nicht prüfbar, nur sauberer Baum + HEAD==origin/main geprüft."
  fi
fi

# ── Test-Guard: Lint + Unit-Tests muessen gruen sein (Deploy-Konvention) ──
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_TESTS=1 gesetzt — Lint und Tests werden UEBERSPRUNGEN."
else
  npm run lint
  npm test --prefix functions
  npm run test:frontend
fi

# ── OPS-2026-08-12-25: Riegel gegen ein unbekanntes Auslieferungswerkzeug ──
# Die Firebase-CLI ist global installiert und war an keine Version gebunden:
# Ein beilaeufiges `npm i -g firebase-tools` haette den Deploy-Weg still
# veraendert, ohne dass irgendwo etwas rot wird — und nirgends stand, mit
# welcher Version je ausgeliefert wurde.
#
# Bewusst NICHT nach package.json verschoben: `npx firebase` scheitert, wenn
# firebase-tools nicht im Projekt liegt (Begruendung weiter unten), und ein
# Werkzeug dieser Groesse im Abhaengigkeitsbaum waere der schlechtere Tausch.
# Stattdessen: gemessen, protokolliert, mit Untergrenze.
#
# Untergrenze anheben, wenn ein Deploy eine neuere Version tatsaechlich
# gebraucht hat — nicht auf Verdacht. Diese Zeile ist die einzige Quelle
# dieser Zahl; die Doku verweist hierher.
FIREBASE_MIN="15.1.0"
if [ "${SKIP_CLI_CHECK:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_CLI_CHECK=1 gesetzt — Versionspruefung der CLI wird UEBERSPRUNGEN."
else
  FIREBASE_IST="$(firebase --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  # Fail-closed: Eine nicht ermittelbare Version ist ausdruecklich kein
  # bestandener Riegel. Leer ist zuerst ein Verdacht gegen die Messung.
  if [ -z "$FIREBASE_IST" ]; then
    echo "FEHLER: Version der Firebase-CLI nicht ermittelbar (\`firebase --version\` lieferte nichts)." >&2
    echo "        Ohne bekanntes Werkzeug kein Deploy. Notschalter: SKIP_CLI_CHECK=1" >&2
    exit 1
  fi
  if [ "$(printf '%s\n%s\n' "$FIREBASE_MIN" "$FIREBASE_IST" | sort -V | head -1)" != "$FIREBASE_MIN" ]; then
    echo "FEHLER: Firebase-CLI $FIREBASE_IST ist aelter als die Untergrenze $FIREBASE_MIN." >&2
    echo "        Aktualisieren mit: npm i -g firebase-tools" >&2
    exit 1
  fi
  echo "Firebase-CLI: $FIREBASE_IST (Untergrenze $FIREBASE_MIN)"
fi

# ── Infra-Riegel: Ist-Zustand der Cloud gegen den RUNBOOK-Soll-Zustand ──
# Nur lesend (Queue, Bucket, Firestore, Worker-IAM, Regionen, Logging).
# Notschalter fuer den Ernstfall (z. B. gcloud-Anmeldung abgelaufen und ein
# dringender Rollback darf nicht warten): SKIP_INFRA=1
if [ "${SKIP_INFRA:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_INFRA=1 gesetzt — Infrastruktur-Pruefung wird UEBERSPRUNGEN."
else
  ./scripts/verify-infrastructure.sh
fi

# ── Deploy-Ziel bestimmen ──
# KURZAUDIT-Befund OPS-2026-08-13-34: Das Ziel muss VOR dem Buster-Block
# feststehen. Vorher lief der Buster bei jedem Aufruf — ein reiner
# Functions-Deploy veraenderte sechs Hosting-Dateien, die dann unausgeliefert
# im Arbeitsbaum lagen. Rutscht so etwas in einen Commit, behauptet das
# Repository einen Buster-Stand, der nie online war.
TARGET="${1:-hosting,functions}"

# ── Cache-Busting-Version generieren (Konvention: ?v=YYYYMMDDNN) ──
# Aktuellen Buster aus index.html lesen; am selben Tag laufende Nummer +1,
# sonst neuer Tag mit laufender Nummer 01. NUR wenn Hosting wirklich
# ausgeliefert wird — der Buster gehoert zur Auslieferung der Seiten, nicht
# zum Aufruf des Skripts.
VERSION="(kein Hosting-Deploy — Buster unveraendert)"
if [[ ",$TARGET," == *",hosting,"* ]]; then
TODAY=$(date +"%Y%m%d")
CURRENT=$(grep -o 'styles\.css?v=[0-9]*' public/index.html | head -1 | grep -o '[0-9]*$' || true)
# OPS-2026-08-13-47: Ein leeres CURRENT (Muster nicht getroffen — Datei
# umbenannt, Attributreihenfolge geändert, Konvention angepasst) fiel vorher
# still in den else-Zweig und setzte ...01 — bei einem zweiten Deploy des Tages
# eine BEREITS vergebene Nummer, Clients behalten dann alte Dateien im Cache.
# Leer ist ein Messfehler, kein gültiger erster Deploy des Tages.
if [ -z "$CURRENT" ]; then
  echo "FEHLER: Cache-Buster in public/index.html nicht lesbar (Muster styles.css?v=… nicht getroffen)." >&2
  echo "        Konvention geändert? Erst prüfen, nicht blind auf ...01 zurückfallen." >&2
  exit 1
fi
if [ "${#CURRENT}" -eq 10 ] && [ "${CURRENT:0:8}" = "$TODAY" ]; then
  NEXT=$((10#${CURRENT:8:2} + 1))
  if [ "$NEXT" -gt 99 ]; then
    echo "FEHLER: 99 Hosting-Deploys heute erreicht — die 2-stellige Buster-Nummer läuft über." >&2
    echo "Das ist praktisch nie ein echter Fall; falls doch, Konvention manuell erweitern." >&2
    exit 1
  fi
  VERSION=$(printf "%s%02d" "$TODAY" "$NEXT")
else
  VERSION="${TODAY}01"
fi
echo "Cache-Busting-Version: ?v=$VERSION"

# Alle Dateien mit ?v=-Verweisen aktualisieren: die fuenf HTML-Seiten UND
# public/js/demo.js — dort haengen die Buster der grossen Demo-Bilder.
# demo.js fehlte hier bis zum Kurzaudit 2026-08-11 (OPS-106): Sein Buster
# blieb drei Deploys lang auf einem alten Stand stehen.
#
# OPS-2026-08-13-01: Das Muster hiess bis 2026-08-13 [0-9]* und erlaubte damit
# NULL Ziffern. Getroffen wurde also auch ein nacktes ?v= in gewoehnlichem
# Fliesstext; der Kommentar ueber DEMO_BUSTER in public/js/demo.js wurde beim
# Deploy vom 2026-08-12 stillschweigend verunstaltet. [0-9][0-9]* verlangt
# mindestens eine Ziffer (BRE, kein + — bash 3.2 auf macOS kennt es nicht).
for f in public/index.html public/datenschutz.html public/impressum.html public/nutzungsbedingungen.html public/barrierefreiheit.html public/stats.html public/js/demo.js; do
  if [ -f "$f" ]; then
    # BUG-009: Cross-platform sed (macOS + Linux)
    if sed --version >/dev/null 2>&1; then
      sed -i "s/\?v=[0-9][0-9]*/\?v=$VERSION/g" "$f"
    else
      sed -i '' "s/\?v=[0-9][0-9]*/\?v=$VERSION/g" "$f"
    fi
    echo "  $f aktualisiert"
  fi
done
fi

echo ""
echo "Deploy-Ziel: $TARGET"
echo "Weiter? (Enter = ja, Ctrl+C = abbrechen)"
read -r

# Global installierte CLI bevorzugen. `npx firebase` scheitert, wenn firebase-tools
# nicht im Projekt liegt: npm versucht dann einen Registry-Abruf und bricht mit
# "could not determine executable to run" ab. Genau daran ist das Skript zuletzt
# gescheitert — vermutlich der eigentliche Grund, warum es seit dem 2026-07-29
# nicht mehr benutzt wurde und die Deploys stattdessen von Hand liefen
# (Audit 2026-08-10, OPS-001).
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only "$TARGET"
else
  npx firebase deploy --only "$TARGET"
fi

# ── Live-Beweis: vier kostenfreie Proben gegen die frisch deployte Produktion ──
# (endet vor KI-Aufruf und Stundenzähler; Notschalter SKIP_SMOKE=1)
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_SMOKE=1 gesetzt — Live-Smoke wird UEBERSPRUNGEN."
else
  # OPS-2026-08-13-42: Bei Hosting im Ziel bekommt der Smoke die erwartete
  # Buster-Version und liest sie live zurück. Bei reinem Functions-Deploy gibt
  # es keinen neuen Buster — dann ohne Argument (nur die vier Verhaltensproben).
  if [[ ",$TARGET," == *",hosting,"* ]]; then
    ./scripts/live-smoke.sh "$VERSION"
  else
    ./scripts/live-smoke.sh
  fi
fi

# ── OPS-2026-08-13-48: Schlussbilanz der übersprungenen Riegel ──
# KERN 12: Ein Ausnahmeweg muss bei JEDEM Lauf mitausgegeben werden, sonst ist
# er eine Abschaltung mit Tarnkappe. Die einzelnen WARNUNG-Zeilen scrollen hinter
# der Deploy-Ausgabe weg; hier stehen sie gebündelt am Ende.
UEBERSPRUNGEN=""
[ "${SKIP_STAND:-0}" = "1" ]     && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_STAND"
[ "${SKIP_TESTS:-0}" = "1" ]     && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_TESTS"
[ "${SKIP_CLI_CHECK:-0}" = "1" ] && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_CLI_CHECK"
[ "${SKIP_INFRA:-0}" = "1" ]     && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_INFRA"
[ "${SKIP_SMOKE:-0}" = "1" ]     && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_SMOKE"

echo ""
if [ -n "$UEBERSPRUNGEN" ]; then
  echo "Deploy abgeschlossen. Version: ?v=$VERSION — ⚠ ÜBERSPRUNGENE RIEGEL:$UEBERSPRUNGEN"
else
  echo "Deploy abgeschlossen. Version: ?v=$VERSION — alle Riegel gelaufen."
fi

# ── OPS-2026-08-18-01: Der Versionsschnitt darf nicht vergessen werden ──
# Dreimal an einem Tag ausgeliefert, dreimal die Nummer nicht gesetzt: GitHub
# meldete v3.3.2 beziehungsweise v3.4.0, waehrend live schon mehr stand. Das
# Repository behauptet dann WENIGER, als ausgeliefert ist — wer den Stand
# nachlesen will, wird in die Irre gefuehrt.
#
# Warum als Schlusshinweis und nicht als Riegel VOR dem Deploy: Steht die Nummer
# schon vor dem Merge im CHANGELOG, legt release.yml den Release an, sobald der
# Merge auf main landet — also rund acht Minuten VOR der Auslieferung. Die
# Reihenfolge muss bleiben: erst ausliefern, dann die Nummer setzen. Der
# richtige Ort dafuer ist der Cache-Buster-PR, der ohnehin nach jedem Deploy
# faellig ist.
OBERSTE="$(sh scripts/changelog-oberste-version.sh CHANGELOG.md 2>/dev/null || true)"
case "$OBERSTE" in
  ""|*nver*)
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo " OFFEN: Der CHANGELOG steht auf [Unveröffentlicht]."
    echo ""
    echo " Ausgeliefert ist ?v=$VERSION — im Repository steht diese"
    echo " Auslieferung aber unter keiner Versionsnummer. Damit meldet"
    echo " GitHub einen aelteren Stand, als tatsaechlich live ist."
    echo ""
    echo " ZU TUN, zusammen mit dem Cache-Buster-PR:"
    echo "   1. In CHANGELOG.md '## [Unveröffentlicht]' durch die neue"
    echo "      Nummer und das heutige Datum ersetzen."
    echo "   2. Pruefen:  sh scripts/changelog-oberste-version.sh CHANGELOG.md"
    echo "   3. Mitcommitten — release.yml legt Tag und Release dann selbst an."
    echo "════════════════════════════════════════════════════════════════"
    ;;
  *)
    echo "CHANGELOG: oberste Version ist $OBERSTE — Versionsschnitt gesetzt."
    ;;
esac
