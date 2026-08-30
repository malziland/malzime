# Nachtlauf 30./31.08.2026 — Übergabe

**Auftrag:** Autonom bis in der Früh, bis Push und PR, **kein Deploy**.
Gründlich mit mehreren Prüfrunden, „nicht wieder einen Morgen fertig haben und
dann zwölf Stunden Fehler suchen".

**Alles liegt in einem Pull Request: #235.** Nichts ist ausgeliefert.

---

## Was fertig ist

### 1. Trockenlauf vor jeder Auslieferung

`firebase deploy --dry-run` läuft jetzt als Riegel vor dem echten Deploy, in
derselben Reihenfolge und mit denselben Zielen. **Gemessen: 28 Sekunden** (3 s
Firestore, 25 s Hosting/Functions).

**Anlass:** Sechs abgebrochene Auslieferungen an einem Tag — falsches
Firestore-Ziel, Firestore im Paket statt allein, die satzWache ohne
Datenbank-Angabe, der Infrastruktur-Wächter gegen eine feste Handbuch-Zahl, ein
verbotener Formwechsel, und zuletzt ein unsauberer Arbeitsbaum als Folge des
vorigen Abbruchs. **Jeder einzelne wäre im Trockenlauf sichtbar gewesen**,
zusammen rund zweieinhalb Stunden.

Dazu: Bricht der Deploy ab, nimmt er die hochgezählte Cache-Kennung selbst
zurück. Vorher blockierte ein gescheiterter Versuch den nächsten.

**Belegt:** Kaputte Firestore-Regel → Trockenlauf wird rot. Echter Abbruch →
Aufräumen greift.

### 2. Elf Minuten schnellere Auslieferung

Zwei Doppelungen entfernt, **kein Riegel gestrichen**:

```
test-e2e in der Pipeline   521 s   lief ZWEIMAL ueber denselben Code
Backend-Tests im Skript    159 s   die Pipeline hatte sie schon bestanden
Frontend + Lint im Skript    4 s   dito
```

