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
| `pruefe-deploy-riegel.py` | Notschalter, die in der Schlussbilanz fehlen; Pipeline-Einstellung; **Wächter, die niemand mehr aufruft**; **verrutschte Eingaben in `ci.yml`**; **Vertrag der Sicherheits-Workflows** (`sicherheit-nachts.yml`, `libheif-bau.yml` vollständig per Prüfsumme; frei nur die Versionskennungen der Actions) | Runde 7 (K-7): Ein Prüfschritt liess sich aus der Pipeline entfernen, ohne dass etwas rot wurde. 01.09.: Vier Einfüge-Fehler in `ci.yml` an einem Tag, drei Pipeline-Läufe verbrannt | 24 ms |
| `pruefe-workflows-gueltig.mjs` | Workflow-Dateien, die GitHub nicht lesen kann (YAML-Fehler, fehlendes Grundgerüst) — sie laufen nie, und der Pull Request zeigt den Fehllauf nicht an; mit Positivkontrolle | Befund K-01 (30.09.2026): Ein Kommentar mit zu wenig Einzug im Nachtlauf legte ihn samt Alarm still, jede Prüfung blieb grün | 40 ms |
| `pruefe-doppelte-werte.py` | Betriebswerte, die im Code UND im Einstellungssatz stehen | Firestore-Umbau 30.08.: Die Doku nannte Werte, die so nicht liefen | 44 ms |
| `pruefe-i18n-fallbacks.py` | Sichtbarer Text, der von seiner Sprachdatei abweicht | Fund 21.08.: Im HTML stand ein anderer Satz als in der Sprachdatei | 35 ms |
| `pruefe-kopplung.py` | Dateien, die wieder zusammenwachsen; gelöschte Pflicht-Testdateien | Runde 5: Wer `deploy-verhalten.test.js` löscht, sollte auffallen | 32 ms |
| `pruefe-mitzieher.py` | Vergessene Begleitdateien („wer X ändert, muss Y mitziehen") | Runde 1: Ein neues Pflichtfeld ohne die Stellen, die es kennen müssen | 180 ms |
| `pruefe-tote-geduld.py` | Wartezeiten in E2E-Tests über dem Zeitlimit — der Test kann nie durchlaufen | Fund 21.08.; **Runde 8:** er war auf ganzen Abschnitten blind | 48 ms |
| `pruefe-zeitzuender.sh` + `pruefe-zeitzuender.py` | Tests, die an einem festen Datum von selbst rot werden | TEST-2026-08-20-01, belegter Schaden | 80 ms |
| `pruefe-pipeline-schritte.mjs` | **Geänderte Pipeline-Schritte, die lokal nie ausgeführt wurden** | 01.09.: Sieben Fehler in fünf Läufen — jedes Mal war die Datei geprüft und die Umgebung angenommen | wenige Sekunden, nur bei geänderter `ci.yml` |
| `pruefe-auslieferbare-reste.mjs` | Ignorierte Dateien unter `public/`, die Firebase ausliefern würde | Runde 7 (L-5): Der Sauberkeits-Riegel sieht ignorierte Dateien nicht | 46 ms |
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
| `vor-dem-push-script.test.js` → `BEWUSST_DRAUSSEN` | `npm ci`, `npm test`, `npm run test:e2e`, Mutationsprobe | Installation bzw. lange Suiten — die deckt `scripts/pruefstand.sh` ab |
| `vor-dem-push-script.test.js` → `ANDERS_BENANNT` | `secret-scan-lokal.sh` | Die Pipeline hat dafür den eigenen Job `secret-scan` mit gitleaks |
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
  ausführte. Das kostete drei Läufe und rund vierzig Minuten.

- **Sie ist selbst fehleranfällig.** In acht Prüfrunden sassen die meisten
  Befunde nicht in der Anwendung, sondern in dieser Schicht. Zwei Werkzeuge,
  die am 01.09. entstanden, hatten beide schwere Fehler — eines meldete
  falsches Grün. Deshalb die Selbstprüfung, und deshalb diese Seite.
