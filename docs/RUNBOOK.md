# Runbook — Betrieb, Deploy, Rollback

Dieses Dokument ist das Betriebs-Handbuch von malziME: Wie wird deployt, wie wird
zurückgerollt, was tun bei Störungen. Zielgruppe: der Betreiber und unterstützende
KI-Assistenten. Die Architektur selbst beschreibt [ARCHITECTURE.md](ARCHITECTURE.md),
das Alerting-Setup [ERROR-ALERTING.md](ERROR-ALERTING.md), die Feature-Flags
[FLAGS.md](FLAGS.md).

## Normalbetrieb (Soll-Zustand)

- **Aktiver Pfad:** Upload → Cloud-Tasks-Queue → Single-Large-Call
  (`featureFlags/current`: `useSingleLargeCall = true`),
  Cloud-Tasks-Concurrency **7** (seit v2.8 — zwei Mistral-Aufrufe je Analyse).
- **Limits:** Stundenlimit 500 Analysen (rollendes Fenster), IP-Rate-Limit
  500 Requests / 10 min pro Instanz.
- **Lastprofil:** Workshops sind Stoßlast (Mo–Fr vormittags); genau dafür ist die
  Queue da. Mistral-Latenz schwankt mit Tageszeit/Wochentag — Messungen immer im
  repräsentativen Zeitfenster bewerten.

## Deploy

**Grundregel: Kein Deploy ohne ausdrückliche Freigabe.** Mit Freigabe
läuft der Ablauf vollständig durch (dokumentiert in ADR-0001).

1. Tests, Lint und Format müssen grün sein:
   `cd functions && npm test && npm run lint && npm run format:check` sowie
   `npm run test:frontend && npm run lint:frontend && npm run format:frontend:check`
   (E2E: `npm run test:e2e`).
2. Änderung per Branch + PR auf `main`; die CI-Pflicht-Checks (test-backend,
   test-frontend, test-e2e, secret-scan) sind Merge-Voraussetzung.
3. CHANGELOG: Sobald deployt wird, ist das ein Release — den
   `[Unveröffentlicht]`-Abschnitt im selben Schritt auf neue Versionsnummer und
   Datum stempeln.
4. Deploy über `./scripts/deploy.sh [hosting|functions]` — das Script führt
   zuerst Lint + Unit-Tests aus (Test-Guard; nur im Notfall mit `SKIP_TESTS=1`
   überspringbar, mit Warnhinweis) und zählt dann den Cache-Buster in allen
   fünf HTML-Seiten automatisch hoch (Konvention `?v=YYYYMMDDNN`: gleicher Tag
   → laufende Nummer +1, sonst neuer Tag mit `01`; nur bei Hosting-Deploys
   relevant, reine Functions-Deploys brauchen keinen).
5. `release.yml` legt automatisch einen GitHub-Release an, sobald die neue
   CHANGELOG-Version auf `main` landet (idempotent).

## Rollback-Hebel

Vom schnellsten zum gründlichsten. Alle Flag-Hebel wirken **ohne Deploy** binnen
~30 Sekunden (Cache-TTL der Flags).

### 1. Wartungsmodus (Sekunden — kontrollierte Vollbremsung)

Admin-Endpunkt `/api/admin/maintenance` (HMAC-Token nötig; GET zeigt
Bestätigungsseite, POST mit Nonce schaltet). Zustand liegt im Firestore-Dokument
`config/maintenance` (30-s-Cache). Nutzer sehen einen Wartungs-Dialog statt der
Analyse.

### 2. ENTFALLEN mit v2.10 — es gibt keinen zweiten Weg mehr

Bis v2.9 stand hier: „Queue aus → synchroner Pfad". Der synchrone `/analyze`-Pfad
ist mit v2.10 entfernt.

