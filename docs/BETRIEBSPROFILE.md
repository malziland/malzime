# Betriebswerte

**Alle einstellbaren Zahlen von malziME stehen in Firestore, in genau einem
Dokument.** Im Programmcode steht keine davon ein zweites Mal.

Umgestellt wird ohne Auslieferung: ein Feld ändern, dreißig Sekunden warten.

---

## Die eine Regel

> Jeder einstellbare Wert existiert **genau einmal** — im Einstellungssatz.
> Es gibt keine Rückfallwerte im Code.

Der Grund ist Erfahrung, nicht Ästhetik. Zwei Orte für dieselbe Zahl laufen
früher oder später auseinander, und dann hängt es vom Aufrufweg ab, welche
gilt. Dieser Fehler zeigt sich nicht beim Testen — er zeigt sich, wenn jemand
eine Einstellung ändert und nichts passiert.

**Ohne gültigen Satz läuft keine Analyse.** Das ist Absicht: Ein
Konfigurationsfehler soll auffallen, nicht monatelang unbemerkt bleiben.

---

## Das Dokument

Firestore-Datenbank `malzime-eu`, Dokument **`config/betriebsprofil`**:

```json
{
  "aktiv": "t1-normal",
  "profile": {
    "t1-normal": { … alle 26 Werte … },
    "t1-langsam": { … },
    "t2-schnell": { … }
  }
}
```

**Umstellen heißt: das Feld `aktiv` ändern.** Alle Werte des Satzes ziehen
mit.

Ein Satz muss **vollständig** sein. Fehlt ein Feld, wird der ganze Satz
abgelehnt — es gibt nichts, womit sich das fehlende Feld ersetzen ließe.

---

## Die 26 Werte

### 1 · Die KI-Aufrufe

| Feld | heute | Bedeutung |
|---|---|---|
| `singleLargeTimeoutMs` | 300000 | Wie lange ein Analyse-Aufruf dauern darf |
| `singleLargeMaxTokens` | 5000 | Wie viel Text die KI ausgeben darf |
| `mistralTimeoutMs` | 90000 | Zeitgrenze der übrigen Aufrufe |
| `describeMaxTokens` | 2048 | Textmenge der Bildbeschreibung |
| `profileMaxTokens` | 16000 | Textmenge der Profilerstellung |
| `requestBudgetMs` | 480000 | Gesamtbudget eines Durchlaufs |

### 2 · Andrang und Einlass

| Feld | heute | Bedeutung |
|---|---|---|
| `parallelitaet` | 7 | Wie viele Analysen gleichzeitig laufen |
| `warteschlangeTiefe` | 155 | Ab wie vielen Wartenden abgelehnt wird |
| `durchschnittsdauerSekunden` | 65 | Ausgangswert der Wartezeit-Ansage |
| `stundenlimit` | 500 | Analysen pro Zeitfenster |
| `stundenfensterMinuten` | 60 | Größe dieses Fensters |
| `adressLimit` | 500 | Anfragen je Internetanschluss |
| `adressfensterMs` | 600000 | Größe dieses Fensters |

### 3 · Der Notaufschlag

| Feld | heute | Bedeutung |
|---|---|---|
| `boostFaktor` | 2 | Höchstens das Doppelte des Stundenlimits |
| `boostFristMs` | 7200000 | Wie lange ein Aufschlag gilt |

### 4 · Rücksicht auf den KI-Anbieter

| Feld | heute | Bedeutung |
|---|---|---|
| `drosselMaxParallel` | 6 | Gleichzeitige Aufrufe an Mistral |
| `drosselWartelimitMs` | 360000 | Wie lange ein Aufruf auf seinen Platz wartet |
| `tokenAbstandGrossMs` | 800 | Mindestabstand zwischen großen Aufrufen |
| `tokenAbstandKleinMs` | 2500 | Mindestabstand zwischen kleinen Aufrufen |

### 5 · Fristen und Aufräumen

