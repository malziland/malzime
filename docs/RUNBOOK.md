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

**Pipeline-Datei oder Einstellung eines Prüfwerkzeugs geändert?** Dann meldet die
Vorabprüfung „Pruefungen: Deploy-Riegel" rot: Alle fünf Workflows unter
`.github/workflows/`, `.github/dependabot.yml` und die Einstellungsdateien der
Prüfwerkzeuge (`vitest.config.js`, `playwright.config.js`, `eslint.config.mjs`,
`functions/eslint.config.js`, `.prettierignore`, `functions/jest.setup.js`) sind per
Prüfsumme festgeschrieben.
War die Änderung beabsichtigt, die neue Summe nachtragen — `python3
scripts/pruefe-deploy-riegel.py --vertrag-summen` zeigt beide Tabellen, eingetragen
wird sie in `VERTRAG_SUMMEN` bzw. `EINSTELLUNG_SUMMEN` im selben Skript. Bleibt der
Riegel danach rot, geht es um den Inhalt: In `ci.yml` fehlt etwas, das ein Pflicht-Job
tun muss, oder ein Pflicht-Schritt trägt eine Bedingung; ein npm-Skript hinter einem
Pflicht-Schritt oder die Jest-Einstellung in `package.json` lautet anders als
festgelegt. Die Meldung nennt Datei, Job und Befehl. Soll das neue Skript gelten, wird
die Festlegung im Riegel mitgeändert (`NPM_SKRIPTE`, `JEST_EINSTELLUNG`) — im selben
Commit, damit die Änderung im Diff als das dasteht, was sie ist (Begründung:
`docs/SECURITY-MODEL.md`, Absatz „Festgeschrieben").

## Normalbetrieb (Soll-Zustand)

- **Analyse-Weg:** Upload → Cloud-Tasks-Queue → ein Aufruf an Mistral Large
  (Beschreibung + beide Profile). Einen zweiten, älteren Weg gibt es seit
  10.09.2026 nicht mehr (Hebel 3 entfallen).
- **Warteschlangen-Dosierung:** steht im Einstellungssatz
  (`parallelitaet` und `queueRatePerSekunde`) und wird von der `satzWache`
  automatisch in die Cloud-Tasks-Queue übertragen — hier bewusst ohne Zahl.
  Nachsehen: `./scripts/warteschlange-pruefen.sh`.
- **Limits:** Stundenlimit und IP-Rate-Limit stehen im Einstellungssatz
  (`config/betriebsprofil`, siehe [BETRIEBSPROFILE.md](BETRIEBSPROFILE.md)) —
  hier bewusst ohne Zahl, damit sie nach einer Umstellung nicht falsch ist.
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
4. Deploy über `./scripts/deploy.sh` (Website und Server; nur die Website: `./scripts/deploy.sh hosting`).
   Der Server allein wird abgelehnt — der Fingerabdruck des Server-Codes geht mit der Website hinaus.
   Die Website allein geht nur hinaus, solange der Server-Code seit der letzten Auslieferung
   unverändert ist (Hebel 5a); sonst hält das Skript an und verlangt die vollständige Auslieferung.

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

   Das Skript prüft weiter die Version der Firebase-CLI gegen die in `deploy.sh`
   hinterlegte Untergrenze (Notschalter `SKIP_CLI_CHECK=1`). Eine nicht
   ermittelbare Version bricht ab, statt durchzuwinken (`OPS-2026-08-12-25`) —
   und nicht ermittelbar ist jede Ausgabe von `firebase --version`, deren erste
   Zeile nicht genau aus drei Zahlen besteht (etwa `15.1.0`): eine leere Ausgabe
   ebenso wie eine Warnung, eine Fehlermeldung oder eine Vorabversion
   (`OPS-2026-10-03-16`).

   Danach zählt es den Cache-Buster in allen ausgelieferten Seiten automatisch
   hoch — welche das sind, fragt das Skript beim Dateisystem ab, es führt keine
   eigene Liste (DOC-2026-08-20-13: hier stand „fünf HTML-Seiten", real sind es
   seit den englischen Rechtsseiten zehn plus `js/demo.js`). Konvention
   `?v=YYYYMMDDNN`: gleicher Tag → laufende Nummer +1, sonst neuer Tag mit `01`.
   Die Website gehört zu jeder Auslieferung über das Skript, der Buster also
   auch: Ein Ziel ohne `hosting` lehnt es ab (`ARCH-2026-10-03-10`, Begründung
   bei Hebel 4).
5. `release.yml` legt automatisch einen GitHub-Release an, sobald die neue
   CHANGELOG-Version auf `main` landet (idempotent).

   **Der Nachtrag-PR nach dem Deploy braucht keinen Browser-Test** (seit
   16.09.2026). Ändert ein Pull Request nur die Cache-Kennung in den Seiten,
   `public/build-info.json`, das CHANGELOG und `docs/VERIFICATION.md`,
   erkennt das `scripts/nur-nachtrag.sh` im Pflicht-Job `playwright-version`
   (Protokollzeile `nur_nachtrag=ja`). Der Job `test-e2e` steht dann auf
   „skipped“: Der Branch-Schutz lässt den PR durch, `deploy.sh` und die
   Baum-Regel werten „skipped“ aber nie als bestandenen Browser-Test. Die
   Regel ist eng: nur geänderte gewöhnliche Dateien (keine Symlinks,
   Submodule, Rechte-Änderungen), Seiten dürfen sich nur in Kennungen der
   Form `?v=<10 Ziffern>"` unterscheiden, der Fingerabdruck muss vollständig
   sein und nur vorhandene Dateien nennen. Alles andere ergibt „nein“ und die
   volle Suite; ein technischer Fehler der Erkennung lässt den Pflicht-Job
   scheitern. Auf `main` und im Zeitplan-Lauf läuft die Suite immer.
   Begründung und Neubewertung: `docs/SECURITY-MODEL.md`, Abschnitt
   „Nachtrag ohne Browser-Test“.
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
| Einstellungssatz `config/betriebsprofil` | **feldweise gleich** `functions/src/produktiv-satz.js` (alle Profile, aktives Profil). Seit 01.09.2026 (OPS-2026-09-01-02). Nachziehen: `node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`; vorher `node scripts/betriebsprofil-vergleichen.js` zeigt die Abweichungen |
| Bucket `malzime-queue-uploads` | Region `EUROPE-WEST1`, Lifecycle-Löschregel nach 1 Tag aktiv, Soft-Delete 0 |
| Inhalt des Bildspeichers | **kein Bild älter als 3 Stunden** — ein Auftrag lebt höchstens zwei. Seit 31.08.2026; Anlass waren 4.056 liegengebliebene Testbilder. Ein **leerer** Speicher ist der Sollzustand und kein Fehler (`gsutil` meldet dafür Rückgabewert 1) |
| Firestore | genau **eine** Datenbank: `malzime-eu` in `europe-west1` |
| Worker-IAM | `processjob` und `reapjobs` ohne `allUsers`/`allAuthenticatedUsers` (nicht öffentlich; die `/api/*`-Functions sind bewusst öffentlich, Hosting reicht durch) |
| Functions-Regionen | alle in `europe-west1` |
| Schalter für lokale Läufe | an **keinem** Dienst steht `MISTRAL_MOCK`, `QUEUE_LOCAL`, `NTFY_STUMM` oder `FUNCTIONS_EMULATOR` als Umgebungsvariable (gelesen werden nur die Namen). Seit 04.10.2026: Das Programm hält die Schalter von der Produktion fern, erkennt die Produktion aber an `K_SERVICE` ohne das Emulator-Merkmal — stünde dieses an einem Dienst, wirkten sie wieder |
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

`scripts/verify-infrastructure.sh` prüft seit OPS-2026-08-12-09 vor jedem Deploy mit — seit
03.10.2026 jede der fünf Alarmregeln einzeln nach ihrem Namen (Liste `ALARM_REGELN` im
Skript; beschrieben sind die Regeln in `docs/ERROR-ALERTING.md`, ein Test hält beides
gegeneinander): Gibt es die Regel, ist sie scharf, hat sie Benachrichtigungskanäle, und ist
ein eingeschalteter E-Mail-Kanal dabei? Dazu: Sind alle Kanäle eingeschaltet, und gibt es im
Projekt eine Alarmregel, die nicht auf der Liste steht? Sechs Ausfallarten führen zu rot:
Regel fehlt, Regel aus, kein Kanal, kein E-Mail-Kanal, Kanal abgeschaltet, Regel ohne
Wächter — dazu „nicht geprüft" bei einer gescheiterten Messung.

Drei der fünf Regeln hören auf einzelne Dienste (Liste `ALARM_REGELN_MIT_DIENSTLISTE` im
Skript). Für jede davon wird einzeln geprüft, dass ihr Filter jeden Dienst nennt, der nicht
benannte Ausnahme ist. Führt eine dieser Regeln keine Dienstliste mehr — etwa weil ihr Filter
auf einen einzelnen Dienst umgestellt wurde —, ist das seit 04.10.2026 rot; vorher erschien
für sie dann gar keine Zeile. Die zwei übrigen Regeln zählen eine Kennzahl und kommen in
dieser Prüfung nicht vor.

Kommt eine Alarmregel dazu oder wird eine umbenannt: Namen in `ALARM_REGELN` (und, wenn sie
auf einzelne Dienste hört, in `ALARM_REGELN_MIT_DIENSTLISTE`) und in
`docs/ERROR-ALERTING.md` im selben Schritt nachziehen, sonst wird die nächste Auslieferung rot.

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
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --limit=5 --format=json

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
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d

(Der Betriebs-Speicher hält einen Tag; der Aufräumer meldet den Zustand jede
Minute erneut, ein Tag reicht also.)

Erwartet: keine Zeile.

## Rollback-Hebel

Vom schnellsten zum gründlichsten. Der einzige verbliebene Schalter-Hebel ist
`useBeastAdsCall` (3a); er wirkt **ohne Deploy** binnen ~30 Sekunden (Cache-TTL
der Flags).

> **Seit 09.09.2026 (4.8.0):** Die Functions lesen ausschließlich die Geheimnisse mit
> Endung `_EU` (europe-west1). Die alten Namen ohne Endung sind gelöscht. Ein Rollback
> auf eine Fassung vor 4.8.0 (Hebel 4) braucht sie vorher neu, je Geheimnis:
> `gcloud secrets versions access latest --secret=<NAME>_EU --project=malzime | gcloud secrets create <NAME> --data-file=- --replication-policy=user-managed --locations=europe-west1 --project=malzime`,
> danach die IAM-Bindung des Functions-Dienstkontos setzen. (Das frühere
> Kopierskript lief nur in die Gegenrichtung und ist seit 10.09.2026 entfernt.) Der Mistral-Schlüssel vor 4.8.0 ist
> bei Mistral gelöscht; auch dafür den aktuellen Wert nehmen.

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

### 2a. Sprachumschalter aus — ENTFALLEN (10.09.2026)

Der DE/EN-Umschalter ist fest eingebaut (docs/FLAGS.md). Einen schnellen Hebel, nur
ihn abzuschalten, gibt es nicht mehr. Stört er mitten in einem Workshop, bleibt der
Wartungsmodus (Hebel 1) oder der Rückweg auf 4.9.0 — Functions und Webseite
zusammen (Hebel 4, dann 5); dort lässt er sich mit `useSprachumschalter: false`
abschalten. Nur die Webseite zurückzunehmen hilft nicht gezielt (Hebel 5).

### 3. Single-Large-Call aus — ENTFALLEN (10.09.2026)

Dieser Hebel schaltete auf den älteren Drei-Aufruf-Weg (Mistral Large beschreibt,
`mistral-small` profiliert) um. Der Weg ist ausgebaut: Er wurde nicht mehr genutzt,
schaltete bei einer unlesbaren Einstellung sogar von selbst um und schickte dabei
zusätzlich Hersteller und Modell der Kamera an Mistral. Fällt Mistral Large aus,
bekommt der Nutzer eine Fehlermeldung (`blocked.apiError` bzw.
`blocked.overloaded`) und kann es erneut versuchen. Der Notweg für eine längere
Störung ist der Wartungsmodus (Hebel 1).

### 3a. Beast-Werbung im zweiten Aufruf zurückbauen (v2.8)

Seit v2.8 erzeugt ein zweiter, kleiner Mistral-Aufruf die Beast-Werbung — ohne
Bild, damit sie an der Schwachstelle ansetzt statt am Foto. Er ist so gebaut,
dass ein Ausfall folgenlos bleibt: Schlägt er fehl, steht die Werbeliste aus dem
Hauptaufruf. Stilllegen lässt er sich trotzdem ohne Deploy — gebraucht, wenn
die Anfragen pro Minute knapp werden, denn er verdoppelt sie: in
`featureFlags/current` das Feld `useBeastAdsCall` auf `false` setzen (wirkt
binnen ~30 s, Näheres in [FLAGS.md](FLAGS.md)). Zurück: Feld löschen oder auf
`true` setzen.

Falls der Aufruf dauerhaft zurückgebaut werden soll (Code-Rollback): `parallelitaet`
und `queueRatePerSekunde` im Einstellungssatz neu rechnen — vorher ins
Mistral-Dashboard sehen. Kein Deploy nötig; die `satzWache` überträgt die Werte in
die Queue.

**Warum die Dosierung so steht, wie sie steht (Stand 16.09.2026):** Mistral
erlaubt auf der Stufe T1 **15 Aufrufe je 60 Sekunden** (gemessen 08.09.2026:
jede Ablehnung kam genau dann, wenn in den 60 s davor 15 Aufrufe angenommen
waren; abgelehnte zählen nicht mit). Jede Analyse macht zwei Aufrufe (Analyse
+ Beast-Werbung), also wären 7,5 Analysen je Minute die Kante. Die Queue
schickt höchstens **0,1 Analysen pro Sekunde** los (6 je Minute, 12 Aufrufe) —
ein Fünftel Abstand — bei einer Parallelität von **4**. Die Parallelität
deckelt den Anfangsschub (die Queue lässt bis zu 10 Aufträge sofort durch),
die Rate die Dauerlast. Lehnt Mistral trotzdem ab, wartet der Auftrag und
versucht es erneut (Abschnitt „Mistral überlastet“); Ablehnungen sind dadurch
längere Wartezeit, kein Fehler.

Die Geschichte der Zahl: 7 (65 s je Analyse angenommen); ab 30.08.2026 4 und
0,125 — exakt am Limit, und bei Ablehnung nur ein Versuch nach 2 s. Am
08.09.2026 lagen die Aufrufe bei 29 s, 6 von 47 Analysen einer Klasse
scheiterten; danach 3 und 0,1 plus das Wiederholungsnetz. Am 16.09.2026
(199 Analysen, keine Ablehnung, höchstens 12 Aufrufe je Minute) lag die Zeit
vom Einreihen bis zum Ergebnis im Median bei 126 s, 43 von 193 warteten über
drei Minuten. Die Nachrechnung mit den Daten dieses Tages ergab für 4 und 0,1
einen Median um 60 s, im Mittel 2 Ablehnungen, die das Netz auffängt, und
keine gescheiterte Analyse — daher seit 16.09.2026 wieder 4. Rückweg: 3
eintragen.

**Beide Werte stehen im Einstellungssatz und werden automatisch übertragen.**
Wer sie ändert, ändert die laufende Queue — kein Deploy, kein gcloud-Befehl.
Vorher ins Mistral-Dashboard sehen, nicht nach Gefühl entscheiden.

### 3b. Prompt-Caching aus — ENTFALLEN (10.09.2026)

Der Prompt-Zwischenspeicher ist fest eingebaut (docs/FLAGS.md): reine
Kostenmaßnahme ohne Einfluss auf Modell, Ergebnis oder Durchsatz. Ein Verdacht,
dass er an einer Störung beteiligt ist, wird über einen Functions-Rollback
(Hebel 4) geklärt, nicht über einen Schalter.

### 4. Functions-Rollback auf einen früheren Stand (~2 min)

```bash
git fetch --tags
git worktree add /tmp/malzime-rollback vX.Y.Z   # gewünschtes Release-Tag
cd /tmp/malzime-rollback/functions && npm ci
cd /tmp/malzime-rollback && npx firebase deploy --only functions
git worktree remove /tmp/malzime-rollback
```

Das Haupt-Arbeitsverzeichnis bleibt dabei unberührt.

**Nach diesem Notweg stimmt der Fingerabdruck nicht mehr.** Er läuft am
Auslieferskript vorbei und wechselt nur den Server-Code. Die Website — und mit ihr
`build-info.json` — bleibt, wie sie ist, und weist weiter den Server-Stand von VOR
dem Rollback aus. `scripts/pruefe-live.sh` hält den Fingerabdruck gegen das
Repository, nicht gegen den laufenden Server: Es meldet „deckungsgleich", obwohl ein
anderer Server-Code läuft. Die Angabe auf der Seite, welcher Server-Code ausgeliefert
wurde, stimmt in dieser Zeit nicht.

Wieder richtig wird er nur durch eine Auslieferung von Website und Server zusammen:
`./scripts/deploy.sh` ohne Argument. Nur auf diesem Weg entsteht der Fingerabdruck
neu; ein Ziel ohne Website lehnt das Skript deshalb ab (ARCH-2026-10-03-10).

- *Die Störung ist behoben:* den reparierten Stand per PR auf `main` bringen und
  normal ausliefern.
- *Der alte Stand soll vorerst bleiben:* die Änderungen seit dem Release-Tag per PR
  auf `main` zurücknehmen und normal ausliefern. Website und Server stehen dann
  beide auf diesem Stand, und der Fingerabdruck weist ihn aus.

Bis dahin in der Übergabe festhalten, seit wann der Server auf welchem Tag läuft.

**Rollback auf 4.8.2 oder früher (seit 4.9.0, 10.09.2026).** Diese Fassungen
lesen im Einstellungssatz drei Felder, die 4.9.0 entfernt hat
(`describeMaxTokens`, `profileMaxTokens`, `tokenAbstandKleinMs`), und fallen
ohne das Flag `useSingleLargeCall` auf den ausgebauten Drei-Aufruf-Weg zurück.
Ohne Vorbereitung liefe nach dem Rollback keine Analyse (Grund im Protokoll:
„describeMaxTokens fehlt"). Deshalb VOR dem Functions-Deploy, im
Rollback-Arbeitsverzeichnis:

```bash
cd /tmp/malzime-rollback && node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben
```

Das schreibt den Einstellungssatz des Ziel-Stands (die laufende Fassung
ignoriert die zusätzlichen Felder, die Reihenfolge ist also gefahrlos). Dazu in
`featureFlags/current` das Feld `useSingleLargeCall` auf `true` setzen. Die
satzWache meldet den neuen Satz per Push — das ist erwartet.

**Rollback auf 4.9.0 (nach der Auslieferung, die drei Schalter fest eingebaut
hat).** 4.9.0 liest `usePromptCache`, `useLiveText` und `useSprachumschalter`
aus `featureFlags/current`; ein fehlendes Feld heißt dort „aus". Die drei Felder
sind seit 11.09.2026 gelöscht ([FLAGS.md](FLAGS.md)). Vor dem Rollback deshalb
alle drei mit `true` anlegen — ohne sie fehlen nach dem Rollback der
DE/EN-Umschalter und der Live-Text, und der Prompt-Zwischenspeicher ist aus
(höhere Kosten). Für den Betrieb braucht der Einstellungssatz keinen Handgriff:
4.9.0 kennt dieselben Felder, nur `warteschlangeTiefe` steht auf 100 statt 155.
Wird der 4.9.0-Stand später über `scripts/deploy.sh` ausgeliefert, stoppt der
Abgleich (Datenbank 100, Repo 155) — dann vorher im Rollback-Verzeichnis
`node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`.

### 5. Hosting-Rollback

Schnellster Weg: Firebase Console → Hosting → Release-Verlauf → **Rollback**
(ein Klick, stellt den vorherigen Stand wieder her). Alternativ: früheren Stand wie
in Hebel 4 auschecken und `firebase deploy --only hosting`.

**Der Fingerabdruck stimmt danach nicht:** Die zurückgeholte Website weist den
Server-Stand ihrer eigenen Auslieferung aus, während der neuere Server weiterläuft.
Richtig wird die Angabe erst mit der nächsten vollständigen Auslieferung
(`./scripts/deploy.sh` ohne Argument).

**Webseite nur zusammen mit den Functions auf 4.9.0 zurück.** Die
4.9.0-Webseite baut den DE/EN-Umschalter nur, wenn `/api/stats` das Feld
`sprachumschalter: true` liefert; die neuen Functions liefern es nicht mehr. Die
Seite liefe weiter, nur ohne Umschalter. Deshalb bei einem Rückweg auf 4.9.0
zuerst die Functions (Hebel 4), dann die Webseite. Umgekehrt ist unkritisch: Die
neue Webseite liest das Feld nicht (`public/app.js`, `public/js/stats.js`).

### 5a. Schnittstellen zurück auf den Hosting-Weg (nur Hosting-Deploy, seit 09.09.2026)

Seit 09.09.2026 ruft der Browser `enqueue`, `job-status`, `stats`, `errors` und
`telemetry` direkt unter ihren Cloud-Run-Adressen in `europe-west1` auf
(`public/js/api-basis.js`), nicht mehr über die Hosting-Umleitungen. Die
Umleitungen in `firebase.json` bleiben genau für diesen Hebel bestehen.

**Bedingung zum Ziehen:** Nach einem Deploy scheitern Analysen mit CORS- oder
CSP-Fehlern in der Browser-Konsole (`blocked by CORS policy`, `Refused to connect`),
oder die Live-Smoke-Probe „Direktweg" ist rot, während `/api/stats` über
`https://malzi.me` weiter antwortet.

**Schritte (~5 min, kein Function-Deploy):**

1. In `public/js/api-basis.js` `DIREKT_AKTIV` auf `false` setzen.
2. Im Wächter `public/__tests__/api-basis.test.js` die Zusicherung „der direkte
   Weg ist eingeschaltet" auf `false` drehen und im Kommentar den Grund und das
   Datum eintragen — der Test ist absichtlich so gebaut, dass ein stiller Rückbau
   rot wird.
3. `./scripts/deploy.sh hosting` — die Seite ruft danach wieder `/api/…` über
   Hosting auf. Browser mit alter `app.js` im Zwischenspeicher laufen ohnehin
   über die Umleitungen weiter.

**Dieser Weg ist nur offen, solange das Server-Paket unverändert ist.** Vor dem
Hochladen vergleicht `deploy.sh hosting` das Server-Paket des ausgecheckten Standes
mit dem, das die Seite heute ausweist (`https://malzi.me/build-info.json`, Feld
`serverPaket`: jede Datei, die zu Google geht), und bricht bei einer Abweichung ab —
sonst wiese die Seite danach ein Server-Programm aus, das nie hinausging
(ARCH-2026-10-03-10). Für diesen Hebel also nur die zwei Dateien oben ändern, nichts
unter `functions/` — auch nicht `package.json` oder `package-lock.json`. Bricht das
Skript an dieser Stelle ab oder ist die Seite nicht lesbar, gibt es keinen
Notschalter: `./scripts/deploy.sh` ohne Argument liefert Website und Server zusammen
aus. Dasselbe gilt, solange die Seite ihren Server noch in der Form vor dem 05.10.2026
ausweist (nur die Programmdateien): Daran lässt sich das Paket nicht vergleichen, es
gilt als geändert.

Zurück auf den direkten Weg: beides wieder auf `true`, Hosting-Deploy.

## Störungs-Rezepte

### ntfy-Fehleralarm („malziME Function Errors")

Zuerst prüfen, ob es **Scanner-Rauschen** ist: `URIError: Failed to decode param`
stammt von kaputten Bot-Angriffs-URLs, die Antworten sind 4xx — kein Schaden, kein
Handlungsbedarf (so geschehen 2026-07-13). Logs unter Cloud Logging mit
`resource.type="cloud_run_revision"` und `severity>=ERROR` ansehen; nur bei
5xx-Antworten oder echten Stacktraces aus eigenem Code handeln.
Alerting-Aufbau: [ERROR-ALERTING.md](ERROR-ALERTING.md).

### Nachricht „Analyse gescheitert“ (seit 01.10.2026)

Mindestens ein Kind hat nach einer Analyse eine Fehlermeldung gesehen (eine
Nachricht je fünf Minuten, Aufbau in [ERROR-ALERTING.md](ERROR-ALERTING.md)).
Wie viele es waren und welche Meldung sie sahen:

    gcloud logging read 'jsonPayload.alert="analyse-gescheitert"' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d \
      --format='value(timestamp,jsonPayload.grund)'

Was jeder `grund` bedeutet, steht in [ERROR-ALERTING.md](ERROR-ALERTING.md)
(Tabelle unter „Analyse gescheitert“). Weiter je Grund: `blocked.overloaded`
und `blocked.apiError` → unten „Mistral überlastet / 429 / 5xx“ (dort auch die
Warnungen des KI-Aufrufs und `step: "bild-laden"`); `blocked.configMissing` →
[BETRIEBSPROFILE.md](BETRIEBSPROFILE.md); `processing_timeout` → Warnung
`worker-abgestuerzt-verdacht` und Plattform-Fehlerzeilen des Dienstes
`processjob`; `enqueue_failed` → Cloud Tasks prüfen (Warteschlange pausiert,
Rechte); `store_failed` und `enqueue_unerwartet` → Zeilen des Dienstes
`enqueue` (`store-or-create-failed` bzw. `status: "error"`), Speicher und
Firestore prüfen.

### Verdacht auf Absturz-Schleife (Safari: „wiederholt ein Problem aufgetreten")

Die Absturz-Wache (`public/js/absturz-wache.js`, seit v2.12.2) erkennt drei
Starts binnen einer Minute, deren Vorgänger sich nicht sauber abgemeldet hat,
meldet das EINMAL über den Diagnose-Kanal und verwirft den gemerkten Auftrag.
**Entscheidung 2026-08-11: bewusst OHNE eigenen Alarm** — der `errors`-Dienst
ist aus dem Alarmfilter ausgenommen (Anti-Spam), Nachschauen ist der
vereinbarte Weg:

```bash
gcloud logging read 'resource.labels.service_name="errors" AND jsonPayload.phase="absturz-schleife"' \
  --project=malzime --bucket=client-diagnostics --location=europe-west1 --view=_AllLogs --freshness=30d
```

Treffer enthalten in `errorDetail` die Anzahl der Starts, die zuletzt
erreichte Phase (`letztePhase`) und ob ein Auftrag offen war
(`offenerAuftrag`) — die erste echte Spur für die weiterhin ungeklärte
Ursache. Kein Treffer nach einem Workshop heißt: Die Schleife ist dort nicht
aufgetreten. Manuelles Neuladen zählt seit v2.12.3 nicht mehr mit.

### „Bild konnte nicht geöffnet werden" (`error.readFailed`)

Der Browser bekommt die Datei vom Gerät nicht — kein Formatproblem. Stand
16.09.2026: bisher ausschließlich Chrome 151/152 auf Android (Pixeldichte der
Meldungen passt zu Samsung-Galaxy-Geräten), 20 Fälle in 30 Tagen, davon 11 an
einem Workshop-Tag; Samsung Internet war nicht betroffen. Die Seite liest die
Datei zweimal über `arrayBuffer()` und dann über `FileReader` (seit 08.09.2026)
— der zweite Weg hat im Workshop in keinem der 11 Fälle geholfen. Die Ursache
ist noch offen.

**Was die Meldung jetzt mitbringt** (Diagnose-Speicher, 30 Tage): `errorDetail`
(Fehlername), `fileFormat` (vom Browser angegebener Typ), `fileSizeKb`,
`msSeitAuswahl`, `zweiterLeseweg` und seit 16.09.2026 `kopfLesetest`: `ok`
heißt, der Anfang der Datei war lesbar, nur das Ganze nicht (Datei verändert
oder unvollständig); ein Fehlername heißt, das Gerät gibt die Datei gar nicht
heraus (etwa ein Foto, das nur in der Cloud liegt). Übertragen wird nur dieses
Stichwort, nie Bytes.

**Seit 16.09.2026 werden auch diese sichtbaren Meldungen erfasst** (Phase in
Klammern): Datei fehlt (`datei-fehlt`), Datei zu groß (`datei-zu-gross`, mit
Größe), fertig ohne Ergebnis (`ergebnis-leer`), Einreihen ohne Auftragsnummer
(`einreihen-ohne-auftrag`), Auftrag verworfen (`auftrag-verworfen`),
Wiederaufnahme ohne Verbindung (`resume-verbindung`) sowie eine Dateiauswahl,
die ohne Datei zurückkam (`auswahl-leer`, `auswahl-leer-nach-foto` — letzteres
kann auch ein Abbrechen der Auswahl sein).

Nachsehen:

    gcloud logging read 'resource.labels.service_name="errors"' \
      --project=malzime --bucket=client-diagnostics --location=europe-west1 \
      --view=_AllLogs --freshness=30d \
      --format='value(timestamp,jsonPayload.phase,jsonPayload.userAgent,jsonPayload.errorDetail,jsonPayload.zweiterLeseweg,jsonPayload.kopfLesetest)'

### Mistral überlastet / 429 / 5xx

Die Queue puffert Stoßlast. Lehnt Mistral trotzdem ab (429) oder ist es kurz
weg (502, 503, 504), wartet der Auftrag **10, 20, 40 und 80 Sekunden** und
versucht es jeweils wieder (`ueberlastWarteMs`, `ueberlastVersuche` im
Einstellungssatz, seit 08.09.2026). Der Nutzer sieht dabei nur eine längere
Wartezeit. Erst wenn alle Wiederholungen scheitern oder das Restbudget nicht
mehr reicht, sieht er `blocked.overloaded` bzw. `blocked.apiError`. Vorher
gab es eine Wiederholung nach zwei Sekunden — bei 15 Aufrufen je Minute
wirkungslos: Am 08.09.2026 scheiterten so 6 von 47 Analysen einer Klasse.
Bei anhaltender Störung: Mistral-Status und **Account-Dashboard** prüfen
(Limits unterscheiden sich drastisch je Modellversion — immer das Dashboard,
nicht Code-Kommentare). Notfalls Wartungsmodus (Hebel 1).

Wie oft das Netz greift (eine Zeile je Wiederholung, mit Wartezeit und einer
etwaigen Retry-After-Angabe von Mistral):

    gcloud logging read 'jsonPayload.step="mistral-wiederholung"' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d \
      --format='value(timestamp,jsonPayload.status,jsonPayload.versuch,jsonPayload.wartezeitMs,jsonPayload.retryAfter)'

Nachsehen, welche Analysen trotz aller Wiederholungen scheiterten (Feld
`wiederholungen` sagt, wie viele es waren; `ursache` nennt bei einem
Verbindungsabriss den Grund, den Node.js liefert — den Code und, nur wenn er
einer festen bekannten Meldung entspricht, den Kurztext; nie Adressen. Beispiel:
`UND_ERR_SOCKET` / „other side closed“ = die Gegenstelle (Mistral oder das
vorgeschaltete Netz von Cloudflare) hat die Verbindung beendet):

    gcloud logging read 'jsonPayload.step="mistral-single-large-details" AND severity=WARNING AND jsonPayload.status=("error" OR "nachfrage-gescheitert")' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d --format='value(timestamp,jsonPayload.attempt,jsonPayload.error,jsonPayload.ursache.code,jsonPayload.ursache.text,jsonPayload.wiederholungen)'

(`attempt`: `first` = erster Aufruf, `neuversuch` = nach einem Abriss,
`retry` = Nachfrage nach fehlenden Karten. Ob das Kind dadurch eine
Fehlermeldung sah, sagt nur die Zeile `analyse-gescheitert` oben.)

**Verbindungsabriss (seit 01.10.2026).** Reißt die Verbindung zu Mistral ab
(`error` = „terminated“ oder „fetch failed“), rettet das Programm zuerst einen
schon fast fertigen Text; sonst fragt es EINMAL neu (Warnung
`abbruch-neuversuch`). Auf dem Bildschirm verschwindet dabei der halbe Text des
ersten Versuchs, und der neue tippt von vorn. Erst wenn das Kind am Ende eine
Fehlermeldung sieht, kommt die Nachricht „Analyse gescheitert“; mehr als drei
Abrisse in 24 Stunden melden sich als „KI-Verbindung bricht gehäuft ab“.
Scheitert das Laden des Fotos endgültig, steht eine Warnung mit
`step: "bild-laden"` (Feld `fehler`) im Protokoll. Wie oft Abrisse vorkommen:

    gcloud logging read 'jsonPayload.status="abbruch-neuversuch"' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d --format='value(timestamp,jsonPayload.ursache.code,jsonPayload.ursache.text)'

(Beide Abfragen sehen einen Tag zurück — länger hält der Betriebs-Speicher
nicht. Für Wochenvergleiche von Dauer und Wiederholungen zählt die Zeile `mistral-single-large` im
Diagnose-Speicher, siehe „Logs und Aufbewahrung".)

### Kinderschutz-Filter: Was hat er gefunden? (seit 09.09.2026)

Der Filter (`functions/src/minor-safety.js`) ist eine Wortliste
(`functions/src/minor-safety-woerter.js`). Er streicht einen Werbeeintrag,
wenn darin ein Wort der Liste steht: bei allen zu Pornografie, Waffen und
Extremismus, bei möglicherweise Minderjährigen zusätzlich zu Alkohol, Tabak,
Wetten, Kredit, Diät, Schönheits-OP und Drogen (Entscheidung vom 04.10.2026:
Drogen werden bei möglicherweise Minderjährigen wie Alkohol behandelt). Treffer
im Fließtext meldet er, ohne dort etwas zu streichen. Ein Werbeeintrag ohne
Listenwort geht durch und hinterlässt keine Spur im Log; was die Liste fängt
und was nicht, zeigt die Prüfreihe
`functions/src/__tests__/minor-safety-woerter.test.js`.
„Möglicherweise minderjährig“ heißt: Untergrenze der Altersschätzung bis
`SCHUTZ_BIS` (mit Puffer) oder ein Alter, das sich nicht lesen ließ. Im Log
stehen Anzahl und Grund der Treffer, dazu die Anzahl der gezeigten
Werbeeinträge je Modus; welches Wort in welchem Feld stand, seit 27.09.2026
nicht mehr (der Datenschutztext nennt nur, ob ein Wort vorkam). Die Zeile
liegt 30 Tage im Diagnose-Speicher:

    gcloud logging read 'jsonPayload.step="minor-safety" AND jsonPayload.minderjaehrig=true' \
      --project=malzime --bucket=client-diagnostics --location=europe-west1 \
      --view=_AllLogs --freshness=30d \
      --format='value(timestamp,jsonPayload.alter,jsonPayload.alterBis,jsonPayload.alterUnlesbar,jsonPayload.entfernt,jsonPayload.gruende,jsonPayload.durchgerutscht,jsonPayload.werbung)'

Lesart:

- `alter` ist die Untergrenze der Schätzung, `alterBis` das obere Ende der
  Spanne — beides Schätzung, nicht das wahre Alter. `alterBis` gibt es ab der
  Auslieferung mit dem CHANGELOG-Eintrag
  „Kinderschutz-Protokoll mit oberem Ende der Altersschätzung“; ältere Zeilen
  haben das Feld nicht. `null` heißt: kein oberes Ende in der Angabe (keine
  Zahl, nur ein Kategoriewort, oder ein Jahrzehnt wie „Ende zwanzig“). Wie
  das obere Ende gelesen wird, steht bei `obereAltersgrenze` in
  `functions/src/alters-auslese.js`. `alterBis` entscheidet über nichts;
  Stufe 2 hängt wie bisher an `alter` und am lesbaren Alter.
- Für die Frage „schließt die Spanne ein bekanntes Alter ein?“ nicht auf
  `minderjaehrig=true` filtern — sonst fehlen gerade die Zeilen, deren Spanne
  ein Kind sicher verfehlt (Untergrenze über der Schutzgrenze):

      gcloud logging read 'jsonPayload.step="minor-safety"' \
        --project=malzime --bucket=client-diagnostics --location=europe-west1 \
        --view=_AllLogs --freshness=30d \
        --format='value(timestamp,jsonPayload.alter,jsonPayload.alterBis)'
- `minderjaehrig=true` heißt „Stufe 2 greift“. Ab der Auslieferung der
  Puffer-Regel (Eintrag „Werbeschutz für Kinder mit Sicherheitspuffer“ im
  CHANGELOG) umfasst das auch Untergrenzen bis 25 und nicht lesbare Alter;
  davor nur Untergrenzen bis 18. Wer Zeiträume vergleicht, zählt deshalb
  `alter` selbst (zum Beispiel unter 19).
- `alterUnlesbar=true` (ab derselben Auslieferung): Im Altersanker und im
  ersten Satz der Alterskarte steht kein lesbares Alter, die Antwort enthält
  aber einen Altersversuch. Die Karte zeigt dann einen festen Satz statt
  eines Alters, und Stufe 2 greift. Anfangs hieß das nur: Vorlage „‹Zahl›“
  abgeschrieben oder ein Alter ganz ohne Zahl (Zahlwörter wie „dreizehn“
  zählen als Zahl). Ab der Auslieferung mit dem CHANGELOG-Eintrag, der mit
  „Steht das Alter eines Kindes hinter „ca.““ beginnt, zählt auch ein Alter
  oder ein Kindwort, das erst im Beleg-Satz steht, jede Zahl bis zur
  Schutzgrenze irgendwo in der Alterskarte und „jung“ — auch bei
  Erwachsenen, bei denen die KI kein Alter nennt. Der Wert kommt seither häufiger vor; Zahlen davor und
  danach nicht miteinander vergleichen. Was genau zählt, steht in
  `docs/SECURITY-MODEL.md` (Abschnitt vom 17.09.2026, Punkt 3).
- `entfernt` zählt gestrichene Werbeeinträge, `durchgerutscht` Treffer im
  Profiltext oder in einer Kategorie-Karte (nur gemeldet); `gruende` und
  `durchgerutschtGruende` sagen, ob die Treffer aus der Liste „immer“ oder
  „minor“ stammen. Zeilen bis zur Auslieferung mit dem CHANGELOG-Eintrag
  „Weniger Angaben im Diagnose-Protokoll“ tragen zusätzlich `entfernte` und
  `durchgerutschte` mit Feld und Wort. Ob die Sperrliste zu grob ist, lässt
  sich danach nur mit eigenen Fotos nachstellen.
- `entfernt` und `durchgerutscht` zählen Treffer der Wortliste und hängen
  deshalb an ihrem Umfang. Ab der Auslieferung mit dem CHANGELOG-Eintrag
  „Werbe-Ideen zu Alkohol, Waffen und Co. werden verlässlicher gestrichen“
  (die Liste liegt seither in `functions/src/minor-safety-woerter.js`) kennt
  sie mehr Wörter, das Thema Drogen und einige Wörter nur noch als
  Werbe-Eintrag. Zahlen davor und danach nicht miteinander vergleichen.
- `durchgerutscht` zählt Listenwörter, keine Aussagen: „Du trinkst keinen
  Alkohol.“ zählt wie „Du trinkst Alkohol.“ Wörter, die im Satz meist
  Redewendung oder Tunwort sind („wieder wett“, „schulden“, „rauchen“, „deine
  Droge“, „Lottogewinn“, „ein Jackpot“, „I bet“), gelten nur als Werbe-Eintrag
  und werden im Fließtext nicht gezählt; „alkoholfrei“ ist ausgenommen. Ein
  Anstieg heißt deshalb nur, dass die KI öfter Wörter der Liste schreibt — ob
  sie dabei eine Regel des Prompts bricht, zeigt nur das Nachstellen mit
  eigenen Fotos.
- `werbung` unter 8 heißt beim Beast-Modus nur dann „mehr als zwei Einträge
  gestrichen“, wenn der zweite Werbe-Aufruf geliefert hat (zehn Einträge
  angefordert). Sonst stammt die Liste wie die Standard-Liste aus dem
  Hauptaufruf mit sechs bis acht Einträgen — dort zeigt nur `entfernt`, ob
  gestrichen wurde.

### »betriebswerte-wiederholt-nicht-lesbar« — der Aufräumer kommt nicht an die Betriebswerte

**Was passiert ist:** Der Aufräumer liest jede Minute den Einstellungssatz
(`config/betriebsprofil`). Kam er in FÜNF Läufen hintereinander nicht heran,
meldet er das mit `severity: ERROR` und der Anzahl der Läufe in Folge — und
zwar jede Minute erneut, bis es wieder geht. Weniger Läufe in Folge sind nur
Warnungen (`reap-query-ohne-betriebswerte:<abfrage>`; `…:letzter-stand`, wenn
der Aufräumer mit dem zuletzt gültig gelesenen Satz weiterarbeitet). Die Grenze lag bis
07.09.2026 bei einem Lauf, dann bei zwei, seit 10.09.2026 bei fünf: Beide Male
hatte ein kurzer Hänger Alarm ausgelöst, obwohl der nächste Lauf gesund war und
niemand betroffen. Am 10.09. beantwortete Firestore laut Googles eigenen
Messwerten jede Anfrage in höchstens 0,15 s — die zwei Sekunden gingen auf dem
Weg zwischen Function und Datenbank verloren, nicht in der Datenbank.

**Ist das schlimm?** Fünf Minuten ohne frisch gelesene Betriebswerte heißen:
Firestore antwortet nicht in zwei Sekunden, oder das Dokument ist weg. Zwei
Fälle:

- Der Satz war schon einmal gültig gelesen und ist nur gerade nicht lesbar
  (Warnungen `…:letzter-stand`): Einlass, Analysen und Aufräumer arbeiten mit
  dem zuletzt gelesenen Satz weiter. Eine Änderung am Satz kommt in dieser Zeit
  nicht an.
- Es gibt keinen gültigen Satz (Dokument weg oder abgelehnt, oder die Instanz
  hat nie einen gelesen): Dann laufen keine Analysen — jede betroffene meldet
  sich sofort selbst als Fehler (`kein-einstellungssatz` in `process-job`).
  Wartende und hängende Aufträge werden in dieser Zeit nicht abgeräumt, ihr
  Platz im Stundenfenster bleibt belegt. Gelöscht wird weiter, nach den festen
  Fristen der Datenschutzerklärung (jeder Auftrag samt Foto nach 2 Stunden, ein
  abgeholtes Ergebnis nach 15 Minuten) — diese zwei Fristen hängen nicht am
  Einstellungssatz. Dasselbe steht in den Nachrichten der Wachen („KEIN
  gueltiger Einstellungssatz“, „UNGUELTIG“).

Dieser Alarm hier ist die Reserve für die Zeit, in der niemand analysiert.

**Was tun:** Firestore-Status und das Dokument prüfen
(`scripts/betriebsprofil-vergleichen.js` zeigt, ob es da ist und zum Repo
passt). Ein fehlendes oder abgelehntes Dokument meldet `betriebsprofil.js`
weiterhin sofort als ERROR — das heilt sich nicht von selbst.

Prüfen von Hand:

    gcloud logging read 'jsonPayload.error="betriebswerte-wiederholt-nicht-lesbar"' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d

Erwartet: keine Zeile. Die Warnungen dazu (einzelne Ausrutscher) zählen — nach
Minuten, denn ein Lauf ohne Betriebswerte erzeugt bis zu drei Warnungen in
derselben Minute (je eine für die Abfragen nach verlassenen, hängenden und
überfälligen Aufträgen; eine einzige, wenn der letzte Stand weiter gilt) und
zählt als EIN Lauf:

    gcloud logging read 'jsonPayload.warning:"reap-query-ohne-betriebswerte"' \
      --project=malzime --bucket=betrieb-eu --location=europe-west1 --view=_AllLogs --freshness=1d --format='value(timestamp)' | cut -c1-16 | sort -u

### »notbremse-gegriffen« — der Stundenzähler ist ausgefallen

**Was passiert ist:** Der reguläre Zähler kam nicht durch (Datenbanksperre bei
Andrang), und das Netz hat übernommen — es hat denselben Zählerstand ohne Sperre
gelesen (seit 01.09.2026; vorher zählte es Auftrags-Dokumente, siehe
BIZ-2026-09-01-01) und **blockiert**, weil das wirksame Limit erreicht war.

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

Erst nachsehen, **was** rot ist: `node scripts/audit-gate.mjs functions .` (läuft
lokal identisch zur CI, prüft beide Bäume mit allen Abhängigkeiten einschließlich
der Werkzeuge und nennt Paket, Advisory und Kette).

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

### Nachtlauf „Sicherheit nachts" rot

Der Workflow `.github/workflows/sicherheit-nachts.yml` läuft täglich um 03:43 UTC.
Ist auf `main` einer seiner Prüf-Jobs rot, kommt ein ntfy-Push mit Stufe „urgent"
(Titel „malziME: Sicherheit nachts ROT", Link zum Lauf; Einrichtung in
`docs/ERROR-ALERTING.md`). Die drei Prüf-Jobs; der Name des roten Jobs sagt, was zu
tun ist:

| Roter Job | Bedeutung | Was tun |
|---|---|---|
| `npm-luecken` | Neue High/Critical-Lücke in einem npm-Paket (beide Bäume, auch Werkzeuge) | Wie „Audit-Gate rot" oben. Oft kommt Dependabot binnen eines Tages mit einem PR; sonst selbst anheben |
| `mitgelieferte-bibliotheken` | Veröffentlichte Herstellermeldung zu einer Bibliothek unter `public/lib` oder zum selbst betriebenen ntfy-Server; ein neuer Ordner unter `public/lib` ohne Beobachtung; oder **VERALTET**: für den ntfy-Server gibt es seit mehr als 30 Tagen eine neuere Fassung (sein Hersteller führt keine Sicherheitsmeldungen, Korrekturen stehen nur in den Versionshinweisen) | Betroffen: Bibliothek neu bauen (libheif, siehe unten) oder neu kopieren. **Unklar**: am Quelltext des Herstellers klären; ist unser Stand nachweislich nicht betroffen, begründeter Eintrag mit Ablaufdatum in `.github/fremd-meldungen-ausnahmen.json`. **VERALTET**: Versionshinweise lesen, den Dienst über seinen eigenen Bauweg auf die neue Fassung heben und im selben Zug die erste Zeile von `.github/fremd-dienste/ntfy/VERSION` nachziehen (`scripts/verify-infrastructure.sh` hält sie gegen den laufenden Dienst); zurückstellen nur mit begründetem Eintrag `FASSUNG-<neue Fassung>` und Ablaufdatum in derselben Ausnahmeliste |
| `abkuendigungen` | GitHub meldet an einem Lauf auf main einen abgekündigten Baustein oder eine Frist | Betroffene Action anheben (mit SHA-Pin, Release-Notes lesen). Ist bewusst nichts zu tun, begründeter Eintrag mit Ablaufdatum in `.github/abkuendigungen-ausnahmen.json` |

„MESSUNG NICHT DURCHFÜHRBAR" (Rückgabewert 2) ist kein Fund, aber auch kein
bestandener Lauf: meist eine Störung der GitHub-API. Lauf von Hand neu starten
(`gh workflow run sicherheit-nachts.yml`); bleibt es rot, die Meldung lesen.

Lokal prüfen: `GH_TOKEN=$(gh auth token) node scripts/pruefe-fremd-meldungen.mjs`
bzw. `… node scripts/pruefe-abkuendigungen.mjs`.

**Kommt nie ein Alarm, heißt das nicht „alles gut".** Zwei Wege, auf denen der
Schutz still ausfällt, und was sie auffängt:

- *Der Nachtlauf läuft nicht* (GitHub schaltet geplante Workflows in öffentlichen
  Repositories nach 60 Tagen ohne Aktivität ab, verwirft unter Last gelegentlich
  geplante Läufe, oder die Datei ist für GitHub unlesbar). `scripts/deploy.sh`
  verlangt auf `main` einen Nachtlauf, der wirklich gelaufen ist — mit der
  ausgelieferten Fassung von `sicherheit-nachts.yml` und nicht älter als
  `NACHT_GRENZE_MINUTEN` in `scripts/deploy.sh`; die Kriterien stehen in
  `docs/SECURITY-MODEL.md`. Geprüft wird nicht die Farbe: Ein roter Nachtlauf hat
  Alarm gegeben. Fehlt ein solcher Lauf, bricht das Skript ab; dann: `gh workflow run
  sicherheit-nachts.yml`, abwarten (rund eine Minute), erneut deployen.

  **Dieser Auffang hält einen stehenden Zeitplan nicht an.** Dem Riegel genügt auch
  ein von Hand gestarteter Lauf, und die Auslieferkette startet einen fehlenden Lauf
  selbst. Zwei Fälle sind deshalb zu trennen:

  - *Die Fassung von `sicherheit-nachts.yml` hat sich geändert.* Der Handstart ist
    richtig: nach dem Merge und der grünen Pipeline des Merge-Commits einmal von
    Hand starten, sonst bricht der Deploy ab.
  - *Der Lauf nach Zeitplan fehlt oder ist alt.* Ist der jüngste Lauf, den GitHub
    selbst nach Zeitplan gestartet hat, älter als `NACHT_ZEITPLAN_GRENZE_MINUTEN`
    (ebenfalls nur in `scripts/deploy.sh`), liefert das Skript aus, setzt aber einen
    Kasten „ACHTUNG: Der Nachtlauf … läuft nicht nach Zeitplan" ins Protokoll — vor
    dem Hochladen und noch einmal am Ende. Dann unter „Actions" nachsehen, ob der
    Workflow abgeschaltet ist, und ihn einschalten. Wer die Auslieferung fährt, gibt
    diese Meldung weiter; ein Handstart allein behebt die Ursache nicht.

  Zwischen zwei Auslieferungen fällt ein ausbleibender Nachtlauf weiterhin nur durch
  die ausbleibende Monatsprobe auf (nächster Punkt; bewusst getragen,
  `docs/SECURITY-MODEL.md`).
- *Der Alarmweg ist kaputt* (Secret, ntfy-Server, Thema). Am 1. jedes Monats kommt
  eine Probe aufs Handy. Meldet sich das Handy nicht von selbst, in der ntfy-App
  nachsehen — der Weckruf kann ausbleiben (`docs/ERROR-ALERTING.md`, „Wenn der Push
  nicht weckt"); steht die Probe auch dort nicht, ist der Weg gestört. Von Hand:
  `gh workflow run sicherheit-nachts.yml -f alarmprobe=true`.

**Einmalig nach dem Zusammenführen des Sicherheitspakets (PR #294):** Auf `main`
gibt es noch keinen Nachtlauf, der Deploy bricht deshalb ab, bis einer gelaufen
ist. In der Deploy-Kette nach dem Merge und NACH der grünen Pipeline des
Merge-Commits (sonst liest der Job `abkuendigungen` noch die alte Warnung zu
setup-python 5): `gh workflow run sicherheit-nachts.yml -f alarmprobe=true`
starten — das belegt zugleich den Alarmweg Ende-zu-Ende; der Empfang der Probe
wird beim Empfänger bestätigt.

### HEIC-Dekoder (libheif) neu bauen

Der Dekoder unter `public/lib/libheif/` wird aus den Original-Quellen der
Hersteller gebaut — Rezept `scripts/libheif-bauen.sh`, Begründung und die eine
Abweichung vom Herstellerweg stehen in dessen Kopf. Anlass für einen Neubau ist
meist ein roter Job `mitgelieferte-bibliotheken` im Nachtlauf.

1. Neue Versionen und Prüfsummen im Skript eintragen (`NEU_LIBHEIF_*`,
   `NEU_LIBDE265_*`). Die Prüfsumme steht auf der Release-Seite des Herstellers
   bei der Datei (GitHub zeigt sie als `sha256:`); zusätzlich selbst nachrechnen.
2. Zweig pushen. Der Workflow `libheif-Bau` baut auf GitHub (feste
   Ubuntu-Version 24.04; am 30.09.2026 dauerte der Job `bauen` 8 bis 10 Minuten)
   und legt das Ergebnis als Artefakt
   `libheif-bau` ab. Der Schritt „Vergleich" ist in diesem Lauf rot — die
   Dateien im Repository sind ja noch die alten.
3. Artefakt holen: `gh run download <lauf-id> -n libheif-bau -D /tmp/libheif`,
   die zwei Dateien nach `public/lib/libheif/` kopieren.
4. `public/lib/libheif/VERSION` neu schreiben (die Zeilen `libheif x.y.z` und
   `libde265 x.y.z` liest der Nachtlauf aus), dazu die Versionsnennungen in
   `THIRD-PARTY.md`, `README.md`, `public/impressum.html` und
   `public/en/legal-notice.html` — ein Test (`lizenzen-vollstaendig.test.js`)
   hält sie gegen die VERSION-Datei.
5. `node scripts/pruefe-fremddateien.mjs --aktualisieren`, dann alle Suiten,
   **einschließlich der Browser-Tests** (`e2e/problemfaelle.test.js` schickt
   echte Samsung- und iPhone-HEIC-Fotos durch den Dekoder).
6. Pushen: Jetzt muss der Workflow `libheif-Bau` grün sein, beide Jobs — `bauen`
   (Vergleich Byte für Byte) und `kontrollbau` (Bauumgebung unverändert). Erst dann
   ist belegt, dass die ausgelieferten Dateien aus dem Rezept stammen.
   `scripts/deploy.sh` verlangt das für den jüngsten Commit, der Dekoder, Rezept oder
   Workflow geändert hat: Der jüngste Lauf dieses Workflows muss abgeschlossen und
   grün sein. Nach dem Zusammenführen läuft er auf `main` noch einmal; `deploy.sh`
   wartet NICHT darauf, sondern bricht ab, solange der Lauf fehlt, noch läuft oder
   rot ist. Die Deploy-Kette wartet deshalb vor dem Wartungsmodus auch auf diesen
   Lauf, nicht nur auf die sechs Pflicht-Checks.

Der Job `kontrollbau` baut bei jedem Lauf zusätzlich die bis 30.09.2026
ausgelieferte Fassung (libheif 1.23.2, libde265 1.0.15) nach und vergleicht sie
mit deren Prüfsumme. Wird er rot, hat sich an der Bauumgebung etwas geändert
(Emscripten-Download, Runner-Abbild). Der Deploy verlangt ihn grün (Schritt 6);
vor einem neuen Bau also erst die Ursache klären.

## Handwerkzeuge (nur von Hand, laufen nie automatisch)

- `node scripts/vorschau.mjs [port]` — lokale Vorschau, die die Umleitungen aus
  `firebase.json` nachbildet (saubere Adressen wie `/impressum`); Vorgabe-Port 8099.
- `sh scripts/simulator-szenarien.sh` — Workshop-Lagen im Emulator mit
  Mistral-Attrappe: ganze Klasse gleichzeitig, volle Warteliste, Umstellung des
  Einstellungssatzes, während Leute warten. Kostet nichts; Voraussetzung und
  Start des Emulators stehen im Kopf des Skripts.
- `sh scripts/lasttest-live.sh <anzahl>` — echte Analysen gegen die Produktion.
  **Kostet Geld**, zählt dauerhaft in der öffentlichen Statistik mit und
  verbraucht das Stundenlimit. Nur mit Freigabe; nach einem Deploy genügt
  `sh scripts/lasttest-live.sh 1` als Beweis, dass eine echte Analyse durchläuft.

## Logs und Aufbewahrung

Seit 09.09.2026 liegen alle Logs, die wir selbst steuern, in `europe-west1`.
Die Standard-Weiche `_Default` zeigt nicht mehr auf Googles globale Ablage,
sondern auf unseren Speicher `betrieb-eu`. **Folge für jede Abfrage:** `gcloud
logging read` findet ohne Speicher-Angabe nichts mehr. Jedes Rezept in diesem
Buch nennt deshalb `--bucket=… --location=europe-west1 --view=_AllLogs`; ein
leeres Ergebnis ohne diese Angaben ist ein Messfehler, kein Befund.

| Speicher | Standort | Aufbewahrung | Inhalt |
|---|---|---|---|
| `betrieb-eu` (Ziel der Weiche `_Default`) | europe-west1 | **1 Tag** — bewusst kurz | Programmausgaben der Functions (Request-ID, Schritt, Status, Token-Zahlen), Aufräumer- und Zeitplan-Läufe. Cloud-Run-Request-Logs, der einzige IP-Träger, sind per Ausschluss `exclude_run_requests_ip` gar nicht erst darin |
| `client-diagnostics` | europe-west1 | 30 Tage | anonyme `client-error`/`client-telemetry`-Einträge sowie zwei Server-Zeilen ohne Personenbezug, die `scripts/log-sink-analyse-zeilen.sh` in den Filter setzt: `mistral-single-large` (Dauer und Wiederholungen; seit 12.08.2026, Token-Zahlen, Modell und Status seit 26.09.2026 nur noch in `mistral-single-large-details` im Betriebs-Speicher; höchstens eine Zeile je Analyse ab der Auslieferung mit dem CHANGELOG-Eintrag „Weniger Angaben im Diagnose-Protokoll“) und `minor-safety` (geschätztes Alter, Anzahl und Grund der Sperrwort-Treffer, Werbe-Anzahl; seit 09.09.2026; Feld und Wort der Treffer nur bis zu derselben Auslieferung; „Alter nicht lesbar“ ja/nein ab der Auslieferung der Puffer-Regel; oberes Ende der geschätzten Spanne ab der Auslieferung mit dem CHANGELOG-Eintrag „Kinderschutz-Protokoll mit oberem Ende der Altersschätzung“) |
| `_Default` (Googles Ablage) | global, nicht änderbar | 1 Tag | seit 09.09.2026 **leer** — bekommt nichts mehr; existiert weiter, weil Google sie nicht löschen lässt |
| `_Required` (Googles Pflichtprotokoll) | global, nicht änderbar, gesperrt | 400 Tage | unsere eigenen Verwaltungszugriffe (Kontoadresse, Aufruf-IP unseres Rechners). Keine Nutzerdaten. Google-Vorgabe |

Der Deploy-Riegel (`scripts/verify-infrastructure.sh`) prüft bei jedem Deploy:
Weiche zeigt auf `betrieb-eu`, Aufbewahrung 1 Tag, IP-Ausschluss aktiv,
Diagnose-Filter unverändert.

## Prüfgerät Android (Emulator auf dem Entwicklungsrechner, seit 08.09.2026)

**Warum:** Am 08.09.2026 scheiterten in einer Klasse 8 von 31 Versuchen im
Browser, alle auf Android (HEIC-Fotos, „Datei nicht lesbar"). Unsere Prüfkette
lief bis dahin nur in Desktop-Browsern auf dem Mac. Ein echtes Android-Gerät gibt
es nicht; der Emulator ist der nächste Schritt zu einem. Er läuft lokal, nichts
davon geht in eine fremde Cloud.

**Einrichtung (einmalig, kostenlos, rund 2 GB):**

    brew install --cask android-commandlinetools
    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21
    yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
    $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "emulator" \
      "platforms;android-35" "system-images;android-35;google_apis_playstore;arm64-v8a"
    echo no | $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd \
      -n pruefgeraet -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_7

**Starten (kopflos, bootet in rund 20 s):**

    $ANDROID_HOME/emulator/emulator -avd pruefgeraet -no-window -no-audio -no-boot-anim &
    $ANDROID_HOME/platform-tools/adb wait-for-device shell \
      'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done; echo BOOTED'

Das Gerät ist Android 15 mit Chrome. Die Seite auf dem Mac erreicht der Emulator
unter `http://10.0.2.2:<Port>` (Host-Loopback). Playwright steuert Chrome dort
über `_android` (Attrappen für die Warteschlange wie in `e2e/problemfaelle.test.js`,
kostenfrei). Was der Emulator NICHT kann: Fotos, die nur in Google Fotos in der
Cloud liegen, und Hersteller-Galerien — dafür braucht es ein echtes Gerät.

**Beenden:** `$ANDROID_HOME/platform-tools/adb emu kill`.

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
US-Bucket `malzime_cloudbuild` ist ebenfalls seit 2026-08-11 gelöscht.
**Korrektur 09.09.2026:** „kein Speicher mehr außerhalb Europas" stimmte nicht.
Das Standort-Inventar vom 09.09. fand einen von Google verwalteten Bucket
`<projektnummer>.cloudbuild-logs.googleusercontent.com` in den **USA** mit
neun Build-Protokollen der ntfy-Image-Builds (Februar/Juni 2026), der in der
normalen Bucket-Liste nicht erscheint, sowie die globale Log-Ablage (seit
09.09. leer, siehe „Logs und Aufbewahrung") und die weltweit replizierten
Secrets (seit 09.09. EU-gebunden). Künftige Builds im ntfy-Repo brauchen
`--gcs-log-dir=gs://malzime-cloudbuild-eu/logs`, sonst entsteht der Bucket
neu. Die neun alten Protokolle lassen sich nicht löschen (Löschversuch
09.09.2026: keine Berechtigung, der Speicher gehört Google); Entscheidung und
Begründung stehen in `docs/SECURITY-MODEL.md`, Restrisiko Punkt 10.

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
