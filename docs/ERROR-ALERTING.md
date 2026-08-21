# Fehler-Benachrichtigung bei Cloud-Function-Fehlern

## Was ist das?

Wenn eine Cloud Function einen Fehler loggt (Absturz, Speicherfehler, API-Timeout,
ausgefallene Kostenbremse), geht sofort eine Benachrichtigung raus — statt es
erst Tage später zu merken.

## Wie es funktioniert

```
Function loggt severity>=ERROR
        │
        ▼
Cloud Monitoring  ── log-basierte Alert-Policy "malziME Function Errors"
        │
        ▼
Notification Channel  ── Webhook
        │
        ▼
Benachrichtigung (malziME nutzt ntfy-Push aufs Handy)
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
> zu rendern (`{{.incident.summary}}`, `{{.incident.url}}`). Wichtig: ntfy
> templatet nur `title` und `message` — **nicht** `click`. Tap-Links daher in
> den Nachrichtentext legen.

### 2. Log-basierte Alert-Policy anlegen

Policy-Definition als JSON (`policy.json`):

```json
{
  "displayName": "malziME Function Errors",
  "documentation": {
    "subject": "malziME: Function-Fehler",
    "mimeType": "text/markdown",
    "content": "Eine Cloud Function hat einen Fehler geloggt (severity>=ERROR)."
  },
  "conditions": [{
    "displayName": "ERROR-Log in malziME-Functions",
    "conditionMatchedLog": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=(\"analyze\" OR \"admin\" OR \"stats\" OR \"enqueue\" OR \"processjob\" OR \"jobstatus\" OR \"reapjobs\") AND severity>=ERROR"
    }
  }],
  "combiner": "OR",
  "alertStrategy": {
    "notificationRateLimit": { "period": "300s" },
    "autoClose": "1800s"
  },
  "notificationChannels": ["<CHANNEL-RESOURCE-NAME>"],
  "enabled": true
}
```

```bash
gcloud alpha monitoring policies create \
  --policy-from-file=policy.json --project=<PROJECT>
```

Der `notificationRateLimit` (300s) verhindert Push-Spam bei einem Fehler-Sturm.

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
  --project=malzime --freshness=2h \
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

## Was passiert dann?

- Loggt eine Function einen Fehler, kommt eine Benachrichtigung — bei malziME
  per E-Mail (nachweislich zugestellt) und zusätzlich als ntfy-Push mit
  ⚠️-Symbol, Fehlertext und Link zur Cloud Console.
- Handled per-Request-Fehler (HTTP 4xx/5xx an den Client, nur `console.log`)
  lösen **nicht** aus — nur echte `severity>=ERROR`-Logs (Abstürze, OOM,
  Timeouts, eskalierte Fehler wie `counter-fail-open`).

## Datenschutz

- Kein externer Dienst nötig — Cloud Monitoring ist Teil der bestehenden Infrastruktur.
- Keine Nutzerdaten in der Benachrichtigung (kein Foto, kein Profil, keine IP).

## Hinweis für das produktive malziME-Setup

Die konkreten Config-Dateien (mit der ntfy-Server-URL) liegen **außerhalb dieses
Repos** — es ist eine private Betriebs-Funktion. Dieses Dokument beschreibt nur
das allgemeine Muster, das auch Self-Hoster nachbauen können.
