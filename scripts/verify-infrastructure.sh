#!/usr/bin/env bash
# malziME Infrastruktur-Prüfskript — AUSSCHLIESSLICH LESEND.
#
# Prüft den Ist-Zustand der Cloud-Infrastruktur gegen den Soll-Zustand aus
# docs/RUNBOOK.md („Normalbetrieb"). Hintergrund (Codex-Review 2026-08-12):
# Ein Teil der Sicherheits- und Datenschutz-Zusagen lebt NICHT im Repo,
# sondern in der Cloud-Konfiguration — `firebase deploy` verwaltet sie nicht.
# Dieses Skript macht die Regel „Zusagen über Infrastruktur werden an der
# Infrastruktur belegt" automatisch statt händisch.
#
# Es verändert NICHTS an der Infrastruktur: nur describe/list/get-iam-policy,
# dazu EINE lesende Abfrage bei GitHub (Zweigschutz von main, Abschnitt 10).
# Der Test functions/src/__tests__/verify-infrastructure-script.test.js
# erzwingt das (jede gcloud-/gsutil-Zeile muss ein Lese-Kommando sein, der
# einzige gh-Aufruf traegt keinen Schalter, der etwas aendert).
#
# Was es SEHR WOHL tut: Es fragt echte Dienste ab und braucht dafuer eine
# gcloud-Anmeldung. Ohne sie melden die betroffenen Abschnitte rot. Fuer Tests
# gibt es die Einspeisepunkte INFRA_PROBE_* — sie ersetzen die Antwort eines
# Abschnitts, ohne den Dienst zu fragen.
#
# Nutzung:
#   ./scripts/verify-infrastructure.sh      # direkt
#   (läuft automatisch in scripts/deploy.sh; Notschalter: SKIP_INFRA=1)
#
# Exit-Codes: 0 = alles grün · 1 = Abweichung gefunden · 2 = Voraussetzung fehlt

set -u
cd "$(dirname "$0")/.."

PROJECT="malzime"
REGION="europe-west1"
BUCKET="gs://malzime-queue-uploads"
QUEUE="analyze-queue"

FEHLER=0

gruen() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
rot()   { printf "  \033[31m✗\033[0m %s\n" "$1"; FEHLER=1; }

pruef() { # $1 Beschreibung, $2 Soll, $3 Ist
  if [ "$2" = "$3" ]; then
    gruen "$1: $3"
  else
    rot "$1: SOLL »${2}«, IST »${3:-<leer>}«"
  fi
}

# ── Voraussetzungen ──
# OPS-2026-08-13-41: Läuft mindestens ein Abschnitt über einen Einspeisepunkt
# (INFRA_PROBE_*), ist das ein Test-/Negativprobenlauf — dann keine gcloud-
# Anmeldung verlangen, sonst bräche das Skript vor dem geprüften Abschnitt ab
# (und der Riegel liesse sich, wie vier Wochen lang, gar nicht testen).
PROBEMODUS=0
if [ -n "${INFRA_PROBE_BUCKET:-}${INFRA_PROBE_TTL:-}${INFRA_PROBE_SCHEDULER:-}${INFRA_PROBE_BILDER:-}${INFRA_PROBE_SATZ:-}${INFRA_PROBE_ALARMREGELN:-}${INFRA_PROBE_ALARMKANAELE:-}${INFRA_PROBE_DIENSTE:-}${INFRA_PROBE_NTFY:-}${INFRA_PROBE_DIENST_UMGEBUNG:-}${INFRA_PROBE_ZWEIGSCHUTZ:-}" ]; then
  PROBEMODUS=1
fi
if ! command -v gcloud >/dev/null 2>&1 && [ "$PROBEMODUS" = "0" ]; then
  echo "FEHLER: gcloud nicht gefunden — Prüfung nicht möglich." >&2
  exit 2
fi
if [ "$PROBEMODUS" = "0" ]; then
  KONTO=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  if [ -z "$KONTO" ]; then
    echo "FEHLER: Keine aktive gcloud-Anmeldung. Bitte im Terminal 'gcloud auth login' ausführen." >&2
    exit 2
  fi
else
  KONTO="(Probemodus — Einspeisepunkt gesetzt)"
fi

echo "Infrastruktur-Prüfung malziME (Projekt $PROJECT, angemeldet: $KONTO)"

# ── 1. Cloud-Tasks-Queue: Region + Concurrency + Status ──
echo "— Cloud-Tasks-Queue"
QUEUE_INFO=$(gcloud tasks queues describe "$QUEUE" --location="$REGION" --project="$PROJECT" \
  --format="value(rateLimits.maxConcurrentDispatches,state)" 2>/dev/null || true)
QUEUE_CONC=$(printf "%s" "$QUEUE_INFO" | cut -f1)
QUEUE_STATE=$(printf "%s" "$QUEUE_INFO" | cut -f2)
# Dass describe mit --location=$REGION antwortet, IST der Regions-Beleg.
if [ -z "$QUEUE_INFO" ]; then
  rot "Queue »${QUEUE}« in $REGION nicht gefunden (falsche Region oder gelöscht?)"
else
  gruen "Queue »${QUEUE}« existiert in $REGION"

  # ── BEFUND 30.08.2026: Hier stand die feste Zahl 7 aus dem RUNBOOK ──
  # Genau die Doppelquelle, die der Firestore-Umbau abschaffen sollte: Der
  # Sollwert stand im Handbuch, der Istwert in der Queue, und der laufende
  # Betrieb richtete sich nach einem dritten Ort (dem Einstellungssatz). Als
  # die Parallelität am 30.08. von 7 auf 4 gesenkt wurde, meldete der Wächter
  # eine Abweichung — und hatte formal recht, obwohl nichts falsch war.
  #
  # Der Sollwert kommt jetzt aus dem Einstellungssatz, also von dort, wo er
  # ohnehin gilt. Damit prüft dieser Riegel, was er prüfen soll: Stimmen
  # Einstellung und echte Warteschlange überein?
  #
  # FAIL-CLOSED: Ist der Satz nicht lesbar, gilt das als nicht bestanden.
  # Ungeprüft ist kein Freibrief (KERN 4).
  SOLL_CONC=$(cd "$(dirname "$0")/../functions" && node -e '
    const { Firestore } = require("@google-cloud/firestore");
    new Firestore({ projectId: "malzime", databaseId: "malzime-eu" })
      .doc("config/betriebsprofil").get()
      .then((s) => {
        const d = s.data();
        const p = d && d.profile && d.profile[d.aktiv];
        console.log(p && p.parallelitaet !== undefined ? p.parallelitaet : "");
        process.exit(0);
      })
      .catch(() => { console.log(""); process.exit(0); });
  ' 2>/dev/null)

  if [ -z "$SOLL_CONC" ]; then
    rot "Parallelität: Sollwert nicht aus dem Einstellungssatz lesbar — ungeprüft gilt als nicht bestanden"
  else
    pruef "Parallelität (Einstellungssatz)" "$SOLL_CONC" "$QUEUE_CONC"
  fi

  pruef "Queue-Status" "RUNNING" "$QUEUE_STATE"
fi

# ── 1b. Einstellungssatz: Datenbank == Repo ──
# OPS-2026-09-01-02 (Audit 01.09.2026): Die Wahrheit ueber die Betriebswerte
# liegt in `config/betriebsprofil`; `functions/src/produktiv-satz.js` ist die
# Kopie, aus der das Anlege-Skript schreibt. Der Test `satz-gegen-doku` hielt
# die Doku gegen die Kopie — niemand hielt die Kopie gegen die Wahrheit. Zwei
# Tage lang wich die Datenbank in acht Feldern ab, sieben davon in den beiden
# Ersatz-Profilen fuer den Ernstfall, ohne Signal.
#
# Der Vergleich ist reine Lesung (scripts/betriebsprofil-vergleichen.js). Im
# Probemodus laeuft er NUR mit eigenem Einspeisepunkt (INFRA_PROBE_SATZ) —
# sonst griffe der Unit-Test des Bucket-Riegels aus dem Test heraus auf die
# echte Datenbank zu (Runde-5-Lehre: kein Netz aus einem Unit-Test).
# FAIL-CLOSED: nicht messbar gilt als nicht bestanden.
echo "— Einstellungssatz (config/betriebsprofil gegen functions/src/produktiv-satz.js)"
if [ "$PROBEMODUS" = "1" ] && [ -z "${INFRA_PROBE_SATZ:-}" ]; then
  echo "  · uebersprungen (Probemodus ohne INFRA_PROBE_SATZ)"
else
  if [ -n "${INFRA_PROBE_SATZ:-}" ]; then
    SATZ_AUSGABE=$(node scripts/betriebsprofil-vergleichen.js --datei "$INFRA_PROBE_SATZ" 2>&1); SATZ_RC=$?
  else
    SATZ_AUSGABE=$(node scripts/betriebsprofil-vergleichen.js 2>&1); SATZ_RC=$?
  fi
  case "$SATZ_RC" in
    0) gruen "Einstellungssatz: Datenbank und Repo stimmen ueberein"
       printf '%s\n' "$SATZ_AUSGABE" | grep '^HINWEIS' | sed 's/^/      /' || true ;;
    1) rot "Einstellungssatz weicht vom Repo ab — nachziehen oder bewusst entscheiden:"
       printf '%s\n' "$SATZ_AUSGABE" | sed 's/^/      /' ;;
    *) rot "Einstellungssatz nicht vergleichbar (ungeprueft gilt als nicht bestanden): $(printf '%s' "$SATZ_AUSGABE" | tail -1)" ;;
  esac
