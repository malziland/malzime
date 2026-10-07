#!/usr/bin/env bash
# malziME Deploy-Script
#
# Bindet die Auslieferung an die CI-Freigabe, faehrt einen Trockenlauf,
# aktualisiert die Cache-Kennungen (Konvention ?v=YYYYMMDDNN) und liefert auf
# Firebase aus.
#
# BEFUND 31.08.2026 (A-8): Hier stand "Fuehrt Lint + Unit-Tests aus". Das
# stimmt seit der Stand-Bindung nicht mehr — Lint und Tests laufen in der
# Pipeline, hier nur noch bei SKIP_STAND=1. Und es war nur EIN Notschalter
# genannt; es sind acht.
#
# Nutzung:
#   ./scripts/deploy.sh              # Website + Server (der Normalfall)
#   ./scripts/deploy.sh hosting      # nur die Website
# Den Server allein liefert dieses Skript nicht aus (ARCH-2026-10-03-10, Riegel
# gleich unten): Der Fingerabdruck des Server-Codes geht mit der Website hinaus.
# Aus demselben Grund geht die Website nur dann allein hinaus, wenn der
# Server-Code seit dem Stand unveraendert ist, den die Seite heute ausweist
# (Riegel nach dem Erzeugen des Fingerabdrucks).
#
# Notschalter, alle nur im Notfall und alle einzeln zu begruenden:
#   SKIP_STAND=1      Stand-Bindung an die CI-Freigabe aus; dann laufen Lint
#                     und Tests stattdessen hier
#   SKIP_TESTS=1      Test-Riegel aus
#   SKIP_DRYRUN=1     Trockenlauf aus
#   SKIP_INFRA=1      Infrastruktur-Pruefung aus
#   SKIP_SATZ=1       Pruefung des Einstellungssatzes aus
#   SKIP_SMOKE=1      Live-Probe nach der Auslieferung aus
#   SKIP_FIRESTORE=1  Firestore-Schritt aus
#   SKIP_CLI_CHECK=1  Versionspruefung der Firebase-CLI aus
#
# Rueckgabewerte (docs/RUNBOOK.md, „Die Auslieferung als Kette“):
#   0  ausgeliefert, Live-Proben gruen
#   2  ausgeliefert, Schlussbilanz ausgegeben — nur die Live-Proben konnten nicht
#      messen (Wartungsmodus). Kein anderer Fall endet mit 2.
#   1  (oder ein anderer Wert) Abbruch

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Der Rueckgabewert 2 gehoert EINEM Fall (OPS-2026-10-03-15) ──
# Im echten Ablauf laeuft die Auslieferung IM Wartungsmodus (docs/RUNBOOK.md,
# „Die Auslieferung als Kette“). Die Live-Proben am Schluss koennen dann nicht
# messen und melden 2. Der Ablauf drumherum wertet deshalb 2 als „ausgeliefert,
# Live-Proben offen“ — und genau das muss der Wert auch immer bedeuten.
#
# Vorher war er mehrdeutig: Auch eine Infrastruktur-Pruefung ohne Anmeldung
# endet mit 2, lange bevor etwas hinausgeht; unter `set -e` reichte dieses
# Skript jeden solchen Wert einfach durch. Ein Abbruch sah fuer den Ablauf
# dann aus wie eine Auslieferung.
#
# Deshalb: Dieses Skript endet NUR dann mit 2, wenn es selbst am Schluss so
# entscheidet (LIVE_PROBEN_OFFEN=1, nach der Schlussbilanz). Endet irgendein
# anderer Schritt mit 2, wird daraus 1 — ein Abbruch ist ein Abbruch. Die
# Regel haengt am Ende des Skripts (EXIT), zuerst allein, spaeter zusammen mit
# der Aufraeumfalle.
LIVE_PROBEN_OFFEN=0
nur_ein_fall_endet_mit_2() { # $1 = der Wert, mit dem das Skript gerade endet
  if [ "$1" -eq 2 ] && [ "$LIVE_PROBEN_OFFEN" != "1" ]; then
    echo "" >&2
    echo "Ein Schritt endete mit Code 2. Der Rueckgabewert 2 ist dem Fall „ausgeliefert, Live-Proben offen“ vorbehalten —" >&2
    echo "dieser Lauf endet deshalb mit 1 (Abbruch)." >&2
    exit 1
  fi
}
trap 'nur_ein_fall_endet_mit_2 $?' EXIT

# ── Einmaliges Infra-Setup (NICHT Teil des regulaeren Deploys) ──
# Die GCS-Lifecycle-Regel, die zwischengespeicherte Bilder als Sicherheitsnetz
# nach 1 Tag loescht, wird von `firebase deploy` NICHT mit ausgerollt. Sie muss
# beim ersten Setup (oder einem Bucket-Neuaufbau) EINMAL gesetzt werden:
#   gsutil lifecycle set storage-lifecycle.json gs://malzime-queue-uploads
# Pruefen:  gsutil lifecycle get gs://malzime-queue-uploads
# (Stand 2026-06-06 verifiziert: Regel am Produktiv-Bucket aktiv.)

# ── ARCH-2026-10-03-10: Der Server geht nie ohne die Website hinaus ──
# Der Fingerabdruck `public/build-info.json` weist auch den Server-Code aus,
# Datei fuer Datei. Er wird weiter unten erzeugt und mit der Website
# ausgeliefert. Ein Ziel ohne `hosting` wechselte den Server-Code und liesse die
# Seite weiter den vorigen Stand ausweisen — die Nachpruefung (pruefe-live.sh)
# meldete dann "deckungsgleich" ueber ein Programm, das nicht mehr laeuft.
# Deshalb steht das Ziel schon hier fest, und ein Ziel ohne Website ist ein
# Aufruffehler: abgelehnt, bevor irgendein Dienst gefragt wird. Kein
# Notschalter. (Der Notweg am Skript vorbei steht im RUNBOOK, Hebel 4.)
TARGET="${1:-hosting,functions}"
if [[ ",$TARGET," != *",hosting,"* ]]; then
  echo "FEHLER: Deploy-Ziel \"$TARGET\" enthaelt die Website nicht (hosting)." >&2
  echo "        Der Fingerabdruck des Server-Codes (public/build-info.json) wird mit der Website" >&2
  echo "        ausgeliefert; ohne sie wiese die Seite danach einen Server-Stand aus, der nicht" >&2
  echo "        mehr laeuft. Website und Server zusammen: ./scripts/deploy.sh (ohne Argument)." >&2
  exit 1
fi

# ── OPS-2026-10-03-09: Was der Sauberkeits-Riegel nicht sieht ──
# `git status` (weiter unten) zeigt keine Dateien, die .gitignore nennt. Die
# Firebase-CLI richtet sich aber nicht nach .gitignore. Zwei Riegel schliessen
# das — bewusst VOR der Stand-Bindung und ohne Notschalter: Sie gelten auch bei
# SKIP_STAND=1, brauchen kein Netz, und fuer keinen der beiden Faelle gibt es
# einen Grund, trotzdem auszuliefern.
#
# 1. Umgebungsdateien. Die CLI laedt beim Ausliefern `functions/.env` und
#    `functions/.env.<projekt>` und setzt jede Zeile daraus als
#    Umgebungsvariable an ALLE Functions. Dort bleibt sie stehen: Datei loeschen
#    und neu ausliefern nimmt sie nicht zurueck. Erlaubt sind nur `.env.local`
#    (die liest die CLI ausschliesslich im Emulator) und ihre Vorlage. Eine Datei
#    `.env.example` gibt es nicht mehr: Hiesse ein Projekt-Kuerzel "example",
#    wuerde die CLI auch sie laden.
UMGEBUNGSDATEIEN=""
for D in functions/.env functions/.env.*; do
  # Ohne Treffer bleibt das Muster woertlich stehen — dann gibt es die Datei nicht.
  [ -e "$D" ] || [ -L "$D" ] || continue
  case "${D#functions/}" in
    .env.local | .env.local.example) ;;
    *) UMGEBUNGSDATEIEN="$UMGEBUNGSDATEIEN $D" ;;
  esac
