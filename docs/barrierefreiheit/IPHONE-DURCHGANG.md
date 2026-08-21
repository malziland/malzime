# VoiceOver am iPhone — Vergleichen statt beurteilen

**Für:** Christoph · **Dauer:** rund 20 Minuten · **Gerät:** nur dein iPhone

Diese Anleitung ersetzt die alte `VOICEOVER-CHECKLISTE.md` für den iPhone-Teil. Der
Unterschied ist der ganze Punkt:

> **Du musst nirgends beurteilen, ob etwas „richtig klingt".** In jedem Schritt steht
> links, was VoiceOver sagen **müsste**. Du hörst hin und kreuzt an: **stimmt** oder
> **stimmt nicht**. Mehr nicht.

Die erwarteten Ansagen sind nicht geraten. Sie sind am 18. August 2026 aus dem
ausgelesen, was ein Screenreader auf malzi.me tatsächlich vorfindet.

**Wichtig:** VoiceOver formuliert je nach Version leicht anders — „Taste" oder „Schalter",
„Überschrift Ebene 1" oder „Überschrift, Ebene 1". **Auf die Wörter in `Kapitälchen` kommt
es nicht an, auf den Namen davor schon.** Wenn du den Namen hörst, ist es richtig.

---

## Vorbereitung (2 Minuten)

1. **Einstellungen → Bedienungshilfen → Bedienungshilfen-Kurzbefehl → VoiceOver** antippen.
   Ab jetzt schaltet **dreimaliges Drücken der Seitentaste** VoiceOver an und aus. Das ist
   der Rettungsanker, falls etwas hakt.
2. Safari öffnen, **https://malzi.me** aufrufen.
3. VoiceOver einschalten (dreimal Seitentaste).

**Die drei Gesten, die du brauchst:**

| Geste                                      | Wirkung                                |
| ------------------------------------------ | -------------------------------------- |
| **einmal tippen**                          | Element auswählen und vorlesen         |
| **mit einem Finger nach rechts streichen** | zum nächsten Element                   |
| **zweimal tippen**                         | auslösen (wie ein normaler Fingertipp) |

Wenn du dich verlierst: dreimal Seitentaste, Seite neu laden, wieder an.

---

## Teil 1 — Durch die Startseite streichen

Streiche vom oberen Bildschirmrand mit **einem Finger nach rechts**, Element für Element.
Du müsstest der Reihe nach das hier hören:

| #   | Was VoiceOver sagen müsste                                                                                   | stimmt | stimmt nicht |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------ |
| 1   | „Zum Inhalt springen, `Link`"                                                                                | ☐      | ☐            |
| 2   | „Sprache wählen"                                                                                             | ☐      | ☐            |
| 3   | „Deutsch, `Taste`" — und dazu **„ausgewählt"** oder **„aktiviert"**                                          | ☐      | ☐            |
| 4   | „English, `Taste`" (ohne „ausgewählt")                                                                       | ☐      | ☐            |
| 5   | „Wir sehen mehr als dein Foto., `Überschrift Ebene 1`"                                                       | ☐      | ☐            |
| 6   | „Lade ein Bild hoch. Die KI erstellt in Sekunden ein komplettes Profil über dich — aus einem einzigen Foto." | ☐      | ☐            |
| 7   | „Foto auswählen oder hierhin ziehen, JPEG, PNG, WEBP, GIF, max 25 MB, `Taste`"                               | ☐      | ☐            |
| 8   | „…Details in der Datenschutzerklärung, `Link`"                                                               | ☐      | ☐            |
| 9   | „Information, `Taste`"                                                                                       | ☐      | ☐            |
| 10  | „Beast-Modus aktivieren, `Schalter`" oder „`Kontrollkästchen`" — dazu **„aus"** oder **„nicht aktiviert"**   | ☐      | ☐            |
| 11  | „Mit KI erstelltes Beispielbild: Selfie am Stephansplatz. Zeigt keine reale Person., `Taste`"                | ☐      | ☐            |
| 12  | dasselbe mit „Im Café in Salzburg"                                                                           | ☐      | ☐            |
| 13  | dasselbe mit „Wanderung bei Hallstatt"                                                                       | ☐      | ☐            |
| 14  | „Open Source auf GitHub, `Link`"                                                                             | ☐      | ☐            |
| 15  | „Impressum, `Link`" · „Datenschutz, `Link`" · „Nutzungsbedingungen, `Link`" · „Barrierefreiheit, `Link`"     | ☐      | ☐            |

**Achte bei 11 bis 13 besonders auf eines:** Der Ortsname darf **nur einmal** vorkommen.
Wenn du „Selfie am Stephansplatz … Selfie am Stephansplatz" hörst, kreuze „stimmt nicht"
an — genau das wurde am 18. August behoben, und dann hat der Fix es nicht bis zu dir
geschafft.

**Und zwischen den Fußzeilen-Links (15):** Da darf **kein** „Punkt" oder „Mittelpunkt"
vorgelesen werden. Die Trennzeichen sind seit dem 17. August ausgeblendet.

Falls etwas nicht stimmt — nur die Nummer und ein Stichwort:

```
Nr. ____  gehört: _______________________________________________

Nr. ____  gehört: _______________________________________________
```

---

## Teil 2 — Eine Analyse anhören (der wichtigste Teil)

Wähle Element **11** (das Selfie) und **tippe zweimal**. Dann **leg das Telefon hin und
fass es nicht an.** Die Analyse dauert etwa eine Minute.

Was du in dieser Minute hören müsstest, **ohne dass du etwas tust**:

| #   | Was VoiceOver von selbst sagen müsste                                                                       | stimmt | stimmt nicht |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| 16  | gleich am Anfang: **„Analyse gestartet"**                                                                   | ☐      | ☐            |
| 17  | danach: **„Dein Foto ist unterwegs …"**                                                                     | ☐      | ☐            |
| 18  | evtl. **„Warteschlange · 2 vor dir"** oder **„Du bist als Nächstes dran …"** (nur wenn gerade viel los ist) | ☐      | ☐            |
| 19  | am Ende: **„Analyse abgeschlossen"** und danach **„Dein Profil"**                                           | ☐      | ☐            |

**Die eine Frage, auf die es hier wirklich ankommt — und die du beurteilen kannst:**

> **Wurde in dieser Minute derselbe Satz mehr als dreimal wiederholt?**
>
> ☐ nein, es war ruhig ☐ ja, es hat sich ständig wiederholt

Am 17. August waren es 19 Ansagen in 30 Sekunden. Nach der Behebung sollten es **drei in
der ganzen Wartezeit** sein. Wenn es sich für dich nach Geplapper anfühlt, ist die
Behebung nicht angekommen — dein Eindruck reicht als Befund völlig aus.

Zweite Frage, ebenso einfach:

> **Wusstest du ohne hinzusehen, dass die Seite arbeitet und wann sie fertig war?**
>
> ☐ ja ☐ nein, ich war unsicher

---

## Teil 3 — Das Ergebnis durchgehen

Streiche weiter nach rechts durch das fertige Profil.

| #   | Was VoiceOver sagen müsste                                                 | stimmt | stimmt nicht |
| --- | -------------------------------------------------------------------------- | ------ | ------------ |
| 20  | „Dein Profil, `Bereich`"                                                   | ☐      | ☐            |
| 21  | zu jeder Karte: erst die Bezeichnung („Alter & Geschlecht"), dann der Wert | ☐      | ☐            |
| 22  | bei den Balken: „Konfidenz" mit einer Zahl oder einem Prozentwert          | ☐      | ☐            |
| 23  | irgendwo wird vorgelesen, dass die Angaben **geraten** sind                | ☐      | ☐            |

**Nummer 23 ist kein Formalismus.** Ein Profil, das vorgelesen wird, ohne dass die
Einordnung mitkommt, ist genau das, wovor malziME warnt.

Dann den **Beast-Modus** suchen (Element 10) und **zweimal tippen**:

| #   | Was VoiceOver sagen müsste                                          | stimmt | stimmt nicht |
| --- | ------------------------------------------------------------------- | ------ | ------------ |
| 24  | der neue Zustand wird genannt: „ein", „aktiviert" oder „ausgewählt" | ☐      | ☐            |

---

## Teil 4 — Bildschirm aus und wieder an

Starte eine zweite Analyse und **drücke während der Wartezeit die Seitentaste**, sodass der
Bildschirm dunkel wird. Warte etwa 20 Sekunden, dann wieder aufwecken.

| #   |                                                                             | stimmt | stimmt nicht |
| --- | --------------------------------------------------------------------------- | ------ | ------------ |
| 25  | Die Analyse läuft weiter oder das Ergebnis ist da — es geht nichts verloren | ☐      | ☐            |
| 26  | VoiceOver sagt wieder etwas Sinnvolles, statt stumm zu bleiben              | ☐      | ☐            |

Das ist bei uns ein bekannter Wackelkandidat: Der Bildschirm-Wachhalter greift auf iPhones
nicht, dafür fängt die Warteschlange das ab. **Mit VoiceOver hat das noch nie jemand
geprüft** — deshalb steht es hier.

---

## Zum Schluss

☐ VoiceOver ausgeschaltet (dreimal Seitentaste)

**Eine Frage zum Gesamteindruck — und hier zählt dein Bauchgefühl, nicht dein Fachwissen:**

> Wenn du nichts sehen könntest: Kämst du mit dieser Seite zurecht?
>
> ☐ ja ☐ mit Mühe ☐ nein

---

---

## Was danach passiert

Gib mir zurück, was angekreuzt ist. **Auch „ich bin mir nicht sicher" ist eine
verwertbare Antwort** — dann prüfe ich die Stelle von der anderen Seite nach.

Sind Teil 1 bis 3 ohne „stimmt nicht" durch, sind die vier offenen Kriterien belegt und
aus „weitgehend konform" wird ein begründetes **„konform mit WCAG 2.2 Stufe AA"**.

Findet sich etwas, wird es behoben und steht als Fund im Bericht. Das schadet der
Erklärung nicht — es ist der Grund, warum man ihr glauben kann.