**Warum kein Ersatz nötig ist:** Der Hebel half gegen die meisten Störungen
ohnehin nicht — Mistral langsam oder überlastet, Budget-Stopp, Stundenlimit,
Firestore-Störung, Fehler im gemeinsamen Code treffen beide Wege gleich. Nur ein
reines Cloud-Tasks-Problem wäre der Fall gewesen, für den er gebaut wurde. Und
bei Stoßlast wäre der Rückfall selbst das Problem geworden: Die Warteschlange
existiert genau wegen der Fünfundzwanzig-gleichzeitig-Situation, in der lange
offene Verbindungen wegbrechen und der Bildschirm-Wachhalter auf iPhones nicht
greift.

**Was stattdessen greift:** Hebel 1 (Wartungsmodus). Er sagt der Klasse
ehrlich „gleich zurück", statt sie auf einen Weg zu schicken, der unter Last
auch nicht trägt.

### 3. Single-Large-Call aus — IMMER alle drei Schritte

1. `featureFlags/current.useSingleLargeCall = false` (Firestore-Console).
2. `./scripts/cloudtasks-concurrency-3.sh` ausführen (setzt die Queue auf
   Concurrency 3).
3. In `functions/src/config.js`: `QUEUE_DISPATCH_CONCURRENCY` 7 → 3 und
   `QUEUE_AVG_JOB_SECONDS` 65 → 100, dann `firebase deploy --only functions` —
   sonst zeigt das Frontend falsche Wartezeit-Schätzungen.

Schritte 1+2 wirken in ~30 s, Schritt 3 dauert ~2 min. **Warum die Kopplung:** Die
3-Call-Pipeline nutzt `mistral-small` (nur 100K Tokens/min) — bei Concurrency über 3
drohen massenhaft 429-Fehler (gemessen 2026-05-20: bei Parallelität 6 kamen 6 von
12 Jobs als 429 zurück). Rückweg: `./scripts/cloudtasks-concurrency-7.sh`, Werte in
`config.js` zurück (7 / 65), Flag wieder `true`.

### 3a. Beast-Werbung im zweiten Aufruf zurückbauen (v2.8)

Seit v2.8 erzeugt ein zweiter, kleiner Mistral-Aufruf die Beast-Werbung — ohne
Bild, damit sie an der Schwachstelle ansetzt statt am Foto. Er ist so gebaut,
dass ein Ausfall folgenlos bleibt: Schlägt er fehl, steht die Werbeliste aus dem
Hauptaufruf. **Ein eigener Notfall-Hebel ist deshalb nicht nötig.**

Falls der Aufruf dauerhaft zurückgebaut werden soll (Code-Rollback):
`./scripts/cloudtasks-concurrency-10.sh` ausführen und
`QUEUE_DISPATCH_CONCURRENCY` in `config.js` auf 10 zurücksetzen — sonst läuft
die Queue unnötig langsam.

**Warum Concurrency 7:** `mistral-large-2512` erlaubt **15 Anfragen pro Minute**
(am 2026-08-10 direkt an der API gemessen — die frühere Annahme von 6 Anfragen
pro *Sekunde* ist überholt). Bei 65 s je Analyse (live gemessen 2026-08-10) erzeugt Concurrency 7 rund
15 Anfragen/min, Concurrency 10 dagegen 22 und damit 429-Fehler.

### 3b. Prompt-Caching aus (~30 s, kein Deploy, keine Begleitschritte)

`featureFlags/current.usePromptCache = false` in der Firestore-Console setzen.
Danach wird weder ein `prompt_cache_key` gesendet noch der Nachrichten-Aufbau
umgestellt — der Pfad ist bitgenau der Stand v2.4.4.

