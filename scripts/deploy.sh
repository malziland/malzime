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
  if ! command -v gh >/dev/null 2>&1; then
    # OPS-2026-08-20-12: Hier stand eine WARNUNG, und der Deploy lief weiter — der
    # CI-Freigabe-Riegel fiel damit still aus, genau wenn das Werkzeug fehlt.
    # Ungeprüft gilt als nicht bestanden.
    echo "FEHLER: gh nicht verfügbar — die CI-Freigabe ist nicht prüfbar." >&2
    echo "        Installieren (brew install gh) oder bewusst überspringen: SKIP_STAND=1" >&2
    exit 1
  fi
  if true; then
    SHA=$(git rev-parse HEAD)
    # Die sechs Pflicht-Checks müssen für DIESEN Commit success sein. Fehlt ein
    # Ergebnis (Lauf noch nicht durch), ist das kein Freibrief — dann Abbruch.
    PFLICHT="test-backend test-frontend test-e2e secret-scan playwright-version pruefungen"
    # OPS-2026-08-20-03: Je Check-Namen zählt NUR der jüngste Lauf. Vorher wurde die
    # gesamte Liste durchsucht, und ein einziges altes "success" genügte. Derselbe
    # Commit trägt aber mehrere Läufe, sobald der wöchentliche Zeitplan ihn erneut
    # prüft (am 2026-08-17 real geschehen: b3908c3 trug jeden Pflicht-Check doppelt).
    # Wird der Zeitplan-Lauf rot — etwa weil eine Ausnahme im Abhängigkeits-Gate
    # abläuft oder eine neue Lücke gemeldet wird, beides ohne jede Code-Änderung —,
    # meldete die Bindung weiterhin "alle sechs grün".
    LAGE=$(gh api "repos/malziland/malzime/commits/$SHA/check-runs" \
      --jq '[.check_runs[]] | group_by(.name) | map(max_by(.started_at))
            | .[] | "\(.name)=\(.conclusion // "pending")"' 2>/dev/null || true)

    # ── Wenn main noch prüft: zählt der Lauf des PR, sofern der Code IDENTISCH ist ──
    #
    # BEFUND 30.08.2026: Die sechs Pflicht-Checks liefen zweimal über denselben
    # Code — einmal auf dem Zweig, einmal auf `main` nach dem Squash-Merge. Der
    # längste (`test-e2e`) dauert im Schnitt 8:41, gemessen über fünf Läufe.
    # Das sind rund neun Minuten Wartezeit pro Auslieferung, für eine Prüfung,
    # die dasselbe Ergebnis liefern MUSS.
    #
    # Muss sie das wirklich? Ja, und das ist beweisbar: Git berechnet für jeden
    # Dateistand eine Baum-Kennung. Ist sie gleich, ist jede Datei bitgenau
    # gleich — dann kann eine Prüfung gar nichts anderes finden. An den sechs
    # letzten Zusammenführungen (#229 bis #234) nachgemessen: jedes Mal
    # identisch.
    #
    # Der Riegel bleibt also derselbe, er akzeptiert nur einen zweiten Beleg
    # für dieselbe Aussage. FAIL-CLOSED an jeder Stelle: Ohne PR-Nummer, ohne
    # auffindbaren Kopf-Commit oder bei abweichendem Baum passiert nichts —
    # dann gilt weiter, was `main` sagt.
    # BEFUND 31.08.2026 (unvorbelastetes Review): Hier stand
    # `grep -E '=(pending|null|)$'`. Die leere Alternative lehnt BSD-grep ab
    # ("empty (sub)expression") — also genau auf dem Rechner, von dem
    # ausgeliefert wird. Durch `|| true` wurde der Fehlschlag geschluckt, die
    # Abkuerzung griff NIE, und der einzige Hinweis war eine Fehlerzeile im
    # Protokoll, die wie Rauschen aussieht.
    if printf '%s\n' "$LAGE" | grep -qE '=(pending|null)$'; then
      PRNR=$(git log -1 --format=%s | grep -oE '#[0-9]+' | tail -1 | tr -d '#' || true)
      if [ -n "$PRNR" ] && command -v gh >/dev/null 2>&1; then
        PRKOPF=$(gh pr view "$PRNR" --json headRefOid -q .headRefOid 2>/dev/null || true)
        if [ -n "$PRKOPF" ]; then
          # Der Kopf-Commit des PR liegt nach dem Squash-Merge nicht mehr
          # zwingend lokal. Scheitert das Holen, entfaellt die Abkuerzung —
          # und das wird GESAGT, statt still zu passieren.
          if git fetch -q origin "$PRKOPF" 2>/dev/null; then
            BAUM_HIER=$(git rev-parse "HEAD^{tree}" 2>/dev/null || echo "kein-baum-hier")
            BAUM_PR=$(git rev-parse "${PRKOPF}^{tree}" 2>/dev/null || echo "kein-baum-dort")
          else
            echo "Hinweis: Kopf-Commit von PR #${PRNR} nicht abrufbar — die Baum-Regel entfaellt."
            BAUM_HIER="kein-baum-hier"
            BAUM_PR="kein-baum-dort"
          fi
          if [ "$BAUM_HIER" = "$BAUM_PR" ]; then
            LAGE_PR=$(gh api "repos/malziland/malzime/commits/$PRKOPF/check-runs" \
              --jq '[.check_runs[]] | group_by(.name) | map(max_by(.started_at))
                    | .[] | "\(.name)=\(.conclusion // "pending")"' 2>/dev/null || true)
            if [ -n "$LAGE_PR" ]; then
              # SICHERHEITSBEFUND 31.08.2026 (unvorbelastetes Review): Hier
              # stand `LAGE="$LAGE_PR"` — die GESAMTE Lage von main wurde
              # ersetzt. Steht auf main ein Pflicht-Check auf `failure` und
              # ein anderer noch auf `pending` (der Normalfall: die schnellen
              # sind fertig, e2e laeuft noch), verdraengte das gruene Ergebnis
              # des PR das ROTE von main. Ein Stand mit rotem Pflicht-Check
              # waere ausgeliefert worden — das war vorher nicht moeglich.
              #
              # Jetzt wird NUR nachgetragen, was auf main noch aussteht. Ein
              # `failure` bleibt ein `failure`, egal was der PR sagt.
              # ZEITABHAENGIGE PRUEFUNGEN sind von der Abkuerzung
              # ausgenommen (Befund 31.08.2026, unvorbelastetes Review).
              #
              # Die Begruendung "gleicher Baum, gleiches Ergebnis" gilt nur
              # fuer Pruefungen, die ausschliesslich den Code ansehen.
              # `test-backend` fuehrt drei Pruefungen, die von der UHR
              # abhaengen: audit-gate mit ablaufender Ausnahmeliste, die
              # Frist-Bremse zusagen-frische, und npm audit gegen eine
              # Datenbank, die sich taeglich aendert. Ein gruenes Ergebnis von
              # gestern kann heute falsch sein, ohne dass sich eine Zeile
              # geaendert hat — genau deshalb gibt es den woechentlichen
              # Zeitplan-Lauf (OPS-2026-08-20-03, vierzig Zeilen weiter oben).
              #
              # Der Verlust ist klein: test-backend dauert 179 s, der teure
              # test-e2e 521 s. Die Abkuerzung spart also weiterhin den
              # groesseren Teil.
              ZEITABHAENGIG="test-backend"
              NEUE_LAGE=""
              for EINTRAG in $LAGE; do
                NAME="${EINTRAG%%=*}"
                WERT="${EINTRAG#*=}"
                UEBERSPRINGEN=0
                for Z in $ZEITABHAENGIG; do
                  [ "$NAME" = "$Z" ] && UEBERSPRINGEN=1
                done
                if [ "$UEBERSPRINGEN" = "0" ] && \
                   { [ "$WERT" = "pending" ] || [ "$WERT" = "null" ] || [ -z "$WERT" ]; }; then
                  ERSATZ=$(printf '%s\n' "$LAGE_PR" | grep "^${NAME}=" || true)
                  [ -n "$ERSATZ" ] && EINTRAG="$ERSATZ"
                fi
                NEUE_LAGE="$NEUE_LAGE$EINTRAG
"
              done
              echo "Stand-Bindung: main prueft noch, PR #${PRNR} hat denselben Baum"
              echo "               (${BAUM_HIER:0:8}) — dessen Ergebnisse gelten fuer die"
              echo "               noch ausstehenden Pruefungen. Rote bleiben rot."
              LAGE="$NEUE_LAGE"
            fi
          fi
        fi
      fi
    fi

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
    echo "Stand-Bindung: HEAD == origin/main, alle sechs Pflicht-Checks grün für $SHA (jüngster Lauf je Check)."
  fi
fi

# ── Test-Guard: Lint + Unit-Tests muessen gruen sein (Deploy-Konvention) ──
#
# BEFUND 30.08.2026: Diese drei Laeufe dauern rund drei Minuten und pruefen
# denselben Code, den die Pipeline eben schon geprueft hat. Sie sind eine
# ECHTE Doppelung, keine zweite Meinung:
#
#   · Die Stand-Bindung oben verlangt einen SAUBEREN Arbeitsbaum und
#     HEAD == origin/main. Damit ist der Code hier bitgenau derselbe, der in
#     der CI gelaufen ist.
#   · Sie verlangt ausserdem, dass alle sechs Pflicht-Checks fuer genau diesen
#     Commit gruen sind — darunter test-backend und test-frontend, also
#     dieselben Suiten.
#
# Deshalb laufen sie nur noch, wenn die Stand-Bindung NICHT gegriffen hat.
# Genau dann sind sie das Einzige, was zwischen ungepruefte Aenderungen und
# die Produktion tritt — und dann laufen sie vollstaendig.
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_TESTS=1 gesetzt — Lint und Tests werden UEBERSPRUNGEN."
elif [ "${SKIP_STAND:-0}" = "1" ]; then
  echo "— Lint und Tests (die Stand-Bindung war abgeschaltet, also hier vollstaendig)"
  npm run lint
  npm test --prefix functions
  npm run test:frontend
else
  echo "— Lint und Tests uebersprungen: Die Stand-Bindung hat sie bereits belegt"
  echo "  (sauberer Baum, HEAD == origin/main, sechs Pflicht-Checks gruen)."
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

# ── Riegel: Liegt der Einstellungssatz? (seit v4.4, 30.08.2026) ──
# Seit dem Firestore-Umbau kommen ALLE Betriebswerte aus config/betriebsprofil.
# Fehlt das Dokument, laeuft die Seite, nimmt Fotos an — und JEDE Analyse
# scheitert. Der Deploy und das Anlegen des Satzes sind zwei getrennte
# Schritte; ohne diesen Riegel haenge die Reihenfolge an der Sorgfalt des
# Menschen, der ihn ausfuehrt.
#
# Die Pruefung ist rein lesend und kostet nichts. Notschalter: SKIP_SATZ=1
# (etwa fuer einen Rollback auf v4.2.3, die den Satz gar nicht braucht).
if [ "${SKIP_SATZ:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_SATZ=1 gesetzt — Einstellungssatz wird NICHT geprueft."
else
  echo "— Einstellungssatz"
  SATZ_ANTWORT=$(curl -s --max-time 20 "https://malzi.me/api/stats" 2>/dev/null || true)
  SATZ_LIMIT=$(printf '%s' "$SATZ_ANTWORT" | grep -o '"limit":[0-9]*' | head -1 | grep -o '[0-9]*$' || true)
  if [ -z "$SATZ_LIMIT" ] || [ "$SATZ_LIMIT" -lt 1 ] 2>/dev/null; then
    echo "ABBRUCH: In der Produktion ist kein gueltiger Einstellungssatz erkennbar."
    echo "         Ohne ihn scheitert nach dem Deploy JEDE Analyse."
    echo
    echo "         Zuerst:  node scripts/betriebsprofil-anlegen.js --ausfuehren"
    echo "         Danach:  sh scripts/deploy.sh"
    echo
    echo "         (Beim allerersten Deploy von v4.4 ist das erwartet: Die alte"
    echo "          Fassung liest den Satz nicht, meldet aber ihr eigenes Limit."
    echo "          Notschalter SKIP_SATZ=1, wenn der Satz nachweislich liegt.)"
    exit 1
  fi
  echo "  ok    Einstellungssatz erkennbar (Stundenlimit $SATZ_LIMIT)"
fi

# ── Deploy-Ziel bestimmen ──
# KURZAUDIT-Befund OPS-2026-08-13-34: Das Ziel muss VOR dem Buster-Block
# feststehen. Vorher lief der Buster bei jedem Aufruf — ein reiner
# Functions-Deploy veraenderte sechs Hosting-Dateien, die dann unausgeliefert
# im Arbeitsbaum lagen. Rutscht so etwas in einen Commit, behauptet das
# Repository einen Buster-Stand, der nie online war.
# OPS-2026-08-20-49: `firestore:rules` gehoerte nicht zu den Zielen — die Regeln
# im Repository wurden also nie ausgerollt. Sie sind heute deckungsgleich mit den
# aktiven (gemessen 2026-08-21 ueber die Firebase-Regel-Schnittstelle: beide
# "allow read, write: if false"), der Schritt aendert also nichts und macht ihn
# ab jetzt wiederholbar. Wer die Regeln aendert, muss sie sonst von Hand
# ausrollen — und genau das faellt irgendwann aus.
#
# BEFUND 30.08.2026: Das Ziel hiess `firestore:rules` — und genau daran ist der
# erste v4.4-Deploy gescheitert:
#
#   Error: Request to .../databases/(default) had HTTP Error: 404,
#   Project 'malzime' or database '(default)' does not exist.
#
# `firestore:rules` sucht die STANDARD-Datenbank. Die gibt es hier nicht: Seit
# dem Umzug nach Europa (PRIV-001) heisst sie `malzime-eu`. Die richtige
# Schreibweise nennt die Datenbank statt der Regeln — mit Trockenlauf belegt:
#   firebase deploy --only firestore:malzime-eu --dry-run  ->  compiled successfully
#
# NACHTRAG 30.08.2026, gemessen: Auch die richtige Schreibweise scheitert IM
# PAKET. `firebase deploy --only hosting,functions,firestore:malzime-eu` bricht
# mit demselben `databases/(default) 404` ab — derselbe Aufruf ALLEIN laeuft
# durch:
#
#   firebase deploy --only firestore:malzime-eu
#   -> released rules firestore.rules to cloud.firestore
#   -> deployed indexes successfully for malzime-eu database
#
# Deshalb rollt dieses Skript Firestore als EIGENEN Schritt aus, vor Hosting und
# Functions: Regeln sind eine Sicherheitsgrenze und muessen stehen, bevor neuer
# Code dagegen laeuft. Scheitert der Schritt, bricht der Deploy ab — ein Deploy
# mit unbekanntem Regelstand ist keiner.
#
# Der Fehler war bis heute unsichtbar, weil der Schritt nie etwas aenderte.
# Er scheiterte trotzdem — und riss den GANZEN Deploy mit, bevor Functions und
# Hosting hochgeladen waren. Die Produktion blieb dabei unversehrt; das ist
# Glueck, kein Entwurf.
TARGET="${1:-hosting,functions}"

# ── TROCKENLAUF: würde diese Auslieferung überhaupt durchgehen? ──
#
# ANLASS, 30.08.2026: SECHS gescheiterte Auslieferungen an einem einzigen Tag —
# falsches Firestore-Ziel, Firestore im Paket statt allein, die satzWache ohne
# Datenbank-Angabe, der Infrastruktur-Wächter gegen eine feste RUNBOOK-Zahl,
# ein verbotener Formwechsel der satzWache, und zuletzt ein unsauberer
# Arbeitsbaum als Folge des vorigen Abbruchs.
#
# Jeder dieser Fehler wäre HIER sichtbar geworden. Zusammen kosteten sie rund
# zweieinhalb Stunden. Der Trockenlauf kostet 28 Sekunden (gemessen 30.08.:
# 3 s für Firestore, 25 s für hosting/functions).
#
# Er läuft in DERSELBEN Reihenfolge und mit denselben Zielen wie der echte
# Deploy weiter unten — sonst prüft er etwas anderes, als später passiert.
#
# BEWUSST VOR DEM CACHE-BUSTER: Bricht der Trockenlauf ab, ist der Arbeitsbaum
# noch unberührt. Sonst bliebe die hochgezählte Kennung ungespeichert liegen
# und würde den nächsten Versuch am Sauberkeits-Riegel blockieren — genau das
# ist am 30.08. passiert.
#
# Notschalter SKIP_DRYRUN=1, laut wie die anderen.
if [ "${SKIP_DRYRUN:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_DRYRUN=1 gesetzt — der Trockenlauf wird UEBERSPRUNGEN."
else
  # "ohne etwas zu aendern" waere zu stark: Die Firebase-CLI weist selbst
  # darauf hin, dass ein Trockenlauf Programmierschnittstellen am Zielprojekt
  # einschalten kann. Bei uns sind alle laengst aktiv — die Aussage bleibt
  # trotzdem genau. (Befund 31.08.2026, unvorbelastetes Review.)
  echo "— Trockenlauf (prueft, ohne auszuliefern)"
  DRY_START=$(date +%s)

  if [ "${SKIP_FIRESTORE:-0}" != "1" ]; then
    if ! firebase deploy --only firestore:malzime-eu --dry-run >/tmp/malzime-dry-firestore.log 2>&1; then
      echo "FEHLER: Der Trockenlauf fuer Firestore ist gescheitert — nichts wurde ausgeliefert." >&2
      tail -15 /tmp/malzime-dry-firestore.log | sed 's/^/    /' >&2
      echo "        Das vollstaendige Protokoll: /tmp/malzime-dry-firestore.log" >&2
      echo "        Notschalter: SKIP_DRYRUN=1" >&2
      exit 1
    fi
    echo "  ok    Firestore-Regeln und Indizes"
  fi

  if ! firebase deploy --only "$TARGET" --dry-run >/tmp/malzime-dry-rest.log 2>&1; then
    echo "FEHLER: Der Trockenlauf fuer $TARGET ist gescheitert — nichts wurde ausgeliefert." >&2
    tail -15 /tmp/malzime-dry-rest.log | sed 's/^/    /' >&2
    echo "        Das vollstaendige Protokoll: /tmp/malzime-dry-rest.log" >&2
    echo "        Notschalter: SKIP_DRYRUN=1" >&2
    exit 1
  fi
  echo "  ok    $TARGET"
  echo "Trockenlauf gruen in $(( $(date +%s) - DRY_START )) s — die Auslieferung sollte durchgehen."
fi

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

# ── AUFRAEUMEN BEI ABBRUCH ──
#
# BEFUND 30.08.2026: Ein gescheiterter Deploy blockierte den naechsten. Die
# Kennung wird HIER hochgezaehlt und in vierzehn Dateien geschrieben; bricht
# der Deploy danach ab, bleiben diese Aenderungen ungespeichert liegen. Der
# Stand-Riegel ganz oben verlangt aber einen sauberen Arbeitsbaum — der
# naechste Versuch scheitert also, ohne dass etwas Neues kaputt waere.
#
# An diesem Tag hat das einen ganzen Durchlauf gekostet, mitten in der Nacht,
# und sah aus wie ein zweiter, unabhaengiger Fehler.
#
# Die Falle raeumt nur auf, was DIESES Skript geschrieben hat: die
# Buster-Dateien unter public/. Fremde Aenderungen bleiben unberuehrt — der
# Stand-Riegel oben hat ohnehin schon sichergestellt, dass es keine gibt.
# Ab dem ersten echten Upload darf NICHTS mehr zurueckgenommen werden.
HOCHGELADEN=0

aufraeumen_bei_abbruch() {
  CODE=$?
  # SICHERHEITSBEFUND 31.08.2026 (unvorbelastetes Review): Die Falle pruefte
  # nur den Rueckgabewert. `live-smoke.sh` laeuft aber NACH beiden Uploads und
  # beendet sich bei einem Fehlschlag mit `exit 1` — etwa wenn die Verteilung
  # des Hostings noch nicht durch ist. Dann haette die Falle eine BEREITS
  # AUSGELIEFERTE Cache-Kennung zurueckgenommen.
  #
  # Folge: Live steht ?v=NEU, lokal wieder ?v=ALT. Der naechste Deploy leitet
  # aus index.html DIESELBE Nummer ab und liefert anderen Inhalt unter einer
  # vergebenen Kennung aus — genau der Cache-Fehler, gegen den
  # OPS-2026-08-13-47 fail-closed gebaut wurde. Dazu haette build-info.json,
  # der Echtheitsbeweis, nicht mehr zur Produktion gepasst.
  if [ "$HOCHGELADEN" = "1" ]; then
    if [ "$CODE" -ne 0 ]; then
      echo ""
      echo "Abbruch NACH dem Hochladen (Code $CODE) — die Cache-Kennung bleibt,"
      echo "wie sie ist. Sie steht bereits live; ein Rueckbau wuerde sie ein"
      echo "zweites Mal vergeben."
      echo "Naechster Schritt: pruefen, was live steht, und die Kennung"
      echo "committen (chore-PR), damit der Arbeitsbaum wieder sauber ist."
    fi
    return
  fi
  if [ "$CODE" -ne 0 ] && [ -n "$(git status --porcelain -- public/ 2>/dev/null)" ]; then
    echo ""
    echo "Deploy abgebrochen (Code $CODE) — nehme die Cache-Kennung zurueck,"
    echo "damit der naechste Versuch nicht am Sauberkeits-Riegel scheitert."
    # BEFUND 31.08.2026 (unvorbelastetes Review): Hier stand
    # `git checkout -- public/` — das verwirft ALLES unter public/, nicht nur,
    # was dieses Skript geschrieben hat. Der Kommentar behauptete das Gegenteil
    # und stuetzte sich auf den Sauberkeits-Riegel. Der faellt aber bei
    # SKIP_STAND=1 weg, dem dokumentierten Notschalter — dann waere fremde
    # Handarbeit ohne Rueckfrage geloescht worden.
    #
    # Jetzt werden GENAU die Dateien zurueckgenommen, in die der Cache-Buster
    # geschrieben hat. Der Suchpfad ist derselbe, mit dem sie oben gefunden
    # wurden; laeuft er ins Leere, wird nichts angefasst und das gesagt.
    ZURUECK=$(git diff --name-only -- public/ 2>/dev/null \
      | while read -r D; do
          git diff -- "$D" 2>/dev/null | grep -q '^[+-].*?v=[0-9]\{10\}' && echo "$D"
        done)
    if [ -z "$ZURUECK" ]; then
      echo "  Keine Datei mit geaenderter Cache-Kennung gefunden — nichts angefasst."
      echo "  (Was sonst unter public/ liegt, bleibt unberuehrt.)"
    else
      ANZAHL=$(printf '%s\n' "$ZURUECK" | grep -c .)
      printf '%s\n' "$ZURUECK" | xargs git checkout -- 2>/dev/null \
        && echo "  $ANZAHL Datei(en) mit der Cache-Kennung zurueckgesetzt."
    fi
  fi
}
trap aufraeumen_bei_abbruch EXIT

# Alle Dateien mit ?v=-Verweisen aktualisieren: JEDE HTML-Seite unter public/
# — auch in Unterordnern wie public/en/ — UND public/js/demo.js, dort haengen
# die Buster der grossen Demo-Bilder.
#
# OPS-2026-08-18-02: Hier stand eine feste Liste von sechs Pfaden. Sie war beim
# Zuwachs der Seite /barrierefreiheit schon einmal veraltet (OPS-2026-08-17)
# und wurde damals nur ergaenzt. Mit den englischen Seiten unter public/en/ waere
# derselbe Fehler zum zweiten Mal passiert: Ihre Stilblatt-Verweise waeren auf
# der Kennung ihres Entstehungstages eingefroren, waehrend alle anderen Seiten
# weiterzaehlen — nach der naechsten CSS-Aenderung haetten sie ein altes
# Stilblatt aus dem Zwischenspeicher gezogen. Auch der Waechter haette es nicht
# gesehen, er durchsuchte nur die oberste Ebene von public/.
#
# Jetzt gibt es keine Liste mehr, die veralten kann: gefragt wird das
# Dateisystem. Der Waechter fuehrt genau die Zeile unten aus und vergleicht ihr
# Ergebnis mit allem, was tatsaechlich einen Buster traegt.
# demo.js fehlte hier bis zum Kurzaudit 2026-08-11 (OPS-106): Sein Buster
# blieb drei Deploys lang auf einem alten Stand stehen.
#
# OPS-2026-08-13-01: Das Muster hiess bis 2026-08-13 [0-9]* und erlaubte damit
# NULL Ziffern. Getroffen wurde also auch ein nacktes ?v= in gewoehnlichem
# Fliesstext; der Kommentar ueber DEMO_BUSTER in public/js/demo.js wurde beim
# Deploy vom 2026-08-12 stillschweigend verunstaltet. [0-9][0-9]* verlangt
# mindestens eine Ziffer (BRE, kein + — bash 3.2 auf macOS kennt es nicht).
# BUSTER-DATEIEN: Diese Zeile fuehrt functions/src/__tests__/deploy-buster-script.test.js
# unveraendert aus. Ihre Form nicht ohne Blick dorthin aendern.
BUSTER_DATEIEN=$(find public -name '*.html' | sort; echo public/js/demo.js)
for f in $BUSTER_DATEIEN; do
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

# Fingerabdruck des Ausgelieferten. MUSS nach der Buster-Ersetzung laufen —
# sonst stehen dort die Pruefsummen des Zustands DAVOR, und jede Nachpruefung
# meldet Abweichungen, wo keine sind.
if ! node scripts/build-info.mjs "$VERSION"; then
  echo "FEHLER: build-info.json konnte nicht erzeugt werden." >&2
  exit 1
fi
fi

echo ""
echo "Deploy-Ziel: $TARGET"

# Rueckfrage NUR, wenn wirklich jemand davorsitzt.
#
# ANLASS 2026-08-19: Diese Zeile war ein blankes `read -r`. Bei einem Deploy im
# Hintergrund (kein Terminal an der Eingabe) wartete das Skript darauf ewig —
# stumm, ohne Fehler, ohne Zeitablauf. Von aussen war das nicht von "laeuft noch"
# zu unterscheiden; die Auslieferung stand eine Dreiviertelstunde still, waehrend
# das Protokoll lauter gruene Haken zeigte.
#
# Frueher fiel es nicht auf, weil die Rueckfrage erst ab dem Ziel
# "hosting,functions" kommt — bei reinen Hosting-Deploys nie.
#
# `[ -t 0 ]` ist wahr, wenn die Standardeingabe an einem Terminal haengt. Damit
# fragt das Skript einen Menschen weiterhin, kann aber im Hintergrund und in der
# CI nicht mehr haengenbleiben. DEPLOY_JA=1 uebergeht die Rueckfrage auch am
# Terminal.
if [ -t 0 ] && [ -z "${DEPLOY_JA:-}" ]; then
  echo "Weiter? (Enter = ja, Ctrl+C = abbrechen)"
  read -r
else
  echo "Ohne Rueckfrage (kein Terminal an der Eingabe oder DEPLOY_JA gesetzt)."
fi

# Global installierte CLI bevorzugen. `npx firebase` scheitert, wenn firebase-tools
# nicht im Projekt liegt: npm versucht dann einen Registry-Abruf und bricht mit
# "could not determine executable to run" ab. Genau daran ist das Skript zuletzt
# gescheitert — vermutlich der eigentliche Grund, warum es seit dem 2026-07-29
# nicht mehr benutzt wurde und die Deploys stattdessen von Hand liefen
# (Audit 2026-08-10, OPS-001).
# Ab hier wird HOCHGELADEN. Die Aufraeumfalle haelt sich von jetzt an raus:
# Was live steht, laesst sich nicht durch ein `git checkout` zuruecknehmen.
HOCHGELADEN=1

# ── SCHRITT 1: Firestore-Regeln und Indizes, ALLEIN ──
# Warum allein: siehe Kopfkommentar (Nachtrag 30.08.2026). Im Paket scheitert er.
if [ "${SKIP_FIRESTORE:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_FIRESTORE=1 — Regeln werden NICHT ausgerollt."
else
  echo "── Firestore-Regeln und Indizes (malzime-eu) ──"
  if command -v firebase >/dev/null 2>&1; then
    firebase deploy --only firestore:malzime-eu
  else
    npx firebase deploy --only firestore:malzime-eu
  fi
  echo "Regeln ausgerollt."
fi

# ── SCHRITT 2: Hosting und Functions ──
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
[ "${SKIP_FIRESTORE:-0}" = "1" ] && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_FIRESTORE"
[ "${SKIP_DRYRUN:-0}" = "1" ]    && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_DRYRUN"
# 31.08.2026: SKIP_SATZ fehlte hier seit seiner Einfuehrung. Ausgerechnet der
# Schalter, der den Riegel unter dem Einstellungssatz abhebt — ohne Satz nimmt
# die Seite Fotos an und JEDE Analyse scheitert.
[ "${SKIP_SATZ:-0}" = "1" ]      && UEBERSPRUNGEN="$UEBERSPRUNGEN SKIP_SATZ"

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
