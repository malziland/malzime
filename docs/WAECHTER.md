# Die Wächter — was jeder prüft, und warum es ihn gibt

Dieses Projekt hat eine eigene Prüfschicht: die Wächter in der Übersicht
unten, eine Selbstprüfung und mehrere Tests, die Werkzeug statt Anwendung
prüfen. Wie viele es sind, steht nur in der Tabelle — eine Zahl im Fließtext
veraltet mit jedem neuen Wächter. Diese Seite beantwortet für jeden Wächter
vier Fragen — **wovor schützt er, welcher
echte Vorfall hat ihn ausgelöst, was kostet er, welche Ausnahmen kennt er.**

**Warum es diese Seite gibt (01.09.2026):** Die Prüfschicht ist in einer Woche
von 33 auf 41 Dateien gewachsen. Der Anwendungscode ist dabei sauber
geblieben — vier unabhängige Prüfer haben das bestätigt —, aber das Wissen
darüber, *wie die Wächter zusammenhängen*, stand nur in Kommentaren verteilt
über acht Dateien. Wer fragen wollte, wovor ihn `pruefe-mitzieher` schützt,
musste drei Dateien lesen. Das macht ein System unwartbar, nicht seine Größe.

**Regel:** Kein neuer Wächter ohne Zeile in dieser Tabelle. Und beim Eintragen
die Frage: Deckt ein bestehender dieselbe Fehlerklasse schon ab?

---

## Übersicht