done
if [ -n "$UMGEBUNGSDATEIEN" ]; then
  echo "FEHLER: Umgebungsdatei im Server-Ordner:$UMGEBUNGSDATEIEN" >&2
  echo "        Die Firebase-CLI setzte ihren Inhalt als Einstellung an jede Function, und er" >&2
  echo "        bliebe dort auch nach dem Loeschen der Datei stehen. Lokale Schalter und der" >&2
  echo "        lokale KI-Schluessel gehoeren nach functions/.env.local (nur der Emulator" >&2
  echo "        liest sie). Datei verschieben oder loeschen, dann erneut starten." >&2
  exit 1
fi

# 2. Reste in den beiden Auslieferungsverzeichnissen. Was als Server-Paket zu
#    Google geht, bestimmt `functions.ignore` in firebase.json; was als Website
#    hinausgeht, `hosting.ignore`. Der Waechter bildet beide Listen nach den
#    Regeln der CLI und haelt an, sobald etwas darin nicht im Repository steht.
#    Rueckgabewert 2 heisst "nicht messbar" — auch das ist kein Freibrief.
RESTE_RC=0
RESTE_AUSGABE=$(node scripts/pruefe-auslieferbare-reste.mjs 2>&1) || RESTE_RC=$?
if [ "$RESTE_RC" -ne 0 ]; then
  printf '%s\n' "$RESTE_AUSGABE" >&2
  if [ "$RESTE_RC" -eq 1 ]; then
    echo "FEHLER: Es wuerde etwas ausgeliefert, das nicht im Repository steht (Liste oben)." >&2
    echo "        Datei entfernen oder in die ignore-Liste von firebase.json aufnehmen." >&2
  else
    echo "FEHLER: Was ausgeliefert wuerde, liess sich nicht messen (Meldung oben, Code $RESTE_RC) —" >&2
    echo "        Abbruch statt Deploy auf Verdacht. Fehlen die Pakete: npm ci im Wurzelordner." >&2
  fi
  exit 1
fi
PAKET_ZAHL=$(printf '%s\n' "$RESTE_AUSGABE" | sed -n 's/.*Dateien im Paket: \([0-9][0-9]*\).*/\1/p')
echo "Server-Paket: ${PAKET_ZAHL:-?} Dateien, jede steht im Repository; keine Umgebungsdatei im Server-Ordner."

# ── Die Pruefergebnisse eines Commits: je Check der JUENGSTE Lauf ──
# Gibt je Check-Namen eine Zeile "name=ergebnis" aus ("pending", solange ein
# Lauf kein Ergebnis hat). Zwei Stellen der Stand-Bindung rufen das auf: fuer
# den Stand von main und fuer den Kopf des Pull Requests.
#
# OPS-2026-08-20-03: Je Check-Namen zaehlt NUR der juengste Lauf. Derselbe
# Commit traegt mehrere Laeufe, sobald der woechentliche Zeitplan ihn erneut
# prueft (am 2026-08-17 real geschehen: b3908c3 trug jeden Pflicht-Check
# doppelt). Wird der spaetere Lauf rot — eine ablaufende Ausnahme im
# Abhaengigkeits-Gate, eine neu gemeldete Luecke, beides ohne Code-Aenderung —,
# darf ein aelteres "success" ihn nicht verdecken.
#
# OPS-2026-10-03-18: Die Schnittstelle liefert die Laeufe seitenweise, ohne
# Angabe 30 je Seite. Jeder Nachtlauf haengt vier weitere an denselben Commit;
# nach einigen Tagen fielen die Pflicht-Checks aus der ersten Seite, und die
# Bindung meldete "fehlt". Deshalb die groesste Seitenlaenge (100) und
# blaettern, bis eine Seite nicht mehr voll ist.
#
# Je Seite kommen nur ROHZEILEN (Name=Ergebnis, Tabulator, Startzeit). Der
# juengste Lauf je Name wird erst UEBER ALLE Seiten bestimmt: Je Seite
# ausgewertet, staenden bei zwei Seiten zwei Ergebnisse je Check da — ein altes
# "success" neben einem juengeren "failure", und die Pruefung unten faende das
# gruene. (`gh api --paginate` wertet `--jq` genau so aus, je Seite; deshalb
# wird hier von Hand geblaettert.)
#
# Scheitert EINE Seite, gibt die Funktion NICHTS aus: Ein Teilergebnis koennte
# gerade den juengeren, roten Lauf verschweigen. Der Aufrufer wertet "leer" als
# "nicht abrufbar" und bricht ab.
check_lage() {
  local sha="$1" seite=1 zeilen="" antwort anzahl
  while :; do
    antwort=$(gh api "repos/malziland/malzime/commits/$sha/check-runs?per_page=100&page=$seite" \
      --jq '.check_runs[] | "\(.name)=\(.conclusion // "pending")\t\(.started_at // "")"' 2>/dev/null) || return 0
    [ -n "$antwort" ] || break
    zeilen="$zeilen$antwort
"
    # Weniger als eine volle Seite (dieselbe Zahl wie per_page oben): Das war
    # die letzte. Eine volle Seite heisst, es kann weitere geben.
    anzahl=$(printf '%s\n' "$antwort" | grep -c . || true)
    [ "$anzahl" -ge 100 ] || break
    seite=$((seite + 1))
    # 20 volle Seiten waeren 2000 Laeufe an einem Commit. Das gibt es nicht —
    # dann laeuft die Schleife ins Leere. Lieber "nicht abrufbar" als endlos.
    [ "$seite" -le 20 ] || return 0
  done
  # Je Name der Eintrag mit der spaetesten Startzeit; bei Gleichstand der
  # spaetere in der Antwort. ISO-Zeiten sortieren als Text richtig; das
  # angehaengte "" erzwingt den Textvergleich.
  printf '%s' "$zeilen" | LC_ALL=C awk -F '\t' '
    $1 == "" { next }
    {
      name = $1
      sub(/=[^=]*$/, "", name)
      if (!(name in zeit) || ($2 "") >= (zeit[name] "")) {
        zeit[name] = $2
        eintrag[name] = $1
      }
    }
    END { for (name in eintrag) print eintrag[name] }
  ' | LC_ALL=C sort
}