Der Beweis, dass der zweite Lauf nichts Neues prüfen kann: Git berechnet für
jeden Dateistand eine Baum-Kennung. An den fünf letzten Zusammenführungen
(#229–#234) war sie nach dem Merge **jedes Mal bitgenau identisch** mit der des
Pull Requests. Ist sie gleich, ist jede Datei gleich.

Fail-closed an jeder Stelle: ohne PR-Nummer, ohne erreichbaren Kopf-Commit, bei
abweichendem Baum passiert nichts — dann gilt weiter, was `main` sagt.

### 3. Zwei neue Wächter

**`scripts/pruefe-mitzieher.py`** — „wenn du X änderst, gehört Y mitgezogen".
Vier Kopplungen sind aufgeschrieben, jede mit der Folge des Vergessens. Anlass:
Das neue Pflichtfeld vom 30.08. war an sieben Stellen nachzuziehen, zwei wurden
übersehen.

**`scripts/pruefe-kopplung.py`** — meldet, wenn Dateien wieder zusammenwachsen.
Sperrklinken auf dem gemessenen Stand; von hier aus nur noch abwärts.

Beide laufen in der Pipeline und vor jedem Push. Beide melden **„nicht
messbar"** statt stillschweigend grün, wenn ihre Grundlage fehlt.

### 4. Erster Schnitt an der größten Datei

`mistral.js` **1691 → 1533 Zeilen**. Der Antwort-Parser liegt jetzt in
`mistral-antwort.js` — reine Funktionen, kein Netz, kein Zustand.
Verhalten unverändert.

### 5. Ein flackernder Test repariert

`e2e/keyboard.test.js` trennte Fokus und Tastendruck in zwei Schritte; unter
Last ging dazwischen der Fokus verloren. Das hielt Auslieferungen auf, obwohl
nichts kaputt war. Jetzt in einem Schritt.

---

## Was NICHT fertig ist, und warum

**`handle-process-job.js` teilen (679 Zeilen).** Nicht begonnen. Der Schnitt an
`mistral.js` hat gezeigt, dass jeder weitere Schritt sorgfältig geprüft werden
muss; ich wollte lieber vier Dinge fertig als sechs halb.

**Weitere Schnitte an `mistral.js`.** Der Ein-Aufruf-Weg (~400 Zeilen) und der
Drei-Aufruf-Weg (~300) hängen enger zusammen als der Parser. Das ist ein
eigener Arbeitsgang, kein Nebenbei.

---

## Ein Verdacht, den ich NICHT behoben habe

Die Fokus-Rückgabe nach dem Sprachdialog (`sprachumschalter.js`) fasst zwei
Sekunden lang nach und prüft dabei nur, ob **ihr** Ziel den Fokus hat — nicht,
ob inzwischen ein Mensch bewusst etwas anderes angesteuert hat.

Ich hatte dafür einen Fix gebaut und wieder zurückgenommen: **Die Rückbauprobe
zeigte, dass mein Test grün blieb, auch ohne den Fix.** Er maß nichts. Und die
Reproduktion mit englischem Browser widerlegte die ganze Hypothese — der Dialog
erschien gar nicht.

Der Verdacht steht in `befund-fokus-rueckgabe-offen.md`. **Prüfen lässt er sich
nur von Hand:** Sprachdialog öffnen, schließen, sofort Tab drücken und
schauen, ob der Fokus zurückspringt.

---

## Die sechs Prüfrunden

Wie besprochen, jede mit einer anderen Frage — und danach von vorn.

| Runde | Frage | Ergebnis |
|---|---|---|
| 1 | Was ist objektiv falsch? | kein Befund. Die Schnittstelle von `mistral.js` ist bitgenau dieselbe (12 Exporte vorher wie nachher), die Reihenfolge im Deploy-Skript stimmt |
| 2 | Tut es, was es behauptet? | belegt. Ein Messfehler lag bei **mir**: Ich prüfte den Wächter aus dem falschen Verzeichnis |
| 3 | Merkt die Testkette den Rückbau? | **ECHTER BEFUND**, siehe unten |
| 4 | Was passiert bei Andrang? | sieben Workshop-Lagen gegen den Emulator |
| 5 | Bricht es eine Zusage? | kein Befund. Alle vier Datenschutz-Obergrenzen sind im Test, jede mit dem Wortlaut der Datenschutzerklärung daneben |
| 6 | Fremder Blick | ein Prüfer ohne Vorwissen, mit dem Auftrag, Probleme zu finden statt die Arbeit zu bestätigen |

### Der Befund aus Runde 3

**`scripts/deploy.sh` war von KEINEM Test abgedeckt.** Trockenlauf,
Aufräumfalle, Stand-Bindung, Notschalter-Bilanz und die neue Concurrency-Regel
ließen sich alle entfernen, ohne dass irgendetwas rot wurde.

Ausgerechnet dort stehen die Riegel, die ungeprüften Code von der Produktion
fernhalten. Wären sie weg, fiele es erst auf, wenn es zu spät ist.

**Behoben** mit `scripts/pruefe-deploy-riegel.py`: Er prüft acht Riegel samt
Reihenfolge (der Trockenlauf MUSS vor dem Cache-Buster stehen, die Aufräumfalle
danach), alle sieben Notschalter auf ihren Eintrag in der Schlussbilanz, und
die Concurrency-Regel samt Ausnahme für `main`. Belegt mit vier Rückbauproben.

## Abnahme

| Kriterium | Ergebnis |
|---|---|
| Ganze Suite | Backend 1157, Frontend 483, E2E 328 — grün |
| Rückbauproben | bestanden (Parser: 25 Tests werden rot) |
| Negativproben | sechs Stück, alle bestanden |
| Alle Wächter | grün |
| Nachsuche nach derselben Ursache | durchgeführt, mit Negativprobe des Suchmusters |

**Zwei eigene Fehler, die dabei aufgefallen sind:** Ich habe einmal gepusht,
obwohl der Wächter rot war (Formatierung) — behoben. Und ich habe einen
Rückgabewert durch eine Pipe gemessen und deshalb falsch abgelesen; die Regel
dazu stand längst im Gedächtnis.

---

## Was du entscheiden musst

**PR #235 zusammenführen und ausliefern?** Der Trockenlauf und die
Beschleunigung wirken erst danach. Ohne Deploy liegt alles im Repository und
ändert nichts am laufenden Betrieb.

**Weitermachen an `mistral.js`?** Der Parser ist raus, vier größere Blöcke
stehen noch. Jeder ist ein eigener Arbeitsgang mit voller Abnahme.