Anders als bei `useSingleLargeCall` (Punkt 3) gibt es hier **keine** Kopplung an
Concurrency oder `config.js`: Es ist eine reine Kostenmaßnahme ohne Einfluss auf
Modell, Durchsatz oder Rate-Limits. Wenn unklar ist, ob das Caching an einer
Störung beteiligt ist, kostet das Umlegen nichts außer der Ersparnis — im Zweifel
ausschalten. Details → [FLAGS.md](FLAGS.md#usepromptcache-seit-v25).

### 4. Functions-Rollback auf einen früheren Stand (~2 min)

```bash
git fetch --tags
git worktree add /tmp/malzime-rollback vX.Y.Z   # gewünschtes Release-Tag
cd /tmp/malzime-rollback/functions && npm ci
cd /tmp/malzime-rollback && npx firebase deploy --only functions
git worktree remove /tmp/malzime-rollback
```

Das Haupt-Arbeitsverzeichnis bleibt dabei unberührt.

### 5. Hosting-Rollback

Schnellster Weg: Firebase Console → Hosting → Release-Verlauf → **Rollback**
(ein Klick, stellt den vorherigen Stand wieder her). Alternativ: früheren Stand wie
in Hebel 4 auschecken und `firebase deploy --only hosting`.

## Störungs-Rezepte

### ntfy-Fehleralarm („malziME Function Errors")

Zuerst prüfen, ob es **Scanner-Rauschen** ist: `URIError: Failed to decode param`
stammt von kaputten Bot-Angriffs-URLs, die Antworten sind 4xx — kein Schaden, kein
Handlungsbedarf (so geschehen 2026-07-13). Logs unter Cloud Logging mit
`resource.type="cloud_run_revision"` und `severity>=ERROR` ansehen; nur bei
5xx-Antworten oder echten Stacktraces aus eigenem Code handeln.
Alerting-Aufbau: [ERROR-ALERTING.md](ERROR-ALERTING.md).

### „Bild konnte nicht geöffnet werden" (`error.readFailed`)

Datei-**Lese**fehler am Endgerät, kein Formatproblem (Workshop-Vorfall 2026-07-06).
Seit v2.2.8 macht das Frontend eine Sofort-Kopie mit Retry; eine Häufung wäre neu zu
bewerten. Diagnose: Log-Bucket `client-diagnostics` (30 Tage), Felder `errorDetail`
und `fileSizeKb`.

### Mistral überlastet / 429 / 5xx

Nutzer sehen `blocked.overloaded` bzw. `blocked.apiError`; die Queue puffert
Stoßlast, interne Retries laufen automatisch. Bei anhaltender Störung: Mistral-Status
und **Account-Dashboard** prüfen (Limits unterscheiden sich drastisch je
Modellversion — immer das Dashboard, nicht Code-Kommentare). Notfalls Wartungsmodus
(Hebel 1).

### Stundenlimit erreicht (500/h rollend)

Gewollte Kostenbremse; der ntfy-Push kommt automatisch. Braucht ein Workshop mehr:
Admin-Boost (+100 je Aufruf) über `/api/admin/boost`, Zähler-Reset über
`/api/admin/reset` (jeweils HMAC-Token + Nonce-Bestätigung).

### Audit-Gate rot / Dependabot-PRs bleiben liegen

Erst nachsehen, **was** rot ist: `node scripts/audit-gate.mjs functions` (läuft
lokal identisch zur CI und nennt Paket, Advisory und Kette).

- **Es gibt eine reparierte Version** → anheben, Tests laufen lassen, committen.
  **Danach IMMER `npm ci --dry-run` in Root und `functions/`** (siehe Kasten
  unten) — sonst bricht die Linux-CI, obwohl lokal alles grün aussieht.
- **Upstream hat noch keine Reparatur, aber die Kette lässt sich umgehen** →
  nicht das verwundbare Paket selbst übersteuern, sondern dessen **Nutzer**
  anheben (Beispiel: `brace-expansion` ließ sich nicht erzwingen, aber
  `rimraf`/`glob`/`test-exclude` anzuheben hat die Kette aufgelöst). Jede
  Übersteuerung braucht eine notierte Rückbau-Bedingung im CHANGELOG.
- **Upstream hat keine Reparatur und die Kette lässt sich nicht umgehen** →
  begründeten Eintrag in
  `.github/audit-allowlist.json` anlegen: `ghsa`, `paket`, `grund` (warum nicht
  reparierbar **und** warum hier ungefährlich) und `pruefen_bis`. Ohne
  Ablaufdatum bleibt das Gate rot — das ist Absicht.
- **Ausnahme abgelaufen** → nicht blind verlängern. Erst prüfen, ob es inzwischen
  eine reparierte Version gibt (`npm view <paket> version`).

Hintergrund: Vor 2026-07-29 lief hier das nackte `npm audit --audit-level=high`.
Das kannte keine Ausnahmen und blockierte deshalb bei einer einzigen
unreparierbaren Fremd-Lücke **jeden** Pull Request — am 2026-07-01 sind daran
alle acht Dependabot-PRs gescheitert und mussten von Hand weggeräumt werden.

Bleiben Dependabot-PRs trotz grünem Gate liegen, ist meist ein anderer
Pflicht-Check rot: `gh pr checks <nr>` zeigt welcher. Auto-Merge ist dann zwar
scharf gestellt, wartet aber auf einen Check, der nie grün wird.

> **macOS-Lockfile-Falle — vor jedem Lockfile-Commit prüfen.**
> `npm audit fix`, `npm update --package-lock-only` **und** `npm install`
> schneiden auf macOS optionale Einträge aus dem Lockfile (`@emnapi/core`,
> `@emnapi/runtime`, `@pkgjs/parseargs`). Lokal fällt das nicht auf; die
> Linux-CI bricht dann in `npm ci` mit `EUSAGE … Missing … from lock file` ab.
>
> **Pflichtprüfung: `npm ci --dry-run`** (Root *und* `functions/`). Exit 0 =
> gut. Das reproduziert den CI-Fehler lokal in Sekunden. Eine Textsuche nach
> „linux" im Lockfile reicht **nicht** — die betroffenen Pakete tragen kein
> „linux" im Namen.
>
> Reparatur ohne Kollateralschaden: die weggeschnittenen Einträge aus dem
> vorherigen Lockfile-Stand zurückschreiben (`git show <ref>:<lockfile>`).
> Ein vollständiger Neuaufbau (`rm -rf node_modules package-lock.json &&
> npm install`) repariert es zwar auch, hebt aber nebenbei alle Pakete auf den
> neuesten Stand innerhalb ihrer Bereiche — im Backend zuletzt bis hin zu
> `firebase-functions` 7.3.2 und damit Express 4 → 5. Das gehört in einen
> eigenen, bewusst freigegebenen Schritt.

## Logs und Aufbewahrung

| Log | Aufbewahrung | Inhalt |
|---|---|---|
| `_Default`-Bucket | **1 Tag** — bewusst kurz, NICHT verlängern | IP-haltige Infrastruktur-Logs (Datenschutz-Versprechen) |
| `client-diagnostics` (europe-west1) | 30 Tage | anonyme `client-error`/`client-telemetry`-Einträge |
| Anwendungs-Logs | — | keine Bildinhalte, keine personenbezogenen Daten; nur Request-ID, Step, Status, Token-Counts |

## Rollback-Probe

Verfahren: Release-Tag in einem temporären `git worktree` auschecken, `npm ci`
(Root + `functions/`), Test-Suiten laufen lassen; Ergebnis mit Commit/Exit-Status in
[VERIFICATION.md](VERIFICATION.md) festhalten. Zuletzt durchgeführt am 2026-07-14
mit Tag `v2.3.1`: Setup und beide Test-Suiten grün (435 + 165 Tests). Wiederholen
bei größeren Toolchain-Wechseln (Node-Major, Test-Runner).

## DNS-Zone `malzi.me` bei IONOS — Sollstand

**Diese Tabelle ist die einzige schriftliche Quelle der DNS-Einträge.** Sie
existierte bis 2026-08-10 nicht — siehe den Vorfall weiter unten.

| Typ | Name | Wert | Wofür |
|-----|------|------|-------|
| A | `@` | `199.36.158.100` | Firebase Hosting (malzi.me). **Ohne diesen Eintrag ist die Seite offline.** |
| MX | `@` | `mx00.ionos.de`, `mx01.ionos.de` (Prio 10) | E-Mail-Empfang |
| TXT | `@` | `v=spf1 include:_spf-eu.ionos.com ~all` | SPF, sonst landen ausgehende Mails im Spam |

Weitere Einträge gibt es nicht und soll es nicht geben. Insbesondere **kein
`api`** mehr (siehe unten).

Prüfbefehl (fragt IONOS direkt, umgeht alle Zwischenspeicher):

```bash
dig +short malzi.me A   @ns1091.ui-dns.de   # muss 199.36.158.100 liefern
dig +short malzi.me MX  @ns1091.ui-dns.de
dig +short malzi.me TXT @ns1091.ui-dns.de
```

Ob Firebase einen Eintrag vermisst, beantwortet Google selbst — fehlt etwas,
steht in der Antwort ein Feld `requiredDnsUpdates`:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: malzime" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/malzime/sites/malzime/customDomains/malzi.me"
```

Erwartet: `hostState: HOST_ACTIVE`, `ownershipState: OWNERSHIP_ACTIVE`,
`cert.state: CERT_ACTIVE`, **kein** `requiredDnsUpdates`.

### Vorfall 2026-08-10: A-Record versehentlich gelöscht

Beim Abbau von `api.malzi.me` wurde in der IONOS-Oberfläche nicht nur die Zeile
`api`, sondern auch der A-Eintrag der Hauptdomain entfernt. Folge: malzi.me war
nicht mehr auflösbar. MX und SPF blieben unberührt, die E-Mail lief durch.

Wiederhergestellt wurde der Wert aus zwei unabhängigen Quellen: dem noch warmen
Resolver-Cache eines beteiligten Rechners (`dscacheutil -q host -a name malzi.me`)
und dem Firebase-Standardnamen (`dig +short malzime.web.app A`) — beide
`199.36.158.100`. Die Registrierung bei Firebase war nie betroffen; es fehlte
ausschließlich der Wegweiser bei IONOS.

**Zwei Lehren:**

1. **DNS-Einträge gehören dokumentiert, bevor jemand daran arbeitet.** Sie lagen
   nirgends schriftlich vor — die Rettung hing an einem Cache, der Minuten
   später verfallen wäre. Deshalb die Tabelle oben.
2. **Arbeitsanweisungen an einer fremden Oberfläche müssen benennen, was NICHT
   angefasst wird.** „Lösch den DNS-Eintrag" war die Anweisung; gemeint war
   ausschließlich die Zeile `api`. Bei DNS, Firewall und Berechtigungen immer
   Positiv- UND Negativliste angeben.

## `api.malzi.me` — abgebaut (Audit 2026-08-10, OPS-007)

**Status 2026-08-10: DNS-Eintrag gelöscht.** Die Subdomain löst nicht mehr auf.
Der CSP-Eintrag ist seit v2.11.0 draußen, eine echte Analyse auf malzi.me lief
danach normal durch — damit ist belegt, dass nichts mehr daran hing.

**Rest:** In Cloud Run steht die Zuordnung `api.malzi.me → analyze` noch (der
Dienst `analyze` existiert seit v2.10 nicht mehr). Ohne DNS zeigt nichts mehr
darauf; das ist eine Karteileiche, kein Risiko. Aufräumen:

```bash
curl -X DELETE -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: malzime" \
  "https://europe-west1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/malzime/domainmappings/api.malzi.me"
```

**Reihenfolge war und bleibt wichtig: erst DNS, dann die Zuordnung.**
Andersherum entstünde ein Zeitfenster, in dem der DNS-Eintrag auf Googles
Hosting zeigt, ohne dass jemand den Anspruch hält — eine übernehmbare Subdomain
unter der eigenen Marke. Deshalb wurde der CSP-Eintrag vorgezogen: Selbst wenn
das passierte, dürfte die Seite den Host nicht mehr kontaktieren.
