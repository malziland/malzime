# Betriebsprofile

Betriebswerte lassen sich als benannte Sätze umstellen, ohne Auslieferung.

## Wie es funktioniert

In Firestore liegt das Dokument `config/betriebsprofil`:

```json
{
  "aktiv": "t1-normal",
  "profile": {
    "t1-normal": {
      "singleLargeTimeoutMs": 300000,
      "singleLargeMaxTokens": 5000,
      "parallelitaet": 7
    },
    "t1-langsam": {
      "singleLargeTimeoutMs": 450000,
      "singleLargeMaxTokens": 5000,
      "parallelitaet": 7
    },
    "t2-normal": {
      "singleLargeTimeoutMs": 300000,
      "singleLargeMaxTokens": 5000,
      "parallelitaet": 14,
      "stundenlimit": 1000
    }
  }
}
```

**Umstellen heißt: das Feld `aktiv` ändern.** Alle Werte des Satzes ziehen mit,
sofort und ohne Deploy. Der Wert wird 30 Sekunden zwischengespeichert.

## Die Riegel

**Ein Satz wird geprüft, bevor er gilt.** Passt die erlaubte Textmenge nicht in
die erlaubte Zeit, liegt eine Einzelgrenze über dem Gesamtbudget oder das
Budget über dem, was Google der Funktion gibt — dann wird der Satz **abgelehnt**
und die Werte aus dem Code gelten weiter.

Das ist die Sicherung, an der die Idee einzelner Schalter im August gescheitert
ist. Sie ist hier strenger als vorher: Statt beim Start abzustürzen, verwirft
das System den falschen Wert und läuft mit den bewährten weiter.

**Jeder Rückfall führt zu den Code-Werten:** kein Dokument, kein aktiver Satz,
Satz nicht hinterlegt, Prüfung nicht bestanden, Datenbank nicht lesbar. Der
schlechteste Fall ist damit der Zustand von vorher.

## Wirksame Werte und Sollwerte — ein wichtiger Unterschied

| Wert | Wirkung |
|------|---------|
| `singleLargeTimeoutMs`, `singleLargeMaxTokens`, `mistralTimeoutMs`, `requestBudgetMs` | **Wirken sofort** — gehen direkt in den Analyse-Aufruf |
| `parallelitaet`, `stundenlimit`, `adressLimit` | **Sollwerte** — ändern von sich aus nichts |

Die Parallelität wird von der Warteschlange bei Google bestimmt; Stunden- und
Adress-Limit steuert der Boost-Mechanismus. Im Profil stehen sie als das, was
gelten **soll** — die tägliche Prüfung vergleicht sie mit der Wirklichkeit und
meldet Abweichungen.

Das ist bewusst so: Ein Profil `t2-normal` muss ablesbar machen, dass dort
vierzehn Analysen parallel laufen sollen. Wer den Wert ändert, ändert die
Erwartung; die Prüfung sagt dann, ob die Anlage noch dazu passt.

## Was drin steht — und was nicht

Im Profil: Zeitgrenzen und Textmenge der KI-Aufrufe, Parallelität,
Stundenlimit, Adress-Limit.

**Bewusst im Code:**

| Wert | Grund |
|------|-------|
| Upload-Grenze | Sicherheitsgrenze — zur Laufzeit erhöht eine offene Tür für Überlastung |
| Feldlängen der Fehlererfassung | Datenschutzzusage in Zahlenform |
| Modellname, EU-Endpunkt | Zusage an die Nutzer; umschaltbar hieße, sie unbemerkt brechen zu können |
| Stundenlimit (praktisch) | Bereits über den Boost steuerbar — zweimal steuerbar wäre schlechter als einmal |

## Was das Profil NICHT kann

Die Warteschlange bei Google zieht **nicht** automatisch mit. Sie ist ein
fremdes System; eine Änderung dort gehört durch die Prüfkette, nicht in eine
nächtliche Automatik. Stattdessen vergleicht eine tägliche Prüfung beide Seiten
und meldet Abweichungen mit beiden Zahlen und dem Weg zur Abhilfe.

## Nachsehen, was gerade gilt

`https://malzi.me/api/stats` nennt unter `betrieb` den aktiven Satz, die
Herkunft (`firestore` oder `code`) und die geltende Zeitgrenze.