# ── OPS-2026-08-13-43: Stand-Bindung — deployt wird nur, was die CI freigab ──
# Der Deploy liefert den ARBEITSBAUM aus (`firebase deploy`), prüfte aber
# nirgends, ob dieser Stand der von der CI freigegebene ist. Sein Test-Guard ist
# zudem eine echte Teilmenge der sechs Pflicht-Checks (es fehlen e2e,
# secret-scan, audit-gate, format:check und der ganze pruefungen-Job inkl. der
# Fremddatei-Prüfsummen, die exifr bewachen). Statt diese Riegel lokal zu
# doppeln, wird an die CI-Freigabe gebunden: sauberer Baum, HEAD == origin/main,
# und für HEAD müssen alle Pflicht-Checks grün sein. Notschalter SKIP_STAND=1,
# laut wie die anderen.
# Vorbelegt, weil `set -u` gilt und der Block unten bei SKIP_STAND=1 entfaellt:
# Laeuft der Nachtlauf nicht mehr nach Zeitplan, steht hier die Meldung dazu.
NACHT_ZEITPLAN_HINWEIS=""
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
    # Je Check der juengste Lauf, ueber alle Seiten der Antwort — check_lage oben.
    LAGE=$(check_lage "$SHA")

    # ── Wenn main noch prüft: zählt der Lauf des PR, sofern der Code IDENTISCH ist ──
    #
    # BEFUND 30.08.2026: Die sechs Pflicht-Checks liefen zweimal über denselben
    # Code — einmal auf dem Zweig, einmal auf `main` nach dem Squash-Merge. Der
    # längste (`test-e2e`) dauert im Schnitt rund 8:45 (fünf Läufe: 8:13 bis 9:18).
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
        # BEFUND 31.08.2026 (A-9): Hier stand `|| true` ohne Meldung. Der
        # Ausfall war fail-closed, aber nicht diagnostizierbar — wer wissen
        # wollte, warum die Abkuerzung entfiel, fand nichts im Protokoll.
        if [ -z "$PRKOPF" ]; then
          echo "Hinweis: Kopf-Commit von PR #${PRNR} nicht ermittelbar (gh pr view) — die Baum-Regel entfaellt."
        fi
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
            LAGE_PR=$(check_lage "$PRKOPF")
            # BEFUND 31.08.2026 (A-9): auch hier fehlte die Meldung.
            if [ -z "$LAGE_PR" ]; then
              echo "Hinweis: Pruefergebnisse zu PR #${PRNR} nicht abrufbar (gh api) — die Baum-Regel entfaellt."
            fi
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
              # BEFUND aus Runde 1: `for X in $VAR` ohne `set -f` laesst die
              # Shell Platzhalter aufloesen. Ein Check-Name mit `*` oder `?`
              # wuerde dann gegen Dateinamen im Verzeichnis ersetzt. Heute
              # unmoeglich (GitHub-Job-Namen enthalten das nicht), aber die
              # Absicherung kostet eine Zeile.
              set -f
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
              set +f
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
    # ── Herkunft des HEIC-Dekoders (Befunde G-02, H-04, H-10 vom 30.09.2026) ──
    # Der Workflow libheif-Bau baut public/lib/libheif/ aus den Hersteller-
    # Quellen nach und vergleicht Byte fuer Byte (Job bauen); der Job
    # kontrollbau haelt die Bauumgebung gegen die frueher ausgelieferte Datei.
    # Er ist KEIN Pflicht-Check: Er laeuft nur bei Aenderungen am Dekoder oder
    # am Rezept, und ein Pflicht-Check mit Pfadfilter bliebe bei allen anderen
    # Pull Requests auf "wartend" stehen. Deshalb verlangt ihn der Deploy: Fuer
    # den juengsten Commit, der Dekoder, Rezept oder Workflow geaendert hat,
    # muss der juengste Lauf DIESES Workflows abgeschlossen und gruen sein —
    # beide Jobs zusammen, gebunden an den Workflow statt an einen Jobnamen.
    LIBHEIF_SHA=$(git log -1 --format=%H -- public/lib/libheif scripts/libheif-bauen.sh .github/workflows/libheif-bau.yml)
    if [ -n "$LIBHEIF_SHA" ] && [ ! -d public/lib/libheif ]; then
      # Rueckweg (docs/SECURITY-MODEL.md): Dekoder entfernt — dann gibt es nichts
      # nachzuweisen.
      echo "Hinweis: public/lib/libheif fehlt (Dekoder entfernt) — kein Herkunftsnachweis noetig."
    elif [ -n "$LIBHEIF_SHA" ]; then
      BAU=$(gh api "repos/malziland/malzime/actions/workflows/libheif-bau.yml/runs?head_sha=$LIBHEIF_SHA&per_page=20" \
        --jq '[.workflow_runs[]] | if length == 0 then "fehlt" else (max_by(.created_at) | if .status != "completed" then "laeuft" else (.conclusion // "unbekannt") end) end' \
        2>/dev/null || echo "nicht abrufbar")
      if [ "$BAU" != "success" ]; then
        echo "FEHLER: Herkunftsnachweis des HEIC-Dekoders (Workflow libheif-Bau) ist fuer $LIBHEIF_SHA nicht gruen (Ist: $BAU)." >&2
        echo "        Die ausgelieferten Dateien waeren dann nicht als Bau aus dem Rezept belegt. docs/RUNBOOK.md, libheif neu bauen." >&2
        echo "        Notschalter: SKIP_STAND=1" >&2
        exit 1
      fi
      echo "Herkunft HEIC-Dekoder: Workflow libheif-Bau gruen fuer $LIBHEIF_SHA."
    fi

    # ── Laeuft der Nachtlauf ueberhaupt? (Befunde H-03, K-01) ──
    # Ein ausbleibender Nachtlauf alarmiert niemanden: GitHub schaltet geplante
    # Workflows nach 60 Tagen ohne Aktivitaet ab und verwirft unter Last
    # gelegentlich Laeufe. Geprueft wird nicht seine Farbe — ein roter
    # Nachtlauf hat Alarm gegeben und darf den Deploy nicht blockieren, der ihn
    # behebt —, sondern dass er WIRKLICH gelaufen ist:
    #   · nur Laeufe dieses Repositorys (Befund J-03: `branch=main` liefert auch
    #     Laeufe aus Forks, deren Zweig "main" heisst),
    #   · nur nach Zeitplan oder von Hand gestartet, und nur mit Ergebnis
    #     "success" oder "failure" (Befund K-01: Ist die Workflow-Datei
    #     unlesbar, legt GitHub bei jedem Push einen roten Lauf OHNE Jobs an —
    #     Ereignis "push", den der Pull Request nicht anzeigt. Abgebrochene
    #     oder nie gestartete Laeufe haben ebenfalls nichts geprueft),
    #   · mit GENAU der Fassung von sicherheit-nachts.yml, die ausgeliefert
    #     wird: Nach jeder Aenderung am Nachtlauf muss er einmal gelaufen sein,
    #     sonst ist nicht belegt, dass die neue Fassung ueberhaupt laeuft,
    #   · nicht aelter als die Grenze.
    # Die Grenze steht NUR hier (Befund J-08); die Doku verweist auf sie.
    # Verglichen wird in Minuten — mit ganzen Stunden liesse "26" bis 26:59 durch.
    NACHT_GRENZE_MINUTEN=1560 # 26 Stunden: taeglicher Lauf plus Spielraum
    #
    # OPS-2026-10-03-13: Ein von Hand gestarteter Lauf genuegt diesem Riegel —
    # das ist so entschieden (docs/SECURITY-MODEL.md) und nach einer Aenderung
    # an sicherheit-nachts.yml auch der richtige Handgriff. Er sagt aber nichts
    # darueber, ob GitHub den ZEITPLAN noch ausfuehrt: Die Auslieferkette startet
    # einen fehlenden Lauf selbst, und ein abgeschalteter Zeitplan fiele bei
    # keiner Auslieferung auf. Deshalb liest dieselbe Abfrage zusaetzlich den
    # juengsten Lauf mit Ereignis "schedule". Ist er aelter als die zweite
    # Grenze oder fehlt er, wird ausgeliefert wie entschieden — aber mit einer
    # Meldung, die nicht zu uebersehen ist: hier, vor dem Upload, und noch
    # einmal ganz am Ende. Zwei Tage: Der Lauf ist taeglich geplant, GitHub
    # startet ihn bis zu einem halben Tag verspaetet (gemessen 01.–03.10.2026);
    # eine einzelne Verspaetung loest die Meldung also nicht aus.
    NACHT_ZEITPLAN_GRENZE_MINUTEN=2880
    NACHT=$(gh api "repos/malziland/malzime/actions/workflows/sicherheit-nachts.yml/runs?branch=main&status=completed&per_page=20" \
      --jq '[.workflow_runs[] | select(.head_repository.full_name == "malziland/malzime" and (.event == "schedule" or .event == "workflow_dispatch") and (.conclusion == "success" or .conclusion == "failure"))] | (if length == 0 then "fehlt fehlt" else (.[0] | .created_at + " " + .head_sha) end) + " " + (map(select(.event == "schedule")) | if length == 0 then "fehlt" else .[0].created_at end)' \
      2>/dev/null || echo "nicht-abrufbar nicht-abrufbar nicht-abrufbar")
    # Drei Felder: Zeit und Commit des juengsten gelaufenen Laufs, dann die Zeit
    # des juengsten Laufs nach Zeitplan.
    read -r NACHT_ZEIT NACHT_SHA NACHT_PLAN_ZEIT <<<"$NACHT"
    NACHT_MINUTEN=$(node -e 'const t = Date.parse(process.argv[1]); console.log(Number.isNaN(t) ? -1 : Math.floor((Date.now() - t) / 60000));' "$NACHT_ZEIT")
    NACHT_PLAN_MINUTEN=$(node -e 'const t = Date.parse(process.argv[1]); console.log(Number.isNaN(t) ? -1 : Math.floor((Date.now() - t) / 60000));' "${NACHT_PLAN_ZEIT:-fehlt}")
    NACHT_PLAN_STEHT=0
    if [ "$NACHT_PLAN_MINUTEN" -lt 0 ] || [ "$NACHT_PLAN_MINUTEN" -gt "$NACHT_ZEITPLAN_GRENZE_MINUTEN" ]; then
      NACHT_PLAN_STEHT=1
    fi
    if [ "$NACHT_MINUTEN" -lt 0 ] || [ "$NACHT_MINUTEN" -gt "$NACHT_GRENZE_MINUTEN" ]; then
      echo "FEHLER: Juengster gelaufener Nachtlauf \"Sicherheit nachts\" auf main: $NACHT_ZEIT (vor ${NACHT_MINUTEN} min) — fehlt oder ist aelter als ${NACHT_GRENZE_MINUTEN} min." >&2
      echo "        Dann meldet niemand neue Sicherheitsluecken. Starten: gh workflow run sicherheit-nachts.yml" >&2
      echo "        (erst wenn die Pipeline des Merge-Commits fertig ist), abwarten, erneut deployen." >&2
      echo "        Ist er abgeschaltet: unter \"Actions\" einschalten. Notschalter: SKIP_STAND=1" >&2
      if [ "$NACHT_PLAN_STEHT" = "1" ] && [ "$NACHT_ZEIT" != "nicht-abrufbar" ]; then
        echo "        Der Zeitplan selbst laeuft nicht: Der juengste Lauf nach Zeitplan ist aelter als" >&2
        echo "        ${NACHT_ZEITPLAN_GRENZE_MINUTEN} min oder fehlt. Ein Handstart oeffnet nur diesen Riegel — die" >&2
        echo "        Ursache (Workflow abgeschaltet?) bleibt. Erst klaeren und weitermelden, dann starten." >&2
      fi
      exit 1
    fi
    NACHT_WF=.github/workflows/sicherheit-nachts.yml
    NACHT_SOLL=$(git rev-parse "HEAD:$NACHT_WF" 2>/dev/null || echo "fehlt")
    NACHT_IST=$(git rev-parse "$NACHT_SHA:$NACHT_WF" 2>/dev/null || echo "unbekannt")
    if [ "$NACHT_IST" != "$NACHT_SOLL" ]; then
      echo "FEHLER: Der juengste Nachtlauf (Commit $NACHT_SHA) lief nicht mit der Fassung von" >&2
      echo "        $NACHT_WF, die ausgeliefert wird. Nach jeder Aenderung am Nachtlauf muss er" >&2
      echo "        einmal laufen — sonst ist nicht belegt, dass die neue Fassung ueberhaupt laeuft." >&2
      echo "        Starten: gh workflow run sicherheit-nachts.yml (erst wenn die Pipeline des" >&2
      echo "        Merge-Commits fertig ist), abwarten, erneut deployen. Notschalter: SKIP_STAND=1" >&2
      exit 1
    fi
    echo "Nachtlauf: juengster gelaufener Lauf auf main vor ${NACHT_MINUTEN} min (Grenze ${NACHT_GRENZE_MINUTEN} min), mit der ausgelieferten Fassung."
    if [ "$NACHT_PLAN_STEHT" = "1" ]; then
      if [ "$NACHT_PLAN_MINUTEN" -lt 0 ]; then
        NACHT_PLAN_LAGE="Unter den letzten 20 abgeschlossenen Laeufen auf main ist kein einziger nach Zeitplan."
      else
        NACHT_PLAN_LAGE="Juengster Lauf NACH ZEITPLAN auf main: $NACHT_PLAN_ZEIT (vor ${NACHT_PLAN_MINUTEN} min) — aelter als ${NACHT_ZEITPLAN_GRENZE_MINUTEN} min."
      fi
      NACHT_ZEITPLAN_HINWEIS="ACHTUNG: Der Nachtlauf \"Sicherheit nachts\" laeuft nicht nach Zeitplan.
 $NACHT_PLAN_LAGE
 Der Lauf, der diese Auslieferung freigibt, wurde von Hand gestartet. Heute ist
 damit geprueft; ZWISCHEN den Auslieferungen sucht aber niemand mehr nach neuen
 Sicherheitsluecken, und es kommt auch kein Alarm.
 ZU TUN: auf GitHub unter \"Actions\" nachsehen, ob der Workflow abgeschaltet ist
 (das geschieht nach 60 Tagen ohne Aktivitaet), und ihn einschalten. Diese
 Meldung weitergeben — ein Lauf von Hand behebt die Ursache nicht.
 docs/RUNBOOK.md, Abschnitt \"Nachtlauf Sicherheit nachts rot\"."
      echo ""
      echo "════════════════════════════════════════════════════════════════"
      echo " $NACHT_ZEITPLAN_HINWEIS"
      echo "════════════════════════════════════════════════════════════════"
      echo ""
    else
      echo "Nachtlauf: juengster Lauf nach Zeitplan vor ${NACHT_PLAN_MINUTEN} min (Meldung ab ${NACHT_ZEITPLAN_GRENZE_MINUTEN} min)."
    fi
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
  FIREBASE_ZEILE="$(firebase --version 2>/dev/null | head -1 || true)"
  FIREBASE_IST="$(printf '%s' "$FIREBASE_ZEILE" | tr -d '[:space:]')"
  # Fail-closed: Eine nicht ermittelbare Version ist ausdruecklich kein
  # bestandener Riegel. Leer ist zuerst ein Verdacht gegen die Messung.
  if [ -z "$FIREBASE_IST" ]; then
    echo "FEHLER: Version der Firebase-CLI nicht ermittelbar (\`firebase --version\` lieferte nichts)." >&2
    echo "        Ohne bekanntes Werkzeug kein Deploy. Notschalter: SKIP_CLI_CHECK=1" >&2
    exit 1
  fi
  # OPS-2026-10-03-16: "Nicht ermittelbar" ist auch jede Ausgabe, die keine
  # Versionsnummer ist — eine Warnung, eine Fehlermeldung, ein Hinweis vor der
  # eigentlichen Zeile. Im Vergleich unten sortiert Text hinter Ziffern: Die
  # Untergrenze stuende vorn, der Riegel gaelte als bestanden, und das Protokoll
  # hielte den Fremdtext als "Version" fest. Verlangt sind genau drei Zahlen.
  # Das Muster steht in einer Variablen: So liest es jede bash-Fassung gleich.
  VERSIONSMUSTER='^[0-9]+\.[0-9]+\.[0-9]+$'
  if ! [[ "$FIREBASE_IST" =~ $VERSIONSMUSTER ]]; then
    echo "FEHLER: Version der Firebase-CLI nicht ermittelbar — \`firebase --version\` lieferte keine" >&2
    echo "        Versionsnummer aus drei Zahlen (etwa $FIREBASE_MIN), sondern: $FIREBASE_ZEILE" >&2
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
  # OPS-2026-10-03-15: Der Wert wird gelesen statt durchgereicht. Die Pruefung
  # kennt zwei Fehlschlaege — Abweichung (1) und „Voraussetzung fehlt“ (2, etwa
  # ohne gcloud-Anmeldung). Fuer die Auslieferung sind beide dasselbe: Abbruch.
  INFRA_RC=0
  ./scripts/verify-infrastructure.sh || INFRA_RC=$?
  if [ "$INFRA_RC" -ne 0 ]; then
    echo "FEHLER: Die Infrastruktur-Pruefung ist nicht bestanden (Code $INFRA_RC) — nichts wurde ausgeliefert." >&2
    echo "        Notschalter: SKIP_INFRA=1" >&2
    exit 1
  fi
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
  # BEFUND 01.09.2026 (Runde 7, L-14): Hier stand `|| true`. Faellt das Netz
  # aus oder laeuft die Anfrage in die Zeitgrenze, blieb die Antwort leer und
  # das Skript brach mit "kein gueltiger Einstellungssatz erkennbar" ab — eine
  # Aussage ueber die Produktion, die es gar nicht gemessen hatte. Der falsche
  # Rat daneben (Satz anlegen, oder SKIP_SATZ=1 setzen) haette den Riegel
  # entwaffnet, um ein Netzproblem zu umgehen. Beide Faelle sind Abbruch, aber
  # sie brauchen verschiedene Meldungen.
  SATZ_RC=0
  SATZ_ANTWORT=$(curl -s --max-time 20 "https://malzi.me/api/stats" 2>/dev/null) || SATZ_RC=$?
  if [ "$SATZ_RC" -ne 0 ]; then
    echo "ABBRUCH: https://malzi.me/api/stats war nicht erreichbar (curl-Rueckgabewert $SATZ_RC)."
    echo "         Damit ist NICHT geprueft, ob ein Einstellungssatz vorliegt —"
    echo "         das ist kein Befund ueber die Produktion, sondern eine"
    echo "         gescheiterte Messung. Netz pruefen und erneut starten."
    echo
    echo "         SKIP_SATZ=1 waere hier das falsche Werkzeug: Es hebt den"
    echo "         Riegel auf, statt die Messung zu wiederholen."
    exit 1
  fi
  SATZ_LIMIT=$(printf '%s' "$SATZ_ANTWORT" | grep -o '"limit":[0-9]*' | head -1 | grep -o '[0-9]*$' || true)
  if [ -z "$SATZ_LIMIT" ] || [ "$SATZ_LIMIT" -lt 1 ] 2>/dev/null; then
    echo "ABBRUCH: In der Produktion ist kein gueltiger Einstellungssatz erkennbar."
    echo "         Ohne ihn scheitert nach dem Deploy JEDE Analyse."
    echo
    echo "         Zuerst:  node scripts/betriebsprofil-anlegen.js --ausfuehren"
    echo "         Danach:  bash scripts/deploy.sh"
    echo
    echo "         (Beim allerersten Deploy von v4.4 ist das erwartet: Die alte"
    echo "          Fassung liest den Satz nicht, meldet aber ihr eigenes Limit."
    echo "          Notschalter SKIP_SATZ=1, wenn der Satz nachweislich liegt.)"
    exit 1
  fi
  echo "  ok    Einstellungssatz erkennbar (Stundenlimit $SATZ_LIMIT)"