| Wächter | Fehlerklasse | Ausgelöst durch | Laufzeit |
|---|---|---|---|
| `pruefe-deploy-riegel.py` | Notschalter, die in der Schlussbilanz fehlen; Pipeline-Einstellung; **Wächter, die niemand mehr aufruft**; **verrutschte Eingaben in `ci.yml`**; **Vertrag der Pipeline-Dateien**: alle fünf Workflows und `dependabot.yml` vollständig per Prüfsumme (frei nur die Versionskennungen der Actions); für `ci.yml` dazu je Pflicht-Job die Prüfbefehle, die er als eigenen Schritt ausführen muss, dieselben sechs Pflicht-Jobs wie in `deploy.sh`, keine stille Entwertung (`continue-on-error`, Bedingung am Job, Schreibrechte); jede Action per Commit-Kennung festgenagelt. **Unter welchen Umständen ein Pflichtbefehl läuft**: am Schritt keine Bedingung, keine eigene Shell, kein anderer Ordner, keine zusätzliche Umgebung; am Job und ganz oben in der Datei kein `defaults` und kein `env` außer dem Festgelegten. **Was hinter einem Pflicht-Schritt steht**: der Inhalt der npm-Skripte in beiden `package.json`, die Einstellung von Jest im Wortlaut, die Einstellungsdateien von Vitest, Playwright, ESLint und Prettier und die Vorbereitungsdatei von Jest per Prüfsumme, keine zweite Einstellungsdatei und keine `.npmrc` daneben, keine eingecheckte Datei in `.gitignore` | Runde 7 (K-7): Ein Prüfschritt liess sich aus der Pipeline entfernen, ohne dass etwas rot wurde. 01.09.: Vier Einfüge-Fehler in `ci.yml` an einem Tag, drei Pipeline-Läufe verbrannt. OPS-2026-10-03-12: Die Zeilen der Server-Tests, der Browser-Modul-Tests, der Browser-Durchläufe und des Server-Lint liessen sich aus `ci.yml` streichen — der Job blieb grün, und Zweigschutz wie Auslieferung sehen nur Name und Ergebnis eines Jobs. Prüfrunde dazu am 04.10.: Der Schritt `npm test` blieb in `ci.yml` wortgleich, während das Skript dahinter in `package.json` nur noch `echo ok` ausführte — kein Wächter und kein Test wurde rot; ebenso bei einem Schritt mit `if: false` und nachgetragener Prüfsumme | rund 50 ms; Proben gegen einen Nachbau in `pipeline-vertrag-script.test.js` |
| `pruefe-workflows-gueltig.mjs` | Workflow-Dateien, die GitHub nicht lesen kann (Zeichen und Größe, die GitHubs Server-Leser ablehnt; YAML-Fehler; fehlendes Grundgerüst) — sie laufen nie, und der Pull Request zeigt den Fehllauf nicht an; mit Positivkontrolle | Befunde K-01 (30.09.2026) und N-01 (01.10.2026): In Proben hätte ein Kommentar mit zu wenig Einzug oder ein Tab vor einem Kommentar den Nachtlauf samt Alarm stillgelegt, und jede Prüfung wäre grün geblieben | 40 ms |
| `pruefe-doppelte-werte.py` | Betriebswerte, die im Code UND im Einstellungssatz stehen | Firestore-Umbau 30.08.: Die Doku nannte Werte, die so nicht liefen | 44 ms |
| `pruefe-i18n-fallbacks.py` | Sichtbarer Text, der von seiner Sprachdatei abweicht | Fund 21.08.: Im HTML stand ein anderer Satz als in der Sprachdatei | 35 ms |
| `pruefe-kopplung.py` | Dateien, die wieder zusammenwachsen; gelöschte Pflicht-Testdateien | Runde 5: Wer `deploy-verhalten.test.js` löscht, sollte auffallen | 32 ms |
| `pruefe-mitzieher.py` | Vergessene Begleitdateien („wer X ändert, muss Y mitziehen") | Runde 1: Ein neues Pflichtfeld ohne die Stellen, die es kennen müssen | 180 ms |
| `pruefe-tote-geduld.py` | Wartezeiten in E2E-Tests über dem Zeitlimit — der Test kann nie durchlaufen | Fund 21.08.; **Runde 8:** er war auf ganzen Abschnitten blind | 48 ms |
| `pruefe-zeitzuender.sh` + `pruefe-zeitzuender.py` | Tests, die an einem festen Datum von selbst rot werden | TEST-2026-08-20-01, belegter Schaden | 80 ms |
| `pruefe-pipeline-schritte.mjs` | **Geänderte Pipeline-Schritte, die lokal nie ausgeführt wurden** | 01.09.: Sieben Fehler in fünf Läufen — jedes Mal war die Datei geprüft und die Umgebung angenommen | wenige Sekunden, nur bei geänderter `ci.yml` |
| `pruefe-auslieferbare-reste.mjs` | Ignorierte Dateien unter `public/`, die Firebase ausliefern würde; Dateien unter `functions/`, die ins Server-Paket gingen und nicht eingecheckt sind (`deploy.sh` ruft ihn seit OPS-2026-10-03-09 bei jeder Auslieferung auf). Seine Paketliste (`--paketliste`) ist zugleich die Liste, die der Fingerabdruck als Server-Paket ausweist: `build-info.mjs` holt sie von hier, `server-paket.test.js` hält die Gleichheit fest | Runde 7 (L-5): Der Sauberkeits-Riegel sieht ignorierte Dateien nicht | 46 ms |
| `pruefe-commit-nachrichten.sh` | Commit-Nachrichten seit `origin/main` mit heiklen Formulierungen (Muster im Skript) — öffentlich und nach dem Push nicht zurücknehmbar | 08.09.: ein Commit-Titel auf main nannte genau das | 20 ms |
| `pruefe-fremddateien.mjs` | Veränderter Fremdcode (exifr, Leaflet, Schriften) | OSS-2026-08-12-22: exifr liest die GPS-Daten, deren Nichtweitergabe die Kernzusage ist | 41 ms |
| `pruefe-vendorierung.mjs` | Bearbeitete Kopien der Audit-Familie unter `scripts/pruefungen/` | Bearbeitet wird die Quelle, nie die Kopie | 57 ms |
| `pruefe-mutationen.mjs` | **Tests, die nichts merken:** Code kaputtmachen, ohne dass ein Test rot wird | Runde 7: Sechs von achtzehn Befunden waren überlebende Mutationen, von Hand gefunden | Minuten — **läuft vorerst nur lokal**, siehe unten |
| `betriebsprofil-vergleichen.js` (Abschnitt 1b von `verify-infrastructure.sh`) | **Einstellungssatz in der Datenbank weicht vom Repo ab** — die Wahrheit liegt in Firestore, das Repo ist die Kopie | OPS-2026-09-01-02 (Audit 01.09.): zwei Tage lang acht abweichende Felder, sieben davon in den Ersatz-Profilen für den Ernstfall; kein Test sah es, weil `satz-gegen-doku` Kopie gegen Kopie prüft | ~1 s, **nur vor dem Deploy** (liest die echte Datenbank; Negativprobe in `verify-infrastructure-script.test.js`) |
| `pruefe-fremd-meldungen.mjs` | **Mitgelieferte Bibliotheken mit veröffentlichter Sicherheitsmeldung** (`public/lib`: Leaflet, exifr, libheif, libde265) — sieht weder Dependabot noch `npm audit`; dazu jeder neue Ordner und jede einzelne Datei unter `public/lib`/`public/fonts` ohne Beobachtung | OSS-2026-09-30-01: Der HEIC-Dekoder lag mit veröffentlichten Herstellermeldungen (libheif 1.23.2, libde265 1.0.15) im Auslieferungsstand, ohne dass etwas anschlug | wenige Sekunden, **nachts** (`sicherheit-nachts.yml`, liest die GitHub-API); der netzfreie Teil `--nur-deckung` zusätzlich in `pruefungen` und vor dem Push; Negativproben einschließlich Netzweg in `fremd-meldungen-script.test.js` |
| `pruefe-abkuendigungen.mjs` | **Abkündigungs- und Fristhinweise von GitHub** an den letzten Läufen auf main (veraltete Actions, Runner-Umstellungen) | OPS-2026-09-30-03: Eine Abkündigungswarnung zu einem Baustein der Pipeline (`setup-python`) stand bei jedem Lauf da, bis GitHub die alte Laufzeit am 23.09.2026 entfernte — die Läufe waren grün, niemand klappte sie auf | wenige Sekunden, **nur nachts** (`sicherheit-nachts.yml`); Negativproben in `abkuendigungen-script.test.js` |

**Alle zusammen (ohne die Mutationsprobe): unter einer Sekunde.** Deshalb
laufen sie vor jedem Push. Die Mutationsprobe braucht je Mutation einen
eigenen Testlauf und läuft deshalb nur in `test-backend`, wo Pakete
installiert sind.

**Was sie am Arbeitsrechner lesen:** Wer das ganze Verzeichnis durchgeht — der
Uhr-Wächter und drei der vendorierten Prüfungen (Fakten-Drift, stiller
Fehlschlag, Tests ohne Zusicherung) —, sieht vor dem Push nur, was git kennt:
eingecheckte und neue Dateien, keine Ordner, die `.gitignore` ausnimmt
(private Berichte, Übergaben, Sicherungen). Der Uhr-Wächter fragt git selbst;
die vendorierten Prüfungen bekommen über `scripts/nur-git-bekannt.py` einen
Spiegel statt des Projektordners. In der Pipeline gibt es diese Ordner nicht —
dort läuft der Aufruf unverändert (TEST-2026-10-04-29).

---

## Die Selbstprüfung

`scripts/selbstpruefung-waechter.sh` beantwortet die Frage, die über allem
steht: **Kann jeder Wächter überhaupt rot werden?** Sie sabotiert dafür
absichtlich das, was er bewacht, und verlangt den erwarteten Rückgabewert —
seit Runde 8 zusätzlich einen passenden Text, weil ein abgestürzter Wächter
sonst als „hat etwas gefunden" durchgeht.

Die erwartete Zahl der Proben steht nur im Skript (`ERWARTETE_PROBEN`) und wird
verglichen: Wer eine Probe entfernt, bekommt „nicht messbar" statt eines
grünen Laufs. Wer eine hinzufügt, muss die Zahl hochsetzen — das ist Absicht.

---

## Die Ausnahmelisten

Jede Ausnahme ist eine Stelle, an der ein Wächter bewusst wegsieht. Sie stehen
verstreut in den Dateien; hier ist die vollständige Liste mit dem Grund.

| Wo | Was ausgenommen ist | Warum |
|---|---|---|
| `pruefe-deploy-riegel.py` → `AUSGENOMMEN` | `pruefe-live.sh` | Werkzeug für Dritte: rechnet den AUSGELIEFERTEN Stand gegen das Repo nach, braucht Netz und Live-Adresse |
| `pruefe-deploy-riegel.py` → `NUR_NACHTS` | `pruefe-fremd-meldungen.mjs`, `pruefe-abkuendigungen.mjs` | Lesen äußere Quellen (GitHub-API). Im Pull Request würde eine neue fremde Meldung jeden unbeteiligten PR blockieren (2026-07-01: alle acht Dependabot-PRs). Ihr Aufruf in `sicherheit-nachts.yml` wird genauso verlangt wie der in `ci.yml` |
| `.github/fremd-meldungen-ausnahmen.json` | einzelne Herstellermeldungen je Bibliothek | Meldungen ohne auswertbare Versionsangabe, bei denen am Quelltext belegt ist, dass unser Stand nicht betroffen ist; Pflichtfelder Begründung und Ablaufdatum, jede Ausnahme steht in jeder Ausgabe |
| `.github/abkuendigungen-ausnahmen.json` | einzelne GitHub-Hinweise (Textmuster) | Hinweise, bei denen bewusst nichts zu tun ist (etwa die Umstellung von `ubuntu-latest`); Pflichtfelder Begründung und Ablaufdatum |
| `pruefe-deploy-riegel.py` → `NUR_PIPELINE` | `pruefe-mutationen.mjs` | Braucht Minuten und installierte Pakete; vor dem Push würde es aus 14 Sekunden Minuten machen |
| `vor-dem-push-script.test.js` → `BEWUSST_DRAUSSEN` | `npm ci`, `npm test`, `npm run test:e2e`, Mutationsprobe | Installation bzw. lange Suiten — die deckt `scripts/pruefstand.sh` ab. Dass die PIPELINE die beiden langen Suiten fährt, hält `LANGE_SUITEN` im selben Test fest: jede als Schritt ihres Pflicht-Jobs |
| `vor-dem-push-script.test.js` → `ANDERS_BENANNT` | `secret-scan-lokal.sh`; der gezielte Testlauf bei geänderter Pipeline | Lokal heisst es anders, die Pipeline prüft dasselbe: Für das eine hat sie den Job `secret-scan` mit der gitleaks-Action, für das andere fährt sie die ganze Server-Suite. Der Test verlangt den genannten Schritt im selben Job |
| `vor-dem-push-script.test.js` → `NUR_LOKAL` | `pruefe-pipeline-schritte.mjs` | Führt geänderte Pipeline-Schritte vor dem Push aus — in der Pipeline liefe er gegen sich selbst |
| `pruefe-deploy-riegel.py` → `JOB_BEDINGUNG_CI` | Der Job `test-e2e` darf eine Bedingung tragen — genau eine | Beim reinen Auslieferungs-Nachtrag entfällt der Browser-Test und steht auf „skipped"; `deploy.sh` wertet das nie als bestanden (`docs/SECURITY-MODEL.md`, „Nachtrag ohne Browser-Test"). Jede andere Bedingung an einem Pflicht-Job ist ein Befund |
| `pruefe-deploy-riegel.py` → `SCHRITT_FESTLEGUNG_CI` | Drei Schritte mit einem Pflichtbefehl tragen mehr als den Befehl: die Zeitzünder-Prüfung des Servers ihren Ordner (`working-directory: .`), die Geheimnis-Suche und die Nachtrag-Erkennung je eine Umgebungsvariable | Der Server-Job läuft in `functions/`, dieses eine Skript in der Wurzel; die gitleaks-Action braucht das Pipeline-Token, `nur-nachtrag.sh` den Vergleichszweig. Jeder andere Wert und jedes weitere `if`, `shell`, `working-directory` oder `env` an einem Schritt mit Pflichtbefehl ist ein Befund — auch mit nachgetragener Prüfsumme |
| `pruefe-deploy-riegel.py` → `JOB_ORDNER_CI`, `JOB_UMGEBUNG_CI` | Der Job `test-backend` läuft in `functions/` (`defaults`); der Job `test-e2e` setzt `HOME` | Der Ordner entscheidet, welche `package.json` ein `npm test` meint; Firefox startet im Container nur mit `HOME=/root`. Jedes andere `defaults` oder `env` an einem Pflicht-Job, und jedes ganz oben in `ci.yml`, ist ein Befund |
| `pruefe-doppelte-werte.py` → Auswertungsregeln | `ANHALTEND_TAGE`, `BLIND_TAGE`, Schwellen der Wachen | Keine Stellschrauben des Betriebs: Sie ändern nicht, wie schnell analysiert wird, sondern ab wann ein Ausfall laut wird |
| `pruefe-mutationen.mjs` → Vorgabewerte | `x \|\| ""`, `port \|\| 5001` | Ein Test dagegen wäre künstlich; er prüfte eine Zeile, nicht ein Verhalten |
| `skript-rechte.test.js` | `scripts/pruefungen/negativprobe/**` | Beispielmaterial für die Prüfungen — absichtlich kaputte Skripte, die niemand ausführt |

