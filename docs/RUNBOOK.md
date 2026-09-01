# Runbook — Betrieb, Deploy, Rollback

Dieses Dokument ist das Betriebs-Handbuch von malziME: Wie wird deployt, wie wird
zurückgerollt, was tun bei Störungen. Zielgruppe: die Entwicklung des Projekts
und unterstützende KI-Assistenten. Die Architektur selbst beschreibt [ARCHITECTURE.md](ARCHITECTURE.md),
das Sicherheitsmodell samt bewusster Abwägungen [SECURITY-MODEL.md](SECURITY-MODEL.md),
das Alerting-Setup [ERROR-ALERTING.md](ERROR-ALERTING.md), die Feature-Flags
[FLAGS.md](FLAGS.md).


## Nach dem Klonen: einrichten

```bash
sh scripts/einrichten.sh
```

Setzt `core.hooksPath` auf `scripts/hooks` — damit laeuft `vor-dem-push.sh`
vor jedem Push — und meldet fehlende Werkzeuge (`gh`, `firebase`, `gitleaks`).

**Warum das hier steht:** Der Push-Riegel greift NUR mit dieser Einstellung.
Bis zum 31.08.2026 stand der Befehl ausschliesslich im Kopf der Hook-Datei
selbst — also in der Datei, die ohne ihn nie laeuft. Ein frischer Klon hatte
den Riegel damit stillschweigend nicht (gemessen: Push mit entwaffnetem
deploy.sh ging durch).

## Normalbetrieb (Soll-Zustand)

- **Aktiver Pfad:** Upload → Cloud-Tasks-Queue → Single-Large-Call
  (`featureFlags/current`: `useSingleLargeCall = true`).
- **Warteschlangen-Dosierung:** steht im Einstellungssatz
  (`parallelitaet` und `queueRatePerSekunde`) und wird von der `satzWache`
  automatisch in die Cloud-Tasks-Queue übertragen — hier bewusst ohne Zahl.
  Nachsehen: `./scripts/warteschlange-pruefen.sh`.
- **Limits:** Stundenlimit und IP-Rate-Limit stehen im Einstellungssatz
  (`config/betriebsprofil`, siehe [BETRIEBSPROFILE.md](BETRIEBSPROFILE.md)) —
  hier bewusst ohne Zahl, damit sie nach einer Umstellung nicht falsch ist
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
2. Änderung per Branch + PR auf `main`; die **sechs** CI-Pflicht-Checks
   (test-backend, test-frontend, test-e2e, secret-scan, playwright-version,
   pruefungen) sind Merge-Voraussetzung. Kanonisch ist die Branch Protection,
   siehe Abschnitt weiter unten (DOC-2026-08-20-13: hier standen vier).
3. CHANGELOG: Sobald deployt wird, ist das ein Release — den
   `[Unveröffentlicht]`-Abschnitt im selben Schritt auf neue Versionsnummer und
   Datum stempeln.