fi

# ── Deploy-Ziel und der Firestore-Schritt ──
# Das Ziel ($TARGET) steht seit ARCH-2026-10-03-10 am Anfang des Skripts fest;
# es enthaelt immer die Website. Was hier folgt, erklaert, warum Firestore
# nicht zum Ziel gehoert, sondern als eigener Schritt ausgerollt wird.
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
  # OPS-2026-10-04-12: Jeder Lauf schreibt seine zwei Protokolle in einen
  # EIGENEN Ordner. Mit festen Dateinamen ueberschrieb ein zweiter Lauf (ein
  # Probelauf, ein Test) das Protokoll, auf das die Fehlermeldung des ersten
  # gerade verweist. Scheitert ein Trockenlauf, bleibt der Ordner liegen — die
  # Meldung nennt ihn; geht alles durch, wird er entfernt.
  if ! DRY_ORDNER=$(mktemp -d "${TMPDIR:-/tmp}/malzime-trockenlauf.XXXXXX" 2>/dev/null) || [ ! -d "$DRY_ORDNER" ]; then
    echo "FEHLER: Fuer die Protokolle des Trockenlaufs liess sich kein Ordner anlegen (unter ${TMPDIR:-/tmp})." >&2
    echo "        Ohne Protokoll liesse sich ein Fehlschlag nicht nachlesen — nichts wurde ausgeliefert." >&2
    echo "        Notschalter: SKIP_DRYRUN=1" >&2
    exit 1
  fi

  if [ "${SKIP_FIRESTORE:-0}" != "1" ]; then
    if ! firebase deploy --only firestore:malzime-eu --dry-run >"$DRY_ORDNER/firestore.log" 2>&1; then
      echo "FEHLER: Der Trockenlauf fuer Firestore ist gescheitert — nichts wurde ausgeliefert." >&2
      tail -15 "$DRY_ORDNER/firestore.log" | sed 's/^/    /' >&2
      echo "        Das vollstaendige Protokoll: $DRY_ORDNER/firestore.log" >&2
      echo "        Notschalter: SKIP_DRYRUN=1" >&2
      exit 1
    fi
    echo "  ok    Firestore-Regeln und Indizes"
  fi

  if ! firebase deploy --only "$TARGET" --dry-run >"$DRY_ORDNER/rest.log" 2>&1; then
    echo "FEHLER: Der Trockenlauf fuer $TARGET ist gescheitert — nichts wurde ausgeliefert." >&2
    tail -15 "$DRY_ORDNER/rest.log" | sed 's/^/    /' >&2
    echo "        Das vollstaendige Protokoll: $DRY_ORDNER/rest.log" >&2
    echo "        Notschalter: SKIP_DRYRUN=1" >&2
    exit 1
  fi
  echo "  ok    $TARGET"
  rm -rf "$DRY_ORDNER"
  echo "Trockenlauf gruen in $(( $(date +%s) - DRY_START )) s — die Auslieferung sollte durchgehen."