---

## Offener Punkt: die Mutationsprobe läuft nur lokal

Sie hat am 01.09.2026 in **drei aufeinanderfolgenden Pipeline-Läufen** den
Pflicht-Check rot gemacht — jedes Mal aus einem Grund der Umgebung, nie wegen
eines echten Befundes: fehlende Pakete im Job, flacher Checkout ohne Historie,
und zuletzt ein `jest`-Aufruf, der dort anders antwortet als lokal.

Zwei der drei Gründe sind behoben und haben eigene Riegel hinterlassen (siehe
`pruefe-deploy-riegel.py`). Der dritte ist offen. Bis er verstanden ist, läuft
das Werkzeug **nur lokal** — dort hat es am selben Tag drei echte Lücken
gefunden, darunter den ungedeckten Riegel gegen Testzugriffe auf die
Produktions-Warteschlange.

Zurück in die Pipeline kommt es, wenn ein Lauf dort nachweislich durchgelaufen
ist. Nicht auf Verdacht: Ein Wächter, der aus Umgebungsgründen rot meldet,
kostet mehr Vertrauen, als er Fehler findet.

## Was diese Schicht NICHT kann

Ehrlich benannt, damit niemand sich darauf verlässt:

- **Sie sieht nichts, was ein Mensch sehen muss.** Ob ein Satz auf dem
  Bildschirm verständlich ist, ob eine Farbe wirkt, ob sich die Bedienung
  richtig anfühlt — dafür gibt es keinen Wächter und kann es keinen geben.
