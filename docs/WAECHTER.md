# Die Wächter — was jeder prüft, und warum es ihn gibt

Dieses Projekt hat eine eigene Prüfschicht: elf Wächter, eine Selbstprüfung
mit 24 Proben und mehrere Tests, die Werkzeug statt Anwendung prüfen. Diese
Seite beantwortet für jeden Wächter vier Fragen — **wovor schützt er, welcher
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
| `pruefe-deploy-riegel.py` | Notschalter, die in der Schlussbilanz fehlen; Pipeline-Einstellung; **Wächter, die niemand mehr aufruft**; **verrutschte Eingaben in `ci.yml`** | Runde 7 (K-7): Ein Prüfschritt liess sich aus der Pipeline entfernen, ohne dass etwas rot wurde. 01.09.: Vier Einfüge-Fehler in `ci.yml` an einem Tag, drei Pipeline-Läufe verbrannt | 24 ms |
| `pruefe-doppelte-werte.py` | Betriebswerte, die im Code UND im Einstellungssatz stehen | Firestore-Umbau 30.08.: Die Doku nannte Werte, die so nicht liefen | 44 ms |
| `pruefe-i18n-fallbacks.py` | Sichtbarer Text, der von seiner Sprachdatei abweicht | Fund 21.08.: Im HTML stand ein anderer Satz als in der Sprachdatei | 35 ms |
| `pruefe-kopplung.py` | Dateien, die wieder zusammenwachsen; gelöschte Pflicht-Testdateien | Runde 5: Wer `deploy-verhalten.test.js` löscht, sollte auffallen | 32 ms |
| `pruefe-mitzieher.py` | Vergessene Begleitdateien („wer X ändert, muss Y mitziehen") | Runde 1: Ein neues Pflichtfeld ohne die Stellen, die es kennen müssen | 180 ms |
| `pruefe-tote-geduld.py` | Wartezeiten in E2E-Tests über dem Zeitlimit — der Test kann nie durchlaufen | Fund 21.08.; **Runde 8:** er war auf ganzen Abschnitten blind | 48 ms |
| `pruefe-zeitzuender.sh` + `pruefe-zeitzuender.py` | Tests, die an einem festen Datum von selbst rot werden | TEST-2026-08-20-01, belegter Schaden | 80 ms |
| `pruefe-auslieferbare-reste.mjs` | Ignorierte Dateien unter `public/`, die Firebase ausliefern würde | Runde 7 (L-5): Der Sauberkeits-Riegel sieht ignorierte Dateien nicht | 46 ms |
| `pruefe-fremddateien.mjs` | Veränderter Fremdcode (exifr, Leaflet, Schriften) | OSS-2026-08-12-22: exifr liest die GPS-Daten, deren Nichtweitergabe die Kernzusage ist | 41 ms |
| `pruefe-vendorierung.mjs` | Bearbeitete Kopien der Audit-Familie unter `scripts/pruefungen/` | Bearbeitet wird die Quelle, nie die Kopie | 57 ms |
| `pruefe-mutationen.mjs` | **Tests, die nichts merken:** Code kaputtmachen, ohne dass ein Test rot wird | Runde 7: Sechs von achtzehn Befunden waren überlebende Mutationen, von Hand gefunden | Minuten — läuft nur in der Pipeline |

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

**24 Proben, elf Wächter.** Die erwartete Zahl steht im Skript und wird
verglichen: Wer eine Probe entfernt, bekommt „nicht messbar" statt eines
grünen Laufs. Wer eine hinzufügt, muss die Zahl hochsetzen — das ist Absicht.

---

## Die Ausnahmelisten

Jede Ausnahme ist eine Stelle, an der ein Wächter bewusst wegsieht. Sie stehen
verstreut in den Dateien; hier ist die vollständige Liste mit dem Grund.

| Wo | Was ausgenommen ist | Warum |
|---|---|---|
| `pruefe-deploy-riegel.py` → `AUSGENOMMEN` | `pruefe-live.sh` | Werkzeug für Dritte: rechnet den AUSGELIEFERTEN Stand gegen das Repo nach, braucht Netz und Live-Adresse |
| `pruefe-deploy-riegel.py` → `NUR_PIPELINE` | `pruefe-mutationen.mjs` | Braucht Minuten und installierte Pakete; vor dem Push würde es aus 14 Sekunden Minuten machen |
| `vor-dem-push-script.test.js` → `BEWUSST_DRAUSSEN` | `npm ci`, `npm test`, `npm run test:e2e`, Mutationsprobe | Installation bzw. lange Suiten — die deckt `scripts/pruefstand.sh` ab |
| `vor-dem-push-script.test.js` → `ANDERS_BENANNT` | `secret-scan-lokal.sh` | Die Pipeline hat dafür den eigenen Job `secret-scan` mit gitleaks |
| `pruefe-doppelte-werte.py` → Auswertungsregeln | `ANHALTEND_TAGE`, `BLIND_TAGE`, Schwellen der Wachen | Keine Stellschrauben des Betriebs: Sie ändern nicht, wie schnell analysiert wird, sondern ab wann ein Ausfall laut wird |
| `pruefe-mutationen.mjs` → Vorgabewerte | `x \|\| ""`, `port \|\| 5001` | Ein Test dagegen wäre künstlich; er prüfte eine Zeile, nicht ein Verhalten |
| `skript-rechte.test.js` | `scripts/pruefungen/negativprobe/**` | Beispielmaterial für die Prüfungen — absichtlich kaputte Skripte, die niemand ausführt |

---

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