fi

# ── Cache-Busting-Version generieren (Konvention: ?v=YYYYMMDDNN) ──
# Aktuellen Buster aus index.html lesen; am selben Tag laufende Nummer +1,
# sonst neuer Tag mit laufender Nummer 01. Die Website gehoert zu jedem Ziel
# (Riegel am Anfang des Skripts), der Buster also zu jeder Auslieferung.
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
  # BEFUND 31.08.2026 (Pruefer A, ausgefuehrt): `set -euo pipefail` gilt AUCH
  # im EXIT-Trap. Die Suche unten gibt 1 zurueck, sobald die letzte Datei
  # unter public/ keinen Cache-Buster traegt — und `build-info.json` traegt nie
  # einen. Der Trap brach dann mitten drin ab: Er raeumte NICHT auf und
  # verfaelschte obendrein den Fehlercode (7 wurde zu 1).
  #
  # Nachgestellt und belegt. Deshalb hier ausdruecklich abschalten — in einem
  # Aufraeumpfad ist ein Abbruch bei erstem Fehlschlag genau falsch.
  set +e
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
    # OPS-2026-10-03-15: Mit offenen Live-Proben endet das Skript bewusst mit
    # 2 — das ist kein Abbruch, die Schlusszeile sagt, was zu tun bleibt.
    if [ "$CODE" -eq 2 ] && [ "$LIVE_PROBEN_OFFEN" = "1" ]; then
      return
    fi
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
    # Zurueckgenommen wird GENAU das, was dieses Skript geschrieben hat —
    # nicht "alles unter public/" (das traefe fremde Handarbeit) und nicht
    # "was ein ?v= enthaelt" (das verfehlt build-info.json).
    #
    # DREI BEFUNDE aus dem Review vom 31.08.2026 stecken in dieser Fassung:
    #
    #   · `git checkout -- public/` verwarf ALLES dort. Der Sauberkeits-Riegel
    #     sollte das abfangen, faellt aber bei SKIP_STAND=1 weg.
    #   · Der Ersatz filterte auf `?v=` und liess `public/build-info.json`
    #     liegen, das nie eine Kennung traegt. Damit war die Falle wirkungslos:
    #     Der naechste Deploy scheiterte weiter am Sauberkeits-Riegel — also
    #     genau der Vorfall vom 30.08., gegen den sie gebaut wurde.
    #   · `git diff --name-only` gibt Pfade mit Umlauten ZITIERT und oktal
    #     escaped aus. Eine deutschsprachige Seite waere still liegengeblieben.
    #
    # Deshalb kommt die Liste aus derselben Quelle wie oben beim Schreiben
    # ($BUSTER_DATEIEN) plus build-info.json — kein Filter, keine Zitierung.
    ZURUECK=""
    # `${…:-}` weil `set -u` aktiv ist: Bricht der Deploy ab, BEVOR die
    # Liste gebaut wurde (etwa am Trockenlauf), waere die Variable ungesetzt
    # und die Falle stuerbe an ihrer eigenen Absicherung. Dann gibt es aber
    # auch nichts zurueckzunehmen — leer ist hier die richtige Antwort.
    for D in ${BUSTER_DATEIEN:-} "public/build-info.json"; do
      [ -f "$D" ] || continue
      if ! git diff --quiet -- "$D" 2>/dev/null; then
        ZURUECK="$ZURUECK$D