fi

# ── 2. Upload-Bucket: EU-Region, Lifecycle-Sicherheitsnetz, Soft-Delete aus ──
echo "— Upload-Bucket ($BUCKET)"
# OPS-2026-08-13-41: Einspeisepunkt. Ist INFRA_PROBE_BUCKET gesetzt, wird die
# vorbereitete Antwort gelesen statt gcloud gefragt — so kann ein Test belegen,
# dass dieser Abschnitt ueberhaupt rot werden kann (er konnte es 4 Wochen nicht).
if [ -n "${INFRA_PROBE_BUCKET:-}" ]; then
  BUCKET_JSON=$(cat "$INFRA_PROBE_BUCKET")
else
  BUCKET_JSON=$(gcloud storage buckets describe "$BUCKET" --format=json 2>/dev/null || true)
fi
if [ -z "$BUCKET_JSON" ]; then
  rot "Bucket nicht lesbar/nicht gefunden"
else
  # OPS-2026-08-13-40: Der python3-Exit wird DIREKT ausgewertet. Vorher lief
  # `printf | python3 | sed` und geprueft wurde PIPESTATUS[0] = printf (immer 0)
  # statt [1] = python3 — der Fehlerzweig war rechnerisch tot, drei Kernzusagen
  # (EU-Region, Soft-Delete 0, Lifecycle) ungeschuetzt. Jetzt: python3-Ausgabe in
  # eine Variable (deren Exit = python3, kein Pipe dazwischen), danach faerben.
  BUCKET_AUSGABE=$(printf "%s" "$BUCKET_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ok = True
loc = d.get("location", "")
if loc == "EUROPE-WEST1":
    print("  OK Region: " + loc)
else:
    print("  FEHLT Region: SOLL EUROPE-WEST1, IST " + (loc or "<leer>")); ok = False
# Soft-Delete 0: geloescht heisst geloescht (PRIV-Zusage, Stand 2026-08).
# gcloud liefert die Bucket-Schluessel in snake_case (soft_delete_policy),
# die Unterschluessel aber in camelCase — beide Varianten abfangen.
sd_policy = d.get("soft_delete_policy") or d.get("softDeletePolicy") or {}
sd = str(sd_policy.get("retentionDurationSeconds", sd_policy.get("retention_duration_seconds", "<leer>")))
if sd in ("0", "0s"):
    print("  OK Soft-Delete: aus (0)")
else:
    print("  FEHLT Soft-Delete: SOLL 0, IST " + sd); ok = False
# Lifecycle: Delete nach 1 Tag als Sicherheitsnetz hinter der aktiven Loeschung
rules = (d.get("lifecycle_config") or d.get("lifecycle") or {}).get("rule") or []
netz = [r for r in rules
        if (r.get("action") or {}).get("type") == "Delete"
        and (r.get("condition") or {}).get("age") == 1]
if netz:
    print("  OK Lifecycle: Delete nach 1 Tag aktiv")
else:
    print("  FEHLT Lifecycle: keine Delete-Regel mit age=1 gefunden"); ok = False
sys.exit(0 if ok else 1)
')
  BUCKET_RC=$?
  printf "%s\n" "$BUCKET_AUSGABE" | sed -e "s/^  OK /  \x1b[32m✓\x1b[0m /" -e "s/^  FEHLT /  \x1b[31m✗\x1b[0m /"
  if [ "$BUCKET_RC" != "0" ]; then FEHLER=1; fi
fi

# ── 2b. Liegen ALTE Bilder im Speicher? (Zusage, nicht nur Code) ──
#
# VORFALL 31.08.2026: Im Bucket lagen 4.056 Bilder (233 MB) vom Vortag. Die
# aktive Loeschung nach der Analyse hatte nicht gegriffen; das Sicherheitsnetz
# (Lifecycle, 24 h) haette sie erst spaeter geraeumt.
#
# WARUM DAS HIER STEHT UND NICHT IM TEST: Es gibt Tests fuer `deleteImage` —
# und trotzdem blieben die Bilder liegen. Ein Test prueft den Code, diese
# Zeile prueft die WIRKLICHKEIT. Genau dieser Unterschied war der Befund.
#
# DIE ZUSAGE: Die Datenschutzerklaerung sagt, Bilder bleiben nur fuer die
# Wartezeit gespeichert. Jobs leben hoechstens zwei Stunden. Ein Bild, das
# aelter ist, gehoert zu keinem laufenden Auftrag mehr.
echo "— Bildspeicher (Zusage: nur fuer die Wartezeit)"
# BEFUND 31.08.2026 (Runde 2): Der Zweig "nicht lesbar" war TOTER CODE.
# `awk ... END {print n+0}` gibt auch bei leerer Eingabe "0" aus, und
# `2>/dev/null` schluckte den Fehler von gsutil — `[ -z ]` konnte nie wahr
# werden. Ein Zugriffsfehler auf den Bucket meldete GRUEN, ausgerechnet bei der
# Pruefung, die wegen 4.056 liegengebliebener Bilder gebaut wurde.
# Jetzt wird der Rueckgabewert von gsutil SELBST gemessen, vor der Zaehlung.
# OPS-2026-08-31-19: Einspeisepunkt fuer die Negativprobe. INFRA_PROBE_BILDER
# nennt eine Datei mit der gsutil-Ausgabe; INFRA_PROBE_BILDER_CODE den
# Rueckgabewert. Ohne ihn liess sich dieser Abschnitt nicht kaputtmachen —
# genau deshalb blieb der Fehler mit dem leeren Bucket unentdeckt.
# Nachlauf 04.10.2026: Die Fehlermeldung von gsutil lag in einer FESTEN Datei
# unter /tmp. Liefen zwei Laeufe gleichzeitig (etwa eine Auslieferung und die
# Tests dieses Skripts), las jeder die Meldung des anderen: Ein Zugriffsfehler
# galt dann als "leerer Bucket" oder umgekehrt (gemessen: 30 von 30 Paaren).
# Jetzt hat jeder Lauf seine eigene Datei.
GSUTIL_FEHLER=$(mktemp "${TMPDIR:-/tmp}/malzime-gsutil-fehler.XXXXXX") || { rot "Bildspeicher NICHT geprueft (keine Arbeitsdatei) — ungeprueft gilt als nicht bestanden"; GSUTIL_FEHLER=/dev/null; }
if [ -n "${INFRA_PROBE_BILDER:-}" ]; then
  BILDER_ROH=$(cat "$INFRA_PROBE_BILDER")
  GSUTIL_CODE="${INFRA_PROBE_BILDER_CODE:-0}"
  printf '%s' "${INFRA_PROBE_BILDER_FEHLER:-}" > "$GSUTIL_FEHLER"
else
BILDER_ROH=$(gsutil ls -l "$BUCKET/queue-uploads/" 2>"$GSUTIL_FEHLER")
GSUTIL_CODE=$?
fi
# BEFUND 31.08.2026 (Runde 3, von zwei Pruefern unabhaengig gefunden): Hier
# galt JEDER Rueckgabewert ungleich 0 als "nicht lesbar" — auch der LEERE
# Bucket. Der ist aber der SOLLZUSTAND: `gsutil ls` meldet dann
# "One or more URLs matched no objects" mit Code 1. Der Riegel haette also
# jeden Deploy abgebrochen, sobald der Bildspeicher sauber ist. Er laeuft bei
# JEDEM Deploy.
#
# Ursache der Luecke: Dieser Abschnitt war der EINZIGE des Skripts ohne
# Einspeisepunkt fuer eine Probe — er wurde nie kaputtgemacht und nachgesehen.
# Der Einspeisepunkt INFRA_PROBE_BILDER unten schliesst das.
if [ "$GSUTIL_CODE" -ne 0 ] && grep -q "matched no objects" "$GSUTIL_FEHLER" 2>/dev/null; then
  GSUTIL_CODE=0
  BILDER_ROH=""
fi
if [ "$GSUTIL_CODE" -ne 0 ]; then
  rot "Bildspeicher nicht lesbar (gsutil Code $GSUTIL_CODE) — ungeprueft gilt als nicht bestanden"
  sed 's/^/        /' "$GSUTIL_FEHLER" | head -3
  ALTE_BILDER="nicht-messbar"
else
  ALTE_BILDER=$(printf '%s\n' "$BILDER_ROH" \
    | grep -E "^ +[0-9]+" \
    | awk -v grenze="$(date -u -v-3H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
          '$2 < grenze {n++} END {print n+0}')
fi
[ "$GSUTIL_FEHLER" = /dev/null ] || rm -f "$GSUTIL_FEHLER"
if [ "$ALTE_BILDER" = "nicht-messbar" ]; then
  : # Meldung steht bereits oben
elif [ "$ALTE_BILDER" -eq 0 ]; then
  gruen "Keine Bilder aelter als 3 Stunden"
else
  rot "$ALTE_BILDER Bild(er) aelter als 3 Stunden — die aktive Loeschung greift nicht"
  echo "        Ein Auftrag lebt hoechstens 2 h. Aeltere Bilder gehoeren zu keinem mehr."
  echo "        Aufraeumen:  gsutil -m rm -r \"$BUCKET/queue-uploads/**\""
fi

# ── 3. Firestore: genau EINE Datenbank, malzime-eu in europe-west1 ──
echo "— Firestore"
DBS=$(gcloud firestore databases list --project="$PROJECT" --format="value(name,locationId)" 2>/dev/null || true)
DB_ANZAHL=$(printf "%s\n" "$DBS" | grep -c "databases/" || true)
if [ "$DB_ANZAHL" != "1" ]; then
  rot "Datenbank-Anzahl: SOLL 1, IST $DB_ANZAHL ($(printf "%s" "$DBS" | tr '\n' ' '))"
else
  DB_NAME=$(printf "%s" "$DBS" | cut -f1)
  DB_LOC=$(printf "%s" "$DBS" | cut -f2)
  pruef "Datenbank" "projects/$PROJECT/databases/malzime-eu" "$DB_NAME"
  pruef "Firestore-Region" "$REGION" "$DB_LOC"
fi

# ── 4. Worker-IAM: processJob + reapJobs dürfen NICHT öffentlich sein ──
# (enqueue/jobStatus/... sind bewusst öffentlich: Firebase Hosting reicht
#  die /api/*-Aufrufe an sie durch.)
echo "— Worker-Zugriffsschutz"
for DIENST in processjob reapjobs; do
  IAM=$(gcloud run services get-iam-policy "$DIENST" --region="$REGION" --project="$PROJECT" --format=json 2>/dev/null || true)
  if [ -z "$IAM" ]; then
    rot "$DIENST: IAM-Policy nicht lesbar"
  elif printf "%s" "$IAM" | grep -qE '"(allUsers|allAuthenticatedUsers)"'; then
    rot "$DIENST: ÖFFENTLICH erreichbar (allUsers/allAuthenticatedUsers gefunden!)"
  else
    gruen "$DIENST: nicht öffentlich (kein allUsers/allAuthenticatedUsers)"
  fi
done

# ── 5. Alle Functions in der EU-Region ──
# AUDIT-BEFUND OPS-2026-08-12-02: Diese Prüfung meldete GRÜN, wenn ihre Messung
# scheiterte. `gcloud … 2>/dev/null | python3 … || true` liefert bei abgelaufener
# Anmeldung, API-Fehler oder geändertem JSON-Format eine LEERE Ausgabe — und leer
# hieß „keine Function außerhalb europe-west1". Ausgerechnet die Prüfung, die das
# EU-Versprechen trägt, konnte nicht rot werden. Jetzt zählt sie, was sie gesehen
# hat: null gefundene Functions ist ein Messfehler, kein Freispruch (KERN 5c).
echo "— Functions-Regionen"
FUNKTIONEN_JSON=$(gcloud functions list --project="$PROJECT" --format=json 2>&1) || FUNKTIONEN_JSON=""
BEFUND=$(printf '%s' "$FUNKTIONEN_JSON" | python3 -c '
import json, sys
try:
    daten = json.load(sys.stdin)
except Exception:
    print("MESSFEHLER:Antwort nicht lesbar"); raise SystemExit(0)
if not isinstance(daten, list) or len(daten) == 0:
    print("MESSFEHLER:keine Function in der Antwort"); raise SystemExit(0)
aussen = []
for f in daten:
    teile = f.get("name", "").split("/")   # projects/P/locations/REGION/functions/NAME
    if len(teile) < 6:
        print("MESSFEHLER:unerwartetes Namensformat"); raise SystemExit(0)
    if teile[3] != "europe-west1":
        aussen.append(teile[3] + ":" + teile[5])
print(("AUSSERHALB:" + ",".join(aussen)) if aussen else "OK:%d" % len(daten))
' 2>/dev/null)

case "$BEFUND" in
  OK:*)         gruen "alle ${BEFUND#OK:} Functions in $REGION" ;;
  AUSSERHALB:*) rot   "Functions außerhalb $REGION: ${BEFUND#AUSSERHALB:}" ;;
  MESSFEHLER:*) rot   "Regionsprüfung NICHT durchgeführt (${BEFUND#MESSFEHLER:}) — ungeprüft gilt als nicht bestanden" ;;
  *)            rot   "Regionsprüfung NICHT durchgeführt (keine auswertbare Ausgabe) — ungeprüft gilt als nicht bestanden" ;;