| Feld | heute | Bedeutung |
|---|---|---|
| `jobAufbewahrungMs` | 7200000 | Wie lange ein Auftrag höchstens liegt |
| `zustellfensterMs` | 900000 | Abholfenster für das Ergebnis |
| `livenessGnadenfristMs` | 480000 | Karenz, bevor ein Wartender als weg gilt |
| `verarbeitungsZeitlimitMs` | 540000 | Ab wann ein laufender Auftrag als hängend gilt |
| `wartendesHoechstalterMs` | 2100000 | Absolutes Höchstalter eines Wartenden |
| `aufraeumStapel` | 200 | Wie viele Aufträge je Aufräumlauf |
| `ticketGueltigkeitMs` | 1800000 | Gültigkeit der Verwaltungs-Knöpfe |

---

## Vier Obergrenzen sind Zusagen

Bei vier Feldern ist die zulässige Obergrenze **nicht** großzügig gewählt,
sondern exakt das, was die Datenschutzerklärung öffentlich verspricht:

```
jobAufbewahrungMs      max 2 h      "nie abgeholte spätestens nach rund 2 Stunden"
zustellfensterMs       max 15 min   "wenige Minuten nach der Abholung gelöscht"
adressfensterMs        max 10 min   "merkt sich deine IP für maximal 10 Minuten"
stundenfensterMinuten  max 60       "die Zeitpunkte der Analysen der letzten 60 Minuten"
```

Der Einstellungssatz kann diese Fristen nur **verkürzen**. Wäre es anders,
ließe sich eine öffentliche Zusage mit einem Datenbankeintrag brechen —
während die Erklärung auf der Website weiter dasselbe sagt.

**Wer eine dieser Grenzen anheben will, ändert zuerst die
Datenschutzerklärung.**

---

## Was ausdrücklich nicht einstellbar ist

Nicht jede Zahl darf sich im Betrieb ändern lassen. Ein Eintrag in der
Datenbank ist in Sekunden geändert: ohne Commit, ohne Review, ohne Spur im
offenen Quelltext.

Für eine Zeitgrenze ist das genau richtig. Für eine Zusage wäre es fatal.
Stünde dort der KI-Endpunkt, könnte ein einziger Schreibzugriff die Analyse
still auf einen Server außerhalb der EU umlenken — während die Website weiter
dasselbe verspricht, der Quelltext auf GitHub unverändert bleibt und die
Prüfsummen unter `malzi.me/build-info.json` weiter stimmen. Der Bruch wäre von
außen nicht nachweisbar.

Im Code bleiben deshalb, jeweils mit ausgeschriebener Begründung an Ort und
Stelle:

| bleibt im Code | Grund |
|---|---|
| EU-Endpunkt `api.eu.mistral.ai` | Datenschutzzusage |
| EU-Datenbank `malzime-eu` | Datenschutzzusage |
| Die benannten KI-Modelle | Zusage, welches Modell rechnet |
| Upload-Obergrenze 25 MB | Sicherheitsgrenze |
| Erlaubte Dateiformate | Sicherheitsliste |
| Gekürzte Feldlängen der Fehlerprotokolle | Datenschutz in Zahlenform |
| Langsamste gemessene KI-Geschwindigkeit | Messergebnis, kein Sollwert |

Zwei Mechanismen halten die Trennung aufrecht:

1. **Der Satz kann diese Werte nicht übernehmen.** Gelesen werden
   ausschließlich die 26 bekannten Zahlenfelder; alles andere im Dokument wird
   ignoriert.
2. **`scripts/pruefe-doppelte-werte.py` geht vom Code aus** — nicht von dieser
   Liste — und verlangt für jede Zahlenkonstante eine von zwei Antworten: Sie
   steht im Satz (dann darf sie im Code nicht noch einmal stehen), oder sie
   trägt einen Kommentar `BLEIBT IM CODE — <Grund>`. Alles andere hält die
   Auslieferung an. Läuft in der Pipeline und vor jedem Push.

---

## Was die Werte im Betrieb bewirken — und was nicht

Zwei Grenzen halten seit dem 30.08.2026 nachweislich, auch bei Andrang:

**Die Einlassgrenze** (`warteschlangeTiefe`) wird nicht mehr überschritten.
Bis dahin zählte der Einlass und legte den Auftrag erst später an — bei
gleichzeitigem Andrang kamen alle durch (gemessen: 200 bei einer Grenze von
155). Jetzt prüft jeder Auftrag nach dem Anlegen seine eigene Position.
Gemessen nach der Reparatur: **156 bei Grenze 155**.