"
      fi
    done
    ANZAHL=$(printf '%s' "$ZURUECK" | grep -c . || true)
    if [ "$ANZAHL" -eq 0 ]; then
      echo "  Keine der vom Skript geschriebenen Dateien ist veraendert —"
      echo "  nichts angefasst. (Was sonst unter public/ liegt, bleibt unberuehrt.)"
    else
      # Einzeln statt ueber xargs: Nach einer Pipe misst `$?` den LETZTEN
      # Befehl, nicht den, ueber den man etwas behauptet — genau die Falle, die
      # der Waechter gegen stille Fehlschlaege bewacht. Und ein Fehlschlag bei
      # EINER Datei soll die anderen nicht mitnehmen.
      GESCHEITERT=0
      SCHLEIFEN_IFS=$IFS
      IFS='
'
      for D in $ZURUECK; do
        IFS=$SCHLEIFEN_IFS
        if ! git checkout -- "$D" 2>/dev/null; then
          echo "  ACHTUNG: $D liess sich nicht zuruecksetzen."
          GESCHEITERT=$((GESCHEITERT + 1))
        fi
        IFS='
'
      done
      IFS=$SCHLEIFEN_IFS
      if [ "$GESCHEITERT" -eq 0 ]; then
        echo "  $ANZAHL Datei(en) zurueckgesetzt."
      else
        echo "  $GESCHEITERT von $ANZAHL Datei(en) blieben liegen."
        echo "  Der naechste Deploy wird am Sauberkeits-Riegel abbrechen."
        echo "  Von Hand: git checkout -- public/"
      fi
    fi
  fi
}
# Die Falle liest den Rueckgabewert als Erstes (CODE); danach gilt die Regel
# vom Anfang des Skripts weiter: Nur ein Fall endet mit 2.
trap 'aufraeumen_bei_abbruch; nur_ein_fall_endet_mit_2 "$CODE"' EXIT

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
# BEFUND 31.08.2026 (Gegenpruefer, ausgefuehrt): `for f in $BUSTER_DATEIEN`
# ohne Anfuehrungszeichen zerlegt einen Dateinamen mit Leerzeichen in zwei
# Woerter. `[ -f ]` ist dann falsch, die Seite wird STILL uebersprungen und
# friert auf einem alten Stilblatt ein — genau der Fehler, gegen den
# OPS-2026-08-18-02 gebaut wurde. `deploy-buster-script.test.js` bleibt dabei
# gruen, weil er die Liste nur liest.
#
# Zeilenweise lesen statt Wortaufspaltung. Ein Zeilenumbruch im Dateinamen
# bliebe ein Problem — den verbietet aber schon die Namenskonvention, und
# `find` wuerde ihn ohnehin als zwei Eintraege liefern.
BUSTER_DATEIEN=$(find public -name '*.html' | sort; echo public/js/demo.js)
# BEFUND 31.08.2026 (Gegenpruefer, ausgefuehrt): Hier stand
# `for f in $BUSTER_DATEIEN` ohne Anfuehrungszeichen. Ein Dateiname mit
# Leerzeichen zerfaellt dabei in zwei Woerter, `[ -f ]` ist falsch, und die
# Seite wird STILL uebersprungen — sie friert auf einem alten Stilblatt ein.
# Genau der Fehler, gegen den OPS-2026-08-18-02 gebaut wurde, und
# `deploy-buster-script.test.js` bleibt dabei gruen, weil er nur die Liste
# liest.
#
# Zeilenweise ueber IFS statt ueber eine Pipe: Eine Pipe erzeugt eine
# Subshell, in der ein Fehlschlag verschluckt wuerde — bei einem Schritt, der
# Dateien schreibt, ist das die falsche Wahl.
ALT_IFS=$IFS
IFS='
'
for f in $BUSTER_DATEIEN; do
  IFS=$ALT_IFS
  if [ -f "$f" ]; then
    # BUG-009: Cross-platform sed (macOS + Linux)
    if sed --version >/dev/null 2>&1; then
      sed -i "s/\?v=[0-9][0-9]*/\?v=$VERSION/g" "$f"
    else
      sed -i '' "s/\?v=[0-9][0-9]*/\?v=$VERSION/g" "$f"
    fi
    echo "  $f aktualisiert"
  fi
  IFS='
'
done
IFS=$ALT_IFS

# Fingerabdruck des Ausgelieferten. MUSS nach der Buster-Ersetzung laufen —
# sonst stehen dort die Pruefsummen des Zustands DAVOR, und jede Nachpruefung
# meldet Abweichungen, wo keine sind.
if ! node scripts/build-info.mjs "$VERSION"; then
  echo "FEHLER: build-info.json konnte nicht erzeugt werden." >&2
  exit 1
fi