4. Deploy über `./scripts/deploy.sh [hosting|functions]`.

   **Seit 31.08.2026 läuft ein Trockenlauf** (nach Stand-Bindung,
   Sauberkeits-Prüfung, CLI-Version, Infrastruktur-Prüfung und
   Einstellungssatz — die genaue Position ist `deploy.sh` zu entnehmen, eine
   Zahl hier veraltet bei jeder Umstellung) (`firebase deploy
   --dry-run`, rund 28 Sekunden), in derselben Reihenfolge und mit denselben
   Zielen wie der echte Deploy.

   *Er ist fast, aber nicht ganz folgenlos:* Die Firebase-CLI weist selbst
   darauf hin, dass ein Trockenlauf am Zielprojekt **Programmierschnittstellen
   einschalten kann** („this may still enable APIs on the target project").
   Er läuft zudem vor der Rückfrage „Weiter?" — kann das also tun, bevor ein
   Mensch zugestimmt hat. Bei malziME sind alle nötigen Schnittstellen seit
   Langem aktiv; wer das Skript gegen ein frisches Projekt richtet, sollte es
   wissen. Anlass waren sechs gescheiterte Auslieferungen
   an einem Tag — jede davon wäre hier sichtbar geworden, zusammen rund
   zweieinhalb Stunden. Bricht er ab, passiert nichts weiter (Notschalter
   `SKIP_DRYRUN=1`). Scheitert der Deploy später doch, nimmt das Skript
   zurück, was es selbst geschrieben hat: die hochgezählte Cache-Kennung in
   allen betroffenen Dateien **und** `public/build-info.json`. Sonst blockiert
   ein gescheiterter Versuch den nächsten am Sauberkeits-Riegel. (Bis zum
   31.08.2026 blieb `build-info.json` liegen — der nächste Versuch scheiterte
   dann trotz Aufräumen.)

   **Lint und Unit-Tests laufen nur noch, wenn die Stand-Bindung NICHT
   gegriffen hat.** Sie verlangt ohnehin einen sauberen Arbeitsbaum,
   `HEAD == origin/main` und sechs grüne Pflicht-Checks — damit sind dieselben
   Suiten über bitgenau denselben Code bereits belegt. Fällt sie aus
   (`SKIP_STAND=1`), laufen sie vollständig.

   **Wartet der main-Lauf noch, zählen die Ergebnisse des Pull Requests** —
   aber nur, wenn dessen Baum-Kennung identisch ist. Dann ist jede Datei
   bitgenau gleich, und eine Prüfung kann nichts anderes finden. Zusammen mit
   dem vorigen Punkt spart das rund neun Minuten je Auslieferung, ohne einen
   Riegel aufzugeben.

   Zwei Einschränkungen gehören dazu, sonst wäre es keine sichere Abkürzung:

   - **Nur Ausstehendes wird nachgetragen.** Ersetzt werden ausschließlich
     Checks, die auf `pending` oder ohne Ergebnis stehen. Ein `failure` auf
     `main` bleibt ein `failure` — sonst könnte ein grünes PR-Ergebnis ein
     rotes von `main` verdrängen.
   - **`test-backend` ist ausgenommen.** Diese Suite hängt an der echten Uhr;
     ihr Ergebnis von gestern sagt nichts über heute. Sie muss auf `main`
     selbst grün sein.

   Das Skript prüft weiter die Version der Firebase-CLI gegen die
   in `deploy.sh` hinterlegte Untergrenze (Notschalter `SKIP_CLI_CHECK=1`; eine
   nicht ermittelbare Version bricht ab, statt durchzuwinken —
   `OPS-2026-08-12-25`) und zählt dann den Cache-Buster in allen
   ausgelieferten Seiten automatisch hoch — welche das sind, fragt das Skript
   beim Dateisystem ab, es führt keine eigene Liste (DOC-2026-08-20-13: hier
   stand „fünf HTML-Seiten", real sind es seit den englischen Rechtsseiten zehn
   plus `js/demo.js`) (Konvention `?v=YYYYMMDDNN`: gleicher Tag
   → laufende Nummer +1, sonst neuer Tag mit `01`; nur bei Hosting-Deploys
   relevant, reine Functions-Deploys brauchen keinen).
5. `release.yml` legt automatisch einen GitHub-Release an, sobald die neue
   CHANGELOG-Version auf `main` landet (idempotent).
6. Nach dem Deploy läuft automatisch `scripts/live-smoke.sh`: vier
   kostenfreie Proben gegen die Live-API (Upload-Ablehnung 400 mit echter
   Validierungs-Meldung, Honeypot 403, Admin-Zugriffsschutz 403, Stats 200) —
   alle enden vor KI-Aufruf und Stundenzähler. Notschalter `SKIP_SMOKE=1`.

## Notschalter des Deploys

Acht Stück, alle nur im Notfall und alle einzeln zu begründen. Jeder
übersprungene Riegel erscheint in der Schlussbilanz des Laufs — ein Wächter
erzwingt das, damit ein Lauf nicht grün aussieht, obwohl eine Prüfung ausfiel.

| Schalter | Was entfällt |
|---|---|
| `SKIP_STAND=1` | Bindung an die CI-Freigabe. Dann laufen Lint und Unit-Tests stattdessen lokal |
| `SKIP_TESTS=1` | der Test-Riegel |
| `SKIP_DRYRUN=1` | der Trockenlauf |
| `SKIP_INFRA=1` | die Infrastruktur-Prüfung (etwa bei abgelaufener gcloud-Anmeldung) |
| `SKIP_SATZ=1` | die Prüfung des Einstellungssatzes gegen die laufende Anwendung |
| `SKIP_FIRESTORE=1` | der Firestore-Schritt (Regeln und Indizes) |
| `SKIP_SMOKE=1` | die Live-Proben nach der Auslieferung |
| `SKIP_CLI_CHECK=1` | die Versionsprüfung der Firebase-CLI |

## Der Firestore-Schritt

`deploy.sh` rollt Firestore **als eigenen Aufruf** aus, vor Hosting und
Functions. Im Paket mit ihnen scheitert er an der Standard-Datenbank, die es
hier nicht gibt — malziME nutzt die benannte Datenbank `malzime-eu`.

Das gilt auch bei `./scripts/deploy.sh hosting`: Der Firestore-Schritt läuft
trotzdem mit. Wer das nicht will, setzt `SKIP_FIRESTORE=1`.

## Infrastruktur-Prüfung (`scripts/verify-infrastructure.sh`)

Ein Teil der Sicherheits- und Datenschutz-Zusagen lebt **außerhalb des Repos**
in der Cloud-Konfiguration — `firebase deploy` verwaltet sie nicht. Das
Prüfskript gleicht den Ist-Zustand **nur lesend** gegen den Soll-Zustand ab
und läuft automatisch in `deploy.sh` vor jedem Deploy (Notschalter
`SKIP_INFRA=1`, z. B. wenn die gcloud-Anmeldung abgelaufen ist und ein
dringender Rollback nicht warten darf). Es kann jederzeit auch direkt
gestartet werden.

**Was es prüft (= der Soll-Zustand):**

| Bereich | Soll |
|---|---|
| Cloud-Tasks-Queue `analyze-queue` | existiert in `europe-west1`, RUNNING, Dosierung == Einstellungssatz |
| Bucket `malzime-queue-uploads` | Region `EUROPE-WEST1`, Lifecycle-Löschregel nach 1 Tag aktiv, Soft-Delete 0 |
| Inhalt des Bildspeichers | **kein Bild älter als 3 Stunden** — ein Auftrag lebt höchstens zwei. Seit 31.08.2026; Anlass waren 4.056 liegengebliebene Testbilder. Ein **leerer** Speicher ist der Sollzustand und kein Fehler (`gsutil` meldet dafür Rückgabewert 1) |
| Firestore | genau **eine** Datenbank: `malzime-eu` in `europe-west1` |
| Worker-IAM | `processjob` und `reapjobs` ohne `allUsers`/`allAuthenticatedUsers` (nicht öffentlich; die `/api/*`-Functions sind bewusst öffentlich, Hosting reicht durch) |
| Functions-Regionen | alle in `europe-west1` |
| Logging | `_Default`-Ausschluss `exclude_run_requests_ip` aktiv (Request-Logs vollständig, **ohne** Schwere-Bedingung — sie sind der einzige Träger von Client-IPs, und `_Default` liegt fest auf Standort `global`), Sink `client-diagnostics-sink` vorhanden |

Exit-Codes: 0 = grün, 1 = Abweichung (Deploy stoppt), 2 = Voraussetzung fehlt
(gcloud nicht da/nicht angemeldet). Der Test
`functions/src/__tests__/verify-infrastructure-script.test.js` erzwingt in der
CI, dass das Skript ausschließlich Lese-Kommandos enthält.

**Grenze des Skripts — ZDR ist Vertrag, nicht Konfiguration:** Die
Zero-Data-Retention-Zusage von Mistral lässt sich technisch nicht abfragen.
Ihr Nachweis ist organisatorisch: privater Nachweisordner (organisatorisch)
(ZDR-/Trainings-Opt-out-Screenshots, schriftliche Support-Bestätigung, DPA und
Subprozessoren-Liste — bewusst NICHT im öffentlichen Repo) plus Wiedervorlage:
**vor jeder Presse-Welle und mindestens halbjährlich** im Mistral-Dashboard
nachprüfen und den Screenshot-Stand erneuern.

**Damit die Frist nicht vergessen wird, wachen zwei Schichten darüber** — beide
rechnen mit derselben Frist aus `functions/src/zusagen.js`:

1. **Freundliche Vorwarnung:** Die geplante Function `erinnerung`
   (`handle-erinnerung.js`, montags 9 Uhr Wien) liest das Prüfdatum von der
   **Live-Seite** und schickt eine Woche vor Fristablauf einen ntfy-Push aufs
   Handy — mit der Handlungsanleitung im Text und einem Knopf direkt ins
   Mistral-Dashboard. Überfällig meldet sie mit höherer Priorität. Sie ist
   fail-soft: Seite nicht erreichbar, Datum unlesbar oder ntfy weg werden nur
   als Warnung geloggt (nie `severity ERROR`, sonst löst die Erinnerung den
   Fehleralarm aus).
2. **Harte Bremse:** `functions/src/__tests__/zusagen-frische.test.js` macht
   die CI rot, sobald das Prüfdatum älter als 183 Tage ist — falls die
   Vorwarnung untergeht.

Ablauf, wenn die Erinnerung kommt (oder der Bau rot wird) — **in dieser
Reihenfolge**:

1. Im Mistral-Dashboard nachsehen, ob „Null-Datenspeicherung" noch aktiv ist.
2. Screenshot mit Datum in den privaten Nachweisordner legen.
3. **Erst dann** das Datum in `public/datenschutz.html` an beiden Stellen
   hochsetzen (Prüfdatum im Mistral-Absatz + `Stand:`-Zeile im Kopf) und
   deployen.

Das Datum **niemals** ohne echte Prüfung hochsetzen — dann behauptet die
Webseite etwas Unbelegtes, und genau davor schützt der Wächter.

## Wächter über den Alarmweg (seit 2026-08-12)

`scripts/verify-infrastructure.sh` prüft seit OPS-2026-08-12-09 vor jedem Deploy mit:
Gibt es noch eine Richtlinie mit `severity>=ERROR`, ist sie scharf, hat sie
Benachrichtigungskanäle, und sind die Kanäle eingeschaltet? Vier Ausfallarten führen zu
rot: Richtlinie fehlt, Richtlinie aus, kein Kanal, Kanal abgeschaltet — dazu „nicht
geprüft" bei einer gescheiterten Messung.

**Grenze dieser Maßnahme, ausdrücklich:** Sie greift zur Deploy-Zeit, nicht in der Minute
des Ausfalls. Zwischen zwei Deploys kann der Alarmweg tot sein, ohne dass es auffällt. Ein
laufender Wächter müsste außerhalb dieses Projekts sitzen (der Alarm kann sich nicht
selbst überwachen) — das bleibt ein benanntes Restrisiko. Eine Zustellprobe von Hand
steht in `docs/ERROR-ALERTING.md`.

## Branch Protection auf `main` (Stand 2026-08-12)

Soll-Zustand, auslesbar:

    gh api repos/malziland/malzime/branches/main/protection \
      --jq '{strict:.required_status_checks.strict, checks:.required_status_checks.contexts, admins:.enforce_admins.enabled}'

Erwartet: `strict: true`, `admins: true`, sechs Pflicht-Checks —
`test-backend`, `test-frontend`, `test-e2e`, `secret-scan`, `playwright-version`,
`pruefungen`.

`pruefungen` kam am 2026-08-12 dazu (OPS-2026-08-12-04): Der Job lief zwar, stand aber
nicht auf der Liste — die Zusage „blockierend" in `ci.yml`, README und CHANGELOG war
damit unbelegt. Eingetragen wurde er erst, nachdem er in fünf Läufen hintereinander grün
war; ein wackliger Pflicht-Check blockiert wegen `enforce_admins: true` **jeden** Merge,
auch den eigenen.

Rückweg, falls er je klemmt (nimmt nur `pruefungen` heraus):

    gh api -X PATCH repos/malziland/malzime/branches/main/protection/required_status_checks \
      --input - <<'JSON'
    {"strict":true,"contexts":["test-backend","test-frontend","test-e2e","secret-scan","playwright-version"]}
    JSON

## Automatische Löschregel der Datenbank (seit 2026-08-12)

Soll-Zustand: `jobs/expiresAt`, Status `ACTIVE`, Datenbank `malzime-eu`.

    gcloud firestore fields ttls list --database=malzime-eu --project=malzime

Das ist das **Netz unter dem Reaper**, nicht die eigentliche Löschung: Der Reaper räumt
Job-Dokumente nach 2 Stunden ab, die Regel greift erst nach 24 Stunden. Der Abstand ist
Absicht — eine knapp gesetzte Regel würde laufende Jobs mitten im Betrieb löschen.

Rückweg, falls sie je stört:

    gcloud firestore fields ttls update expiresAt --collection-group=jobs \
      --database=malzime-eu --project=malzime --disable-ttl

Eingerichtet am 2026-08-12, als die Sammlung `jobs` nachweislich 0 Dokumente hatte
(ARCH-2026-08-12-27). Eine Migration bestehender Dokumente war deshalb nicht nötig.

## Laufzeit-Wache (seit 2026-08-29, v4.2.0)

**Was sie tut.** Die geplante Function `laufzeitWache` (`laufzeit-wache.js`,
täglich 7:20 Wien) vergleicht die Dauer der letzten drei Tage mit den vierzehn
davor und meldet per ntfy, wenn Analysen spürbar langsamer werden oder ein
relevanter Anteil der Zeitgrenze nahekommt.

**Warum es sie gibt.** Der Einbruch vom 26.08.2026 fiel erst am 28.08. durch
Rückmeldungen auf — zwei Tage später, mitten in einer laufenden Aussendung.
`mistral-zeitbudget.test.js` sollte das abdecken, kann es aber per Konstruktion
nicht: Er rechnet zwei Konstanten gegeneinander und bleibt grün, wenn der
Anbieter langsamer wird.

**Wann sie schweigt — und warum das kein Ausfall ist.** Unter zehn Analysen im
Zeitraum trifft sie keine Aussage (malziME hat Tage mit zwei Läufen), und eine
Auffälligkeit muss zwei Tage anhalten. Am 28.08. lagen zwischen 19 und 66 Token
pro Sekunde nur drei Stunden — eine Wache, die auf einzelne Ausschläge
anspringt, wird nach zwei Wochen ignoriert.

**Nachsehen, ob sie läuft.** Sie protokolliert JEDEN Lauf, auch den
unauffälligen — sonst wäre nicht zu unterscheiden, ob sie „in Ordnung" meldet
oder gar nicht lief:

    gcloud logging read 'jsonPayload.step="laufzeit-wache"' \
      --project=malzime --limit=5 --format=json

**Beim nächsten Deploy zu beachten.** `laufzeitWache` ist eine NEUE Function.
Sie braucht die ntfy-Secrets (sind in `index.js` deklariert) und sollte in den
Filter der Alarm-Policy „malziME Function Errors" aufgenommen werden — sonst
stirbt sie still.

## Lebenszeichen der Wochen-Erinnerung (seit 2026-08-12)

Die Erinnerung schreibt bei jedem Lauf `config/erinnerung.letzterLauf`. Der Reaper liest
das jede Minute und meldet mit `severity: ERROR`, wenn es älter als neun Tage ist —
Marker `erinnerung-lebenszeichen-veraltet`. Damit fällt ein Ausfall der Erinnerung auf,
obwohl sie selbst bewusst leise bleibt (OPS-2026-08-12-11).

Prüfen von Hand:

    gcloud logging read 'jsonPayload.error="erinnerung-lebenszeichen-veraltet"' \
      --project=malzime --freshness=14d

Erwartet: keine Zeile.

## Rollback-Hebel

Vom schnellsten zum gründlichsten. Alle Flag-Hebel wirken **ohne Deploy** binnen
~30 Sekunden (Cache-TTL der Flags).

### 1. Wartungsmodus (Sekunden — kontrollierte Vollbremsung)

`sh scripts/wartungsmodus.sh ein "Text für die Besucher"`, zurücknehmen mit
`sh scripts/wartungsmodus.sh aus`. Das Skript schaltet und misst danach nach,
ob der Zustand wirklich angekommen ist — ohne diese Nachmessung wäre
„geschaltet" eine Behauptung.

Darunter liegt ein POST auf `/api/admin/maintenance` mit **Bearer-Auth**
(`Authorization: Bearer <ADMIN_SECRET>`). Der Zustand steht im
Firestore-Dokument `config/maintenance` und braucht bis zu 30 Sekunden, bis ihn
alle Instanzen sehen. Besucher sehen dann einen Wartungs-Dialog statt der
Analyse.

**Nicht HMAC.** Bis zum 01.09.2026 stand hier der zweistufige HMAC-Weg mit
Bestätigungsseite und Nonce. Den gibt es für den Wartungsmodus nicht:
`handle-admin.js` schließt ihn ausdrücklich aus (`action !== "maintenance"`)
und antwortet mit `403 Maintenance requires Bearer auth`. Für `boost` und
`reset` stimmt der HMAC-Weg weiterhin — falsch beschrieben war ausgerechnet der
Hebel, der am schnellsten greifen muss.

Gemessen beim 4.6.0-Deploy am 01.09.2026: ein um 18:17:48, aus um 18:22:19 —
4 Minuten 30 Sekunden Unerreichbarkeit.

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

### 2a. Sprachumschalter aus (Sekunden — ein Bedienelement zurücknehmen)

`featureFlags/current.useSprachumschalter = false` in der Firestore-Console,
auch vom Handy aus. Wirkt beim nächsten Seitenaufruf (Flag-Cache 30 s).

Danach entsteht der Umschalter gar nicht mehr im Dokument — nicht ausgegraut,
sondern weg. Laufende Analysen sind nicht betroffen, und **Englisch bleibt
erreichbar**: über `?lang=en` in der Adresse und über die Gerätesprache. Der
Hebel nimmt nur das Bedienelement zurück, nicht die Sprache.

Wann er gebraucht wird: wenn der Umschalter mitten in einem Workshop irritiert
oder ein Fehler auffällt. Kein Deploy, kein Neustart, keine Nebenwirkung.

### 3. Single-Large-Call aus — IMMER alle drei Schritte

1. `featureFlags/current.useSingleLargeCall = false` (Firestore-Console).
2. `./scripts/cloudtasks-concurrency-3.sh` ausführen (setzt die Queue auf
   Concurrency 3).
3. In Firestore `config/betriebsprofil`: `aktiv` auf den Satz `t1-drei-call`
   setzen (`parallelitaet: 3`, `durchschnittsdauerSekunden: 100`). **Kein
   Deploy mehr nötig** — seit dem Umbau vom 30.08.2026 stehen diese Werte in
   der Datenbank. Ohne diesen Schritt zeigt das Frontend falsche
   Wartezeit-Schätzungen.

Alle drei Schritte wirken in ~30 s. **Warum die Kopplung:** Die
3-Call-Pipeline nutzt `mistral-small` (nur 100K Tokens/min) — bei Concurrency über 3
drohen massenhaft 429-Fehler (gemessen 2026-05-20: bei Parallelität 6 kamen 6 von
12 Jobs als 429 zurück). Rückweg: Betriebsprofil zurückstellen (Flag wieder `true`); die
Warteschlangen-Werte zieht die Anwendung selbst nach. `config.js` wird dabei
nicht mehr angefasst — dieser Satz stammte aus der Zeit vor dem Umbau vom
30.08.2026 und widersprach dem Hinweis drei Zeilen darüber.

### 3a. Beast-Werbung im zweiten Aufruf zurückbauen (v2.8)

Seit v2.8 erzeugt ein zweiter, kleiner Mistral-Aufruf die Beast-Werbung — ohne
Bild, damit sie an der Schwachstelle ansetzt statt am Foto. Er ist so gebaut,
dass ein Ausfall folgenlos bleibt: Schlägt er fehl, steht die Werbeliste aus dem
Hauptaufruf. **Ein eigener Notfall-Hebel ist deshalb nicht nötig.**

Falls der Aufruf dauerhaft zurückgebaut werden soll (Code-Rollback):
`./scripts/cloudtasks-concurrency-10.sh` ausführen und
`parallelitaet` im Einstellungssatz auf 10 zurücksetzen (kein Deploy) — sonst läuft
die Queue unnötig langsam.

**Warum die Dosierung so steht, wie sie steht (Stand 30.08.2026):** Mistral
begrenzt auf der Stufe T1 **0,25 Anfragen pro Sekunde**. Jede Analyse macht
zwei Aufrufe (Analyse + Beast-Werbung), also darf die Queue höchstens **0,125
Analysen pro Sekunde** losschicken — eine alle acht Sekunden. Bei rund 40 s je
Analyse (gemessen 30.08.2026) passt dazu eine Parallelität von **4**.

Die frühere Rechnung ging von 15 Anfragen pro Minute und 65 s je Analyse aus
und kam auf Concurrency 7. Beide Zahlen waren überholt; wir fuhren damit über
dem Limit, was im Alltag nicht auffiel und bei Andrang 429-Fehler erzeugte.

**Beide Werte stehen im Einstellungssatz und werden automatisch übertragen.**
Wer sie ändert, ändert die laufende Queue — kein Deploy, kein gcloud-Befehl.
Vorher ins Mistral-Dashboard sehen, nicht nach Gefühl entscheiden.

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

### Verdacht auf Absturz-Schleife (Safari: „wiederholt ein Problem aufgetreten")

Die Absturz-Wache (`public/js/absturz-wache.js`, seit v2.12.2) erkennt drei
Starts binnen einer Minute, deren Vorgänger sich nicht sauber abgemeldet hat,
meldet das EINMAL über den Diagnose-Kanal und verwirft den gemerkten Auftrag.
**Entscheidung 2026-08-11: bewusst OHNE eigenen Alarm** — der `errors`-Dienst
ist aus dem Alarmfilter ausgenommen (Anti-Spam), Nachschauen ist der
vereinbarte Weg:

```bash
gcloud logging read 'resource.labels.service_name="errors" AND jsonPayload.phase="absturz-schleife"' \
  --project=malzime --freshness=30d
```

Treffer enthalten in `errorDetail` die Anzahl der Starts, die zuletzt
erreichte Phase (`letztePhase`) und ob ein Auftrag offen war
(`offenerAuftrag`) — die erste echte Spur für die weiterhin ungeklärte
Ursache. Kein Treffer nach einem Workshop heißt: Die Schleife ist dort nicht
aufgetreten. Manuelles Neuladen zählt seit v2.12.3 nicht mehr mit.

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

### »notbremse-gegriffen« — der Stundenzähler ist ausgefallen

**Was passiert ist:** Der reguläre Zähler kam nicht durch (Datenbanksperre bei
Andrang), und das Netz hat übernommen — es hat die Aufträge der letzten Stunde
gezählt und **blockiert**, weil das Limit erreicht war.

**Ist das schlimm?** Nein, das ist die Bremse bei der Arbeit. Die Meldung sagt
nur: Es ist gerade viel los, und die Kostengrenze greift.

**Was tun:** Wie bei jedem erreichten Stundenlimit — abwarten oder den Boost
nutzen. Kommt die Meldung außerhalb eines Workshops, lohnt ein Blick in die
Zugriffszahlen.

### »Zähler UND Netz fehlgeschlagen« — jetzt ist die Bremse wirklich weg

**Das ist der ernste Fall.** Beide Wege zur Kostenbremse sind gescheitert, der
Einlass läuft ungebremst weiter. Ursache ist fast immer ein Firestore-Ausfall.

**Sofort:** Wartungsmodus einschalten (`sh scripts/wartungsmodus.sh ein`, siehe
Hebel 1), damit keine weiteren Analysen starten. Danach den Datenbankzustand
prüfen.

### Stundenlimit erreicht (rollendes Fenster, Wert im Einstellungssatz)

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
| CNAME | `www` | `malzime.web.app.` | leitet www.malzi.me auf malzi.me um (301) |

Weitere Einträge gibt es nicht und soll es nicht geben. Insbesondere **kein
`api`** mehr (siehe unten).

> **DOC-2026-08-20-18:** Der `www`-Eintrag fehlte dieser Tabelle, obwohl sie sich
> ausdrücklich als „einzige schriftliche Quelle" bezeichnet — genau das
> Wiederherstellungs-Szenario vom 2026-08-10 hätte ihn mit verloren. Gemessen am
> 2026-08-21: `dig +short www.malzi.me CNAME @ns1091.ui-dns.de` → `malzime.web.app.`,
> und Firebase führt `www.malzi.me` als eigene Domain (HOST_ACTIVE, CERT_ACTIVE).

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

**Rest: erledigt.** Die Cloud-Run-Zuordnung `api.malzi.me → analyze` ist inzwischen
geräumt — gemessen am 2026-08-21 über die Domain-Mappings-Schnittstelle: keine
Einträge mehr (DOC-2026-08-20-35; hier stand sie noch als vorhanden, samt
Aufräum-Befehl).

**Reihenfolge war und bleibt wichtig: erst DNS, dann die Zuordnung.**
Andersherum entstünde ein Zeitfenster, in dem der DNS-Eintrag auf Googles
Hosting zeigt, ohne dass jemand den Anspruch hält — eine übernehmbare Subdomain
unter der eigenen Marke. Deshalb wurde der CSP-Eintrag vorgezogen: Selbst wenn
das passierte, dürfte die Seite den Host nicht mehr kontaktieren.

## Firestore-Umzug nach Europa (Audit 2026-08-10, PRIV-001) — ABGESCHLOSSEN

**Stand 2026-08-11: erledigt.** Aktive Datenbank ist `malzime-eu`
(`europe-west1`), umgeschaltet mit v2.12.0 und am Zähler nachgewiesen:
`stats/totals.allTime` stieg nach einer echten Analyse **nur** in Europa, das
Job-Dokument lag nur dort. Die alte Datenbank `(default)` in `nam5` (USA) ist
am 2026-08-11 **gelöscht** (freigegeben im Kurzaudit) — damit ist
der Rückweg entfallen, das Kopier-Skript `scripts/firestore-umzug-sync.mjs`
wurde ausgebaut und `firebase.json` listet nur noch `malzime-eu`. Der
US-Bucket `malzime_cloudbuild` ist ebenfalls seit 2026-08-11 gelöscht — es
liegt kein Speicher mehr außerhalb Europas.

Was bleibt und weiter gilt:

- Der Standort einer Firestore-Datenbank ist **unveränderlich** — ein
  künftiger Wechsel läuft immer über eine zweite Datenbank.
- Jeder Zugriff läuft über `datenbank()` aus `functions/src/db.js`, gesteuert
  von `FIRESTORE_DATABASE_ID` in `config.js`. `__tests__/db-zentral.test.js`
  hält beides fest und scannt seit v2.12.3 rekursiv alle Unterordner.
- Beweisregel für jeden solchen Wechsel: eine echte Analyse durchlaufen lassen
  und nachsehen, dass der Zähler **nur** in der neuen Datenbank steigt.
  Zusagen über Infrastruktur werden an der Infrastruktur belegt, nicht am
  Quelltext.
