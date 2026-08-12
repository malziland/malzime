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
POLICY_JSON=$(gcloud alpha monitoring policies list --project="$PROJECT" --format=json 2>&1) || POLICY_JSON=""
ALARM=$(printf '%s' "$POLICY_JSON" | python3 -c '
import json, sys
try:
    daten = json.load(sys.stdin)
except Exception:
    print("MESSFEHLER:Antwort nicht lesbar"); raise SystemExit(0)
if not isinstance(daten, list) or not daten:
    print("MESSFEHLER:keine Richtlinie in der Antwort"); raise SystemExit(0)
for pol in daten:
    filter_text = " ".join(
        (b.get("conditionMatchedLog") or {}).get("filter", "") for b in pol.get("conditions", [])
    )
    if "severity>=ERROR" not in filter_text.replace(" ", ""):
        continue
    if not pol.get("enabled", False):
        print("AUS:" + pol.get("displayName", "?")); raise SystemExit(0)
    kanaele = pol.get("notificationChannels", [])
    if not kanaele:
        print("OHNE_KANAL:" + pol.get("displayName", "?")); raise SystemExit(0)
    print("OK:%s:%d" % (pol.get("displayName", "?"), len(kanaele))); raise SystemExit(0)
print("FEHLT:keine Richtlinie mit severity>=ERROR")
' 2>/dev/null)

case "$ALARM" in
  OK:*)         gruen "Fehler-Alarm scharf: »$(printf '%s' "${ALARM#OK:}" | cut -d: -f1)«, $(printf '%s' "$ALARM" | rev | cut -d: -f1 | rev) Kanal/Kanäle" ;;
  AUS:*)        rot   "Fehler-Alarm ist DEAKTIVIERT: ${ALARM#AUS:}" ;;
  OHNE_KANAL:*) rot   "Fehler-Alarm hat KEINEN Benachrichtigungskanal: ${ALARM#OHNE_KANAL:}" ;;
  FEHLT:*)      rot   "Kein Fehler-Alarm gefunden — eine Stoerung wuerde niemanden erreichen" ;;
  MESSFEHLER:*) rot   "Alarmweg NICHT geprueft (${ALARM#MESSFEHLER:}) — ungeprueft gilt als nicht bestanden" ;;
  *)            rot   "Alarmweg NICHT geprueft (keine auswertbare Ausgabe)" ;;
esac

# Und die Kanäle selbst: ein Kanal kann verwaist oder abgeschaltet sein.
KANAL_JSON=$(gcloud alpha monitoring channels list --project="$PROJECT" --format=json 2>&1) || KANAL_JSON=""
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