esac

# ── 6. Logging: EU-Speicher, Routine-Ausschlüsse + Diagnose-Sink ──
echo "— Logging"
# 09.09.2026: Die Weiche _Default zeigt seit dem Umzug auf unseren Speicher
# betrieb-eu (europe-west1, 1 Tag). Googles globale Ablage bekommt nichts mehr.
# Drei Ausfallarten unterscheidbar: nicht messbar, falsches Ziel, falsche
# Aufbewahrung — sonst sähe ein gescheiterter Aufruf aus wie ein bestandener.
ZIEL_SOLL="logging.googleapis.com/projects/${PROJECT}/locations/europe-west1/buckets/betrieb-eu"
ZIEL_IST=$(gcloud logging sinks describe _Default --project="$PROJECT" --format='value(destination)' 2>/dev/null || true)
if [ -z "$ZIEL_IST" ]; then
  rot "_Default: Ziel der Log-Weiche NICHT MESSBAR (gcloud lieferte nichts)"
elif [ "$ZIEL_IST" = "$ZIEL_SOLL" ]; then
  gruen "_Default: Log-Weiche zeigt auf betrieb-eu (europe-west1)"
else
  rot "_Default: Log-Weiche zeigt NICHT auf den EU-Speicher (IST: $ZIEL_IST)"