# ── ARCH-2026-10-03-10, Gegenrichtung: Die Website allein geht nur hinaus, wenn der Server-Code unveraendert ist ──
# Der eben erzeugte Fingerabdruck weist das Server-Paket des AUSGECHECKTEN
# Standes aus (Feld `serverPaket`), Datei fuer Datei: das Programm, dazu
# package.json und package-lock.json (welche Fremdpakete Google einsetzt) und
# die Sprachliste. Steht `functions` nicht im Ziel, wird dieses Paket aber
# nicht ausgeliefert. Hat es sich seit der letzten Auslieferung geaendert,
# wiese die Seite danach ein Server-Programm aus, das nie hinausging.
#
# Verglichen wird mit dem, was die Seite HEUTE ausweist: dem Fingerabdruck, der
# live steht. Bewusst nicht mit der eingecheckten Datei — der Fingerabdruck
# einer Auslieferung kommt erst mit dem Nachtrag ins Repository. Gerade wenn
# der reine Website-Weg gebraucht wird (docs/RUNBOOK.md, Hebel 5a: die Proben
# nach einer Auslieferung sind rot), ist der Nachtrag noch nicht geschrieben;
# die eingecheckte Datei traegt dann den Stand DAVOR.
#
# `functions` muss als Ganzes im Ziel stehen: Eine einzelne Function
# (`functions:name`) liefert nicht den ganzen ausgewiesenen Server-Code aus.
#
# Kein Notschalter. Der Ausweg ist die vollstaendige Auslieferung ohne Argument
# — sie liefert den ausgewiesenen Server-Code mit aus. Laesst sich der Vergleich
# nicht fuehren (Seite nicht erreichbar, Antwort kein Fingerabdruck), gilt er
# als nicht bestanden. Weist die Seite ihren Server noch in der Form bis zum
# 05.10.2026 aus (Feld `serverDateien`: nur die .js-Dateien unter
# functions/src/), laesst sich das Paket daran nicht vergleichen — es gilt dann
# als geaendert. Bricht der Riegel ab, nimmt die Aufraeumfalle die
# Cache-Kennung und den Fingerabdruck zurueck; hochgeladen ist bis hierher nichts.
if [[ ",$TARGET," != *",functions,"* ]]; then
  FINGERABDRUCK_LIVE_URL="https://malzi.me/build-info.json"
  AUSGEWIESEN_RC=0
  AUSGEWIESEN=$(curl -s --max-time 20 "$FINGERABDRUCK_LIVE_URL" 2>/dev/null) || AUSGEWIESEN_RC=$?
  if [ "$AUSGEWIESEN_RC" -ne 0 ]; then
    echo "FEHLER: $FINGERABDRUCK_LIVE_URL war nicht erreichbar (curl-Rueckgabewert $AUSGEWIESEN_RC)." >&2
    echo "        Damit ist nicht gemessen, welchen Server-Code die Seite heute ausweist. Ohne diesen" >&2
    echo "        Vergleich geht die Website nicht allein hinaus. Netz pruefen und erneut starten —" >&2
    echo "        oder Website und Server zusammen ausliefern: ./scripts/deploy.sh (ohne Argument)." >&2
    exit 1
  fi
  # Rueckgabewert des Vergleichs: 0 gleich (Ausgabe: Zahl der Dateien und der
  # live ausgewiesene Commit), 1 abweichend (Ausgabe: die abweichenden Dateien),
  # 2 nicht messbar (Ausgabe: LIVE oder NEU — welche Seite sich nicht lesen liess),
  # 3 die Seite weist ihren Server in der aelteren Form aus (nicht vergleichbar).
  # Ohne Pipe, damit der Rueckgabewert der des Vergleichs ist.
  VERGLEICH_RC=0
  VERGLEICH=$(node -e '
    const fs = require("fs");
    const lesen = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };
    const liste = (f, feld) =>
      f && f[feld] && typeof f[feld] === "object" && !Array.isArray(f[feld]) && Object.keys(f[feld]).length > 0
        ? f[feld]
        : null;
    const live = lesen(fs.readFileSync(0, "utf8"));
    const neu = liste(lesen(fs.readFileSync(process.argv[1], "utf8")), "serverPaket");
    const alt = liste(live, "serverPaket");
    if (!neu) {
      console.log("NEU");
      process.exit(2);
    }
    if (!alt) {
      if (liste(live, "serverDateien")) process.exit(3);
      console.log("LIVE");
      process.exit(2);
    }
    const namen = [...new Set([...Object.keys(alt), ...Object.keys(neu)])].sort();
    const anders = namen.filter((n) => alt[n] !== neu[n]);
    if (anders.length === 0) {
      const commit = /^[0-9a-f]{7,40}$/.test(String(live.commitKurz)) ? live.commitKurz : "unbekannt";
      console.log(`${namen.length} ${commit}`);
      process.exit(0);
    }
    for (const n of anders.slice(0, 12)) {
      console.log(`${n} (${!(n in alt) ? "neu" : !(n in neu) ? "entfaellt" : "geaendert"})`);
    }
    if (anders.length > 12) console.log(`... und ${anders.length - 12} weitere`);
    process.exit(1);
  ' public/build-info.json <<<"$AUSGEWIESEN") || VERGLEICH_RC=$?
  if [ "$VERGLEICH_RC" -eq 1 ]; then
    echo "FEHLER: Server-Code hat sich seit dem ausgewiesenen Stand geaendert — ohne Argument ausliefern." >&2
    echo "        Das Ziel \"$TARGET\" liefert den Server nicht aus. Der Fingerabdruck der Website" >&2
    echo "        (public/build-info.json) wiese danach einen Server-Code aus, der nie hinausging." >&2
    echo "        Abweichend gegenueber dem, was $FINGERABDRUCK_LIVE_URL heute ausweist:" >&2
    printf '%s\n' "$VERGLEICH" | sed 's/^/          /' >&2
    echo "        Website und Server zusammen: ./scripts/deploy.sh (ohne Argument)." >&2
    exit 1
  fi
  if [ "$VERGLEICH_RC" -eq 3 ]; then
    echo "FEHLER: Server-Paket gilt als geaendert — ohne Argument ausliefern." >&2
    echo "        $FINGERABDRUCK_LIVE_URL weist den Server noch in der aelteren Form aus: nur die" >&2
    echo "        Programmdateien, ohne package.json, package-lock.json und die Sprachliste. Ob sich" >&2
    echo "        das Server-Paket seit jener Auslieferung geaendert hat, laesst sich daran nicht messen." >&2
    echo "        Website und Server zusammen: ./scripts/deploy.sh (ohne Argument)." >&2
    exit 1
  fi
  if [ "$VERGLEICH_RC" -ne 0 ]; then
    if [ "$VERGLEICH" = "LIVE" ]; then
      echo "FEHLER: Die Antwort von $FINGERABDRUCK_LIVE_URL ist kein Fingerabdruck mit Server-Dateien" >&2
      echo "        (Feld serverPaket fehlt, ist leer oder die Antwort ist kein JSON)." >&2
    elif [ "$VERGLEICH" = "NEU" ]; then
      echo "FEHLER: Der eben erzeugte Fingerabdruck (public/build-info.json) nennt keine Server-Dateien." >&2
    else
      echo "FEHLER: Der Vergleich der Fingerabdruecke liess sich nicht ausfuehren (Code $VERGLEICH_RC)." >&2
    fi
    echo "        Damit ist nicht gemessen, ob sich der Server-Code seit dem ausgewiesenen Stand" >&2
    echo "        geaendert hat. Ohne diesen Vergleich geht die Website nicht allein hinaus." >&2
    echo "        Website und Server zusammen: ./scripts/deploy.sh (ohne Argument)." >&2
    exit 1
  fi
  echo "Server-Code unveraendert gegenueber dem ausgewiesenen Stand (${VERGLEICH% *} Dateien, live Commit ${VERGLEICH#* }) — die Website kann allein hinaus."
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
# ── SCHRITT 1: Firestore-Regeln und Indizes, ALLEIN ──
# Warum allein: siehe Kopfkommentar (Nachtrag 30.08.2026). Im Paket scheitert er.
# ── PROBELAUF: alles bis hierher, aber nichts ausliefern ──
#
# Bis zu dieser Zeile ist NICHTS live gegangen: Jeder Riegel ist gelaufen, der
# Trockenlauf hat die echte Firebase-Seite gefragt, die Cache-Kennung und
# build-info.json sind erzeugt. Was danach kommt, ist der Punkt ohne Rueckweg.
#
# `PROBELAUF=1` haelt genau hier an und nimmt die Aenderungen am Arbeitsbaum
# wieder zurueck. Damit laesst sich vor dem echten Deploy pruefen, ob die
# Auslieferung durchgehen WUERDE — ohne sie zu machen und ohne zu raten.
#
# Was der Probelauf NICHT beweist: dass das Hochladen selbst gelingt (Netz,
# Kontingente, Rechte) und dass die neue Fassung live funktioniert. Dafuer gibt
# es den Live-Smoke danach. Er beweist: alle Riegel gruen, der Stand ist
# auslieferbar, und die Kette bricht nicht auf halbem Weg ab.
if [ "${PROBELAUF:-0}" = "1" ]; then
  echo
  echo "── PROBELAUF: bis hierher waere alles bereit ──"
  echo "Jeder Riegel ist gelaufen, der Trockenlauf hat Firebase gefragt,"
  echo "die Cache-Kennung waere ?v=$VERSION."
  echo
  echo "NICHTS wurde ausgeliefert. Die Aenderungen am Arbeitsbaum werden"
  echo "jetzt zurueckgenommen."
  # Dieselben Dateien, die die Aufraeumfalle bei einem Abbruch zuruecknaehme.
  if ! git checkout -- public/ 2>/dev/null; then
    echo "WARNUNG: public/ konnte nicht zurueckgesetzt werden — bitte pruefen." >&2
  fi
  OFFEN="$(git status --porcelain)"
  if [ -n "$OFFEN" ]; then
    echo "WARNUNG: Der Arbeitsbaum ist nicht sauber:" >&2
    printf '%s\n' "$OFFEN" | sed 's/^/    /' >&2
    exit 1
  fi
  echo "Arbeitsbaum sauber. Fuer die echte Auslieferung: ohne PROBELAUF starten."
  exit 0
fi

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

