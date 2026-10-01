# Fehler-Benachrichtigung bei Cloud-Function-Fehlern

## Was ist das?

Wenn eine Cloud Function einen Fehler loggt (Absturz, Speicherfehler, API-Timeout,
ausgefallene Kostenbremse), geht sofort eine Benachrichtigung raus — statt es
erst Tage später zu merken.

## Wie es funktioniert

```
Function loggt eine Fehlerzeile
        │
        ▼
Cloud Monitoring  ── drei log-basierte Richtlinien, je nach Art der Zeile:
        │             „Kinderschutz-Treffer“, „Analyse gescheitert (KI-Dienst)“,
        │             „Function Errors“ (alles andere) — jede mit eigenem Betreff
        ▼
Notification Channels  ── Webhook (ntfy-Push) und E-Mail
        │
        ▼
Benachrichtigung: Betreff der E-Mail = Titel des Pushs = Art des Fehlers
```

Bewusst **log-basiert**, nicht metrik-basiert: Die Functions laufen als 2nd-Gen
(Cloud Run) — ihre Logs liegen zuverlässig unter `resource.type="cloud_run_revision"`.
Ein log-basierter Alert auf `severity>=ERROR` ist dafür robuster als die alte
metrik-basierte Variante.

## Einrichtung (einmalig, per gcloud)

### 1. Notification Channel anlegen

Cloud Monitoring kennt nur `webhook_basicauth` und `webhook_tokenauth` — beides
erfordert formal eine Auth-Angabe. `webhook_tokenauth` ist die einfachere Wahl,
wenn das Ziel (z.B. ein ntfy-Server) keinen Auth braucht — der Token wird dann
ignoriert.

Channel-Definition als JSON (`channel.json`):

```json
{
  "type": "webhook_tokenauth",
  "displayName": "<Anzeigename>",
  "labels": { "url": "<Webhook-URL>" }
}
```

```bash
gcloud alpha monitoring channels create \
  --channel-content-from-file=channel.json --project=<PROJECT>
```

> malziME pusht an einen eigenen ntfy-Server. Die URL nutzt ntfy-Templating
> (`?template=1`), um `title`/`message` aus dem Cloud-Monitoring-Incident-JSON
> zu rendern: Titel `⚠️ {{.incident.documentation.subject}}` (der Betreff des
> jeweiligen Alarms, seit 01.10.2026), Text `{{.incident.summary}}` und
> `{{.incident.url}}`. Wichtig: ntfy templatet nur `title` und `message` —
> **nicht** `click`. Tap-Links daher in den Nachrichtentext legen.

### 2. Log-basierte Richtlinien anlegen (drei, seit 01.10.2026)

Jede Art Fehlerzeile bekommt eine eigene Richtlinie mit eigenem Betreff — der
Betreff steht in der E-Mail und als Titel im Push, also sieht man schon auf dem
Sperrbildschirm, was los ist. Alle drei haben dieselben Dienste im Filter und
dieselben Kanäle; zusammen decken sie genau das ab, was vorher eine einzige
Richtlinie mit `severity>=ERROR` abdeckte, ohne Überschneidung.

| Richtlinie | Betreff | Filter (nach dem gemeinsamen Teil) |
|---|---|---|
| `malziME Kinderschutz-Treffer` | „malziME: Kinderschutz-Treffer (Analyse lief normal)“ | `jsonPayload.step="minor-safety-durchbruch"` |
| `malziME Analyse gescheitert (KI-Dienst)` | „malziME: Analyse gescheitert – ein Kind sah eine Fehlermeldung (Details im Text)“ | `severity>=ERROR AND jsonPayload.alert=("single-large-failed" OR "foto-laden-gescheitert")` |
| `malziME Function Errors` | „malziME: Fehler im Server (Details im Text)“ | `severity>=ERROR AND NOT jsonPayload.step="minor-safety-durchbruch" AND NOT jsonPayload.alert=("single-large-failed" OR "foto-laden-gescheitert")` |

Dazu kommt eine Schwellen-Richtlinie (wie die für Browser-Fehler unten):
`malziME KI-Verbindung bricht gehäuft ab` — Betreff „malziME: KI-Verbindung bricht
gehäuft ab (mehr als 3 Neuversuche an einem Tag)“, zählt die log-basierte Metrik
`ki_verbindungsabriss` (Filter: Dienst `processjob`,
`jsonPayload.status="abbruch-neuversuch"`) über 24 Stunden. Sie meldet gehäufte
Abrisse auch dann, wenn jeder Neuversuch gelang.