fi
AUFBEWAHRUNG=$(gcloud logging buckets describe betrieb-eu --location=europe-west1 --project="$PROJECT" --format='value(retentionDays)' 2>/dev/null || true)
case "$AUFBEWAHRUNG" in
  "")  rot "betrieb-eu: Aufbewahrung NICHT MESSBAR (Speicher fehlt oder gcloud lieferte nichts)" ;;
  1)   gruen "betrieb-eu: Aufbewahrung 1 Tag (Datenschutz-Zusage)" ;;
  *)   rot "betrieb-eu: Aufbewahrung ist $AUFBEWAHRUNG Tage, Zusage sagt 1" ;;
esac
# AUDIT-BEFUND PRIV-2026-08-12-12: Der _Default-Speicher liegt auf Standort
# `global` und lässt sich nicht nach Europa verschieben. Einziger Träger von
# Client-IP-Adressen sind die Cloud-Run-Request-Logs — sie werden deshalb
# vollständig ausgeschlossen, nicht mehr nur unterhalb von ERROR. Geprüft wird
# der FILTER, nicht bloß der Name: Ein Ausschluss, der wieder eine
# Schwere-Bedingung enthält, ließe ERROR-Request-Logs samt IP durch und hieße
# trotzdem noch so.
#
# Drei unterscheidbare Ausfallarten statt einer — sonst sähe eine gescheiterte
# Messung aus wie ein fehlender Ausschluss (dieselbe Wurzel wie OPS-2026-08-12-02).
EXCL_ROH=$(gcloud logging sinks describe _Default --project="$PROJECT" --format=json 2>/dev/null || true)
if [ -z "$EXCL_ROH" ]; then
  rot "_Default: Ausschlüsse NICHT MESSBAR (gcloud lieferte nichts) — kein bestandener Riegel"