**Das Stundenlimit** (`stundenlimit`) fällt nicht mehr aus. Der Zähler schreibt
in ein einzelnes Dokument und stand bei Andrang Schlange — die Bremse fiel im
Test 206-mal aus. Jetzt springt ein zweiter Weg ein, der nur zählt und keine
Sperre braucht. Gemessen nach der Reparatur: **0 Ausfälle**.

Beide Reparaturen sind in `docs/SECURITY-MODEL.md` ausführlich beschrieben.

## Die Riegel

**Ein Satz wird geprüft, bevor er gilt.** Abgelehnt wird er, wenn:

- ein Pflichtfeld fehlt
- ein Wert keine positive Zahl ist
- ein Wert außerhalb seines zulässigen Bereichs liegt
- die erlaubte Textmenge nicht in die erlaubte Zeit passt
- eine Einzelgrenze über dem Gesamtbudget liegt
- das Budget über dem liegt, was Google der Funktion gibt
- das Zustellfenster über der Aufbewahrung liegt

Die Kopplungsprüfung „Textmenge muss in die Zeit passen" ist der Riegel gegen
den Ausfall vom 17. August 2026. Sie lief früher nur beim Start der Funktion;
jetzt prüft sie **jeden** Satz, auch die, die erst im Betrieb entstehen.

**Ein abgelehnter Satz meldet sich sofort.** Ein Firestore-Auslöser (`satzWache`)
feuert im Moment der Änderung und schickt eine Nachricht auf beide Kanäle: bei
einem gültigen Satz die übernommenen Werte, bei einem abgelehnten den Grund im
Klartext plus einen Fehlereintrag, der die Alarmierung auslöst.

Ohne diesen Auslöser hätte sich ein kaputter Satz erst gemeldet, wenn jemand
eine Analyse versucht — nachts also gar nicht.

---

## Beim Ausliefern: die Reihenfolge zählt

> **Erst den Einstellungssatz anlegen, dann ausliefern.**

Umgekehrt stünde zwischen Auslieferung und Anlegen ein Zeitraum, in dem keine
Analyse läuft. Der Satz kann gefahrlos vorher angelegt werden — die alte
Fassung liest ihn nicht.

```bash
# 1. ANSEHEN, was geschrieben würde — schreibt noch nichts
node scripts/betriebsprofil-anlegen.js

# 2. Wirklich schreiben. Das Skript misst danach nach und sagt
#    ausdrücklich "Bereit fuer den Deploy" — oder bricht ab.
node scripts/betriebsprofil-anlegen.js --ausfuehren

# 3. Erst danach ausliefern
sh scripts/deploy.sh
```

Das Skript hat vier Sicherungen, weil es in die Produktionsdatenbank schreibt:

- Es **weigert sich**, wenn `FIRESTORE_EMULATOR_HOST` gesetzt ist — dann wäre
  der Emulator gemeint, nicht die echte Datenbank.
- Es zeigt zuerst nur an und verlangt `--ausfuehren`.
- Es überschreibt einen vorhandenen Satz nicht ohne `--ueberschreiben`.
- Es prüft jeden Satz **vor** dem Schreiben mit derselben Funktion, die auch
  im Betrieb entscheidet — und liest danach zurück, statt Erfolg zu behaupten.

### Drei vorbereitete Sätze

| Satz | wofür |
|---|---|
| `t1-normal` | der Alltag |
| `t1-langsam` | wenn die KI langsamer wird (der Fall vom 28.08.2026) |
| `t1-drei-call` | Rollback auf die 3-Call-Pipeline — ersetzt den früheren Deploy-Schritt im RUNBOOK |

Umstellen heißt: `aktiv` auf einen dieser Namen setzen. Kein Deploy, wirksam
binnen dreißig Sekunden.

## Zurück auf den Stand davor

Der Rückweg führt auf **v4.2.3**. Der Einstellungssatz kann liegen bleiben —
die alte Fassung ignoriert ihn.

```bash
git checkout v4.2.3 && sh scripts/deploy.sh
```