- **Sie prüft den Code, nicht die Wirklichkeit.** Ob die Warteschlange in der
  Produktion wirklich die eingestellten Werte hat, misst
  `verify-infrastructure.sh` gegen die Infrastruktur, nicht der Quelltext.
- **Sie sah lange nicht auf sich selbst.** Bis zum 01.09.2026 prüfte nichts,
  ob `ci.yml` strukturell stimmt. Vier Einfüge-Fehler an einem Tag — Zeilen
  unter dem falschen Schritt — blieben lokal unsichtbar, weil das YAML gültig
  bleibt und alle Tests grün. Sichtbar wurden sie erst, als GitHub die Datei
  ausführte. Das kostete drei Läufe und rund vierzig Minuten. Und bis zum
  04.10.2026 hielt nichts fest, WAS die sechs Pflicht-Jobs ausführen: Ein Job
  ohne seinen Testlauf blieb grün (OPS-2026-10-03-12). Seither gibt es den
  Vertrag der Pipeline-Dateien. Er reicht drei Ebenen tief — der Schritt in
  `ci.yml`, das npm-Skript dahinter, die Einstellung des Werkzeugs — und hat
  vier Grenzen:
  - *Er schützt vor Versehen, nicht vor Absicht.* Wer eine festgeschriebene
    Datei ändert, kann Prüfsumme oder Festlegung mitändern; beides steht dann
    im selben Pull Request. Der Vertrag läuft im Pflicht-Job `pruefungen`,
    seine Gegenprobe (`vor-dem-push-script.test.js`) im Pflicht-Job
    `test-backend`: Fällt einer der beiden Aufrufe weg, meldet es der andere.
    Fallen beide im selben Pull Request weg, sieht es nur noch die
    Vorabprüfung vor dem Push.
  - *Er sieht nicht, was GitHub verlangt.* Welche Checks der Zweigschutz zur
    Pflicht macht, steht bei GitHub (Soll-Zustand: `docs/RUNBOOK.md`, „Branch
    Protection"). Der Vertrag hält `ci.yml` und `deploy.sh` zusammen; kommt
    bei GitHub ein Pflicht-Check dazu oder fällt einer weg, merkt es hier
    niemand.
  - *Für die Einstellungsdateien gibt es nur die Prüfsumme.* Was die Pflicht-Jobs
    ausführen, unter welchen Umständen ihre Schritte laufen, was die npm-Skripte
    tun und womit Jest eingestellt ist, steht im Wächter im Wortlaut — das
    bleibt rot, auch wenn jemand eine Summe nachträgt. Bei `vitest.config.js`,
    `playwright.config.js`, den beiden ESLint-Einstellungen, `.prettierignore`
    und der Vorbereitungsdatei von Jest (`functions/jest.setup.js`) macht eine
    nachgetragene Summe den Wächter wieder grün; die Änderung steht dann im
    Diff, mehr nicht.
  - *Er hält fest, DASS und WOMIT geprüft wird — nicht, WIE VIEL.* Die Tabelle
    zeigt, wer welchen Weg bemerkt, auf dem ein Pflicht-Schritt grün bleibt und
    nichts oder weniger prüft. Gemessen am 04. und 05.10.2026, jede Zeile als
    Commit in einer Wegwerf-Kopie — bis auf die letzten beiden, die aus der
    Bauart folgen. Wo der Vertrag rot ist, wird es auch die Selbstprüfung (eine
    ihrer Proben erwartet einen grünen Riegel); ihre Spalte nennt nur, was sie
    unabhängig davon bemerkt.

    | Weg | Vertrag | Selbstprüfung der Wächter | Sonst |
    |---|---|---|---|
    | Schritt aus `ci.yml` gestrichen, auskommentiert, durch `echo` ersetzt, mit `\|\| true` versehen; sein Wortlaut steht nur noch als Umgebungswert oder Textzeile da | rot | — | — |
    | Schritt mit Bedingung, eigener Shell, anderem Ordner oder zusätzlicher Umgebung; `defaults` oder `env` am Job oder ganz oben | rot, auch mit nachgetragener Summe | — | — |
    | ein zusätzlicher Schritt vor dem Pflichtbefehl, der die Arbeitskopie erst im Lauf umbaut (etwa das npm-Skript überschreibt) | rot, bis die Summe der `ci.yml` nachgetragen ist — weitere Schritte sind in einem Pflicht-Job erlaubt | — | — |
    | npm-Skript entwertet oder verengt (`echo ok`, Filter, nur eine Testdatei, `\|\| true`); ein `pre…`/`post…`-Skript dazu | rot | — | der Prüfstand bricht ab, wenn eine Testreihe gar keine Zahl liefert |
    | Jest-Einstellung nimmt Testdateien heraus | rot | rot, sobald Jest gar keine Tests mehr startet (Probe „die Eichung besteht") | — |
    | Einstellung von Vitest, Playwright, ESLint oder `.prettierignore` geändert; die Vorbereitungsdatei von Jest geändert (`functions/jest.setup.js` — eine Zeile dort kann jeden Test überspringen lassen) | rot, bis die Summe nachgetragen ist | — | nimmt ESLint den ganzen Ordner heraus, wird der Schritt selbst rot |
    | zweite Einstellungsdatei mit Vorrang (`vitest.config.ts`), `.npmrc` mit `script-shell` | rot | — | — |
    | `.gitignore` nennt eingecheckte Dateien (Prettier lässt sie aus) | rot; außerhalb eines git-Repositorys „NICHT GEMESSEN" | — | — |
    | ein Test übersprungen (`.skip`) | **nein** | **nein** | `test-blind.py` wird rot |
    | eine Testdatei gelöscht | **nein** | **nein** | `pruefe-kopplung.py` wird rot — aber nur für die Dateien seiner Liste unverzichtbarer Prüfungen; jede andere fehlt unbemerkt |
    | die Testanzahl schrumpft, ohne dass ein Skript oder eine Einstellung sich ändert | **nein** | **nein** | der Prüfstand stempelt jede Zahl größer null nach `docs/VERIFICATION.md`; ein Rückgang steht dort im Diff, hält aber nichts an |
    | ein ausgetauschtes Paket hinter `jest`, `vitest`, `playwright`, `eslint` oder `prettier` | **nein** | **nein** | Lockfile im Diff, Dependabot |
    | Variablen, die GitHub von außen setzt (Repository- oder Organisations-Variablen) | **nein** | **nein** | stehen nicht im Repository |

- **Sie ist selbst fehleranfällig.** In acht Prüfrunden sassen die meisten
  Befunde nicht in der Anwendung, sondern in dieser Schicht. Zwei Werkzeuge,
  die am 01.09. entstanden, hatten beide schwere Fehler — eines meldete
  falsches Grün. Deshalb die Selbstprüfung, und deshalb diese Seite.