else
  EXCL_IP=$(printf "%s" "$EXCL_ROH" | python3 -c '
import json, sys
daten = json.load(sys.stdin)
for e in daten.get("exclusions", []):
    if e["name"] == "exclude_run_requests_ip":
        print(e.get("filter", ""))
        break
' || true)
  if [ -z "$EXCL_IP" ]; then
    VORHANDEN=$(printf "%s" "$EXCL_ROH" | python3 -c 'import json,sys; print(" ".join(e["name"] for e in json.load(sys.stdin).get("exclusions",[])))' || true)
    rot "_Default: Ausschluss »exclude_run_requests_ip« fehlt (IST: ${VORHANDEN:-<keine>})"
  elif printf "%s" "$EXCL_IP" | grep -qi "severity"; then
    rot "_Default: »exclude_run_requests_ip« enthält wieder eine Schwere-Bedingung — ERROR-Request-Logs mit IP landen auf »global«: $EXCL_IP"
  else
    gruen "_Default: Request-Logs (einziger IP-Träger) vollständig ausgeschlossen"
  fi
fi
# Der Diagnose-Sink wird am FILTER geprüft, nicht am Namen: Er entscheidet,
# welche Zeilen 30 Tage bleiben. Jede Zeile darin ist ohne Personenbezug —
# eine fünfte Bedingung, die hier niemand eingetragen hat, ist ein Befund.
DIAG_SOLL='jsonPayload.type="client-error" OR jsonPayload.type="client-telemetry" OR jsonPayload.step="mistral-single-large" OR jsonPayload.step="minor-safety"'
DIAG_IST=$(gcloud logging sinks describe client-diagnostics-sink --project="$PROJECT" --format='value(filter)' 2>/dev/null || true)
if [ -z "$DIAG_IST" ]; then
  rot "Diagnose-Sink »client-diagnostics-sink« NICHT MESSBAR oder fehlt"
elif [ "$DIAG_IST" = "$DIAG_SOLL" ]; then
  gruen "Diagnose-Sink »client-diagnostics-sink«: Filter wie vereinbart (4 Zeilenarten)"
else
  rot "Diagnose-Sink »client-diagnostics-sink«: Filter weicht ab (IST: $DIAG_IST)"
fi

# ── 6b. Secrets: EU-gebunden und befüllt ──
echo "— Secrets"
# 09.09.2026: Die Secrets waren weltweit repliziert (Google-Voreinstellung).
# Geprüft wird, was der Code tatsächlich verlangt (defineSecret in index.js):
# jedes dieser Secrets liegt in europe-west1 und hat mindestens eine aktive
# Version. Ohne Version startet die Function ohne Schlüssel — deshalb ist das
# ein Deploy-Riegel, kein Hinweis. Rückweg auf einen alten Stand nimmt dessen
# eigenen Riegel mit.
SECRET_NAMEN=$(grep -o 'defineSecret("[A-Za-z0-9_-]*")' functions/src/index.js | sed 's/defineSecret("\(.*\)")/\1/' | sort -u)
if [ -z "$SECRET_NAMEN" ]; then
  rot "Secrets: keine defineSecret-Deklaration in functions/src/index.js gefunden — Messung unbrauchbar"
fi
for SN in $SECRET_NAMEN; do
  ORT=$(gcloud secrets describe "$SN" --project="$PROJECT" --format='value(replication.userManaged.replicas[0].location)' 2>/dev/null || true)
  AUTOMATISCH=$(gcloud secrets describe "$SN" --project="$PROJECT" --format='value(replication.automatic)' 2>/dev/null || true)
  if [ -z "$ORT" ] && [ -z "$AUTOMATISCH" ]; then
    rot "Secret $SN: NICHT MESSBAR oder nicht vorhanden"
    continue
  fi
  if [ "$ORT" = "europe-west1" ]; then
    gruen "Secret $SN: an europe-west1 gebunden"
  else
    rot "Secret $SN: nicht an europe-west1 gebunden (IST: ${ORT:-automatisch/weltweit})"
  fi
  VERSIONEN=$(gcloud secrets versions list "$SN" --project="$PROJECT" --filter="state=enabled" --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${VERSIONEN:-0}" -ge 1 ]; then
    gruen "Secret $SN: $VERSIONEN aktive Version(en)"
  else
    rot "Secret $SN: KEINE aktive Version — Functions starten ohne Schlüssel (neue Version: gcloud secrets versions add $SN --data-file=- --project=$PROJECT)"
  fi
done

# ── 7. Alarmweg: existiert er noch, ist er scharf, hat er zustellfähige Kanäle? ──
# AUDIT-BEFUND OPS-2026-08-12-09: Der Alarmweg hatte keinen Wächter. Die Richtlinie
# ist eine Anwesenheits-Bedingung auf severity>=ERROR — ihr EIGENER Ausfall erzeugt
# keine Logzeile. Wird sie deaktiviert, ihr Filter verstellt oder ein Kanal
# gelöscht, sieht das exakt aus wie „keine Störung": Stille. Bei Bus-Faktor 1 ist
# das der Unterschied zwischen „ich erfahre es" und „ich erfahre es nie".
# Diese Prüfung ist deploy-zeitlich, nicht laufend — sie fängt den Fall beim
# nächsten Deploy, nicht in der Minute des Ausfalls. Das ist die Grenze dieser
# Maßnahme und steht so im RUNBOOK.
echo "— Alarmweg"
# OPS-2026-10-03-11: Seit 01.10.2026 gibt es fuenf Alarmregeln statt einer. Der
# Waechter prueft jede einzeln nach ihrem Anzeigenamen — vorher sah er nur die
# erste Regel mit severity>=ERROR; die vier anderen konnten aus, geloescht oder
# ohne Kanal sein, und jede Auslieferung meldete weiter "scharf".
# Die Namen stehen kanonisch in docs/ERROR-ALERTING.md; ein Test haelt diese
# Liste und die Doku gegeneinander. Eine Regel im Projekt, die hier NICHT steht,
# ist ebenfalls rot — sonst waere die naechste neue Regel wieder unbewacht.
# Jede Regel braucht einen eingeschalteten E-Mail-Kanal: Der Push aufs Handy
# haengt an einem fremden Dienst und kann ausbleiben (docs/ERROR-ALERTING.md,
# "Wenn der Push nicht weckt"); die E-Mail ist der Weg, der ankommen muss.
ALARM_REGELN='malziME Function Errors
malziME Analyse gescheitert
malziME Kinderschutz-Treffer
malziME Client-Fehler-Haeufung
malziME KI-Verbindung bricht gehäuft ab'

# Einspeisepunkte fuer Tests: INFRA_PROBE_ALARMREGELN und INFRA_PROBE_ALARMKANAELE
# nennen je eine Datei mit der Antwort, die sonst gcloud liefert.
if [ -n "${INFRA_PROBE_ALARMREGELN:-}" ]; then
  POLICY_JSON=$(cat "$INFRA_PROBE_ALARMREGELN")
else
  POLICY_JSON=$(gcloud alpha monitoring policies list --project="$PROJECT" --format=json 2>&1) || POLICY_JSON=""
fi
if [ -n "${INFRA_PROBE_ALARMKANAELE:-}" ]; then
  KANAL_JSON=$(cat "$INFRA_PROBE_ALARMKANAELE")
else
  KANAL_JSON=$(gcloud alpha monitoring channels list --project="$PROJECT" --format=json 2>&1) || KANAL_JSON=""
fi
ALARM=$(POLICY_JSON="$POLICY_JSON" KANAL_JSON="$KANAL_JSON" ALARM_REGELN="$ALARM_REGELN" PYTHONIOENCODING=utf-8 python3 -c '
import json, os
soll = [z.strip() for z in os.environ.get("ALARM_REGELN", "").split("\n") if z.strip()]
try:
    regeln = json.loads(os.environ.get("POLICY_JSON", ""))
except Exception:
    print("MESSFEHLER:Antwort zu den Alarmregeln nicht lesbar"); raise SystemExit(0)
if not isinstance(regeln, list) or not regeln:
    print("MESSFEHLER:keine Alarmregel in der Antwort"); raise SystemExit(0)
try:
    kanal_liste = json.loads(os.environ.get("KANAL_JSON", ""))
    kanal = {k.get("name"): k for k in kanal_liste} if isinstance(kanal_liste, list) and kanal_liste else None
except Exception:
    kanal = None
if kanal is None:
    print("MESSFEHLER:Liste der Kanaele nicht lesbar, E-Mail-Kanal je Regel ungeprueft")
nach_name = {}
for regel in regeln:
    nach_name.setdefault(regel.get("displayName", "?"), []).append(regel)
for name in soll:
    treffer = nach_name.get(name, [])
    if not treffer:
        print("FEHLT:" + name); continue
    regel = next((r for r in treffer if r.get("enabled", False)), None)
    if regel is None:
        print("AUS:" + name); continue
    kanaele = regel.get("notificationChannels", [])
    if not kanaele:
        print("OHNE_KANAL:" + name); continue
    if kanal is None:
        continue
    mail = [k for k in kanaele if kanal.get(k, {}).get("type") == "email" and kanal.get(k, {}).get("enabled")]
    if not mail:
        print("OHNE_MAIL:" + name); continue
    print("OK:%s:%d" % (name, len(kanaele)))
for name in sorted(nach_name):
    if name not in soll:
        print("UNBEWACHT:" + name)
' 2>/dev/null)

if [ -z "$ALARM" ]; then
  rot "Alarmweg NICHT geprueft (keine auswertbare Ausgabe) — ungeprueft gilt als nicht bestanden"
fi
# Hier-Dokument statt Rohr: `rot` setzt FEHLER=1, und in einer Rohr-Schleife
# ginge diese Zuweisung in einer Unter-Shell verloren.
while IFS= read -r ZEILE; do
  case "$ZEILE" in
    OK:*)         REST="${ZEILE#OK:}"; gruen "Alarmregel scharf: »${REST%:*}«, ${REST##*:} Kanal/Kanäle, E-Mail dabei" ;;
    AUS:*)        rot   "Alarmregel ist DEAKTIVIERT: »${ZEILE#AUS:}«" ;;
    OHNE_KANAL:*) rot   "Alarmregel hat KEINEN Benachrichtigungskanal: »${ZEILE#OHNE_KANAL:}«" ;;
    OHNE_MAIL:*)  rot   "Alarmregel hat keinen eingeschalteten E-Mail-Kanal: »${ZEILE#OHNE_MAIL:}«" ;;
    FEHLT:*)      rot   "Alarmregel FEHLT: »${ZEILE#FEHLT:}« — dieses Ereignis wuerde niemanden erreichen" ;;
    UNBEWACHT:*)  rot   "Alarmregel ohne Waechter: »${ZEILE#UNBEWACHT:}« — in ALARM_REGELN (dieses Skript) und docs/ERROR-ALERTING.md aufnehmen" ;;
    MESSFEHLER:*) rot   "Alarmweg NICHT geprueft (${ZEILE#MESSFEHLER:}) — ungeprueft gilt als nicht bestanden" ;;
    "")           ;;
    *)            rot   "Alarmweg NICHT geprueft (unerwartete Ausgabe) — ungeprueft gilt als nicht bestanden" ;;
  esac
done <<ALARM_ENDE
$ALARM
ALARM_ENDE

# Und die Kanäle selbst: ein Kanal kann verwaist oder abgeschaltet sein.
KANAELE=$(printf '%s' "$KANAL_JSON" | python3 -c '
import json, sys
try:
    daten = json.load(sys.stdin)
except Exception:
    print("MESSFEHLER"); raise SystemExit(0)
if not isinstance(daten, list) or not daten:
    print("MESSFEHLER"); raise SystemExit(0)
aktiv = [k for k in daten if k.get("enabled")]
aus = [k.get("displayName", "?") for k in daten if not k.get("enabled")]
print(("AUS:" + ", ".join(aus)) if aus else "OK:%d" % len(aktiv))
' 2>/dev/null)

case "$KANAELE" in
  OK:*)  gruen "Benachrichtigungskanäle aktiv: ${KANAELE#OK:}" ;;
  AUS:*) rot   "Abgeschaltete Benachrichtigungskanäle: ${KANAELE#AUS:}" ;;
  *)     rot   "Kanäle NICHT geprueft — ungeprueft gilt als nicht bestanden" ;;
esac