# AB HIER IST ETWAS AUSGELIEFERT. Die Aufraeumfalle haelt sich von jetzt an
# raus: Was live steht, laesst sich nicht durch ein `git checkout` zuruecknehmen.
#
# BEFUND 31.08.2026 (Pruefer A): Die Marke stand VOR dem Firestore-Schritt.
# Genau der ist am 30.08. mehrfach gescheitert, bevor irgendetwas ausgerollt
# war — die Falle trat dann zurueck und liess die Cache-Kennung liegen. Sie
# versagte also ausgerechnet im Szenario, das sie ausgeloest hat.
#
# Der Firestore-Schritt aendert nichts an der Cache-Kennung: Er rollt Regeln und
# Indizes aus, keine Seiten. Ein Rueckbau der Kennung ist danach noch richtig —
# deshalb wird die Marke hier NICHT gesetzt.

# ── SCHRITT 2: Hosting und Functions ──
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only "$TARGET"
else
  npx firebase deploy --only "$TARGET"
fi

# BEFUND 31.08.2026 (Runde 2, von zwei Pruefern gegensaetzlich beurteilt, vom
# Gegenpruefer entschieden): Die Marke stand VOR diesem Schritt. Scheiterte der
# Upload — der lange, fehleranfaellige Teil —, meldete die Aufraeumfalle
# "Abbruch NACH dem Hochladen, die Kennung steht bereits live" und liess 14
# geaenderte Dateien liegen. Live stand aber nichts: Firestore rollt nur Regeln
# aus. Folge waren ein blockierter Folgeversuch UND ein build-info.json, das
# einen nie ausgelieferten Stand als echt ausgewiesen haette.
#
# Belegt mit drei Szenarien in einem Wegwerf-Klon (Attrappen-firebase):
#   Firestore rot -> 14 Dateien zurueckgesetzt, Baum sauber
#   Hosting rot   -> 14 Dateien zurueckgesetzt, Baum sauber  (vorher: falsch)
#   Smoke rot     -> Kennung bleibt, wie sie ist
#
# OFFEN und bewusst in Kauf genommen: Scheitert `--only hosting,functions`
# TEILWEISE (Hosting oben, Functions rot), naehme die Falle eine live stehende
# Kennung zurueck. Das ist der seltenere Fall; sauber wird es erst, wenn die
# Falle die live stehende Kennung MISST statt sie abzuleiten (das Werkzeug
# dafuer liegt in scripts/live-smoke.sh bereit).
HOCHGELADEN=1

# ── Live-Beweis: vier kostenfreie Proben gegen die frisch deployte Produktion ──
# (endet vor KI-Aufruf und Stundenzähler; Notschalter SKIP_SMOKE=1)
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  echo "WARNUNG: SKIP_SMOKE=1 gesetzt — Live-Smoke wird UEBERSPRUNGEN."
else
  # OPS-2026-08-13-42: Der Smoke bekommt die erwartete Buster-Version und liest
  # sie live zurück.
  # OPS-2026-10-03-15: Im Wartungsmodus koennen die Proben nicht messen und
  # melden 2. Das ist kein Abbruch — ausgeliefert ist. Das Skript laeuft dann
  # bis zur Schlussbilanz weiter und endet erst ganz am Schluss mit 2. Jeder
  # andere Fehlschlag haelt wie bisher sofort an.
  SMOKE_RC=0
  ./scripts/live-smoke.sh "$VERSION" || SMOKE_RC=$?
  if [ "$SMOKE_RC" -eq 2 ]; then
    LIVE_PROBEN_OFFEN=1
    echo "HINWEIS: Die Live-Proben konnten nicht messen (Code 2) — im Wartungsmodus ist das zu erwarten."
  elif [ "$SMOKE_RC" -ne 0 ]; then
    exit "$SMOKE_RC"
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
# BEFUND 01.09.2026 (Runde 7, L-13): DEPLOY_JA ist der einzige Ausnahmeweg
# ohne SKIP_-Namen und fehlte deshalb hier — auch der Waechter sucht nur nach
# `SKIP_[A-Z_]+`. Er hebt keinen Riegel auf, sondern die Rueckfrage an den
# Menschen davor. KERN 12 macht da keinen Unterschied: Wer die Bilanz liest,
# soll sehen, dass niemand bestaetigt hat.
[ -n "${DEPLOY_JA:-}" ]          && UEBERSPRUNGEN="$UEBERSPRUNGEN DEPLOY_JA(Rueckfrage)"

# OPS-2026-10-03-15: „alle Riegel gelaufen“ waere mit offenen Live-Proben zu
# viel gesagt — sie sind gelaufen, haben aber nichts gemessen.
PROBEN_OFFEN=""
[ "$LIVE_PROBEN_OFFEN" = "1" ] && PROBEN_OFFEN=" — ⚠ LIVE-PROBEN NICHT GEMESSEN (Wartungsmodus)"

echo ""
if [ -n "$UEBERSPRUNGEN" ]; then
  echo "Deploy abgeschlossen. Version: ?v=$VERSION — ⚠ ÜBERSPRUNGENE RIEGEL:$UEBERSPRUNGEN$PROBEN_OFFEN"
elif [ -n "$PROBEN_OFFEN" ]; then
  echo "Deploy abgeschlossen. Version: ?v=$VERSION — kein Riegel uebersprungen$PROBEN_OFFEN"
else
  echo "Deploy abgeschlossen. Version: ?v=$VERSION — alle Riegel gelaufen."
fi

# OPS-2026-10-03-13: Die Meldung von oben noch einmal, an der Stelle, an der
# zuletzt gelesen wird — die erste ist hinter der Ausgabe des Uploads verschwunden.
if [ -n "$NACHT_ZEITPLAN_HINWEIS" ]; then
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo " $NACHT_ZEITPLAN_HINWEIS"
  echo "════════════════════════════════════════════════════════════════"
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
# BEFUND 01.09.2026 (Runde 6): Mit `|| true` sah ein DEFEKTES Skript genauso
# aus wie ein CHANGELOG, das noch auf [Unveroeffentlicht] steht — beide leer.
# Der Rueckgabewert wird jetzt getrennt gelesen.
# ACHTUNG beim Bearbeiten: Unter `set -euo pipefail` bricht die Shell bei
# einer ZUWEISUNG ab, deren Kommando ungleich 0 liefert. `OBERSTE_RC=$?` in
# der naechsten Zeile wuerde nie erreicht — und genau das ist am 01.09.2026
# zweimal passiert. Das Skript liefert bei [Unveroeffentlicht] absichtlich 1;
# ein gruener Deploy endete dann mit Code 1, und alle 20 Riegel-Tests (die auf
# "Code ungleich 0" pruefen) wurden dadurch wertlos.
OBERSTE_RC=0
OBERSTE="$(bash scripts/changelog-oberste-version.sh CHANGELOG.md 2>/dev/null)" || OBERSTE_RC=$?
if [ "$OBERSTE_RC" -gt 1 ]; then
  echo "FEHLER: changelog-oberste-version.sh liess sich nicht ausfuehren (Code $OBERSTE_RC)." >&2
  echo "        Ohne sie ist nicht pruefbar, ob der CHANGELOG gestempelt wurde." >&2
  exit 1
fi
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

# ── OPS-2026-10-03-15: der eine Fall, der mit 2 endet ──
# Alles ist ausgeliefert, die Schlussbilanz steht oben — nur die Live-Proben
# konnten im Wartungsmodus nicht messen. Wer den Ablauf fuehrt, holt sie nach
# dem Ausschalten des Wartungsmodus nach (docs/RUNBOOK.md, „Die Auslieferung
# als Kette“). Die Zeile steht bewusst zuletzt.
if [ "$LIVE_PROBEN_OFFEN" = "1" ]; then
  echo ""
  echo "AUSGELIEFERT, LIVE-PROBEN OFFEN (Rueckgabewert 2) — nach „Wartungsmodus aus“ nachholen: ./scripts/live-smoke.sh $VERSION"
  exit 2
fi