Gemeinsamer Teil jedes Filters:
`resource.type="cloud_run_revision" AND resource.labels.service_name=("admin" OR "stats" OR "enqueue" OR "processjob" OR "jobstatus" OR "reapjobs" OR "laufzeitwache" OR "satzwache")`.
Die Kinderschutz-Zeile schreibt `console.error` ohne eigenes Schwere-Feld; sie kommt
als ERROR an, ihr Filter braucht die Schwere deshalb nicht.

Muster einer Richtlinie (`policy.json`, Platzhalter in spitzen Klammern):

```json
{
  "displayName": "<Name aus der Tabelle>",
  "documentation": {
    "subject": "<Betreff aus der Tabelle>",
    "mimeType": "text/markdown",
    "content": "<Klartext: was die Nachricht bedeutet, wo im RUNBOOK nachsehen>"
  },
  "conditions": [{
    "displayName": "<kurzer Name>",
    "conditionMatchedLog": { "filter": "<gemeinsamer Teil> AND <Filter aus der Tabelle>" }
  }],
  "combiner": "OR",
  "alertStrategy": { "notificationRateLimit": { "period": "300s" }, "autoClose": "1800s" },
  "notificationChannels": ["<CHANNEL-RESOURCE-NAME>", "<…>"],
  "enabled": true
}
```

```bash
gcloud alpha monitoring policies create --policy-from-file=policy.json --project=<PROJECT>
```

Der `notificationRateLimit` (300s) verhindert Push-Spam bei einem Fehler-Sturm.
Betreff und Text ändert man über die Monitoring-Schnittstelle
(`PATCH …/alertPolicies/<ID>?updateMask=documentation`), weil
`gcloud alpha monitoring policies update` den Betreff nicht setzen kann. Den
Ist-Stand zeigt jederzeit `gcloud alpha monitoring policies list --project=malzime`.

**Vorgeschichte.** Bis 01.10.2026 lief jede Fehlerzeile über die eine Richtlinie
„malziME Function Errors“. Ihr Betreff nannte seit 16.09.2026 „Fehlerzeile oder
Kinderschutz-Treffer“, weil ein Kinderschutz-Treffer wie ein Systemausfall
ausgesehen hatte — und passte damit am 01.10.2026 nicht zu zwei gescheiterten
Analysen. Geprüft wurde die Aufteilung an den echten Protokollen des 01.10.: Der
KI-Filter traf genau die zwei gescheiterten Analysen von 11:01 und 11:03, der
Rest-Filter keine davon; eine Probezeile löste die Richtlinie „Analyse gescheitert
(KI-Dienst)“ aus. Der Kinderschutz-Filter hatte an diesem Tag keine echte Zeile,
an der er sich hätte beweisen können — er ist an der Code-Stelle belegt
(`job-helfer.js`, einzige Quelle des Schritts).

## Zweite Richtlinie: Haeufung von Client-Fehlern (seit 2026-08-21)

**Name:** `malziME Client-Fehler-Haeufung` · **Schwelle:** mehr als **20** Berichte
je Stunde · **Kanaele:** ntfy-Push und E-Mail · **Metrik:**
`logging.googleapis.com/user/client_fehler_rate`

**Warum es sie gibt.** Die Richtlinie darunter alarmiert nur SERVER-Fehler. Was im
Browser der Besucher schiefgeht — Layout, Speicher, Safari-Eigenheiten — war
bewusst stumm (siehe unten: jeder einzelne Bericht waere ein Alarm gewesen). Genau
diese Fehlerklasse hat aber am 2026-08-21 gleich dreimal zugeschlagen, und zur
Presse-Aussendung schauen Fremde auf die Seite.

**Warum eine Schwelle und nicht der alte Filter.** Gemessen am 2026-08-21:
**fuenf** Berichte in sieben Tagen. Eine Schwelle von 20 je Stunde feuert im
Normalbetrieb nie, faengt aber einen Einbruch. Die Spam-Gefahr von damals kommt
damit nicht zurueck.

**Wenn der Alarm kommt:** nachsehen, welche Phase sich haeuft.

```bash
gcloud logging read 'resource.labels.service_name="errors"' \
  --project=malzime --bucket=client-diagnostics --location=europe-west1 --view=_AllLogs --freshness=2h \
  --format='value(jsonPayload.phase,jsonPayload.errorDetail)'
```

Haeufen sich Meldungen EINER Phase, ist dort etwas kaputt. Gleichverteiltes
Rauschen bei hoher Last ist dagegen normal — dann ist die Schwelle zu niedrig
und darf steigen.

---

Der Filter wurde am 2026-07-17 (LANGAUDIT OPS-001) um die Queue-Functions
`enqueue`, `processjob`, `jobstatus` und `reapjobs` erweitert — der Live-Analysepfad
war seit der Queue-Umstellung (v2.0) ohne Alarm. Die Functions `errors` und
`telemetry` sind **bewusst ausgespart**: `handle-errors.js` loggt jeden
Client-Fehlerbericht mit severity ERROR — im Filter wäre das Alarm-Spam.
Client-Fehler landen stattdessen im Log-Bucket
`client-diagnostics` (30 Tage Aufbewahrung), nicht bei ntfy.