# OPS-2026-08-13-45: Deckt der Alarmfilter alle ausgelieferten Dienste ab? Der
# Filter ist eine Positivliste (service_name=(…)); ein neuer Dienst ist stumm,
# bis ihn jemand von Hand eintraegt. Bewusst ausgespart sind `errors`/`telemetry`
# (Client-Diagnose, sonst Alarm-Spam — docs/ERROR-ALERTING.md), `erinnerung`
# (vom Reaper-Waechter abgedeckt) und `ntfy` (Zustellweg, kein malziME-Dienst).
# Jeder ANDERE Dienst, der weder im Filter noch auf dieser Ausnahmeliste steht,
# ist rot — das erzwingt eine bewusste Entscheidung pro neuem Dienst.
ALARM_AUSNAHMEN="errors telemetry erinnerung ntfy"
# OPS-2026-10-03-11 (Nachlauf): Bis 03.10.2026 galt ein Dienst als abgedeckt,
# sobald sein Name im Filter IRGENDEINER Regel stand. Drei Regeln fuehren eine
# eigene Dienstliste; fehlte ein Dienst in einer davon, blieb die Pruefung gruen.
# Jetzt wird jede Regel mit Dienstliste fuer sich geprueft. Regeln ohne
# Dienstliste (sie zaehlen eine Kennzahl) kommen hier nicht vor.
#
# Nachlauf 04.10.2026: Welche Regeln eine Dienstliste fuehren MUESSEN, steht
# hier beim Namen. Verlor eine davon ihre Liste — etwa weil ihr Filter auf
# einen einzelnen Dienst umgestellt wurde —, fiel sie bis dahin still aus der
# Pruefung: fuer sie erschien weder eine gruene noch eine rote Zeile.
ALARM_REGELN_MIT_DIENSTLISTE='malziME Function Errors
malziME Analyse gescheitert
malziME Kinderschutz-Treffer'
if [ -n "${INFRA_PROBE_DIENSTE:-}" ]; then
  ALLE_DIENSTE=$(cat "$INFRA_PROBE_DIENSTE")
else
  ALLE_DIENSTE=$(gcloud run services list --project="$PROJECT" --region="$REGION" --format="value(metadata.name)" 2>/dev/null || true)
fi
if [ -z "$ALLE_DIENSTE" ]; then
  rot "Alarm-Abdeckung NICHT geprueft (Dienstliste nicht lesbar) — ungeprueft gilt als nicht bestanden"
else
  ABDECKUNG=$(POLICY_JSON="$POLICY_JSON" ALLE_DIENSTE="$ALLE_DIENSTE" ALARM_AUSNAHMEN="$ALARM_AUSNAHMEN" MIT_DIENSTLISTE="$ALARM_REGELN_MIT_DIENSTLISTE" PYTHONIOENCODING=utf-8 python3 -c '
import json, os, re
try:
    regeln = json.loads(os.environ.get("POLICY_JSON", ""))
except Exception:
    print("MESSFEHLER"); raise SystemExit(0)
if not isinstance(regeln, list) or not regeln:
    print("MESSFEHLER"); raise SystemExit(0)
ausnahmen = set(os.environ.get("ALARM_AUSNAHMEN", "").split())
pflicht = [d for d in os.environ.get("ALLE_DIENSTE", "").split() if d not in ausnahmen]
muss_liste = [z.strip() for z in os.environ.get("MIT_DIENSTLISTE", "").split("\n") if z.strip()]
mit_liste = 0
for regel in regeln:
    name = regel.get("displayName", "?")
    hat_liste = False
    for bedingung in regel.get("conditions", []):
        filter_text = (bedingung.get("conditionMatchedLog") or {}).get("filter", "")
        liste = re.search(r"service_name\s*=\s*\(([^)]*)\)", filter_text)
        if not liste:
            continue
        hat_liste = True
        mit_liste += 1
        genannt = set(re.findall(r"\"([a-z0-9-]+)\"", liste.group(1)))
        fehlt = [d for d in pflicht if d not in genannt]
        print(("LUECKE:%s:%s" % (name, " ".join(fehlt))) if fehlt else ("OK:" + name))
    if name in muss_liste and not hat_liste:
        print("LISTE_FEHLT:" + name)
if mit_liste == 0:
    print("KEINE_LISTE")
' 2>/dev/null)
  if [ -z "$ABDECKUNG" ]; then
    rot "Alarm-Abdeckung NICHT geprueft (keine auswertbare Ausgabe) — ungeprueft gilt als nicht bestanden"
  fi
  while IFS= read -r ZEILE; do
    case "$ZEILE" in
      OK:*)        gruen "Alarm-Abdeckung »${ZEILE#OK:}«: jeder Dienst ist im Filter oder benannte Ausnahme" ;;
      LUECKE:*)    REST="${ZEILE#LUECKE:}"; rot "Alarm-Abdeckung »${REST%%:*}«: Dienste ohne Abdeckung und ohne benannte Ausnahme: ${REST#*:} — Filter erweitern oder Ausnahme begruenden" ;;
      LISTE_FEHLT:*) rot "Alarm-Abdeckung »${ZEILE#LISTE_FEHLT:}«: die Regel fuehrt keine Dienstliste mehr (service_name=(…)) — so ist nicht pruefbar, ob sie jeden Dienst abdeckt; Filter der Regel ansehen" ;;
      KEINE_LISTE) rot "Alarm-Abdeckung NICHT geprueft (keine Alarmregel mit Dienstliste gefunden) — ungeprueft gilt als nicht bestanden" ;;
      MESSFEHLER)  rot "Alarm-Abdeckung NICHT geprueft (Alarmregeln nicht lesbar) — ungeprueft gilt als nicht bestanden" ;;
      "")          ;;
      *)           rot "Alarm-Abdeckung NICHT geprueft (unerwartete Ausgabe) — ungeprueft gilt als nicht bestanden" ;;
    esac
  done <<ABDECKUNG_ENDE
$ABDECKUNG
ABDECKUNG_ENDE
fi

# ── 7b. Der selbst betriebene Benachrichtigungsdienst (ntfy) ──
# SEC-2026-10-03-14: Der Dienst ist oeffentlich erreichbar und fremde Software.
# Zwei Dinge duerfen nicht unbemerkt zurueckfallen:
#   · Er laeuft unter einem EIGENEN Konto, nicht unter einem Standard-Konto des
#     Projekts (das darf das Projekt bearbeiten und alle Geheimnisse lesen).
#   · Es laeuft die Fassung, die .github/fremd-dienste/ntfy/VERSION nennt —
#     sonst beobachtet der Nachtlauf die falsche Fassung.
# Einspeisepunkte fuer Tests: INFRA_PROBE_NTFY nennt eine Datei mit der Zeile
# "<Bildname><TAB><Dienstkonto>", wie gcloud sie liefert; INFRA_PROBE_NTFY_SPIEGEL
# eine Datei anstelle der VERSION-Datei.
echo "— Benachrichtigungsdienst (ntfy)"
if [ -n "${INFRA_PROBE_NTFY:-}" ]; then
  NTFY_IST=$(cat "$INFRA_PROBE_NTFY")
else
  NTFY_IST=$(gcloud run services describe ntfy --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].image,spec.template.spec.serviceAccountName)' 2>/dev/null || true)
fi
NTFY_SPIEGEL=$(sed -n '1s/^ntfy \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)[[:space:]]*$/\1/p' \
  "${INFRA_PROBE_NTFY_SPIEGEL:-.github/fremd-dienste/ntfy/VERSION}" 2>/dev/null)
if [ -z "$NTFY_IST" ]; then
  rot "ntfy NICHT geprueft (Dienst nicht lesbar) — ungeprueft gilt als nicht bestanden"
