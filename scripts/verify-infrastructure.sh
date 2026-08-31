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
# OPS-2026-08-13-41: Läuft mindestens ein Abschnitt über einen Einspeisepunkt
# (INFRA_PROBE_*), ist das ein Test-/Negativprobenlauf — dann keine gcloud-
# Anmeldung verlangen, sonst bräche das Skript vor dem geprüften Abschnitt ab
# (und der Riegel liesse sich, wie vier Wochen lang, gar nicht testen).
PROBEMODUS=0
if [ -n "${INFRA_PROBE_BUCKET:-}${INFRA_PROBE_TTL:-}${INFRA_PROBE_SCHEDULER:-}" ]; then
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
BILDER_ROH=$(gsutil ls -l "$BUCKET/queue-uploads/" 2>/tmp/malzime-gsutil-fehler.log)
GSUTIL_CODE=$?
if [ "$GSUTIL_CODE" -ne 0 ]; then
  rot "Bildspeicher nicht lesbar (gsutil Code $GSUTIL_CODE) — ungeprueft gilt als nicht bestanden"
  sed 's/^/        /' /tmp/malzime-gsutil-fehler.log | head -3
  ALTE_BILDER="nicht-messbar"
else
  ALTE_BILDER=$(printf '%s\n' "$BILDER_ROH" \
    | grep -E "^ +[0-9]+" \
    | awk -v grenze="$(date -u -v-3H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
          '$2 < grenze {n++} END {print n+0}')
fi
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

# ── 6. Logging: Routine-Ausschlüsse + Diagnose-Sink ──
echo "— Logging"
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

# OPS-2026-08-13-45: Deckt der Alarmfilter alle ausgelieferten Dienste ab? Der
# Filter ist eine Positivliste (service_name=(…)); ein neuer Dienst ist stumm,
# bis ihn jemand von Hand eintraegt. Bewusst ausgespart sind `errors`/`telemetry`
# (Client-Diagnose, sonst Alarm-Spam — docs/ERROR-ALERTING.md), `erinnerung`
# (vom Reaper-Waechter abgedeckt) und `ntfy` (Zustellweg, kein malziME-Dienst).
# Jeder ANDERE Dienst, der weder im Filter noch auf dieser Ausnahmeliste steht,
# ist rot — das erzwingt eine bewusste Entscheidung pro neuem Dienst.
ALARM_AUSNAHMEN="errors telemetry erinnerung ntfy"
if [ -n "${INFRA_PROBE_POLICY:-}" ]; then
  FILTER_DIENSTE=$(cat "$INFRA_PROBE_POLICY")
else
  FILTER_DIENSTE=$(printf '%s' "${POLICY_JSON:-}" | python3 -c '
import json, re, sys
try:
    daten = json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit(0)
namen = set()
for p in (daten if isinstance(daten, list) else []):
    for c in p.get("conditions", []):
        f = (c.get("conditionMatchedLog") or {}).get("filter", "")
        namen.update(re.findall(r"\"([a-z0-9-]+)\"", f))
print(" ".join(sorted(namen)))
' 2>/dev/null)
fi
if [ -n "${INFRA_PROBE_DIENSTE:-}" ]; then
  ALLE_DIENSTE=$(cat "$INFRA_PROBE_DIENSTE")
else
  ALLE_DIENSTE=$(gcloud run services list --project="$PROJECT" --region="$REGION" --format="value(metadata.name)" 2>/dev/null || true)
fi
if [ -z "$ALLE_DIENSTE" ]; then
  rot "Alarm-Abdeckung NICHT geprueft (Dienstliste nicht lesbar) — ungeprueft gilt als nicht bestanden"
else
  UNGEDECKT=""
  for D in $ALLE_DIENSTE; do
    case " $FILTER_DIENSTE " in *" $D "*) continue ;; esac
    case " $ALARM_AUSNAHMEN " in *" $D "*) continue ;; esac
    UNGEDECKT="$UNGEDECKT $D"
  done
  if [ -n "$UNGEDECKT" ]; then
    rot "Dienste ohne Alarm-Abdeckung und ohne benannte Ausnahme:$UNGEDECKT — Filter erweitern oder Ausnahme begruenden"
  else
    gruen "Alarm-Abdeckung: jeder Dienst ist im Filter oder benannte Ausnahme"
  fi
fi

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