## Zweiter Kanal: E-Mail (seit 2026-08-10)

Die Richtlinie schickt an **zwei** Kanäle. Grund: Am 2026-08-10 war nicht
belegbar, dass der ntfy-Push auf dem Sperrbildschirm ankommt — die Meldung war
in der App sichtbar, aber nur nach aktivem Öffnen.

> **Ursache gefunden am 2026-08-12 — sie lag doch am Server.** Die frühere
> Vermutung („liegt an der App bzw. den iOS-Einstellungen, am Server nicht
> reparierbar") war falsch. Im ntfy-Protokoll stand:
> `WARN Unable to publish poll request (… context deadline exceeded)`.
>
> Hintergrund: Ein selbst betriebener ntfy-Server kann iPhones nicht direkt
> erreichen — nur ntfy.sh besitzt den Apple-Push-Schlüssel. Deshalb reicht der
> eigene Server nach jeder Nachricht eine **Anstoß-Meldung** an ntfy.sh weiter
> (`upstream-base-url`), und erst die löst den Push aus. Diese Weiterleitung
> passiert **nach** der HTTP-Antwort an den Absender — und genau dann entzieht
> Cloud Run dem Container standardmäßig die CPU („CPU nur während der
> Anfrage"). Die Weiterleitung verhungerte und lief nach 10 s in die
> Zeitüberschreitung. Ergebnis: Nachricht liegt auf dem Server, aber kein Push
> aufs iPhone — exakt das beobachtete Verhalten.
>
> **Behebung:** `gcloud run services update ntfy --no-cpu-throttling
> --memory=512Mi` (CPU dauerhaft zugeteilt; Cloud Run verlangt dafür
> mindestens 512 MiB). Danach verschwand die Warnung. **Lehre: Hintergrund-
> Arbeit nach der Antwort braucht auf Cloud Run dauerhaft zugeteilte CPU —
> sonst scheitert sie lautlos, und die Fehlersuche landet fälschlich beim
> Endgerät.**

Statt weiter daran zu schrauben, kam ein davon unabhängiger Weg dazu:

```bash
gcloud alpha monitoring channels create \
  --display-name="malziME Stoerungsmeldung (E-Mail)" \
  --type=email \
  --channel-labels=email_address=<ADRESSE> \
  --project=<PROJECT>

gcloud alpha monitoring policies update <POLICY-ID> \
  --add-notification-channels=<CHANNEL-RESOURCE-NAME> --project=<PROJECT>
```

**Zustellung nachgewiesen** — nicht angenommen. Prüfung ohne echten Störfall:
eine synthetische Logzeile schreiben, die exakt auf den Filter passt.

```bash
gcloud logging write malzime-alarmtest \
  "TESTMELDUNG (kein echter Fehler): …" \
  --severity=ERROR \
  --monitored-resource-type=cloud_run_revision \
  --monitored-resource-labels=service_name=stats,location=europe-west1,revision_name=alarmtest,configuration_name=stats,project_id=malzime \
  --project=malzime
```

Der Alarm feuert binnen ein bis zwei Minuten und schliesst sich nach 30 Minuten
selbst (`autoClose: 1800s`). Am 2026-08-10 so verifiziert: E-Mail kam an.

> **Lehre daraus:** Ein eingerichteter Benachrichtigungsweg ist kein
> zugestellter Benachrichtigungsweg. Nach jeder Änderung an Kanälen oder
> Richtlinie diesen Test fahren — er kostet nichts und ist der einzige Beleg.

**Stand der Live-Richtlinie (nachgesehen 2026-08-12):** Der Filter deckt
`admin`, `stats`, `enqueue`, `processjob`, `jobstatus`, `reapjobs` ab. Der
frühere Eintrag `analyze` (Dienst seit v2.10 abgebaut) ist inzwischen
entfernt — das oben abgedruckte Policy-Beispiel nennt ihn noch, es ist die
Aufbau-Vorlage, nicht der Ist-Zustand.

**Zustellung beider Kanäle belegt (2026-08-12):** Zwei Proben nach dem
`gcloud logging write`-Rezept oben — die erste kam als **E-Mail** an, die
zweite (nach der Aktualisierung des ntfy-Servers auf v2.27.0) als **Push in
der ntfy-App**. Damit ist jeder der beiden Wege einzeln nachgewiesen, nicht
nur eingerichtet.

## Dritter Kanal: Nachtlauf „Sicherheit nachts" (seit 2026-09-30)

Nicht aus Google Cloud, sondern aus GitHub: Der Workflow
`.github/workflows/sicherheit-nachts.yml` prüft täglich um 03:43 UTC auf neue
Sicherheitslücken (npm-Pakete, Herstellermeldungen zu `public/lib`) und auf
Abkündigungshinweise von GitHub. Ist auf `main` einer seiner Prüf-Jobs rot oder
abgebrochen, schickt der Job `alarm` einen **ntfy-Push mit Stufe „urgent" (5)** an
denselben ntfy-Server und dasselbe Thema wie die übrigen Alarme.

- **Warum Stufe 5:** Niedrigere Stufen landen je nach Handy-Einstellung still in der
  App. Stufe 5 erscheint als sichtbare Meldung. Zustellung eines Probealarms mit
  Stufe 5 am 30.09.2026 vom Empfänger bestätigt (von Hand gesendet, derselbe Server
  und dasselbe Thema).
- **Warum nicht nur die GitHub-Mail:** GitHub-Benachrichtigungen werden beim
  Empfänger automatisch gelöscht; eine Warnung per Mail käme also nie an.
- **Monatliche Probe:** Am 1. jedes Monats (08:07 UTC) kommt „malziME PROBE:
  Sicherheit nachts", auch wenn alles grün ist. **Bleibt sie aus, ist der Alarmweg
  gestört** — dann sofort nachsehen (Lauf unter „Actions", Secrets, ntfy-Server).
  Ohne diese Probe fiele ein kaputter Alarmweg erst auf, wenn ein echter Alarm nicht
  ankommt: Der Job `alarm` kann seinen eigenen Fehlschlag nicht melden, und die
  Mail von GitHub wird gelöscht.
- **Zugangsdaten an zwei Stellen:** GitHub-Secrets `NTFY_URL_EU` und
  `NTFY_TOPIC_EU` (gesetzt am 30.09.2026 aus den gleichnamigen Werten im Secret
  Manager von `malzime`). **Wer ntfy-Server oder -Thema im Secret Manager ändert,
  muss beide GitHub-Secrets im selben Schritt nachziehen**
  (`gh secret set NTFY_URL_EU -R malziland/malzime`, ebenso `NTFY_TOPIC_EU`) —
  sonst geht der Alarm mit „angenommen" an ein altes Thema. Die monatliche Probe
  zeigt das spätestens am nächsten Monatsersten.
- **Was „200" belegt:** nur, dass der ntfy-Server die Nachricht angenommen hat,
  nicht, dass sie auf dem Handy ankam. Die Zustellung belegt nur die sichtbare
  Probe.
- **Probe von Hand:** `gh workflow run sicherheit-nachts.yml -f alarmprobe=true`
  (erst möglich, wenn der Workflow auf `main` liegt).
- **Nur `main` und nur dieses Repository:** Läufe auf Arbeitszweigen und in Kopien
  (Forks) alarmieren nicht.

Was bei einem roten Nachtlauf zu tun ist: `docs/RUNBOOK.md`, Abschnitt
„Nachtlauf Sicherheit nachts rot".

## Was passiert dann?

- Loggt eine Function einen Fehler, kommt eine Benachrichtigung — bei malziME
  per E-Mail und als ntfy-Push. Betreff der E-Mail und Titel des Pushs nennen
  die Art (Kinderschutz-Treffer, gescheiterte Analyse, sonstiger Fehler); der
  Push-Text enthält Googles Zusammenfassung und den Link zur Cloud Console.
- Handled per-Request-Fehler (HTTP 4xx/5xx an den Client, nur `console.log`)
  lösen **nicht** aus. Die drei log-basierten Richtlinien reagieren auf
  `severity>=ERROR` (Abstürze, OOM, Timeouts, eskalierte Fehler wie
  `counter-fail-open`, gescheiterte Analysen, Kinderschutz-Treffer) der
  Server-Dienste. Die zwei Schwellen-Richtlinien zählen Zeilen außerhalb davon:
  die Fehlermeldungen aus Browsern (Dienst `errors`, nicht in der Dienstliste
  der drei Filter) und die Warnungen `abbruch-neuversuch`.

## Datenschutz

- Kein externer Dienst nötig — Cloud Monitoring ist Teil der bestehenden Infrastruktur.
- Keine Nutzerdaten in der Benachrichtigung (kein Foto, kein Profil, keine IP).

## Hinweis für das produktive malziME-Setup

Die konkreten Config-Dateien (mit der ntfy-Server-URL) liegen **außerhalb dieses
Repos** — es ist eine private Betriebs-Funktion. Dieses Dokument beschreibt nur
das allgemeine Muster, das auch Self-Hoster nachbauen können.