else
  NTFY_BILD=$(printf '%s' "$NTFY_IST" | cut -f1)
  NTFY_KONTO=$(printf '%s' "$NTFY_IST" | cut -f2 -s)
  NTFY_LAEUFT=$(printf '%s' "$NTFY_BILD" | sed -n 's/^.*:v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\(-[a-z]*\)\{0,1\}$/\1/p')
  if [ -z "$NTFY_SPIEGEL" ]; then
    rot "ntfy-Fassung NICHT geprueft (.github/fremd-dienste/ntfy/VERSION nicht lesbar) — ungeprueft gilt als nicht bestanden"
  elif [ -z "$NTFY_LAEUFT" ]; then
    rot "ntfy-Fassung NICHT geprueft (nicht aus dem Bildnamen lesbar: ${NTFY_BILD##*/}) — ungeprueft gilt als nicht bestanden"
  elif [ "$NTFY_LAEUFT" = "$NTFY_SPIEGEL" ]; then
    gruen "ntfy-Fassung: es laeuft $NTFY_LAEUFT, wie im Repository gespiegelt"
  else
    rot "ntfy-Fassung: es laeuft $NTFY_LAEUFT, gespiegelt ist $NTFY_SPIEGEL — .github/fremd-dienste/ntfy/VERSION nachziehen, sonst beobachtet der Nachtlauf die falsche Fassung"
  fi
  case "$NTFY_KONTO" in
    "")
      rot "ntfy-Konto NICHT geprueft (kein Dienstkonto in der Antwort) — ungeprueft gilt als nicht bestanden" ;;
    *-compute@developer.gserviceaccount.com|*@appspot.gserviceaccount.com)
      rot "ntfy laeuft unter einem Standard-Konto des Projekts (darf das Projekt bearbeiten und alle Geheimnisse lesen) — eigenes Konto im Bauweg des Dienstes setzen" ;;
    *)
      gruen "ntfy laeuft unter einem eigenen Konto, nicht unter einem Standard-Konto des Projekts" ;;
  esac
fi

# ── 7c. Kein Schalter fuer lokale Laeufe an einem Dienst ──
# OPS-2026-10-03-09 (Nachlauf 04.10.2026): Das Programm haelt MISTRAL_MOCK,
# QUEUE_LOCAL und NTFY_STUMM von der Produktion fern und erkennt die Produktion
# an K_SERVICE — ausser FUNCTIONS_EMULATOR steht auf "true" (so unterscheidet
# es den Emulator, functions/src/lokale-schalter.js). Stuende diese Variable an
# einem Dienst, wirkten die Schalter dort wieder, und der Startriegel schwiege.
# Deshalb hier, an der Infrastruktur: An keinem Dienst darf einer der vier
# Namen gesetzt sein. Gelesen werden nur die NAMEN der Variablen, nie Werte.
# Einspeisepunkt fuer Tests: INFRA_PROBE_DIENST_UMGEBUNG nennt eine Datei mit
# der Antwort von gcloud (JSON-Liste der Dienste).
echo "— Schalter fuer lokale Laeufe"
LOKAL_NAMEN="MISTRAL_MOCK QUEUE_LOCAL NTFY_STUMM FUNCTIONS_EMULATOR"
if [ -n "${INFRA_PROBE_DIENST_UMGEBUNG:-}" ]; then
  UMGEBUNG_JSON=$(cat "$INFRA_PROBE_DIENST_UMGEBUNG")
else
  UMGEBUNG_JSON=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
    --format='json(metadata.name,spec.template.spec.containers[].env[].name)' 2>/dev/null || true)
fi
LOKAL_LAGE=$(UMGEBUNG_JSON="$UMGEBUNG_JSON" LOKAL_NAMEN="$LOKAL_NAMEN" PYTHONIOENCODING=utf-8 python3 -c '
import json, os
try:
    dienste = json.loads(os.environ.get("UMGEBUNG_JSON", ""))
except Exception:
    print("MESSFEHLER"); raise SystemExit(0)
if not isinstance(dienste, list) or not dienste:
    print("MESSFEHLER"); raise SystemExit(0)
verboten = set(os.environ.get("LOKAL_NAMEN", "").split())
funde = []
for dienst in dienste:
    if not isinstance(dienst, dict) or not (dienst.get("metadata") or {}).get("name"):
        print("MESSFEHLER"); raise SystemExit(0)
    name = dienst["metadata"]["name"]
    behaelter = (((dienst.get("spec") or {}).get("template") or {}).get("spec") or {}).get("containers") or []
    for teil in behaelter:
        for eintrag in (teil or {}).get("env") or []:
            if (eintrag or {}).get("name") in verboten:
                funde.append("%s (%s)" % (name, eintrag["name"]))
print(("GESETZT:" + ", ".join(sorted(funde))) if funde else "OK:%d" % len(dienste))
' 2>/dev/null)
case "$LOKAL_LAGE" in
  OK:*)      gruen "An keinem der ${LOKAL_LAGE#OK:} Dienste steht ein Schalter fuer lokale Laeufe" ;;
  GESETZT:*) rot   "Schalter fuer lokale Laeufe an einem Dienst gesetzt: ${LOKAL_LAGE#GESETZT:} — aus den Einstellungen des Dienstes entfernen (functions/src/lokale-schalter.js)" ;;
  *)         rot   "Schalter fuer lokale Laeufe NICHT geprueft (Dienste nicht lesbar) — ungeprueft gilt als nicht bestanden" ;;
esac

# ── 8. Die zwei Netze unter der Löschzusage: Firestore-TTL + Reaper-Zeitplan ──
# OPS-2026-08-13-33: Beide sind reine Cloud-Konfiguration, die `firebase deploy`
# NICHT verwaltet. Wer sie deaktiviert (oder eine DB neu anlegt), verliert das
# 24-h- bzw. 1-Minuten-Netz ohne jedes Signal — der Code schreibt expiresAt
# weiter, der Unit-Test prueft das Feld, nicht die Regel. Analog zu Bucket-
# Lifecycle/Soft-Delete, die hier laengst geprueft werden.
echo "— Netze (TTL + Reaper-Zeitplan)"
if [ -n "${INFRA_PROBE_TTL:-}" ]; then
  TTL_STATE=$(cat "$INFRA_PROBE_TTL")
else
  TTL_STATE=$(gcloud firestore fields ttls list --database=malzime-eu --project="$PROJECT" \
    --format="value(name,ttlConfig.state)" 2>/dev/null | grep "jobs/fields/expiresAt" | awk '{print $NF}' || true)
fi
case "$TTL_STATE" in
  ACTIVE)  gruen "Firestore-TTL auf jobs/expiresAt: ACTIVE (24-h-Netz)" ;;
  "")      rot   "Firestore-TTL auf jobs/expiresAt NICHT ermittelbar — ungeprueft gilt als nicht bestanden" ;;
  *)       rot   "Firestore-TTL auf jobs/expiresAt ist »$TTL_STATE«, SOLL ACTIVE — das 24-h-Netz fehlt" ;;
esac
if [ -n "${INFRA_PROBE_SCHEDULER:-}" ]; then
  SCHED_STATE=$(cat "$INFRA_PROBE_SCHEDULER")
else
  SCHED_STATE=$(gcloud scheduler jobs describe firebase-schedule-reapJobs-europe-west1 \
    --location="$REGION" --project="$PROJECT" --format="value(state)" 2>/dev/null || true)
fi
case "$SCHED_STATE" in
  ENABLED) gruen "Reaper-Zeitplan »firebase-schedule-reapJobs-europe-west1«: ENABLED" ;;
  "")      rot   "Reaper-Zeitplan NICHT ermittelbar — ungeprueft gilt als nicht bestanden" ;;
  *)       rot   "Reaper-Zeitplan ist »$SCHED_STATE«, SOLL ENABLED — der Reaper laeuft nicht" ;;
esac

