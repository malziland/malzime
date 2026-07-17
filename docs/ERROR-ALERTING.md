# Fehler-Benachrichtigung bei Cloud-Function-Fehlern

## Was ist das?

Wenn eine Cloud Function einen Fehler loggt (Absturz, Speicherfehler, API-Timeout,
ausgefallene Kostenbremse), wird der Betreiber sofort benachrichtigt — statt es
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

Der Filter wurde am 2026-07-17 (LANGAUDIT OPS-001) um die Queue-Functions
`enqueue`, `processjob`, `jobstatus` und `reapjobs` erweitert — der Live-Analysepfad
war seit der Queue-Umstellung (v2.0) ohne Alarm. Die Functions `errors` und
`telemetry` sind **bewusst ausgespart**: `handle-errors.js` loggt jeden
Client-Fehlerbericht mit severity ERROR — im Filter wäre das Alarm-Spam.
Client-Fehler erreichen den Betreiber stattdessen über den Log-Bucket
`client-diagnostics` (30 Tage Aufbewahrung), nicht über ntfy.

## Was passiert dann?

- Loggt eine Function einen Fehler, kommt eine Benachrichtigung — bei malziME
  als Push mit ⚠️-Symbol, Fehlertext und Link zur Cloud Console.
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
