# Anhang A — Die 55 Kriterien im Einzelnen

> **Dies ist der Anhang, nicht der Bericht.** Der Prüfbericht steht in
> **[PRUEFBERICHT-WCAG-EM.md](PRUEFBERICHT-WCAG-EM.md)** und folgt der Methodik
> [WCAG-EM 2.0](https://www.w3.org/TR/WCAG-EM/) des W3C. Dort stehen Geltungsbereich,
> Accessibility-Support-Baseline, eingesetzte Technologien, die begründete Stichprobe und
> die Konformitätsaussage. Hier steht nur die Detailtabelle, auf die er sich beruft.

**Prüfgegenstand:** https://malzi.me
**Angestrebte Stufe:** WCAG 2.2, Konformitätsstufe AA
**Prüfdatum:** 17. August 2026
**Prüfer:** Eigenprüfung (malziland - learning | training | consulting e.U.)

Der geprüfte Stand steht im Bericht — bewusst nur dort, damit die Commit-Nummer eine
einzige Quelle hat und nicht in zwei Dateien auseinanderdriftet.

---

## 1 Warum dieses Protokoll die Form einer vollständigen Liste hat

Eine Barrierefreiheitserklärung ist nur so viel wert wie das, was hinter ihr steht.
„Wir haben geprüft" ist keine Aussage, solange nicht dasteht **was** geprüft wurde,
**wie** und mit **welchem Ergebnis**.

Deshalb ist unten jedes einzelne Erfolgskriterium aufgeführt, das WCAG 2.2 für die
Stufe AA verlangt — **55 Kriterien**, davon 31 auf Stufe A und 24 auf Stufe AA.
(WCAG 2.2 hat gegenüber 2.1 die Kriterien 3.2.6 und 3.3.7 auf Stufe A sowie 2.4.11,
2.5.7, 2.5.8 und 3.3.8 auf Stufe AA ergänzt und das frühere 4.1.1 „Parsen"
gestrichen.)

Keine Zeile bleibt leer. Wo etwas nicht zutrifft, steht der Grund. Wo eine
Handprüfung nötig ist, steht das als offener Punkt — nicht als Häkchen.

## 2 Prüfumfang

**Geprüfte Seiten:** Startseite (`/`), Zahlen (`/stats`), Datenschutz
(`/datenschutz`), Impressum (`/impressum`), Nutzungsbedingungen
(`/nutzungsbedingungen`).

**Geprüfte Zustände:** Startseite leer, Warteschlange mit Position und Restzeit,
Live-Text während die KI schreibt, fertiges Profil (seriöser Modus, Beast-Modus,
Umschalter im geklebten Zustand), Fehlermeldung nach fehlgeschlagener Analyse,
Sprachhinweis-Dialog geöffnet.

**Zum dunklen Erscheinungsbild, damit hier nichts Falsches steht:** malziME richtet
sich NICHT nach der Systemeinstellung „dunkel" — `prefers-color-scheme` kommt im
Stilblatt nicht vor. Das dunkle Erscheinungsbild entsteht ausschließlich über den
Beast-Schalter und damit nur auf der Startseite mit vorliegendem Ergebnis. Genau dort
ist es gemessen (Zustand „Profil, Beast, dunkel"). Auf den Rechtsseiten und der
Zahlen-Seite gibt es kein dunkles Erscheinungsbild, das man prüfen könnte.

**Geprüfte Browser:** Chromium und WebKit. WebKit ist die Maschine hinter Safari auf
iPhone und iPad — dort finden die Workshops statt. Beide Läufe liefern dasselbe
Ergebnis; die Trennung ist Absicht, weil WebKit am Prüftag einen Fehler zeigte, den
Chromium nicht zeigte.

**Geprüfte Fenstermaße:** 1280 × 900 (Rechner) und 320 × 800 (kleines Handy).

**Werkzeuge:** axe-core über Playwright, gefiltert auf die Marken `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` — also ausschließlich
normative Regeln, keine „best practice"-Empfehlungen. Dazu eigene Messungen für
Zielgrößen, Reflow, Textvergrößerung, Textabstände und Fokus-Erscheinung.

**Reproduzierbar:** `npx playwright test e2e/barrierefreiheit-protokoll.test.js`
Rohdaten: `e2e/.protokoll/befunde-chromium.json`,
`e2e/.protokoll/befunde-webkit-sprachumschalter.json`,
`e2e/.protokoll/befunde-firefox-barrierefreiheit.json` — 46 Zustände je Maschine.

## 3 Fünf Vorsichtsmaßnahmen, die das Ergebnis erst belastbar machen

**Jede Messung läuft doppelt.** Übernommen wird nur, was beide Male auftritt. Grund:
Ein erster Aufbau meldete 17 Kontrastverstöße, die in einem sauberen Einzellauf nicht
reproduzierbar waren — axe hatte Elemente in einem Übergangszustand erwischt. Ein
Protokoll mit Scheinbefunden ist schlechter als keines.

**Ein grüner Test ist nur so viel wert wie die Frage, die er stellen kann.**
Der Tastatur-Durchgang dieses Protokolls war grün, während der Sprachumschalter auf
Safari mit der Tastatur unerreichbar war — Playwrights WebKit tabbt auf Buttons
unabhängig von Safaris Einstellung „Vollzugriff Tastatur". Gefunden hat den Fehler ein
Nutzer in einer Minute. Geprüft wird deshalb jetzt die STRUKTUR (trägt jedes
Bedienelement `tabindex="0"`?), nicht das Tabben. Dieser Wächter fand sofort einen
zweiten Fall, den niemand kannte.

**Eine Messung sagt, DASS etwas geschieht — nicht, wie oft.** Die Ansagen
während der Wartezeit waren korrekt und vollständig; gemessen wurde erst nach
einem Hinweis von außen, dass sie sich alle zwei Sekunden wiederholen. Häufigkeit
gehört mitgemessen, sonst ist eine Seite formal richtig und praktisch unbenutzbar.

**Eine Abstention ist kein Bestehen.** axe meldet Elemente als „unprüfbar", wenn es
den Hintergrund nicht bestimmen kann — Verlauf, Halbtransparenz, überlappende
Schichten. Die erste Fassung dieses Protokolls zählte nur die Verstöße und schrieb
„0 Verstöße", während die Abstentionen unbeantwortet danebenlagen. Jetzt entscheidet
eine **Bildpunkt-Messung**: Das Element wird fotografiert, das Foto Punkt für Punkt
ausgelesen, hellster und dunkelster Punkt nach der Kontrastformel der WCAG verrechnet.
Sie macht den Lauf rot, wenn sie einen Verstoß bestätigt — und hat sofort einen
gefunden, den axe nicht entscheiden konnte (Abschnitt 6, Info-Zeichen). Ausnahmen wie
das Trennzeichen in der Fußzeile stehen als benannter Eintrag mit Begründung im
Prüfcode, nicht als stille Regel.

**Jede Messung hat eine Positivkontrolle.** Liefert axe null geprüfte Regeln oder
findet die Zielgrößen-Messung kein einziges Bedienelement, bricht der Lauf ab. Ohne
das sähe ein kaputter Lauf aus wie ein perfektes Ergebnis. Die Bildpunkt-Messung hat
ihre eigene: Ein absichtlich zu blasser Text muss erkannt und ein ausreichender
durchgelassen werden — ein Prüfmittel, das nie anschlägt, und eines, das immer
anschlägt, sind gleich wertlos.

---

## 4 Ergebnis in einem Satz

Von 55 Kriterien der Stufe AA sind **40 als erfüllt nachgewiesen** und **11 nicht
anwendbar** (keine Video- oder Tonbeiträge, keine Anmeldung, keine Zeitbegrenzung,
kein Formular mit personenbezogenen Daten). **4 weitere sind maschinell erfüllt, ihre
Handprüfung steht noch offen** (Abschnitt 7). **Kein Kriterium ist als verletzt
festgestellt.**

Die Zahlen sind die Auszählung der Tabellen in Abschnitt 5, nicht eine Schätzung:
40 + 11 + 4 = 55.

Bis die vier Handprüfungen abgeschlossen sind, lautet die zulässige Aussage
**„weitgehend konform"**. Danach kann sie „konform" lauten.

---

## 5 Die Kriterien im Einzelnen

Legende: **erfüllt** = nachgewiesen · **n. a.** = nicht anwendbar, mit Grund ·
**Handprüfung** = maschinell nicht entscheidbar, siehe Abschnitt 7

### Stufe A

| Kriterium                                  | Prüfweg                                                                                                                                                                                                                                                                                                                                                                            | Ergebnis                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1.1.1 Nicht-Text-Inhalt                    | axe (`image-alt`, `input-image-alt`, `role-img-alt`, `object-alt`); Unit-Test prüft `data-i18n-alt` für alle Bilder                                                                                                                                                                                                                                                                | **maschinell erfüllt**, Handprüfung offen |
| 1.2.1 Nur-Audio, Nur-Video (aufgezeichnet) | Bestandsprüfung: keine Audio- oder Videobeiträge                                                                                                                                                                                                                                                                                                                                   | **n. a.**                                 |
| 1.2.2 Untertitel (aufgezeichnet)           | dito                                                                                                                                                                                                                                                                                                                                                                               | **n. a.**                                 |
| 1.2.3 Audiodeskription / Medienalternative | dito                                                                                                                                                                                                                                                                                                                                                                               | **n. a.**                                 |
| 1.3.1 Infos und Beziehungen                | axe (`list`, `listitem`, `definition-list`, `th-has-data-cells`, `aria-required-parent`, `heading-order`)                                                                                                                                                                                                                                                                          | **maschinell erfüllt**, Handprüfung offen |
| 1.3.2 Bedeutungstragende Reihenfolge       | Tab-Reihenfolge im Unit-Test festgeschrieben (Sprungmarke → Datei → Info → Umschalter → Demos → Links)                                                                                                                                                                                                                                                                             | **erfüllt**                               |
| 1.3.3 Sensorische Eigenschaften            | Sichtprüfung: keine Anweisung verweist allein auf Form, Größe oder Position                                                                                                                                                                                                                                                                                                        | **erfüllt**                               |
| 1.4.1 Benutzung von Farbe                  | Sichtprüfung: Konfidenz-Punkte tragen zusätzlich Zahlwerte, Fehlermeldungen zusätzlich Text                                                                                                                                                                                                                                                                                        | **erfüllt**                               |
| 1.4.2 Audio-Steuerelement                  | Die Tipp-Geräusche sind kürzer als 3 s, spielen nur auf Nutzeraktion und lassen sich abschalten                                                                                                                                                                                                                                                                                    | **n. a.**                                 |
| 2.1.1 Tastatur                             | **Struktur**-Prüfung: jedes Bedienelement trägt `tabindex="0"` — auch die von JavaScript erzeugten (`tastatur-erreichbarkeit.test.js`, 6 Seiten plus Umschalter und Dialog). Ein Tabulator-Durchlauf im Test taugt dafür NICHT: Playwrights WebKit tabbt auf Buttons unabhängig von Safaris Einstellung „Vollzugriff Tastatur" und ist grün, während die echte Bedienung scheitert | **erfüllt**, Handprüfung offen            |
| 2.1.2 Keine Tastaturfalle                  | E2E: 10 Tabulatorschritte im Dialog, Fokus verlässt ihn nie und kehrt bei Escape zurück                                                                                                                                                                                                                                                                                            | **erfüllt**                               |
| 2.1.4 Zeichentasten-Kurzbefehle            | Bestandsprüfung: keine Einzelzeichen-Kurzbefehle vorhanden                                                                                                                                                                                                                                                                                                                         | **n. a.**                                 |
| 2.2.1 Zeiteinteilung anpassbar             | Die Analyse hat keine Frist für den Nutzer; das Abholfenster von 15 Minuten betrifft nur die Wiederholung eines fertigen Ergebnisses und verliert keine Eingabe                                                                                                                                                                                                                    | **erfüllt**                               |
| 2.2.2 Pausieren, beenden, ausblenden       | Alle Bewegungen (Scan-Auge, Live-Tippen, Karten-Einblendung) folgen `prefers-reduced-motion`; im E2E an den berechneten Animationswerten nachgewiesen                                                                                                                                                                                                                              | **erfüllt**                               |
| 2.3.1 Dreimaliges Blitzen oder weniger     | Bestandsprüfung: keine blitzenden Inhalte                                                                                                                                                                                                                                                                                                                                          | **erfüllt**                               |
| 2.4.1 Blöcke umgehen                       | Sprungmarke „Zum Inhalt springen" auf jeder Seite, Unit-Test prüft Ziel `#main`                                                                                                                                                                                                                                                                                                    | **erfüllt**                               |
| 2.4.2 Seite mit Titel                      | axe (`document-title`); jede der fünf Seiten hat einen eigenen, beschreibenden Titel                                                                                                                                                                                                                                                                                               | **erfüllt**                               |
| 2.4.3 Fokus-Reihenfolge                    | Unit-Test schreibt die Reihenfolge fest; E2E prüft die Rückgabe des Fokus nach Dialogen                                                                                                                                                                                                                                                                                            | **erfüllt**                               |
| 2.4.4 Linkzweck (im Kontext)               | Eigene Messung: 0 Leerformeln („hier", „mehr", „klicken") auf allen fünf Seiten                                                                                                                                                                                                                                                                                                    | **erfüllt**                               |
| 2.5.1 Zeigergesten                         | Bestandsprüfung: keine Mehrfinger- oder Pfadgesten; die Karte ist zusätzlich über Knöpfe bedienbar                                                                                                                                                                                                                                                                                 | **erfüllt**                               |
| 2.5.2 Zeiger-Abbruch                       | Alle Aktionen lösen beim Loslassen aus, nicht beim Drücken                                                                                                                                                                                                                                                                                                                         | **erfüllt**                               |
| 2.5.3 Beschriftung im Namen                | axe (`label-content-name-mismatch`); sichtbarer Text und `aria-label` stimmen überein                                                                                                                                                                                                                                                                                              | **erfüllt**                               |
| 2.5.4 Betätigung durch Bewegung            | Bestandsprüfung: keine Bewegungs- oder Neigungssteuerung                                                                                                                                                                                                                                                                                                                           | **n. a.**                                 |
| 3.1.1 Sprache der Seite                    | axe (`html-has-lang`, `html-lang-valid`); `lang` wird beim Sprachwechsel mitgesetzt                                                                                                                                                                                                                                                                                                | **erfüllt**                               |
| 3.2.1 Bei Fokus                            | Bestandsprüfung: kein Fokus löst einen Kontextwechsel aus                                                                                                                                                                                                                                                                                                                          | **erfüllt**                               |
| 3.2.2 Bei Eingabe                          | Der Sprachwechsel fragt vor dem Verwerfen eines Ergebnisses zurück                                                                                                                                                                                                                                                                                                                 | **erfüllt**                               |
| 3.2.6 Konsistente Hilfe                    | Impressum und Kontakt stehen auf jeder Seite an derselben Stelle der Fußzeile                                                                                                                                                                                                                                                                                                      | **erfüllt**                               |
| 3.3.1 Fehlererkennung                      | Fehlermeldungen erscheinen als Text in einem `aria-live`-Bereich; im Protokoll als eigener Zustand gemessen                                                                                                                                                                                                                                                                        | **erfüllt**                               |
| 3.3.2 Beschriftungen oder Anweisungen      | axe (`label`, `form-field-multiple-labels`); die Dateiauswahl trägt eine sichtbare Anweisung                                                                                                                                                                                                                                                                                       | **erfüllt**                               |
| 3.3.7 Redundante Eingabe                   | Es gibt nur einen Eingabeschritt (Foto wählen); nichts wird zweimal verlangt                                                                                                                                                                                                                                                                                                       | **n. a.**                                 |
| 4.1.2 Name, Rolle, Wert                    | axe (`button-name`, `link-name`, `aria-valid-attr-value`, `aria-required-attr`, `select-name`)                                                                                                                                                                                                                                                                                     | **erfüllt**                               |

### Stufe AA

| Kriterium                                             | Prüfweg                                                                                                                                                                                                  | Ergebnis                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1.2.4 Untertitel (live)                               | keine Live-Inhalte                                                                                                                                                                                       | **n. a.**                                 |
| 1.2.5 Audiodeskription (aufgezeichnet)                | keine Videobeiträge                                                                                                                                                                                      | **n. a.**                                 |
| 1.3.4 Ausrichtung                                     | Sichtprüfung: keine Einschränkung auf Hoch- oder Querformat                                                                                                                                              | **erfüllt**                               |
| 1.3.5 Eingabezweck bestimmen                          | Es gibt kein Formularfeld, das personenbezogene Daten erhebt                                                                                                                                             | **n. a.**                                 |
| 1.4.3 Kontrast (Minimum)                              | axe (`color-contrast`), 46 Zustände je Browser, doppelt gemessen, drei Browser: **0 Verstöße**. Jede Abstention des Werkzeugs einzeln an den Bildpunkten aufgelöst                                                                                 | **erfüllt**                               |
| 1.4.4 Textgröße ändern                                | Eigene Messung: Wurzelschrift auf 200 % (16 → 32 px), alle fünf Seiten ohne waagrechtes Scrollen und ohne abgeschnittenen Inhalt                                                                         | **erfüllt**                               |
| 1.4.5 Bilder von Text                                 | Kein Text als Bild, mit einer benannten Ausnahme: die KI-Kennzeichnung in den Demo-Fotos (siehe Abschnitt 6)                                                                                             | **erfüllt**                               |
| 1.4.10 Reflow                                         | Eigene Messung bei 320 px: alle fünf Seiten genau 320 px, kein waagrechtes Scrollen. Zwei Mängel am Prüftag gefunden und behoben (siehe Abschnitt 6)                                                     | **erfüllt**                               |
| 1.4.11 Nicht-Text-Kontrast                            | axe; zusätzlich eigene Messung der Umschalter-Flächen in hellem und dunklem Thema                                                                                                                        | **erfüllt**                               |
| 1.4.12 Textabstände                                   | Eigene Messung mit Zeilenhöhe 1,5, Absatzabstand 2 em, Buchstabenabstand 0,12 em, Wortabstand 0,16 em: nichts überlappt, nichts verschwindet                                                             | **erfüllt**                               |
| 1.4.13 Inhalt bei Hover oder Fokus                    | Die Info-Einblendungen sind schließbar (Escape), bleiben bei Zeigerwechsel stehen und verdecken den Auslöser nicht                                                                                       | **erfüllt**                               |
| 2.4.5 Verschiedene Wege                               | Fußzeile auf jeder Seite plus Rubrik-Verweis zurück zur Startseite                                                                                                                                       | **erfüllt**                               |
| 2.4.6 Überschriften und Beschriftungen                | Eigene Messung: 1 bis 16 Überschriften je Seite, **0 übersprungene Ebenen**                                                                                                                              | **erfüllt**                               |
| 2.4.7 Fokus sichtbar                                  | Eigene Messung nach echtem Fokussieren: jedes Element trägt einen Ring von mindestens 2 px. Am Prüftag verbessert (siehe Abschnitt 6)                                                                    | **erfüllt**                               |
| 2.4.11 Fokus nicht verdeckt (Minimum)                 | Eigene Messung: kein fokussiertes Element liegt hinter der geklebten Umschalt-Leiste                                                                                                                     | **erfüllt**                               |
| 2.5.7 Ziehbewegungen                                  | Die Karte ist zusätzlich über Knöpfe bedienbar; sonst gibt es keine Ziehbewegung                                                                                                                         | **erfüllt**                               |
| 2.5.8 Zielgröße (Minimum)                             | Eigene Messung der **tastbaren Fläche** (nicht der gemalten Box) über 12 bis 45 Bedienelemente je Seite: **0 Mängel**. Die Ausnahmen „inline im Fließtext" und „Abstand mindestens 24 px" sind umgesetzt | **erfüllt**                               |
| 3.1.2 Sprache von Teilen                              | Der Sprachumschalter setzt `lang` je Knopf; der zweisprachige Hinweis trägt `lang="de"` und `lang="en"` je Zeile                                                                                         | **erfüllt**                               |
| 3.2.3 Konsistente Navigation                          | Fußzeile und Kopfzeile in gleicher Reihenfolge auf allen Seiten                                                                                                                                          | **erfüllt**                               |
| 3.2.4 Konsistente Erkennung                           | Gleiche Funktionen tragen durchgehend gleiche Beschriftung                                                                                                                                               | **erfüllt**                               |
| 3.3.3 Fehlerempfehlung                                | Jede Fehlermeldung nennt den nächsten Schritt („Versuch es nochmal", „nimm ein anderes Foto")                                                                                                            | **erfüllt**                               |
| 3.3.4 Fehlervermeidung (rechtlich, finanziell, Daten) | Keine Rechtsgeschäfte, keine Zahlungen, keine löschbaren Nutzerdaten. Der einzige verlustbehaftete Schritt — Sprachwechsel bei vorliegendem Ergebnis — fragt zurück                                      | **erfüllt**                               |
| 3.3.8 Barrierefreie Authentifizierung                 | Keine Anmeldung, kein Konto, kein Passwort                                                                                                                                                               | **n. a.**                                 |
| 4.1.3 Statusmeldungen                                 | Warteschlangen-Status, Fehlermeldungen und Ergebnis-Ansage laufen über `aria-live`-Bereiche (`#status`, `#srAnnounce`)                                                                                   | **maschinell erfüllt**, Handprüfung offen |

---

## 6 Am Prüftag gefundene und behobene Mängel

Diese Punkte waren am 17. August verletzt und sind noch am selben Tag behoben.
Sie stehen hier, weil ein Protokoll, das nur Erfolge nennt, unglaubwürdig ist.

| Kriterium                                   | Befund                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Behebung                                                                                                                 | Dauerprüfung |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1.4.10 Reflow                               | Nutzungsbedingungen 333 statt 320 px — die ODR-Adresse der EU ist 34 Zeichen ohne Leerstelle und konnte nicht umbrechen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Umbruch für Links in Rechtstexten                                                                                        | ja           |
| 1.4.10 Reflow                               | Profil-Seite 324 statt 320 px — die Wert-Plakette der Datenwert-Skala schob die Zeile auf                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Zeile bricht um statt die Seite zu verbreitern                                                                           | ja           |
| 1.4.10 Reflow (Ursache)                     | Die geklebte Umschalt-Leiste zog mit fest verdrahteten 20 px über den Rand, während die Seitenpolsterung bei schmalen Bildschirmen auf 16 px zurückgeht                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Beide Werte kommen jetzt aus einer Quelle und können nicht auseinanderdriften                                            | ja           |
| 2.4.7 Fokus sichtbar                        | 7 von 12 bis 20 Elementen je Rechtsseite trugen nur den Browser-Standardring. Sichtbar war er, aber sein Aussehen entscheidet jeder Browser selbst                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Eigener Ring, 2 px, 5,9 : 1 gegen Papier und 11 : 1 im dunklen Thema                                                     | ja           |
| 2.1.1 Tastatur (Stufe A)                    | **Der Sprachumschalter war auf Safari mit der Tastatur nicht erreichbar.** Seine Knöpfe entstehen im JavaScript und trugen kein `tabindex="0"`; Safari tabbt ohne „Vollzugriff Tastatur" nicht auf Buttons. Betroffen waren 7 Knöpfe in zwei Dateien                                                                                                                                                                                                                                                                                                                                                              | `tabindex="0"` ergänzt                                                                                                   | ja           |
| 2.1.1 Tastatur (Stufe A)                    | **Der Rücksprung zur Startseite war auf allen Unterseiten nicht erreichbar** — derselbe Grund, `.eyebrow-home` ohne `tabindex`. Vom neuen Wächter gefunden, nicht von Hand                                                                                                                                                                                                                                                                                                                                                                                                                                        | `tabindex="0"` auf fünf Seiten ergänzt                                                                                   | ja           |
| 4.1.3 Statusmeldungen                       | **Der Wartezustand wurde alle zwei Sekunden erneut angesagt.** Gemessen: 19 Ansagen in 30 Sekunden, bei voller Analyse rund 40 — fast immer derselbe Satz. Ursache: Der Text wurde bei jeder Statusabfrage neu geschrieben, auch unverändert; jede Zuweisung löst in einem `aria-live`-Bereich eine Ansage aus. Dazu die rotierenden Zier-Meldungen, die sich tatsächlich ändern                                                                                                                                                                                                                                  | Nur noch bei echter Änderung schreiben; Rotation stumm geschaltet. Gemessen: **19 → 3**                                  | ja           |
| 1.4.3 Kontrast / 1.4.11 Nicht-Text-Kontrast | **Das Info-Zeichen neben den beiden Profil-Modi war auf 55 % Deckkraft gesetzt: 2,18:1 statt 4,5:1 für den Buchstaben und 3:1 für den Kreisrand.** Es ist ein Bedienelement (`role="button"`, mit der Tastatur erreichbar), keine Zierde. Beim Überfahren mit der Maus wurde es voll deckend — das zählt nicht: Das Kriterium gilt für den Zustand, in dem man das Element vorfindet, und wer mit Tastatur oder Finger arbeitet, fährt gar nicht darüber. **axe konnte den Fall nicht entscheiden und meldete ihn als „unprüfbar"** — gefunden hat ihn erst die Bildpunkt-Messung, die diese Abstentionen auflöst | Deckkraft im Ruhezustand entfernt, der Aufhell-Effekt läuft jetzt über die Farbe. Gemessen 5,22:1 hell und 7,85:1 dunkel | ja           |
| 4.1.3 Statusmeldungen                       | **Nach „Analyse abgeschlossen" folgte nichts.** Der Fokus sprang auf einen Abschnitt ohne Rolle und ohne Namen — dort hat ein Screenreader nichts zu sagen                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `role="region"` mit übersetztem Namen („Dein Profil")                                                                    | ja           |

**Bewusste, benannte Abweichung zu 1.4.5 (Bilder von Text):** Die drei Demo-Fotos
tragen die KI-Kennzeichnung in die Pixel gebrannt. Das ist seit August 2026 Pflicht
und mit Absicht so gebaut — ein Etikett aus Text verschwindet, sobald jemand das
Bild speichert. Die Kennzeichnung ist zusätzlich im Alternativtext und in den
strukturierten Daten hinterlegt, ist also für Screenreader erreichbar. Die Ausnahme
„wesentlich" des Kriteriums greift hier.

## 7 Handprüfung: Stand

Vier Kriterien galten als maschinell nicht entscheidbar. Diese Grenze war zu weit
gezogen — der größere Teil ließ sich messen, sobald das passende Werkzeug gebaut war.

| Kriterium                   | Wie es jetzt belegt ist                                                                                                                                                                                                       | Rest                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1.1.1 Nicht-Text-Inhalt     | Die Vorlese-Reihenfolge aller neun Seiten und Zustände ist mitgeschrieben. Jedes Demo-Bild sagt „AI-generated sample image … Does not depict a real person." **Kein Bild ohne Alternativtext, kein Bedienelement ohne Namen** | ob die Formulierung für einen Menschen taugt |
| 1.3.1 Infos und Beziehungen | Überschriftenstruktur je Seite ausgezählt, keine übersprungene Ebene, Reihenfolge geprüft                                                                                                                                     | —                                            |
| 4.1.3 Statusmeldungen       | Die Ansagen sind wörtlich mitgeschrieben: „Dein Foto ist unterwegs" → „Analyse gestartet" → „Warteschlange · Position" → „Analyse abgeschlossen" → „Dein Profil". Häufigkeit gemessen und begrenzt                            | ob Safari und VoiceOver sie aussprechen      |
| 2.1.1 Tastatur              | Strukturprüfung über sechs Seiten: jedes Bedienelement trägt `tabindex="0"`. Ein Tabulator-Durchlauf im Test taugt dafür nicht — Playwrights WebKit springt auf Knöpfe unabhängig von Safaris Einstellung                     | —                                            |

**Was zwingend am Gerät bleibt**, und das ist keine Formalie: ob Safari und
VoiceOver das Ausgelesene auch tatsächlich aussprechen, und ob es sich für einen
Menschen erträglich anhört. Beide heute gefundenen Fehler hat genau dieses
Zuhören zutage gebracht — keine Messung hatte sie gezeigt. Der Aufwand dafür ist
klein: einmal zuhören, Eindruck sagen. Das Protokollieren übernimmt das Werkzeug.

## 8 Nicht angestrebt: Stufe AAA

AAA ist ausdrücklich nicht das Ziel — das W3C empfiehlt es nicht als Anforderung für
ganze Websites, weil es sich für manche Inhalte grundsätzlich nicht erfüllen lässt.
Gemessen wurde es dennoch, damit die Erklärung sagen kann, was nebenbei erreicht ist.

Von 22 anwendbaren AAA-Kriterien sind **10 nachgewiesen erfüllt**: Linkzweck ohne
Leerformeln, Überschriftenstruktur ohne Sprünge, Fokus nie verdeckt,
Fokus-Erscheinung mit mindestens 2 px, kein Blocksatz, Zeilenabstand mindestens 1,5,
Animationen abschaltbar, kein Blitzen, keine Unterbrechungen, alle Eingabearten
gleichwertig.

**Sechs sind nachweislich nicht erfüllt, mit Grund:**

| Kriterium                             | Befund                                                      | Warum es so bleibt                                                              |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1.4.6 Kontrast 7 : 1                  | 17 bis 37 Elemente je Seite (die Profil-Ansicht erfüllt es) | Die Markenpalette ist auf 4,5 : 1 ausgelegt; 7 : 1 wäre ein Umbau der Marke     |
| 1.4.8 Visuelle Präsentation           | Zeilenlänge bis 103 statt 80 Zeichen                        | Verhältnismäßigkeit                                                             |
| 1.4.9 Bilder von Text (ohne Ausnahme) | die KI-Kennzeichnung                                        | **unerfüllbar** — die Kennzeichnung ist Pflicht                                 |
| 2.5.5 Zielgröße 44 × 44               | 6 bis 30 Bedienelemente je Seite                            | AAA kennt die Abstands-Ausnahme nicht; ein Umbau der Bedienflächen              |
| 3.1.4 Abkürzungen                     | auf den Rechtsseiten behoben, auf der Startseite offen      | Der Text kommt dort aus den Sprachdateien; 17 Fundstellen für ein AAA-Kriterium |
| 3.1.5 Lesbarkeit                      | Rechtstexte über Sekundarstufe I                            | Erforderte eine zweite, vereinfachte Fassung jedes Rechtstexts                  |

Sechs weitere AAA-Kriterien sind nur von Hand entscheidbar und hier nicht bewertet.

## 9 Was ausdrücklich nicht eingesetzt wird

**Kein Barrierefreiheits-Overlay.** Anbieter wie accessiBe oder UserWay liefern ein
„zertifiziert barrierefrei"-Abzeichen mit. Die Fachwelt lehnt sie geschlossen ab:
Sie verschlechtern die Bedienung für Screenreader-Nutzer messbar und haben Klagen
ausgelöst. Für genau die Fachleute, die malziME erreichen soll, wäre so ein Abzeichen
ein Warnsignal.

**Kein erkauftes Siegel.** Ein externes Zertifikat wurde geprüft und verworfen. Ein
Protokoll mit nachvollziehbaren Messungen und offen benannten Lücken belegt mehr als
eine Urkunde ohne Prüfweg.

## 10 Nächste Prüfung

Fällig bei jeder Änderung an Aussehen, Bedienung oder Seitenstruktur, spätestens
halbjährlich. Die Messungen laufen bei jedem Auslieferungslauf automatisch mit; die
vier Handprüfungen aus Abschnitt 7 sind bei jeder Prüfung zu wiederholen.
