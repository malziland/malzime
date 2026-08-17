# Prüfbericht Barrierefreiheit — malziME

**Erstellt nach [WCAG-EM 2.0](https://www.w3.org/TR/WCAG-EM/)**, der Methodik des W3C zur
Bewertung der Konformität mit den Web Content Accessibility Guidelines.

> Dieser Bericht ersetzt die frühere Fassung `PRUEFPROTOKOLL.md`. Die Messungen darin
> waren belastbar, die Struktur war selbst ausgedacht. Ein Bericht, auf den sich ein
> Dritter berufen soll, muss einer anerkannten Methodik folgen — sonst steht dort nur
> „wir haben gründlich geprüft".

---

## Angaben zur Prüfung (WCAG-EM Schritt 5.1)

|                     |                                                                                |
| ------------------- | ------------------------------------------------------------------------------ |
| **Prüfer**          | malziland - learning \| training \| consulting e.U., Inhaber Christoph Krieger |
| **Auftraggeber**    | Eigenprüfung                                                                   |
| **Prüfdatum**       | 17. August 2026                                                                |
| **Geprüfter Stand** | Commit `b83121d`, ausgelieferte Kennung `2026081703`                           |
| **Art der Prüfung** | Selbstbewertung, werkzeuggestützt und teilweise manuell                        |

---

## Schritt 1 — Geltungsbereich

### 1.1 Geprüftes Produkt

Die Website **https://malzi.me** vollständig, einschließlich aller Unterseiten und der
gesamten Anwendungslogik. Nicht enthalten: die eingebettete Landkarte von OpenStreetMap
(fremder Inhalt, von uns nicht gestaltbar) und externe Ziele der Fußzeilen-Links.

### 1.2 Angestrebte Konformitätsstufe

**WCAG 2.2, Stufe AA.**

Stufe AAA wird ausdrücklich nicht angestrebt. Das W3C empfiehlt sie nicht als Anforderung
für ganze Websites, weil sie sich für manche Inhalte grundsätzlich nicht erfüllen lässt.
Was davon nebenbei erfüllt ist, steht nachrichtlich in Anhang B.

### 1.3 Accessibility-Support-Baseline

**Diese Angabe ist die Grundlage jeder Konformitätsaussage** — ohne sie ist „konform" nicht
bestimmbar. Sie legt fest, mit welchen Kombinationen aus Browser und Hilfsmittel die Seite
funktionieren muss.

**Die Baseline ist breit, und zwar nicht aus Ehrgeiz, sondern aus Sachlage:** malziME läuft
in Schulworkshops auf den Geräten, die Schülerinnen, Schüler und Lehrkräfte mitbringen. Der
Betreiber hat darauf keinen Einfluss und kann keine Kombination ausschließen.

Damit gelten als unterstützt:

| Browser              | Hilfsmittel          | Betriebssystem |
| -------------------- | -------------------- | -------------- |
| Chrome, Edge (Blink) | NVDA, JAWS, Narrator | Windows        |
| Firefox (Gecko)      | NVDA, JAWS           | Windows        |
| Safari (WebKit)      | VoiceOver            | macOS          |
| Safari (WebKit)      | VoiceOver            | iOS, iPadOS    |
| Chrome (Blink)       | TalkBack             | Android        |

jeweils in den aktuellen und der jeweils vorangegangenen Hauptversion.

**Was davon tatsächlich geprüft wurde, steht in Schritt 4.3.** Die Lücke zwischen erklärter
Baseline und tatsächlicher Prüftiefe ist die wichtigste Einschränkung dieses Berichts und
wird dort offen benannt.

### 1.4 Zusätzliche Anforderungen

Keine über WCAG 2.2 AA hinaus. Zwei projekteigene Festlegungen wirken mit:

- **Keine Barrierefreiheits-Overlays.** Sie verschlechtern die Bedienung mit Screenreader
  nachweislich.
- **Die KI-Kennzeichnung der Beispielfotos bleibt in den Bildpunkten**, auch wenn das
  „Text in Bildern" bedeutet. Grundlage: Artikel 50 der EU-KI-Verordnung, gültig seit 2. August 2026; eine Kennzeichnung neben dem Bild geht beim Weiterschicken verloren.

---

## Schritt 2 — Erkundung des Produkts

### 2.1 Gemeinsame Ansichten

Kopfzeile mit Sprachumschalter, Fußzeile mit den Rechtslinks, Sprungmarke „Zum Inhalt
springen" — auf allen Seiten identisch aufgebaut.

### 2.2 Wesentliche Funktionalität

**Die Analyse eines Fotos.** Das ist der einzige eigentliche Zweck der Seite und ein
mehrstufiger Ablauf, kein Einzelbild. Er wird in Schritt 3.3 als vollständiger Prozess
dokumentiert.

Nebenfunktionen: Umschalten zwischen den beiden Profil-Modi, der Realitäts-Check, der
PDF-Export, der Sprachwechsel, die Nutzungsstatistik.

### 2.3 Vielfalt der Inhaltstypen

Fließtext, Listen, Tabellen (Rechtsseiten), Formularelemente (Dateiauswahl,
Umschalter), modale Dialoge mit Fokus-Käfig, eine eingebettete Landkarte, dynamisch
erzeugte Inhalte, Live-Bereiche für Statusmeldungen, animierte Zustandsanzeigen,
erzeugte PDF-Dateien.

### 2.4 Eingesetzte Technologien

Auf diese Technologien verlässt sich die Seite; ohne sie funktioniert sie nicht
vollständig:

- **HTML** — statisch ausgeliefert, kein serverseitiges Rendern
- **CSS** — einschließlich `prefers-reduced-motion`; **kein** `prefers-color-scheme`
  (das dunkle Erscheinungsbild entsteht ausschließlich über den Beast-Schalter)
- **JavaScript** (22 ES-Module) — ohne JavaScript ist keine Analyse möglich
- **WAI-ARIA** — im Einsatz: `aria-label`, `aria-labelledby`, `aria-live`, `aria-hidden`,
  `aria-modal`, `aria-atomic`, `aria-pressed`, `role`, `inert`
- **Fremdbibliotheken**, selbst gehostet: Leaflet (Karte), exifr (Bild-Metadaten)

### 2.5 Besondere Seiten

Datenschutzerklärung, Impressum, Nutzungsbedingungen, Barrierefreiheitserklärung,
Nutzungsstatistik.

---

## Schritt 3 — Repräsentative Stichprobe

### 3.1 Strukturierte Auswahl

Ausgewählt nach den fünf Kategorien der Methodik:

| Kategorie              | Ansicht                | Begründung                                              |
| ---------------------- | ---------------------- | ------------------------------------------------------- |
| Gemeinsame Ansicht     | Startseite `/`         | Einstiegspunkt, trägt Kopf- und Fußzeile                |
| Besondere Seite        | `/datenschutz`         | längster Text, Tabellen, viele Links                    |
| Besondere Seite        | `/impressum`           | kürzeste Rechtsseite, andere Struktur                   |
| Besondere Seite        | `/nutzungsbedingungen` | nummerierte Abschnitte, verschachtelte Listen           |
| Besondere Seite        | `/barrierefreiheit`    | neu, noch nie mit Nutzern erprobt                       |
| Inhaltstyp-Vielfalt    | `/stats`               | Zahlen, Fortschrittsbalken, automatische Aktualisierung |
| Funktionale Komponente | Sprachhinweis-Dialog   | modaler Dialog mit Fokus-Käfig                          |
| Funktionale Komponente | Ergebnis mit Karte     | fremder eingebetteter Inhalt                            |

### 3.2 Zufällige Auswahl

Die Methodik verlangt zusätzlich rund 10 % zufällig gewählter Ansichten als
Qualitätskontrolle der strukturierten Auswahl.

**Hier nicht anwendbar, mit Begründung:** Die Website hat sechs Seiten. Die strukturierte
Auswahl umfasst sie **vollständig**; eine Zufallsauswahl könnte nichts finden, was nicht
ohnehin geprüft ist. Die Zufallsauswahl dient bei großen Websites dazu, die Repräsentativität
der Stichprobe zu prüfen — bei einer Vollerhebung entfällt ihr Zweck.

Als Ersatz für den Zweck der Regel — unbeabsichtigte Varianten zu finden — wurden
**Zustände** statt Seiten variiert: helles und dunkles Erscheinungsbild, beide Sprachen,
zwei Fenstermaße, drei Browser-Maschinen.

### 3.3 Vollständige Prozesse

Die Methodik verlangt, dass ein Prozess **in allen Schritten** geprüft wird, nicht in
Ausschnitten. malziME hat einen wesentlichen Prozess:

**Die Analyse eines Fotos**

| Schritt | Zustand                                                              |
| ------- | -------------------------------------------------------------------- |
| 1       | Leere Startseite, Aufforderung zur Fotoauswahl                       |
| 2       | Foto gewählt, Vorbereitung im Browser (Verkleinern, Metadaten lesen) |
| 3       | Hochladen und Einreihen                                              |
| 4       | Warten in der Schlange, mit Position und Restzeit                    |
| 5       | Verarbeitung, Live-Text während das Modell schreibt                  |
| 6       | Ergebnis fertig, Enthüllung des Profils                              |
| 7       | Umschalten in den Beast-Modus                                        |
| 8       | Realitäts-Check ausfüllen und absenden                               |
| 9       | PDF-Export                                                           |
| —       | Abzweig: Fehlermeldung nach fehlgeschlagener Analyse                 |
| —       | Abzweig: Verbindungsabbruch mitten im Ablauf                         |

**Alle neun Schritte und beide Abzweige sind geprüft.**

Beim Aufstellen dieser Liste fiel auf, dass die Schritte 2, 8 und 9 — Bildvorbereitung,
Realitäts-Check und PDF-Export — nie gemessen worden waren. Sie sind seither ergänzt und
laufen mit. Das ist der praktische Gewinn der Methodik: Die Forderung nach vollständigen
Prozessen hat drei ungeprüfte Zustände sichtbar gemacht, die in einer selbst gewählten
Struktur nie aufgefallen wären.

Beim PDF-Export endet die Prüfung am Knopf. Die erzeugte Datei ist ein eigenes Format mit
eigenem Regelwerk (PDF/UA) und gehört nicht in eine HTML-Prüfung; das ist eine bewusste
Grenze, keine Lücke.

---

## Schritt 4 — Auswertung der Stichprobe

### 4.1 Prüfmittel

| Werkzeug                           | Herkunft          | Regelwerk                                   | Rolle                                                                             |
| ---------------------------------- | ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| **axe-core 4.12.1**                | Deque Systems     | eigenes, auf WCAG abgebildet                | Hauptwerkzeug, blockierendes Gate                                                 |
| **pa11y 9.1.1 / HTML_CodeSniffer** | Squiz, quelloffen | **unabhängige** Umsetzung der W3C-Techniken | Zweitmeinung                                                                      |
| **Lighthouse**                     | Google            | benutzt intern axe                          | Live-Prüfung, keine echte Zweitmeinung                                            |
| Eigene Messungen                   | —                 | direkt gegen die Kriterientexte             | Zielgrößen, Umbruch, Textgröße, Textabstände, Fokus, Ansagen, Vorlese-Reihenfolge |
| Bildpunkt-Messung                  | —                 | Kontrastformel der WCAG                     | entscheidet, wenn Werkzeuge sich widersprechen                                    |

**Zwei Regeln aus der Erfahrung dieses Berichts:**

**Eine Abstention ist kein Bestehen.** axe meldet Elemente als „unprüfbar", wenn es den
Hintergrund nicht bestimmen kann. In der ersten Fassung dieses Berichts wurden nur die
Verstöße gezählt und daraus „0 Verstöße" — die Abstentionen lagen unbeantwortet daneben.

Seither entscheidet eine **Bildpunkt-Messung**: Das Element wird fotografiert, das Foto
Punkt für Punkt ausgelesen, hellster und dunkelster Punkt nach der Kontrastformel der WCAG
verrechnet. Sie läuft bei jeder Messung automatisch mit und macht den Lauf rot, wenn sie
einen Verstoß bestätigt.

**Das hat sofort einen echten Mangel gefunden**, den axe nicht entscheiden konnte: das
Info-Zeichen neben den beiden Profil-Modi, bei 2,18:1 statt der verlangten 4,5:1
(Fund A-2026-08-17-09 in Anhang A). Behoben.

**Stand: 55 Abstentionen je Browser, davon 0 ungeklärt.** Alle 55 sind dasselbe
Trennzeichen in der Fußzeile — reine Zierde und damit von 1.4.3 ausdrücklich ausgenommen.
Die Ausnahme steht als benannter Eintrag mit Begründung im Prüfcode, nicht als stille
Regel: Wer eine hinzufügt, muss den Grund danebenschreiben, und der steht dann im
Änderungsverlauf.

**Jede Messung läuft doppelt und hat eine Positivkontrolle.** Übernommen wird nur, was beide
Male auftritt; findet ein Werkzeug nichts zu prüfen, bricht der Lauf ab statt grün zu
melden.

### 4.2 Ergebnis je Erfolgskriterium

Die vollständige Tabelle aller 55 Kriterien der Stufe AA — 31 auf A, 24 auf AA — mit
Prüfweg und Ergebnis je Zeile steht in **[Anhang A](PRUEFPROTOKOLL.md#5-die-kriterien-im-einzelnen)**.

**Zusammenfassung:**

|                                               | Anzahl |
| --------------------------------------------- | ------ |
| erfüllt, nachgewiesen                         | 40     |
| nicht anwendbar, mit Grund                    | 11     |
| maschinell erfüllt, menschliche Prüfung offen | 4      |
| **als verletzt festgestellt**                 | **0**  |

Am Prüftag gefunden **und behoben**: neun Mängel, darunter zwei auf Stufe A. Sie stehen mit
Ursache, Behebung und Dauerprüfung in Anhang A. Zwei davon fand kein Werkzeug, sondern ein
Mensch, der zum ersten Mal mit VoiceOver zuhörte; einen fand die Auflösung der
Abstentionen.

**Messumfang:** 46 Zustände je Browser-Maschine, drei Maschinen, also 138 Messungen — jede
zweifach ausgeführt und nur übernommen, was beide Male auftrat.

### 4.3 Prüftiefe gegenüber der Baseline

**Die wichtigste Einschränkung dieses Berichts.**

| Aus der Baseline                | Geprüft                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blink (Chrome, Edge)            | ✅ automatisiert, alle Ansichten und Zustände                                                                                                                             |
| WebKit (Safari macOS/iOS)       | ✅ automatisiert, alle Ansichten und Zustände                                                                                                                             |
| Gecko (Firefox)                 | ✅ automatisiert, Barrierefreiheits-Prüfungen                                                                                                                             |
| VoiceOver (macOS)               | ⚠️ **teilweise** — der Barrierefreiheits-Baum und alle Ansagen sind ausgelesen und beurteilt; **gehört** wurde einmalig von einer Person, was zwei Mängel zutage förderte |
| VoiceOver (iOS)                 | ❌ **nicht geprüft**                                                                                                                                                      |
| NVDA, JAWS (Windows)            | ❌ **nicht geprüft**                                                                                                                                                      |
| TalkBack (Android)              | ❌ **nicht geprüft**                                                                                                                                                      |
| Braillezeile, Schaltersteuerung | ❌ **nicht geprüft**                                                                                                                                                      |

Die Browser-Maschinen sind vollständig abgedeckt. **Die Hilfsmittel sind es nicht** — sie
laufen auf Betriebssystemen, die dem Prüfer nicht zur Verfügung stehen. Deshalb ist unter
[Issue #155](https://github.com/malziland/malzime/issues/155) öffentlich um Rückmeldung von
Menschen gebeten worden, die mit diesen Hilfsmitteln arbeiten.

---

## Schritt 5 — Ergebnis der Bewertung

### 5.1 Aussage zur Konformität

**Die Website ist weitgehend konform mit WCAG 2.2 Stufe AA.**

Kein Erfolgskriterium ist als verletzt festgestellt. Der wesentliche Prozess ist über alle
neun Schritte geprüft, alle Abstentionen sind aufgelöst.

„Weitgehend" statt „vollständig" steht dort trotzdem, und zwar aus **zwei** benannten
Gründen:

1. **Die erklärte Baseline ist breiter als die Prüftiefe.** Vier Hilfsmittel-Kombinationen
   — VoiceOver auf iOS, NVDA, JAWS, TalkBack — sind nicht geprüft. Solange das so ist,
   wäre „vollständig konform" eine Aussage über Geräte, an denen niemand gesessen hat.
2. **Das W3C schließt eine reine Werkzeugaussage ohnehin aus:** „no tool alone can
   determine if a site meets accessibility standards. Knowledgeable human evaluation is
   required to determine if a site is accessible."

Beide Punkte laufen auf dasselbe hinaus: Es fehlt nicht Arbeit am Code, sondern Menschen,
die mit ihren Hilfsmitteln zuhören. Deshalb [Issue #155](https://github.com/malziland/malzime/issues/155).

### 5.2 Wiederkehrende Muster

Zwei Fehlerklassen traten mehrfach auf und sind deshalb gesondert genannt:

**Dynamisch erzeugte Elemente wurden von Prüfungen nicht erfasst.** Die Regel „jedes
Bedienelement braucht `tabindex="0"`, sonst überspringt Safari es" war seit Langem als Test
vorhanden — aber nur für statisches HTML. Alle im JavaScript erzeugten Knöpfe waren
ungeprüft und tatsächlich nicht erreichbar. Abhilfe: Die Prüfung läuft jetzt gegen den
DOM **nach** Ausführung des JavaScripts.

**Messungen sagten „dass", nicht „wie oft".** Die Statusansagen waren korrekt und
vollständig — und wiederholten sich alle zwei Sekunden. Eine formal richtige Seite war
praktisch unbenutzbar. Abhilfe: Häufigkeit wird mitgemessen und begrenzt.

### 5.3 Nächste Prüfung

Bei jeder Änderung an Aussehen, Bedienung oder Seitenstruktur, mindestens halbjährlich.
Die maschinellen Messungen laufen bei jeder Auslieferung automatisch mit.

---

## Anhänge

- **[Anhang A](PRUEFPROTOKOLL.md)** — alle 55 Kriterien einzeln, mit Prüfweg und Ergebnis;
  die behobenen Mängel mit Ursache und Dauerprüfung
- **Anhang B** — Stufe AAA, nachrichtlich (in Anhang A, Abschnitt 8)
- **Rohdaten** — `e2e/.protokoll/befunde-*.json` je Browser, bei jedem Lauf neu erzeugt
- **Reproduzierbar** — `npx playwright test e2e/barrierefreiheit-protokoll.test.js`
