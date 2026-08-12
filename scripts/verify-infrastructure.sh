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
# Es verändert NICHTS: nur describe/list/get-iam-policy. Der Test
# functions/src/__tests__/verify-infrastructure-script.test.js erzwingt das
# (jede gcloud-/gsutil-Zeile muss ein Lese-Kommando sein).
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
if ! command -v gcloud >/dev/null 2>&1; then
  echo "FEHLER: gcloud nicht gefunden — Prüfung nicht möglich." >&2
  exit 2
fi
KONTO=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
if [ -z "$KONTO" ]; then
  echo "FEHLER: Keine aktive gcloud-Anmeldung. Bitte im Terminal 'gcloud auth login' ausführen." >&2
  exit 2
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
  pruef "Concurrency (RUNBOOK: 7 seit v2.8)" "7" "$QUEUE_CONC"
  pruef "Queue-Status" "RUNNING" "$QUEUE_STATE"
fi

# ── 2. Upload-Bucket: EU-Region, Lifecycle-Sicherheitsnetz, Soft-Delete aus ──
echo "— Upload-Bucket ($BUCKET)"
BUCKET_JSON=$(gcloud storage buckets describe "$BUCKET" --format=json 2>/dev/null || true)
if [ -z "$BUCKET_JSON" ]; then
  rot "Bucket nicht lesbar/nicht gefunden"
else
  printf "%s" "$BUCKET_JSON" | python3 -c '
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
' | sed -e "s/^  OK /  \x1b[32m✓\x1b[0m /" -e "s/^  FEHLT /  \x1b[31m✗\x1b[0m /"
  # Python-Exitcode steckt wegen der sed-Pipe in PIPESTATUS[0]
  if [ "${PIPESTATUS[0]}" != "0" ]; then FEHLER=1; fi
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
echo "— Functions-Regionen"
AUSSERHALB=$(gcloud functions list --project="$PROJECT" --format=json 2>/dev/null \
  | python3 -c '
import json, sys
for f in json.load(sys.stdin):
    teile = f["name"].split("/")           # projects/P/locations/REGION/functions/NAME
    if teile[3] != "europe-west1":
        print(teile[3] + ":" + teile[5])
' || true)
if [ -z "$AUSSERHALB" ]; then
  gruen "alle Functions in $REGION"
else
  rot "Functions außerhalb $REGION: $AUSSERHALB"
fi

# ── 6. Logging: Routine-Ausschlüsse + Diagnose-Sink ──
echo "— Logging"
EXCL=$(gcloud logging sinks describe _Default --project="$PROJECT" --format=json 2>/dev/null \
  | python3 -c 'import json,sys; print(" ".join(e["name"] for e in json.load(sys.stdin).get("exclusions",[])))' || true)
case " $EXCL " in
  *" exclude_run_request_routine "*) gruen "_Default: Routine-Request-Ausschluss aktiv" ;;
  *) rot "_Default: Ausschluss »exclude_run_request_routine« fehlt (IST: ${EXCL:-<keine>})" ;;
esac
SINKS=$(gcloud logging sinks list --project="$PROJECT" --format="value(name)" 2>/dev/null || true)
case " $(printf "%s" "$SINKS" | tr '\n' ' ') " in
  *" client-diagnostics-sink "*) gruen "Diagnose-Sink »client-diagnostics-sink« vorhanden" ;;
  *) rot "Diagnose-Sink »client-diagnostics-sink« fehlt" ;;
esac

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