# ── 9. Der Riegel unter dem Einstellungssatz: Firestore-Sicherheitsregeln ──
# SEC-2026-08-30-13: Seit dem Umbau vom 30.08.2026 stehen ALLE Betriebswerte in
# `config/betriebsprofil`. Der gesamte Entwurf setzt voraus, dass niemand von
# aussen dort schreiben kann — wer es koennte, koennte Zeitgrenzen, Limits und
# Aufbewahrungsfristen der Anwendung von aussen umstellen.
#
# Diese Voraussetzung war bisher UNGEPRUEFT. Die Regeln stehen zwar im Repo,
# aber `firestore.rules` im Repo ist nicht, was live gilt: Ein Deploy kann
# ausbleiben, und die Konsole erlaubt Aenderungen direkt am Live-Stand.
# Geprueft wird deshalb, was die Regel-Engine WIRKLICH ausliefert.
echo "— Riegel unter dem Einstellungssatz (Firestore-Regeln)"
if [ -n "${INFRA_PROBE_RULES:-}" ]; then
  LIVE_RULES=$(cat "$INFRA_PROBE_RULES")
else
  RULES_TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
  RULESET=$(curl -s "https://firebaserules.googleapis.com/v1/projects/$PROJECT/releases" \
    -H "Authorization: Bearer $RULES_TOKEN" -H "x-goog-user-project: $PROJECT" 2>/dev/null \
    | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for r in d.get('releases', []):
    if r['name'].endswith('/malzime-eu'):
        print(r['rulesetName'].split('/')[-1]); break
" 2>/dev/null || true)
  if [ -n "$RULESET" ]; then
    LIVE_RULES=$(curl -s "https://firebaserules.googleapis.com/v1/projects/$PROJECT/rulesets/$RULESET" \
      -H "Authorization: Bearer $RULES_TOKEN" -H "x-goog-user-project: $PROJECT" 2>/dev/null \
      | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for f in d.get('source', {}).get('files', []):
    print(f.get('content', ''))
" 2>/dev/null || true)
  else
    LIVE_RULES=""
  fi
fi

if [ -z "$LIVE_RULES" ]; then
  rot "Firestore-Regeln NICHT ermittelbar — ungeprueft gilt als nicht bestanden"
elif echo "$LIVE_RULES" | grep -q "allow read, write: if false"; then
  # Zusaetzlich: stimmt der Live-Stand mit dem Repo ueberein? Ein Auseinander-
  # laufen ist kein Sicherheitsproblem, aber es heisst, dass niemand mehr
  # weiss, was gilt.
  if [ "$(echo "$LIVE_RULES" | tr -d "[:space:]")" = "$(tr -d "[:space:]" < firestore.rules)" ]; then
    gruen "Firestore-Regeln: kein Client-Zugriff, live == Repo"
  else
    rot "Firestore-Regeln sperren zwar, weichen aber vom Repo ab — welche gelten?"
  fi
else
  rot "Firestore-Regeln erlauben Client-Zugriff — der Einstellungssatz waere von aussen aenderbar"
fi

# ── 10. Zweigschutz von main: verlangt GitHub noch genau die Pflicht-Pruefungen? ──
# OPS-2026-10-04-18: Welche Pruefungen ein Pull Request bestehen MUSS, steht
# bei GitHub, nicht im Repository. Der Vertrag der Pipeline
# (scripts/pruefe-deploy-riegel.py) haelt ci.yml und deploy.sh zusammen; faellt
# bei GITHUB ein Name von der Liste, laeuft der Job weiter und haelt keinen
# Pull Request mehr auf — und niemand misst es.
#
# Soll ist die Liste PFLICHT aus scripts/deploy.sh (dieselben Namen verlangt
# die Auslieferung), dazu: Der Schutz gilt auch fuer Verwalter. Gelesen wird
# die oeffentliche Angabe zum Zweig — ein lesender Aufruf ohne Verwalterrechte.
# Einspeisepunkt fuer Tests: INFRA_PROBE_ZWEIGSCHUTZ nennt eine Datei mit der
# Antwort ("ebene=<Wert>", dann je Zeile "check=<Name>"). In einem Testlauf
# ueber einen ANDEREN Einspeisepunkt wird GitHub nicht gefragt.
echo "— Zweigschutz von main (GitHub)"
ZWEIG_SOLL=$(sed -n 's/^[[:space:]]*PFLICHT="\([^"]*\)"[[:space:]]*$/\1/p' scripts/deploy.sh 2>/dev/null \
  | head -1 | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort)
if [ -n "${INFRA_PROBE_ZWEIGSCHUTZ:-}" ]; then
  ZWEIG_ANTWORT=$(cat "$INFRA_PROBE_ZWEIGSCHUTZ")
elif [ "$PROBEMODUS" = "1" ]; then
  ZWEIG_ANTWORT=""
else
  ZWEIG_ANTWORT=$(gh api "repos/malziland/malzime/branches/main" \
    --jq '.protection.required_status_checks | "ebene=\(.enforcement_level)", (.contexts[] | "check=\(.)")' 2>/dev/null || true)
fi
ZWEIG_EBENE=$(printf '%s\n' "$ZWEIG_ANTWORT" | sed -n 's/^ebene=//p' | head -1)
ZWEIG_IST=$(printf '%s\n' "$ZWEIG_ANTWORT" | sed -n 's/^check=//p' | LC_ALL=C sort)
einzeilig() { printf '%s' "$1" | tr '\n' ' ' | sed 's/ $//'; }
if [ -z "$ZWEIG_SOLL" ]; then
  rot "Zweigschutz NICHT geprueft (Liste PFLICHT in scripts/deploy.sh nicht lesbar) — ungeprueft gilt als nicht bestanden"
elif [ -z "$ZWEIG_EBENE" ]; then
  rot "Zweigschutz NICHT geprueft (GitHub nicht lesbar: gh fehlt, keine Anmeldung oder keine Antwort) — ungeprueft gilt als nicht bestanden"
else
  ZWEIG_ANZAHL=$(printf '%s\n' "$ZWEIG_SOLL" | wc -l | tr -d ' ')
  if [ "$ZWEIG_IST" = "$ZWEIG_SOLL" ]; then
    gruen "Zweigschutz main verlangt genau die $ZWEIG_ANZAHL Pflicht-Pruefungen der Auslieferung: $(einzeilig "$ZWEIG_IST")"
  else
    ZWEIG_FEHLT=$(printf '%s\n' "$ZWEIG_SOLL" | grep -vxF -e "$ZWEIG_IST" || true)
    ZWEIG_MEHR=$(printf '%s\n' "$ZWEIG_IST" | grep -vxF -e "$ZWEIG_SOLL" || true)
    ZWEIG_BEFUND=""
    [ -n "$ZWEIG_FEHLT" ] && ZWEIG_BEFUND=" — es fehlt: $(einzeilig "$ZWEIG_FEHLT")"
    [ -n "$ZWEIG_MEHR" ] && ZWEIG_BEFUND="$ZWEIG_BEFUND — zusaetzlich verlangt: $(einzeilig "$ZWEIG_MEHR")"
    rot "Zweigschutz main verlangt NICHT genau die $ZWEIG_ANZAHL Pflicht-Pruefungen der Auslieferung${ZWEIG_BEFUND} (Soll: docs/RUNBOOK.md, „Branch Protection“)"
  fi
  pruef "Zweigschutz main gilt auch fuer Verwalter" "everyone" "$ZWEIG_EBENE"
fi

# ── Ergebnis ──
echo ""
echo "Hinweis: Die Zero-Data-Retention-Zusage von Mistral ist VERTRAGLICH und"
echo "hier nicht technisch prüfbar — Nachweisordner + Wiedervorlage, siehe RUNBOOK."
echo "(Der EU-Endpunkt api.eu.mistral.ai ist codeseitig durch config.test.js abgesichert.)"
echo ""
if [ "$FEHLER" = "0" ]; then
  echo "ERGEBNIS: Alle Infrastruktur-Prüfungen grün."
  exit 0
else
  echo "ERGEBNIS: ABWEICHUNG(EN) gefunden — Soll-Zustand siehe docs/RUNBOOK.md." >&2
  exit 1
fi
